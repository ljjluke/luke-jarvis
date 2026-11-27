/**
 * jarvis-office-bridge · 把 jarvis 的 company-state.json 投影成 PixOffice 业务快照
 *
 * 领域无关：只做「jarvis 状态语义 → PixOffice 展示语义」的映射，不引入任何业务功能。
 * 纯函数（无 IO、无副作用），便于单测与复用。
 *
 * 映射约定：
 *   employees[].status : working→running | reporting→running | meeting→blocked
 *                        idle→queued | on_probation→queued | terminated→failed
 *   tasks[].status     : 同上；progress 用 -1（未知），让前端自己演进度条
 *   meetings[]         : → events[kind=meeting.*]
 *   recruiting[]       : → events[kind=recruiting.*]
 *   ceo/headhunter     : → events[kind=ceo.*] / events[kind=recruiting.*]
 */

/** jarvis 员工状态 → PixOffice 任务状态 */
export const EMPLOYEE_STATUS_MAP = {
  working: 'running',
  reporting: 'running',
  meeting: 'blocked',
  // v0.35：stalled = 有活但会话已停（jarvis-facts 的真实判定）。
  // 映射成 blocked 而非 queued：它需要老板注意（不是"排队等着"）。
  stalled: 'blocked',
  idle: 'queued',
  on_probation: 'queued',
  terminated: 'failed',
}

/** 角色关键词 → PixOffice 人物（sceneActorId）。多对一绑定是官方支持的用法。 */
// 上游场景可用演员（与 pixoffice/index.js 的 PIXOFFICE_ACTOR_IDS 保持一致）。
// 这里单独定义一份是为了避免 office-bridge ↔ pixoffice 的循环依赖
// （pixoffice/index.js 又 import 本文件的 toPixOfficeSnapshot）。
// ⚠️ 改这里必须同步改 src/host/pixoffice/index.js 的 PIXOFFICE_ACTOR_IDS，否则帧校验会拒。
export const PIXOFFICE_ACTORS = Object.freeze([
  'office-lead', 'review-agent', 'data-agent', 'file-agent', 'app-agent', 'code-agent',
])
// 顺序即优先级：越具体的岗位越靠前（"测试工程师"必须命中 review-agent，不能被"工程师"抢走）
const ACTOR_RULES = [
  [/ceo|总经理|老板|厂长|店长|负责人|lead|主管/i, 'office-lead'],
  [/猎头|招聘|寻访|headhunter|recruit/i, 'office-lead'],
  [/测试|验证|质检|qa|test|verify|review/i, 'review-agent'],
  [/数据|数据库|db|data|sql/i, 'data-agent'],
  [/文档|规范|写作|file|doc|spec/i, 'file-agent'],
  [/前端|页面|ui|app|界面/i, 'app-agent'],
  [/架构|设计|方案|architect|design/i, 'code-agent'],
  [/研发|开发|实现|工程|engineer|dev|coder/i, 'code-agent'],
]
export const DEFAULT_ACTOR = 'app-agent'

/** 按角色名挑人物（未命中用默认） */
export function pickActor(role) {
  const s = String(role || '')
  for (const [re, actor] of ACTOR_RULES) if (re.test(s)) return actor
  return DEFAULT_ACTOR
}

