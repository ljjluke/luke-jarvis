/** DSH 工具契约回归测试（v0.34）。
 *
 *  用户实测（2026-11-27）三条报错，都是「工具执行成功、调用方拿不到结果」这一类：
 *    ① tool "jarvis_ticket" returned invalid output: value is not lossless JSON
 *    ② Error: Tool batch execution failed   （jarvis_dispatch_task 内部两次嵌套调用）
 *    ③ （连带）派活未建任务 / 角色卡说"无"
 *
 *  根因逐条（已对到 DSH 源码行号）：
 *    ① core/tickets.js:61-73 的 open() 固定写 `mandate.by` / `mandate.gate` / `meta` / `origin`
 *       四个 undefined 键；DSH 在 dsh-tools/src/pipeline.ts:546 先走 snapshotToolValue
 *       （= dsh-util-values walkJsonValue:90-157），对象里任何 undefined → 判 "is not lossless JSON"。
 *    ② tools/org.js 用 {callId,name,arguments} 调 toolsSvc.execute，而契约是
 *       ToolBatchInput {calls:[{type:'tool-call',id,name,arguments:JSON字符串}],signal,agent}
 *       （dsh-tools/src/executor.ts:19-45 + dsh-llm/src/types.ts:112-119）→ batch.ts 抛 TypeError
 *       → executor.ts:91 包成 ToolBatchExecutionError('Tool batch execution failed')。
 *
 *  本测试锁定两个边界修复：sanitizeToolValue 的判定口径（对齐 DSH walkJsonValue 全分支）
 *  与 invokeNestedTool 的契约签名（并用一个会像 batch.ts 一样拒绝错误签名的桩来证明）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeToolValue, invokeNestedTool } from '../src/host/tools/contract.js'
import { Tickets } from '../src/host/core/tickets.js'

// ── 本地镜像 DSH 的 lossless 判定（walkJsonValue 的关键分支）────────────
/** 严苛版（迭代实现，避免自身在深对象上爆栈）：
 *  undefined / 非有限数 / -0 / 非 plain 对象 / 环 / 数组带额外键 → 非法。 */
function isLossless(root) {
  if (root === null || typeof root === 'string' || typeof root === 'boolean') return true
  if (typeof root === 'number') return Number.isFinite(root) && !Object.is(root, -0)
  if (typeof root !== 'object') return false            // undefined/function/symbol/bigint
  const ancestors = new Set()
  const stack = [{ v: root, inArray: false }]
  let leaves = 0
  while (stack.length) {
    const { v, inArray } = stack.pop()
    if (v === null || typeof v === 'string' || typeof v === 'boolean') continue
    if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) return false; continue }
    if (typeof v !== 'object') return false
    if (ancestors.has(v)) return false                  // 环
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) return false
      if (Reflect.ownKeys(v).length !== v.length + 1) return false
      if (++leaves > 200_000) return true
      ancestors.add(v)
      for (let i = 0; i < v.length; i += 1) stack.push({ v: v[i], inArray: true })
      continue
    }
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return false
    if (++leaves > 200_000) return true
    for (const k of Reflect.ownKeys(v)) {
      if (typeof k !== 'string') return false           // symbol 键
      stack.push({ v: v[k], inArray: false })
    }
    ancestors.add(v)
  }
  return true
}

test('sanitize：undefined 键必须被删除（jarvis_ticket 的直接炸点）', () => {
  const raw = {
    id: 't1', title: 'x',
    mandate: { strength: 'inferred', basis: 'b', by: undefined, at: 'now', gate: undefined },
    meta: undefined, origin: undefined,
    assignments: [{ id: 'a1', role: 'r', state: 'running', report: { state: 'progress', summary: '', at: 'now' } }],
  }
  assert.ok(!isLossless(raw), '原始对象本来就不是 lossless（否则测试没有意义）')
  const out = sanitizeToolValue(raw, 'jarvis_ticket')
  assert.ok(isLossless(out), `归一后必须 lossless，实际：${JSON.stringify(out)}`)
  assert.equal(Object.prototype.hasOwnProperty.call(out.mandate, 'by'), false, 'mandate.by 应被删')
  assert.equal(Object.prototype.hasOwnProperty.call(out.mandate, 'gate'), false, 'mandate.gate 应被删')
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'meta'), false, 'meta 应被删')
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'origin'), false, 'origin 应被删')
  assert.equal(out.id, 't1', '业务字段必须原样保留')
})

