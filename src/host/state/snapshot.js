/** 插件状态的**单一快照**（UI 契约 v1 的实现：任何增强 UI 只依赖这一个形状）。

 *  背景：用户要后期给 jarvis 接增强 UI。UI 不该去猜文件布局，也不该为每个面板各调一个接口——
 *  插件对外只暴露三样东西：① 快照（本文件）② 事件 ③ 受控命令（工具）。
 *  快照原则：
 *   - 只读聚合（从磁盘事实算，不写盘、不带副作用）；
 *   - 带 `schema` 版本（`jarvis.snapshot/1`）：UI 只认版本，插件内部结构随便改；
 *   - 全部字段可缺省（UI 按字段存在与否渲染，不假设一定有数据）；
 *   - 每个面板都有稳定的 id（stage/tasks/board/meetings/company/cards/memory/gates/artifacts）。
 */
import { createRequire } from 'node:module'
import { computeStage, JARVIS_STAGES, STAGE_LABELS } from '../gates/stage.js'
import { meetingPolicy } from './meetings.js'
import { CARD_SECTIONS } from './cards.js'
import { gcSummary } from '../tools/gc.js'

const _require = createRequire(import.meta.url)

export const SNAPSHOT_SCHEMA = 'jarvis.snapshot/1'

function readJsonSafe(dir, rel, fs, path) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'))
  } catch {
    return null
  }
}

function listCards(projectDir, fs, path) {
  const out = []
  const dir = path.join(projectDir, '.jarvis/cards')
  let names = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.md'))
  } catch {
    return out
  }
  for (const n of names) {
    let ok = false
    let missing = CARD_SECTIONS.slice()
    try {
      const text = fs.readFileSync(path.join(dir, n), 'utf8')
      missing = CARD_SECTIONS.filter((s) => !text.includes(s))
      ok = missing.length === 0
    } catch {
      /* 读不到就当结构不全 */
    }
    out.push({ role: n.replace(/\.md$/, ''), path: '.jarvis/cards/' + n, ok, missing })
  }
  return out
}

function listTeams(projectDir, fs, path) {
  const td = path.join(projectDir, '.agent-teams')
  const teams = []
  let names = []
  try {
    names = fs.readdirSync(td).filter((n) => !/^(archived?|_archive|\.)|-archive$/i.test(n))
  } catch {
    return { teams, open: 0, completed: 0 }
  }
  const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'dropped'])
  let open = 0
  let completed = 0
  for (const name of names) {
    const d = readJsonSafe(td, path.join(name, 'team.json'), fs, path)
    if (!d) continue
    const tasks = (d.tasks || []).map((t) => ({
      id: String(t.id ?? ''),
      subject: String(t.subject ?? ''),
      status: String(t.status ?? ''),
      assignee: String(t.assignee ?? ''),
      attempt: Number(t.attempt || 0),
    }))
    for (const t of tasks) (TERMINAL.has(t.status) ? completed++ : open++)
    const shortRole = (raw) => {
      const t = String(raw || '').trim()
      if (!t) return ''
      if (t.length <= 30) return t
      const colon = t.search(/[：:]/)
      const firstLine = t.split('\n')[0]
      if (colon >= 0) {
        const after = firstLine.slice(colon + 1).split(/[。；;，,]/)[0].trim()
        if (after) return after.slice(0, 24)
      }
      return firstLine.slice(0, 24)
    }
    const members = (Array.isArray(d.members) ? d.members : []).map((m) => ({
      name: String((m && m.name) || ''),
      role: shortRole((m && m.role) || '') || String((m && m.name) || ''),
      provider: String((m && m.provider) || ''),
      model: String((m && m.model) || ''),
    })).filter((m) => m.name || m.role)
    let mtime = 0
    try { mtime = fs.statSync(path.join(td, name, 'team.json')).mtimeMs } catch {}
    teams.push({
      name: String(name),
      description: String(d.description || ''),
      captainSessionId: d.captainSessionId || '',
      members,
      tasks,
      mtime,
    })
  }
  let activeNames = []
  try {
    const a = readJsonSafe(projectDir, '.jarvis/active-team.json', fs, path)
    if (a && Array.isArray(a.teams)) activeNames = a.teams.map(String)
  } catch {}
  teams.sort((x, y) => (y.mtime || 0) - (x.mtime || 0))
  const marked = teams.map((t) => ({ ...t, active: activeNames.includes(t.name) }))
  return { teams: marked, open, completed, activeTeams: activeNames }
}

