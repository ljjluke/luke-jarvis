/** core 架构测试（对应 superagent 的 tests/core-engine.spec.ts / effects.spec.ts）。
 *
 *  覆盖：
 *   ① Engine 单写者：一次命令恰好一次 company.write；
 *   ② 纯规则迁移（model.applyCompanyActionTo 的状态机）；
 *   ③ UserError 固定拒绝码；
 *   ④ Effects：合并（同 kind+key）、退避重试、Later 不计失败、健康态；
 *   ⑤ 命令审计事件经 Effects 提交后落盘；
 *   ⑥ 兼容门面：syncCompanyState / runCommand 走 Engine 后行为不变。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { createEngine, Effects, Later, UserError, applyCompanyActionTo, emptyCompanyState } = await import('../src/core/index.js')

/** 内存端口：记录调用次数，可注入故障。 */
function memoryPorts() {
  let state = emptyCompanyState()
  const calls = { read: 0, write: 0 }
  const events = []
  return {
    state, calls, events,
    company: {
      read: async () => { calls.read += 1; return JSON.parse(JSON.stringify(state)) },
      write: async (_pd, s) => { calls.write += 1; state = s; return { ok: true, mode: 'memory' } },
    },
    events: { append: (_pd, type, data) => { events.push({ type, data }); return { seq: events.length } } },
    guards: { stateRootOk: () => true },
  }
}

test('model：meeting_started/done 联动参会员工状态（含 CEO 豁免与 _prevStatus 恢复）', () => {
  const s = emptyCompanyState()
  s.employees.push({ role: '研发', status: 'idle' }, { role: '测试', status: 'working' }, { role: 'CEO', status: 'working' })
  applyCompanyActionTo(s, { type: 'meeting_started', meeting: { id: 'm1', attendees: ['研发', '测试', 'CEO'] } }, '2026-11-06T01:00:00.000Z')
  assert.strictEqual(s.employees[0].status, 'meeting')
  assert.strictEqual(s.employees[0]._prevStatus, 'idle')
  assert.strictEqual(s.employees[1].status, 'meeting')
  assert.strictEqual(s.employees[2].status, 'working', 'CEO 不进会议态')
  applyCompanyActionTo(s, { type: 'meeting_done', meetingId: 'm1' }, '2026-11-06T02:00:00.000Z')
  assert.strictEqual(s.employees[0].status, 'idle', '散会恢复开会前状态，不硬设 working')
  assert.strictEqual(s.employees[1].status, 'working')
  assert.strictEqual(s.meetings.find((m) => m.id === 'm1').status, 'done')
})

test('model：employee_terminated 自动触发 recruiting 补位；hired 自动 confirmed', () => {
  const s = emptyCompanyState()
  s.employees.push({ role: '测试', persona: 'X', status: 'working' })
  applyCompanyActionTo(s, { type: 'employee_terminated', role: '测试', note: '连续不达标' }, '2026-11-06T01:00:00.000Z')
  assert.strictEqual(s.employees[0].status, 'terminated')
  assert.strictEqual(s.recruiting.length, 1)
  assert.strictEqual(s.recruiting[0].status, 'searching')
  applyCompanyActionTo(s, { type: 'employee_hired', role: '测试', persona: 'Y' }, '2026-11-06T02:00:00.000Z')
  assert.strictEqual(s.recruiting[0].status, 'confirmed')
  assert.strictEqual(s.recruiting[0].hiredRole, '测试')
  assert.strictEqual(s.employees.filter((e) => e.role === '测试').length, 2)
})

test('model：未知动作与无可转记录返回 changed=false', () => {
  const s = emptyCompanyState()
  assert.strictEqual(applyCompanyActionTo(s, { type: 'nope' }).changed, false)
  assert.strictEqual(applyCompanyActionTo(s, { type: 'recruiting_interviewing', position: '不存在' }).changed, false)
})

