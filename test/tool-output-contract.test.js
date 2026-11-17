/** D12 契约回归测试：工具 execute 的真实返回值必须能通过自己的 output.schema。
 *
 *  为什么需要（缺陷实证）：
 *   · jarvis_coverage(persist=true) 返回 `persisted`，而 output.schema 声明 additionalProperties:false
 *     → 真实宿主报 `"value.persisted" is not a declared property`（**副作用已发生 + 用户看到失败**）；
 *   · jarvis_board 返回对象里带 `undefined` 值（resourceBlockNote/storage/writeError）
 *     → 无损 JSON 边界判 `value is not lossless JSON`（黑板「调用即报错」）。
 *  两条都是最坏的一类不一致（状态被改了但报错）。本测试把契约钉死：以后任何工具改了返回字段
 *  而没同步 schema（或带上 undefined/不可序列化值），这里直接红。
 *
 *  断言三件（与 DSH 的 output 校验同序）：① 无损 JSON；② 键 ⊆ output.schema.properties；
 *  ③ output.schema.required 全部存在。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TOOLS } from '../src/host/tools/index.js'
import { rememberExec } from '../src/host/runtime.js'

/** 本地镜像 DSH 的 output 契约检查（lossless → properties → required）。 */
function assertToolContract(def, value) {
  assert.ok(def && def.output && def.output.schema, '工具必须有 output.schema')
  // ① 无损 JSON：JSON.stringify 会丢 undefined / 非普通对象 → 往返必须完全相等
  const roundTrip = JSON.parse(JSON.stringify(value))
  assert.deepEqual(roundTrip, value, `${def.name}：返回值不是无损 JSON（存在 undefined/不可序列化字段）`)
  // ② 键必须全部在 schema.properties 里声明（additionalProperties:false 的本地等价）
  const props = Object.keys((def.output.schema && def.output.schema.properties) || {})
  for (const k of Object.keys(value)) {
    assert.ok(props.includes(k), `${def.name}：返回字段 "${k}" 未在 output.schema.properties 声明`)
  }
  // ③ required 必须齐备
  for (const k of (def.output.schema.required || [])) {
    assert.ok(k in value, `${def.name}：缺少 output.schema.required 字段 "${k}"`)
  }
}

/** 内存 fs（与 test/plugin.test.js 的 makeMockFs 同形态，含版本守卫）。 */
function makeMockFs() {
  const files = new Map()
  let verSeq = 0
  return {
    files,
    async resolve(p) { return { targetKey: 'mock:' + p, path: p } },
    async stat(t) { const f = files.get(t.path); return f ? { version: f.version } : undefined },
    async readText(t) { const f = files.get(t.path); if (!f) throw new Error('ENOENT'); return f.content },
    async writeText(t, content, expected) {
      const cur = files.get(t.path)
      if (expected && expected.kind === 'replaceIfVersion') {
        if (!cur || cur.version !== expected.version) throw new Error('FS_STALE_VERSION')
      }
      const version = 'v' + (++verSeq)
      files.set(t.path, { content, version })
      return { operation: cur ? 'update' : 'create', version }
    },
    async listDir() { return [] },
  }
}

test('jarvis_coverage：execute 返回与 output.schema 对齐（persist=false）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_coverage')
  assert.ok(def, 'jarvis_coverage 工具存在')
  const r = await def.execute({
    label: '契约回归',
    source: JSON.stringify([{ id: 'R1', title: '登录', status: 'open' }]),
    targets: JSON.stringify({ 方案设计: [{ id: 'D1', refs: ['R1'], status: 'completed', evidence: '设计稿 §1' }] }),
    persist: 'false',
  })
  assertToolContract(def, r)
  assert.deepStrictEqual(r.persisted, [], 'persist=false 时 persisted 必须为空数组（不是 undefined）')
})

