/** Engine（移植 dsh-superagent src/core/engine.ts 的架构到 luke-jarvis 领域）。
 *
 *  架构规则（与 superagent 对齐）：
 *   ① Engine 是领域状态的唯一写者（one writer per state）——公司状态迁移、
 *      command 事件审计都必须走 Engine 命令，工具/HTTP/UI 只是 glue；
 *   ② 命令 = 一次「读 → 纯规则迁移 → 写（提交）」；副作用（事件落盘等）只在
 *      提交之后通过 Effects 队列执行，失败退避重试、不回滚已提交的事实；
 *   ③ 依赖全部经 Ports 注入（窄接口）：Engine 不 import 任何宿主模块、不做 IO；
 *   ④ 人/agent 可触发的拒绝抛 `UserError(code)`，code 固定、可词典化；
 *   ⑤ 每次迁移发领域事件（company.action / command.executed）。
 *
 *  概念映射见 src/core/model.js 头注。
 */

import { applyCompanyActionTo, companyEvent, emptyCompanyState } from './model.js'
import { UserError } from './errors.js'

// 审计事件不可合并（每条命令一条），key 加自增序号保证唯一
let _eventSeq = 0

/**
 * 创建 Engine。
 * @param {{
 *   company: { read(projectDir: string): Promise<object>, write(projectDir: string, state: object): Promise<{ok:boolean, mode?:string}> },
 *   board?: { write(projectDir: string, items: object[], version?: string|null): Promise<{ok:boolean, error?:string}> },
 *   gates?: { record(projectDir: string, step: string, ok: boolean): {ok:boolean} },
 *   events?: { append(projectDir: string, type: string, data: object): any },
 *   guards?: { stateRootOk(projectDir: string): boolean },
 *   effects?: import('./effects.js').Effects,
 *   now?: () => string,
 * }} ports
 */
