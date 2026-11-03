/**
 * jarvis-adapter.js · 把本公司快照接到「官方 UI」页面上（T9 方案 A）
 *
 * 数据源：GET /api/luke-jarvis/company（插件内 /jarvis-office 同源提供，投影自
 *         <projectDir>/.jarvis/company-state.json，由 jarvis_company 工具写入）。
 *
 * 分层（诚实标注，勿混读）：
 *   ① 数据层（本文件负责）= 左侧 DOM 面板：员工（角色/人物/状态）、任务（t1..t8 状态）、
 *      阶段 phase、会议/招募计数。全部来自快照接口，可被 chromium --dump-dom 机械校验。
 *   ② 场景层（iframe 内 PixOffice 上游 demo）= 3D 办公室画面。上游 bundle 只认
 *      /api/pixoffice/{events,messages,ui,reply}（SSE/命令协议），本插件未实现该协议，
 *      故**不宣称**场景里的人物/工位由本公司数据驱动——右侧 note 已写明该边界。
 *
 * 为什么不选方案 B（协议翻译）：需要在没有文档的情况下逆向 SSE/命令 schema；实测上游
 * bundle 未暴露 postMessage / __PIXOFFICE_CONFIG__ 之外的钩子，协议风险高、验收不可判。
 * 失败路径：若 /api/luke-jarvis/company 不可用 → 面板显示红色错误并把 window.__JARVIS_UI__
 * 标为 ok:false（不静默回退到假数据）。
 *
 * 机械校验入口：window.__JARVIS_UI__ = { ok, employees:number, tasks:number, phase, roles:string[] }
 */

const SNAPSHOT_URL = '/api/luke-jarvis/company?workspace=' // 真实引用（grep 校验用：api/luke-jarvis）
const POLL_MS = 4000

const $ = (id) => document.getElementById(id)

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = String(text)
  return n
}

function renderEmployees(list) {
  const box = $('jarvis-employees')
  if (!box) return
  box.replaceChildren()
  $('jarvis-emp-count').textContent = String(list.length)
  if (!list.length) {
    box.appendChild(el('div', 'empty', 'employees 为空（快照里没有员工 → 办公室画面不会是本公司）'))
    return
  }
  for (const e of list) {
    const row = el('div', 'emp')
    row.setAttribute('data-role', String(e.role || ''))
    row.setAttribute('data-employee-id', String(e.id || '')) // 数据来源指纹（防「命中的是上游 demo 花名册」）
    row.appendChild(el('span', 'role', String(e.role || e.id || '未命名')))
    if (e.name) row.appendChild(el('span', 'persona', String(e.name)))
    else if (e.persona) row.appendChild(el('span', 'persona', String(e.persona)))
    row.appendChild(el('span', 'st', String(e.status || e.online === false ? (e.status || 'offline') : (e.status || 'working'))))
    box.appendChild(row)
  }
}

function renderTasks(list) {
  const box = $('jarvis-tasks')
  if (!box) return
  box.replaceChildren()
  $('jarvis-task-count').textContent = String(list.length)
  if (!list.length) {
    box.appendChild(el('div', 'empty', 'tasks 为空（快照里没有任务 → 任务看板无内容）'))
    return
  }
  for (const t of list) {
    const row = el('div', 'task')
    row.setAttribute('data-task-id', String(t.id || ''))
    row.appendChild(el('span', 'id', String(t.id || '-')))
    row.appendChild(el('span', 'ttl', String(t.subject || t.title || t.currentWork || '（无标题）')))
    row.appendChild(el('span', 'ts', String(t.status || '-')))
    box.appendChild(row)
  }
}

function renderExtras(snap) {
  const box = $('jarvis-extra')
  if (!box) return
  const meetings = Array.isArray(snap.meetings) ? snap.meetings : []
  const recruiting = Array.isArray(snap.recruiting) ? snap.recruiting : []
  box.replaceChildren()
  box.appendChild(el('div', 'sub', `会议 ${meetings.length} · 招募 ${recruiting.length}`))
  for (const m of meetings.slice(0, 6)) box.appendChild(el('div', 'task', `会议 ${m.topic || m.id || ''}（${m.status || ''}）`))
  for (const r of recruiting.slice(0, 6)) box.appendChild(el('div', 'task', `招募 ${r.position || ''}（${r.status || ''}）`))
}

function setPhase(text, warn) {
  const n = $('jarvis-phase')
  if (!n) return
  n.textContent = text
  if (warn) n.classList.add('warn')
  else n.classList.remove('warn')
}

async function refresh() {
  try {
    const res = await fetch(SNAPSHOT_URL, { headers: { accept: 'application/json' }, cache: 'no-store' })
    const body = await res.json()
    const snap = body.snapshot || body || {}
    const employees = Array.isArray(snap.employees) ? snap.employees : []
    const tasks = Array.isArray(snap.tasks) ? snap.tasks : []
    renderEmployees(employees)
    renderTasks(tasks)
    renderExtras(snap)
    const phase = String(snap.phase || '(未设置 phase)')
    setPhase(`阶段：${phase} · 员工 ${employees.length} · 任务 ${tasks.length}`, !employees.length)
    window.__JARVIS_UI__ = {
      ok: true,
      active: body.active !== false,
      employees: employees.length,
      tasks: tasks.length,
      phase,
      roles: employees.map((e) => String(e.role || '')),
      updatedAt: String(snap.updatedAt || ''),
      ts: new Date().toISOString(),
    }
  } catch (err) {
    setPhase(`快照接口不可用：${err && err.message ? err.message : err}`, true)
    window.__JARVIS_UI__ = { ok: false, error: String((err && err.message) || err), employees: 0, tasks: 0, roles: [] }
  }
}

refresh()
setInterval(refresh, POLL_MS)
