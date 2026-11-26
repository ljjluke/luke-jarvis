/** 团队一览真实数据回归测试（v0.28）。
 *
 *  用户定调（2026-11-26）：「团队一览里面每个人员工作画面都要对上，
 *  不要让画面是假的，活根本不是 /jarvis 的工作内容」。
 *
 *  实测发现的两个造假源：
 *  ① toPixOfficeSnapshot 有"合成兜底"：任务表为空时用员工 currentWork 编造任务，
 *     注释写着「保证画面有人物在干活」。→ 画面显示有人干活，实际没有任何真实任务。
 *  ② 员工状态来自 company-state.json（模型手填），与真实执行脱节。
 *     实测某工作区 employees:0，3D 画面却照样显示有人在做需求分析。
 *
 *  修复后：员工名单与在办任务一律从 .agent-teams/<team>/team.json 推导，无事实就空着。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { toPixOfficeSnapshot, deriveEmployeeFacts, pickActor, EMPLOYEE_STATUS_MAP } from '../src/host/office-bridge.js'

// ── ① 不再合成假任务 ───────────────────────────────────────────────
test('toPixOfficeSnapshot：任务表为空时不再伪造任务（"保证画面有人"是造假）', () => {
  const snap = toPixOfficeSnapshot({
    employees: [{ role: '研发A', status: 'working', currentWork: '假任务：实现登录' }],
    tasks: [],   // 没有真实任务表
  }, { seq: 1 })
  assert.equal(snap.tasks.length, 0, '没有真实任务表就不该有任何任务（原实现会合成 work-<role>）')
  // 员工本身仍在（名单是真实的）
  assert.equal(snap.employees.length, 1, '员工名单保留')
  assert.ok(snap.employees[0].online, 'working 状态应在线')
})

test('toPixOfficeSnapshot：员工 currentWork 不会变成 task（防残留值冒充在办任务）', () => {
  const snap = toPixOfficeSnapshot({
    employees: [
      { role: 'A', status: 'working', currentWork: '残留的旧任务' },
      { role: 'B', status: 'idle', currentWork: '' },
    ],
    tasks: [],
  }, { seq: 1 })
  assert.equal(snap.tasks.length, 0)
  for (const t of snap.tasks) assert.ok(!/残留的旧任务/.test(t.title), '绝不能把 currentWork 变成任务标题')
})

// ── ② 真实事实推导 ────────────────────────────────────────────────
test('deriveEmployeeFacts：成员在办任务从 team.json 推导（真实 assignee/status）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-'))
  try {
    fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({
      members: [{ role: '研发A', name: '张三' }, { role: '测试员', name: '李四' }, { role: 'CEO', name: '王五' }],
      tasks: [
        { id: 'tkt-1', subject: '实现登录模块', assignee: '研发A', status: 'in_progress' },
        { id: 'tkt-2', subject: '写回归测试', assignee: '测试员', status: 'claimed' },
        { id: 'tkt-3', subject: '已完成的活', assignee: '研发A', status: 'completed' },
      ],
    }))
    const facts = await deriveEmployeeFacts(dir, fs, path)
    const byRole = Object.fromEntries(facts.map((f) => [f.role, f]))
    assert.equal(byRole['研发A'].status, 'working', '有在办任务 → working')
    assert.equal(byRole['研发A'].currentWork, '实现登录模块', '任务标题来自真实任务单')
    assert.equal(byRole['研发A'].taskId, 'tkt-1')
    assert.equal(byRole['研发A'].source, 'team.json', '来源可追溯')
    assert.equal(byRole['测试员'].status, 'working')
    assert.equal(byRole['CEO'].status, 'idle', '没有在办任务 → idle（不编造）')
    assert.equal(byRole['CEO'].currentWork, '', 'idle 员工不该有 currentWork')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('deriveEmployeeFacts：无团队目录 → 返回空（画面空着，不造假人）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-empty-'))
  try {
    const facts = await deriveEmployeeFacts(dir, fs, path)
    assert.deepStrictEqual(facts, [], '没有 .agent-teams 就返回空，绝不凭空造员工')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('deriveEmployeeFacts：有任务但无对应子会话 → 标 stalled（不假装在干活）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-stall-'))
  try {
    fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({
      members: [{ role: '研发A', name: '张三' }],
      tasks: [{ id: 'tkt-1', subject: '实现登录', assignee: '研发A', status: 'in_progress' }],
    }))
    // 传 sessions 但里面没有研发A → 应判 stalled
    const facts = await deriveEmployeeFacts(dir, fs, path, { sessions: { items: [{ label: '其他人', lastActivityAt: new Date().toISOString() }] } })
    const rec = facts.find((f) => f.role === '研发A')
    assert.equal(rec.status, 'stalled', '有任务却没对应会话 → stalled（如实显示没在跑）')
    assert.ok(/无对应子会话/.test(rec.source), `来源要说明为什么判 stalled，实际：${rec.source}`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ── ③ 3D 工位上限（诚实边界）────────────────────────────────────
test('pickActor：只有 6 个固定演员，多员工会撞同一工位（这是上游限制，需在 UI 明确标注）', () => {
  const roles = ['CEO', '研发A', '研发B', '架构师', '测试员', '前端1', '前端2', '产品经理']
  const used = new Set()
  for (const r of roles) used.add(pickActor(r))
  assert.ok(used.size <= 6, `演员表最多 6 个（实际用到 ${used.size}）`)
  // 明确验证撞车存在——UI 必须对此诚实标注，不能假装每人一个位置
  assert.ok(roles.length > used.size, '员工数超过工位数时必然撞车 → UI 需标注"画面仅显示前 N 位"')
  // 同一角色稳定映射（刷新不变）
  assert.equal(pickActor('研发A'), pickActor('研发A'))
})

test('状态映射：idle 不算 online（旧实现三目永真会让空闲员工永远在线）', () => {
  const snap = toPixOfficeSnapshot({
    employees: [{ role: 'A', status: 'idle' }, { role: 'B', status: 'working' }],
    tasks: [],
  }, { seq: 1 })
  const byRole = Object.fromEntries(snap.employees.map((e) => [e.role, e]))
  assert.equal(byRole['A'].online, false, 'idle 员工不该显示为在线')
  assert.equal(byRole['B'].online, true, 'working 员工在线')
  assert.equal(EMPLOYEE_STATUS_MAP.idle, 'queued', 'idle 映射为 queued（不占"running"槽）')
})
