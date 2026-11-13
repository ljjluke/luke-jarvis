/** jarvis 知识库（记忆流水线 ③入库 + ④衰减）。
 *
 *  设计目标（用户明确要求）：
 *   · 「知识库形式，不要越积压越多」→ 内容指纹去重，重复即强化，不新增条目
 *   · 「人脑式遗忘衰减」→ 强度 = 引用次数 + 最近使用 + 客观结果；低强度淡出
 *   · 「按领域隔离」→ 多领域标签（带权重），不是单选（避免电商经验分裂成多库）
 *   · 「思考的时候提取」→ 按领域+强度排序，供检索层使用
 *
 *  存储：<workspace>/.jarvis/mind/<domain>.jsonl（每行一条，append-only；压缩后仍可读）
 *  每条记录：
 *    { id, fp, domains:[...], kind:"lesson|preference|domain|fact",
 *      text, evidence, strength, refs, lastUsed, createdAt, pinned }
 *
 *  强度衰减（人脑式）：
 *    · 每次被引用 → refs+1、lastUsed 更新、strength 上升
 *    · 时间流逝 → 强度按天衰减
 *    · pinned（红线/合规/致命坑）→ 衰减速度 1/10，永不归零
 *    · 低于阈值的条目进入淡出区（不删除，只是检索时排在最后）
 */
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)
const fs = () => _require('node:fs')
const pathMod = () => _require('node:path')

const MIND_DIR = (projectDir) => pathMod().join(String(projectDir || ''), '.jarvis', 'mind')
const FADE_THRESHOLD = 0.15        // 低于此强度 → 淡出（检索排序靠后）
const DECAY_PER_DAY = 0.035        // 每天自然衰减比例
const PINNED_DECAY_FACTOR = 0.1    // 红线条目衰减速度 1/10
const MAX_TEXT = 400

/** 内容指纹：规范化后取哈希。用于「同一教训不同措辞」的去重。
 *  做法：去标点、去空白、转小写、按字符集排序后哈希——
 *  对「顺序不同但内容相同」也能识别（如「先备份再改」vs「改之前先备份」）。 */
function fingerprint(text) {
  const norm = String(text || '')
    .toLowerCase()
    .replace(/[^\w一-龥]/g, '')
  // 中文无序集：字符排序后哈希，容忍语序差异
  const chars = [...new Set(norm.split(''))].sort().join('')
  return hash(chars)
}
function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return 'fp' + h.toString(36)
}

function safeDomain(d) {
  const s = String(d || 'common').trim().toLowerCase().replace(/[^\w一-龥-]/g, '_').slice(0, 40)
  return s || 'common'
}

function readEntries(projectDir) {
  const dir = MIND_DIR(projectDir)
  const out = []
  try {
    for (const n of fs().readdirSync(dir)) {
      if (!n.endsWith('.jsonl')) continue
      try {
        const lines = fs().readFileSync(pathMod().join(dir, n), 'utf8').split('\n').filter(Boolean)
        for (const l of lines) {
          try { const e = JSON.parse(l); if (e && e.id) out.push(e) } catch { /* 坏行跳过 */ }
        }
      } catch { /* 单文件跳过 */ }
    }
  } catch { return [] }
  return out
}

function appendEntry(projectDir, domain, entry) {
  const dir = MIND_DIR(projectDir)
  fs().mkdirSync(dir, { recursive: true })
  fs().appendFileSync(pathMod().join(dir, safeDomain(domain) + '.jsonl'), JSON.stringify(entry) + '\n')
}

/** 计算当前强度（含时间衰减，不写回磁盘——读取时实时算）。 */
function currentStrength(e, now = Date.now()) {
  const base = Number(e.strength || 0) || 1
  const last = Number(e.lastUsed || 0) || Date.parse(e.createdAt || '') || now
  const days = Math.max(0, (now - last) / 86400000)
  const factor = e.pinned ? PINNED_DECAY_FACTOR : 1
  // 指数衰减，但不去零（保留最小 1% 以便重新被发现）
  const s = base * Math.exp(-DECAY_PER_DAY * days * factor)
  return Math.max(e.pinned ? 0.5 : 0.01, s)
}

/**
 * 写入一条知识（**去重即强化**）。
 * @param {string} projectDir 工作区
 * @param {object} item {text, domains:[], kind, evidence, pinned}
 * @returns {{action:'created'|'reinforced', id, strength}}
 */