/** 转录解析缓存：(文件路径|mtime|size) → digest。append-only 转录按此键失效即可。 */
const _DIGEST_CACHE = new Map()

/**
 * 从一段解压后的会话转录（JSONL 文本）里提取「它在做什么」。
 *
 * 逐行扫描，只保留需要的少量信息，避免把整份转录留在内存：
 *   · 第一行            → meta（cwd/parentSession/origin/createdAt）
 *   · subagent/descriptor → label（任务标题）、agentModel
 *   · assistant/message   → 最后一条非空文本，截断 240 字
 *   · tool/call           → 最近一次工具名
 *   · step/end            → 计数（近似"做了多少步"）
 *   · 任意事件带 time     → 最后一次活动时间
 *
 * 任何一行解析失败都跳过该行，绝不抛出：快照是 UI 的命脉，
 * 一条坏数据不该让整个面板空白。
 */
function sessionDigest(text) {
  const out = { meta: null, label: '', model: '', lastText: '', lastTool: '', steps: 0, lastAt: 0 }
  const lines = String(text || '').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    if (!raw) continue
    let e = null
    try { e = JSON.parse(raw) } catch { continue }
    if (!e || typeof e !== 'object') continue
    const type = String(e.type || '')
    const at = Number(e.time || 0)
    if (at > out.lastAt) out.lastAt = at
    if (type === 'session' && !out.meta) { out.meta = e; continue }
    if (type === 'subagent/descriptor') {
      const d = e.data || {}
      if (!out.label && d.label) out.label = String(d.label)
      if (!out.model && d.agentModel) out.model = String(d.agentModel)
      continue
    }
    if (type === 'assistant/message') {
      const parts = ((e.data || {}).message || {}).content || []
      const body = Array.isArray(parts)
        ? parts.filter((p) => p && p.type === 'text').map((p) => String(p.text || '')).join(' ').trim()
        : ''
      if (body) out.lastText = body.slice(0, 240)
      continue
    }
    if (type === 'tool/call') {
      const name = String((e.data || {}).name || '')
      if (name) out.lastTool = name
      continue
    }
    if (type === 'step/end') out.steps += 1
  }
  return out
}

/** DSH 原生子会话扫描（UI 可见性兜底）。
 *
 *  问题（2026-11-16 实证）：用户在 DSH 会话里直接用原生 subagent 工具开子 agent，
 *  完全绕过 jarvis 任务单系统（无 ticket / 无 .agent-teams / 无 events），
 *  增强 UI 查 snap.tickets/tasks/events 全是空 → 显示空白，而实际有活在跑。
 *
 *  这里做的：扫 DSH 的会话目录，找出 origin=subagent 的会话，
 *  标注「是否已纳入 jarvis 任务单」，让 UI 至少能说清「有什么在跑、哪些绕过了流程」。
 *  只读 .zstd 的第一行（会话头，含 cwd/parentSession/origin），不读全文（省 IO）。
 */
