/** 公司状态（3D 办公室数据源）：<workspace>/.jarvis/company-state.json —— 工具动作自动同步。
 *
 *  两路落盘：① 宿主 fs 服务；② 失败/不可用时 node:fs 原子写（mkdir + tmp + rename）兜底。
 *  状态根守卫：显式 projectDir 指向插件仓库时拒写（防记忆文件污染插件仓库）。
 *  本模块只做「状态投影 + 落盘」，不做业务裁决（裁决在 tools/gates）。
 */
import { createRequire } from 'node:module'
import { resolveWorkspace, getRuntimeContext, getLatestExec } from '../runtime.js'
import { stateRootConflict } from '../gates/ownership.js'
const _require = createRequire(import.meta.url)

/** 公司状态文件路径（与 jarvis_company 同一文件，3D UI 数据源）。
 * projectDir 显式传入优先（T8：修「依赖进程级单例 → 写到 profile 目录」的落盘漂移）。 */
export function companyStateFile(projectDir) {
  const explicit = String(projectDir || '').trim()
  const cwd = explicit || resolveWorkspace(getRuntimeContext(), getLatestExec()) || (typeof process !== 'undefined' && process.cwd ? process.cwd() : '')
  return (cwd ? cwd + '/' : '') + '.jarvis/company-state.json'
}

/** 读公司状态（无文件 → 空骨架）。T8：fs 服务读失败/不可用 → node:fs 兜底读同一路径。 */
export async function readCompanyState(fsSvc, projectDir) {
  const empty = { company: {}, employees: [], meetings: [], recruiting: [], ceo: {}, headhunter: {}, tasks: [], updatedAt: '' }
  const file = companyStateFile(projectDir)
  if (fsSvc && typeof fsSvc.readText === 'function') {
    try {
      const target = await fsSvc.resolve(file)
      if (target) {
        const text = await fsSvc.readText(target)
        if (text) {
          const data = JSON.parse(text)
          if (data && typeof data === 'object') return { ...empty, ...data }
        }
      }
    } catch { /* 落 fallback */ }
  }
  try {
    const fs = _require('node:fs')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? { ...empty, ...data } : empty
  } catch { return empty }
}

/** 写公司状态。T8 修复（UI 数据源必须能落盘）：
 * ① 先走宿主 fs 服务（writeText）；② 服务不可用/写失败/抛错 → node:fs 兜底原子写（mkdir + .tmp + rename）到
 * <projectDir>/.jarvis/company-state.json；③ 两路都失败才算 failed。返回 {ok, mode} 供调用方如实回报。
 * 为什么之前会「无 fs 未落盘」：旧实现只认 fsSvc，且 handler 用相对路径 '.jarvis/company-state.json'
 * （resolve 依赖进程 cwd），于是 GUI 侧办公室永远没有员工/任务数据。 */
export async function writeCompanyState(fsSvc, state, projectDir) {
  const file = companyStateFile(projectDir)
  state.updatedAt = new Date().toISOString()
  const text = JSON.stringify(state, null, 2)
  if (fsSvc && typeof fsSvc.writeText === 'function') {
    try {
      const target = await fsSvc.resolve(file)
      if (target) {
        await fsSvc.writeText(target, text)
        return { ok: true, mode: 'fs-service' }
      }
    } catch { /* 落 node:fs 兜底 */ }
  }
  try {
    const fs = _require('node:fs')
    const path = _require('node:path')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)
    return { ok: true, mode: 'node-fs-fallback' }
  } catch { return { ok: false, mode: 'failed' } }
}

/**
 * 工具动作自动同步公司状态（3D 画面反映真实动作，不靠 CEO 手动 update）：
 *   action.meeting_started/meeting_done → meetings 表更新 + 参会员工 status=meeting/恢复 working
 *   action.employee_evaluated {role, score, strikes, status} → employees 表更新(perfScore/strikes/status)
 *   action.employee_terminated {role} → employees 表标 terminated + 自动触发猎头补位(recruiting 置回/新增 searching)
 *   action.employee_hired {role, persona} → employees 表加人 + 匹配 recruiting 自动 confirmed
 *   action.employee_reporting {role} → employees 表标 reporting
 *   action.employee_started {role} → employees 表标 working（领任务开工，状态从 idle/报到 变干活）
 *   action.recruiting_started {position} → recruiting 表加条(searching)
 *   action.recruiting_interviewing {position} → 匹配 recruiting 标 interviewing（猎头开始面试）
 */