export function remember(projectDir, item) {
  const text = String((item && item.text) || '').trim().slice(0, MAX_TEXT)
  if (!text) return { action: 'skipped', reason: '空内容' }
  const fp = fingerprint(text)
  const now = Date.now()
  const existing = readEntries(projectDir).find((e) => e.fp === fp)
  if (existing) {
    // 已存在同内容 → 强化，不新增（这是「别越积压越多」的核心）
    const bumped = {
      id: existing.id,
      refs: Number(existing.refs || 1) + 1,
      strength: Math.min(10, (Number(existing.strength) || 1) * 1.15),
      lastUsed: now,
    }
    appendEntry(projectDir, (existing.domains || ['common'])[0], { id: existing.id, fp, patch: true, ...bumped })
    return { action: 'reinforced', id: existing.id, strength: bumped.strength }
  }
  const domains = (Array.isArray(item.domains) && item.domains.length ? item.domains : ['common']).map(safeDomain)
  const entry = {
    id: 'mem-' + Math.random().toString(36).slice(2, 9),
    fp,
    domains,
    kind: ['lesson', 'preference', 'domain', 'fact'].includes(item.kind) ? item.kind : 'lesson',
    text,
    evidence: String(item.evidence || '').slice(0, 200),
    strength: 1,
    refs: 1,
    lastUsed: now,
    createdAt: new Date(now).toISOString(),
    pinned: Boolean(item.pinned),
  }
  appendEntry(projectDir, domains[0], entry)
  return { action: 'created', id: entry.id, strength: 1 }
}

/** 记录一次「被使用」（引用计数 + 强度回升）。用于检索后回写。 */
export function markUsed(projectDir, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!list.length) return 0
  const now = Date.now()
  const byId = new Map(readEntries(projectDir).map((e) => [e.id, e]))
  let n = 0
  for (const id of list) {
    const e = byId.get(id)
    if (!e) continue
    appendEntry(projectDir, (e.domains || ['common'])[0], {
      id: e.id, fp: e.fp, patch: true,
      refs: Number(e.refs || 1) + 1,
      strength: Math.min(10, (Number(e.strength) || 1) * 1.1),
      lastUsed: now,
    })
    n++
  }
  return n
}

/** 合并同 id 的多行（append-only 后每条取最后状态）。 */
function materialize(projectDir) {
  const map = new Map()
  for (const e of readEntries(projectDir)) {
    const prev = map.get(e.id) || {}
    map.set(e.id, { ...prev, ...e })
  }
  return [...map.values()].filter((e) => e.text)   // patch 行没有 text，靠合并得到
}

/**
 * 检索：领域初筛 → 强度排序 → 返回 top-N。
 * 领域匹配：主领域精确匹配的排前；多标签含该领域的次之；通用(common)最后兜底。
 */
export function recall(projectDir, { domains = [], limit = 8, includeFaded = false } = {}) {
  const now = Date.now()
  const wanted = new Set(domains.map(safeDomain))
  const all = materialize(projectDir).map((e) => ({ ...e, _s: currentStrength(e, now) }))
  const scored = all.map((e) => {
    const ds = e.domains || ['common']
    let rel = 0
    if (wanted.size) {
      if (ds.some((d) => wanted.has(d))) rel = 1
      else if (ds.includes('common')) rel = 0.5
      else rel = 0.15   // 其他领域：仍可被检索（跨领域规律有价值），但排后
    } else rel = 0.7
    return { e, score: rel * e._s }
  })
  scored.sort((a, b) => b.score - a.score)
  const picked = scored
    .filter((x) => includeFaded || x.e._s >= FADE_THRESHOLD || x.e.pinned)
    .slice(0, limit)
  return picked.map((x) => ({ ...x.e, score: Number(x.score.toFixed(3)), strength: Number(x.e._s.toFixed(2)) }))
}

/** 生成「领域摘要」——常驻 systemPrompt 的极短版（控制上下文成本）。 */
export function domainDigest(projectDir, { domains = [], max = 3 } = {}) {
  const list = recall(projectDir, { domains, limit: max })
  if (!list.length) return ''
  return list.map((e) => `- [${e.kind}${e.pinned ? '·红线' : ''}] ${e.text.slice(0, 90)}`).join('\n')
}

