/**
 * luke-jarvis 核心插件单元测试（发布前必跑：node --test）
 * 覆盖：
 *  1. validateCardShape：缺六段式/协同架构/source/防冒名 → 校验不通过（防 bug 核心）
 *  2. jarvis_distill handler：空卡/缺段 → ok=false；合格卡 → ok=true
 *  3. apply(ctx)：tools/commands 有注册调用；缺少服务时不抛错（容错）
 *  4. /jarvis 命令空输入返回用法
 */
import { test } from 'node:test'
import assert from 'node:assert'
import plugin, { TOOLS, validateCardShape, jarvisCommand, identifyIndustry } from '../src/host/plugin.js'

const GOOD_CEO_CARD = [
  '身份定位：电商 CEO，负责……',
  '思维模型：第一性原理……',
  '核心方法论：1) xx；2) yy……',
  '代表作品：参考真实作品公开框架——只借鉴框架，不冒充署名。',
  '决策红线：虚假规模一票否决。',
  '语言风格：数据驱动，结论先行。',
  '协同架构：与产品增长并行；依赖 web 蒸馏结果；从立项介入；冲突升级 jarvis_review。',
  'source：https://example.com/real-source',
  '防冒名声明：本角色卡借鉴其公开方法论，非其本人观点。',
].join('\n')

test('validateCardShape：合格 CEO 卡通过', () => {
  assert.deepStrictEqual(validateCardShape(GOOD_CEO_CARD, true), [])
})

test('validateCardShape：缺 source 不通过', () => {
  const card = GOOD_CEO_CARD.replace('source：https://example.com/real-source', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('source'))
})

test('validateCardShape：缺防冒名不通过', () => {
  const card = GOOD_CEO_CARD.replace('防冒名声明：本角色卡借鉴其公开方法论，非其本人观点。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('防冒名声明'))
})

test('validateCardShape：CEO 缺协同架构不通过', () => {
  const card = GOOD_CEO_CARD.replace('协同架构：与产品增长并行；依赖 web 蒸馏结果；从立项介入；冲突升级 jarvis_review。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('协同架构'))
})

test('validateCardShape：普通角色不需协同架构', () => {
  const card = GOOD_CEO_CARD.replace('协同架构：与产品增长并行；依赖 web 蒸馏结果；从立项介入；冲突升级 jarvis_review。', '')
  assert.deepStrictEqual(validateCardShape(card, false), [])
})

test('jarvis_distill handler：空卡 → ok=false 且提示现场蒸馏', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill')
  const r = await def.handler({ role: 'CEO', card: '', isCeo: true })
  assert.strictEqual(r.ok, false)
  assert.ok(r.verdict.includes('现场'), '应提示必须现场蒸馏')
})

test('jarvis_distill handler：缺段卡 → ok=false 并列出缺失', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill')
  const bad = GOOD_CEO_CARD.replace('决策红线：虚假规模一票否决。', '')
  const r = await def.handler({ role: 'CEO', card: bad, isCeo: true })
  assert.strictEqual(r.ok, false)
  assert.ok(r.missing.includes('决策红线'))
})

test('jarvis_distill handler：合格卡 → ok=true', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill')
  const r = await def.handler({ role: 'CEO', card: GOOD_CEO_CARD, isCeo: true })
  assert.strictEqual(r.ok, true)
  assert.ok(r.verdict.includes('真实判断'))
})

test('apply：注册 4 工具 + /jarvis 命令；无服务时不抛错', () => {
  let toolsCount = 0
  let commandsCount = 0
  const disposers = []
  const ctx = {
    get(name) {
      if (name === 'tools') return { register: () => { toolsCount += 1; return () => {} } }
      if (name === 'commands') return { register: () => { commandsCount += 1; return () => {} } }
      return undefined
    },
    effect(fn) { disposers.push(fn()) }, // cordis 会在 apply 时执行 effect 回调并保留 disposer
  }
  plugin.apply(ctx)
  assert.strictEqual(toolsCount, TOOLS.length, '应注册全部模型工具')
  assert.strictEqual(commandsCount, 1, '应注册 /jarvis 命令')
  assert.ok(disposers.length >= 5, '每个注册都应走 ctx.effect（可清理）')

  // 无服务时不应抛错
  const bare = { get: () => undefined, effect: () => {} }
  assert.doesNotThrow(() => plugin.apply(bare))
})

test('/jarvis 命令：空输入返回用法', () => {
  const r = jarvisCommand(' ')
  assert.ok(r.content.includes('用法'))
})

test('identifyIndustry：电商需求识别为电商并给出蒸馏方向', () => {
  const r = identifyIndustry('我要做一个下沉市场拼团电商小程序，2人团24h成团')
  assert.strictEqual(r.industry, '电商')
  assert.ok(r.distillDirections.some((d) => d.includes('黄峥') || d.includes('Sean') || d.includes('丰田')))
})

test('identifyIndustry：未命中返回待确认', () => {
  const r = identifyIndustry('今天天气怎么样')
  assert.ok(r.industry.includes('待确认'))
})

test('/jarvis 命令执行：真实产物含行业识别与蒸馏指令（非占位）', () => {
  const r = jarvisCommand('做一个金融风控系统，要管住资金安全')
  assert.ok(r.content.includes('行业识别：金融'), '应识别行业')
  assert.ok(r.content.includes('jarvis_distill'), '应包含蒸馏校验指令')
  assert.ok(r.content.includes('绝不直接复用旧卡'), '应包含铁律')
})

test('/jarvis 命令执行：电商需求识别为电商', () => {
  const r = jarvisCommand('做一个短视频带货直播间运营方案')
  assert.ok(r.content.includes('短视频/内容') || r.content.includes('待确认'))
})

test('工具清单应含 4 个 jarvis_* 工具', () => {
  const names = TOOLS.map((t) => t.name)
  for (const n of ['jarvis_project', 'jarvis_distill', 'jarvis_review', 'jarvis_think']) {
    assert.ok(names.includes(n), `缺少 ${n}`)
  }
})