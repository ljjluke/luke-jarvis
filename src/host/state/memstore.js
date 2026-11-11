/** 跨平台工作区记忆引擎（纯 Node，无 SQLite/无 shell/无 Python）。
 *
 *  为什么：用户可能 Windows/macOS/Linux，后期还有移动端 UI；记忆不能依赖 systemd/python/sqlite 扩展。
 *  设计：append-only JSONL 为唯一真源；内存倒排索引（CJK bigram + 拉丁词 + 子串兜底）按需重建；
 *        无原生依赖、无外部进程，DSH 宿主在哪个平台跑就在哪跑。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'

const CACHE = new Map() // dir -> { mtimeMs, docs:Map, order, postings:Map, bytes }

function sharedDir() { return path.join(os.homedir(), '.dsh', 'luke-jarvis', 'shared-memory') }
function sharedFile() { return path.join(sharedDir(), 'entries.jsonl') }

function memDir(projectDir) { return path.join(String(projectDir || ''), '.jarvis', 'memory') }
function entriesFile(projectDir) { return path.join(memDir(projectDir), 'entries.jsonl') }
function rawDir(projectDir) { return path.join(memDir(projectDir), 'raw') }
function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex') }
function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
function nowMs() { return Date.now() }

/** CJK bigram + 拉丁词切分（零依赖，跨语言可用）。 */
export function tokens(text) {
  const out = []
  const t = String(text || '')
  let latin = ''
  let cjkRun = ''
  const flushLatin = () => { if (latin) { out.push(latin.toLowerCase()); latin = '' } }
  const flushCjk = () => {
    if (!cjkRun) return
    if (cjkRun.length === 1) out.push(cjkRun)
    else for (let i = 0; i + 1 < cjkRun.length; i++) out.push(cjkRun.slice(i, i + 2))
    cjkRun = ''
  }
  for (const ch of t) {
    if (/[\u4e00-\u9fff]/.test(ch)) { flushLatin(); cjkRun += ch }
    else if (/[A-Za-z0-9_]/.test(ch)) { flushCjk(); latin += ch }
    else { flushLatin(); flushCjk() }
  }
  flushLatin(); flushCjk()
  return out
}

function load(projectDir) {
  const dir = memDir(projectDir)
  const file = entriesFile(projectDir)
  let mtime = 0
  try { mtime = fs.statSync(file).mtimeMs } catch { mtime = 0 }
  let smtime = 0
  try { smtime = fs.statSync(sharedFile()).mtimeMs } catch { smtime = 0 }
  const stamp = mtime + ':' + smtime
  const hit = CACHE.get(dir)
  if (hit && hit.stamp === stamp) return hit
  const docs = new Map()
  const bad = []
  let lines = 0
  try {
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      lines++
      try { const e = JSON.parse(line); if (e && e.id) docs.set(e.id, e) } catch { bad.push(lines) }
    }
  } catch { /* 文件不存在或读失败：空库 */ }
  // 全局 shared 层（跨工作区只读）：只收方法论条目，lane='shared'
  try {
    const stxt = fs.readFileSync(sharedFile(), 'utf8')
    for (const line of stxt.split('\n')) {
      if (!line.trim()) continue
      try { const e = JSON.parse(line); if (e && e.id) docs.set(e.id, e) } catch {}
    }
  } catch { /* 无 shared 层 */ }
  const postings = new Map()
  const order = []
  for (const [id, e] of docs) {
    order.push(id)
    const toks = new Set(tokens((e.title || '') + ' ' + (e.title || '') + ' ' + e.body + ' ' + (e.tags || []).join(' ')))
    for (const tk of toks) {
      let s = postings.get(tk)
      if (!s) { s = new Set(); postings.set(tk, s) }
      s.add(id)
    }
  }
  const snap = { dir, mtime, stamp, docs, order, postings, badLines: bad.length, lines }
  CACHE.set(dir, snap)
  return snap
}

