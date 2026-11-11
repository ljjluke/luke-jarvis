/** 结构化 reason 码：裁决/拒绝/重试/结束等结论的统一理由（可机读 + 可渲染）。
 *  移植自 dsh-superagent-prototype `core/reasons.ts`，模板改中文、码表收敛到 luke-jarvis 的域。 */

export const REASONS = {
  /** 原文引用 */
  said: '{text}',
  /** 阶段闸未过：缺产物或校验失败 */
  gateBlocked: '阶段闸未通过：{gate}',
  /** 状态根冲突：插件仓库不是 jarvis 状态根 */
  stateRootConflict: '插件仓库自身不是 jarvis 状态根：拒绝写入 .jarvis/',
  /** 任务单不存在 */
  unknownTicket: '任务单不存在：{ticket}',
  /** 任务单已结束 */
  ticketEnded: '任务单已结束：{ticket}（{outcome}）',
  /** 人工停止 */
  humanStop: '人工停止：{reason}',
  /** 汇报状态非法 */
  badReport: '非法汇报状态：{state}（允许 progress/waiting/ready/blocked/failed/dropped）',
  /** 汇报与派单不匹配 */
  assignmentMismatch: '汇报所指派单不属于该任务单：{assignment}',
  /** 不可重试 */
  notRetryable: '当前状态不可重试（仅 blocked/failed/派发失败可重试）',
  /** 已重试 */
  retried: '已重试：新派单 {assignment}',
  /** 完成 */
  completed: '交付完成',
  /** 丢弃 */
  dropped: '无剩余工作，丢弃',
  /** 等待人工 */
  waiting: '等待人工输入',
  /** 阻塞 */
  blocked: '阻塞：{summary}',
  /** 失败 */
  failed: '失败：{summary}',
  /** 进行中 */
  progress: '进行中：{summary}',
  /** 无派单可汇报 */
  noAssignment: '任务单没有进行中的派单',
}

/** @typedef {keyof typeof REASONS | (string & {})} ReasonCode */

/** @typedef {{ code: ReasonCode, values?: Record<string,string>, ticketId?: string }} Reason */

/** 构造「原文引用」理由。 */
export function said(text) {
  return { code: 'said', values: { text: String(text ?? '') } }
}

/** 渲染理由为一行中文（带 ticketId 前缀）。 */
export function reasonText(reasons) {
  const list = reasons === undefined || reasons === null ? [] : Array.isArray(reasons) ? reasons : [reasons]
  return list.map((reason) => {
    const template = REASONS[reason.code] ?? String(reason.code)
    const text = template.replace(/\{(\w+)\}/g, (match, name) => (reason.values && reason.values[name] !== undefined ? String(reason.values[name]) : match))
    return reason.ticketId ? `${reason.ticketId}: ${text}` : text
  }).join('；')
}
