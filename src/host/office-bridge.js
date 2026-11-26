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
  idle: 'queued',
  on_probation: 'queued',
  terminated: 'failed',
}

/** 角色关键词 → PixOffice 人物（sceneActorId）。多对一绑定是官方支持的用法。 */
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
  const employees = []
  const idByRole = new Map()
  employeesIn.slice(0, 200).forEach((e, i) => {
    const role = String(e.role || e.name || `员工${i + 1}`)
    const id = safeId('emp-', e.id || role, i + 1)
    if (idByRole.has(role)) return
    idByRole.set(role, id)
    const status = String(e.status || 'idle')
    employees.push({
      id,
      sceneActorId: pickActor(role),
      name: String(e.persona || e.name || role).slice(0, 40),
      role: role.slice(0, 60),
      // 修正三目永真（旧式两个分支对 idle 都返回 true → idle 员工在画面上永远在线）
      online: status !== 'terminated' && status !== 'idle',
    })
  })

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
    employees,
    tasks,
    events,
    whiteboard: {
      template: 'task-board-v1',
      title: String(st.phase ? `当前阶段：${st.phase}` : '任务白板'),
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
    let teams = []
    try { teams = fs.readdirSync(teamsDir) } catch { return out }
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
    return [...byRole.values()]
  } catch { return out }
}