test('sanitize：真实 Tickets.open(input) 的返回值直接可用（不靠下游兜底）', () => {
  const repo = {
    tickets: { get: () => undefined, save() {}, list: () => [], open: () => [], active: () => [] },
    decisions: { get: () => undefined, save() {}, list: () => [] },
    atomic: (work) => work(),
  }
  const engine = new Tickets({ repo, executor: { start() {}, stop() {} } })
  const ticket = engine.open({ title: 'T1', project: '/tmp/x', role: '总经理', mandate: {} })
  assert.ok(isLossless(ticket), `Tickets.open 的返回值必须本身就 lossless（不挂 undefined 键），实际：${JSON.stringify(ticket)}`)
})

test('sanitize：NaN/±Infinity/-0 全部归一为 JSON 合法值', () => {
  const out = sanitizeToolValue({ a: NaN, b: Infinity, c: -Infinity, d: -0, e: 0, f: 3.5 }, 't')
  assert.ok(isLossless(out))
  assert.equal(out.a, null); assert.equal(out.b, null); assert.equal(out.c, null)
  assert.equal(out.d, 0); assert.equal(out.e, 0); assert.equal(out.f, 3.5)
})

test('sanitize：Date/Error/Map/Set 降级为纯 JSON（不整次失败）', () => {
  const out = sanitizeToolValue({
    at: new Date('2026-11-27T00:00:00.000Z'),
    err: new Error('boom'),
    m: new Map([['k', 1]]),
    s: new Set(['a', 'b']),
  }, 't')
  assert.ok(isLossless(out), `实际：${JSON.stringify(out)}`)
  assert.equal(out.at, '2026-11-27T00:00:00.000Z')
  assert.equal(out.err, 'boom')
  assert.deepEqual(out.m, { k: 1 })
  assert.deepEqual(out.s, ['a', 'b'])
})

test('sanitize：环用占位符断开；菱形引用（非环）保留原结构', () => {
  const cyc = { name: 'c' }; cyc.self = cyc
  const out1 = sanitizeToolValue(cyc, 't')
  assert.ok(isLossless(out1))
  assert.equal(out1.self, '[Circular]')

  const shared = { k: 1 }
  const out2 = sanitizeToolValue({ a: shared, b: shared }, 't')
  assert.ok(isLossless(out2))
  assert.deepEqual(out2, { a: { k: 1 }, b: { k: 1 } }, '同一对象出现在两个分支不是环，结构必须完整保留')
})

test('sanitize：稀疏数组补 null（DSH 按"长度≠自有键数"判失败）', () => {
  const sparse = [1, , 3] // eslint-disable-line no-sparse-arrays
  const out = sanitizeToolValue({ arr: sparse }, 't')
  assert.ok(isLossless(out))
  assert.deepEqual(out.arr, [1, null, 3])
})

test('sanitize：execute 直接返回 undefined 时给合法失败占位（不静默丢结果）', () => {
  const out = sanitizeToolValue(undefined, 'jarvis_xxx')
  assert.ok(isLossless(out))
  assert.equal(out.ok, false)
  assert.match(out.verdict, /jarvis_xxx/, '文案必须点名是哪个工具，否则无法排查')
})

test('sanitize：深对象不爆栈（迭代实现）', () => {
  let deep = { v: 1 }
  for (let i = 0; i < 5000; i += 1) deep = { n: deep }
  const out = sanitizeToolValue(deep, 't')
  assert.ok(isLossless(out), '5000 层嵌套必须能归一（递归实现会 RangeError）')
})

