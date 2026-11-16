/** 端到端模拟：真实 DSH 环境用 jarvis 能力 → 增强 UI 数据显示正确
 *  跑法：node test/e2e-full.mjs（用真实工具 + 真实快照，无需 DSH 服务）
 *
 *  模拟的是真实流程：需求规格 → 方案设计 → 角色卡 → 四道闸 → 建队 →
 *  派活 → 成员汇报 → UI 交付物/空白/日报
 */
import { TOOLS } from '../src/host/tools/index.js'
import { buildSnapshot } from '../src/host/state/snapshot.js'
import { captainExecutionGuard } from '../src/host/gates/stage.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SPEC_SRC = path.join(here, 'fixtures', '需求规格-拼团电商.md')

const jd = (n) => TOOLS.find((t) => t.name === n)
let pass = 0, fail = 0
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ' | ' + extra : ''}`)
  cond ? pass++ : fail++
  return cond
}

const PLAN = [
  '# 方案设计 · 拼团电商',
  '## 模块划分',
  '1. 商品服务：商品详情与拼团价',
  '2. 拼团服务：开团 / 参团 / 成团判定',
  '3. 订单服务：订单状态机（待成团/已成团/已退款）',
  '4. 支付与退款：支付回调与超时退款',
  '## 接口契约',
  '- POST /api/group/buy {productId,userId} → {orderId,groupId}',
  '- GET /api/group/:id → {status,participants,deadline}',
  '## 关键决定',
  '成团判定用定时扫描 + 支付回调双写，避免延迟漏判。',
].join('\n')

const CARD_CEO = [
  '### 身份', 'CEO 带队者', '### 思维模型', '先定目标再看资源',
  '### 方法论', '拆解→分工→验收', '### 红线', '不亲自执行',
  '### 协同', '调度与裁决', '### 证据', 'source: 内部约定（项目自建）',
].join('\n')

const CARD_FE = [
  '### 身份', '前端工程师', '### 思维模型', '用户视角优先',
  '### 方法论', '先搭骨架再填内容', '### 红线', '不做后端逻辑',
  '### 协同', '与后端对齐接口契约', '### 证据', 'source: 内部约定（项目自建）',
].join('\n')

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
fs.mkdirSync(path.join(ws, '.jarvis/docs'), { recursive: true })
fs.mkdirSync(path.join(ws, '.jarvis/cards'), { recursive: true })
fs.copyFileSync(SPEC_SRC, path.join(ws, '.jarvis/docs/需求规格-拼团电商.md'))
// 拆解文档（decompose 闸要求）
fs.writeFileSync(path.join(ws, '.jarvis/docs/任务编排-拼团电商.md'), '# 任务编排\n1. 下单页\n2. 支付接入\n3. 成团判定\n')
fs.writeFileSync(path.join(ws, '.jarvis/docs/方案设计-拼团电商.md'), PLAN)
fs.writeFileSync(path.join(ws, '.jarvis/cards/CEO.md'), CARD_CEO)
fs.writeFileSync(path.join(ws, '.jarvis/cards/前端.md'), CARD_FE)

const exec = { agent: { session: { id: 'sess-ceo', header: { cwd: ws } } } }

try {
  console.log('\n━━━ 1. 四道流程闸（clarify → decompose → design → build）━━━')
  for (const step of ['clarify', 'decompose', 'design', 'build']) {
    const r = await jd('jarvis_flowguard').execute({ step, projectDir: ws }, exec)
    ok(`${step} 闸通过`, r.ok === true, String(r.verdict || '').slice(0, 45))
  }

  console.log('\n━━━ 2. 建队（员工落盘）━━━')
  const co = await jd('jarvis_company').execute({
    mode: 'update', projectDir: ws,
    employees: JSON.stringify([{ id: 'e1', role: '前端', persona: '资深前端工程师', status: 'idle' }]),
  }, exec)
  ok('员工落盘', String(co.verdict || '').includes('员工 1'), String(co.verdict || '').slice(0, 45))

  console.log('\n━━━ 3. 派活（开任务单）━━━')
  const op = await jd('jarvis_ticket').execute({
    action: 'open', projectDir: ws, role: '前端',
    title: '实现拼团下单页', acceptance: '页面能走通 2 人团下单', project: '拼团电商',
  }, exec)
  ok('开单成功', op.ok === true, String(op.verdict || '').slice(0, 60))
  const ticketId = op.ticket && op.ticket.id

  console.log('\n━━━ 4. 成员汇报（progress → ready）━━━')
  const r1 = await jd('jarvis_ticket').execute({ action: 'report', projectDir: ws, ticketId, state: 'progress', summary: '下单页骨架完成，正在接支付' }, exec)
  ok('汇报 progress', r1.ok === true)
  const r2 = await jd('jarvis_ticket').execute({ action: 'report', projectDir: ws, ticketId, state: 'ready', summary: '下单页完成：用户能发起 2 人团并完成支付' }, exec)
  ok('汇报 ready（待验收）', r2.ok === true, String(r2.verdict || '').slice(0, 50))

  console.log('\n━━━ 5. UI 数据（增强页面真正读的）━━━')
  const snap = buildSnapshot(ws, { version: '0.15.3' })
  const dl = snap.deliverables || []
  ok('交付物聚合出 1 项', dl.length === 1, JSON.stringify(dl.map((x) => ({ n: x.name, pct: x.pct }))))
  if (dl.length) {
    const d = dl[0]
    // 真实行为：report state=ready 会让 ticket 直接结束（outcome=completed），
    // 所以验收状态是 passed（已交付），不是 pending。
    ok('验收状态 = 已交付', d.passed === 1, 'passed=' + d.passed)
    ok('完成率 100%', d.pct === 100, 'pct=' + d.pct)
    ok('结论 = 已交付（全部收口）', d.verdict === 'delivered', 'verdict=' + d.verdict)
    ok('明细带验收状态', (d.items || [])[0] && (d.items[0].acceptance === 'passed'), (d.items || [])[0] && d.items[0].acceptance)
  }
  ok('空白解释 = none（有任务不解释）', (snap.emptyReason || {}).kind === 'none')
  ok('日报有 1 条', (snap.dailyReports || []).length === 1, JSON.stringify((snap.dailyReports || []).map((x) => x.headline)))
} finally {
  fs.rmSync(ws, { recursive: true, force: true })
}

// ═══ 场景B：未建队守卫（防绕过任务单）═══
console.log('\n━━━ 6. 未建队守卫（防绕过任务单）━━━')
const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lock-'))
fs.mkdirSync(path.join(ws2, '.jarvis'), { recursive: true })
try {
  const e2 = { agent: { session: { id: 'x', header: { cwd: ws2 } } } }
  ok('subagent 被拦', typeof captainExecutionGuard({ name: 'subagent', ...e2 }) === 'string')
  ok('bash 被拦', typeof captainExecutionGuard({ name: 'bash', ...e2 }) === 'string')
  ok('jarvis_* 放行', captainExecutionGuard({ name: 'jarvis_dispatch_task', ...e2 }) === undefined)
} finally { fs.rmSync(ws2, { recursive: true, force: true }) }

// ═══ 场景C：空工作区（诚实空白）═══
console.log('\n━━━ 7. 空工作区（诚实空白）━━━')
const ws3 = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-empty-'))
fs.mkdirSync(path.join(ws3, '.jarvis'), { recursive: true })
try {
  const s3 = buildSnapshot(ws3, { version: 'x' })
  ok('deliverables 为空', (s3.deliverables || []).length === 0)
  ok('空白原因 normal', (s3.emptyReason || {}).kind === 'normal', (s3.emptyReason || {}).text)
} finally { fs.rmSync(ws3, { recursive: true, force: true }) }

console.log(`\n━━━ 汇总：${pass} 通过 / ${fail} 失败 ━━━`)
process.exit(fail ? 1 : 0)