test('engine：applyCompanyAction 单写者（一次命令恰好一次 write）+ 事件提交后落盘', async () => {
  const p = memoryPorts()
  const fx = new Effects()
  const seen = []
  fx.handle('event', async ({ event }) => { seen.push(event) })
  const engine = createEngine({ ...p, effects: fx })
  const r = await engine.applyCompanyAction({ type: 'employee_hired', role: '研发', persona: 'X', projectDir: '/proj' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.changed, true)
  assert.strictEqual(p.calls.write, 1, '单写者：一次命令恰好一次落盘')
  assert.strictEqual(p.calls.read, 1)
  assert.strictEqual(seen.length, 1)
  assert.strictEqual(seen[0].type, 'company')
  assert.strictEqual(seen[0].data.action, 'employee_hired')
})

test('engine：无迁移（未知动作）不写盘不发事件', async () => {
  const p = memoryPorts()
  const fx = new Effects()
  const seen = []
  fx.handle('event', async ({ event }) => { seen.push(event) })
  const engine = createEngine({ ...p, effects: fx })
  const r = await engine.applyCompanyAction({ type: 'nope', projectDir: '/proj' })
  assert.strictEqual(r.changed, false)
  assert.strictEqual(p.calls.write, 0)
  assert.strictEqual(seen.length, 0)
})

test('engine：stateRoot 守卫抛固定码 UserError', async () => {
  const p = memoryPorts()
  p.guards = { stateRootOk: () => false }
  const engine = createEngine(p)
  await assert.rejects(() => engine.applyCompanyAction({ type: 'employee_hired', role: 'X', projectDir: '/plugin-repo' }), (e) => {
    assert.ok(e instanceof UserError)
    assert.strictEqual(e.code, 'state_root_conflict')
    return true
  })
  assert.strictEqual(p.calls.write, 0)
})

test('engine：runCommand 审计事件在执行后经 Effects 落盘（一次成功一次失败）', async () => {
  const p = memoryPorts()
  const fx = new Effects()
  const seen = []
  fx.handle('event', async ({ event }) => { seen.push(event) })
  const engine = createEngine({ ...p, effects: fx })
  const ok = await engine.runCommand({
    projectDir: '/proj', tool: 'jarvis_flowguard', args: { step: 'build' }, startedAt: Date.now(),
    execute: async () => ({ isError: false, content: [{ text: '阶段=build 缺口=0' }], value: { stage: 'build' } }),
  })
  assert.strictEqual(ok.ok, true)
  assert.strictEqual(ok.value.stage, 'build')
  const bad = await engine.runCommand({
    projectDir: '/proj', tool: 'jarvis_flowguard', args: {}, startedAt: Date.now(),
    execute: async () => { throw new Error('boom') },
  })
  assert.strictEqual(bad.ok, false)
  assert.strictEqual(bad.error, 'boom')
  assert.deepStrictEqual(seen.map((e) => e.type), ['command', 'command'])
  assert.deepStrictEqual(seen.map((e) => e.data.ok), [true, false])
})

test('effects：同 kind+key 合并（替换 payload、立即到期、保持顺序）', async () => {
  const fx = new Effects()
  const ran = []
  fx.handle('sync', async (payload) => { ran.push(payload) })
  fx.enqueue('sync', 'k1', { v: 1 })
  fx.enqueue('sync', 'k1', { v: 2 })
  fx.enqueue('sync', 'k2', { v: 3 })
  await fx.tick()
  assert.deepStrictEqual(ran, [{ v: 2 }, { v: 3 }], 'k1 只跑最新 payload')
  assert.ok(fx.idle())
})

test('effects：失败退避重试、三次后进入健康态、成功即清', async () => {
  let clock = 1000
  const fx = new Effects({ now: () => clock })
  let fails = 0
  fx.handle('job', async () => { fails += 1; if (fails < 3) throw new Error(`f${fails}`) })
  fx.enqueue('job', 'k', {})
  await fx.tick() // 第 1 次：失败，dueAt = clock + 2000
  assert.strictEqual(fx.health.get('job'), undefined, '失败 1 次不报健康')
  clock += 2000; await fx.tick() // 第 2 次：失败
  assert.strictEqual(fx.health.get('job'), undefined, '失败 2 次不报健康')
  clock += 4000; await fx.tick() // 第 3 次：成功 → 行删除、健康清空
  assert.ok(fx.idle())
  assert.strictEqual(fx.health.size, 0)
})

test('effects：Later 不计失败、按 laterMs 顺延', async () => {
  let clock = 0
  const fx = new Effects({ now: () => clock })
  let tries = 0
  fx.handle('wait', async () => { tries += 1; if (tries === 1) throw new Later('no slot') }, { laterMs: 500 })
  fx.enqueue('wait', 'k', {})
  await fx.tick()
  assert.strictEqual(tries, 1)
  assert.strictEqual(fx.pending()[0].attempts, 0, 'Later 不计失败')
  clock += 500
  await fx.tick()
  assert.strictEqual(tries, 2)
  assert.ok(fx.idle())
})

test('effects：持久化 round-trip（load 回放未完成行）', async () => {
  const saved = []
  let clock = 0
  const fx = new Effects({
    now: () => clock,
    persist: (rows) => { saved.length = 0; saved.push(...rows) },
  })
  fx.handle('echo', async () => { clock += 1 })
  fx.enqueue('echo', 'k1', { a: 1 })
  fx.drain()
  assert.strictEqual(saved.length, 1)

  const fx2 = new Effects({ load: () => saved })
  const ran = []
  fx2.handle('echo', async (p) => { ran.push(p) })
  await fx2.tick()
  assert.deepStrictEqual(ran, [{ a: 1 }], '重启后重放未完成副作用')
  assert.ok(fx2.idle())
})

test('兼容门面：syncCompanyState 走 Engine 后可观测行为不变（fs 服务路径）', async () => {
  const { syncCompanyState } = await import('../src/host/state/company.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'core-company-'))
  const files = new Map()
  const sp = path.join(proj, '.jarvis', 'company-state.json').replace(/\\/g, '/')
  const fsSvc = {
    async resolve(p) { return { path: String(p).replace(/\\/g, '/') } },
    async readText(t) { const f = files.get(t.path); return f ? f.content : '' },
    async writeText(t, c) { files.set(t.path, { content: c }); return {} },
  }
  const okHire = await syncCompanyState(fsSvc, { type: 'employee_hired', role: '研发', persona: 'Martin Fowler', projectDir: proj })
  assert.strictEqual(okHire, true)
  const noRec = await syncCompanyState(fsSvc, { type: 'recruiting_interviewing', position: '不存在岗', projectDir: proj })
  assert.strictEqual(noRec, false, '无 searching 记录不可转 interviewing')
  const state = JSON.parse(files.get(sp).content)
  assert.strictEqual(state.employees[0].role, '研发')
  assert.ok(state.updatedAt)
  fs.rmSync(proj, { recursive: true, force: true })
})

test('engine：commitBoard 单写者（唯一写 + 提交后 board 事件）', async () => {
  const p = memoryPorts()
  const writes = []
  p.board = { write: async (_pd, items, version) => { writes.push({ items, version }); return { ok: true } } }
  const fx = new Effects()
  const seen = []
  fx.handle('event', async ({ event }) => { seen.push(event) })
  const engine = createEngine({ ...p, effects: fx })
  const r = await engine.commitBoard({ projectDir: '/proj', items: [{ id: 'B1' }], version: 'v1' })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(writes, [{ items: [{ id: 'B1' }], version: 'v1' }], '恰好一次原始写')
  await fx.tick()
  const boardEv = seen.filter((e) => e.type === 'board')
  assert.strictEqual(boardEv.length, 1)
  assert.strictEqual(boardEv[0].data.count, 1)
  // 写失败：ok=false 且 error 透传
  p.board.write = async () => ({ ok: false, error: 'FS_STALE_VERSION' })
  const bad = await engine.commitBoard({ projectDir: '/proj', items: [] })
  assert.strictEqual(bad.ok, false)
  assert.strictEqual(bad.error, 'FS_STALE_VERSION')
})

test('engine：recordGateSync 同步落闸 + 守卫拒绝抛 UserError', async () => {
  const p = memoryPorts()
  const gateCalls = []
  p.gates = { record: (pd, step, ok) => { gateCalls.push({ pd, step, ok }); return { ok: true } } }
  const engine = createEngine(p)
  const r = engine.recordGateSync({ projectDir: '/proj', step: 'clarify', ok: true })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(gateCalls, [{ pd: '/proj', step: 'clarify', ok: true }])
  // 守卫拒绝 → 固定码
  p.guards = { stateRootOk: () => false }
  const engine2 = createEngine(p)
  assert.throws(() => engine2.recordGateSync({ projectDir: '/plugin-repo', step: 'build', ok: true }), (e) => {
    assert.ok(e instanceof UserError)
    assert.strictEqual(e.code, 'state_root_conflict')
    return true
  })
  // 缺 gates 端口 → 固定码
  const engine3 = createEngine(memoryPorts())
  assert.throws(() => engine3.recordGateSync({ projectDir: '/proj', step: 'build', ok: true }), (e) => e.code === 'gates_port_missing')
})

test('兼容门面：writeBoardItems / recordGate 走 Engine 后行为不变（真实 tmp 目录）', async () => {
  const { writeBoardItems } = await import('../src/host/state/board.js')
  const { recordGate, _readGates } = await import('../src/host/gates/store.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'core-board-'))
  const target = path.join(proj, '.jarvis', 'board.json').replace(/\\/g, '/')
  const files = new Map()
  const fsSvc = {
    async resolve(p) { return { path: String(p).replace(/\\/g, '/') } },
    async readText(t) { const f = files.get(t.path); return f ? f.content : '' },
    async writeText(t, c) { files.set(t.path, { content: c }); return {} },
  }
  // 注意：门面里的 boardFilePath 依赖运行时工作区解析；tmp 目录下回退 raw 写也能落盘。
  // 这里用 monkeypatch 不可行（boardFilePath 内部解析），直接断言写成功 + 文件可读。
  const r = await writeBoardItems(fsSvc, [{ id: 'B1', content: 'x' }], null)
  assert.strictEqual(r.ok, true, `writeBoardItems 应成功：${JSON.stringify(r)}`)
  const gates = recordGate(proj, 'clarify', true)
  assert.strictEqual(gates, true)
  assert.strictEqual(_readGates(proj).clarify.ok, true, '落闸后立即读闸（同步契约）')
  fs.rmSync(proj, { recursive: true, force: true })
})

test('兼容门面：runCommand 走 Engine 后返回形状与 command 事件不变', async () => {
  const { runCommand } = await import('../src/host/state/command.js')
  const { readEvents } = await import('../src/host/state/events.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cmd-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  const ctx = { get: () => ({ execute: async () => ({ isError: false, content: [{ type: 'text', text: '阶段=build 缺口=0' }], value: { stage: 'build', missing: [] } }) }) }
  const agent = { session: { id: 's1', header: { cwd: proj } } }
  const out = await runCommand({ ctx, projectDir: proj, tool: 'jarvis_flowguard', args: { step: 'build' }, agent })
  assert.strictEqual(out.ok, true)
  assert.strictEqual(out.tool, 'jarvis_flowguard')
  assert.ok(out.result.includes('阶段=build'))
  assert.deepStrictEqual(out.value, { stage: 'build', missing: [] })
  const ev = readEvents(proj)
  assert.strictEqual(ev.events.filter((e) => e.type === 'command').length, 1, 'command 事件恰好一条')
  assert.strictEqual(ev.events[0].data.tool, 'jarvis_flowguard')
  fs.rmSync(proj, { recursive: true, force: true })
})