function dshSubagents(dir, fs, path) {
  const out = { total: 0, tracked: 0, untracked: 0, items: [] }
  try {
    const home = String(process.env.HOME || process.env.USERPROFILE || '/root')
    const sroot = path.join(home, '.dsh', 'sessions')
    if (!fs.existsSync(sroot)) return out
    // DSH 会话目录按 cwd 命名：把路径里的 / 换成 -，前后加 --（如 --opt-work-luke-jarvis--）。
    // 注意：路径本身可能含横线（luke-jarvis），所以只能正向比对「路径→横线形式」，
    // 不能反向把横线还原成斜杠（会得到 opt/work/luke/jarvis，永远匹配不上）。
    const norm = (s) => String(s || '').replace(/[\\/]+/g, '-').replace(/^[-]+|[-]+$/g, '').toLowerCase()
    const targetNorm = norm(dir)
    const candidates = []
    try {
      for (const d of fs.readdirSync(sroot)) {
        if (d.startsWith('--') && d.endsWith('--') && norm(d.slice(2, -2)) === targetNorm) {
          candidates.push(path.join(sroot, d))
        }
      }
    } catch { /* 读不到会话根 */ }
    for (const cdir of candidates) {
      let names = []
      try { names = fs.readdirSync(cdir) } catch { continue }
      for (const n of names) {
        if (/^session-/.test(n)) continue            // 主会话不算
        const f = path.join(cdir, n, 'session.v4.jsonl.zstd')
        if (!fs.existsSync(f)) continue
        // ⚠️ 必须用 zstdcat 而不是 zlib.zstdDecompressSync：
        //    DSH 转录是**多帧 zstd 追加写**（实测单文件 282 个帧魔数），
        //    zstdDecompressSync 只解第一帧 → 只拿到 2 行会话头，
        //    后面的 descriptor/assistant/tool 全部读不到（这就是 UI 只知道
        //    「有几个会话在跑」却不知道「它们在做什么」的根因）。
        //    zstdcat 解全部帧（671 行），14 个会话合计约 13ms，成本可接受。
        // 结果按 (文件, mtime, size) 缓存——转录 append-only，没变就不重复解压。
        let meta = null
        let digest = null
        try {
          let st = null
          try { st = fs.statSync(f) } catch { st = null }
          const cacheKey = st ? `${f}|${st.mtimeMs}|${st.size}` : ''
          const hit = cacheKey && _DIGEST_CACHE.get(cacheKey)
          if (hit) { digest = hit }
          else {
            const cp = _require('node:child_process')
            const txt = cp.execSync(`zstdcat "${f}"`, {
              encoding: 'utf8', timeout: 8000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
            })
            digest = sessionDigest(txt)
            if (cacheKey) {
              if (_DIGEST_CACHE.size >= 200) _DIGEST_CACHE.clear()
              _DIGEST_CACHE.set(cacheKey, digest)
            }
          }
          meta = digest.meta
        } catch { continue }
        if (!meta || String(meta.origin || '') !== 'subagent') continue
        const sid = n
        out.total++
        // 是否已纳入 jarvis 任务单：exec-map 里登记过 = 是
        let tracked = false
        try {
          const mapFile = path.join(dir, '.jarvis', 'tickets', 'exec-map.json')
          if (fs.existsSync(mapFile)) {
            const mp = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
            tracked = Object.values(mp || {}).some((slot) => Object.values(slot || {}).some((info) => String(info && info.childId || '') === sid))
          }
        } catch { tracked = false }
        if (tracked) out.tracked++; else out.untracked++
        out.items.push({
          id: sid,
          cwd: String(meta.cwd || ''),
          parent: String(meta.parentSession || ''),
          createdAt: meta.createdAt ? new Date(Number(meta.createdAt)).toISOString() : '',
          tracked,
          // ── 真实工作内容（让 UI 显示「它在干什么」，而不是只有一个数量）──
          label: String(digest.label || ''),           // subagent/descriptor.label：任务标题
          model: String(digest.model || ''),           // agentModel
          lastText: String(digest.lastText || ''),     // 最后一条 assistant 文本（摘要 240 字）
          lastTool: String(digest.lastTool || ''),     // 最近一次 tool/call 的工具名
          steps: Number(digest.steps || 0),            // step/end 次数 ≈ 完成的推理步数
          lastActivityAt: digest.lastAt ? new Date(Number(digest.lastAt)).toISOString() : '',
        })
      }
    }
    // 最新的在前，最多 20 条（UI 不需要几千条）
    out.items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    out.items = out.items.slice(0, 20)
  } catch { /* 扫描失败不影响主快照 */ }
  return out
}