test('jarvis_coverage：persist=true 落盘后 persisted 字段已被 schema 声明（D12 原始报错点）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_coverage')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'd12-cov-'))
  const r = await def.execute({
    label: '契约回归落盘',
    source: JSON.stringify([{ id: 'R1', title: '登录', status: 'open' }, { id: 'R2', title: '注册', status: 'open' }]),
    targets: JSON.stringify({
      方案设计: [{ id: 'D1', refs: ['R1'], status: 'completed', evidence: '设计稿 §1' }],
      测试验收: [{ id: 'T1', refs: ['R2'], status: 'completed', evidence: '用例 T1 通过' }],
    }),
    persist: 'true',
    slug: 'contract-regression',
    projectDir: proj,
  })
  // 副作用必须真实发生（否则测试没覆盖到落盘分支）
  assert.ok(Array.isArray(r.persisted) && r.persisted.length === 2, `persisted 应为 2 个落盘路径：${JSON.stringify(r.persisted)}`)
  assert.ok(r.persisted.every((p) => fs.existsSync(p)), 'persisted 里的路径必须真实存在')
  // 关键：persisted 是 execute 真返回字段，schema 必须声明它（否则真实宿主报 not a declared property）
  assertToolContract(def, r)
})

test('jarvis_board：add 一条 → 返回值无损可序列化且键全部被 schema 声明（D12）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  assert.ok(def, 'jarvis_board 工具存在')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'd12-board-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  const fsSvc = makeMockFs()
  const exec = { ctx: { fs: fsSvc }, agent: { session: { id: 'sess-contract', header: { cwd: proj } } } }
  rememberExec(exec) // 黑板写路径按「最近一次 exec 的 cwd」解析（boardFilePath）
  const r = await def.execute({ role: '测试', add: '发现：契约回归写入一条' }, exec)
  assertToolContract(def, r)
  // 真落盘（mock fs）+ ID 从真源取
  assert.strictEqual(r.persisted, true, 'mock fs 可写时必须真持久化')
  assert.ok(r.items.some((i) => i.content.includes('契约回归')), '条目应写入黑板')
})

test('jarvis_board：无 fs 服务（写不了盘）也不许出现 undefined 字段', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  // 不传 exec → fsSvc 为 null → 走内存返回分支（persisted 不返回，writeError 不返回）
  const r = await def.execute({ role: '测试', add: '问题：无 fs 环境' })
  assertToolContract(def, r)
  assert.ok(!Object.prototype.hasOwnProperty.call(r, 'writeError') || typeof r.writeError === 'string', 'writeError 若存在必须是字符串')
})

// ── D6：前置检查异常必须 fail-closed（检查函数崩溃 ≠ 通过）──────────────────────────
test('D6 fail-closed：check 抛异常 → checkError 被记录且判定为不通过（ok=false）', async () => {
  const { runFlowCheck, flowGateOk } = await import('../src/host/tools/deliver.js')
  const normal = await runFlowCheck([], async () => {})
  assert.deepStrictEqual(normal.missing, [], '正常 check 不改动 missing')
  assert.strictEqual(normal.checkError, '', '正常 check 无异常')
  assert.strictEqual(flowGateOk(normal.missing, normal.checkError), true, '正常且无缺失 → 通过')

  // stub：检查函数抛异常（模拟 fs 服务缺失/权限异常/坏 JSON 导致 check 崩溃）
  const boom = await runFlowCheck([], async () => { throw new Error('stub: 读取 .jarvis/docs 失败（EACCES）') })
  assert.ok(boom.checkError.includes('EACCES'), `异常信息必须被记录：${boom.checkError}`)
  assert.strictEqual(flowGateOk(boom.missing, boom.checkError), false, '检查异常必须 fail-closed（不许当成前置齐备）')

  // 兼容「返回新数组」写法仍然生效
  const replaced = await runFlowCheck(['旧项'], async () => ['新缺口'])
  assert.deepStrictEqual(replaced.missing, ['新缺口'], 'check 返回新数组时整体替换')
})
