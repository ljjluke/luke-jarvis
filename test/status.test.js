/** 成员会话进度锚点（压缩保活第 ④ 层落地）测试。
 *
 *  背景：brief 里只是「要求」成员自己写 STATUS.md，而压缩后它可能连这个要求都忘了。
 *  所以需要两层机器保障：
 *    · 插件派发时自动写一份事实骨架（成员失忆也能恢复）
 *    · 交接时校验成员有没有真的维护过（只告知，不阻塞交活）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { statusRelPath, checkStatusFreshness } from '../src/host/adapters/dsh-executor.js'

function mkWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'))
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  return dir
}
function rmWs(dir) { fs.rmSync(dir, { recursive: true, force: true }) }

test('statusRelPath：有 ticketId 用 ticket，否则退回 assignmentId', () => {
  assert.equal(statusRelPath({ id: 'ticket-a1' }, { id: 'as-1' }), '.jarvis/outputs/ticket-a1/STATUS.md')
  assert.equal(statusRelPath({}, { id: 'as-2' }), '.jarvis/outputs/as-2/STATUS.md')
  assert.equal(statusRelPath(null, null), '.jarvis/outputs/unknown/STATUS.md')
})

test('校验：没有 STATUS.md 时明确提示（压缩后无法恢复）', () => {
  const ws = mkWs()
  try {
    const hint = checkStatusFreshness(ws, { id: 'ticket-x' }, { id: 'as-1' })
    assert.ok(hint.length > 0, '缺失时必须提示')
    assert.ok(hint.includes('没有 STATUS.md'))
    assert.ok(hint.includes('上下文压缩'), '要说清为什么重要')
  } finally { rmWs(ws) }
})

test('校验：只有插件自动段（成员没维护）时也提示', () => {
  const ws = mkWs()
  try {
    const rel = statusRelPath({ id: 'ticket-y' }, null)
    const abs = path.join(ws, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, [
      '<!-- jarvis:auto-status -->',
      '# 任务进度（插件自动维护，请不要删除本段）',
      '- 任务单：ticket-y（build 阶段）：测试',
      '- 我的角色：前端；assignmentId=as-9',
      '',
      '<!-- 以下由你（成员）自己维护：现在做到哪 / 下一步 / 卡在哪 -->',
    ].join('\n'))
    const hint = checkStatusFreshness(ws, { id: 'ticket-y' }, { id: 'as-9' })
    assert.ok(hint.includes('只有插件自动段'), '应识别出成员没写自己的内容')
  } finally { rmWs(ws) }
})

test('校验：成员写过且新鲜 → 不提示（不误报）', () => {
  const ws = mkWs()
  try {
    const rel = statusRelPath({ id: 'ticket-z' }, null)
    const abs = path.join(ws, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, [
      '<!-- jarvis:auto-status -->',
      '# 任务进度（插件自动维护）',
      '',
      '<!-- 以下由你（成员）自己维护 -->',
      '现在做到哪：接口已联调通过，正在补单元测试',
      '下一步：补完测试后跑全量',
      '卡在哪：无',
    ].join('\n'))
    const hint = checkStatusFreshness(ws, { id: 'ticket-z' }, { id: 'as-3' })
    assert.equal(hint, '', '内容新鲜且成员写过，不该提示')
  } finally { rmWs(ws) }
})

test('校验：成员写过但太旧 → 提示更新', () => {
  const ws = mkWs()
  try {
    const rel = statusRelPath({ id: 'ticket-old' }, null)
    const abs = path.join(ws, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, [
      '<!-- jarvis:auto-status -->',
      '现在做到哪：刚开始拆任务',
    ].join('\n'))
    const t = new Date(Date.now() - 90 * 60000)   // 90 分钟前
    fs.utimesSync(abs, t, t)
    const hint = checkStatusFreshness(ws, { id: 'ticket-old' }, null, 30)
    assert.ok(hint.includes('分钟没更新'), '过旧应提示：' + hint)
  } finally { rmWs(ws) }
})

test('接���：派发时自动写、提醒时刷新、汇报时校验', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/function autoWriteStatus/.test(src), '应有插件自动写 STATUS 的实现')
  assert.ok(/autoWriteStatus\(root, ticket, assignment\)/.test(src), '派发时必须自动写 STATUS')
  assert.ok(/提醒前先刷新插件自动段/.test(src), '提醒时应刷新骨架')
  const deliverSrc = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')
  assert.ok(/checkStatusFreshness\(projectDir, ticket, asg\)/.test(deliverSrc), '汇报时应校验 STATUS')
  assert.ok(/进度锚点（压缩保活第④层）/.test(deliverSrc), '校验结果应出现在汇报返回里')
  // ⛔ 校验不能阻塞交活
  assert.ok(!/if \(statusHint\) return|if \(!statusHint\.length\) return/.test(deliverSrc), 'STATUS 缺失不得拒绝交活')
})