function boardSummary(projectDir, fs, path) {
  const d = readJsonSafe(projectDir, '.jarvis/board.json', fs, path)
  const items = (d && Array.isArray(d.items) ? d.items : []).map((i) => ({
    id: String(i.id ?? ''),
    type: String(i.type ?? ''),
    content: String(i.content ?? ''),
    status: String(i.status ?? 'open'),
    answerNeeded: i.answerNeeded || undefined,
    essenceChecked: Boolean(i.essenceChecked),
  }))
  const open = items.filter((i) => i.status === 'open')
  return {
    total: items.length,
    open,
    resolved: items.filter((i) => i.status === 'resolved'),
    blockers: open.filter((i) => i.type === '阻塞' || i.type === '接口变更'),
    needsUser: items.filter((i) => i.answerNeeded === 'needs_user'),
  }
}

function memorySummary(projectDir, fs, path) {
  const file = path.join(projectDir, '.jarvis/project.md')
  try {
    const st = fs.statSync(file)
    return { exists: true, updatedAt: new Date(st.mtimeMs).toISOString(), ageHours: Math.round((Date.now() - st.mtimeMs) / 36e5 * 10) / 10, stale: Date.now() - st.mtimeMs > 6 * 3600 * 1000 }
  } catch {
    return { exists: false, stale: true }
  }
}

/** 票据体系摘要（wings 主屏数据源——待办#6：从 team.json 切 tickets）：.jarvis/tickets/ticket-*.json + proposals.jsonl（成员自主找活提案）。只读。 */
/** E：验收状态归一。
 *  老板只关心「能不能验收」。原始数据里 ended.outcome 是无枚举的字符串、
 *  reportState 是 progress/waiting/ready/blocked/failed —— 两处都能推出部分信息。
 *  原则：判得出来才说，判不出来就 unknown（不猜、不美化）。
 *  返回：pending（待验收）/ passed（已验收）/ rejected（被打回）/ abandoned（已放弃）/ unknown
 */
function deriveAcceptance(ticket, asg) {
  const ended = ticket && ticket.ended
  const reportState = String((asg && asg.report && asg.report.state) || '').toLowerCase()
  const outcome = String((ended && ended.outcome) || '').toLowerCase()
  // ① 已结束：看 outcome 语义（无枚举，按关键词宽匹配）
  if (ended) {
    if (/fail|reject|abandon|drop|cancel|error/.test(outcome)) return 'abandoned'
    if (/ready|pass|accept|done|complete|success|ok/.test(outcome)) return 'passed'
    return 'unknown'                       // 结束了但看不出算不算通过
  }
  // ② 未结束：看最近汇报
  if (reportState === 'ready') return 'pending'   // 成员说做完了 → 待验收
  if (reportState === 'blocked' || reportState === 'failed') return 'blocked'
  if (reportState === 'progress' || reportState === 'waiting') return 'in_progress'
  return 'unknown'
}

/** A：交付物聚合层——把工作单按「项目/需求」聚合成老板能看懂的单位。
 *
 *  为什么需要：老板问「交了什么」，系统只答得出「T1 完成了、T2 完成了」= 苦劳清单。
 *  交付物 = 一个需求/一个项目，带完成率 + 验收状态 + 是否卡住。
 *
 *  聚合键：ticket.project（已验证字段存在）；为空则退回「本工作区」单一分组，
 *  仍能给出总完成率（不会退化成平铺列表）。
 */