/** 写入一条（append-only；同 id 新版本覆盖旧版本的自然由后写覆盖）。 */
export function addEntry(projectDir, entry) {
  const dir = memDir(projectDir)
  fs.mkdirSync(dir, { recursive: true })
  const id = String(entry.id || 'mem_' + sha(entry.lane + '|' + entry.kind + '|' + norm(entry.title).toLowerCase()).slice(0, 16))
  const e = {
    id,
    lane: String(entry.lane || path.basename(projectDir) || 'default'),
    kind: String(entry.kind || 'fact'),
    title: norm(entry.title).slice(0, 160),
    body: norm(entry.body).slice(0, 4000),
    tags: Array.isArray(entry.tags) ? entry.tags.map(String).slice(0, 12) : [],
    confidence: String(entry.confidence || 'provisional'),
    valid_from: Number(entry.valid_from || nowMs()),
    valid_to: entry.valid_to == null ? null : Number(entry.valid_to),
    supersedes: entry.supersedes ? String(entry.supersedes) : null,
    updated_at: nowMs(),
    extractor: String(entry.extractor || 'plugin/1'),
    source: entry.source || { type: 'plugin', ref: '' },
  }
  // 版本/冲突语义：同 key 正文变化 → 新增版本 id + supersedes + disputed（两条都保留，注入标冲突）
  try {
    const prev = load(projectDir).docs.get(id)
    if (prev && norm(prev.body) !== e.body) {
      e.supersedes = prev.id
      e.disputed = true
      e.id = id + '_' + String(nowMs()).slice(-6)
      e.valid_from = nowMs()
    }
  } catch { /* 首次写入无索引 */ }
  const target = e.lane === 'shared' ? sharedFile() : entriesFile(projectDir)
  if (e.lane === 'shared') fs.mkdirSync(sharedDir(), { recursive: true })
  fs.appendFileSync(target, JSON.stringify(e) + '\n', 'utf8')
  if (e.body) {
    try { fs.mkdirSync(rawDir(projectDir), { recursive: true }); fs.writeFileSync(path.join(rawDir(projectDir), sha(e.body)), e.body, 'utf8') } catch { /* 证据落盘失败不阻断 */ }
  }
  CACHE.delete(dir)
  return e
}

function idf(n, df) { return Math.log(1 + (n - df + 0.5) / (df + 0.5)) }

/** 检索：bigram/拉丁词倒排 + 标题加权 + 子串兜底（短查询）+ lane 过滤。 */
export function recall(projectDir, query, opts = {}) {
  const snap = load(projectDir)
  const q = norm(query)
  const k = Math.max(1, Math.min(20, Number(opts.k) || 5))
  const lane = opts.lane ? String(opts.lane) : ''
  const includeShared = opts.includeShared !== false
  if (!q) return []
  const qt = tokens(q)
  const scores = new Map()
  const N = snap.docs.size || 1
  for (const tk of qt) {
    const set = snap.postings.get(tk)
    if (!set) continue
    const w = idf(N, set.size)
    for (const id of set) scores.set(id, (scores.get(id) || 0) + w)
  }
  // 子串兜底（1-2 字中文/精确片段/标题）
  const low = q.toLowerCase()
  for (const [id, e] of snap.docs) {
    const title = String(e.title || '').toLowerCase()
    const body = String(e.body || '').toLowerCase()
    if (title.includes(low)) scores.set(id, (scores.get(id) || 0) + 4)
    else if (low.length >= 2 && body.includes(low)) scores.set(id, (scores.get(id) || 0) + 1.2)
  }
  const out = []
  for (const [id, sc] of scores) {
    const e = snap.docs.get(id)
    if (!e) continue
    if (lane && !(e.lane === lane || (includeShared && e.lane === 'shared'))) continue
    if (e.valid_to) continue
    out.push({ id, lane: e.lane, kind: e.kind, title: e.title, snippet: String(e.body || '').slice(0, 240), confidence: e.confidence, disputed: Boolean(e.disputed), tags: e.tags || [], score: Math.round(sc * 1000) / 1000 })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, k)
}

