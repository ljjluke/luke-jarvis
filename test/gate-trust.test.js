/** D1/D5/K26 闸门可信度回归：阶段判据基址、落闸返回值、步骤留痕守卫。
 *
 *  缺陷实证（本轮 audit）：
 *   · D1：jarvisStageGate 只读会话 cwd，工具按 args.projectDir 落状态 → 两者指向不同目录时阶段恒错。
 *   · D5：flowguard `try { if (ok) recordGate(...) } catch {}` 丢弃返回值 → 状态根拒写仍报 ✅
 *         （用户看到「过闸了」但 gates.json 没写，下游永远被阶段闸拒 = 鬼打墙）。
 *   · K26 同族：done=true 的 flow-progress 留痕无守卫 → 出现「闸没写、留痕写了」的半真状态。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stageBase, PROJECTDIR_TOOLS, jarvisStageGate, computeStage } from '../src/host/gates/stage.js'
import { recordGate } from '../src/host/gates/store.js'
import { DELIVER_TOOLS } from '../src/host/tools/deliver.js'

/** 精确处于 build / execute 阶段的工作区夹具（build 缺 build 闸 → 阶段停在 4；execute 有 build 闸 + 未完成任务 → 阶段 5） */
function stageFixture(stage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gate-trust-${stage}-`))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目')
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  fs.writeFileSync(path.join(dir, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  fs.writeFileSync(path.join(dir, '.jarvis/docs/方案设计-x.md'), '# 方案')
  fs.mkdirSync(path.join(dir, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/cards/a.md'), 'x')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/b.md'), 'x')
  fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({
    name: 't1', captainSessionId: 'cap',
    tasks: [{ id: 'task-1', status: stage === 'execute' ? 'in_progress' : 'completed', assignee: 'm1', subject: 's' }],
  }))
  for (const step of ['clarify', 'decompose', 'design']) recordGate(dir, step, true)
  if (stage === 'execute') recordGate(dir, 'build', true) // build 闸过了 → 阶段推进到 execute
  return dir
}

/** 造一个「长得像插件仓」的目录（不碰被测仓）：package.json name=luke-jarvis + src/host/plugin.js */
function fakePluginRepo(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-trust-plugin-'))
  fs.mkdirSync(path.join(dir, 'src/host'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'luke-jarvis', version: '0.0.0' }))
  fs.writeFileSync(path.join(dir, 'src/host/plugin.js'), '// fake\n')
  if (opts.withTeam) {
    fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({ name: 't1', captainSessionId: 'cap', tasks: [] }))
  }
  if (opts.withReqDoc) {
    fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  }
  return dir
}

/** 真实文件系统适配器（mock DSH FileSystem：resolve/readText/writeText/list） */
function realFsAdapter() {
  const p = (t) => String(typeof t === 'object' && t !== null ? (t.path || t.targetKey || '') : t)
  return {
    async resolve(target) { return { path: String(target) } },
    async readText(t) { try { return fs.readFileSync(p(t), 'utf8') } catch { return null } },
    async writeText(t, content) {
      const f = p(t)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, content)
      return {}
    },
    async list(dir) { try { return fs.readdirSync(p(dir)) } catch { return null } },
  }
}

const gateCall = (name, execArgs) =>
  jarvisStageGate({ name, arguments: execArgs, agent: { session: { id: 'sess-1', header: { cwd: execArgs && execArgs.__cwd ? execArgs.__cwd : '/tmp' } } } })

// ── D1：阶段判据基址（stageBase）──────────────────────────────────────────────
test('D1 stageBase：优先本次调用声明的 projectDir（绝对路径+存在目录）', () => {
  const proj = stageFixture('build')
  const exec = { name: 'jarvis_coverage', arguments: { projectDir: proj }, agent: { session: { header: { cwd: '/tmp' } } } }
  assert.strictEqual(stageBase(exec), proj, '应使用 projectDir（= 工具落状态的地方），不是会话 cwd')
})

test('D1 stageBase：非法 projectDir（相对路径/不存在）回退会话 cwd', () => {
  const proj = stageFixture('build')
  const rel = { name: 'jarvis_coverage', arguments: { projectDir: './x' }, agent: { session: { header: { cwd: proj } } } }
  assert.strictEqual(stageBase(rel), proj, '相对路径不能当状态根 → 回退 cwd')
  const missing = { name: 'jarvis_coverage', arguments: { projectDir: '/nonexistent-jarvis-dir-xyz' }, agent: { session: { header: { cwd: proj } } } }
  assert.strictEqual(stageBase(missing), proj, '不存在目录不能当状态根 → 回退 cwd')
})

test('D1 stageBase：工具 schema 没声明 projectDir → 不认该参数（防随便传参把闸判到别处）', () => {
  const proj = stageFixture('build')
  // jarvis_essence 没有 projectDir 参数（schema 未声明）→ 传了也不该改变判据
  assert.ok(!PROJECTDIR_TOOLS.has('jarvis_essence'), 'jarvis_essence 不接 projectDir')
  const exec = { name: 'jarvis_essence', arguments: { projectDir: proj }, agent: { session: { header: { cwd: '/tmp' } } } }
  assert.strictEqual(stageBase(exec), '/tmp', '未声明 projectDir 的工具必须回退会话 cwd')
  // 批次1b：taskgraph 已声明 projectDir → 必须被认（D1 覆盖补全）
  assert.ok(PROJECTDIR_TOOLS.has('jarvis_taskgraph'), 'jarvis_taskgraph 已声明 projectDir，必须进白名单')
  assert.strictEqual(stageBase({ name: 'jarvis_taskgraph', arguments: { projectDir: proj }, agent: { session: { header: { cwd: '/tmp' } } } }), proj, 'taskgraph 的 projectDir 必须生效')
})

test('D1 stageBase：无 exec/无 cwd/无 projectDir → 空串（判不出工作区 → 放行）', () => {
  assert.strictEqual(stageBase(undefined), '', '无 exec')
  assert.strictEqual(stageBase({ name: 'jarvis_coverage', agent: { session: { header: {} } } }), '', '无 cwd')
})

test('D1 PROJECTDIR_TOOLS：白名单必须与工具 schema 的 projectDir 声明逐一对齐（防漂移）', async () => {
  const { TOOLS } = await import('../src/host/tools/index.js')
  const declaring = TOOLS
    .filter((t) => t.parameters && t.parameters.properties && t.parameters.properties.projectDir)
    .map((t) => t.name)
  const listed = [...PROJECTDIR_TOOLS]
  assert.deepStrictEqual(
    listed.slice().sort(),
    declaring.slice().sort(),
    `PROJECTDIR_TOOLS 与真实工具参数不一致（多出=${listed.filter((n) => !declaring.includes(n))}，漏了=${declaring.filter((n) => !listed.includes(n))}）`,
  )
})

// ── D1：阶段网关真的跟着 projectDir 走（两个方向都验）──────────────────────────
test('D1 阶段网关：cwd 阶段拒绝、projectDir 阶段放行 → 跟着 projectDir 放行（原实现会被 cwd 误拒）', () => {
  const buildDir = stageFixture('build')     // 阶段 4：jarvis_coverage 被 deny
  const executeDir = stageFixture('execute') // 阶段 5：jarvis_coverage 放行
  assert.strictEqual(computeStage(buildDir).stage, 'build', '夹具状态要精确')
  assert.strictEqual(computeStage(executeDir).stage, 'execute', '夹具状态要精确')
  // 会话 cwd 指向 build 阶段（原来必拒），但本次调用声明 projectDir=execute 阶段
  const r = jarvisStageGate({
    name: 'jarvis_coverage',
    arguments: { projectDir: executeDir },
    agent: { session: { id: 'sess-1', header: { cwd: buildDir } } },
  })
  assert.strictEqual(r, undefined, '判据必须跟 projectDir 走（修复前会被会话 cwd 拒）')
})

test('D1 阶段网关：cwd 阶段放行、projectDir 阶段拒绝 → 跟着 projectDir 拒绝（不许拿 cwd 蒙过去）', () => {
  const buildDir = stageFixture('build')
  const executeDir = stageFixture('execute')
  const r = jarvisStageGate({
    name: 'jarvis_coverage',
    arguments: { projectDir: buildDir },
    agent: { session: { id: 'sess-1', header: { cwd: executeDir } } },
  })
  assert.strictEqual(typeof r, 'string', 'projectDir 是 build 阶段 → coverage 必须被拒')
  assert.ok(r.includes('阶段 4/6') && r.includes('建队派活'), `拒绝文案须含真实阶段：${r}`)
})

// ── D1 覆盖补全（批次1b）：taskgraph 声明 projectDir 后，闸必须按它判 ──────────────
/** 精确处于 decompose 阶段（有需求规格+任务编排，但 decompose 闸未过） */
function decomposeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-trust-decompose-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目')
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  fs.writeFileSync(path.join(dir, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  recordGate(dir, 'clarify', true) // 只过 clarify → 阶段停在 decompose
  return dir
}

test('D1 阶段网关·taskgraph：cwd 在 build（taskgraph 被拒）但 projectDir 在 decompose（允许）→ 必须按 projectDir 放行', () => {
  const buildDir = stageFixture('build')
  const decomposeDir = decomposeFixture()
  assert.strictEqual(computeStage(buildDir).stage, 'build', 'cwd 夹具应处于 build（该阶段 deny taskgraph）')
  assert.strictEqual(computeStage(decomposeDir).stage, 'decompose', 'projectDir 夹具应处于 decompose（该阶段允许 taskgraph）')
  // 旧实现只读会话 cwd → 必拒（阶段4）；新实现按 projectDir → 放行
  const r = jarvisStageGate({
    name: 'jarvis_taskgraph',
    arguments: { projectDir: decomposeDir },
    agent: { session: { id: 'sess-1', header: { cwd: buildDir } } },
  })
  assert.strictEqual(r, undefined, `taskgraph 必须按 projectDir(=decompose) 判放行：${r}`)
})

// ── D5：落闸返回值必须被消费（状态根拒写不许报 ✅）──────────────────────────────
test('D5 flowguard：projectDir 指向插件仓且闸写不进去 → ok:false + GATE_NOT_RECORDED（不许 ✅）', async () => {
  const repo = fakePluginRepo() // 无 .agent-teams/team.json → recordGate 一律拒写
  const fg = DELIVER_TOOLS.find((t) => t.name === 'jarvis_flowguard')
  // 不传 exec：无 fs 服务 → 前置 STATE_ROOT_CONFLICT 检查会被 hasGlob 的 fail-open 绕过，
  //   直接走到「落闸」这一步（= D5 的真实触发路径：闸写不进去但旧实现照样 ✅）
  const r = await fg.execute({ step: 'clarify', projectDir: repo })
  assert.strictEqual(r.ok, false, `闸没写进去必须 fail：${JSON.stringify({ ok: r.ok, verdict: r.verdict })}`)
  assert.strictEqual(r.error, 'GATE_NOT_RECORDED', '应给出明确错误码')
  assert.ok(r.verdict.includes('闸记录未写入'), `必须写明原因（不许静默 ✅）：${r.verdict}`)
  assert.ok(!r.verdict.startsWith('✅'), '绝不输出成功标记')
  assert.ok(!fs.existsSync(path.join(repo, '.jarvis/gates.json')), '插件仓不得被写入 gates.json（状态根守卫仍有效）')
})

test('D5 flowguard：done=true 的 flow-progress 写入被状态根守卫拒绝 → ok:false + PROGRESS_NOT_RECORDED', async () => {
  // 带 team.json 的插件仓（联调场景）：recordGateRaw 的「例外」允许闸写盘，但 .jarvis/ 留痕仍受状态根守卫约束。
  // 不传 exec（无 fs 服务）→ 前置 STATE_ROOT_CONFLICT 检查被 hasGlob 的 fail-open 绕过，才会走到留痕分支。
  const repo = fakePluginRepo({ withTeam: true, withReqDoc: true })
  const fg = DELIVER_TOOLS.find((t) => t.name === 'jarvis_flowguard')
  const r = await fg.execute({ step: 'clarify', projectDir: repo, done: true }, {})
  assert.strictEqual(r.ok, false, `留痕写不进去必须 fail：${JSON.stringify({ ok: r.ok, verdict: r.verdict })}`)
  assert.strictEqual(r.error, 'PROGRESS_NOT_RECORDED', '应给出明确错误码')
  assert.ok(r.verdict.includes('STATE_ROOT_CONFLICT'), `必须写明守卫原因：${r.verdict}`)
  assert.ok(fs.existsSync(path.join(repo, '.jarvis/gates.json')), '本场景闸确实写盘了（半真状态：闸写了、留痕没写）')
  assert.ok(!fs.existsSync(path.join(repo, '.jarvis/flow-progress.json')), '状态根被拒时不许写 flow-progress')
})

test('D5 flowguard：正常可写工作区 → 闸与留痕都真落盘，ok:true', async () => {
  const proj = stageFixture('build')
  const fg = DELIVER_TOOLS.find((t) => t.name === 'jarvis_flowguard')
  const exec = { ctx: { fs: realFsAdapter() }, agent: { session: { id: 'cap', header: { cwd: proj } } } }
  const r = await fg.execute({ step: 'decompose', projectDir: proj, done: true }, exec)
  assert.strictEqual(r.ok, true, `正常路径应通过：${JSON.stringify(r.missing)}`)
  assert.ok(fs.existsSync(path.join(proj, '.jarvis/gates.json')), '闸必须写盘')
  const fpg = JSON.parse(fs.readFileSync(path.join(proj, '.jarvis/flow-progress.json'), 'utf8'))
  assert.ok(fpg.steps.some((s) => s.step === 'decompose'), '步骤留痕必须写盘')
})
