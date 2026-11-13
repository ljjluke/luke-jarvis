/** 知识库（记忆流水线）测试。
 *
 *  用户三个硬要求：
 *   ①「知识库形式，别越积压越多」→ 指纹去重，重复即强化，不新增条目
 *   ②「人脑式遗忘衰减」→ 强度随时间衰减，红线条目减速 1/10 且永不淡出
 *   ③「思考的时候提取知识」→ 按领域+强度检索，返回 top-N
 *
 *  另覆盖：① 机器候选池（不入主库，信号够了才转正）、② 巩固门接入、⑤ 摘要注入。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { remember, recall, markUsed, mindStats, domainDigest, compactMind, harvestFromReport, promoteCandidates, candidateStats } from '../src/host/state/mind.js'
import { MIND_TOOLS } from '../src/host/tools/mindtools.js'

function mkWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mind-test-'))
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  return dir
}
function rmWs(dir) { fs.rmSync(dir, { recursive: true, force: true }) }

// ── ③ 去重即强化（不积压）────────────────────────────────────────────
test('③ 去重：同一教训重复写入只强化、不新增条目', () => {
  const ws = mkWs()
  try {
    const r1 = remember(ws, { text: '客户要做小程序时，先确认是否多端，因为后期加端成本高', kind: 'lesson', domains: ['电商'] })
    assert.equal(r1.action, 'created')
    const r2 = remember(ws, { text: '客户要做小程序时，先确认是否多端，因为后期加端成本高', kind: 'lesson', domains: ['电商'] })
    assert.equal(r2.action, 'reinforced', '同内容应强化而不是新增')
    assert.equal(r2.id, r1.id, '强化的是同一条')
    // 措辞顺序不同但字符集相同：也要识别为同一条（字符集指纹容忍语序差异）
    const r3 = remember(ws, { text: '因为后期加端成本高，客户要做小程序时先确认是否多端' })
    assert.equal(r3.action, 'reinforced', '语序不同也应去重（字符集指纹）')
    const st = mindStats(ws)
    assert.equal(st.total, 1, '无论写几次，库里只有 1 条')
  } finally { rmWs(ws) }
})

test('③ 多领域标签：一条经验可属于多个领域（避免分裂成多个碎片库）', () => {
  const ws = mkWs()
  try {
    remember(ws, { text: '成团倒计时必须给用户明确心理预期，否则流失率高', kind: 'domain', domains: ['电商', '通用'] })
    const hitEcom = recall(ws, { domains: ['电商'], limit: 10 })
    const hitEdu = recall(ws, { domains: ['教育'], limit: 10 })
    assert.equal(hitEcom.length, 1, '电商领域应命中')
    const e = hitEcom[0]
    assert.ok((e.domains || []).includes('电商') && (e.domains || []).includes('通用'), '应保留多标签')
    // 跨领域：教育领域也能看到（排在后面，但通用标签兜底）
    assert.ok(hitEdu.length >= 1, '通用标签让它在其他领域也可被发现')
  } finally { rmWs(ws) }
})

// ── ④ 遗忘衰减（人脑式）──────────────────────────────────────────────
test('④ 衰减：久未使用的条目强度下降；红线条目减速 1/10 且永不淡出', () => {
  const ws = mkWs()
  try {
    remember(ws, { text: '普通经验：接口联调前要先对齐字段命名', kind: 'lesson' })
    remember(ws, { text: '红线：涉及资金的计算必须用整数分，因为浮点误差会导致对账不平', kind: 'lesson', pinned: true })
    const fresh = recall(ws, { limit: 10 })
    assert.equal(fresh.length, 2)
    const normal = fresh.find((x) => !x.pinned)
    const pinned = fresh.find((x) => x.pinned)
    assert.ok(normal && pinned, '两条都在')
    // 模拟 200 天后：把 lastUsed 调旧
    const old = new Date(Date.now() - 200 * 86400000).toISOString()
    const dir = path.join(ws, '.jarvis/mind')
    for (const f of fs.readdirSync(dir)) {
      const file = path.join(dir, f)
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
        try { const e = JSON.parse(l); e.lastUsed = Date.parse(old); return JSON.stringify(e) } catch { return l }
      })
      fs.writeFileSync(file, lines.join('\n') + '\n')
    }
    const after = recall(ws, { limit: 10, includeFaded: true })
    const n2 = after.find((x) => !x.pinned)
    const p2 = after.find((x) => x.pinned)
    assert.ok(n2.strength < normal.strength, '普通条目强度应下降')
    assert.ok(p2.strength > n2.strength, '红线衰减更慢（强度更高）')
    assert.ok(p2.strength >= 0.5, '红线强度不归零（永不淡出）')
    // 默认检索（不 includeFaded）里红线仍在，普通条目可能被过滤
    const def = recall(ws, { limit: 10 })
    assert.ok(def.some((x) => x.pinned), '红线永不淡出')
  } finally { rmWs(ws) }
})

test('④ 强化：被使用过的条目强度回升', () => {
  const ws = mkWs()
  try {
    const r = remember(ws, { text: '做报表先问清口径，否则返工', kind: 'lesson' })
    const before = recall(ws, { limit: 5 })[0].strength
    markUsed(ws, [r.id])
    const after = recall(ws, { limit: 5 })[0].strength
    assert.ok(after > before, '被引用后强度应上升')
  } finally { rmWs(ws) }
})

// ── ⑤ 检索（思考时提取）──────────────────────────────────────────────
test('⑤ 检索：领域相关性排序 + 限量返回 + 摘要极短', () => {
  const ws = mkWs()
  try {
    remember(ws, { text: '电商领域经验：拼团页面加载超过 2 秒转化率骤降', kind: 'domain', domains: ['电商'] })
    remember(ws, { text: '通用经验：任何需求先确认验收标准再动手', kind: 'lesson', domains: ['通用'] })
    remember(ws, { text: '制造领域经验：产线数据采集要注意时钟同步', kind: 'domain', domains: ['制造'] })
    const list = recall(ws, { domains: ['电商'], limit: 3 })
    assert.ok(list.length >= 2)
    assert.equal(list[0].domains[0], '电商', '同领域应排第一')
    const digest = domainDigest(ws, { domains: ['电商'], max: 2 })
    assert.ok(digest.length > 0 && digest.split('\n').length <= 2, '摘要限 2 条')
    assert.ok(digest.length < 300, '摘要必须极短（常驻上下文）')
  } finally { rmWs(ws) }
})

// ── ① 机器候选池 ──────────────────────────────────────────────────────
test('① 候选池：只收「像经验」的内容；信号够了才转正入主库', () => {
  const ws = mkWs()
  try {
    // 纯状态汇报：不入池
    const a = harvestFromReport(ws, { ticketId: 't1', title: 'X', summary: '已完成需求文档编写' })
    assert.equal(a.added, 0, '无经验信号的内容不入候选池')
    // 有坑的汇报：入池
    const b = harvestFromReport(ws, { ticketId: 't2', title: '接口联调', summary: '联调失败，因为对方没提供测试环境，导致延期两天' })
    assert.equal(b.added, 1)
    // 强信号（多类命中）→ 应该能转正
    const c = harvestFromReport(ws, { ticketId: 't3', title: '缓存', summary: '缓存击穿导致服务雪崩，注意要加互斥锁，否则高并发下必然踩坑' })
    assert.equal(c.added, 1)
    assert.ok(c.hits >= 2, '这条应命中多个信号')
    let st = candidateStats(ws)
    assert.equal(st.total, 2)
    const p = promoteCandidates(ws, { domains: ['通用'], minHits: 2 })
    assert.ok(p.promoted >= 1, '强信号候选应转正')
    // 转正后进了主库，但候选池不删（标记 promoted 防止重复转正）
    const mind = mindStats(ws)
    assert.ok(mind.total >= 1, '转正后主库有条目')
    const p2 = promoteCandidates(ws, { domains: ['通用'], minHits: 2 })
    assert.equal(p2.promoted, 0, '已转正的不会被重复转正')
  } finally { rmWs(ws) }
})

// ── 工具面 ────────────────────────────────────────────────────────────
test('工具面：jarvis_recall / jarvis_mind 齐备且能真实读写', async () => {
  const ws = mkWs()
  try {
    const recallTool = MIND_TOOLS.find((t) => t.name === 'jarvis_recall')
    const mindTool = MIND_TOOLS.find((t) => t.name === 'jarvis_mind')
    assert.ok(recallTool && mindTool, '两个工具都存在')
    const w = await mindTool.execute({ action: 'consolidate', text: '当需求含多端时要先确认平台优先级，因为同时做会拖长周期', kind: 'lesson', domains: '电商,通用', projectDir: ws }, null)
    assert.ok(w.verdict.includes('✅'), '巩固应成功: ' + w.verdict)
    const r = await recallTool.execute({ domains: '电商', limit: '5', projectDir: ws }, null)
    assert.ok(r.count >= 1, '检索应命中刚写入的经验')
    assert.ok(r.items.includes('多端'), '内容应出现在检索结果里')
    // used
    const id = r.items.match(/id=(mem-[a-z0-9]+)/)
    assert.ok(id, '检索结果应带 id')
    const u = await mindTool.execute({ action: 'used', ids: id[1], projectDir: ws }, null)
    assert.ok(u.verdict.includes('✅'))
    const s = await mindTool.execute({ action: 'stats', projectDir: ws }, null)
    assert.ok(s.verdict.includes('知识库'))
  } finally { rmWs(ws) }
})

test('压缩：多行 append 后合并，内容不丢', () => {
  const ws = mkWs()
  try {
    for (let i = 0; i < 5; i++) remember(ws, { text: `经验${i}：每次都要先确认需求边界`, kind: 'lesson' })
    const before = mindStats(ws)
    compactMind(ws)
    const after = mindStats(ws)
    assert.equal(before.total, after.total, '压缩不能丢条目')
  } finally { rmWs(ws) }
})

// ── 接线检查 ──────────────────────────────────────────────────────────
test('接线：工具已注册、巩固门已接入任务收尾、摘要已注入', () => {
  const toolsSrc = fs.readFileSync(new URL('../src/host/tools/index.js', import.meta.url), 'utf8')
  assert.ok(/\.\.\.MIND_TOOLS/.test(toolsSrc), '知识库工具必须注册进 TOOLS')
  assert.ok(/mindDigestFor\(cwd, domains\)/.test(toolsSrc), '领域摘要应注入 systemPrompt')
  const deliverSrc = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')
  assert.ok(/巩固门（记忆流水线②）/.test(deliverSrc), '任务交回应触发巩固门提示')
  assert.ok(/harvestFromReport\(projectDir/.test(deliverSrc), '任务交回应机器抽取候选')
  assert.ok(/mind\.consolidate_due/.test(deliverSrc), '巩固到期应写事件流')
})
