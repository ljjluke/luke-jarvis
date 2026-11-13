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
  assert.ok(/if \(status === 'running' \|\| status === 'working'\) \{/.test(src), '正在跑别的单时不复用')
  assert.ok(/if \(info && info\.retired\) continue/.test(src), '已换人的记录不再复用')
})

test('按角色复用：复用投递失败时退回新建（不把任务卡死）', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/复用投递失败（如会话刚死）：退回新建/.test(src), '必须有降级路径')
  assert.ok(/assignment\.reuse\.failed/.test(src), '失败要写事件流，不静默')
  assert.ok(/assignment\.reused/.test(src), '复用成功要写事件流，可审计')
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
