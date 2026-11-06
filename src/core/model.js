/** 领域模型（借鉴 dsh-superagent src/core/model.ts 的分层：纯规则、无 IO）。

 *  概念映射（superagent → luke-jarvis）：
 *    Trigger      → 工具动作/命令事件（company action / UI command）
 *    Ticket       → agent-teams 任务点（team.json 里的 task）
 *    Assignment   → 成员对任务的一次执行（employee status 即其投影）
 *    Report       → 成员回报（employee_reporting / board 未决）
 *    CompanyState → 3D 办公室状态（本插件自有聚合，superagent 无对应物）
 *
 *  本文件只放「状态迁移规则」与「谓词」：输入状态与动作，输出新状态与领域事件，
 *  不读文件、不写文件、不取时间（时间由 Engine 注入）。
 */

/** 公司状态空骨架（与 state/company.js 的 empty 保持同构）。 */
export function emptyCompanyState() {
  return { company: {}, employees: [], meetings: [], recruiting: [], ceo: {}, headhunter: {}, tasks: [], updatedAt: '' }
}

/** 领域事件工厂：一次状态迁移产生一条可审计事件（对应 superagent 的 DomainEvents）。 */
export function companyEvent(action, at) {
  const a = action || {}
  return {
    type: 'company',
    at,
    data: {
      action: String(a.type || ''),
      role: a.role || a.position || '',
      meetingId: (a.meeting && a.meeting.id) || a.meetingId || '',
    },
  }
}

const CEO_ROLES = new Set(['CEO', 'ceo', '老板', '主面板'])

/**
 * 把一个公司动作施加到状态上（纯函数）。
 * @returns {{changed: boolean, reason?: string}} 就地修改 state；changed=false 表示无迁移（未知动作/无可变记录）。
 */
export function applyCompanyActionTo(state, action, now = '') {
  const a = action || {}
  const stamp = (len) => (now || new Date().toISOString()).slice(0, len)

  if (a.type === 'meeting_started' && a.meeting) {
    const m = state.meetings.find((x) => x.id === a.meeting.id)
    const attendees = (a.meeting.attendees || []).map((x) => String(x).trim()).filter(Boolean)
    if (m) { m.status = 'in_progress'; if (attendees.length) m.attendees = attendees }
    else state.meetings.push({ id: a.meeting.id || 'm' + (state.meetings.length + 1), type: a.meeting.type || '', topic: a.meeting.topic || '', attendees, status: 'in_progress' })
    for (const emp of state.employees) {
      if (attendees.includes(emp.role) && !CEO_ROLES.has(emp.role)) {
        if (emp._prevStatus === undefined) emp._prevStatus = emp.status
        emp.status = 'meeting'
      }
    }
    return { changed: true }
  }

  if (a.type === 'meeting_done' && a.meetingId) {
    const m = state.meetings.find((x) => x.id === a.meetingId)
    const attendees = (m && Array.isArray(m.attendees) ? m.attendees : []).map((x) => String(x).trim()).filter(Boolean)
    if (m) m.status = 'done'
    for (const emp of state.employees) {
      if (attendees.includes(emp.role) && !CEO_ROLES.has(emp.role) && emp.status === 'meeting') {
        emp.status = emp._prevStatus || 'working'; emp.lastMeetingAt = stamp(16)
        delete emp._prevStatus
      }
    }
    return { changed: true }
  }

  if (a.type === 'employee_evaluated' && a.role) {
    const emp = state.employees.find((e) => e.role === a.role)
    const rec = { role: a.role, persona: (emp && emp.persona) || a.persona || '', perfScore: a.score, strikes: a.strikes, status: a.status || (emp && emp.status) || 'working', note: a.note || '' }
    if (emp) Object.assign(emp, rec)
    else state.employees.push(rec)
    return { changed: true }
  }

  if (a.type === 'employee_terminated' && a.role) {
    const emp = state.employees.find((e) => e.role === a.role)
    if (emp) { emp.status = 'terminated'; emp.terminatedAt = stamp(10); emp.note = a.note || emp.note || '' }
    const role = a.role
    const activeRec = state.recruiting.find((r) => r.position === role && (r.status === 'confirmed' || r.status === 'searching' || r.status === 'interviewing') && r.hiredRole !== role)
    if (activeRec) {
      activeRec.status = 'searching'; activeRec.hiredRole = undefined
    } else {
      const exists = state.recruiting.some((r) => r.position === role && r.status !== 'cancelled')
      if (!exists) state.recruiting.push({ id: 'r' + (state.recruiting.length + 1), position: role, targetPersona: a.targetPersona || '', candidates: [], status: 'searching', replacesEmp: a.replaces || role, reason: '补位：' + (a.note || '员工离任') })
    }
    return { changed: true }
  }

  if (a.type === 'employee_hired' && a.role) {
    state.employees.push({ role: a.role, persona: a.persona || '', status: 'working', hiredAt: stamp(10), replaces: a.replaces || '' })
    const hiredRole = a.role
    const replacedEmp = a.replaces || ''
    for (const r of state.recruiting) {
      if (r.status === 'searching' || r.status === 'interviewing') {
        if (r.position === hiredRole || (replacedEmp && r.replacesEmp === replacedEmp)) {
          r.status = 'confirmed'
          r.hiredRole = hiredRole
        }
      }
    }
    return { changed: true }
  }

  if (a.type === 'employee_started' && a.role) {
    const emp = state.employees.find((e) => e.role === a.role)
    if (emp) { emp.status = 'working'; emp.currentWork = a.currentWork || ''; emp.lastStartedAt = stamp(16) }
    return { changed: true }
  }

  if (a.type === 'employee_reporting' && a.role) {
    const emp = state.employees.find((e) => e.role === a.role)
    if (emp) { emp.status = 'reporting'; emp.lastReportAt = stamp(16); if (a.note) emp.lastReport = a.note }
    return { changed: true }
  }

  if (a.type === 'recruiting_started' && a.position) {
    state.recruiting.push({ id: 'r' + (state.recruiting.length + 1), position: a.position, targetPersona: a.targetPersona || '', candidates: [], status: 'searching', replacesEmp: a.replacesEmp || '' })
    return { changed: true }
  }

  if (a.type === 'recruiting_interviewing' && a.position) {
    const recs = state.recruiting.filter((r) => r.position === a.position && r.status === 'searching')
    if (!recs.length) return { changed: false, reason: '没有 searching 的该岗位记录可转 interviewing' }
    recs.forEach((r) => { r.status = 'interviewing'; r.interviewAt = stamp(16) })
    return { changed: true }
  }

  return { changed: false, reason: '未知动作' }
}

/** 谓词：是否在等一个人（对应 superagent 的 waitsForPerson）。最新报告 blocked/failed 且其后无人介入。 */
export function waitingForPerson(employee) {
  return Boolean(employee && (employee.status === 'blocked' || employee.status === 'failed') && !employee.lastHumanAt)
}

/** 谓词：一条决定是否已落定（对应 superagent 的 settled；stop/unavailable 类不算）。 */
export function settled(decision) {
  return Boolean(decision && decision.outcome !== 'stop' && decision.outcome !== 'unavailable' && decision.outcome !== 'refused')
}
