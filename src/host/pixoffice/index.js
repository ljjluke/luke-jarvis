import { toPixOfficeSnapshot } from '../office-bridge.js'

// ══════════════════════════════════════════════════════════════════════════════════
// T11：PixOffice relay 协议（方案B）——把 company-state 投影成「场景快照帧 + 命令」
//
// 上游事实（T9 逆向实测）：页面 EventSource(<relayUrl>/api/pixoffice/events?...)，只认 onmessage、
// 单帧 JSON（>512KB 丢弃）；快照里 employees[].sceneActorId 必须落在 readActors() 的演员集合内，
// 否则 INVALID_BINDING 整批丢弃；seq 必填且单调，同 seq 内容变 → 409；无 actor.create 命令，
// 员工只能靠快照 initialize 一次性换绑。
// 纯函数集中在这里，便于单测与探针脚本复用（不做 IO）。
// ══════════════════════════════════════════════════════════════════════════════════

/** 上游 readActors() 的演员 id 白名单（T9 实测：office-lead/review-agent/data-agent/file-agent/app-agent/code-agent） */
export const PIXOFFICE_ACTOR_IDS = Object.freeze(['office-lead', 'review-agent', 'data-agent', 'file-agent', 'app-agent', 'code-agent'])
const PIXOFFICE_ACTOR_SET = new Set(PIXOFFICE_ACTOR_IDS)
/** 上游 schema 上限 */
export const PIXOFFICE_LIMITS = Object.freeze({ employees: 200, tasks: 1000, events: 500 })
/** 上游命令白名单（超出白名单的命令必须被拒绝，而不是静默吞掉） */
export const PIXOFFICE_COMMANDS = Object.freeze([
  'map.edit', 'activity.start', 'activity.stop', 'command.cancel', 'actor.presentation.set', 'object.state.set',
])

/**
 * 由 company-state 生成「场景快照帧」。
 * @param {object} state company-state（employees/tasks/meetings/recruiting/ceo/headhunter）
 * @param {object} opts  {seq, workspaceId, workspaceName}
 */
export const PIXOFFICE_EVENT_KINDS = Object.freeze(['note', 'task.assigned', 'task.started', 'task.blocked', 'task.completed'])
const PIXOFFICE_EVENT_KIND_SET = new Set(PIXOFFICE_EVENT_KINDS)

/**
 * 上游 events.kind 是**枚举**（note/task.assigned/task.started/task.blocked/task.completed），
 * 超出枚举整帧会被 zod 拒绝（不是逐条容错）。office-bridge 投影出的 meeting.xxx / recruiting.xxx / employee.xxx / ceo.xxx
 * 都是 ours 的语义，落到上游只能压成 note（summary 保留原文，信息不丢）。
 */
export function normalizeEventKind(kind) {
  const k = String(kind || '')
  if (PIXOFFICE_EVENT_KIND_SET.has(k)) return k
  if (k === 'task.assigned' || k === 'task.started') return k
  return 'note'
}

/** 由 company-state 生成「场景快照帧」：**信封必须对齐上游** {type:'office.sync', snapshot: {...}} */
export function buildPixOfficeFrame(state, opts = {}) {
  const seq = Number(opts.seq)
  const safeSeq = Number.isInteger(seq) && seq > 0 ? seq : 1
  const snap = toPixOfficeSnapshot(state, {
    seq: safeSeq,
    workspaceId: String(opts.workspaceId || 'jarvis-workspace'),
    workspaceName: String(opts.workspaceName || 'jarvis'),
  })
  const normalized = {
    ...snap,
    seq: safeSeq,
    employees: (Array.isArray(snap.employees) ? snap.employees : []).slice(0, PIXOFFICE_LIMITS.employees),
    tasks: (Array.isArray(snap.tasks) ? snap.tasks : []).slice(0, PIXOFFICE_LIMITS.tasks),
    events: (Array.isArray(snap.events) ? snap.events : [])
      .slice(0, PIXOFFICE_LIMITS.events)
      .map((e) => ({ ...e, kind: normalizeEventKind(e && e.kind), summary: String((e && e.summary) || '').slice(0, 300) || '（无摘要）' })),
  }
  // 上游 receive 用 zod 联合体分派：office.sync / office.sync.start / office.sync.complete，其余落到 safeParse 失败
  return { type: 'office.sync', seq: safeSeq, snapshot: normalized }
}

/**
 * 校验帧：返回 {ok, errors:[{code,message}]}。error code 与上游一致（便于页面/日志识别）。
 * INVALID_BINDING：sceneActorId 不在演员表（上游会整批丢弃）；SEQ_REQUIRED：缺 seq。
 */