/** 稳定短哈希（FNV-1a）：把任意字符（含中文）转成 PixOffice 允许的 id 片段 */
function hashId(input) {
  let h = 0x811c9dc5
  const s = String(input ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(36)
}

/**
 * 生成稳定 id（PixOffice 要求 1-100 字符，只允许 [A-Za-z0-9_.:-]）。
 * 纯中文名不能直接当 id（会被过滤成空）→ 保留可读 ASCII 前缀 + 中文哈希，保证唯一且稳定。
 */
function safeId(prefix, raw, fallback) {
  const s = String(raw ?? '').trim()
  if (!s) return `${prefix}${fallback}`
  const ascii = s.replace(/[^A-Za-z0-9_.:-]/g, '')
  const suffix = hashId(s)
  const head = ascii ? ascii.slice(0, 48) : 'x'
  return `${prefix}${head}-${suffix}`.slice(0, 100)
}

/** ISO 时间（PixOffice 要求带时区；缺失则用当前时间） */
function iso(v) {
  const d = v ? new Date(v) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

/**
 * 主投影函数
 * @param {object} state jarvis company-state（含 employees/meetings/recruiting/ceo/headhunter/tasks/phase）
 * @param {object} opts  {seq, workspaceId, workspaceName}
 * @returns {object} PixOffice 业务快照（schemaVersion 1.0）
 */
export function toPixOfficeSnapshot(state, opts = {}) {
  const st = state && typeof state === 'object' ? state : {}
  const employeesIn = Array.isArray(st.employees) ? st.employees : []
  const tasksIn = Array.isArray(st.tasks) ? st.tasks : []
  const meetingsIn = Array.isArray(st.meetings) ? st.meetings : []
  const recruitingIn = Array.isArray(st.recruiting) ? st.recruiting : []

  // ── 员工：只保留未离场的（terminated 仍要展示为 failed 一段时间，由调用方决定是否过滤）
  //
  // ⚠️ 场景容量硬限制（v0.29·用户定调 2026-11-27「不要自绘」）：
  //   上游 PixOffice 只有 6 个角色模型与 6 个固定工位（p1..p6），actor id 白名单也固定 6 个。
  //   在「不自绘 + 不改上游 bundle」的前提下，物理上不可能给第 7 个人独立工位。
  //   所以这里的策略是：**让这 6 个位置放"最该被看见的 6 个人"**——
  //     ① 优先 working（正在干活的人必须出现在画面里，这是"画面对不上"的核心抱怨）
  //     ② 其次 stalled（有任务但会话停了，需要被注意到）
  //     ③ 最后 idle
  //   原实现是按 employeesIn 原序取前 200 个、按 role 哈希选 actor，
  //   完全不看谁在干活 → 可能出现"idle 的人占着台，正在干活的人不在画面里"。
  const employees = []
  const idByRole = new Map()
  // 先按活跃度排序（working > stalled > idle），同档按原序（保持稳定）
  const ACTIVITY_RANK = { working: 0, reporting: 0, meeting: 0, stalled: 1, on_probation: 1, idle: 2, terminated: 3 }
  const sorted = employeesIn.slice(0, 200).map((e, i) => ({ e, i, r: ACTIVITY_RANK[String(e.status || 'idle')] ?? 2 }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
  // 已占用的 actor 必须去重：同一个 sceneActorId 出现两次，上游只会渲染一个实例，
  // 等于"两个人挤一个工位"——这正是用户抱怨的"画面对不上"。
  const usedActors = new Set()
  for (const { e, i } of sorted) {
    const role = String(e.role || e.name || `员工${i + 1}`)
    const id = safeId('emp-', e.id || role, i + 1)
    if (idByRole.has(role)) continue
    let actor = pickActor(role)
    // actor 撞车 → 换一个没被占用的（实在没有才允许复用，并标记 congested）
    let congested = false
    if (usedActors.has(actor)) {
      const free = PIXOFFICE_ACTORS.find((a) => !usedActors.has(a))
      if (free) actor = free
      else congested = true
    }
    usedActors.add(actor)
    idByRole.set(role, id)
    const status = String(e.status || 'idle')
    employees.push({
      id,
      sceneActorId: actor,
      name: String(e.persona || e.name || role).slice(0, 40),
      role: role.slice(0, 60),
      status,
      currentWork: String(e.currentWork || '').slice(0, 80),
      // 修正三目永真（旧式两个分支对 idle 都返回 true → idle 员工在画面上永远在线）
      // v0.35：stalled（有活但会话已停）不能算在线——它就是"人不在工位，活卡着"。
      online: status === 'working' || status === 'reporting' || status === 'meeting',
      congested,          // true = 工位已满，此人与别人共用同一个场景角色
      // 成员自写进度（STATUS.md 首行）；空 = 还没记录（前端如实显示，不编百分比）
      progressLine: String(e.statusLine || '').slice(0, 80),
    })
  }
  // 场景可见人数上限 = 6 个演员；超出部分不进场景（但左侧列表仍全量显示）
  const SEAT_LIMIT = PIXOFFICE_ACTORS.length
  const sceneVisible = employees.slice(0, SEAT_LIMIT)
  const overflow = Math.max(0, employees.length - SEAT_LIMIT)

  // ── 任务：优先用真实任务表；没有任务表时，用员工 currentWork 合成展示任务
  const tasks = []
  const nowIso = new Date().toISOString()
  tasksIn.slice(0, 1000).forEach((t, i) => {
    const assigneeRole = String(t.assignee || '')
    const assigneeId = idByRole.get(assigneeRole) || ''
    const status = String(t.status || 'pending')
    const mapped = /completed|done|通过|完成/.test(status) ? 'completed'
      : /failed|blocked|失败|阻塞/.test(status) ? (/failed/.test(status) ? 'failed' : 'blocked')
        : /in_progress|running|claimed|进行/.test(status) ? 'running'
          : 'queued'
    tasks.push({
      id: safeId('task-', t.id, i + 1),
      title: String(t.subject || t.title || `任务${i + 1}`).slice(0, 80),
      assigneeId,
      status: mapped,
      progress: mapped === 'completed' ? 100 : -1,
      updatedAt: iso(t.updatedAt),
      summary: String(t.output || t.note || '').slice(0, 200),
    })
  })
  // ── 诚实原则（v0.28·用户定调 2026-11-26）──
  // 原实现：任务表为空时，用员工 currentWork 合成"任务"塞进画面，注释写着
  //   「保证画面有人物在干活」。这是**主动造假**：
  //   ① currentWork 往往是上次写入的残留值，与此刻真实执行无关
  //   ② 合成的任务 id 形如 work-<role>，和真实任务单（ticket-*）完全对不上
  //   ③ 用户看到的"张三正在做需求分析"，可能张三此刻根本没开过会话
  // 用户原话：「不要让画面是假的，活根本不是 /jarvis 的工作内容」。
  // 修法：没有真实任务表就是没有——员工显示为空闲。宁可画面空着，
  //       也不能编一个"看起来在干活"的假任务。
  // 真实任务表来自 company-state.tasks，而它应由 syncCompanyState 从
  // .agent-teams/<team>/team.json + .jarvis/tickets 同步（见 syncCompanyStateFromFacts）。

  // ── 事件流：会议 / 招募 / CEO 动作 / 员工汇报与开除
  const events = []
  const pushEvent = (kind, summary, extra = {}) => {
    if (events.length >= 500) return
    events.push({
      id: safeId('ev-', `${kind}-${events.length + 1}`, events.length + 1),
      kind,
      summary: String(summary).slice(0, 160),
      occurredAt: iso(extra.occurredAt),
      taskId: extra.taskId ? safeId('task-', extra.taskId, '') : '',
      employeeId: extra.employeeId || '',
      fromEmployeeId: extra.fromEmployeeId || '',
    })
  }

  meetingsIn.slice(0, 100).forEach((m, i) => {
    const attendees = Array.isArray(m.attendees) ? m.attendees.map(String) : []
    const status = String(m.status || 'scheduled')
    pushEvent(
      status === 'done' ? 'meeting.done' : 'meeting.started',
      `${status === 'done' ? '散会' : '开会'}：${m.topic || m.type || '团队会议'}${attendees.length ? '（' + attendees.join('、') + '）' : ''}`,
      { occurredAt: m.updatedAt || m.createdAt },
    )
  })
  recruitingIn.slice(0, 100).forEach((r) => {
    const status = String(r.status || 'searching')
    const label = status === 'confirmed' ? '已确认人选' : status === 'interviewing' ? '面试中' : status === 'cancelled' ? '已取消' : '寻访中'
    pushEvent('recruiting.' + status, `猎头${label}：${r.position || r.targetPersona || '岗位'}${r.replacesEmp ? '（补 ' + r.replacesEmp + '）' : ''}`, { occurredAt: r.updatedAt })
  })
  employeesIn.slice(0, 200).forEach((e) => {
    const role = String(e.role || '')
    if (e.status === 'terminated') pushEvent('employee.terminated', `${role} 已离任${e.note ? '：' + e.note : ''}`, { employeeId: idByRole.get(role) || '', occurredAt: e.terminatedAt })
    else if (e.status === 'reporting' && e.lastReport) pushEvent('employee.reporting', `${role} 汇报：${String(e.lastReport).slice(0, 100)}`, { employeeId: idByRole.get(role) || '', occurredAt: e.lastReportAt })
    else if (e.perfScore !== undefined && e.perfScore !== null) pushEvent('employee.evaluated', `${role} 绩效 ${e.perfScore} 分${e.strikes ? `（不达标 ${e.strikes} 次）` : ''}`, { employeeId: idByRole.get(role) || '' })
  })
  const ceo = st.ceo && typeof st.ceo === 'object' ? st.ceo : null
  if (ceo && (ceo.currentAction || ceo.location)) {
    pushEvent('ceo.action', `CEO ${ceo.currentAction || ''}${ceo.location ? ' @' + ceo.location : ''}`.trim())
  }
  const hh = st.headhunter && typeof st.headhunter === 'object' ? st.headhunter : null
  if (hh && hh.currentAction) pushEvent('recruiting.headhunter', `猎头 ${hh.currentAction}`)

  // 事件按新到旧（协议要求）
  events.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))

  return {
    schemaVersion: '1.0',
    seq: Number.isInteger(opts.seq) && opts.seq > 0 ? opts.seq : 1,
    workspace: {
      id: String(opts.workspaceId || 'jarvis-team'),
      name: String(opts.workspaceName || st.company?.name || 'Jarvis 数字员工公司'),
    },
    // 场景只渲染 6 个工位（上游硬限制）；超出的人不进 employees（避免同一 actor 重复绑定）。
    // 左侧成员列表走的是另一条数据（直接读 team.json），始终全量。
    employees: sceneVisible,
    // 溢出信息：让场景内的 whiteboard 与前端能说清"画面只显示了一部分"
    seatInfo: { limit: SEAT_LIMIT, total: employeesIn.length, overflow: Math.max(0, employeesIn.length - SEAT_LIMIT), congested: employees.filter((e) => e.congested).length },
    tasks,
    events,
    whiteboard: {
      template: 'task-board-v1',
      // 文案必须诚实：员工多于工位时明确说"画面 X/共 N"
      title: overflow > 0
        ? `画面 ${sceneVisible.length}/${employees.length} 人在岗 · 其余见左侧列表`
        : String(st.phase ? `当前阶段：${st.phase}` : '任务白板'),
      status: 'queued',
      steps: [],
    },
  }
}

/**
 * 从真实事实推导「员工实况」——团队一览画面的唯一数据源（v0.28）。
 *
 * 用户定调（2026-11-26）：「团队一览里面每个人员工作画面都要对上，
 * 不要让画面是假的，活根本不是 /jarvis 的工作内容」。
 *
 * 为什么需要：原来的员工状态来自 company-state.json，而那个文件靠模型手填
 * （jarvis_company 工具），极易与真实执行脱节——实测某工作区 employees: 0，
 * 但 3D 画面照样显示有人在做需求分析。
 *
 * 本函数只读三类**真实事实**，一个都不编：
 *   ① .agent-teams/<team>/team.json  → 成员名单 + 任务状态 + assignee（谁在做什么）
 *   ② .jarvis/tickets/ticket-*.json   → 任务单状态（是否有在办的活）
 *   ③ 会话转录（可选，由调用方传入）  → 该成员是否真的还在跑（lastActivityAt）
 *
 * 返回 [{ role, name, status, currentWork, taskId, lastActivityAt, source }]
 *   status: 'working'（有在办任务且会话活跃）/ 'idle'（无在办任务）/ 'stalled'（有任务但会话已停）
 *   source: 说明这条状态是从哪个事实推出来的（便于排查"画面为什么显示这样"）
 *
 * 边界（刻意保守）：
 *   · 读不到任何事实 → 返回空数组（画面空着，不造假人）
 *   · 任务状态判定用 team.json 的 status 字段（与执行器一致）
 *   · 不推断"应该"在做什么——只报磁盘上有的
 */
export async function deriveEmployeeFacts(projectDir, fs, path, opts = {}) {
  const out = []
  try {
    const base = String(projectDir || '')
    if (!base) return out
    const teamsDir = path.join(base, '.agent-teams')
    // ⚠️ v0.35（用户实测 2026-11-27「团队一览里面的员工干活还是假的啊」）：
    // 原实现 `try { teams = readdirSync } catch { return out }` —— 读不到 .agent-teams 就直接返回空。
    // 但本部署的建队/派活链路（jarvis_distill → jarvis_company → jarvis_dispatch_task →
    // jarvis_ticket）**根本不写 .agent-teams/**，真实员工与在办活全在 .jarvis/ 里。
    // 于是新工作区永远空、老工作区显示 11 月的残留假人。
    // 修法：.agent-teams 为空**不再提前返回**，继续读 jarvis 事实（双源合并）。
    let teams = []
    try { teams = fs.readdirSync(teamsDir) } catch { teams = [] }
    // 收集每个成员的活跃任务（跨团队合并，按 role 去重取最新）
    const byRole = new Map()
    for (const t of teams) {
      if (/^(archive|\.|retired)/.test(String(t))) continue
      let d = null
      try { d = JSON.parse(fs.readFileSync(path.join(teamsDir, String(t), 'team.json'), 'utf8')) } catch { continue }
      const members = Array.isArray(d.members) ? d.members : []
      const tasks = Array.isArray(d.tasks) ? d.tasks : []
      for (const m of members) {
        const role = String(m.role || m.name || '').trim()
        if (!role) continue
        // 找该成员当前在办的任务（未终态）
        const open = tasks.find((x) => String(x.assignee || '') === role
          && !['completed', 'cancelled', 'failed', 'dropped'].includes(String(x.status || '')))
        const prev = byRole.get(role)
        const rec = {
          role,
          name: String(m.persona || m.name || role).slice(0, 40),
          status: open ? 'working' : 'idle',
          currentWork: open ? String(open.subject || open.title || '').slice(0, 80) : '',
          taskId: open ? String(open.id || '') : '',
          taskStatus: open ? String(open.status || '') : '',
          lastActivityAt: open ? String(open.updatedAt || open.startedAt || '') : '',
          team: String(t),
          source: 'team.json',
        }
        // 同一 role 多团队 → 保留"有在办任务"的那条
        if (!prev || (prev.status !== 'working' && rec.status === 'working')) byRole.set(role, rec)
      }
    }
    // 用会话转录校正 working → stalled（有任务但会话已停 = 异常态，要如实显示）
    const sessions = opts.sessions && Array.isArray(opts.sessions.items) ? opts.sessions.items : []
    if (sessions.length) {
      for (const rec of byRole.values()) {
        const hit = sessions.find((s) => String(s.label || '') === rec.role
          || String(s.label || '').includes(rec.role))
        if (hit && rec.status === 'working') {
          const lastAt = Number(new Date(hit.lastActivityAt || 0)) || 0
          // 超过 10 分钟没动静 → 判定为停滞（不是假的"在干活"）
          if (lastAt && Date.now() - lastAt > 10 * 60 * 1000) {
            rec.status = 'stalled'
            rec.source = 'team.json+sessions(超10分钟无活动)'
          } else {
            rec.source = 'team.json+sessions(会话活跃)'
          }
          rec.lastActivityAt = String(hit.lastActivityAt || rec.lastActivityAt)
        } else if (rec.status === 'working' && !hit) {
          // 有任务但没有对应会话 → 该成员没真在跑
          rec.status = 'stalled'
          rec.source = 'team.json(无对应子会话)'
        }
      }
    }
    // ── JARVIS 事实叠加（v0.35）：.jarvis/cards + tickets + STATUS.md + exec-map ──
    // 这是本部署真正在跑的链路。放在最后叠加：同一 role 若 .agent-teams 与 jarvis
    // 都有，jarvis 那条优先（它的任务单是活着的真状态，team.json 往往是历史残留）。
    try {
      const { deriveJarvisFacts } = await import('./state/jarvis-facts.js')
      const facts = deriveJarvisFacts(base, fs, path)
      for (const e of facts.employees) {
        const rec = {
          role: e.role,
          name: e.name,
          status: e.status,
          currentWork: e.currentWork,
          taskId: e.ticketId,
          taskStatus: e.taskState,
          reportState: e.reportState,
          lastActivityAt: e.lastActivityAt,
          statusLine: e.statusLine,
          statusExists: e.statusExists,
          longOpen: e.longOpen,
          team: 'jarvis',
          source: e.source,
        }
        const prev = byRole.get(e.role)
        // jarvis 事实优先：只要它有明确状态（working/stalled/idle）就覆盖 team.json 的推断
        if (!prev || e.status === 'working' || prev.status !== 'working' || prev.source.startsWith('team.json')) {
          byRole.set(e.role, rec)
        }
      }
    } catch { /* jarvis 事实不可用不阻断 */ }
    return [...byRole.values()]
  } catch { return out }
}
