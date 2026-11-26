/** 阶段产物写入闸回归测试（v0.27）。
 *
 *  用户定调（2026-11-26）：「/jarvis xxx 之后的每一个动作都需要代码控制，
 *  不能用提示词来描述必须做哪些步骤」。
 *
 *  已有基础：gates/stage.js 的阶段状态机（computeStage 按磁盘事实算阶段）+ STAGE_DENY
 *  （按工具名拦越阶段调用）。但它有个代码级漏洞：
 *   **STAGE_DENY 只按工具名拦，绕开它只需换个写文件的方式**——
 *   clarify 阶段调 jarvis_store(itemType=doc, name=方案设计-xxx)，
 *   方案设计文件凭空出现 → design 闸看到文件存在就放行 → 这一步实质被跳过。
 *   这是真实文件写入，提示词挡不住，必须在写入前机械拒绝。
 *
 *  本测试锁定：流程产物的写入必须过阶段校验；非流程产物（报告/代码/交付物）完全不拦。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { jarvisStageGate, productStageOf, PRODUCT_STAGE, recordGate } from '../src/host/plugin.js'

/** ⚠️ fs 服务必须挂在 exec.ctx（getFsService 读 exec.ctx，不是 exec.fs）——
 *  挂错位置 hasGlob 会 fail-open 返回 true，闸看起来"全都通过"，调试时极易误判。
 *  这个坑在 2026-11-26 调试时踩了 4 轮。 */
function mkFsSvc() {
  return {
    resolve: async (p) => p,
    listDir: async (p) => {
      try { return fs.readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })) }
      catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []; throw e }
    },
    readText: async (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } },
  }
}
function mkWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgate-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo-project' }))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目')  // 让 _flowState 认成 jarvis 工作区
  return dir
}
function mkExec(dir, tool, args) {
  return {
    name: tool,
    arguments: { ...args, projectDir: dir },
    ctx: { fs: mkFsSvc() },
    agent: { session: { id: 'session-wg', header: { cwd: dir } } },
  }
}
const call = (dir, tool, args) => jarvisStageGate(mkExec(dir, tool, args))
const storeDoc = (name) => ({ mode: 'save', itemType: 'doc', name })

// ── 产物 → 阶段归属表 ──────────────────────────────────────────────
test('productStageOf：按文件名前缀识别流程产物及其所属阶段', () => {
  assert.equal(productStageOf('需求规格-x.md').stage, 'clarify')
  assert.equal(productStageOf('任务编排-x.md').stage, 'decompose')
  assert.equal(productStageOf('方案设计-x.md').stage, 'design')
  assert.equal(productStageOf('基线清单-x.json').stage, 'clarify')
  // 路径形式也要认（取 basename）
  assert.equal(productStageOf('/opt/work/x/.jarvis/docs/方案设计-y.md').stage, 'design')
  // 非流程产物 → null
  assert.equal(productStageOf('审计报告-2026.md'), null)
  assert.equal(productStageOf('README.md'), null)
  assert.equal(productStageOf(''), null)
  // 表本身非空且每项都有 re/stage/label
  for (const p of PRODUCT_STAGE) {
    assert.ok(p.re instanceof RegExp && p.stage && p.label, 'PRODUCT_STAGE 每项必须有 re/stage/label')
  }
})

// ── clarify 阶段：不能写下游产物 ───────────────────────────────────
test('clarify 阶段：写方案设计/任务编排被拒（伪造下游产物这条路被堵死）', () => {
  const dir = mkWs()
  try {
    const r1 = call(dir, 'jarvis_store', storeDoc('方案设计-伪造'))
    assert.ok(typeof r1 === 'string', 'clarify 阶段写方案设计必须被拒')
    assert.ok(/不允许写「方案设计」/.test(r1), `拒绝文案必须点明被拒的是方案设计，实际：${r1.slice(0, 100)}`)
    assert.ok(/阶段 1\/6/.test(r1), '文案要说明当前阶段')

    const r2 = call(dir, 'jarvis_store', storeDoc('任务编排-伪造'))
    assert.ok(typeof r2 === 'string', 'clarify 阶段写任务编排必须被拒')

    // 本阶段产物应放行
    const ok1 = call(dir, 'jarvis_store', storeDoc('需求规格-正常'))
    assert.equal(ok1, undefined, 'clarify 阶段写需求规格应放行')
    // 非流程产物应放行
    const ok2 = call(dir, 'jarvis_store', { mode: 'save', itemType: 'report', name: '审计报告' })
    assert.equal(ok2, undefined, '非流程产物（report 类）不拦')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ── 进入 decompose 后：写任务编排放行，写方案设计仍拒 ───────────────
test('阶段推进后：本阶段产物放行，下游产物仍拒', () => {
  const dir = mkWs()
  try {
    fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求\n验收：' + 'x'.repeat(400))
    recordGate(dir, 'clarify', true)
    const ok1 = call(dir, 'jarvis_store', storeDoc('任务编排-正常'))
    assert.equal(ok1, undefined, 'decompose 阶段写任务编排应放行')
    const r2 = call(dir, 'jarvis_store', storeDoc('方案设计-伪造'))
    assert.ok(typeof r2 === 'string', 'decompose 阶段写方案设计仍应被拒')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ── 返工：可重写本阶段与更早阶段的产物 ─────────────────────────────
test('返工允许：进入 design 后可重写需求规格与任务编排', () => {
  const dir = mkWs()
  try {
    fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求\n验收：' + 'x'.repeat(400))
    fs.writeFileSync(path.join(dir, '.jarvis/docs/任务编排-x.md'), '# 编排')
    recordGate(dir, 'clarify', true)
    recordGate(dir, 'decompose', true)
    // 当前已到 design（缺方案设计）
    for (const n of ['需求规格-改', '任务编排-改']) {
      const r = call(dir, 'jarvis_store', storeDoc(n))
      assert.equal(r, undefined, `返工重写 ${n} 应放行（当前阶段已 >= 其归属阶段）`)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ── write/edit 工具同样受管（有写工具的会话也绕不过）────────────────
test('write/edit 写到 .jarvis/docs 下的流程产物同样被阶段校验', () => {
  const dir = mkWs()
  try {
    const r = call(dir, 'write', { file_path: path.join(dir, '.jarvis/docs/方案设计-伪造.md'), content: 'x' })
    assert.ok(typeof r === 'string', '用 write 工具伪造方案设计也必须被拒')
    // 写非流程产物路径 → 不拦
    const ok = call(dir, 'write', { file_path: path.join(dir, '.jarvis/reports/审计.md'), content: 'x' })
    assert.equal(ok, undefined, '写 reports/ 不受流程产物闸限制')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ── 不变量：非 jarvis 工作区 / 判不出阶段一律放行（不误伤）──────────
test('非 jarvis 工作区不受产物写入闸影响', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonjarvis-'))
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'plain' }))
    const r = call(dir, 'jarvis_store', storeDoc('方案设计-x'))
    assert.equal(r, undefined, '没有 .jarvis 的普通项目不应被拦')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
