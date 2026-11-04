/** 领域模型：任务单（Ticket）及其派单（Assignment）、汇报（Report）、阶段（Stage）与授权（Mandate）。
 *  移植自 dsh-superagent-prototype `core/model.ts` 的核心形状，领域改为「数字公司」：
 *  需求 → 裁决/闸授权 → 任务单 → 派单给成员 → 汇报 → 阶段推进 → 结束。
 *  本文件只有类型（JSDoc）与纯函数，不依赖 DSH、不碰文件系统。 */

/** 规范化时间戳为 ISO 形式（不可解析的原样返回）。 */
export function isoTime(value) {
  const t = Date.parse(String(value ?? ''))
  return Number.isFinite(t) ? new Date(t).toISOString() : String(value ?? '')
}

/** 当前 ISO 时间。 */
export function nowIso() {
  return new Date().toISOString()
}

/** 六阶段（与项目阶段机一致；core 只引用，不实现项目级判定）。 */
export const PROJECT_STAGES = ['clarify', 'decompose', 'design', 'build', 'verify', 'close']
export const STAGE_LABELS = {
  clarify: '澄清', decompose: '拆解', design: '设计', build: '实现', verify: '验收', close: '收口',
}

/** 派单状态：排队 / 执行中 / 已结束。 */
export const ASSIGNMENT_STATES = ['pending', 'running', 'ended']

/** 汇报状态（语义对齐 prototype）：进行中 / 等输入 / 可验收 / 阻塞 / 失败 / 无剩余工作。 */
export const REPORT_STATES = ['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped']

/** 结束方式：执行器正常结束 / 人工停止。 */
export const END_BY = ['executor', 'human']

/** 结束结果。 */
export const OUTCOMES = ['completed', 'merged', 'closed', 'dropped', 'stopped']

/** 授权强度：显式（用户明确要求）/ 推断（模型判断）。 */
export const STRENGTH = ['explicit', 'inferred']

/**
 * @typedef {object} Mandate 授权：任务单凭什么可以开工（闸通过的凭据，不可变）
 * @property {'explicit'|'inferred'} strength
 * @property {string} basis 依据（如 `gate:build ok` / `user:explicit`）
 * @property {string} [by] 授权方（用户名/CEO/captain）
 * @property {string} at
 * @property {string} [gate] 通过的是哪道闸
 */

/**
 * @typedef {object} Report 成员汇报
 * @property {'progress'|'waiting'|'ready'|'blocked'|'failed'|'dropped'} state
 * @property {string} summary
 * @property {string} at
 */

/**
 * @typedef {object} Assignment 派单：一个任务单与一次执行会话的绑定
 * @property {string} id
 * @property {'pending'|'running'|'ended'} state
 * @property {string} role 承接角色（如 研发/测试/CEO）
 * @property {string} createdAt
 * @property {string} [startedAt]
 * @property {string} [endedAt]
 * @property {string} [endedReason]
 * @property {Report} [report] 最近一次汇报
 */

/**
 * @typedef {object} Ticket 任务单：一次被授权的可交付工作
 * @property {string} id
 * @property {string} title
 * @property {string} project 项目标识（工作区键）
 * @property {'clarify'|'decompose'|'design'|'build'|'verify'|'close'} stage 所属阶段
 * @property {Mandate} mandate
 * @property {Assignment[]} assignments
 * @property {{at:string, by:'executor'|'human', outcome:string, reason?:string}} [ended]
 * @property {{triggerId:string, triggerIds:string[]}} [origin] 需求/事件的来源
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {Record<string,unknown>} [meta]
 */

/** 是否未结束。 */
export function liveTicket(ticket) {
  return !(ticket && ticket.ended)
}

/** 结束结果。 */
export function ticketOutcome(ticket) {
  return ticket && ticket.ended ? ticket.ended.outcome : undefined
}

/** 最近一次派单。 */
export function latestAssignment(ticket) {
  const list = (ticket && ticket.assignments) || []
  return list.length ? list[list.length - 1] : undefined
}

/** 最近一次有汇报的派单的汇报。 */
export function latestReport(ticket) {
  const list = (ticket && ticket.assignments) || []
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].report) return list[i].report
  return undefined
}

/** 正在执行的派单。 */
export function runningAssignment(ticket) {
  const list = (ticket && ticket.assignments) || []
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].state === 'running') return list[i]
  return undefined
}

/**
 * 是否在等人工：最近派单汇报 blocked/failed，且此后没有新的人工输入（新派单会先 end 旧派单，从而解除等待）。
 * @param {Ticket} ticket
 * @param {{at:string,human?:boolean}[]} [inputs] 该任务单收到的人工输入
 */
export function waitsForPerson(ticket, inputs = []) {
  const assignment = latestAssignment(ticket)
  const report = assignment && assignment.report
  if (!report || (report.state !== 'blocked' && report.state !== 'failed')) return false
  return !inputs.some((input) => input && input.human && String(input.at) > report.at)
}

/** 阶段标签。 */
export function stageLabel(stage) {
  return STAGE_LABELS[stage] || String(stage || '')
}
