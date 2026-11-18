/** 老板视角（方案 A/B/C/D/E）：交付物聚合、验收状态、空白语义、日报。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { buildSnapshot } from '../src/host/state/snapshot.js'

function mkWs(tickets = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-'))
  fs.mkdirSync(path.join(dir, '.jarvis', 'tickets'), { recursive: true })
  for (const t of tickets) fs.writeFileSync(path.join(dir, '.jarvis', 'tickets', `${t.id}.json`), JSON.stringify(t))
  return dir
}
function rm(d) { fs.rmSync(d, { recursive: true, force: true }) }
const T = (o) => ({ id: 'ticket-' + o.id, title: o.title || '任务', project: o.project, stage: 'build', createdAt: o.at || '2026-11-15T02:00:00Z', updatedAt: o.at || '2026-11-15T02:00:00Z', ended: o.ended, assignments: [{ role: o.role || '成员', state: o.state || 'running', report: o.report }] })

// ── A：交付物聚合 ────────────────────────────────────────────────────
test('A：按 project 聚合，多个需求各成一个交付物', () => {
  const ws = mkWs([
    T({ id: 'a1', title: '需求A-任务1', project: '/opt/p/a', report: { state: 'ready', summary: '做完了' } }),
    T({ id: 'a2', title: '需求A-任务2', project: '/opt/p/a', report: { state: 'ready' } }),
    T({ id: 'b1', title: '需求B-任务1', project: '/opt/p/b' }),
  ])
  try {
    const s = buildSnapshot(ws, { version: 'x' })
    const d = s.deliverables
    assert.equal(d.length, 2, '两个 project → 两个交付物')
    const a = d.find((x) => x.name === 'a')
    assert.equal(a.total, 2, '需求A 有 2 项')
    assert.equal(a.pending, 2, '两项都是「做完了待验收」')
    assert.equal(a.pct, 100, '待验收算交付到位 → 100%')
  } finally { rm(ws) }
})

test('A：有卡住的交付物排在最前（老板先看风险）', () => {
  const ws = mkWs([
    T({ id: 'ok1', title: '顺利的', project: '/opt/p/ok', report: { state: 'ready' } }),
    T({ id: 'bad1', title: '卡住的', project: '/opt/p/bad', report: { state: 'blocked' } }),
  ])
  try {
    const s = buildSnapshot(ws, { version: 'x' })
    assert.equal(s.deliverables[0].name, 'bad', '卡住的必须排第一')
    assert.equal(s.deliverables[0].verdict, 'blocked')
  } finally { rm(ws) }
})

test('A：没有 ticket 时 deliverables 为空（不编造）', () => {
  const ws = mkWs([])
  try {
    const s = buildSnapshot(ws, { version: 'x' })
    assert.equal(s.deliverables.length, 0)
  } finally { rm(ws) }
})

test('A：交付物名称用「需求名」而不是文件夹路径（老板看得懂）', () => {
  const ws = mkWs([])
  try {
    // 直接造 ticket，project 传中文需求名（真实调用应这样传）
    fs.writeFileSync(path.join(ws, '.jarvis/tickets/ticket-x1.json'), JSON.stringify({
      id: 'ticket-x1', title: '下单页', project: '拼团电商', stage: 'build',
      createdAt: '2026-11-16T02:00:00Z', updatedAt: '2026-11-16T02:00:00Z',
      assignments: [{ role: '前端', state: 'running', report: { state: 'ready' } }],
    }))
    const s = buildSnapshot(ws, { version: 'x' })
    assert.equal(s.deliverables[0].name, '拼团电商', '中文需求名必须原样显示')
    // 旧数据（project 是路径）要能降级到末段名
    fs.writeFileSync(path.join(ws, '.jarvis/tickets/ticket-x2.json'), JSON.stringify({
      id: 'ticket-x2', title: '任务2', project: '/opt/work/my-proj', stage: 'build',
      createdAt: '2026-11-16T03:00:00Z', updatedAt: '2026-11-16T03:00:00Z',
      assignments: [],
    }))
    const s2 = buildSnapshot(ws, { version: 'x' })
    const pathOne = s2.deliverables.find((x) => x.name === 'my-proj')
    assert.ok(pathOne, '路径型 project 应显示末段名（不是整条路径）')
  } finally { rm(ws) }
})

// ── E：验收状态归一 ──────────────────────────────────────────────────
test('E：验收状态四态归一 + unknown 兜底', () => {
  const ws = mkWs([
    T({ id: 'p', title: '通过', project: '/p/x', ended: { outcome: 'passed' } }),
    T({ id: 'r', title: '驳回', project: '/p/x', ended: { outcome: 'rejected' } }),
    T({ id: 'w', title: '等验收', project: '/p/x', report: { state: 'ready' } }),
    T({ id: 'k', title: '卡住', project: '/p/x', report: { state: 'blocked' } }),
    T({ id: 'u', title: '看不懂', project: '/p/x', ended: { outcome: 'weird_value' } }),
  ])
  try {
    const s = buildSnapshot(ws, { version: 'x' })
    const items = s.deliverables[0].items
    const acc = (t) => items.find((x) => x.title === t).acceptance
    assert.equal(acc('通过'), 'passed')
    assert.equal(acc('驳回'), 'abandoned')
    assert.equal(acc('等验收'), 'pending')
    assert.equal(acc('卡住'), 'blocked')
    assert.equal(acc('看不懂'), 'unknown', '判不出来就是 unknown，不许猜')
  } finally { rm(ws) }
})

// ── C：空白语义 ──────────────────────────────────────────────────────
test('C：工作在跑但无任务单 → offbook 并给出数量', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-'))
  const ws = path.join(home, 'proj')
  fs.mkdirSync(path.join(ws, '.jarvis'), { recursive: true })
  const oldHome = process.env.HOME
  process.env.HOME = home
  try {
    const dn = '--' + ws.replace(/^\/+|\/+$/g, '').replace(/[\/]+/g, '-') + '--'
    const sd = path.join(home, '.dsh', 'sessions', dn, 'aaaaaaaa-1111-2222-3333-444444444444')
    fs.mkdirSync(sd, { recursive: true })
    fs.writeFileSync(path.join(sd, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', cwd: ws, origin: 'subagent', parentSession: 's' }) + '\n')))
    const s = buildSnapshot(ws, { version: 'x' })
    assert.equal(s.emptyReason.kind, 'offbook')
    assert.equal(s.emptyReason.count, 1)
    assert.ok(s.emptyReason.text.includes('绕过'), '要说清是绕过了任务单')
  } finally { process.env.HOME = oldHome; fs.rmSync(home, { recursive: true, force: true }) }
})

test('C：有任务时 emptyReason 为 none（不该解释）', () => {
  const ws = mkWs([T({ id: 'x', project: '/p/x' })])
  try {
    const s = buildSnapshot(ws, { version: 'x' })
    assert.equal(s.emptyReason.kind, 'none')
    assert.equal(s.emptyReason.text, '')
  } finally { rm(ws) }
})

// ── D：日报 ──────────────────────────────────────────────────────────
test('D：按天聚合完成/卡住，给出可读标题', () => {
  const ws = mkWs([
    T({ id: 'd1', title: '完成了', project: '/p/x', at: '2026-11-15T03:00:00Z', report: { state: 'ready', summary: '交付文档' } }),
    T({ id: 'd2', title: '卡住了', project: '/p/x', at: '2026-11-15T04:00:00Z', report: { state: 'blocked' } }),
  ])
  try {
    const s = buildSnapshot(ws, { version: 'x' })
    const r = s.dailyReports
    assert.equal(r.length, 1, '同一天 → 一条日报')
    assert.equal(r[0].date, '2026-11-15')
    assert.equal(r[0].doneCount, 1)
    assert.equal(r[0].stuckCount, 1)
    assert.ok(r[0].headline.includes('1 项完成') && r[0].headline.includes('1 项卡住'), '要说人话')
  } finally { rm(ws) }
})

// ── B：主屏裁剪（源码级）──────────────────────────────────────────────
test('B：主屏只渲染交付物/空白/决策/提案/阻塞/汇报，技术卡不进主屏', () => {
  const html = fs.readFileSync(new URL('../webui/jarvis-v2-wings.html', import.meta.url), 'utf8')
  const orderMatch = html.match(/const order=\[([^\]]+)\]/)
  assert.ok(orderMatch, '要有渲染顺序')
  const names = orderMatch[1].split(',').map((s) => s.trim())
  // 主屏首卡是「贾维斯汇报」——他的工作方式是汇报结果，不是摆台账。
  // 其后依次是需你处理的（卡住/拍板）、进展、其他。
  assert.ok(
    names[0] === 'cardJarvisBrief' || names[0] === 'cardBlocked' || names[0] === 'cardDeliverables',
    '主屏首卡必须是汇报、需你处理的、或交付进展三者之一'
  )
  assert.ok(names.includes('cardJarvisBrief'), '贾维斯汇报卡必须接入主屏')
  assert.ok(names.includes('cardDeliverables'), '交付物卡必须仍在主屏')
  assert.ok(names.includes('cardEmptyReason'), '空白解释卡必须在位')
  for (const gone of ['cardTaskPoints', 'cardPageCards', 'cardTeam', 'cardGC', 'cardQueue']) {
    assert.ok(!names.includes(gone), `${gone} 不该占主屏（技术细节移入详情/历史）`)
  }
  assert.ok(/function cardDeliverables/.test(html), '交付物卡函数存在')
  assert.ok(/function cardEmptyReason/.test(html), '空白卡函数存在')
})
