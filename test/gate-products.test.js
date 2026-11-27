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

// ── v0.30：只读 shell 不得被 captain 闸误拦（用户实测死锁）────────
// 用户原文：想 `ls` 定位插件目录，撞上「还没建队不能执行 bash」→ 无法继续 →
// 而这阶段恰恰需要先探查环境。修法是把 bash 拆成「只读」和「写操作」两类。
test('isReadOnlyShell：只读命令放行，写操作命令拦住', async () => {
  const { isReadOnlyShell } = await import('../src/host/plugin.js')
  const readonly = [
    'ls -d /root/.dsh/plugins/* 2>/dev/null | head -20',
    'ls -d /opt/work/dba/node_modules/* 2>/dev/null | head',
    'cat foo.txt',
    'grep -r foo src/',
    'git status',
    'git log --oneline -3',
    'node --check a.js',
    'cd /tmp && ls',
    'curl -s https://example.com',
    'find . -name "*.md"',
    'wc -l x.js',
    'jq . x.json',
  ]
  for (const c of readonly) assert.equal(isReadOnlyShell(c, 'bash'), true, `应判只读：${c}`)

  const writes = [
    'echo hi > x.txt',
    'mkdir -p a',
    'rm -rf x',
    'npm test',
    'python3 a.py',
    'sed -i s/a/b/ x',
    'git commit -m x',
    'node script.js',
    'cp a b',
    'chmod +x a',
    'cat x | tee y',
  ]
  for (const c of writes) assert.equal(isReadOnlyShell(c, 'bash'), false, `应判写操作：${c}`)
})

test('isReadOnlyShell：2>/dev/null 与 2>&1 不算写重定向（这是误拦的主因）', async () => {
  const { isReadOnlyShell } = await import('../src/host/plugin.js')
  assert.equal(isReadOnlyShell('ls x 2>/dev/null', 'bash'), true, '2>/dev/null 是丢弃输出，不是写文件')
  assert.equal(isReadOnlyShell('ls x 2>&1 | head', 'bash'), true, '2>&1 是合并输出')
  assert.equal(isReadOnlyShell('ls x > out.txt', 'bash'), false, '真写文件要拦')
  assert.equal(isReadOnlyShell('ls x >> out.txt', 'bash'), false, '追加写也要拦')
})

test('captainExecutionGuard：**未建队时不拦 bash/write**（用户实测「无法正常工作」的死锁）', async () => {
  const { captainExecutionGuard } = await import('../src/host/plugin.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'))
  try {
    // 只建 .jarvis 不建团队 → _captainIds 会插 ANY_TOPLEVEL
    fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
    const mk = (tool, args) => ({ name: tool, arguments: args, agent: { session: { id: 'sess-g', header: { cwd: dir } } } })
    // v0.31 反转（用户实测 2026-11-27「现在都无法正常工作了」）：
    // 未建队时**不该拦 bash/write/edit** —— 没团队时没有"成员被架空"的问题，用户就是唯一干活的人。
    // 而产出需求规格（过 clarify 闸的前提）往往要先处理附件（python3/unzip/touch），全拦 = 死锁。
    for (const cmd of [
      'python3 -c "print(1)"',
      'unzip -l x.zip',
      'touch /tmp/x',
      'mkdir -p x',
      'npm test',
    ]) {
      assert.equal(captainExecutionGuard(mk('bash', { command: cmd })), undefined, `未建队时 bash 必须放行（否则死锁）：${cmd}`)
    }
    assert.equal(captainExecutionGuard(mk('write', { file_path: 'x', content: 'y' })), undefined, '未建队时 write 必须放行')
    assert.equal(captainExecutionGuard(mk('edit', { file_path: 'x' })), undefined, '未建队时 edit 必须放行')
    // 但「绕过任务单开子 agent」仍必须拦——这才是当初要防的（实测 14 个会话 tracked=0）
    assert.ok(typeof captainExecutionGuard(mk('subagent', {})) === 'string', 'subagent 未建队时必须拦（防绕过任务单）')
    assert.ok(typeof captainExecutionGuard(mk('workflow', {})) === 'string', 'workflow 未建队时必须拦')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('captainExecutionGuard：**建队后** captain 仍不得亲自执行（原设计意图保留）', async () => {
  const { captainExecutionGuard } = await import('../src/host/plugin.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard2-'))
  try {
    fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({ captainSessionId: 'cap-1', members: [], tasks: [] }))
    const mk = (tool, args) => ({ name: tool, arguments: args, agent: { session: { id: 'cap-1', header: { cwd: dir } } } })
    // 建队后：执行类仍拦（防"顶层把活干完"——实证某 captain bash 5.7 万次）
    assert.ok(typeof captainExecutionGuard(mk('bash', { command: 'python3 x.py' })) === 'string', '建队后跑脚本必须拦')
    assert.ok(typeof captainExecutionGuard(mk('write', { file_path: 'x', content: 'y' })) === 'string', '建队后 write 必须拦')
    assert.ok(typeof captainExecutionGuard(mk('edit', { file_path: 'x' })) === 'string', '建队后 edit 必须拦')
    // 但只读查看仍放行（detrox 环境仍是合法需求）
    assert.equal(captainExecutionGuard(mk('bash', { command: 'ls -la' })), undefined, '建队后只读仍放行')
    assert.equal(captainExecutionGuard(mk('bash', { command: 'git status' })), undefined)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