test('sanitize：被剥离字段要在 sanitized 里留痕（不许静默）', () => {
  const out = sanitizeToolValue({ ok: true, verdict: 'x', mandate: { by: undefined } }, 'jarvis_ticket')
  assert.ok(typeof out.sanitized === 'string' && out.sanitized.length > 0, '有剥离就必须留痕，否则用户看不出发生过什么')
  assert.match(out.sanitized, /by/)
})

// ── invokeNestedTool：契约签名 ────────────────────────────────────────
/** 像真实 batch.ts 一样的桩：只接受 {calls:[...]}，其它形态抛 TypeError（复刻线上错误）。 */
function strictBatchSvc(value) {
  return {
    async execute(input) {
      if (!input || !Array.isArray(input.calls)) throw new TypeError('input.calls.map is not a function')
      if (typeof input.signal === 'undefined') throw new TypeError('signal is required')
      const calls = input.calls
      if (!calls.every((c) => c && c.type === 'tool-call' && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.arguments === 'string')) {
        throw new TypeError('malformed ToolCallBlock')
      }
      return {
        results: [{ callId: calls[0].id, result: { isError: false, value, content: [{ type: 'text', text: `ran ${calls[0].name}` }] } }],
        additionalContexts: [],
        concluded: false,
      }
    },
  }
}

test('invokeNestedTool：按 DSH batch 契约调用（旧签名会被严格桩直接拒绝）', async () => {
  const svc = strictBatchSvc({ ok: true, brief: 'hello' })
  const r = await invokeNestedTool(svc, { name: 'jarvis_member_brief', args: { roleName: '总经理' }, agent: { id: 'a' }, signal: new AbortController().signal })
  assert.equal(r.isError, false)
  assert.deepEqual(r.value, { ok: true, brief: 'hello' })
  assert.equal(r.content.length, 1)
  assert.equal(r.content[0].text, 'ran jarvis_member_brief')
})

test('invokeNestedTool：arguments 必须是 JSON 字符串（模型侧契约），且能带中文', async () => {
  let seen = null
  const svc = {
    async execute(input) {
      seen = input.calls[0]
      return { results: [{ callId: input.calls[0].id, result: { isError: false, value: {}, content: [] } }], additionalContexts: [], concluded: false }
    },
  }
  await invokeNestedTool(svc, { name: 'jarvis_ticket', args: { title: '编制评估', role: '猎头' } })
  assert.equal(typeof seen.arguments, 'string')
  assert.deepEqual(JSON.parse(seen.arguments), { title: '编制评估', role: '猎头' })
})

test('invokeNestedTool：兼容 executeTool 单工具桩', async () => {
  const svc = { async executeTool(name, args) { return { isError: false, value: { brief: 'hi', n: name }, content: [] } } }
  const r = await invokeNestedTool(svc, { name: 'jarvis_member_brief', args: {} })
  assert.equal(r.isError, false)
  assert.deepEqual(r.value, { brief: 'hi', n: 'jarvis_member_brief' })
})

test('invokeNestedTool：工具报错要解成 {isError:true, error:string}（调用方不用猜形态）', async () => {
  const svc = {
    async execute(input) {
      return { results: [{ callId: input.calls[0].id, result: { isError: true, error: { code: 'INVALID_TOOL_OUTPUT', message: 'value is not lossless JSON' }, content: [] } }], additionalContexts: [], concluded: false }
    },
  }
  const r = await invokeNestedTool(svc, { name: 'jarvis_ticket', args: {} })
  assert.equal(r.isError, true)
  assert.equal(typeof r.error, 'string')
  assert.match(r.error, /lossless JSON/)
})

test('invokeNestedTool：宿主完全没有 tools 服务时给明确错误（不抛）', async () => {
  const r = await invokeNestedTool(undefined, { name: 'x', args: {} })
  assert.equal(r.isError, true)
  assert.match(r.error, /tools\.execute/)
  assert.equal(r.value, undefined)
})