export function validatePixOfficeFrame(frame) {
  const errors = []
  const outer = frame && typeof frame === 'object' ? frame : {}
  // 兼容两种入参：完整信封 {type:'office.sync', snapshot} 与裸快照（历史用例）
  const f = outer.snapshot && typeof outer.snapshot === 'object' ? outer.snapshot : outer
  if (outer.type !== 'office.sync') {
    errors.push({ code: 'ENVELOPE_INVALID', message: `帧信封必须是 {type:'office.sync', snapshot}（上游 zod 联合体只认 office.sync/office.sync.start/office.sync.complete；实际 type=${outer.type || '(空)'}）` })
  }
  const seq = Number(f.seq || outer.seq)
  if (!Number.isInteger(seq) || seq <= 0) errors.push({ code: 'SEQ_REQUIRED', message: 'seq 必填且为正整数（上游据此判重/拒绝乱序）' })
  if (!f.workspace || !f.workspace.id) errors.push({ code: 'WORKSPACE_REQUIRED', message: 'workspace.id 必填且同一工作区不可变' })
  const employees = Array.isArray(f.employees) ? f.employees : []
  if (employees.length > PIXOFFICE_LIMITS.employees) errors.push({ code: 'EMPLOYEES_LIMIT', message: `employees 超上限 ${PIXOFFICE_LIMITS.employees}` })
  for (const e of employees) {
    const actor = String((e && e.sceneActorId) || '')
    if (!PIXOFFICE_ACTOR_SET.has(actor)) {
      errors.push({ code: 'INVALID_BINDING', message: `sceneActorId=${actor || '(空)'} 不在上游演员表（会被整批丢弃）` })
    }
  }
  const tasks = Array.isArray(f.tasks) ? f.tasks : []
  if (tasks.length > PIXOFFICE_LIMITS.tasks) errors.push({ code: 'TASKS_LIMIT', message: `tasks 超上限 ${PIXOFFICE_LIMITS.tasks}` })
  const events = Array.isArray(f.events) ? f.events : []
  if (events.length > PIXOFFICE_LIMITS.events) errors.push({ code: 'EVENTS_LIMIT', message: `events 超上限 ${PIXOFFICE_LIMITS.events}` })
  for (const e of events) {
    const kind = String((e && e.kind) || '')
    if (!PIXOFFICE_EVENT_KIND_SET.has(kind)) errors.push({ code: 'EVENT_KIND_INVALID', message: `event kind=${kind || '(空)'} 不在上游枚举（会被整帧拒绝）` })
    const summary = String((e && e.summary) || '')
    if (!summary || summary.length > 300) errors.push({ code: 'EVENT_SUMMARY_INVALID', message: `event summary 长度须 1..300（实际 ${summary.length}）` })
  }
  return { ok: errors.length === 0, errors }
}

/** SSE 帧字符串（EventSource 只吃 `data: <json>\n\n`；单帧 JSON，勿拆多行外层字段） */
export function sseFrameString(frame) {
  return 'data: ' + JSON.stringify(frame) + '\n\n'
}

/**
 * seq 决策（幂等 + 断线续）：同 seq 同内容 → duplicate（不重发）；同 seq 不同内容 → conflict（409）；
 * 新 seq 大于上一条 → fresh。
 */
export function relaySeqDecision(prev, frame) {
  const seq = Number(frame && frame.seq)
  if (!prev || !Number.isInteger(Number(prev.seq))) return { status: 'fresh', seq }
  if (seq < Number(prev.seq)) return { status: 'conflict', seq, reason: 'seq 回退（上游会拒绝乱序）' }
  if (seq === Number(prev.seq)) {
    const same = String(prev.hash || '') === String(frameHash(frame))
    return { status: same ? 'duplicate' : 'conflict', seq, reason: same ? '同 seq 同内容（幂等跳过）' : '同 seq 内容不同（上游 409）' }
  }
  return { status: 'fresh', seq }
}

/** 帧内容哈希（FNV-1a；用于 seq 判重，不含 seq 本身） */
export function frameHash(frame) {
  const body = JSON.stringify({ ...(frame || {}), seq: undefined })
  let h = 0x811c9dc5
  for (let i = 0; i < body.length; i += 1) {
    h ^= body.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(36)
}

/** 命令校验：白名单内 → {ok:true}；否则 {ok:false, code:'COMMAND_NOT_ALLOWED'}（不静默吞） */
export function validatePixOfficeCommand(command) {
  const c = String((command && command.command) || command || '')
  if (!PIXOFFICE_COMMANDS.includes(c)) {
    return { ok: false, code: 'COMMAND_NOT_ALLOWED', allowed: [...PIXOFFICE_COMMANDS], message: `命令 ${c || '(空)'} 不在上游白名单` }
  }
  if (!command || typeof command !== 'object' || !command.payload || typeof command.payload !== 'object') {
    return { ok: false, code: 'PAYLOAD_REQUIRED', message: '命令必须带 payload 对象' }
  }
  return { ok: true, command: c }
}
