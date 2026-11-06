/** 副作用队列（移植自 dsh-superagent src/app/effects.ts 的语义）。
 *
 *  核心规则：
 *   ① 命令在「事务内」只 enqueue(kind, key, payload)；执行只在提交之后开始；
 *   ② 同 kind+key 只有一行：重复入队替换 payload 并立即到期，不改变队列顺序（合并）；
 *   ③ 失败按指数退避重试；抛 `Later` 表示「稍后再试」且不计失败（如无空闲槽位）；
 *   ④ 每个 handler 处理自己的健康态（连续失败 N 次才报 error）。
 *
 *  与 superagent 的差异：它落 SQLite；本实现进程内存 + 可选 load/persist 回调
 *  （宿主可持久化到 .jarvis/effects.json，重启后重放）。
 */

/** 抛出表示「现在做不了，稍后重试，不计失败」。 */
export class Later extends Error {
  constructor(reason = 'later') { super(reason); this.name = 'Later' }
}

export class Effects {
  /**
   * @param {{ load?: () => Promise<any[]> | any[], persist?: (rows: any[]) => Promise<void> | void, limit?: number, now?: () => number }} [opts]
   */
  constructor(opts = {}) {
    this.limit = Math.max(1, Number(opts.limit || 4))
    this.now = opts.now || (() => Date.now())
    this.persist = typeof opts.persist === 'function' ? opts.persist : null
    this.handlers = new Map()
    /** @type {Map<string, {kind:string,key:string,payload:any,order:number,dueAt:number,attempts:number,lastError:string,running:boolean}>} */
    this.rows = new Map()
    this.order = 0
    this.loaded = false
    this.ticking = false
    this.health = new Map()
    this._persistTimer = null
    if (typeof opts.load === 'function') this._load = opts.load
  }

  /** 注册一种副作用 handler（一种 kind 只能注册一次）。 */
  handle(kind, run, options = {}) {
    if (this.handlers.has(kind)) throw new Error(`effects handler 已注册：${kind}`)
    this.handlers.set(kind, { run, ...options })
  }

  /** 事务内入队：同 kind+key 合并（替换 payload、立即到期、保持原顺序）。 */
  enqueue(kind, key, payload) {
    const id = `${kind}::${key}`
    const existed = this.rows.get(id)
    if (existed) {
      existed.payload = payload
      existed.dueAt = this.now()
      return existed
    }
    const row = { kind, key, payload, order: ++this.order, dueAt: this.now(), attempts: 0, lastError: '', running: false }
    this.rows.set(id, row)
    this._schedulePersist()
    return row
  }

  /** 处理到期行（最老优先，受并发上限约束）。串行调用会合并为一次。 */
  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      await this._ensureLoaded()
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const due = [...this.rows.values()]
          .filter((r) => !r.running && r.dueAt <= this.now() && this.handlers.has(r.kind))
          .sort((a, b) => a.order - b.order)
          .slice(0, this.limit)
        if (!due.length) break
        await Promise.all(due.map((row) => this._runOne(row)))
      }
    } finally {
      this.ticking = false
    }
  }

  async _runOne(row) {
    const h = this.handlers.get(row.kind)
    row.running = true
    try {
      await h.run(row.payload, row)
      this.rows.delete(`${row.kind}::${row.key}`)
      this._note(row.kind, null)
      this._schedulePersist()
    } catch (e) {
      if (e && e.name === 'Later') {
        row.dueAt = this.now() + (h.laterMs || 2000)
      } else {
        row.attempts += 1
        row.lastError = String((e && e.message) || e)
        const backoff = Math.min(h.maxBackoffMs || 60000, (h.firstRetryMs || 2000) * Math.pow(2, Math.max(0, row.attempts - 1)))
        row.dueAt = this.now() + backoff
        this._note(row.kind, row.lastError)
      }
      this._schedulePersist()
    } finally {
      row.running = false
    }
  }

  /** 健康态：某 kind 连续失败 3 次才置 error；一次成功即清。 */
  _note(kind, error) {
    if (error == null) { this.health.delete(kind); return }
    const cur = this.health.get(kind) || { fails: 0, error: '' }
    cur.fails += 1
    cur.error = error
    if (cur.fails >= 3) this.health.set(kind, cur)
  }

  pending() { return [...this.rows.values()].map((r) => ({ kind: r.kind, key: r.key, attempts: r.attempts })) }
  idle() { return this.rows.size === 0 }

  async _ensureLoaded() {
    if (this.loaded || typeof this._load !== 'function') { this.loaded = true; return }
    try {
      const saved = await this._load()
      if (Array.isArray(saved)) {
        for (const r of saved) {
          if (r && r.kind && r.key != null) {
            const id = `${r.kind}::${r.key}`
            if (!this.rows.has(id)) {
              this.order = Math.max(this.order, Number(r.order || 0))
              this.rows.set(id, { kind: r.kind, key: r.key, payload: r.payload, order: Number(r.order || ++this.order), dueAt: this.now(), attempts: Number(r.attempts || 0), lastError: String(r.lastError || ''), running: false })
            }
          }
        }
      }
    } catch { /* 持久化读失败：从空队列开始 */ }
    this.loaded = true
  }

  _schedulePersist() {
    if (!this.persist) return
    if (this._persistTimer) return
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null
      try {
        const rows = [...this.rows.values()].map((r) => ({ kind: r.kind, key: r.key, payload: r.payload, order: r.order, attempts: r.attempts, lastError: r.lastError }))
        Promise.resolve(this.persist(rows)).catch(() => {})
      } catch { /* 持久化失败不阻断 */ }
    }, 50)
    if (typeof this._persistTimer.unref === 'function') this._persistTimer.unref()
  }

  /** 停机：清空持久化定时器（行保留，供重启重放）。 */
  drain() {
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null }
    if (this.persist) {
      try {
        const rows = [...this.rows.values()].map((r) => ({ kind: r.kind, key: r.key, payload: r.payload, order: r.order, attempts: r.attempts, lastError: r.lastError }))
        Promise.resolve(this.persist(rows)).catch(() => {})
      } catch { /* 忽略 */ }
    }
  }
}
