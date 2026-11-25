/** jarvis_store 路径拼接回归测试（v0.23）。
 *
 *  用户实测（2026-11-25）：
 *    「jarvis_store 写卡路径缺斜杠」——三个工具缺陷叠加把流程锁死在第一步。
 *
 *  根因：memory.js 的 execute 用字符串拼接 `${projectDir}cards/`，
 *  缺省值 `<workspace>/.jarvis/` 带尾斜杠所以看不出问题；
 *  但调用方传 `/opt/work/test`（不带斜杠）时就拼成 `/opt/work/testcards/研发.md`
 *
 *  第二层（v0.23 追加）：修好斜杠后仍发现"写了但找不到"——jarvis_store 把卡写到
 *  `<项目>/cards/`，而 findRoleCard 查 `<项目>/.jarvis/cards/`。projectDir 的参数语义
 *  是「记忆库根目录 = <workspace>/.jarvis」，但调用方按直觉传项目根。现改为自动识别补全。
 *  ——模型照着这个错误路径落盘必然失败，而 captain 物理上没有 write 工具
 *  （preset/jarvis-captain.cordis.yml 故意不给 tool-fs），只能靠 jarvis_store 写。
 *  一个路径拼接 bug = 整个流程死锁。
 *
 *  本测试锁定：任何形式的 projectDir 输入都必须拼出正确路径。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { TOOLS } from '../src/host/plugin.js'

const store = TOOLS.find((t) => t.name === 'jarvis_store')
assert.ok(store, 'jarvis_store 必须存在')

// ── scaffold 模式：结构清单里的路径必须正确 ─────────────────────────
test('scaffold：带/不带尾斜杠的 projectDir 都拼出正确路径', async () => {
  // v0.23 语义修正：projectDir 的本意是「记忆库根目录 = <workspace>/.jarvis」。
  // 传入项目根（不带 .jarvis）时自动补上，与 findRoleCard 的查找路径（<项目>/.jarvis/cards/）对齐。
  const cases = [
    { input: '/opt/work/test', expect: '/opt/work/test/.jarvis/cards/' },
    { input: '/opt/work/test/', expect: '/opt/work/test/.jarvis/cards/' },
    { input: '/opt/work/test/.jarvis', expect: '/opt/work/test/.jarvis/cards/' },
    { input: '/opt/work/test/.jarvis/', expect: '/opt/work/test/.jarvis/cards/' },
  ]
  for (const c of cases) {
    const r = await store.execute({ mode: 'scaffold', projectDir: c.input })
    const lines = r.structure || []
    const cardsLine = lines.find((l) => l.includes('cards/')) || ''
    assert.ok(cardsLine.startsWith(c.expect),
      `projectDir="${c.input}" 应拼出 ${c.expect}，实际：${cardsLine.slice(0, 60)}`)
    // 反例：绝不能出现 base 与子目录直接粘连
    assert.ok(!cardsLine.includes('/opt/work/testcards'),
      `出现了错误的粘连路径：${cardsLine.slice(0, 60)}`)
    // README 与 cards 两个代表项都要对
    const readmeLine = lines.find((l) => l.includes('README.md')) || ''
    assert.ok(readmeLine.startsWith('/opt/work/test/.jarvis/README.md'), `README 路径错误：${readmeLine.slice(0, 70)}`)
  }
})

test('scaffold：路径全表都不出现粘连（cards/prototypes/docs/reports 等）', async () => {
  const r = await store.execute({ mode: 'scaffold', projectDir: '/opt/work/test' })
  for (const line of (r.structure || [])) {
    assert.ok(!/\/opt\/work\/test\.jarvis[a-zA-Z]/.test(line.replace('/opt/work/test/.jarvis/', '')), `路径粘连：${line.slice(0, 50)}`)
  }
})

test('scaffold：<workspace> 占位符仍输出示意结构（不解析成真实路径）', async () => {
  const r = await store.execute({ mode: 'scaffold' })
  const joined = (r.structure || []).join('\n')
  assert.ok(/<workspace>/.test(joined), '缺省时应保留占位符示意，而不是把 <workspace> 当成真实目录')
  assert.ok(joined.includes('<workspace>/.jarvis/cards/'), '占位符下的子路径也要正确拼接')
})

// ── save 模式：落盘路径必须正确 ────────────────────────────────────
test('save：写卡路径正确（这是"流程锁死"的直接触发点）', async () => {
  const r = await store.execute({ mode: 'save', projectDir: '/opt/work/test', itemType: 'card', name: '测试员' })
  assert.equal(r.savePath, '/opt/work/test/.jarvis/cards/测试员.md', `写卡路径错误：${r.savePath}`)
})

test('save：其他类型也按目录归档，不散在根', async () => {
  const cases = [
    ['prototype', '原型甲', 'prototypes/'],
    ['report', '审计报告', 'reports/'],
    ['design', '设计稿', 'designs/'],
    ['script', '验证脚本', 'scripts/'],
    ['doc', '交付文档', 'docs/'],
  ]
  for (const [itemType, name, dir] of cases) {
    const r = await store.execute({ mode: 'save', projectDir: '/opt/work/test', itemType, name })
    assert.ok(r.savePath.includes(`/opt/work/test/.jarvis/${dir}`), `${itemType} 应归档到 .jarvis/${dir}，实际：${r.savePath}`)
  }
})

test('save：带尾斜杠同样正确', async () => {
  const r = await store.execute({ mode: 'save', projectDir: '/opt/work/test/', itemType: 'card', name: '测试员' })
  assert.equal(r.savePath, '/opt/work/test/.jarvis/cards/测试员.md', `带尾斜杠时路径错误：${r.savePath}`)
})

// ── 端到端：落卡后 findRoleCard 必须真能读到（否则"写了但找不到"）────
test('端到端：jarvis_store 落卡 → jarvis_member_brief 能识别到角色卡', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-e2e-'))
  try {
    const brief = TOOLS.find((t) => t.name === 'jarvis_member_brief')
    // 1. 落卡（captain 唯一的写通道）
    const saved = await store.execute({ mode: 'save', projectDir: dir, itemType: 'card', name: '测试员' })
    fs.mkdirSync(path.dirname(saved.savePath), { recursive: true })
    fs.writeFileSync(saved.savePath, [
      '# 测试员', '## 身份定位', '质量守门人', '## 思维模型', '先证伪再证真',
      '## 核心方法论', '边界优先', '## 代表作品', '回归体系',
      '## 决策红线', '不放过未复现的 bug', '## 语言风格', '精确',
    ].join('\n'))
    // 2. 断言 member_brief 识别到
    const b = await brief.execute({ roleName: '测试员', projectDir: dir })
    assert.equal(b.cardMissing, false, `落卡后仍报缺卡（写盘路径与查找路径不一致）：savePath=${saved.savePath}`)
    assert.ok(b.cardPath, '必须返回 cardPath')
    // 3. 卡内容真的进了 brief
    assert.ok(b.brief.includes('质量守门人'), '角色卡正文必须注入 brief（否则等于没卡）')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── v0.24：captain 无写工具，store 必须能真写内容 ─────────────────
test('mode=save 传 content → 真的写盘（captain 唯一的写通道）', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-content-'))
  try {
    const body = '# 需求规格\n## 功能\n1. 登录\n## 验收标准\n- 验收：' + '可登录。'.repeat(80)
    const r = await store.execute({ mode: 'save', projectDir: dir, itemType: 'doc', name: '需求规格-演示', content: body })
    assert.equal(r.wrote, true, `必须真的写入（wrote=${r.wrote}）`)
    assert.ok(fs.existsSync(r.savePath), '文件必须真实存在')
    assert.equal(fs.readFileSync(r.savePath, 'utf8'), body, '写入内容必须与传入一致')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('mode=save 不传 content → 不假称已写入（只返回路径并明确提示）', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-nocontent-'))
  try {
    const r = await store.execute({ mode: 'save', projectDir: dir, itemType: 'card', name: '空卡' })
    assert.equal(r.wrote, false, '没传 content 时不该报 wrote=true')
    assert.ok(!fs.existsSync(r.savePath), '没传 content 时不该凭空生成文件')
    assert.ok(/未传 content/.test(r.verdict), '必须明确告知"只返回路径没写文件"')
    assert.ok(/写工具/.test(r.verdict), '必须提示 captain 没有写工具、要用 content')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('端到端：store 带 content 落需求规格 → clarify 闸放行', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-gate-'))
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo-project' }))
    const fg = TOOLS.find((t) => t.name === 'jarvis_flowguard')
    const body = '# 需求规格\n## 功能\n1. 登录\n## 验收标准\n- 验收：' + '正确账号密码可登录。'.repeat(60)
    const s = await store.execute({ mode: 'save', projectDir: dir, itemType: 'doc', name: '需求规格-x', content: body })
    assert.equal(s.wrote, true)
    const r = await fg.execute({ step: 'clarify', projectDir: dir })
    assert.equal(r.ok, true, `写好需求规格后 clarify 闸必须放行，实际 missing=${JSON.stringify(r.missing)}`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ── 不变量：captain 无写工具这一设定仍须成立 ──────────────────────
test('captain 预设故意不给写工具（这是 jarvis_store 必须能写的原因）', () => {
  const presetSrc = fs.readFileSync(new URL('../preset/jarvis-captain.cordis.yml', import.meta.url), 'utf8')
  assert.ok(/不挂 tool-fs/.test(presetSrc), 'captain 不应挂 tool-fs（防顶层自己干活）')
  assert.ok(/dsh-tool-fs-search/.test(presetSrc), 'captain 应保留只读检索工具')
  // 前提确认：既然 captain 不能自己写，jarvis_store 的写盘路径就绝不能错
  assert.ok(store, 'jarvis_store 必须存在且可用')
})
