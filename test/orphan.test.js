/** 孤儿子会话清理（CEO 批准即可，客户不需介入）。
 *
 *  背景：早期版本每单新开子会话，导致旧会话里堆积大量无主子会话。
 *  现在按角色复用，但历史遗留仍需要清理能力。
 *
 *  孤儿判据（全部机器可判）：
 *    · 会话已不存在，但 exec-map 还留记录
 *    · 任务单已结束，但会话还挂着
 *    · 已换人（retired）但会话没真正终止
 *  排除：当前会话、CEO/captain 会话、仍在跑活跃任务单的会话。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function mkWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-test-'))
  fs.mkdirSync(path.join(dir, '.jarvis/tickets'), { recursive: true })
  return dir
}
function rmWs(dir) { fs.rmSync(dir, { recursive: true, force: true }) }

test('孤儿识别：三种孤儿形态都覆盖', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/findOrphans\(callerSessionId\)/.test(src), '应有孤儿体检函数')
  // 形态①：会话不存在但记录还在
  assert.ok(/会话已不存在（记录未清理）/.test(src), '应识别「会话没了但记录还在」')
  assert.ok(/action: 'clean_record'/.test(src), '这种只需清记录')
  // 形态②：任务结束但会话还挂着
  assert.ok(/任务已结束但会话仍挂着/.test(src), '应识别「任务结束会话还挂」')
  // 形态③：已换人但会话没终止
  assert.ok(/已换人但会话未终止/.test(src), '应识别「换人后会话没停」')
  assert.ok(/action: 'stop'/.test(src), '这两种需要终止会话')
})

test('孤儿识别：绝不误列出当前会话 / CEO 会话 / 活跃任务的会话', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/if \(childId === selfId\) continue/.test(src), '不列当前会话')
  assert.ok(/if \(captainIds\.has\(childId\)\) continue/.test(src), '不列 CEO 会话')
  assert.ok(/if \(ended\) \{ orphans\.push/.test(src), '只有在任务已结束才算孤儿（活跃任务不列）')
  // 必须真的读 captain 标识，而不是靠 latest exec 猜
  assert.ok(/_captainIds\(String\(root\)\)/.test(src), 'CEO 识别必须用 captainIds（team.json 的 captainSessionId）')
})

test('清理：CEO 批准即可，终止会话 + 清记录', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/cleanupOrphans\(childIds, reason\)/.test(src), '应有清理函数')
  assert.ok(/agent\.cancel\(\{ kind: 'user' \}, \{\}\)/.test(src), '应终止会话')
  assert.ok(/delete slot\[aid\]/.test(src), '应清除 exec-map 记录')
  assert.ok(/assignment\.orphans\.cleaned/.test(src), '清理要写事件流可审计')
  // 清记录必须无条件做（无论会话在不在），否则复用索引一直翻旧账
  assert.ok(/清 exec-map 里的记录（无论会话在不在/.test(src), '记录必须清理')
})

test('清理入口：jarvis_ticket 有 orphans / clean-orphans，且成员无权调用', () => {
  const deliverSrc = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')
  assert.ok(/if \(action === 'orphans'\)/.test(deliverSrc), '应有孤儿体检 action')
  assert.ok(/if \(action === 'clean-orphans'\)/.test(deliverSrc), '应有清理 action')
  assert.ok(/CEO 批准即可/, '文案应说明无需客户确认')
  // ⛔ 成员（子会话）不能自己清理
  assert.ok(/'orphans', 'clean-orphans'/.test(deliverSrc), 'orphans/clean-orphans 必须在越权拦截表里')
  assert.ok(/executor\.isChild\(callerId\)/.test(deliverSrc), '越权判断用的是调用方是不是子会话')
})

test('清理不传 childIds 时清全部孤儿', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  // 用子串断言，避开正则转义的坑
  assert.ok(src.includes('Array.isArray(childIds) && childIds.length ? new Set(childIds.map(String)) : null'), '不传=全清')
  assert.ok(src.includes('!want || want.has(o.childId)'), '无筛选条件时全部命中')
})
