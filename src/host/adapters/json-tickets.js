/** JSON 仓储适配器：把 core 的 Repositories 端口落到 `<项目>/.jarvis/`（tickets/ + decisions/）。
 *  纯 node:fs，原子写（tmp + rename），不依赖 DSH 服务；插件仓库由调用方（stateRootConflict）先行拒绝。 */
import fs from 'node:fs'
import path from 'node:path'

const safeName = (id) => String(id).replace(/[^\w.:-]/g, '_')

export class JsonTicketRepositories {
  /** @param {string} jarvisDir `<项目>/.jarvis` 目录 */
  constructor(jarvisDir) {
    this.jarvisDir = jarvisDir
    this.ticketsDir = path.join(jarvisDir, 'tickets')
    this.decisionsDir = path.join(jarvisDir, 'decisions')
  }

  /** 每个 save 自身原子；批量事务留待适配层（当前单写）。 */
  atomic(work) {
    return work()
  }

  write(dir, id, data) {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${safeName(id)}.json`)
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, file)
  }

  read(dir, id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, `${safeName(id)}.json`), 'utf8'))
    } catch {
      return undefined
    }
  }

  readAll(dir) {
    let names = []
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')) } catch { return [] }
    const rows = []
    for (const name of names) {
      try { rows.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))) } catch { /* 坏文件跳过 */ }
    }
    return rows
  }

  get tickets() {
    const self = this
    const list = () => self.readAll(self.ticketsDir).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    return {
      get: (id) => self.read(self.ticketsDir, id),
      save: (ticket) => self.write(self.ticketsDir, ticket.id, ticket),
      list,
      open: () => list().filter((t) => !t.ended),
      active: () => list().filter((t) => !t.ended),
    }
  }

  get decisions() {
    const self = this
    const list = () => self.readAll(self.decisionsDir).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    return {
      get: (id) => self.read(self.decisionsDir, id),
      save: (decision) => self.write(self.decisionsDir, decision.id, decision),
      list,
    }
  }
}
