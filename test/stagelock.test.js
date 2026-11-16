/** 根治：jarvis 工作区未建队时，禁止直接开子任务（原生 subagent 绕过任务单）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { captainExecutionGuard, _captainIds, ANY_TOPLEVEL } from '../src/host/gates/stage.js'

function mkWs({ teams = null, escape = false, jarvis = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stlk-'))
  if (jarvis) fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  if (teams) {
    fs.mkdirSync(path.join(dir, '.agent-teams'), { recursive: true })
    for (const t of teams) {
      fs.mkdirSync(path.join(dir, '.agent-teams', t.name), { recursive: true })
      fs.writeFileSync(path.join(dir, '.agent-teams', t.name, 'team.json'), JSON.stringify({ captainSessionId: t.cap, tasks: [] }))
    }
  }
  if (escape) fs.writeFileSync(path.join(dir, '.jarvis/allow-captain-exec'), '')
  return dir
}
function rm(d) { fs.rmSync(d, { recursive: true, force: true }) }
function mkExec(name, cwd, sid) { return { name, agent: { session: { id: sid, header: { cwd } } } } }

test('根治：未建队时 subagent 被拦（这是绕过任务单的主要入口）', () => {
  const ws = mkWs()
  try {
    assert.ok(_captainIds(ws).has(ANY_TOPLEVEL), '未建队应标记 ANY_TOPLEVEL')
    const r = captainExecutionGuard(mkExec('subagent', ws, 'sess-any'))
    assert.ok(typeof r === 'string' && r.length > 0, '未建队时 subagent 必须被拦')
    assert.match(r, /还没建队|建队/, '提示应指向「先建队」')
    assert.match(r, /派活|dispatch_task/, '应给正确路径')
    assert.match(r, /allow-captain-exec/, '必须告知逃生阀')
  } finally { rm(ws) }
})

test('根治：未建队时 bash/edit/write 也被拦（不能自己干活）', () => {
  const ws = mkWs()
  try {
    for (const n of ['bash', 'edit', 'write', 'subagent', 'workflow', 'ralph']) {
      const r = captainExecutionGuard(mkExec(n, ws, 'sx'))
      assert.ok(typeof r === 'string', `${n} 在未建队时应被拦`)
    }
  } finally { rm(ws) }
})

test('根治：jarvis_* 工具仍然全部放行（建队通道不能被堵）', () => {
  const ws = mkWs()
  try {
    for (const n of ['jarvis_flowguard', 'jarvis_distill', 'jarvis_company', 'jarvis_dispatch_task', 'jarvis_ticket', 'jarvis_gc', 'jarvis_mind']) {
      assert.equal(captainExecutionGuard(mkExec(n, ws, 'sx')), undefined, `${n} 必须放行`)
    }
  } finally { rm(ws) }
})

test('根治：逃生阀 allow-captain-exec 生效（调试不被锁死）', () => {
  const ws = mkWs({ escape: true })
  try {
    assert.equal(_captainIds(ws).size, 0, '有逃生阀时不标记任何 captain')
    assert.equal(captainExecutionGuard(mkExec('subagent', ws, 'sx')), undefined, '逃生阀下应放行')
  } finally { rm(ws) }
})

test('根治：非 jarvis 工作区完全不受影响（不误伤正常项目）', () => {
  const ws = mkWs({ jarvis: false })
  try {
    assert.equal(captainExecutionGuard(mkExec('subagent', ws, 'sx')), undefined, '没有 .jarvis 的项目不管')
  } finally { rm(ws) }
})

test('根治：已建队时回归精确判定（只拦 captain，不误伤成员）', () => {
  const ws = mkWs({ teams: [{ name: 'team-a', cap: 'sess-cap' }] })
  try {
    const caps = _captainIds(ws)
    assert.ok(caps.has('sess-cap'), '能认出真实 captain')
    assert.ok(!caps.has(ANY_TOPLEVEL), '建队后不该再走兜底')
    assert.ok(typeof captainExecutionGuard(mkExec('bash', ws, 'sess-cap')) === 'string', 'captain 被拦')
    assert.equal(captainExecutionGuard(mkExec('bash', ws, 'sess-member')), undefined, '成员放行')
  } finally { rm(ws) }
})

test('根治：拒绝文案不得误导为死锁（必须给出可执行的三步）', () => {
  const ws = mkWs()
  try {
    const r = captainExecutionGuard(mkExec('subagent', ws, 'sx'))
    assert.ok(r.includes('①') && r.includes('②') && r.includes('③'), '要有分步指引')
    assert.ok(!/gc 收走/.test(r), '不该建议用 gc 解锁（那是臆测）')
  } finally { rm(ws) }
})