function buildDeliverables(projectDir, tickets, path) {
  const all = (tickets && tickets.open || []).concat(tickets && tickets.done || [])
  if (!all.length) return []
  const groups = new Map()
  for (const t of all) {
    // 归属键：project 可以是需求名，也可以是路径（旧数据）。两者都要能聚合。
    const raw = String(t.project || '').trim()
    const key = raw || String(projectDir)
    if (!groups.has(key)) {
      // 显示名：像路径就用末段（/opt/work/xxx → xxx），否则原样（「拼团电商」直接用）
      const looksLikePath = /^[A-Za-z]:[\\/]|[\\/]/.test(raw)
      const name = raw
        ? (looksLikePath ? (path.basename(raw) || raw) : raw)
        : path.basename(String(projectDir))
      groups.set(key, { key, name, items: [] })
    }
    groups.get(key).items.push(t)
  }
  const out = []
  for (const g of groups.values()) {
    const items = g.items
    // 只算「真的完成」的：accepted = passed 或 pending（成员说做完了）都算交付到位？
    // 老板视角：passed 才算交付；pending 是「做了待你验收」；其余都不算。
    const passed = items.filter((x) => x.acceptance === 'passed').length
    const pending = items.filter((x) => x.acceptance === 'pending').length
    const blocked = items.filter((x) => x.acceptance === 'blocked' || x.ended === null && /fail/.test(String(x.state || ''))).length
    const abandoned = items.filter((x) => x.acceptance === 'abandoned').length
    const total = items.length
    const doneCount = passed + pending                    // 交付到位的（含待验收）
    const pct = total ? Math.round((doneCount / total) * 100) : 0
    // 是否全部收口：全部 passed 且无 open
    const allClosed = total > 0 && passed === total
    out.push({
      key: g.key,
      name: g.name,
      total,
      pct,
      passed,
      pending,
      blocked,
      abandoned,
      allClosed,
      // 老板要看的是「能不能交」——一句话结论
      verdict: allClosed ? 'delivered'
        : blocked > 0 ? 'blocked'
          : total === 0 ? 'empty'
            : 'in_progress',
      updatedAt: items.reduce((m, x) => (String(x.updatedAt || '') > m ? String(x.updatedAt) : m), ''),
      items: items.map((x) => ({ id: x.id, title: x.title, role: x.role, acceptance: x.acceptance, summary: x.summary })).slice(0, 30),
    })
  }
  // 有卡住的排前面（老板先看风险），然后按完成率低的排前
  out.sort((a, b) => {
    const rank = (x) => (x.verdict === 'blocked' ? 0 : x.allClosed ? 2 : 1)
    return rank(a) - rank(b) || a.pct - b.pct
  })
  return out
}

/** C：空白语义化——把「页面为什么空」变成机器可判的事实。
 *
 *  三种空白对老板意义完全不同，必须区分（否则他分不清「没事」和「出事」）：
 *    normal    还没派活 —— 正常，等需求
 *    misplaced 有活但在别的工作区 —— 异常，应提示切换
 *    offbook   活在别处跑（绕过任务单的原生子会话）—— 异常，应提示纳入
 *    noWorkspace 根本没解析到工作区 —— 异常，配置问题
 */
function deriveEmptyReason(dir, snapshotParts) {
  const { tickets, deliverables, dshSubagents, active } = snapshotParts
  const hasTickets = (tickets.open || []).length > 0 || (tickets.done || []).length > 0
  const hasDeliv = (deliverables || []).length > 0
  if (hasTickets || hasDeliv) return { kind: 'none', text: '' }
  if (!dir) return { kind: 'noWorkspace', text: '没有解析到工作区' }
  const offbook = Number((dshSubagents && dshSubagents.untracked) || 0)
  if (offbook > 0) {
    return {
      kind: 'offbook',
      text: `这个工作区没有任务单，但检测到 ${offbook} 个原生子会话在工作区里跑——它们绕过了任务单，所以没有进度和验收。`,
      count: offbook,
    }
  }
  if (!active) return { kind: 'normal', text: '还没有开始工作。给一个需求，我就安排团队开工。' }
  return { kind: 'normal', text: '当前没有进行中的任务。给一个需求，我就安排团队开工。' }
}