/** 统计（供自检与界面展示）。 */
export function mindStats(projectDir) {
  const all = materialize(projectDir)
  const now = Date.now()
  const faded = all.filter((e) => currentStrength(e, now) < FADE_THRESHOLD && !e.pinned).length
  return { total: all.length, faded, pinned: all.filter((e) => e.pinned).length }
}

/** 知识库体检：用真实数据判断「记忆系统是否在用起来」。
 *
 *  为什么需要它：语义检索、衰减调参这些优化，只有在「有真实数据」时才有意义。
 *  这个体检回答三个更前置的问题：
 *    ① 库里到底有没有东西？（写入是否发生）
 *    ② 有多少条从没被引用过？（recall 是否在生效）
 *    ③ 有没有近义重复？（是否真的需要语义合并）
 *  判据全部机器可算，不依赖模型。
 */
export function mindAudit(projectDir) {
  const all = materialize(projectDir)
  const now = Date.now()
  const stats = mindStats(projectDir)
  if (!all.length) {
    return { ...stats, health: 'empty', verdict: '知识库是空的——说明「巩固」还没发生。优先让人真的沉淀，而不是优化检索算法。' }
  }
  // ① 从没被引用 = refs 停在初始值 1（remember 时记的）
  const neverUsed = all.filter((e) => Number(e.refs || 1) <= 1)
  // ② 近义候选：两条文本的字符集重合率 ≥ 0.85（同义不同词的粗筛，供人工判断）
  const nearDup = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = charSet(all[i].text), b = charSet(all[j].text)
      if (!a.size || !b.size) continue
      let common = 0
      for (const c of a) if (b.has(c)) common++
      const ratio = common / Math.min(a.size, b.size)
      if (ratio >= 0.85) nearDup.push({ a: all[i].text.slice(0, 40), b: all[j].text.slice(0, 40), ratio: Number(ratio.toFixed(2)) })
    }
  }
  // ③ 分布：类型 / 领域
  const kinds = {}, domains = {}
  for (const e of all) {
    kinds[e.kind || 'lesson'] = (kinds[e.kind || 'lesson'] || 0) + 1
    for (const d of e.domains || ['common']) domains[d] = (domains[d] || 0) + 1
  }
  const usageRatio = all.length ? (all.length - neverUsed.length) / all.length : 0
  let health = 'healthy', advice = ''
  if (usageRatio < 0.2) {
    health = 'unused'
    advice = `仅 ${Math.round(usageRatio * 100)}% 的条目被引用过——真问题不是检索算法，是 recall 没被调用。先让模型在每个任务开工前真的调 jarvis_recall。`
  } else if (nearDup.length > all.length * 0.3) {
    health = 'redundant'
    advice = `近义重复占 ${Math.round(nearDup.length / all.length * 100)}%——这时语义合并才有价值。但现在仍建议人工确认后手动合并，不要自动。`
  } else if (stats.faded > all.length * 0.5) {
    health = 'fading'
    advice = '淡出条目过半——衰减可能过激，或这批经验确实没再用上。检查是否需要标红线或调低衰减率。'
  } else {
    advice = '知识库在正常使用：写入在发生、条目在被引用、重复率低。无需优化。'
  }
  return {
    ...stats, health, usageRatio: Number(usageRatio.toFixed(2)), neverUsed: neverUsed.length,
    nearDuplicates: nearDup.slice(0, 10), nearDupCount: nearDup.length,
    kinds, domains, verdict: advice,
  }
}

function charSet(text) {
  return new Set(String(text || '').toLowerCase().replace(/[^\w一-龥]/g, '').split(''))
}

/** 压缩：把 append-only 的多行合并成单行（低频调用，防文件无限增长）。 */
export function compactMind(projectDir) {
  try {
    const dir = MIND_DIR(projectDir)
    if (!fs().existsSync(dir)) return { compacted: 0 }
    const byDomain = new Map()
    for (const e of materialize(projectDir)) {
      const d = (e.domains || ['common'])[0]
      if (!byDomain.has(d)) byDomain.set(d, [])
      byDomain.get(d).push(e)
    }
    let compacted = 0
    for (const [d, list] of byDomain) {
      if (list.length < 200) continue   // 小规模不压缩
      const file = pathMod().join(dir, safeDomain(d) + '.jsonl')
      const tmp = `${file}.tmp-${process.pid}`
      fs().writeFileSync(tmp, list.map((e) => JSON.stringify(e)).join('\n') + '\n')
      fs().renameSync(tmp, file)
      compacted++
    }
    return { compacted }
  } catch { return { compacted: 0 } }
}

