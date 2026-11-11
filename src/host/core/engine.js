/** 领域引擎：core 的唯一入口（移植自 prototype `core/engine.ts` 的角色划分）。
 *  职责：裁决（闸/授权）→ 开单 → 派单 → 汇报 → 重试/停止 → 结束；所有变更走 repo.atomic，副作用走端口。 */
import { Tickets, TicketError } from './tickets.js'
import { ticketStage, ticketStageText, canRetry } from './stage.js'
import { latestAssignment, liveTicket, nowIso } from './model.js'
import { allowAllPolicy, noopExecutor, systemClock } from './ports.js'
import { reasonText } from './reasons.js'

const SEQ = { n: 0 }
const defaultId = (prefix) => `${prefix}-${Date.now().toString(36)}${(++SEQ.n).toString(36)}`

export class Engine {
  /**
   * @param {{repo:import('./ports.js').Repositories, executor?:import('./ports.js').Executor, policy?:import('./ports.js').Policy,
   *   clock?:import('./ports.js').Clock, outbox?:import('./ports.js').Outbox, idFactory?:(p:string)=>string, onEvent?:(type:string,data:object)=>void}} options
   */
  constructor(options) {
    this.repo = options.repo
    this.policy = options.policy || allowAllPolicy
    this.outbox = options.outbox
    this.clock = options.clock || systemClock
    this.idFactory = options.idFactory || defaultId
    this.onEvent = options.onEvent || (() => {})
    this.tickets = new Tickets({
      repo: this.repo,
      executor: options.executor || noopExecutor,
      clock: this.clock,
      idFactory: this.idFactory,
      onEvent: (type, data) => { this.emit(type, data) },
    })
  }

  now() { return this.clock.now() }
  emit(type, data) { try { this.onEvent(type, data) } catch { /* 监听失败不影响事务 */ } }

  /**
   * 裁决一个需求：过闸 → 记录 decision → 通过则开任务单。
   * @param {{title:string, project:string, stage?:string, role?:string, mandate?:object, origin?:object, triggerId?:string}} input
   * @returns {{decision:object, ticket?:object}}
   */
  adjudicate(input) {
    return this.repo.atomic(() => {
      const at = this.now()
      const gate = this.policy.gate({ ticket: null, stage: String(input.stage || 'build'), action: 'open' })
      const decision = {
        id: this.idFactory('decision'),
        kind: gate.ok !== false ? 'accept' : 'ignore',
        at,
        project: String(input.project || ''),
        stage: String(input.stage || 'build'),
        reason: gate.ok !== false ? [{ code: 'said', values: { text: '闸通过，开单' } }] : [{ code: 'gateBlocked', values: { gate: reasonText(gate.reason) } }],
        strength: (input.mandate && input.mandate.strength) || 'inferred',
      }
      this.repo.decisions.save(decision)
      this.emit('decision.recorded', { decisionId: decision.id, kind: decision.kind })
      if (gate.ok === false) return { decision }
      const ticket = this.tickets.open({
        ...input,
        role: input.role || 'captain',
        mandate: { ...(input.mandate || {}), basis: (input.mandate && input.mandate.basis) || gate.basis || 'gate:ok' },
      })
      decision.ticketId = ticket.id
      this.repo.decisions.save(decision)
      return { decision, ticket }
    })
  }

  /** 成员汇报（按任务单当前派单或显式派单 id）。 */
  report(ticketId, report) {
    return this.tickets.report(ticketId, report)
  }

  /** 重试（等价 prototype 的 retryTicket）。 */
  retry(ticketId) {
    return this.tickets.retry(ticketId)
  }

  /** 人工停止。 */
  stop(ticketId, reason = '') {
    return this.tickets.stop(ticketId, reason)
  }

  /** 执行器确认派单启动。 */
  started(ticketId, assignmentId) {
    return this.tickets.started(ticketId, assignmentId)
  }

  /** 取任务单（不存在返回 undefined）。 */
  get(ticketId) {
    return this.repo.tickets.get(ticketId)
  }

  /** 未结束任务单（新的在前）。 */
  open() {
    return this.repo.tickets.open ? this.repo.tickets.open() : this.repo.tickets.list().filter(liveTicket)
  }

  /** 全部任务单（新的在前）。 */
  list() {
    return this.repo.tickets.list()
  }

  /** 任务单视图：阶段、文案、最近派单、可重试性。 */
  view(ticketId, inputs = []) {
    const ticket = this.get(ticketId)
    if (!ticket) return undefined
    const stage = ticketStage(ticket, inputs)
    return {
      ticket,
      stage,
      text: ticketStageText(ticket, inputs),
      assignment: latestAssignment(ticket),
      retryable: canRetry(ticket, inputs),
      open: liveTicket(ticket),
    }
  }
}

export { TicketError, Tickets }
