/** 「员工实况」的唯一真实事实源（v0.35）——团队一览/3D 画面都必须从这里取数。
 *
 *  ── 用户定调（2026-11-27）：「团队一览里面的员工干活还是假的啊」──
 *
 *  为什么重写：旧实现有两处选错数据源，导致画面要么空、要么显示过期假人：
 *   ① src/host/state/snapshot.js#listTeams 只读 `<ws>/.agent-teams/<team>/team.json`；
 *   ② src/host/office-bridge.js#deriveEmployeeFacts 同样以 .agent-teams 为第一事实源，
 *      且「读不到就直接 return []」——根本走不到本该读的 .jarvis/tickets。
 *  但本部署的建队/派活链路是
 *      jarvis_distill → jarvis_store(itemType=card) → jarvis_company(employee_hired)
 *      → jarvis_dispatch_task → jarvis_ticket(/ .jarvis/tickets/*.json)
 *  **一个字节都不写 .agent-teams/**。于是：
 *      · 新工作区 → 画面空；
 *      · 老工作区（11 月 agent_teams 时代残留 team.json）→ 画面显示 11 月的假成员。
 *  用户看到的「假」，本质是**读错了目录**，不是渲染造假。
 *
 *  第二处「假」：Wings UI 的另一张卡（cardJarvisBrief）用 snap.dshSubagents 归纳汇报，
 *  注释自认「这些子会话是绕过我直接开的」——把用户自己开的子会话当成"员工在干活"。
 *  本模块也提供旁路子会话的分流口径，让调用方能分开呈现。
 *
 *  ────────────────────────────────────────────────────────────────
 *  只读以下**磁盘事实**，一项不编（每条都带 source 便于排查）：
 *    · .jarvis/cards/<角色>.md            → 员工存在性 + 角色名（去 .md）
 *    · .jarvis/company-state.json         → 可选增强（persona/绩效/status），不增不减员工
 *    · .jarvis/tickets/ticket-*.json      → 谁在做什么（最近 assignment 的 role/state/report）
 *    · .jarvis/tickets/exec-map.json      → 该角色是否还挂着子会话（childId）
 *    · .jarvis/outputs/<ticketId>/STATUS.md → 成员自写进度锚点（mtime = 最后活跃时间）
 *
 *  status 判定（机械可判，不许猜）：
 *    · working   = 有未结束任务 + 证据显示仍然活着（STATUS 新鲜 或 exec-map 有 childId）
 *    · stalled   = 有未结束任务，但没有任何活着的证据（STATUS 陈旧 / 无 exec-map / 超过 STALE_MS）
 *    · idle      = 名下没有任何未结束任务
 *
 *  边界：
 *    · 空工作区（无 cards 无 tickets）→ 返回空 employees（画面空着，不造假人）
 *    · assignment.role === 'captain' → 不算员工（captain 就是贾维斯自己）
 *    · STATUS.md 只有插件自动段 → 标记 statusAutoOnly=true（不算成员自写）
 *    · exec-map 不存在（没派过活）→ 绝不标 working
 */
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

