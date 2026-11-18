/** 按角色复用子会话（用户实测缺陷修复）测试。
 *
 *  问题（用户原话）：旧会话下发任务时，每单都会新开一个子任务，没有角色信息，
 *  子任务数量线性叠加，应该固定角色干活；除非 CEO 监测到阶段汇报有问题才通知猎头换人。
 *
 *  修复：
 *    · 同一角色在整个项目只开一个子会话，后续任务 followup 投递进去
 *    · 复用条件严格（会话必须仍活着、不在跑别的单）
 *    · 只有 CEO 显式 retire 才换人：终止旧会话 + 标记 retired，下次派发新建
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { statusRelPath } from '../src/host/adapters/dsh-executor.js'

function mkWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reuse-test-'))
  fs.mkdirSync(path.join(dir, '.jarvis/tickets'), { recursive: true })
  return dir
}
function rmWs(dir) { fs.rmSync(dir, { recursive: true, force: true }) }

// ── 源码级断言：复用逻辑存在且条件严格 ─────────────────────────────
test('按角色复用：派发前必须查「该角色是否已有活着的子会话」', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/function findReusableChild\(runtime, role\)/.test(src), '应有按角色查找可复用会话的函数')
  assert.ok(/const reuseId = findReusableChild\(runtime, assignment\.role\)/.test(src), 'dispatch 必须先查复用')
  assert.ok(/if \(reuseId\) \{/.test(src), '查到可复用会话时应走复用分支')
  assert.ok(/await deliverPrompt\(runtime, parent, reuseId, content\)/.test(src), '复用时应 followup 投递而不是新建')
  // ⛔ 复用必须发生在「创建新会话」之前
  const reuseIdx = src.indexOf('if (reuseId) {')
  const createIdx = src.indexOf("if (typeof runtime.startActivation === 'function')")
  assert.ok(reuseIdx > 0 && createIdx > reuseIdx, '复用检查必须在新建之前（复用 ' + reuseIdx + ' 新建 ' + createIdx + '）')
})

test('按角色复用：复用条件严格（活的会话才复用，绝不投进死会话）', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/const agent = liveIds\.get\(best\.childId\)/.test(src), '必须从活会话列表里查')
  assert.ok(/if \(!agent\) return null/.test(src), '会话不存在不复用')
  assert.ok(/status === 'ended' \|\| status === 'closed' \|\| status === 'terminated'/.test(src), '已终结的会话不复用')
  // 用户定调（2026-11-18）：角色正忙时**不再拒绝复用**——改为排队投递。
  // 旧断言「正在跑别的单时不复用」正是导致「每单新开一个」的元凶之一，已废弃。
  assert.ok(!/if \(status === 'running' \|\| status === 'working'\) \{[\s\S]{0,400}return null/.test(src), '不得因忙而拒绝复用（应排队）')
  assert.ok(/新任务排队/.test(src), '忙时应说明「新任务排队」而不是另开')
  assert.ok(/if \(info && info\.retired\) continue/.test(src), '已换人的记录不再复用')
})

test('按角色复用：复用投递失败**不再静默退回新建**（用户定调：不无限创建子任务）', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/assignment\.reuse\.failed/.test(src), '失败要写事件流，不静默')
  assert.ok(/assignment\.reused/.test(src), '复用成功要写事件流，可审计')
  // 关键：失败时必须抛错并把规则说清楚，而不是偷偷新开一个会话。
  assert.ok(/且没有开除凭据，不能新开会话/.test(src), '无开除凭据应拒绝新建并说明原因')
  assert.ok(/jarvis_ticket action=retry/.test(src), '应给出可执行的替代动作（重试）')
  assert.ok(!/复用投递失败（如会话刚死）：退回新建/.test(src), '旧注释描述的「静默退回新建」必须已移除')
})

// ── 新建成员会话的唯一合法凭据：CEO 开除 → 猎头重招 ─────────────────
test('新建子会话必须有开除凭据：exec-map retired 或 company-state terminated', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/function canCreateNewChild\(role\)/.test(src), '应有「能否新建」的凭据检查函数')
  assert.ok(/info && info\.retired/.test(src), '凭据之一：exec-map 里的 retired 记录')
  assert.ok(/status \|\| ''\) === 'terminated'/.test(src), '凭据之二：company-state 里员工 terminated')
  assert.ok(/没有开除记录——按规则应复用原会话排队/.test(src), '无凭据时应拒绝并说明规则')
  assert.ok(/assignment\.newchild\.authorized/.test(src), '有凭据而新建时应留审计事件')
  assert.ok(/拒绝为角色「\$\{assignment\.role\}」新开会话/.test(src), 'dispatch 新建前必须过这道闸')
})

test('新建子会话：首次上岗（历史上从未有过会话）允许直接建', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  // 规则不是「永不新建」——首次为该角色开单是正常流程；只有「开过但没开除」才拦。
  assert.ok(/const everHadSession = /.test(src), '必须区分「首次上岗」与「已开过」')
  assert.ok(/if \(everHadSession\) \{/.test(src), '仅在历史上开过时才要求开除凭据')
})

test('ponder 的二级子 agent 不经过本执行器，不受复用规则限制', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  // isChild/children 只用于两处：steer 投递校验 + captain 越权拦截。
  // 成员自己 spawn 的 ponder 子 agent 不登记进 children，因此完全不受影响。
  const uses = (src.match(/children\.has\(/g) || []).length
  assert.ok(uses <= 2, `children.has 只应出现在投递校验与越权拦截（实际 ${uses} 处）`)
})

// ── 换人机制 ────────────────────────────────────────────────────────
test('换人：只有 retire 才终止角色会话并标记（正常流程不换人）', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/retireRole\(role, reason\)/.test(src), '应有换人函数')
  assert.ok(/slot\[aid\] = \{ \.\.\.info, retired: true/.test(src), '换人应标记 retired')
  assert.ok(/agent\.cancel\(\{ kind: 'user' \}, \{\}\)/.test(src), '换人应终止旧会话')
  assert.ok(/assignment\.role\.retired/.test(src), '换人应写事件流')
  const deliverSrc = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')
  assert.ok(/if \(action === 'retire'\)/.test(deliverSrc), 'jarvis_ticket 应有 retire 动作')
  assert.ok(/retire 需要 role/.test(deliverSrc), 'retire 必须指定角色')
  assert.ok(/'retire'/.test(deliverSrc), 'retire 应在成员越权拦截表里（captain 专属）')
})

test('换人说明：明确「默认复用，只有绩效问题才换」', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/正常流程不该调用：默认按角色复用同一子会话，只有绩效问题才换/.test(src), '代码注释要写清使用边界')
})

// ── exec-map 结构（复用索引的持久化基础）───────────────────────────
test('复用索引持久化：exec-map 记录 role + childId，跨进程存活', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/function loadExecMap/.test(src) && /function saveExecMap/.test(src), '执行映射需持久化（否则重启后复用索引丢失）')
  assert.ok(/record\(ticket\.id, assignment\.id, \{ childId, provider, role: assignment\.role/.test(src), '记录必须含 role + childId')
  assert.ok(/record\(ticket\.id, assignment\.id, \{ childId: reuseId, provider, role: assignment\.role, reused: true/.test(src), '复用记录也要落盘')
})

test('STATUS.md 锚点仍按 ticket 隔离（复用会话不串单）', () => {
  // 复用的是「会话」，不是「状态文件」——每个任务单仍有自己的 STATUS.md
  assert.equal(statusRelPath({ id: 'ticket-a' }, null), '.jarvis/outputs/ticket-a/STATUS.md')
  assert.equal(statusRelPath({ id: 'ticket-b' }, null), '.jarvis/outputs/ticket-b/STATUS.md')
  assert.notEqual(statusRelPath({ id: 'ticket-a' }, null), statusRelPath({ id: 'ticket-b' }, null))
})