/** 批量写入：一次读索引、一次 append，避免 O(n²)。 */
export function addEntriesBulk(projectDir, list) {
  const dir = memDir(projectDir)
  fs.mkdirSync(dir, { recursive: true })
  const snap = load(projectDir)
  const known = new Map()
  for (const e of snap.docs.values()) known.set(norm(e.lane) + '|' + norm(e.kind) + '|' + norm(e.title).toLowerCase(), norm(e.body))
  const lines = []
  const added = []
  for (const raw of (list || [])) {
    const body = norm(raw.body)
    const key = norm(raw.lane || path.basename(projectDir)) + '|' + norm(raw.kind || 'fact') + '|' + norm(raw.title).toLowerCase()
    if (!norm(raw.title) || !body) continue
    if (known.has(key) && known.get(key) === body) continue
    let id = 'mem_' + sha(key).slice(0, 16)
    const prevBody = known.has(key) ? known.get(key) : null
    const conflict = prevBody != null && prevBody !== body
    if (conflict) id = id + '_' + String(nowMs()).slice(-6)
    const e = {
      id, lane: String(raw.lane || path.basename(projectDir)), kind: String(raw.kind || 'fact'),
      title: norm(raw.title).slice(0, 160), body: body.slice(0, 4000),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 12) : [],
      confidence: String(raw.confidence || 'provisional'), valid_from: nowMs(), valid_to: null,
      supersedes: conflict ? id : null, disputed: Boolean(conflict && (raw.source || {}).type !== 'ingest'), updated_at: nowMs(), extractor: String(raw.extractor || 'plugin/1'),
      source: raw.source || { type: 'ingest', ref: '' },
    }
    known.set(key, body)
    lines.push(JSON.stringify(e))
    added.push(e.id)
    if (e.body) { try { fs.mkdirSync(rawDir(projectDir), { recursive: true }); fs.writeFileSync(path.join(rawDir(projectDir), sha(e.body)), e.body, 'utf8') } catch {} }
  }
  if (lines.length) fs.appendFileSync(entriesFile(projectDir), lines.join('\n') + '\n', 'utf8')
  CACHE.delete(dir)
  return { added: added.length, ids: added.slice(0, 50) }
}

/** 共享层晋级：只允许方法论类（lesson/knowledge），必须带证据，路径脱敏。 */
export function promoteToShared(projectDir, id, evidence) {
  const snap = load(projectDir)
  const e = snap.docs.get(String(id || ''))
  if (!e) return { ok: false, error: '条目不存在' }
  if (!['lesson', 'knowledge'].includes(e.kind)) return { ok: false, error: '只有 lesson/knowledge（方法论类）可晋级共享层' }
  const ev = norm(evidence)
  if (ev.length < 20) return { ok: false, error: '晋级需要 ≥20 字证据（来自哪个任务的实测/复验）' }
  const sanitize = (t) => t.replace(/[A-Za-z]:?[\\/][^\s，。；;）)]*/g, '<path>').replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
  const body = sanitize(e.body).slice(0, 2000)
  const out = addEntry(projectDir, {
    lane: 'shared', kind: 'knowledge', title: e.title, body,
    tags: ['shared', 'promoted', e.kind], confidence: 'provisional',
    source: { type: 'promotion', ref: id + ' | evidence: ' + ev.slice(0, 200) },
  })
  return { ok: true, entry: out }
}

/** 从工作区现有资产增量入库（幂等）：project.md/lessons.md/board.json/docs 标题/团队任务产出。
 *  纯 Node、跨平台；重复运行不会重复写（同 key 同正文跳过，正文变化 append 新版本）。 */