/** 有未结束任务但超过这么久没有任何活动证据 → 判定 stalled。 */
export const STALE_MS = 30 * 60 * 1000
/** 未结束任务超过这么久 → 额外标 longOpen（提示"建议 retry 或 stop"，但仍显示为在办）。 */
export const LONG_OPEN_MS = 7 * 24 * 60 * 60 * 1000
/** 任务言的终态（与 core/model.js 的 OUTCOMES 一致）。 */
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'failed', 'dropped'])
/** captain 不是员工（它就是贾维斯本人）。 */
const CAPTAIN_ROLES = new Set(['captain', 'jarvis', '贾维斯', '老板'])
/** 任务编号归一（T1/T3/T4a/T7/P1.1 等）——与 snapshot 的去重键同一口径。 */
function taskNoKey(raw) {
  const subj = String(raw || '')
  const m = subj.match(/^(?:任务\s*)?(T[\d]+[A-Za-z]?|P[\d.]+|G[\d]+|D[\d]+)(?=[\s:：、,，（(]|$)/i)
    || subj.match(/(T[\d]+[A-Za-z]?)(?=[\s:：、,，（(]|$)/i)
  if (m) return m[1].toUpperCase()
  const id = subj.trim().toLowerCase().replace(/^ticket-m?/, '').replace(/^task-/, '')
  return id || ''
}

function readJson(file, fs) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function statMtime(file, fs) {
  try { return fs.statSync(file).mtimeMs } catch { return 0 }
}

/** 子会话是否还活着。
 *  exec-map 真实结构（见 adapters/dsh-executor.js record()）：
 *    { "<ticketId>": { "<assignmentId>": { role, childId, retired?, ... } } }
 *  role 在**叶子层**，不是键。retired=true 表示已换人/终止，不看它的 childId。 */
function liveChildOf(execMap) {
  const out = new Map()
  try {
    for (const slot of Object.values(execMap || {})) {
      if (!slot || typeof slot !== 'object') continue
      for (const info of Object.values(slot)) {
        if (!info || typeof info !== 'object') continue
        const role = String(info.role || '').trim()
        const childId = String(info.childId || '')
        if (!role || !childId || info.retired) continue
        const prev = out.get(role)
        // 同一角色多次派发：保留时间最新的一条（它才是当前可能在跑的那个会话）
        const at = Number(new Date(info.at || info.startedAt || 0)) || 0
        if (!prev || at > prev.at) out.set(role, { childId, at, atIso: String(info.at || info.startedAt || ''), raw: prev ? prev.at : 0 })
      }
    }
  } catch { /* exec-map 坏形态：不做判定 */ }
  return out
}

/** 从 STATUS.md 读出成员自写的进度（首行 + 是否只有自动段）。
 *  口径与 adapters/dsh-executor.js#checkStatusFreshness 完全一致（那是插件写/读 STATUS 的唯一权威）：
 *  插件自动段以 `- ` 开头的行、注释、`# ` 标题都不算成员自写。 */
function readStatus(statusFile, fs) {
  const mtime = statMtime(statusFile, fs)
  if (!mtime) return { exists: false, mtime: 0, line: '', autoOnly: false }
  let text = ''
  try { text = fs.readFileSync(statusFile, 'utf8') } catch { text = '' }
  const afterAuto = text.split('<!-- jarvis:auto-status -->')[1] || text
  const ownLines = afterAuto.split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('<!--') && !l.startsWith('- ') && !l.startsWith('# '))
  return {
    exists: true,
    mtime,
    line: String(ownLines[0] || '').slice(0, 100),
    autoOnly: !ownLines.length,
  }
}

/**
 * 推导本工作区的员工实况。
 * @param {string} projectDir 工作区根
 * @param {object} fs node:fs（由调用方传入，便于测试桩替换）
 * @param {object} path node:path
 * @param {{now?:number}} [opts]
 * @returns {{employees:Array, tasks:Array, sources:object, emptyReason:string}}
 */
export function deriveJarvisFacts(projectDir, fs, path, opts = {}) {
  const now = Number(opts.now) || Date.now()
  const base = String(projectDir || '')
  const empty = { employees: [], tasks: [], sources: {}, emptyReason: '' }
  if (!base) return { ...empty, emptyReason: '未指定工作区' }
  const jv = path.join(base, '.jarvis')

  // ① 员工存在性：.jarvis/cards/*.md（JARVIS 链路唯一会稳定写员工的地方）
  const roleSet = new Set()
  const cardNames = []
  try {
    for (const n of fs.readdirSync(path.join(jv, 'cards'))) {
      if (!/\.md$/i.test(n) || /(^|[\\/])history([\\/]|$)/.test(n)) continue
      const role = String(n).replace(/\.md$/i, '').trim()
      if (role) { roleSet.add(role); cardNames.push(role) }
    }
  } catch { /* 无 cards 目录 → 继续（可能只有 company-state 员工） */ }

  // ② company-state 增强（persona/绩效）；**不新增员工**，只补已有角色的字段
  const company = readJson(path.join(jv, 'company-state.json'), fs) || {}
  const empByRole = new Map()
  for (const e of (Array.isArray(company.employees) ? company.employees : [])) {
    const role = String((e && (e.role || e.name)) || '').trim()
    if (!role) continue
    empByRole.set(role, e)
    // company-state 有员工但没卡 → 也算存在（不然真入职了却看不见）
    if (!roleSet.has(role)) roleSet.add(role)
  }

  // ③ 任务：.jarvis/tickets/*.json 里未结束的单

  // ③b v0.15.9：.agent-teams/team.json 的完成态（跨源合并的唯一事实）
  //   本部署成员从不调 jarvis_ticket(report)，tickets 的 ended 永远 null；
  //   而团队账（team.json）会标 completed。二者必须合并，否则成员永远显示"在办"。
  //   口径：任务编号（T1/T3/T4a…）归一匹配；team.json 标 completed → 该编号视为已完成。
  const teamCompletedKeys = new Set()
  try {
    const td = path.join(base, '.agent-teams')
    for (const team of fs.readdirSync(td)) {
      if (/^(archive|\.|retired)/.test(String(team))) continue
      let d = null
      try { d = readJson(path.join(td, String(team), 'team.json'), fs) } catch { continue }
      if (!d) continue
      for (const task of (d.tasks || [])) {
        if (String(task.status || '') !== 'completed') continue
        const key = taskNoKey(task.subject || task.id)
        if (key) teamCompletedKeys.add(key)
      }
    }
  } catch { /* 无 .agent-teams 或读失败：不影响 */ }

  const ticketsDir = path.join(jv, 'tickets')
  const openTasks = []
  const allTasks = []
  try {
    for (const name of fs.readdirSync(ticketsDir)) {
      if (!/^ticket-.*\.json$/.test(name)) continue
      const t = readJson(path.join(ticketsDir, name), fs)
      if (!t || !t.id) continue
      const asg = (Array.isArray(t.assignments) ? t.assignments : []).slice(-1)[0] || {}
      const role = String(asg.role || '').trim()
      const statusPath = String(t.id)
      const rec = {
        id: String(t.id),
        subject: String(t.title || '').slice(0, 120),
        assignee: role,
        status: t.ended
          ? String((t.ended && t.ended.outcome) || 'completed')
          : String(asg.state || 'running'),
        reportState: String((asg.report && asg.report.state) || ''),
        reportSummary: String((asg.report && asg.report.summary) || '').slice(0, 300),
        createdAt: String(t.createdAt || ''),
        updatedAt: String(t.updatedAt || ''),
        attempts: Array.isArray(t.assignments) ? t.assignments.length : 0,
        ended: t.ended ? { outcome: String(t.ended.outcome || ''), at: String(t.ended.at || '') } : null,
      }
      allTasks.push(rec)
      // v0.15.9：tickets 没 ended，但团队账里该编号已完成 → 视为已完成（跨源合并）
      if (!t.ended && teamCompletedKeys.has(taskNoKey(t.title))) {
        rec.ended = { outcome: 'completed', at: String(t.updatedAt || t.createdAt || ''), by: 'team.json-sync' }
        rec.status = 'completed'
        if (rec.reportState === '') rec.reportState = 'ready'
      }
      if (!rec.ended) openTasks.push(rec)   // v0.15.9：用合并后的 rec.ended（跨源已判完成的不算在办）
    }
  } catch { /* 无 tickets 目录 */ }


  // ④ exec-map：该角色是否还挂着子会话
  const execMap = readJson(path.join(ticketsDir, 'exec-map.json'), fs) || {}

  // ⑤ 汇总为员工行
  const employees = []
  for (const role of roleSet) {
    if (CAPTAIN_ROLES.has(role)) continue
    const emp = empByRole.get(role) || {}
    // v0.15.9：选「状态最强 / 最新」的那张（口径与 snapshot.listTeams 合并逻辑一致），
    // 不再按数组顺序取第一个（旧实现会选中 11-27 首次派单失败的陈旧单 → 永远 stalled）。
    const roleTasks = allTasks.filter((x) => x.assignee === role)
    const RANK = { completed: 5, dropped: 5, cancelled: 5, failed: 3, blocked: 2, running: 1, in_progress: 1, pending: 0 }
    const rankOfT = (t) => {
      if (!t) return -1
      if (t.ended) return 5
      const k = String(t.status || '').toLowerCase()
      return k in RANK ? RANK[k] : 0
    }
    const curOpen = roleTasks.filter((x) => !x.ended)
      .sort((a, b) => (String(b.updatedAt || '') > String(a.updatedAt || '') ? 1 : -1))[0] || null
    // 「当前任务」= 最新结束后，若仍有未结束单则用那张；否则用最近完成的那张（供展示"最后一件事"）
    const latestDone = roleTasks.filter((x) => x.ended)
      .sort((a, b) => (String(b.updatedAt || '') > String(a.updatedAt || '') ? 1 : -1))[0] || null
    const cur = curOpen || latestDone
    const status = readStatus(path.join(jv, 'outputs', cur ? cur.id : '__none__', 'STATUS.md'), fs)
    const live = liveChildOf(execMap)
    const liveRec = live.get(role)
    let state = 'idle'
    let source = 'cards'
    // v0.15.9：只有「确有未结束单」才可能 working / stalled；
    // 名下任务全部已完成 → idle（"最近完成"不代表还在干活）。
    if (curOpen) {
      const statusFresh = status.mtime && (now - status.mtime) < STALE_MS
      const taskFresh = (() => {
        const at = Number(new Date(cur.updatedAt || cur.createdAt || 0)) || 0
        return at && (now - at) < STALE_MS
      })()
      const hasLiveChild = Boolean(liveRec && liveRec.childId)
      if (statusFresh || hasLiveChild || taskFresh) {
        state = 'working'
        source = statusFresh ? 'cards+tickets+STATUS' : hasLiveChild ? 'cards+tickets+exec-map' : 'cards+tickets(单刚更新)'
      } else {
        state = 'stalled'
        source = 'cards+tickets(无活动证据)'
      }
    }
    const lastActivityAt = (() => {
      const candidates = [status.mtime, Number(new Date((cur && cur.updatedAt) || 0)) || 0, Number(new Date((liveRec && liveRec.atIso) || 0)) || 0]
      const max = Math.max(0, ...candidates)
      return max ? new Date(max).toISOString() : ''
    })()
    const openAgeMs = cur ? (now - (Number(new Date(cur.createdAt || 0)) || now)) : 0
    employees.push({
      role,
      name: String(emp.persona || emp.name || role).slice(0, 60),
      status: state,
      currentWork: cur ? cur.subject : '',
      ticketId: cur ? cur.id : '',
      taskState: cur ? cur.status : '',
      reportState: cur ? cur.reportState : '',
      statusExists: Boolean(status.exists),
      statusAutoOnly: Boolean(status.autoOnly),
      statusLine: String(status.line || ''),
      lastActivityAt,
      openAgeMs: Math.max(0, openAgeMs),
      longOpen: openAgeMs > LONG_OPEN_MS,
      perfScore: emp.perfScore,
      strikes: emp.strikes,
      source,
    })
  }

  // 任务行（前端 renderTeam 的 board-list 用）
  const tasks = openTasks.map((t) => ({
    id: t.id,
    subject: t.subject,
    assignee: t.assignee,
    status: t.reportState === 'blocked' || t.reportState === 'failed' ? t.reportState
      : /running|progress|waiting/.test(t.status) ? 'in_progress' : t.status,
    updatedAt: t.updatedAt,
    attempts: t.attempts,
    source: 'jarvis_tickets',
  }))

  const emptyReason = (() => {
    if (!employees.length && !tasks.length) return '这个工作区还没有员工（.jarvis/cards 为空，也没有派过任务单）'
    if (!employees.length) return '只有任务单没有角色卡——先 jarvis_distill 蒸馏角色卡再派活'
    return ''
  })()

  return {
    employees,
    tasks,
    sources: {
      employees: 'cards' + (empByRole.size ? '+company-state' : ''),
      tasks: 'jarvis_tickets',
      status: '.jarvis/outputs/<ticketId>/STATUS.md',
      live: execMap && Object.keys(execMap).length ? 'exec-map' : '（无 exec-map：没派过活）',
      cards: cardNames,
    },
    emptyReason,
  }
}

/**
 * 把 jarvis 事实映射成与 .agent-teams 团队同形的对象，供 snapshot.listTeams 叠加。
 * 形状与 listTeams 返回的 team 完全一致（name/description/captainSessionId/members/tasks/mtime），
 * 这样前端 renderTeam 不用改结构。
 * @returns {object|null} null = 没有任何 jarvis 事实（不叠加）
 */
export function jarvisTeamShape(facts, path) {
  if (!facts || (!facts.employees.length && !facts.tasks.length)) return null
  const members = facts.employees.map((e) => ({
    name: e.name || e.role,
    role: e.role,
    provider: '',
    model: '',
    // 额外诚实字段（前端可用可不用）
    status: e.status,
    statusLine: e.statusLine,
    statusExists: e.statusExists,
    lastActivityAt: e.lastActivityAt,
  }))
  const tasks = facts.tasks.map((t) => ({
    id: t.id,
    subject: t.subject,
    assignee: t.assignee,
    status: t.status,
    attempt: Number(t.attempts || 0),
  }))
  return {
    name: 'jarvis',
    description: 'JARVIS 任务单内核（.jarvis/cards + .jarvis/tickets）',
    captainSessionId: '',
    members,
    tasks,
    // mtime 用最新任务时间，让排序把活跃的团队排前
    mtime: (() => {
      const at = facts.tasks.reduce((mx, t) => Math.max(mx, Number(new Date(t.updatedAt || 0)) || 0), 0)
      return at || Date.now()
    })(),
    source: 'jarvis-facts',
  }
}
