/** 流程闸产物检查回归测试（v0.26）。
 *
 *  用户质疑（2026-11-26）：「整个工作流程没有代码细化下去，导致有些步骤被跳过了」
 *  「不是加强制提示词就能解决的问题」——要的是代码闸，不是提示词。
 *
 *  实测确认的真实缺陷（2026-11-26）：
 *    decompose 闸只查「上一步的产物（需求规格）」→ 自己的产物（任务编排图）从没被查
 *    design  闸只查「上一步的产物（任务编排图）」→ 自己的产物（方案设计）从没被查
 *    结果：空工作区调 jarvis_flowguard(step="decompose") → ok=true，「拆解」这步可完全跳过。
 *    真正拦住它们的只有 build 闸里的「方案设计存在」检查——但那是三段之后才发生。
 *
 *  ⚠️ 本测试文件的关键教训：**fs 服务必须挂在 exec.ctx 上**。
 *    getFsService(exec) 实际读的是 `exec.ctx`（见 runtime.js:112-133），
 *    不是 `exec.fs`。挂错位置 → hasGlob 拿不到 fs 服务 → fail-open 返回 true
 *    → 闸看起来"全都是通过"，调试时会误以为修没生效。
 *    这个坑我在 2026-11-26 调试时踩了 4 轮才定位到。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TOOLS } from '../src/host/plugin.js'

const fg = TOOLS.find((t) => t.name === 'jarvis_flowguard')
assert.ok(fg, 'jarvis_flowguard 必须存在')

/** 造一个真实的 fs 服务（必须挂在 exec.ctx 上才被 getFsService 认到）。 */
function mkFsSvc() {
  return {
    resolve: async (p) => p,
    listDir: async (p) => {
      try {
        return fs.readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
      } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []; throw e }
    },
    readText: async (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } },
  }
}
function mkExec(dir) {
  return { ctx: { fs: mkFsSvc() }, agent: { session: { id: 'session-test', header: { cwd: dir } } } }
}
function mkWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-v026-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo-project' }))
  return dir
}
const DOCS = (dir) => path.join(dir, '.jarvis/docs')
function writeDoc(dir, name, body) {
  fs.mkdirSync(DOCS(dir), { recursive: true })
  fs.writeFileSync(path.join(DOCS(dir), name), body)
}

