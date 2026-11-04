/** 任务单生命周期：开单 → 派单 → 汇报 → 重试/停止 → 结束（移植自 prototype `core/tickets.ts` 的核心语义）。
 *  只通过 Repositories/Executor 端口落盘与执行；事务由 repo.atomic 包住。 */
import { canRetry } from './stage.js'
import { latestAssignment, liveTicket, nowIso, REPORT_STATES } from './model.js'
import { REASONS, reasonText } from './reasons.js'

const SEQ = { n: 0 }

function defaultId(prefix) {
  SEQ.n += 1
  return `${prefix}-${Date.now().toString(36)}${SEQ.n.toString(36)}`
}

/** 领域错误：带结构化 reason，调用方按 code 判定。 */
export class TicketError extends Error {
  constructor(code, values = {}) {
    super(reasonText({ code, values }))
    this.code = code
    this.values = values
  }
}

export class Tickets {
  /** @param {{repo:import('./ports.js').Repositories, executor:import('./ports.js').Executor, clock?:import('./ports.js').Clock, idFactory?:(p:string)=>string, onEvent?:(type:string,data:object)=>void}} options */
  constructor(options) {
    this.repo = options.repo
    this.executor = options.executor
    this.clock = options.clock || { now: nowIso }
    this.idFactory = options.idFactory || defaultId
    this.onEvent = options.onEvent || (() => {})
  }

  now() {
    return this.clock.now()
  }

  emit(type, data) {
    try { this.onEvent(type, data) } catch { /* 事件监听失败不影响领域事务 */ }
  }

  /** 取任务单，不存在抛错。 */
  require(ticketId) {
    const ticket = this.repo.tickets.get(ticketId)
    if (!ticket) throw new TicketError('unknownTicket', { ticket: String(ticketId) })
    return ticket
  }

  /**
   * 开单：授权 + 首次派单（排队即启动），返回任务单。
   * @param {{title:string, project:string, stage?:string, role?:string, mandate?:object, meta?:object}} input
   */
  open(input) {
    const at = this.now()
    const id = this.idFactory('ticket')
    /** @type {import('./model.js').Ticket} */
    const ticket = {
      id,
      title: String(input.title || '').trim(),
      project: String(input.project || ''),
      stage: String(input.stage || 'build'),
      mandate: {
        strength: (input.mandate && input.mandate.strength) || 'inferred',
        basis: (input.mandate && input.mandate.basis) || 'open:unspecified',
        by: input.mandate && input.mandate.by,
        at,
        gate: input.mandate && input.mandate.gate,
      },
      assignments: [],
      createdAt: at,
      updatedAt: at,
      meta: input.meta,
      origin: input.origin,
    }
    const assignment = this.newAssignment(ticket, String(input.role || 'captain'))
    this.repo.tickets.save(ticket)
    this.executor.start(ticket, assignment)
    this.emit('ticket.created', { ticketId: id, assignmentId: assignment.id })
    return ticket
  }

  newAssignment(ticket, role) {
    const at = this.now()
    const assignment = { id: this.idFactory('asg'), state: 'running', role, createdAt: at, startedAt: at }
    ticket.assignments.push(assignment)
    ticket.updatedAt = at
    return assignment
  }

  /** 执行器确认派单已启动（幂等）。 */
  started(ticketId, assignmentId) {
    return this.repo.atomic(() => {
      const ticket = this.require(ticketId)
      const assignment = (ticket.assignments || []).find((a) => a.id === assignmentId)
      if (!assignment || assignment.state === 'ended') return ticket
      if (assignment.state !== 'running') { assignment.state = 'running'; assignment.startedAt = this.now() }
      ticket.updatedAt = this.now()
      this.repo.tickets.save(ticket)
      this.emit('assignment.started', { ticketId, assignmentId })
      return ticket
    })
  }

  /**
   * 成员汇报：progress/waiting 保持进行中；ready/dropped 结束任务单；blocked/failed 保持开启等人工。
   * @param {string} ticketId
   * @param {{assignmentId?:string, state:'progress'|'waiting'|'ready'|'blocked'|'failed'|'dropped', summary?:string}} report
   */
  report(ticketId, report) {
    return this.repo.atomic(() => {
      const ticket = this.require(ticketId)
      if (ticket.ended) throw new TicketError('ticketEnded', { ticket: ticketId, outcome: ticket.ended.outcome })
      if (!report || !REPORT_STATES.includes(report.state)) throw new TicketError('badReport', { state: String(report && report.state) })
      const assignment = report.assignmentId
        ? (ticket.assignments || []).find((a) => a.id === report.assignmentId)
        : latestAssignment(ticket)
      if (!assignment || assignment.state === 'ended') throw new TicketError('assignmentMismatch', { assignment: String(report.assignmentId || '') })
      const at = this.now()
      const summary = String(report.summary || '')
      assignment.report = { state: report.state, summary, at }
      ticket.updatedAt = at
      this.repo.tickets.save(ticket)
      this.emit('report.recorded', { ticketId, assignmentId: assignment.id, state: report.state })
      if (report.state === 'ready' || report.state === 'dropped') {
        return this.end(ticketId, 'executor', report.state === 'ready' ? 'completed' : 'dropped', at)
      }
      return this.require(ticketId)
    })
  }

  /** 重试：结束卡住的派单，按同一授权开新派单。 */
  retry(ticketId) {
    return this.repo.atomic(() => {
      const ticket = this.require(ticketId)
      if (!liveTicket(ticket) || !canRetry(ticket)) throw new TicketError('notRetryable')
      const previous = latestAssignment(ticket)
      if (previous) {
        previous.state = 'ended'
        previous.endedAt = this.now()
        previous.endedReason = 'retried'
      }
      this.repo.tickets.save(ticket)
      const assignment = this.newAssignment(ticket, (previous && previous.role) || 'captain')
      this.repo.tickets.save(ticket)
      if (previous) this.executor.stop && this.executor.stop(ticket, previous, 'retried')
      this.executor.start(ticket, assignment)
      this.emit('assignment.retried', { ticketId, assignmentId: assignment.id, previous: previous && previous.id })
      return this.require(ticketId)
    })
  }

  /** 人工停止（授权随之失效，任务单结束）。 */
  stop(ticketId, reason = '') {
    return this.repo.atomic(() => this.end(ticketId, 'human', 'stopped', this.now(), reason))
  }

  /** 结束任务单：结束进行中的派单、记 ended、落盘、发事件。 */
  end(ticketId, by, outcome, at, reason) {
    const ticket = this.require(ticketId)
    if (ticket.ended) return ticket
    for (const assignment of ticket.assignments || []) {
      if (assignment.state === 'ended') continue
      assignment.state = 'ended'
      assignment.endedAt = at
      assignment.endedReason = reason || outcome
    }
    ticket.ended = { at, by, outcome, reason: reason ? String(reason) : undefined }
    ticket.updatedAt = at
    this.repo.tickets.save(ticket)
    this.emit('ticket.ended', { ticketId, by, outcome })
    return ticket
  }
}
