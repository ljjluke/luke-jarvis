/** 缺陷 d：captain 守卫激活后若流程停在 clarify 会死锁。
 *  先证明问题是否存在，再决定是否改拦截逻辑。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { captainExecutionGuard, _captainIds } from '../src/host/gates/stage.js'

function mkWs({ clarifyOk = false, captainSid = 'sess-cap' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadlock-'))
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.agent-teams/team-a'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/team-a/team.json'), JSON.stringify({ captainSessionId: captainSid, tasks: [] }))
  const gates = clarifyOk ? { clarify: { ok: true, at: new Date().toISOString() } } : {}
  fs.writeFileSync(path.join(dir, '.jarvis/gates.json'), JSON.stringify(gates))
  return dir
}
function rmWs(d) { fs.rmSync(d, { recursive: true, force: true }) }
function mkExec(name, cwd, sid) {
  return { name, agent: { session: { id: sid, header: { cwd } } } }
}

test('缺陷d 复现：clarify 未过 + captain 身份 → 执行工具被拦（是否死锁取决于有无替代路径）', () => {
  const ws = mkWs({ clarifyOk: false })
  try {
    const r = captainExecutionGuard(mkExec('bash', ws, 'sess-cap'))
    assert.ok(typeof r === 'string' && r.length > 0, 'clarify 未过时 captain 的 bash 确实被拦（这是预期行为，不是缺陷）')
  } finally { rmWs(ws) }
})

test('缺陷d 关键：被拦的文案必须给出「当前阶段 + 下一步」，否则模型无法自愈', () => {
  const ws = mkWs({ clarifyOk: false })
  try {
    const r = captainExecutionGuard(mkExec('bash', ws, 'sess-cap'))
    // 缺陷 d 的核心不是「被拦」而是「被拦后不知道怎么办」
    const hasNext = /下一步|先|请改走|jarvis_ticket|派活|flowguard/.test(r || '')
    assert.ok(hasNext, '拒绝文案必须给出可执行的下一步，否则就是死循环：' + (r || '').slice(0, 200))
  } finally { rmWs(ws) }
})

test('缺陷d：clarify 已过的话，capitain 仍被拦（守卫本身不能被削弱）', () => {
  const ws = mkWs({ clarifyOk: true })
  try {
    const r = captainExecutionGuard(mkExec('bash', ws, 'sess-cap'))
    assert.ok(typeof r === 'string' && r.length > 0, '守卫必须一直生效，不能因阶段不同而放行执行')
  } finally { rmWs(ws) }
})

test('缺陷d：jarvis_* 工具永不被拦（保证有出路）', () => {
  const ws = mkWs({ clarifyOk: false })
  try {
    for (const name of ['jarvis_ticket', 'jarvis_flowguard', 'jarvis_board', 'jarvis_gc']) {
      const r = captainExecutionGuard(mkExec(name, ws, 'sess-cap'))
      assert.equal(r, undefined, `${name} 必须放行——它是 captain 走出死锁的通道`)
    }
  } finally { rmWs(ws) }
})

test('缺陷d：不是 captain 的会话不受影响（成员能正常执行）', () => {
  const ws = mkWs({ clarifyOk: false, captainSid: 'sess-cap' })
  try {
    const r = captainExecutionGuard(mkExec('bash', ws, 'sess-member'))
    assert.equal(r, undefined, '成员必须能执行，守卫只拦 captain')
  } finally { rmWs(ws) }
})

test('缺陷d：_captainIds 能正确读出 captain（死锁前提的判定基础）', () => {
  const ws = mkWs({ captainSid: 'sess-cap' })
  try {
    assert.ok(_captainIds(ws).has('sess-cap'), '必须能识别 captain 会话')
  } finally { rmWs(ws) }
})
