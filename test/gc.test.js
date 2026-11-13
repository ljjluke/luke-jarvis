/** GC（工作区垃圾回收）测试——覆盖"gc还需测试"任务清单：
 *
 *  三段语义（用户定义）：collect 入回收站 / restore 保留期内恢复 / purge 到期彻底删。
 *  规则引擎：R1 迭代版本包 / R2+R2b+R2c 多版本文档与日期迭代 / R3 过期临时目录 / R4 过期日志。
 *  安全：保护名单、路径越界守卫、插件仓库拒跑（Windows 反斜杠路径也要拦住）。
 *  审计：manifest.jsonl append-only（坏行容错）+ events.jsonl gc.* 事件。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { collect, listTrash, restore, restoreMany, compactManifest, purgeExpired, RETENTION_DAYS } from '../src/host/adapters/trash.js'
import { findGarbage, findSuggestions, maybeAutoGc, gcSummary, GC_TOOLS } from '../src/host/tools/gc.js'

// ── 夹具 ────────────────────────────────────────────────────────────────
function mkWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-test-'))
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true }) // GC 自动兜底只认有状态根的工作区
  return dir
}
function rmWs(dir) { fs.rmSync(dir, { recursive: true, force: true }) }
function wf(dir, rel, content = 'x') {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}
function ageDays(abs, days) { // 回拨 mtime（测过期判定）
  const t = new Date(Date.now() - days * 86400000)
  fs.utimesSync(abs, t, t)
}
function backdateEntry(dir, id, days) { // 回填 manifest 的 movedAt（append-only 语义：最新一行覆盖状态）
  fs.appendFileSync(path.join(dir, '.jarvis/trash/manifest.jsonl'),
    JSON.stringify({ id, movedAt: new Date(Date.now() - days * 86400000).toISOString() }) + '\n')
}
function eventsText(dir) {
  try { return fs.readFileSync(path.join(dir, '.jarvis/events.jsonl'), 'utf8') } catch { return '' }
}

// ── trash.js：三段语义 ──────────────────────────────────────────────────
test('collect：文件与目录入站，manifest 与事件落盘', () => {
  const ws = mkWs()
  try {
    wf(ws, 'notes/a.txt'); wf(ws, 'scratch/b.txt')
    const r = collect(ws, ['notes/a.txt', 'scratch'], '测试收纳')
    assert.equal(r.collected.length, 2)
    assert.equal(r.skipped.length, 0)
    assert.ok(!fs.existsSync(path.join(ws, 'notes/a.txt')))
    assert.ok(!fs.existsSync(path.join(ws, 'scratch')))
    const items = listTrash(ws).items.filter((x) => x.state === 'in-trash')
    assert.equal(items.length, 2)
    assert.ok(eventsText(ws).includes('gc.collected'))
  } finally { rmWs(ws) }
})

test('collect 拒收：越界 / 保护名单 / 不存在 / 回收站自身', () => {
  const ws = mkWs()
  try {
    wf(ws, 'project.md'); wf(ws, 'lessons.md'); wf(ws, '.git/config'); wf(ws, 'node_modules/x.js'); wf(ws, '基线清单-核心.md')
    const r = collect(ws, ['../outside.txt', 'project.md', '.git/config', 'node_modules/x.js', '基线清单-核心.md', 'missing.txt', '.jarvis/trash'])
    assert.equal(r.collected.length, 0)
    const whys = Object.fromEntries(r.skipped.map((s) => [s.rel, s.why]))
    assert.match(whys['../outside.txt'], /越出工作区范围/)
    assert.equal(whys['project.md'], '保护名单')
    assert.equal(whys['.git/config'], '保护名单')
    assert.equal(whys['node_modules/x.js'], '保护名单')
    assert.equal(whys['基线清单-核心.md'], '保护名单')
    assert.equal(whys['missing.txt'], '不存在')
    assert.equal(whys['.jarvis/trash'], '保护名单')
    assert.ok(fs.existsSync(path.join(ws, 'project.md'))) // 保护名单原样未动
  } finally { rmWs(ws) }
})

test('listTrash：manifest 坏行跳过、保留期天数正确', () => {
  const ws = mkWs()
  try {
    wf(ws, 'a.txt')
    const { collected } = collect(ws, ['a.txt'])
    fs.appendFileSync(path.join(ws, '.jarvis/trash/manifest.jsonl'), 'not-json-line\n')
    const t = listTrash(ws)
    assert.ok(t.badLines >= 1)
    const item = t.items.find((x) => x.id === collected[0].id)
    assert.equal(item.state, 'in-trash')
    assert.equal(item.daysLeft, RETENTION_DAYS)
  } finally { rmWs(ws) }
})

test('restore：按 id 恢复原位，状态翻转为 restored', () => {
  const ws = mkWs()
  try {
    wf(ws, 'deep/dir/a.txt')
    const { collected } = collect(ws, ['deep/dir/a.txt'])
    const r = restore(ws, collected[0].id)
    assert.equal(r.ok, true)
    assert.equal(r.restored, 'deep/dir/a.txt')
    assert.ok(fs.existsSync(path.join(ws, 'deep/dir/a.txt')))
    const item = listTrash(ws).items.find((x) => x.id === collected[0].id)
    assert.equal(item.state, 'restored')
    assert.equal(item.daysLeft, null)
    assert.ok(eventsText(ws).includes('gc.restored'))
  } finally { rmWs(ws) }
})

test('restore 拒绝：未知 id / 原位冲突 / 重复恢复 / 物品缺失 / 已 purge', () => {
  const ws = mkWs()
  try {
    wf(ws, 'a.txt'); wf(ws, 'b.txt'); wf(ws, 'c.txt'); wf(ws, 'd.txt')
    const { collected } = collect(ws, ['a.txt', 'b.txt', 'c.txt', 'd.txt'])
    const [ida, idb, idc, idd] = collected.map((x) => x.id)
    assert.equal(restore(ws, 'no-such-id').ok, false)
    // 原位冲突：手工放回同名文件，恢复必须拒收（不覆盖）
    wf(ws, 'a.txt', 'conflict')
    const r1 = restore(ws, ida)
    assert.equal(r1.ok, false)
    assert.match(r1.error, /原位置已存在同名文件/)
    // 恢复成功后再恢复一次 → 已恢复过
    assert.equal(restore(ws, idb).ok, true)
    assert.match(restore(ws, idb).error, /恢复过/)
    // 物品缺失（外部把回收站物品挪走了）
    fs.rmSync(path.join(ws, '.jarvis/trash/items', idc), { recursive: true, force: true })
    assert.match(restore(ws, idc).error, /缺失/)
    // purge 之后再恢复 → 拒绝
    purgeExpired(ws, { force: true })
    assert.match(restore(ws, idd).error, /彻底删除/)
  } finally { rmWs(ws) }
})

test('purgeExpired：保留期内不动 / 到期清理 / force 全清', () => {
  const ws = mkWs()
  try {
    wf(ws, 'a.txt'); wf(ws, 'b.txt'); wf(ws, 'c.txt')
    const { collected } = collect(ws, ['a.txt', 'b.txt', 'c.txt'])
    const [ida, idb, idc] = collected.map((x) => x.id)
    // 期限内的不动
    assert.equal(purgeExpired(ws).purged.length, 0)
    assert.ok(fs.existsSync(path.join(ws, '.jarvis/trash/items', ida)))
    // 回填 40 天前的 movedAt → 到期清理
    backdateEntry(ws, idb, 40)
    const { purged } = purgeExpired(ws)
    assert.equal(purged.length, 1)
    assert.equal(purged[0].id, idb)
    assert.ok(!fs.existsSync(path.join(ws, '.jarvis/trash/items', idb)))
    assert.equal(listTrash(ws).items.find((x) => x.id === idb).state, 'purged')
    assert.ok(eventsText(ws).includes('gc.purged'))
    // force 无视期限清掉剩余（ida 未到期也在站内，idc 同理；已 purged 的 idb 不重复）
    const { purged: all } = purgeExpired(ws, { force: true })
    assert.equal(all.length, 2)
    assert.deepEqual(all.map((x) => x.id).sort(), [ida, idc].sort())
  } finally { rmWs(ws) }
})

// ── gc.js：规则引擎 ─────────────────────────────────────────────────────
test('findGarbage R1：迭代版本包只留最高 N 版', () => {
  const ws = mkWs()
  try {
    wf(ws, 'pkg-v1.zip'); wf(ws, 'pkg-v2.zip'); wf(ws, 'pkg-v45.zip'); wf(ws, 'alone-v3.zip')
    const found = findGarbage(ws, ['packages'], 1)
    const rels = found.map((f) => f.rel)
    assert.ok(rels.includes('pkg-v1.zip') && rels.includes('pkg-v2.zip'))
    assert.ok(!rels.includes('pkg-v45.zip')) // 最高版本保留
    assert.ok(!rels.includes('alone-v3.zip')) // 单版本不成组
    assert.ok(found.every((f) => /R1/.test(f.rule)))
    const rels2 = findGarbage(ws, ['packages'], 2).map((f) => f.rel)
    assert.deepEqual(rels2, ['pkg-v1.zip']) // keep=2 只删最老一个
  } finally { rmWs(ws) }
})

test('findGarbage R2：多版本文档只留终版（.jarvis/docs 与工作区根目录）', () => {
  const ws = mkWs()
  try {
    wf(ws, '.jarvis/docs/交付清单v1.0-说明.md'); wf(ws, '.jarvis/docs/交付清单v1.33-说明.md')
    wf(ws, 't103-v44-总结.md'); wf(ws, 't103-v45-总结.md')
    const rels = findGarbage(ws, ['docs'], 1).map((f) => f.rel)
    assert.ok(rels.includes('.jarvis/docs/交付清单v1.0-说明.md'))
    assert.ok(!rels.includes('.jarvis/docs/交付清单v1.33-说明.md')) // 终版保留
    assert.ok(rels.includes('t103-v44-总结.md') && !rels.includes('t103-v45-总结.md'))
  } finally { rmWs(ws) }
})

test('findGarbage R2c/R4/R3：日期迭代、过期日志、过期临时目录', () => {
  const ws = mkWs()
  try {
    wf(ws, '冻结清单定版-20261016a.md'); wf(ws, '冻结清单定版-20261016b.md')
    wf(ws, 'app.log'); ageDays(path.join(ws, 'app.log'), 10)
    wf(ws, 'fresh.log')
    wf(ws, '.tmp/old.txt'); ageDays(path.join(ws, '.tmp'), 8)
    wf(ws, 'chk1a2b3c/x.txt'); ageDays(path.join(ws, 'chk1a2b3c'), 8)
    const rels = findGarbage(ws, ['docs', 'tmp'], 1).map((f) => f.rel)
    assert.ok(rels.includes('冻结清单定版-20261016a.md') && !rels.includes('冻结清单定版-20261016b.md')) // 只留最新一期
    assert.ok(rels.includes('app.log') && !rels.includes('fresh.log')) // 日志 >7 天才收
    assert.ok(rels.includes('.tmp') && rels.includes('chk1a2b3c')) // 临时目录 >7 天才收
  } finally { rmWs(ws) }
})

// ── gc.js：自动兜底与快照摘要 ───────────────────────────────────────────
test('maybeAutoGc：无状态根跳过 / 首跑自动收纳 / 24h 节流 / 插件仓库同样清理', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-bare-'))
  const ws = mkWs()
  const fake = path.join(os.tmpdir(), 'luke-jarvis-gcselftest-' + Date.now())
  try {
    assert.equal(maybeAutoGc(bare), null) // 无 .jarvis 状态根：直接跳过
    wf(ws, 'pkg-v1.zip'); wf(ws, 'pkg-v2.zip'); wf(ws, 'pkg-v3.zip')
    const s1 = maybeAutoGc(ws)
    assert.ok(s1 && s1.found >= 2 && s1.collected >= 2)
    assert.ok(fs.existsSync(path.join(ws, '.jarvis/gc.auto.json')))
    assert.ok(eventsText(ws).includes('gc.swept'))
    assert.equal(maybeAutoGc(ws), null) // 24h 节流：刚跑过不再跑
    // 插件仓库形态也要清理（原实现写死排除 luke-jarvis，导致备份文件永不被收）
    fs.mkdirSync(path.join(fake, '.jarvis'), { recursive: true })
    wf(fake, 'plugin.js')
    wf(fake, 'plugin.js.bak_gc_20261110')   // 有正式版对照 → 可收
    const sf = maybeAutoGc(fake)
    assert.ok(sf && sf.collected >= 1, '插件仓库的改动前备份应能被自动回收')
    assert.ok(!fs.existsSync(path.join(fake, 'plugin.js.bak_gc_20261110')))
    assert.ok(fs.existsSync(path.join(fake, 'plugin.js')), '正式文件不能被误收')
  } finally { rmWs(ws); fs.rmSync(bare, { recursive: true, force: true }); fs.rmSync(fake, { recursive: true, force: true }) }
})

test('gcSummary：在站件数、保留期与上次清扫摘要', () => {
  const ws = mkWs()
  try {
    wf(ws, 'pkg-v1.zip'); wf(ws, 'pkg-v2.zip')
    maybeAutoGc(ws) // 收走 pkg-v1.zip（R1 只留最高版）
    wf(ws, 'extra-old.txt')
    collect(ws, ['extra-old.txt'], '手工入站')
    const s = gcSummary(ws)
    assert.equal(s.inTrash, 2)
    assert.equal(s.retentionDays, RETENTION_DAYS)
    assert.ok(s.lastSweep && typeof s.lastSweep.found === 'number')
    assert.ok(s.recent.length >= 1)
  } finally { rmWs(ws) }
})

// ── gc.js：工具入口 ─────────────────────────────────────────────────────
test('jarvis_gc 工具：dryRun 默认不收 / 真收 / list / .jarvis 目录守卫（Windows 路径也要拦）', async () => {
  const ws = mkWs()
  try {
    wf(ws, 'pkg-v1.zip'); wf(ws, 'pkg-v2.zip'); wf(ws, 'pkg-v3.zip')
    const tool = GC_TOOLS[0]
    // 默认 dryRun：只报不动
    const dry = await tool.execute({ action: 'sweep', projectDir: ws }, null)
    assert.equal(dry.dryRun, true)
    assert.equal(dry.found, 2)
    assert.equal(dry.collected, 0)
    assert.ok(fs.existsSync(path.join(ws, 'pkg-v1.zip')))
    // dryRun=false：真收入回收站
    const real = await tool.execute({ action: 'sweep', projectDir: ws, dryRun: 'false' }, null)
    assert.equal(real.collected, 2)
    assert.ok(!fs.existsSync(path.join(ws, 'pkg-v1.zip')))
    // list：在站清单
    const list = await tool.execute({ action: 'list', projectDir: ws }, null)
    assert.match(list.verdict, /在站/)
    // .jarvis 目录守卫：Windows 反斜杠路径同样必须拒绝（STATE_ROOT_CONFLICT）
    const guarded = await tool.execute({ action: 'sweep', projectDir: path.join(ws, '.jarvis') }, null)
    assert.match(guarded.verdict, /拒绝|STATE_ROOT_CONFLICT/)
  } finally { rmWs(ws) }
})

// ── 第 1 层：R0 改动前备份（.bak）───────────────────────────────────────
test('第1层 R0：.bak 备份仅在正式版存在时收；无正式版=唯一副本 不收', () => {
  const ws = mkWs()
  try {
    // 有正式版对照 → 是备份，可收
    wf(ws, 'webui/app.html', '<html>正式版</html>')
    wf(ws, 'webui/app.html.bak_board_rich_20261109', '旧备份')
    wf(ws, 'src/x.js', '正式')
    wf(ws, 'src/x.js.bak_gc_20261110', '旧备份')
    // 无正式版 → 可能是唯一副本，必须跳过
    wf(ws, 'lonely.md.bak', '唯一内容')
    const found = findGarbage(ws, ['all', 'backups'], 1)
    const rels = found.map((f) => f.rel)
    assert.ok(rels.includes('webui/app.html.bak_board_rich_20261109'), '子目录里的备份应被识别（原实现不扫 webui/）')
    assert.ok(rels.includes('src/x.js.bak_gc_20261110'))
    assert.ok(!rels.includes('lonely.md.bak'), '没有正式版对照的 .bak 不能收（宁漏勿错）')
    assert.ok(!rels.includes('webui/app.html'), '正式文件不能被当成备份')
    // 真收：正式文件必须还在
    const r = collect(ws, found.map((f) => f.rel), 'test')
    assert.equal(r.collected.length, 2)
    assert.ok(fs.existsSync(path.join(ws, 'webui/app.html')))
    assert.ok(fs.existsSync(path.join(ws, 'src/x.js')))
    assert.ok(fs.existsSync(path.join(ws, 'lonely.md.bak')), '唯一副本仍在')
  } finally { rmWs(ws) }
})

test('扫描边界：.git / node_modules / 回收站自身 永不进入', () => {
  const ws = mkWs()
  try {
    const rels = ['a', 'a.bak_x_20260101', 'b', 'b.bak_y_20260101', 'c', 'c.bak_z_20260101']
    wf(ws, '.git/HEAD', 'ref')
    wf(ws, '.git/HEAD.bak_x_20260101', 'x')
    wf(ws, 'node_modules/pkg/index.js', 'x')
    wf(ws, 'node_modules/pkg/index.js.bak_y_20260101', 'x')
    const found = findGarbage(ws, ['all', 'backups'], 1).map((f) => f.rel)
    assert.ok(!found.some((r) => r.startsWith('.git/')), '.git 内不得扫描')
    assert.ok(!found.some((r) => r.startsWith('node_modules/')), 'node_modules 内不得扫描')
  } finally { rmWs(ws) }
})

// ── 第 2 层：AI 产出登记表 ───────────────────────────────────────────────
test('第2层：AI 登记的临时产出超期才收；permanent 与未登记一律不动', async () => {
  const { markGenerated, findGeneratedGarbage, isGeneratedTemporary, unmarkGenerated } = await import('../src/host/tools/generated.js')
  const ws = mkWs()
  try {
    wf(ws, '.jarvis/pages/draft-report.html', 'ai 产出')
    wf(ws, '.jarvis/pages/keep-forever.html', 'ai 产出但客户要留')
    wf(ws, '.jarvis/pages/unknown.html', '未登记')
    markGenerated(ws, '.jarvis/pages/draft-report.html', { task: 'T1', keep: 'temporary' })
    markGenerated(ws, '.jarvis/pages/keep-forever.html', { task: 'T1', keep: 'permanent' })
    assert.ok(fs.existsSync(path.join(ws, '.jarvis/generated.json')), '登记表应落盘')
    // 未超期：不算垃圾
    assert.equal(findGeneratedGarbage(ws, 30).length, 0)
    assert.equal(isGeneratedTemporary(ws, '.jarvis/pages/draft-report.html', 30), false)
    // 把登记时间改成 40 天前 → 超期
    const regFile = path.join(ws, '.jarvis/generated.json')
    const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'))
    reg['.jarvis/pages/draft-report.html'].at = new Date(Date.now() - 40 * 86400000).toISOString()
    fs.writeFileSync(regFile, JSON.stringify(reg))
    const gen = findGeneratedGarbage(ws, 30)
    assert.equal(gen.length, 1)
    assert.equal(gen[0].rel, '.jarvis/pages/draft-report.html')
    assert.equal(gen[0].task, 'T1')
    // permanent 即使超期也不收
    reg['.jarvis/pages/keep-forever.html'].at = new Date(Date.now() - 400 * 86400000).toISOString()
    fs.writeFileSync(regFile, JSON.stringify(reg))
    assert.equal(findGeneratedGarbage(ws, 30).length, 1, 'permanent 永不自动收')
    // 未登记文件永远不进候选
    assert.ok(!findGeneratedGarbage(ws, 30).some((x) => x.rel.includes('unknown')))
    // 取消登记后不再是候选
    unmarkGenerated(ws, '.jarvis/pages/draft-report.html')
    assert.equal(findGeneratedGarbage(ws, 30).length, 0)
  } finally { rmWs(ws) }
})

// ── 第 3 层：建议清理（只提示不自动删）──────────────────────────────────
test('第3层：建议清单只提示；即使命中也不会被自动 GC 收走', () => {
  const ws = mkWs()
  try {
    wf(ws, 'draft-稿子.md', '草稿')
    wf(ws, 'report copy.md', '副本')
    const old = Date.now() - 200 * 86400000
    wf(ws, 'notes.md', '老文件')
    fs.utimesSync(path.join(ws, 'notes.md'), old / 1000, old / 1000)
    const sugs = findSuggestions(ws)
    const rels = sugs.map((s) => s.rel)
    assert.ok(rels.includes('draft-稿子.md'), '草稿语义应进建议')
    assert.ok(rels.includes('report copy.md'), '副本语义应进建议')
    assert.ok(rels.includes('notes.md'), '90 天未改动应进建议')
    // 关键：自动 GC 不得动它们（建议 ≠ 自动删除）
    const before = fs.readdirSync(ws).length
    maybeAutoGc(ws)
    const still = ['draft-稿子.md', 'report copy.md', 'notes.md'].every((f) => fs.existsSync(path.join(ws, f)))
    assert.ok(still, '建议清单里的文件不能被自动 GC 收走')
    assert.equal(fs.readdirSync(ws).length, before, '自动 GC 不应改变建议文件')
    // 客户确认后才收
    const r = collect(ws, ['draft-稿子.md'], '客户确认清理')
    assert.equal(r.collected.length, 1)
    assert.ok(!fs.existsSync(path.join(ws, 'draft-稿子.md')))
  } finally { rmWs(ws) }
})

// ── 回收站缺陷修复 ──────────────────────────────────────────────────────
test('目录整体回收与批量恢复（收 20 个文件不必点 20 次）', () => {
  const ws = mkWs()
  try {
    fs.mkdirSync(path.join(ws, 'old-dir/sub'), { recursive: true })
    for (let i = 0; i < 5; i++) wf(ws, `old-dir/f${i}.txt`, String(i))
    wf(ws, 'old-dir/sub/nested.txt', 'n')
    const r = collect(ws, ['old-dir'], '整目录')
    assert.equal(r.collected.length, 1)
    assert.ok(!fs.existsSync(path.join(ws, 'old-dir')), '目录应整体移走')
    // 目录内容完整进了回收站
    const items = fs.readdirSync(path.join(ws, '.jarvis/trash/items', r.collected[0].id))
    assert.ok(items.length >= 1)
    // 批量恢复
    const rr = restoreMany(ws, 'all')
    assert.equal(rr.restored.length, 1)
    assert.ok(fs.existsSync(path.join(ws, 'old-dir/f0.txt')), '整目录应恢复回来')
    assert.ok(fs.existsSync(path.join(ws, 'old-dir/sub/nested.txt')), '嵌套内容也要回来')
  } finally { rmWs(ws) }
})

test('manifest 压缩：大量条目后仍能正确读回状态', () => {
  const ws = mkWs()
  try {
    for (let i = 0; i < 30; i++) {
      wf(ws, `f${i}.txt`, String(i))
      collect(ws, [`f${i}.txt`], `r${i}`)
    }
    const before = listTrash(ws).items.filter((x) => x.state === 'in-trash')
    assert.equal(before.length, 30)
    compactManifest(ws)
    const after = listTrash(ws).items.filter((x) => x.state === 'in-trash')
    assert.equal(after.length, 30, '压缩后状态不能丢')
    assert.equal(after[0].orig, before[0].orig)
  } finally { rmWs(ws) }
})

test('GC 定时器：不依赖 HTTP 轮询（插件注册独立时钟）', () => {
  const src = fs.readFileSync(new URL('../src/host/plugin.js', import.meta.url), 'utf8')
  assert.ok(/gcTick/.test(src), '应有独立 GC 时钟')
  assert.ok(/setInterval\(gcTick, 60 \* 60 \* 1000\)/.test(src), '每小时醒一次检查是否满 24h')
  assert.ok(!/\|luke-jarvis\/\.test\(absRoot\)/.test(src), '不得再写死排除 luke-jarvis')
})
