/** 派单阶段分类与可重试判定（移植自 prototype `core/stage.ts` 的判定顺序，领域改为任务单/派单）。 */
import { latestAssignment, latestReport, waitsForPerson } from './model.js'

/**
 * 任务单当前处于哪种状态（按顺序命中第一条）：
 * - `ended`：已结束
 * - `person`：等人工（review=可验收 / blocked / failed / answer）
 * - `working`：执行中（`queued`=还有未启动的派单）
 * - `idle`：成员空转（最近汇报 waiting，或派单已结束但任务单未结束）
 * @param {import('./model.js').Ticket} ticket
 * @param {{at:string,human?:boolean}[]} [inputs]
 * @returns {{stage:'person',action:'review'|'blocked'|'failed'|'answer'}|{stage:'working',action?:'queued'}|{stage:'idle'}|{stage:'ended'}}
 */
export function ticketStage(ticket, inputs = []) {
  if (!ticket || ticket.ended) return { stage: 'ended' }
  const assignment = latestAssignment(ticket)
  const report = latestReport(ticket)
  if (report && report.state === 'ready') return { stage: 'person', action: 'review' }
  if (report && (report.state === 'blocked' || report.state === 'failed') && waitsForPerson(ticket, inputs)) {
    return { stage: 'person', action: report.state }
  }
  if (!assignment || assignment.state === 'pending') return { stage: 'working', action: 'queued' }
  if ((report && report.state === 'waiting') || assignment.state === 'ended') return { stage: 'idle' }
  return { stage: 'working' }
}

/** 是否可重试：未结束，且卡在「等人工的 blocked/failed」——重试=结束旧派单、按同一授权开新派单。 */
export function canRetry(ticket, inputs = []) {
  return !!(ticket && !ticket.ended && waitsForPerson(ticket, inputs))
}

/** 阶段的一句话中文描述（给工具/面板用）。 */
export function ticketStageText(ticket, inputs = []) {
  const s = ticketStage(ticket, inputs)
  if (s.stage === 'ended') return `已结束（${ticket && ticket.ended ? ticket.ended.outcome : 'unknown'}）`
  if (s.stage === 'person') {
    const m = { review: '待人工验收', blocked: '被阻塞，等人工', failed: '失败，等人工处理', answer: '等人工回答' }
    return m[s.action] || '等人工'
  }
  if (s.stage === 'idle') return '成员空转（等待唤醒）'
  return s.action === 'queued' ? '排队中' : '执行中'
}
