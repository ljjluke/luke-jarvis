/** 团队一览「员工实况」回归测试（v0.35）。
 *
 *  用户实测（2026-11-27）：「团队一览里面的员工干活还是假的啊」
 *
 *  根因（不是渲染造假，是**读错了数据源**）：
 *    · Wings UI 团队一览 read snap.tasks.teams ← state/snapshot.js#listTeams
 *    · listTeams 只读 <ws>/.agent-teams/<team>/team.json
 *    · office-bridge#deriveEmployeeFacts 同样以 .agent-teams 为第一源，且「读不到就 return []」
 *    · 但本部署建队/派活链路（jarvis_distill → jarvis_company → jarvis_dispatch_task
 *      → jarvis_ticket）**一个字节都不写 .agent-teams/**
 *  → 新工作区画面永远空；老工作区显示 11 月 agent_teams 时代的残留假成员。
 *
 *  另有一处"假"：Wings UI 的汇报卡把**所有** dsh 子会话当成"员工在干活"，
 *  其中 untracked 的是用户自己开的子会话（不在 exec-map 里）——活根本不是 jarvis 派的。
 *
 *  本测试锁定：
 *    ① 员工只来自 .jarvis/cards（+ company-state 增强），captain 不算员工
 *    ② 在办活只来自 .jarvis/tickets 未结束的单
 *    ③ working 必须有活着的证据（STATUS 新鲜 / exec-map childId / 单刚更新），否则 stalled
 *    ④ 无任何事实 → 空（不造假人）
 *    ⑤ snapshot.listTeams 必须把 jarvis 事实叠加成团队（否则前端永远空）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deriveJarvisFacts, jarvisTeamShape, STALE_MS } from '../src/host/state/jarvis-facts.js'
import { buildSnapshot } from '../src/host/state/snapshot.js'

/** 建一个最小 jarvis 工作区。 */
function mkWorkspace({ cards = [], tickets = [], company = null, execMap = null, status = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfacts-'))
  const jv = path.join(dir, '.jarvis')
  fs.mkdirSync(path.join(jv, 'cards'), { recursive: true })
  fs.mkdirSync(path.join(jv, 'tickets'), { recursive: true })
  for (const c of cards) fs.writeFileSync(path.join(jv, 'cards', `${c}.md`), `身份定位：${c}\n`)
  for (const t of tickets) {
    fs.writeFileSync(path.join(jv, 'tickets', `${t.id}.json`), JSON.stringify(t, null, 2))
  }
  if (company) fs.writeFileSync(path.join(jv, 'company-state.json'), JSON.stringify(company))
  if (execMap) fs.writeFileSync(path.join(jv, 'tickets', 'exec-map.json'), JSON.stringify(execMap))
  for (const [tid, text] of Object.entries(status)) {
    fs.mkdirSync(path.join(jv, 'outputs', tid), { recursive: true })
    fs.writeFileSync(path.join(jv, 'outputs', tid, 'STATUS.md'), text)
  }
  return dir
}

function mkTicket({ id, role, title, ended = null, updatedAt = new Date().toISOString(), state = 'running', report = null }) {
  return {
    id, title, project: '/x', stage: 'build',
    mandate: { strength: 'explicit', basis: 'x', at: 'now' },
    assignments: [{ id: `${id}-a1`, role, state, createdAt: 'now', startedAt: 'now', ...(report ? { report } : {}) }],
    createdAt: 'now', updatedAt, ended,
  }
}

test('员工只来自 .jarvis/cards；captain 不算员工', () => {
  const ws = mkWorkspace({ cards: ['CEO', '研发', 'captain'] })
  try {
    const f = deriveJarvisFacts(ws, fs, path)
    assert.deepEqual(f.employees.map((e) => e.role).sort(), ['CEO', '研发'].sort(), 'captain 不该出现在员工列表')
    assert.equal(f.employees[0].status, 'idle', '没有任何任务单 → idle（不编造在干活）')
    assert.equal(f.employees[0].currentWork, '', '空闲员工没有 currentWork')
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('在办活只来自 .jarvis/tickets 未结束的单（不是 company-state 残留）', () => {
  const now = Date.now()
  const ws = mkWorkspace({
    cards: ['研发'],
    // company-state 里有一条陈旧的 currentWork，必须被真实任务单覆盖（没单就空）
    company: { employees: [{ role: '研发', currentWork: '陈旧残留的活', status: 'working' }], tasks: [{ id: 'old', subject: '旧活', assignee: '研发' }] },
    tickets: [mkTicket({ id: 'ticket-a1', role: '研发', title: '实现登录页', updatedAt: new Date(now - 60_000).toISOString() })],
  })
  try {
    const f = deriveJarvisFacts(ws, fs, path, { now })
    const e = f.employees.find((x) => x.role === '研发')
    assert.equal(e.currentWork, '实现登录页', '必须用真实任务单标题，不是 company-state 残留')
    assert.equal(e.ticketId, 'ticket-a1')
    assert.equal(f.tasks.length, 1, '任务只来自 tickets')
    assert.equal(f.tasks[0].subject, '实现登录页')
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('working 必须有活着证据：单刚更新 → working', () => {
  const now = Date.now()
  const ws = mkWorkspace({
    cards: ['研发'],
    tickets: [mkTicket({ id: 'ticket-a2', role: '研发', title: '写接口', updatedAt: new Date(now - 60_000).toISOString() })],
  })
  try {
    const f = deriveJarvisFacts(ws, fs, path, { now })
    assert.equal(f.employees[0].status, 'working')
    assert.match(f.employees[0].source, /单刚更新/)
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('有活但没有任何活动证据（陈旧单 + 无 STATUS + 无 exec-map）→ stalled（不是假 working）', () => {
  const now = Date.now()
  const ws = mkWorkspace({
    cards: ['研发'],
    tickets: [mkTicket({ id: 'ticket-a3', role: '研发', title: '陈旧的活', updatedAt: new Date(now - 3 * STALE_MS).toISOString() })],
  })
  try {
    const f = deriveJarvisFacts(ws, fs, path, { now })
    assert.equal(f.employees[0].status, 'stalled', '会话不存在时不能标 working')
    assert.match(f.employees[0].source, /无活动证据/)
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('exec-map 有 childId → working（子会话还挂着）', () => {
  const now = Date.now()
  const ws = mkWorkspace({
    cards: ['研发'],
    tickets: [mkTicket({ id: 'ticket-a4', role: '研发', title: '长活', updatedAt: new Date(now - 3 * STALE_MS).toISOString() })],
    // exec-map 真实结构：{ ticketId: { assignmentId: { role, childId } } }
    execMap: { 'ticket-a4': { 'asg-1': { role: '研发', childId: 'sess-child-1' } } },
  })
  try {
    const f = deriveJarvisFacts(ws, fs, path, { now })
    assert.equal(f.employees[0].status, 'working', '有 exec-map childId 就是在跑')
    assert.match(f.employees[0].source, /exec-map/)
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('exec-map 里 retired 的 childId 不算活（换人后旧会话已终止）', () => {
  const now = Date.now()
  const ws = mkWorkspace({
    cards: ['研发'],
    tickets: [mkTicket({ id: 'ticket-a5', role: '研发', title: '旧活', updatedAt: new Date(now - 3 * STALE_MS).toISOString() })],
    execMap: { 'ticket-a5': { 'asg-1': { role: '研发', childId: 'sess-old', retired: true } } },
  })
  try {
    const f = deriveJarvisFacts(ws, fs, path, { now })
    assert.notEqual(f.employees[0].status, 'working', 'retired 的子会话不能算在跑')
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('STATUS.md 新鲜 → working，并把首行作为成员自写进度', () => {
  const now = Date.now()
  const ws = mkWorkspace({
    cards: ['研发'],
    tickets: [mkTicket({ id: 'ticket-a6', role: '研发', title: '做 A', updatedAt: new Date(now - 3 * STALE_MS).toISOString() })],
    status: { 'ticket-a6': '# STATUS\n<!-- jarvis:auto-status -->\n正在做 A 的第一步\n' },
  })
  try {
    const f = deriveJarvisFacts(ws, fs, path, { now })
    assert.equal(f.employees[0].status, 'working')
    assert.equal(f.employees[0].statusLine, '正在做 A 的第一步', '首行必须作为进度展示')
    assert.equal(f.employees[0].statusAutoOnly, false)
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('STATUS.md 只有插件自动段 → autoOnly=true（不算成员自写，但确有活）', () => {
  const now = Date.now()
  const ws = mkWorkspace({
    cards: ['研发'],
    tickets: [mkTicket({ id: 'ticket-a7', role: '研发', title: '做 B', updatedAt: new Date(now).toISOString() })],
    status: { 'ticket-a7': '# STATUS\n<!-- jarvis:auto-status -->\n- 自动段\n' },
  })
  try {
    const f = deriveJarvisFacts(ws, fs, path, { now })
    assert.equal(f.employees[0].statusAutoOnly, true, '只有自动段 = 成员没自己维护')
    assert.equal(f.employees[0].statusLine, '', '自动段不能当成员自写进度')
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('空工作区（无 cards 无 tickets）→ 空员工 + 明确空原因（绝不造假人）', () => {
  const ws = mkWorkspace({})
  try {
    const f = deriveJarvisFacts(ws, fs, path)
    assert.equal(f.employees.length, 0)
    assert.equal(f.tasks.length, 0)
    assert.match(f.emptyReason, /还没有员工/, '空原因必须说清楚')
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('listTeams 叠加：纯 jarvis 工作区也要有团队（否则前端团队一览永远空）', () => {
  const now = Date.now()
  const ws = mkWorkspace({
    cards: ['CEO', '研发'],
    tickets: [mkTicket({ id: 'ticket-b1', role: '研发', title: '实现功能', updatedAt: new Date(now).toISOString() })],
  })
  try {
    const snap = buildSnapshot(ws, { version: 'x', tools: 37 })
    const teams = snap.tasks.teams
    assert.ok(teams.length >= 1, `必须至少有 jarvis 团队，实际 ${teams.length}`)
    const jt = teams.find((t) => t.source === 'jarvis-facts')
    assert.ok(jt, 'jarvis-facts 团队必须存在')
    assert.deepEqual(jt.members.map((m) => m.role).sort(), ['CEO', '研发'].sort())
    assert.equal(jt.tasks.length, 1)
    assert.equal(jt.tasks[0].subject, '实现功能')
    assert.equal(jt.members.find((m) => m.role === '研发').status, 'working')
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})

test('jarvisTeamShape：无事实返回 null（不制造空团队）', () => {
  const f = { employees: [], tasks: [] }
  assert.equal(jarvisTeamShape(f, path), null)
})

test('已结束的任务单不算在办活', () => {
  const now = Date.now()
  const ws = mkWorkspace({
    cards: ['研发'],
    tickets: [mkTicket({ id: 'ticket-c1', role: '研发', title: '已完成', updatedAt: new Date(now).toISOString(), ended: { at: 'now', by: 'executor', outcome: 'completed' } })],
  })
  try {
    const f = deriveJarvisFacts(ws, fs, path, { now })
    assert.equal(f.tasks.length, 0, '结束的单不进任务列表')
    assert.equal(f.employees[0].status, 'idle', '没在办活 → idle')
  } finally { fs.rmSync(ws, { recursive: true, force: true }) }
})