export async function syncCompanyState(fsSvc, action) {
  // T8：不再强依赖 fs 服务——读/写都有 node:fs 兜底（见 readCompanyState/writeCompanyState 注释）
  try {
    const projectDir = String((action && action.projectDir) || '')
    // 状态根守卫：显式 projectDir 指向插件仓库时拒写（防记忆文件污染插件项目）
    if (projectDir && stateRootConflict(projectDir)) return false
    const state = await readCompanyState(fsSvc, projectDir)
    const a = action || {}
    // 会议：标会议状态 + 参会员工联动（进会议室=离开工位；散会=回工位继续干）
    if (a.type === 'meeting_started' && a.meeting) {
      const m = state.meetings.find((x) => x.id === a.meeting.id)
      const attendees = (a.meeting.attendees || []).map((x) => String(x).trim()).filter(Boolean)
      if (m) { m.status = 'in_progress'; if (attendees.length) m.attendees = attendees }
      else state.meetings.push({ id: a.meeting.id || 'm' + (state.meetings.length + 1), type: a.meeting.type || '', topic: a.meeting.topic || '', attendees, status: 'in_progress' })
      // 参会员工（角色名匹配）从工位状态 → meeting（3D：工位灯变"开会中"）
      const CEO_ROLES = new Set(['CEO', 'ceo', '老板', '主面板'])
      for (const emp of state.employees) {
        if (attendees.includes(emp.role) && !CEO_ROLES.has(emp.role)) {
          if (emp._prevStatus === undefined) emp._prevStatus = emp.status; // 记住开会前真实状态（idle/working/on_probation），散会时恢复
          emp.status = 'meeting'
        }
      }
    } else if (a.type === 'meeting_done' && a.meetingId) {
      const m = state.meetings.find((x) => x.id === a.meetingId)
      const attendees = (m && Array.isArray(m.attendees) ? m.attendees : []).map((x) => String(x).trim()).filter(Boolean)
      if (m) m.status = 'done'
      // 散会 → 参会员工恢复干活状态（3D：从会议室回工位）
      const CEO_ROLES = new Set(['CEO', 'ceo', '老板', '主面板'])
      for (const emp of state.employees) {
        if (attendees.includes(emp.role) && !CEO_ROLES.has(emp.role) && emp.status === 'meeting') {
          // 恢复开会前状态（_prevStatus），不是硬设 working——员工开会前可能是 idle/on_probation/working
          emp.status = emp._prevStatus || 'working'; emp.lastMeetingAt = new Date().toISOString().slice(0, 16)
          delete emp._prevStatus
        }
      }
    } else if (a.type === 'employee_evaluated' && a.role) {
      const emp = state.employees.find((e) => e.role === a.role)
      const rec = { role: a.role, persona: (emp && emp.persona) || a.persona || '', perfScore: a.score, strikes: a.strikes, status: a.status || (emp && emp.status) || 'working', note: a.note || '' }
      if (emp) Object.assign(emp, rec)
      else state.employees.push(rec)
    } else if (a.type === 'employee_terminated' && a.role) {
      const emp = state.employees.find((e) => e.role === a.role)
      if (emp) { emp.status = 'terminated'; emp.terminatedAt = new Date().toISOString().slice(0, 10); emp.note = a.note || emp.note || '' }
      // 开除/换人 → 自动触发猎头补位：已有该岗位 recruiting 记录则置回 searching，没有则新增一条
      const role = a.role
      const activeRec = state.recruiting.find((r) => r.position === role && (r.status === 'confirmed' || r.status === 'searching' || r.status === 'interviewing') && r.hiredRole !== role)
      if (activeRec) {
        activeRec.status = 'searching'; activeRec.hiredRole = undefined
      } else {
        const exists = state.recruiting.some((r) => r.position === role && r.status !== 'cancelled')
        if (!exists) state.recruiting.push({ id: 'r' + (state.recruiting.length + 1), position: role, targetPersona: a.targetPersona || '', candidates: [], status: 'searching', replacesEmp: a.replaces || role, reason: '补位：' + (a.note || '员工离任') })
      }
    } else if (a.type === 'employee_hired' && a.role) {
      state.employees.push({ role: a.role, persona: a.persona || '', status: 'working', hiredAt: new Date().toISOString().slice(0, 10), replaces: a.replaces || '' })
      // 注入完成 → 自动把匹配该岗位的 recruiting 标 confirmed（防 3D 画面显示"还在找"即使已入职）
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
    } else if (a.type === 'employee_started' && a.role) {
      const emp = state.employees.find((e) => e.role === a.role)
      if (emp) { emp.status = 'working'; emp.currentWork = a.currentWork || ''; emp.lastStartedAt = new Date().toISOString().slice(0, 16) }
    } else if (a.type === 'employee_reporting' && a.role) {
      const emp = state.employees.find((e) => e.role === a.role)
      if (emp) { emp.status = 'reporting'; emp.lastReportAt = new Date().toISOString().slice(0, 16); if (a.note) emp.lastReport = a.note }
    } else if (a.type === 'recruiting_started' && a.position) {
      state.recruiting.push({ id: 'r' + (state.recruiting.length + 1), position: a.position, targetPersona: a.targetPersona || '', candidates: [], status: 'searching', replacesEmp: a.replacesEmp || '' })
    } else if (a.type === 'recruiting_interviewing' && a.position) {
      // 猎头开始面试：searching → interviewing（3D：猎头状态从"在找"变"面试中"）
      const recs = state.recruiting.filter((r) => r.position === a.position && r.status === 'searching')
      if (recs.length) recs.forEach((r) => { r.status = 'interviewing'; r.interviewAt = new Date().toISOString().slice(0, 16) })
      else return false // 没有 searching 的该岗位记录可转 interviewing——不改
    } else {
      return false // 未知动作不改
    }
    const w = await writeCompanyState(fsSvc, state, String((action && action.projectDir) || ''))
    return Boolean(w && w.ok)
  } catch { return false }
}
