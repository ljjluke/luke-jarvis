/** 长会话上下文压缩保活（四层机制）测试。
 *
 *  背景（scan 实证）：某会话跑 1166 轮、31 次压缩后，协议正文被压缩丢弃，
 *  模型只看到工具名就开始"当包工头"；另有 12 天工作全在上下文里、一压缩就没了。
 *
 *  四层：
 *   ① 机器进度流水 .jarvis/progress/*.jsonl —— 不依赖模型自觉，压缩丢了可重放
 *   ② 新鲜度门 —— project.md 落后流水时显式标注"可能过期"，不让旧信息伪装成事实
 *   ③ 抽取失效告警 —— 标签抽不到时显性提示，而不是静默返回空
 *   ④ 成员会话续接 —— 提醒里重申 brief 核心 + STATUS.md 路径
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { renderResumeFacts } from '../src/host/state/resume.js'
import { recordProgress, readRecentProgress, hasProgress } from '../src/host/state/progress.js'

function mkWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'))
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  return dir
}
function rmWs(dir) { fs.rmSync(dir, { recursive: true, force: true }) }
function wf(dir, rel, content) {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

// ── 第 ① 层：机器进度流水 ──────────────────────────────────────────────
test('① 机器流水：工具调用自动落盘，按 ticket 分段，异步不阻塞', async () => {
  const ws = mkWs()
  try {
    assert.equal(hasProgress(ws), false, '初始无流水')
    const ok = recordProgress(ws, 'jarvis_dispatch_task', { ticketId: 'ticket-abc123', action: 'open' }, { ok: true })
    assert.equal(ok, true, '记录应被接受')
    await new Promise((r) => setTimeout(r, 60))   // 异步写（setImmediate）
    assert.equal(hasProgress(ws), true, '流水应落盘')
    const files = fs.readdirSync(path.join(ws, '.jarvis/progress'))
    assert.ok(files.includes('ticket-abc123.jsonl'), '有 ticketId 的应按 ticket 分段')
    const rec = readRecentProgress(ws, 5)
    assert.equal(rec.length, 1)
    assert.equal(rec[0].tool, 'dispatch_task', '工具名前缀 jarvis_ 应被剥掉')
    assert.equal(rec[0].action, 'open')
    assert.equal(rec[0].target, 'ticket-abc123')
  } finally { rmWs(ws) }
})

test('① 机器流水：无 ticketId 按天分段；失败动作也记录；写失败不抛错', async () => {
  const ws = mkWs()
  try {
    recordProgress(ws, 'jarvis_think_deep', { action: 'ponder' }, { ok: true })
    recordProgress(ws, 'jarvis_review', { action: 'adjudicate' }, { ok: false, note: '工具抛错示例' })
    await new Promise((r) => setTimeout(r, 60))
    const files = fs.readdirSync(path.join(ws, '.jarvis/progress'))
    assert.ok(files.some((f) => /day-\d{4}-\d{2}-\d{2}\.jsonl/.test(f)), '无 ticketId 应按天分段')
    const rec = readRecentProgress(ws, 10)
    assert.equal(rec.length, 2)
    const failed = rec.find((x) => x.tool === 'review')
    assert.equal(failed.ok, false, '失败动作也要记录（压缩后要知道做过且失败了）')
    assert.ok(failed.note && failed.note.length > 0)
    // 写失败不抛错：传入不存在的目录也不应 throw
    assert.doesNotThrow(() => recordProgress('/nonexistent-root-xyz', 'jarvis_x', {}))
  } finally { rmWs(ws) }
})

// ── 第 ② 层：新鲜度门 ──────────────────────────────────────────────────
test('② 新鲜度门：project.md 落后流水时显式标注「可能过期」', async () => {
  const ws = mkWs()
  try {
    // 先写 project.md（旧）
    wf(ws, '.jarvis/project.md', '当前进度：正在拆分任务\n下一步：派给团队\n')
    const old = new Date(Date.now() - 3 * 3600 * 1000)
    fs.utimesSync(path.join(ws, '.jarvis/project.md'), old, old)
    // 再写流水（新）
    recordProgress(ws, 'jarvis_dispatch_task', { ticketId: 'ticket-x', action: 'open' })
    await new Promise((r) => setTimeout(r, 60))
    const out = renderResumeFacts(ws)
    assert.ok(out.includes('可能已过期'), '落后 3 小时应告警')
    assert.ok(out.includes('复核磁盘'), '告警应给出行动建议')
    // 告警必须在内容之前（先看到风险）
    const idxWarn = out.indexOf('可能已过期')
    const idxContent = out.indexOf('进度：')
    assert.ok(idxWarn >= 0 && (idxContent < 0 || idxWarn < idxContent), '过期告警应排在最前')
  } finally { rmWs(ws) }
})

test('② 新鲜度门：project.md 比流水新时不告警（不误报）', async () => {
  const ws = mkWs()
  try {
    recordProgress(ws, 'jarvis_dispatch_task', { ticketId: 'ticket-y', action: 'open' })
    await new Promise((r) => setTimeout(r, 60))
    // project.md 更新于流水之后
    wf(ws, '.jarvis/project.md', '当前进度：已完成拆分\n下一步：开始执行\n')
    const out = renderResumeFacts(ws)
    assert.ok(!out.includes('可能已过期'), '不落后就不该告警')
  } finally { rmWs(ws) }
})

test('② 新鲜度门：没有流水时不比较（避免无依据告警）', () => {
  const ws = mkWs()
  try {
    wf(ws, '.jarvis/project.md', '当前进度：刚开始\n')
    const out = renderResumeFacts(ws)
    assert.ok(!out.includes('可能已过期'), '无流水 = 无法比较 = 不告警')
  } finally { rmWs(ws) }
})

// ── 第 ③ 层：抽取失效告警 ──────────────────────────────────────────────
test('③ 抽取失效：project.md 有内容但标签不匹配时，显性提示而非静默变空', () => {
  const ws = mkWs()
  try {
    // 用非标准小标题（模型换了写法）
    wf(ws, '.jarvis/project.md', '## 目前状态\n凑合着做\n\n## 我的想法\n先看看再说\n')
    const out = renderResumeFacts(ws)
    assert.ok(out.length > 0, '不能返回空（那会让保护静默消失）')
    assert.ok(out.includes('未识别出标准段落'), '应明确提示格式未识别')
    assert.ok(out.includes('先完整读一遍'), '应给出补救动作')
  } finally { rmWs(ws) }
})

test('③ 抽取失效：标准格式正常抽取，不误报告警', () => {
  const ws = mkWs()
  try {
    wf(ws, '.jarvis/project.md', '当前进度：已完成需求\n下一步：拆任务\n未决项：是否多门店\n')
    const out = renderResumeFacts(ws)
    assert.ok(out.includes('进度：已完成需求'))
    assert.ok(out.includes('下一步：拆任务'))
    assert.ok(!out.includes('未识别出标准段落'), '正常格式不该告警')
  } finally { rmWs(ws) }
})

// ── 端到端：压缩场景模拟 ───────────────────────────────────────────────
test('端到端：模拟「压缩后下一轮」——续接块仍能给出可信状态', async () => {
  const ws = mkWs()
  try {
    wf(ws, '.jarvis/project.md', '当前进度：任务拆分完成\n下一步：派发 6 个任务点\n团队清单：前端2人、后端1人\n')
    recordProgress(ws, 'jarvis_taskgraph', { action: 'decompose' })
    await new Promise((r) => setTimeout(r, 60))
    // 模拟压缩：对话全丢，只剩磁盘。续接块必须自给自足。
    const out = renderResumeFacts(ws)
    assert.ok(out.includes('续接事实'), '应有续接块')
    assert.ok(out.includes('任务拆分完成'), '应含磁盘上的真实进度')
    assert.ok(out.includes('派发 6 个任务点'), '应含下一步')
    assert.ok(!out.includes('可能已过期'), 'project.md 与流水同步时不该告警')
  } finally { rmWs(ws) }
})

// ── 第 ④ 层：成员会话续接（源码级断言）────────────────────────────────
test('④ 成员会话：提醒里重申 brief 线索与 STATUS.md 路径', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/function memberResumeHint/.test(src), '应有成员续接线索函数')
  assert.ok(/续接线索 · 上下文若已被压缩/.test(src), '提醒应明确说明这是压缩后的恢复线索')
  assert.ok(/STATUS\.md/.test(src), '应指明成员的进度锚点文件')
  assert.ok(/memberResumeHint\(view\.ticket, asg, root\)/.test(src), '提醒里必须实际带上线索')
  // brief 里也要指引成员自己写 STATUS.md（否则压缩后无锚点）
  assert.ok(/【进度自保 · 重要】/.test(src), 'brief 应要求成员自写 STATUS.md')
})

test('四层机制都在主流程接线（不是只写在文件里没调用）', () => {
  const toolsSrc = fs.readFileSync(new URL('../src/host/tools/index.js', import.meta.url), 'utf8')
  assert.ok(/import { recordProgress }/.test(toolsSrc), '工具层应导入流水记录')
  assert.ok(/recordProgress\(cwd, tool\.name, args/.test(toolsSrc), '每次 jarvis 工具调用都要记流水')
  assert.ok(/result\.then\(\(\) => note\(true\), \(e\) => note\(false/.test(toolsSrc), '异步工具成功/失败都要记')
  const resumeSrc = fs.readFileSync(new URL('../src/host/state/resume.js', import.meta.url), 'utf8')
  assert.ok(/function stalenessNote/.test(resumeSrc), '续接块应含新鲜度门')
  assert.ok(/function latestProgressAt/.test(resumeSrc), '新鲜度靠流水时间戳判定')
})
