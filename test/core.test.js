/** core 层单测：任务单生命周期 / 阶段判定 / 引擎裁决 / JSON 仓储 / jarvis_ticket 工具。
 *  移植自 dsh-superagent-prototype 的 core 语义（Ticket/Assignment/Report），领域为数字公司。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  Engine, MemoryRepositories, TicketError, ticketStage, canRetry, reasonText, latestAssignment,
} from '../src/host/core/index.js'
import { JsonTicketRepositories } from '../src/host/adapters/json-tickets.js'
import { TOOLS } from '../src/host/plugin.js'

const AT = '2026-11-04T00:00:00.000Z'
const clock = { now: () => AT }

function makeEngine(extra = {}) {
  const events = []
  const engine = new Engine({
    repo: new MemoryRepositories(),
    clock,
    onEvent: (type, data) => events.push({ type, data }),
    ...extra,
  })
  return { engine, events }
}

test('core 原子事务：抛错回滚，不留下半写状态', () => {
  const repo = new MemoryRepositories()
  assert.throws(() => repo.atomic(() => {
    repo.tickets.save({ id: 't1', title: 'x', createdAt: AT })
    throw new Error('boom')
  }), /boom/)
  assert.equal(repo.tickets.get('t1'), undefined)
})

test('开单：生成 running 派单并调用执行器 start', () => {
  const started = []
  const { engine, events } = makeEngine({ executor: { start: (t, a) => started.push([t.id, a.id]), stop: () => {} } })
  const ticket = engine.tickets.open({ title: '实现登录', project: '/p', stage: 'build', role: '研发' })
  assert.equal(ticket.assignments.length, 1)
  assert.equal(ticket.assignments[0].state, 'running')
  assert.equal(ticket.assignments[0].role, '研发')
  assert.deepEqual(started, [[ticket.id, ticket.assignments[0].id]])
  assert.ok(events.some((e) => e.type === 'ticket.created'))
})

test('汇报 ready → 任务单结束（completed，by executor）', () => {
  const { engine } = makeEngine()
  const ticket = engine.tickets.open({ title: 'x', project: '/p' })
  const done = engine.report(ticket.id, { state: 'ready', summary: '已交付' })
  assert.equal(done.ended.outcome, 'completed')
  assert.equal(done.ended.by, 'executor')
  assert.equal(latestAssignment(done).report.state, 'ready')
  assert.equal(ticketStage(done).stage, 'ended')
})

test('汇报 blocked → 等人工、不可跳过（stage=person/blocked，可重试）', () => {
  const { engine } = makeEngine()
  const ticket = engine.tickets.open({ title: 'x', project: '/p' })
  const blocked = engine.report(ticket.id, { state: 'blocked', summary: '缺接口契约' })
  assert.equal(blocked.ended, undefined)
  assert.deepEqual(ticketStage(blocked), { stage: 'person', action: 'blocked' })
  assert.equal(canRetry(blocked), true)
  assert.equal(engine.view(ticket.id).retryable, true)
})

test('重试：结束旧派单（reason=retried）并按同一授权开新派单', () => {
  const calls = []
  const { engine } = makeEngine({ executor: { start: (t, a) => calls.push(['start', a.id]), stop: (t, a, r) => calls.push(['stop', a.id, r]) } })
  const ticket = engine.tickets.open({ title: 'x', project: '/p' })
  engine.report(ticket.id, { state: 'failed', summary: '测试失败' })
  const retried = engine.retry(ticket.id)
  assert.equal(retried.assignments.length, 2)
  assert.equal(retried.assignments[0].state, 'ended')
  assert.equal(retried.assignments[0].endedReason, 'retried')
  assert.equal(retried.assignments[1].state, 'running')
  assert.deepEqual(calls.filter((c) => c[0] === 'stop'), [['stop', retried.assignments[0].id, 'retried']])
})

test('停止：人工结束（by human，outcome stopped），且不可再汇报', () => {
  const { engine } = makeEngine()
  const ticket = engine.tickets.open({ title: 'x', project: '/p' })
  const stopped = engine.stop(ticket.id, '方向错了')
  assert.equal(stopped.ended.by, 'human')
  assert.equal(stopped.ended.outcome, 'stopped')
  assert.throws(() => engine.report(ticket.id, { state: 'progress' }), (e) => e instanceof TicketError && e.code === 'ticketEnded')
})

test('非法汇报状态被拒（badReport），不污染任务单', () => {
  const { engine } = makeEngine()
  const ticket = engine.tickets.open({ title: 'x', project: '/p' })
  assert.throws(() => engine.report(ticket.id, { state: 'done' }), (e) => e.code === 'badReport')
  assert.equal(engine.get(ticket.id).ended, undefined)
})

test('阶段判定：pending 派单=排队；running 无汇报=执行中', async () => {
  const { Tickets } = await import('../src/host/core/tickets.js')
  const repo = new MemoryRepositories()
  const clockNow = { now: () => '2026-11-04T00:00:00.000Z' }
  const tickets = new Tickets({ repo, executor: { start() {}, stop() {} }, clock: clockNow })
  const t = tickets.open({ title: 'x', project: '/p' })
  t.assignments[0].state = 'pending'
  assert.deepEqual(ticketStage(t), { stage: 'working', action: 'queued' })
  t.assignments[0].state = 'running'
  assert.deepEqual(ticketStage(t), { stage: 'working' })
})

test('引擎裁决：闸不过只记 decision，不开单', () => {
  const policy = { gate: () => ({ ok: false, reason: { code: 'gateBlocked', values: { gate: 'build' } } }) }
  const { engine, events } = makeEngine({ policy })
  const out = engine.adjudicate({ title: 'x', project: '/p', stage: 'build' })
  assert.equal(out.ticket, undefined)
  assert.equal(out.decision.kind, 'ignore')
  assert.equal(engine.list().length, 0)
  assert.ok(events.some((e) => e.type === 'decision.recorded'))
})

test('引擎裁决：闸通过则开单并回填 decision.ticketId', () => {
  const policy = { gate: () => ({ ok: true, basis: 'gate:build ok' }) }
  const { engine } = makeEngine({ policy })
  const out = engine.adjudicate({ title: 'x', project: '/p', stage: 'build', mandate: { strength: 'explicit', basis: 'user:explicit' } })
  assert.ok(out.ticket)
  assert.equal(out.decision.ticketId, out.ticket.id)
  assert.equal(out.ticket.mandate.strength, 'explicit')
})

test('JSON 仓储：落盘可跨实例读回（不依赖内存）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-json-'))
  const repo = new JsonTicketRepositories(path.join(dir, '.jarvis'))
  const at = AT
  repo.tickets.save({ id: 't1', title: 'x', project: dir, stage: 'build', createdAt: at, updatedAt: at, assignments: [] })
  repo.decisions.save({ id: 'd1', kind: 'accept', at })
  const again = new JsonTicketRepositories(path.join(dir, '.jarvis'))
  assert.equal(again.tickets.get('t1').title, 'x')
  assert.equal(again.decisions.get('d1').kind, 'accept')
  assert.equal(again.tickets.list().length, 1)
})

test('jarvis_ticket 工具：普通项目 open/list/report 全程可用并落盘', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-tool-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo-project' }))
  const def = TOOLS.find((t) => t.name === 'jarvis_ticket')
  assert.ok(def, 'jarvis_ticket 工具存在')

  const opened = await def.execute({ action: 'open', projectDir: dir, title: '接支付', stage: 'build', role: '研发' })
  assert.equal(opened.ok, true)
  assert.ok(fs.existsSync(path.join(dir, '.jarvis/tickets', `${opened.ticket.id}.json`)), '任务单应落盘')

  const listed = await def.execute({ action: 'list', projectDir: dir })
  assert.equal(listed.ok, true)
  assert.equal(listed.tickets.length, 1)

  const ready = await def.execute({ action: 'report', projectDir: dir, ticketId: opened.ticket.id, state: 'ready', summary: '已交付' })
  assert.equal(ready.ok, true)
  assert.equal(ready.ticket.ended.outcome, 'completed')
})

test('jarvis_ticket 工具：插件仓库拒写（STATE_ROOT_CONFLICT，且不建 .jarvis）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-repo-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'luke-jarvis' }))
  const def = TOOLS.find((t) => t.name === 'jarvis_ticket')
  const r = await def.execute({ action: 'open', projectDir: dir, title: 'x' })
  assert.equal(r.ok, false)
  assert.match(r.verdict, /STATE_ROOT_CONFLICT|状态根/)
  assert.equal(fs.existsSync(path.join(dir, '.jarvis')), false)
})

test('reasonText：中文模板渲染（带 ticketId 前缀）', () => {
  assert.equal(reasonText({ code: 'ticketEnded', values: { ticket: 'T1', outcome: 'completed' } }), '任务单已结束：T1（completed）')
  assert.equal(reasonText([{ code: 'said', values: { text: 'ok' } }]), 'ok')
})