/** D：日报/周报聚合——按天把「做完的 / 卡住的 / 下一步」聚成一段人话。
 *
 *  为什么按天而不是按任务：老板问的是「今天干了什么」，不是「T3 的第三阶段做到哪了」。
 *  数据来源（聚合 + 提炼兜底）：
 *    ① 有 ticket 汇报 → 直接聚合 summary（最准）
 *    ② 没汇报 → 从事件流提炼（只取 完成/验收/阻塞 三类，翻译成业务语言）
 *  只保留最近 7 天（周报粒度），每天最多 8 条，避免变成流水账。
 */
function buildDailyReports(projectDir, tickets, fs, path) {
  const all = (tickets.open || []).concat(tickets.done || [])
  const days = new Map()                      // YYYY-MM-DD → {done:[],stuck:[],next:[]}
  const dayOf = (iso) => String(iso || '').slice(0, 10)
  for (const t of all) {
    const at = t.updatedAt || t.createdAt || ''
    const d = dayOf(at)
    if (!d) continue
    if (!days.has(d)) days.set(d, { date: d, done: [], stuck: [], next: [], total: 0 })
    const day = days.get(d)
    day.total++
    const brief = String(t.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (t.acceptance === 'passed' || t.acceptance === 'pending') {
      day.done.push({ title: String(t.title || '').slice(0, 80), note: brief, role: String(t.role || '') })
    } else if (t.acceptance === 'blocked' || t.acceptance === 'abandoned') {
      day.stuck.push({ title: String(t.title || '').slice(0, 80), note: brief })
    } else {
      day.next.push({ title: String(t.title || '').slice(0, 80), note: brief })
    }
  }
  // 提炼兜底：当天没有 ticket 汇报时，从事件流取 完成/阻塞 类
  let events = []
  try {
    const evFile = path.join(projectDir, '.jarvis', 'events.jsonl')
    if (fs.existsSync(evFile)) {
      events = fs.readFileSync(evFile, 'utf8').split('\n').filter(Boolean).slice(-200).map((l) => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean)
    }
  } catch { events = [] }
  for (const e of events) {
    const ty = String((e && e.type) || '')
    if (!/task\.completed|gate|board|gc\.collected|assignment\./.test(ty)) continue   // 只取有业务含义的
    const d = String((e && e.at) || '').slice(0, 10)
    if (!d) continue
    if (!days.has(d)) days.set(d, { date: d, done: [], stuck: [], next: [], total: 0 })
    const day = days.get(d)
    // 只在当天没有 ticket 数据时补（避免重复）
    if (day.total > 0) continue
    if (/task\.completed/.test(ty)) day.done.push({ title: '完成了一项任务', note: String((e.data && e.data.subject) || '').slice(0, 80), role: '' })
    else if (/board/.test(ty)) day.next.push({ title: '有待处理事项', note: '', role: '' })
  }
  const out = [...days.values()]
    .filter((d) => d.done.length || d.stuck.length || d.next.length)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7)
    .map((d) => ({
      date: d.date,
      doneCount: d.done.length,
      stuckCount: d.stuck.length,
      // 一句话总结（老板只看这句）
      headline: d.stuck.length
        ? `${d.done.length} 项完成，${d.stuck.length} 项卡住`
        : d.done.length ? `${d.done.length} 项完成` : '无进展',
      done: d.done.slice(0, 8),
      stuck: d.stuck.slice(0, 5),
      next: d.next.slice(0, 5),
    }))
  return out
}

