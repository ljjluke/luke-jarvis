/** jarvis_store 路径拼接回归测试（v0.23）。
 *
 *  用户实测（2026-11-25）：
 *    「jarvis_store 写卡路径缺斜杠」——三个工具缺陷叠加把流程锁死在第一步。
 *
 *  根因：memory.js 的 execute 用字符串拼接 `${projectDir}cards/`，
 *  缺省值 `<workspace>/.jarvis/` 带尾斜杠所以看不出问题；
 *  但调用方传 `/opt/work/test`（不带斜杠）时就拼成 `/opt/work/testcards/研发.md`
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
  const cases = [
    { input: '/opt/work/test', expect: '/opt/work/test/.jarvis/cards/' },
    { input: '/opt/work/test/', expect: '/opt/work/test/.jarvis/cards/' },
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
    assert.ok(readmeLine.startsWith('/opt/work/test/.jarvis/README.md'), `README 路径错误：${readmeLine.slice(0, 60)}`)
  }
})

test('scaffold：路径全表都不出现粘连（cards/prototypes/docs/reports 等）', async () => {
  const r = await store.execute({ mode: 'scaffold', projectDir: '/opt/work/test' })
  for (const line of (r.structure || [])) {
    assert.ok(!/\/opt\/work\/test[a-z]/.test(line.replace('/opt/work/test/', '')), `路径粘连：${line.slice(0, 50)}`)
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
    assert.ok(r.savePath.includes(`/opt/work/test/.jarvis/${dir}`), `${itemType} 应归档到 ${dir}，实际：${r.savePath}`)
  }
})

test('save：带尾斜杠同样正确', async () => {
  const r = await store.execute({ mode: 'save', projectDir: '/opt/work/test/', itemType: 'card', name: '测试员' })
  assert.equal(r.savePath, '/opt/work/test/.jarvis/cards/测试员.md', `带尾斜杠时路径错误：${r.savePath}`)
})

// ── 不变量：captain 无写工具这一设定仍须成立 ──────────────────────
test('captain 预设故意不给写工具（这是 jarvis_store 必须能写的原因）', () => {
  const presetSrc = fs.readFileSync(new URL('../preset/jarvis-captain.cordis.yml', import.meta.url), 'utf8')
  assert.ok(/不挂 tool-fs/.test(presetSrc), 'captain 不应挂 tool-fs（防顶层自己干活）')
  assert.ok(/dsh-tool-fs-search/.test(presetSrc), 'captain 应保留只读检索工具')
  // 前提确认：既然 captain 不能自己写，jarvis_store 的写盘路径就绝不能错
  assert.ok(store, 'jarvis_store 必须存在且可用')
})

// ── v0.33：防止双后缀（用户实测写出了 需求规格-xxx.md.md）──────────
test('save：name 已带 .md 时不再补一次（防 .md.md 双后缀）', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-ext-'))
  try {
    const r = await store.execute({ mode: 'save', projectDir: dir, itemType: 'doc', name: '需求规格-数审.md' })
    assert.ok(!/\.md\.md$/.test(r.savePath), `不能出现双 .md 后缀，实际：${r.savePath}`)
    assert.ok(r.savePath.endsWith('/需求规格-数审.md'), `应为单后缀，实际：${r.savePath}`)
    // 不带的仍然自动补
    const r2 = await store.execute({ mode: 'save', projectDir: dir, itemType: 'doc', name: '需求规格-测试' })
    assert.ok(r2.savePath.endsWith('/需求规格-测试.md'), `不带扩展名时自动补 .md，实际：${r2.savePath}`)
    // 大小写不敏感
    const r3 = await store.execute({ mode: 'save', projectDir: dir, itemType: 'doc', name: '方案设计-X.MD' })
    assert.ok(!/\.MD\.md$/i.test(r3.savePath), `大小写也要防重复，实际：${r3.savePath}`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('save：JSON 类型同样防双后缀', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-json-'))
  try {
    const r = await store.execute({ mode: 'save', projectDir: dir, itemType: 'process', name: 'process-流程.json' })
    assert.ok(!/\.json\.json$/i.test(r.savePath), `JSON 也不能双后缀，实际：${r.savePath}`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