/* ── ① 机器候选池 ──────────────────────────────────────────────────────
   作用：不依赖模型自觉，从任务汇报里机器抽取「可能是经验」的候选，
         放进候选池（.jarvis/mind/_candidates.jsonl），**不直接入主库**。
   为什么单独一层：机器抽取一定会带噪音（「完成了需求文档」这种无信息量），
         直接入库会污染检索。候选池过质量门（结构完整 + 可复用）后才升级。
   质量门判据（纯机器可判，不依赖模型）：
     · 含因果/条件结构（因为/所以/当…时/否则/导致/避免）
     · 或含明确的负面/正面信号（坑/失败/踩/教训/有效/有用/注意）
     · 且长度 ≥ 15 字（太短没有信息量）
   达到 2 条以上信号 → 自动升级为正式条目；否则留在候选池等待人工/模型确认。
 */
const CAND_FILE = '_candidates.jsonl'
const CAND_HINTS = {
  causal: /因为|所以|由于|导致|避免|否则|当[^，。]{0,20}时|之后才|才能/,
  lesson: /坑|失败|踩|教训|注意|小心|别再|下次要|千万/,
  value: /有效|有用|奏效|提升|节省|减少|改善/,
}

function appendCandidate(projectDir, cand) {
  const dir = MIND_DIR(projectDir)
  fs().mkdirSync(dir, { recursive: true })
  fs().appendFileSync(pathMod().join(dir, CAND_FILE), JSON.stringify(cand) + '\n')
}

function readCandidates(projectDir) {
  try {
    const file = pathMod().join(MIND_DIR(projectDir), CAND_FILE)
    const raw = fs().readFileSync(file, 'utf8').split('\n').filter(Boolean)
    // append-only：同一 id 多行取最后状态（否则转正后会重复计数）
    const map = new Map()
    for (const l of raw) {
      try {
        const c = JSON.parse(l)
        if (!c || !c.id) continue
        const prev = map.get(c.id) || {}
        map.set(c.id, { ...prev, ...c })
      } catch { /* 坏行跳过 */ }
    }
    return [...map.values()]
  } catch { return [] }
}

/** 从一次任务汇报里抽候选（机器行为，无模型成本）。 */
export function harvestFromReport(projectDir, { ticketId, title, summary, role } = {}) {
  const text = String(summary || '').replace(/\s+/g, ' ').trim()
  if (!text || text.length < 15) return { added: 0 }
  // 只有像经验的才进候选池（纯状态汇报如「已完成」不入池）
  let hits = 0
  for (const re of Object.values(CAND_HINTS)) if (re.test(text)) hits++
  if (hits < 1) return { added: 0, reason: '无经验信号' }
  const cand = {
    id: 'cand-' + Math.random().toString(36).slice(2, 9),
    ticketId: String(ticketId || ''), title: String(title || '').slice(0, 80),
    text: text.slice(0, MAX_TEXT), role: String(role || ''),
    hits, at: new Date().toISOString(), promoted: false,
  }
  appendCandidate(projectDir, cand)
  return { added: 1, hits }
}

/** 候选池升级：信号足够的自动转正（仍走 remember 去重）。 */
export function promoteCandidates(projectDir, { domains = [], minHits = 2 } = {}) {
  const cands = readCandidates(projectDir).filter((c) => !c.promoted && Number(c.hits || 0) >= minHits)
  let promoted = 0
  for (const c of cands) {
    const r = remember(projectDir, { text: c.text, kind: 'lesson', domains, evidence: `任务 ${c.ticketId || '?'}（${c.title}）` })
    if (r.action === 'created' || r.action === 'reinforced') {
      appendCandidate(projectDir, { id: c.id, promoted: true })
      promoted++
    }
  }
  return { promoted, pending: readCandidates(projectDir).filter((c) => !c.promoted).length }
}

/** 候选池统计（供界面/自检）。 */
export function candidateStats(projectDir) {
  const list = readCandidates(projectDir)
  return { total: list.length, pending: list.filter((c) => !c.promoted).length }
}