function ticketsSummary(projectDir, fs, path) {
  const dir = path.join(projectDir, '.jarvis', 'tickets')
  const tickets = []
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^ticket-.*\.json$/.test(name)) continue
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
        if (!t || !t.id) continue
        const asg = (t.assignments || []).slice(-1)[0] || {}
        const mandateText = (() => {
          const m = t.mandate
          if (!m) return ''
          if (typeof m === 'string') return m.slice(0, 400)
          return [m.by ? '来自 ' + m.by : '', m.basis || '', m.gate ? '依据 ' + m.gate : ''].filter(Boolean).join('；').slice(0, 400)
        })()
        tickets.push({
          id: String(t.id),
          title: String(t.title || ''),
          stage: String(t.stage || 'build'),
          // 交付物聚合层（方案 A）用：这张单属于哪个项目/需求。
          // 原投影丢了 project（原始 JSON 有），导致无法聚合 → 只能平铺任务点。
          project: String(t.project || '').slice(0, 200),
          createdAt: t.createdAt || '',
          updatedAt: t.updatedAt || '',
          ended: t.ended || null,
          // 验收状态归一（方案 E）：老板只关心「能不能验收」。
          // 由 ended.outcome（取值无枚举）+ 最近汇报状态推导；判不出就是 unknown（不猜）。
          acceptance: deriveAcceptance(t, asg),
          mandate: mandateText,
          origin: t.origin ? (typeof t.origin === 'string' ? t.origin : String(t.origin.type || t.origin.source || t.origin.kind || '')).slice(0, 80) : '',
          attempts: (t.assignments || []).length,
          startedAt: asg.startedAt || '',
          endedAt: asg.endedAt || '',
          endedReason: asg.endedReason ? String(asg.endedReason).slice(0, 120) : '',
          role: String(asg.role || ''),
          state: String(asg.state || ''),
          reportState: asg.report && asg.report.state ? String(asg.report.state) : '',
          reportAt: asg.report && asg.report.at ? String(asg.report.at) : '',
          summary: asg.report && asg.report.summary ? String(asg.report.summary).slice(0, 400) : '',
        })
      } catch {}
    }
  } catch {}
  tickets.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
  const open = tickets.filter((t) => !t.ended)
  const done = tickets.filter((t) => t.ended).slice(0, 20)
  const proposals = []
  try {
    const raw = fs.readFileSync(path.join(dir, 'proposals.jsonl'), 'utf8')
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const p = JSON.parse(line)
        if (p && p.status === 'pending') proposals.push({ id: String(p.id), title: String(p.title || ''), proposer: String(p.proposer || ''), why: String(p.why || '').slice(0, 300), basis: String(p.basis || '').slice(0, 300), at: p.at || '' })
      } catch {}
    }
  } catch {}
  return { open, done, proposals }
}

/**
 * 构建界面快照（只读；不存在的模块就是空，不编造）。
 * @param {string} projectDir
 * @param {{version?:string, tools?:number}} meta 插件自身信息（版本/工具数由调用方给，避免读 package.json）
 */
