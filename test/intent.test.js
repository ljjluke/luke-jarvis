/** 意图分层回归测试（v0.17）。
 *
 *  用户原话：我直接麦克风跟主页面沟通，他会按我说的做吗？
 *  现实：语音只认 5 个硬编码导航词，其余全当「新需求」派给 CEO。
 *  「看看那张卡」→ 白派一张单；「你好」→ 开始追问你要做什么。
 *
 *  本测试锁定分类函数的核心不变量——它是纯逻辑，从 HTML 里抽出来直接跑。
 *  判据原则：**把读意图误判成需求代价最大**（白派单），所以宁可偏向读意图。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const uiSrc = fs.readFileSync(new URL("../webui/jarvis-v2-wings.html", import.meta.url), 'utf8')

/** 从 HTML 里抽出 classifyIntent —— 保持与线上完全同一份实现，避免测试漂移。 */
function extractFn(src, name) {
  const a = src.indexOf('function ' + name)
  if (a < 0) throw new Error('找不到函数 ' + name)
  let i = src.indexOf('{', a)
  let d = 0
  for (; i < src.length; i += 1) {
    if (src[i] === '{') d += 1
    else if (src[i] === '}') { d -= 1; if (d === 0) break }
  }
  return src.slice(a, i + 1)
}
// INTENT_PAT 常量也要一起抽出来（classifyIntent 依赖它）
function extractConst(src, name) {
  const a = src.indexOf('const ' + name)
  const open = src.indexOf('{', a)
  let d = 0
  let i = open
  for (; i < src.length; i += 1) {
    if (src[i] === '{') d += 1
    else if (src[i] === '}') { d -= 1; if (d === 0) break }
  }
  return src.slice(a, i + 2)   // 带上分号
}

const classifyIntent = new Function(
  extractConst(uiSrc, 'INTENT_PAT') + '\n' + extractFn(uiSrc, 'classifyIntent') + '\nreturn classifyIntent;'
)()

// ── 问候：绝不能被当成需求 ──────────────────────────────────────────
test('问候类输入不进需求收集（旧行为会把「你好」当需求追问）', () => {
  for (const s of ['你好', '您好', '嗨', '哈喽', '在吗', '在不在', 'hi', 'hello']) {
    const r = classifyIntent(s)
    assert.equal(r.kind, 'greeting', `「${s}」应判为问候，实际 ${r.kind}/${r.reason}`)
  }
  // 带内容的不能误判成问候
  assert.notEqual(classifyIntent('你好，帮我把登录改一下').kind, 'greeting')
})

// ── 读意图：页面型 ─────────────────────────────────────────────────
test('读意图：说到页面名 → 判为读并带 page', () => {
  const cases = [
    ['看看进度', 'progress'],
    ['现在做到哪一步了', 'progress'],
    ['汇报结果给我看看', 'report'],
    ['谁在干活', 'team'],
    ['打开历史记录', 'history'],
    ['回到主屏', 'main'],
  ]
  for (const [s, page] of cases) {
    const r = classifyIntent(s)
    assert.equal(r.kind, 'read', `「${s}」应判为读意图，实际 ${r.kind}/${r.reason}`)
    assert.equal(r.page, page, `「${s}」应映射到 ${page}，实际 ${r.page}`)
  }
})

// ── 读意图：泛指（没有具体页面）也要进读分支，不能掉进需求 ──────────
test('读意图：泛"看看"类输入不走需求收集', () => {
  for (const s of ['看看现在什么情况', '给我看看有什么', '查一下现在的状态']) {
    const r = classifyIntent(s)
    assert.equal(r.kind, 'read', `「${s}」应判为读意图，实际 ${r.kind}/${r.reason}`)
    assert.equal(r.page, undefined, '泛指读意图不该硬套页面')
  }
})

// ── 读 + 动作同时出现 → 先读再说 ──────────────────────────────────
test('读+动作并存时以读为先（先给用户看，再谈做不做）', () => {
  const r = classifyIntent('看看进度然后催一下那个卡住的')
  assert.equal(r.kind, 'read', '应优先读意图')
  assert.equal(r.reason, 'page:progress', '并明确到进度页')
  // 纯动作句单独出现时判为 action（不进需求收集，也不是读）
  assert.equal(classifyIntent('催一下那个卡住的').kind, 'action')
})

// ── 需求：有实质内容的话必须进需求收集 ──────────────────────────────
test('需求类输入仍走需求收集（不能因为加了意图层就把真需求吃掉）', () => {
  // 判据：need 与 action 都不进"读"分支，都会落到需求流程（action 也是需求的一种）
  for (const s of [
    '帮我做一个登录页面',
    '加一个导出 Excel 的功能',
  ]) {
    const r = classifyIntent(s)
    assert.equal(r.kind, 'need', `「${s}」应判为需求，实际 ${r.kind}/${r.reason}`)
  }
  // 带「改/加/删」等动作词的，判 action——同样不进读分支，走需求流程
  for (const s of ['把首页改成深色主题', '这个按钮颜色不对，改成蓝色']) {
    assert.equal(classifyIntent(s).kind, 'action', `「${s}」应判为动作`)
  }
})

// ── 短导航简称 ─────────────────────────────────────────────────────
test('短导航简称（只说两个字）也能识别', () => {
  assert.equal(classifyIntent('进度').kind, 'read')
  assert.equal(classifyIntent('报告').kind, 'read')
  assert.equal(classifyIntent('团队').kind, 'read')
  assert.equal(classifyIntent('历史').kind, 'read')
})

// ── 实现完整性：读意图执行必须是只读的 ─────────────────────────────
test('runReadIntent 只读：不得调用任何写接口', () => {
  const body = extractFn(uiSrc, 'runReadIntent')
  // 只应出现视图切换与聚焦，不应出现 dispatchTask / jarvis_ticket / fetch POST
  assert.ok(!/dispatchTask/.test(body), '读意图不得派活（这是最严重的误判代价）')
  assert.ok(!/jarvis_ticket/.test(body), '读意图不得改任务单')
  assert.ok(!/method\s*:\s*'POST'/.test(body), '读意图不得发写请求')
  assert.ok(/showProgress|showTeam|showHistory|showMain|focusCard|showDetail/.test(body), '必须复用已有视图函数')
})

test('findCardByHint 只在已有卡片里找，不造卡', () => {
  const body = extractFn(uiSrc, 'findCardByHint')
  const readPool = uiSrc.slice(uiSrc.indexOf('function findCardByHint'))
  assert.ok(/LIVE\.cards/.test(body) && /LIVE\.cardHistory/.test(body), '查找范围应是已渲染卡片 + 历史')
  assert.ok(!/push\(/.test(body), '不得往卡片数组里塞新卡（造卡=假数据）')
  void readPool
})

test('文字输入也走意图层（不能只有语音修好）', () => {
  // 注意：'teamChatForm' 在 HTML 里也出现一次（第 171 行），必须找 JS 里的 addEventListener 那处
  const idx = uiSrc.indexOf("getElementById('teamChatForm')")
  assert.ok(idx > 0, '应找到文字输入表单的事件绑定')
  const handler = uiSrc.slice(idx, idx + 1400)
  assert.ok(/classifyIntent/.test(handler), '文字输入必须过意图分类（旧行为是直接 dispatchTask）')
  assert.ok(/runReadIntent/.test(handler), '文字输入必须能触发读意图')
})
