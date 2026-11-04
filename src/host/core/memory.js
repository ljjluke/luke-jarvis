/** 内存仓储：测试与预演用的 Repositories 实现（移植自 prototype `core/memory.ts`）。
 *  每个方法 clone 存取，调用方改返回对象不影响仓储；`atomic` 用快照回滚。 */

const clone = (value) => (value === undefined ? undefined : structuredClone(value))

export class MemoryRepositories {
  constructor() {
    /** @type {Map<string, any>} */
    this.ticketRows = new Map()
    /** @type {Map<string, any>} */
    this.decisionRows = new Map()
  }

  atomic(work) {
    const tickets = new Map(this.ticketRows)
    const decisions = new Map(this.decisionRows)
    try {
      return work()
    } catch (error) {
      this.ticketRows = tickets
      this.decisionRows = decisions
      throw error
    }
  }

  get tickets() {
    const rows = this.ticketRows
    const list = () => [...rows.values()].reverse().map(clone)
    return {
      get: (id) => clone(rows.get(id)),
      save: (ticket) => { rows.set(ticket.id, clone(ticket)) },
      list,
      open: () => list().filter((t) => !t.ended),
      active: () => list().filter((t) => !t.ended),
    }
  }

  get decisions() {
    const rows = this.decisionRows
    const list = () => [...rows.values()].reverse().map(clone)
    return {
      get: (id) => clone(rows.get(id)),
      save: (decision) => { rows.set(decision.id, clone(decision)) },
      list,
    }
  }
}