export function createEngine(ports) {
  if (!ports || typeof ports.company?.read !== 'function' || typeof ports.company?.write !== 'function') {
    throw new TypeError('Engine 需要 company 端口（read/write）')
  }
  const effects = ports.effects || null
  const now = ports.now || (() => new Date().toISOString())

  /** 提交后副作用：领域事件入队（审计事件每条独立，不合并），不阻断命令返回。 */
  function enqueueEvent(projectDir, event) {
    if (!effects || !ports.events) return
    effects.enqueue('event', `${projectDir}::${event.type}::${++_eventSeq}`, { projectDir, event })
  }

  return {
    ports,

    /** 命令：把一个工具动作施加到公司状态（原 state/company.js#syncCompanyState 的裁决部分）。
     * @returns {Promise<{ok:boolean, changed:boolean, reason?:string, event?:object}>} */
    async applyCompanyAction(action) {
      const projectDir = String((action && action.projectDir) || '')
      if (ports.guards && !ports.guards.stateRootOk(projectDir)) {
        throw new UserError('state_root_conflict', { projectDir })
      }
      const state = await ports.company.read(projectDir)
      const merged = { ...emptyCompanyState(), ...state }
      const { changed, reason } = applyCompanyActionTo(merged, action, now())
      if (!changed) return { ok: true, changed: false, reason: reason || 'no-op' }

      // 提交：一次写（Engine 是唯一写者）
      const w = await ports.company.write(projectDir, merged)
      const event = companyEvent(action, now())
      enqueueEvent(projectDir, event)
      if (effects) { try { await effects.tick() } catch { /* 副作用失败不影响命令结果 */ } }
      if (!w || !w.ok) return { ok: false, changed: true, reason: 'write_failed', event }
      return { ok: true, changed: true, event }
    },

    /** 命令：执行一次 UI 工具调用（原 state/command.js#runCommand 的执行+审计部分）。
     * 校验/规整属 glue（command.js），Engine 负责执行、结果整形与 command 事件（唯一写者）。
     * @param {{
     *   projectDir: string, tool: string, args: object,
     *   execute(): Promise<any>, startedAt?: number
     * }} cmd
     */
    async runCommand(cmd) {
      const projectDir = String(cmd.projectDir || '')
      const startedAt = Number(cmd.startedAt) || now() && Date.now()
      try {
        const res = await cmd.execute()
        const elapsedMs = Date.now() - startedAt
        const isError = Boolean(res && res.isError)
        const out = {
          ok: !isError,
          tool: cmd.tool,
          elapsedMs,
          result: textOf(res),
          value: safeValue(res && res.value),
          args: cmd.args,
        }
        if (isError) {
          out.error = out.result || '工具执行失败'
          out.denied = /【jarvis|闸|BLOCKED|不得|必须|拒绝/.test(out.result)
        }
        enqueueEvent(projectDir, { type: 'command', at: now(), data: { tool: cmd.tool, ok: out.ok, ms: elapsedMs } })
        if (effects) { try { await effects.tick() } catch { /* 非致命 */ } }
        else if (ports.events) { try { ports.events.append(projectDir, 'command', { tool: cmd.tool, ok: out.ok, ms: elapsedMs }) } catch { /* 非致命 */ } }
        return out
      } catch (e) {
        const elapsedMs = Date.now() - startedAt
        // cause 链全展开（平台批量执行器把真实原因包在 ToolBatchError.cause 里，只看顶层 message 会误诊）
        const causes = []
        let c = e && e.cause
        for (let i = 0; c && i < 4; i++) { causes.push(String(c.message || c)); c = c.cause }
        const errText = String((e && e.message) || e) + (causes.length ? ' ← ' + causes.join(' ← ') : '')
        const out = { ok: false, tool: cmd.tool, elapsedMs, error: errText }
        enqueueEvent(projectDir, { type: 'command', at: now(), data: { tool: cmd.tool, ok: false, ms: elapsedMs } })
        if (effects) { try { await effects.tick() } catch { /* 非致命 */ } }
        else if (ports.events) { try { ports.events.append(projectDir, 'command', { tool: cmd.tool, ok: false, ms: elapsedMs }) } catch { /* 非致命 */ } }
        return out
      }
    },

    /** 命令：黑板（公屏）提交 —— 原 state/board.js#writeBoardItems 的裁决部分收编。
     *  读校验归 glue（调用方保证 items 为数组），Engine 负责守卫、唯一写、提交后事件。
     * @param {{ projectDir: string, items: Array<object>, version?: string|null }} cmd
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    async commitBoard(cmd) {
      const projectDir = String((cmd && cmd.projectDir) || '')
      if (ports.guards && !ports.guards.stateRootOk(projectDir)) {
        throw new UserError('state_root_conflict', { projectDir })
      }
      if (!ports.board || typeof ports.board.write !== 'function') {
        throw new UserError('board_port_missing', {})
      }
      const items = Array.isArray(cmd && cmd.items) ? cmd.items : []
      const w = await ports.board.write(projectDir, items, cmd.version)
      const ok = Boolean(w && w.ok)
      enqueueEvent(projectDir, { type: 'board', at: now(), data: { op: 'write', count: items.length, ok } })
      if (effects) { try { await effects.tick() } catch { /* 副作用失败不影响提交结果 */ } }
      return ok ? { ok: true } : { ok: false, error: (w && w.error) || 'write_failed' }
    },

    /** 命令（同步）：机械闸落闸 —— 原 gates/store.js#recordGate 的守卫+写路径收编。
     *  同步语义刻意保留：落闸后紧接的 _readGates 必须立即读到（闸门时序硬约束）。
     *  gate 事件由原始 IO 自己 append（与旧行为一致），这里不重复发。
     * @param {{ projectDir: string, step: string, ok: boolean }} cmd
     * @returns {{ok: boolean}} 同步结果（写盘成功与否）
     */
    recordGateSync(cmd) {
      const projectDir = String((cmd && cmd.projectDir) || '')
      if (ports.guards && !ports.guards.stateRootOk(projectDir)) {
        throw new UserError('state_root_conflict', { projectDir })
      }
      if (!ports.gates || typeof ports.gates.record !== 'function') {
        throw new UserError('gates_port_missing', {})
      }
      return ports.gates.record(projectDir, cmd.step, cmd.ok)
    },
  }
}

const MAX_TEXT = 20000
function textOf(res) {
  const blocks = (res && res.content) || []
  const parts = []
  for (const b of blocks) {
    if (b && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n').slice(0, MAX_TEXT)
}

function safeValue(value) {
  try {
    const json = JSON.stringify(value)
    if (!json) return null
    if (json.length > 60000) return { truncated: true, note: `结果过大（${json.length} 字节），已省略，请看 result 文本` }
    return JSON.parse(json)
  } catch {
    return null
  }
}