// ── decompose：必须验自己的产物（任务编排图）────────────────────────
test('decompose 闸：空工作区必须拦（原实现恒 ok=true）', async () => {
  const dir = mkWs()
  try {
    const r = await fg.execute({ step: 'decompose', projectDir: dir }, mkExec(dir))
    assert.equal(r.ok, false, '空工作区不能过 decompose 闸')
    assert.ok(r.missing.some((m) => m.includes('任务编排')), `必须点名缺任务编排图，实际：${JSON.stringify(r.missing)}`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('decompose 闸：只有需求规格、无任务编排图 → 必须拦（这是"拆解被跳过"的直接场景）', async () => {
  const dir = mkWs()
  try {
    writeDoc(dir, '需求规格-x.md', '# 需求\n验收：' + '可登录。'.repeat(100))
    const r = await fg.execute({ step: 'decompose', projectDir: dir }, mkExec(dir))
    assert.equal(r.ok, false, '没有任务编排图不能过 decompose 闸')
    const joined = r.missing.join('\n')
    assert.ok(/拆解这一步没有产出/.test(joined), `必须明确说"拆解没产出"，实际：${joined.slice(0, 200)}`)
    assert.ok(/任务编排/.test(joined), '必须点名任务编排图')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('decompose 闸：补上任务编排图后放行', async () => {
  const dir = mkWs()
  try {
    writeDoc(dir, '需求规格-x.md', '# 需求\n验收：' + '可登录。'.repeat(100))
    writeDoc(dir, '任务编排-x.md', '# 任务编排\nT1 → T2')
    const r = await fg.execute({ step: 'decompose', projectDir: dir }, mkExec(dir))
    assert.equal(r.ok, true, `补齐产物后应放行，实际 missing=${JSON.stringify(r.missing)}`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ── design：必须验自己的产物（方案设计）──────────────────────────────
test('design 闸：有任务编排、无方案设计 → 必须拦（"方案设计被跳过"的直接场景）', async () => {
  const dir = mkWs()
  try {
    writeDoc(dir, '需求规格-x.md', '# 需求\n验收：' + 'x'.repeat(400))
    writeDoc(dir, '任务编排-x.md', '# 编排')
    const r = await fg.execute({ step: 'design', projectDir: dir }, mkExec(dir))
    assert.equal(r.ok, false, '没有方案设计不能过 design 闸')
    const joined = r.missing.join('\n')
    assert.ok(/方案设计这一步没有产出/.test(joined), `必须明确说"方案设计没产出"，实际：${joined.slice(0, 200)}`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('design 闸：补上方案设计后放行', async () => {
  const dir = mkWs()
  try {
    writeDoc(dir, '需求规格-x.md', '# 需求\n验收：' + 'x'.repeat(400))
    writeDoc(dir, '任务编排-x.md', '# 编排')
    writeDoc(dir, '方案设计-x.md', '# 方案\n需求→落点')
    const r = await fg.execute({ step: 'design', projectDir: dir }, mkExec(dir))
    assert.equal(r.ok, true, `补齐产物后应放行，实际 missing=${JSON.stringify(r.missing)}`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ── 不变量：拆解与方案设计闸必须验自己的产物 ─────────────────────────
test('decompose/design 闸的 pre 清单都包含"本步自己的产物"', () => {
  const src = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')
  const start = src.indexOf('const STEP_PRECOND = {')
  const end = src.indexOf('const cfg = STEP_PRECOND[step]')
  const body = src.slice(start, end)
  // clarify 是第一步（pre 本来就空，产物在 check 里验），不进这张表
  const expectations = [
    ['decompose', '任务编排'],
    ['design', '方案设计'],
    ['build', '方案设计'],
  ]
  for (const [step, product] of expectations) {
    const i = body.indexOf(step + ': {')
    assert.ok(i > 0, `STEP_PRECOND 应有 ${step} 段`)
    const seg = body.slice(i, i + 900)
    const preLine = seg.slice(seg.indexOf('pre:'), seg.indexOf('check:'))
    assert.ok(preLine.includes(product), `${step} 闸的 pre 必须包含自己的产物「${product}」，实际：${preLine.slice(0, 120)}`)
  }
})

test('clarify 闸在 check 里验自己的产物（pre 为空是正常的，它是第一步）', () => {
  const src = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')
  const i = src.indexOf('clarify: {')
  const seg = src.slice(i, i + 1200)
  assert.ok(/hasGlob[\s\S]{0,200}需求规格/.test(seg), 'clarify 的 check 必须验证需求规格存在')
  assert.ok(/plain\.length < 300/.test(seg), '还要验内容不薄（≥300 字）')
  assert.ok(/\/验收\//.test(seg), '还要验含「验收」标准')
})

// ── 教训固化：fs 服务必须挂 exec.ctx ────────────────────────────────
test('fs 服务挂在 exec.ctx 才能被闸取到（挂 exec.fs 会被静默 fail-open）', () => {
  // 从源码确认：getFsService 读的是 exec.ctx
  const src = fs.readFileSync(new URL('../src/host/runtime.js', import.meta.url), 'utf8')
  const i = src.indexOf('export function getFsService')
  const seg = src.slice(i, i + 700)
  assert.ok(/pick\(exec && exec\.ctx\)/.test(seg), 'getFsService 必须从 exec.ctx 取 fs（不是 exec.fs）')
  assert.ok(/pick\(moduleCtx\)/.test(seg), '取不到时回退 moduleCtx')
})