export function buildSnapshot(projectDir, meta = {}) {
  const fs = _require('node:fs')
  const path = _require('node:path')
  const dir = String(projectDir || '')
  const empty = {
    schema: SNAPSHOT_SCHEMA,
    generatedAt: new Date().toISOString(),
    workspace: { id: dir ? 'jarvis-' + path.basename(dir) : '', cwd: dir, name: '' },
    plugin: { version: String(meta.version || ''), tools: Number(meta.tools || 0), stages: JARVIS_STAGES.map((s) => ({ id: s, label: STAGE_LABELS[s] })) },
    active: false,
  }
  if (!dir) return empty
  let stage = null
  try {
    stage = computeStage(dir)
  } catch {
    stage = null
  }
  let meetings = null
  try {
    meetings = meetingPolicy(dir)
  } catch {
    meetings = null
  }
  const board = boardSummary(dir, fs, path)
  const teams = listTeams(dir, fs, path)
  const cards = listCards(dir, fs, path)
  const tickets = ticketsSummary(dir, fs, path)
  // A/C 共用：只算一次（每个快照都算，避免重复扫盘/重复解压 zstd）
  const deliverables = buildDeliverables(dir, tickets, path)
  const subagents = dshSubagents(dir, fs, path)
  const memory = memorySummary(dir, fs, path)
  let gc = null
  try { gc = gcSummary(dir) } catch { gc = null }
  const gates = readJsonSafe(dir, '.jarvis/gates.json', fs, path) || {}
  const company = readJsonSafe(dir, '.jarvis/company-state.json', fs, path)
  const active = Boolean(
    (stage && stage.index > 1) || teams.teams.length || board.total || cards.length || memory.exists || Object.keys(gates).length || tickets.open.length || tickets.done.length || tickets.proposals.length,
  )
  return {
    ...empty,
    active,
    workspace: { ...empty.workspace, name: (company && company.company && company.company.name) || path.basename(dir) },
    stage: stage
      ? {
          index: stage.index,
          total: stage.total,
          stage: stage.stage,
          label: stage.label,
          done: stage.done || [],
          missing: stage.missing || [],
          next: stage.next || '',
        }
      : null,
    gates,
    artifacts: (stage && stage.artifacts) || {},
    tasks: {
      open: teams.open,
      completed: teams.completed,
      activeTeams: teams.activeTeams || [],
      teams: teams.teams,
      byAssignee: teams.teams.flatMap((t) => t.tasks.map((x) => ({ ...x, team: t.name }))),
    },
    board,
    tickets,
    // 方案 A：老板视角的交付物聚合（主屏只渲染这个）
    deliverables,
    // 方案 C：空白语义化——页面空的时候必须说清是哪种空
    emptyReason: deriveEmptyReason(dir, { tickets, deliverables, dshSubagents: subagents, active }),
    // 方案 D：日报/周报（历史页用，按天聚合 + 事件流提炼兜底）
    dailyReports: buildDailyReports(dir, tickets, fs, path),
    gc,
    meetings: meetings
      ? {
          required: meetings.required,
          suggested: meetings.suggested,
          counts: meetings.meetings,
          last: meetings.lastMeeting ? { id: meetings.lastMeeting.id, type: meetings.lastMeeting.type, topic: meetings.lastMeeting.topic, date: meetings.lastMeeting.date } : null,
          noMeetingReason: meetings.noMeetingReason,
        }
      : null,
    cards,
    memory,
    dshSubagents: subagents,
    company: company || (teams.teams.length
      ? {
          company: { name: path.basename(dir) },
          employees: teams.teams.flatMap((t) =>
            (t.members || []).map((m) => {
              const cur = t.tasks.find((x) => x.assignee === (m.name || m.role) && !['completed', 'cancelled', 'failed', 'dropped'].includes(x.status))
              return {
                id: m.name || m.role,
                role: m.role || m.name,
                persona: (m.name && m.role && m.name !== m.role) ? m.name : '',
                status: cur ? 'working' : 'idle',
                taskId: cur ? cur.id : '',
                currentWork: cur ? cur.subject : '',
                team: t.name,
              }
            }),
          ),
        }
      : null),
    capabilities: {
      toolCount: Number(meta.tools || 0),
      version: String(meta.version || ''),
      panels: ['stage', 'tasks', 'board', 'meetings', 'cards', 'memory', 'company', 'console', 'events', 'voice', 'chat'],
      // 能力台契约：工具清单/参数 schema 由 /api/jarvis/tools 提供，执行入口 /api/jarvis/command
      chatEndpoint: '/api/jarvis/chat',
      console: { toolsEndpoint: '/api/jarvis/tools', commandEndpoint: '/api/jarvis/command', sessionsEndpoint: '/api/jarvis/sessions' },
    },
  }
}

/** 供路由使用：把快照压成简洁摘要（列表页/头图用，不必拉全量任务）。 */
export function snapshotSummary(snap) {
  if (!snap || !snap.stage) return { active: false }
  return {
    schema: snap.schema,
    active: snap.active,
    stage: `${snap.stage.index}/${snap.stage.total} ${snap.stage.label}`,
    stageId: snap.stage.stage,
    missing: snap.stage.missing.length,
    openTasks: snap.tasks.open,
    blockers: snap.board.blockers.length,
    openBoard: snap.board.open.length,
    meetingsRequired: snap.meetings ? snap.meetings.required.length : 0,
    memoryStale: snap.memory.stale,
  }
}