export function ingestSources(projectDir, opts = {}) {
  const base = path.join(String(projectDir || ''), '.jarvis')
  const lane = path.basename(String(projectDir || ''))
  const items = []
  const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
  const put = (kind, title, body, tags, ref) => { if (title && body) items.push({ lane, kind, title: String(title).slice(0, 120), body: String(body).slice(0, 1500), tags, source: { type: 'ingest', ref } }) }
  const pm = read(path.join(base, 'project.md'))
  for (const sec of pm.split(/\n(?=#+ )/).slice(0, 40)) {
    const lines = sec.split('\n').filter((x) => x.trim())
    if (!lines.length) continue
    put('fact', lines[0].replace(/^#+\s*/, ''), lines.slice(0, 8).join('\n'), ['project'], 'project.md')
  }
  const lm = read(path.join(base, 'lessons.md'))
  for (const block of lm.split(/\n(?=[-*#]|\d+\.)/).slice(0, 80)) {
    const b = block.trim()
    if (b.length < 20) continue
    put('lesson', b.split('\n')[0].slice(0, 100), b, ['lesson'], 'lessons.md')
  }
  try {
    const bd = JSON.parse(read(path.join(base, 'board.json')))
    for (const it of (bd.items || []).slice(0, 200)) {
      const c = norm(it.content)
      if (c) put(it.type === '决策' ? 'decision' : 'fact', c.slice(0, 100), c, ['board', String(it.type || '')], 'board#' + String(it.id || ''))
      if (/用户(要求|强调|明示|确认|说|希望|要求是|明确)/.test(c)) put('profile', '用户意图：' + c.slice(0, 70), c, ['intent', 'profile'], 'board#' + String(it.id || ''))
      const ans = norm(it.userAnswer || it.answer || '')
      if (c && ans) put('decision', '用户决策：' + c.slice(0, 80), '问题：' + c + '\n用户答复：' + ans, ['user-answer', 'decision'], 'board#' + String(it.id || ''))
    }
  } catch { /* 黑板坏数据跳过 */ }
  try {
    const md = path.join(base, 'meetings')
    for (const f of fs.readdirSync(md).filter((n) => n.endsWith('.json')).slice(0, 60)) {
      let mm = null
      try { mm = JSON.parse(read(path.join(md, f))) } catch { continue }
      const concl = norm(mm.conclusion || (mm.resolutions || []).join('；'))
      if (concl) put('decision', '会议结论：' + String(mm.topic || f).slice(0, 60), concl, ['meeting', String(mm.type || '')], 'meetings/' + f)
      for (const d of (mm.disputes || []).slice(0, 5)) {
        const t = norm(typeof d === 'string' ? d : (d && d.issue) || '')
        if (t) put('lesson', '会议分歧：' + t.slice(0, 60), t, ['meeting', 'dispute'], 'meetings/' + f)
      }
    }
  } catch { /* 无会议纪要 */ }
  try {
    const dd = path.join(base, 'docs')
    for (const f of fs.readdirSync(dd).filter((n) => n.endsWith('.md')).slice(0, 60)) {
      const txt = read(path.join(dd, f))
      const title = (txt.match(/^#\s+(.+)$/m) || [])[1] || f
      put('knowledge', title, txt.slice(0, 800), ['doc'], 'docs/' + f)
    }
  } catch { /* 无 docs */ }
  try {
    const td = path.join(String(projectDir || ''), '.agent-teams')
    for (const name of fs.readdirSync(td).slice(0, 60)) {
      let tj = null
      try { tj = JSON.parse(read(path.join(td, name, 'team.json'))) } catch { continue }
      for (const t of (tj.tasks || [])) {
        const out = norm(t.output || '')
        if (out.length < 30) continue
        const ts = Number(t.updatedAt || t.completedAt || 0)
        if (ts && Date.now() - ts > 30 * 86400000) continue
        const status = String(t.status || '')
        put(status === 'failed' || status === 'cancelled' ? 'lesson' : 'artifact', String(t.subject || '').slice(0, 100), out.slice(0, 1200), ['task', status, String(t.assignee || '')], 'team#' + String(t.id || ''))
      }
    }
  } catch { /* 无团队 */ }
  return addEntriesBulk(projectDir, items)
}

/** 最近条目（按 updated_at 倒序；UI/看板用）。 */
export function listRecent(projectDir, opts = {}) {
  const snap = load(projectDir)
  const k = Math.max(1, Math.min(120, Number(opts.k) || 10))
  const lane = opts.lane ? String(opts.lane) : ''
  const out = []
  for (const e of snap.docs.values()) {
    if (lane && !(e.lane === lane || e.lane === 'shared')) continue
    out.push(e)
  }
  out.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
  return out.slice(0, k).map((e) => ({ id: e.id, lane: e.lane, kind: e.kind, title: e.title, snippet: String(e.body || '').slice(0, 200), confidence: e.confidence, disputed: Boolean(e.disputed), updated_at: e.updated_at }))
}

/** 冲突裁决：把同主题冲突条目标记失效，并写一条裁决结论（append-only 版本覆盖）。 */
export function resolveConflict(projectDir, id, resolution) {
  const snap = load(projectDir)
  const e = snap.docs.get(String(id || ''))
  if (!e) return { ok: false, error: '条目不存在' }
  const res = norm(resolution)
  if (res.length < 10) return { ok: false, error: '裁决需要 ≥10 字理由/结论' }
  // 失效旧条目（同 id 追加新版本：valid_to 置位）
  addEntry(projectDir, { ...e, valid_to: nowMs(), disputed: false, source: { type: 'resolve', ref: String(id) } })
  const out = addEntry(projectDir, {
    lane: e.lane === 'shared' ? 'shared' : (e.lane || path.basename(projectDir)),
    kind: 'decision', title: '裁决：' + norm(e.title).slice(0, 60),
    body: '冲突条目：' + norm(e.title) + '\n裁决：' + res,
    tags: ['resolved', 'decision'], confidence: 'confirmed',
    source: { type: 'resolve', ref: String(id) },
  })
  return { ok: true, entry: out, invalidated: id }
}

/** 老板视角摘要（决策/风险/冲突/交付）：不是列条目，而是回答"老板该知道什么"。
 *  - 决策：已定的事（谁定的、影响什么）
 *  - 风险：可能坏事的事（失败/阻塞/坑）
 *  - 冲突：两条结论打架（需要拍板）
 *  - 交付：做完并有证据的结果
 */
export function digest(projectDir, opts = {}) {
  const snap = load(projectDir)
  const k = Math.max(1, Math.min(10, Number(opts.k) || 3))
  const roleOf = (e) => {
    const t = (e.title || '') + ' ' + (e.tags || []).join(' ')
    if (/架构|设计|选型|技术方案/.test(t)) return '架构'
    if (/产品|需求|范围|优先级|验收/.test(t)) return '产品'
    if (/测试|验证|缺陷|回归/.test(t)) return '测试'
    if (/交付|发布|上线|安装/.test(t)) return '交付'
    return '团队'
  }
  const pick = []
  for (const e of snap.docs.values()) {
    if (e.valid_to) continue
    pick.push(e)
  }
  const byTime = (a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0)
  // 过滤"章节名"式泛标题（老板要看的是具体结论，不是目录）
  const generic = (e) => /^(下一步|未决项|团队清单|当前进度|关键决策与依据|进展|状态|进度|概览|说明|目录)$/.test(norm(e.title)) || norm(e.title).length < 5
  const decisions = pick.filter((e) => (e.kind !== 'profile') && ((e.kind === 'decision') || /决策|定稿|确认|选择|采纳|结论|拍板/.test(e.title + ' ' + (e.tags || []).join(' '))) && !generic(e)).sort(byTime).slice(0, k).map((e) => ({ title: e.title, role: roleOf(e), at: e.updated_at, lane: e.lane }))
  const risks = pick.filter((e) => (e.kind !== 'profile') && ((e.kind === 'lesson') || /风险|阻塞|失败|坑|缺陷|回滚/.test(e.title + ' ' + (e.tags || []).join(' '))) && !generic(e)).sort(byTime).slice(0, k).map((e) => ({ title: e.title, role: roleOf(e), at: e.updated_at, lane: e.lane }))
  const conflicts = pick.filter((e) => Boolean(e.disputed) && !generic(e) && ['decision', 'lesson', 'knowledge'].includes(e.kind)).sort(byTime).slice(0, k).map((e) => ({ id: e.id, title: e.title, lane: e.lane, at: e.updated_at }))
  const deliverables = pick.filter((e) => (e.kind !== 'profile') && ((e.kind === 'artifact') || /交付|报告|完成|通过|验收/.test(e.title + ' ' + (e.tags || []).join(' '))) && !generic(e)).sort(byTime).slice(0, k).map((e) => ({ title: e.title, role: roleOf(e), at: e.updated_at, lane: e.lane }))
  return {
    counts: { decisions: decisions.length, risks: risks.length, conflicts: conflicts.length, deliverables: deliverables.length, entries: snap.docs.size },
    decisions, risks, conflicts, deliverables,
    headline: (decisions[0] && ('已定：' + decisions[0].title)) || (risks[0] && ('待处理：' + risks[0].title)) || '暂无需要老板关注的事项',
  }
}

/** 索引统计（自检/看板用）。 */
export function stats(projectDir) {
  const snap = load(projectDir)
  return { entries: snap.docs.size, lines: snap.lines, badLines: snap.badLines, mtimeMs: snap.mtime, dir: snap.dir }
}

/** 重建索引（纯内存，无持久副作用；供工具 rebuild 动作语义使用）。 */
export function rebuild(projectDir) {
  CACHE.delete(memDir(projectDir))
  return stats(projectDir)
}
