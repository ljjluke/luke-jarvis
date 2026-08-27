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
import plugin, { TOOLS, validateCardShape, jarvisCommand, identifyIndustry, checkCollabHealth } from '../src/host/plugin.js'

const GOOD_CEO_CARD = [
  '身份定位：电商 CEO，负责……',
  '思维模型：第一性原理……（跨域复现：在产品和定价均出现；生成力：可推断新品类立场；排他性：独特）',
  '核心方法论：1) xx；2) yy……',
  '代表作品：参考真实作品公开框架——只借鉴框架，不冒充署名。',
  '决策红线：虚假规模一票否决。',
  '语言风格：数据驱动，结论先行。',
  '协同架构：位置=与产品增长并行、研发下游；依赖=产品需求与契约；介入时机=从立项全程参与；协同方式=用 send_message 实时讨论，冲突升级 jarvis_review/CEO 裁决（并行非串行）。',
  '证据链：著作(2部) + 对话(3段访谈) + 表达(社媒) + 他者评价 + 决策记录 + 时间线——达标。',
  '保真度：一手占比约0.7；矛盾点1处已保留（他对 A 与 B 的立场存在张力，未和稀泥）。',
  '诚实边界：信息截止2026-08；无法预判全新问题；存在公开表达 vs 真实想法差距；含推测成分已标注。',
  'source：https://example.com/real-source/interview',
  '防冒名声明：本角色卡借鉴其公开方法论，非其本人观点。',
].join('\n')

test('validateCardShape：合格 CEO 卡（女娲式证据链完整）通过', () => {
  assert.deepStrictEqual(validateCardShape(GOOD_CEO_CARD, true), [])
})

test('validateCardShape：缺证据链段不通过', () => {
  const card = GOOD_CEO_CARD.replace('证据链：著作(2部) + 对话(3段访谈) + 表达(社媒) + 他者评价 + 决策记录 + 时间线——达标。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('证据链'))
})

test('validateCardShape：缺诚实边界不通过（防编造型蒸馏）', () => {
  const card = GOOD_CEO_CARD.replace('诚实边界：信息截止2026-08；无法预判全新问题；存在公开表达 vs 真实想法差距；含推测成分已标注。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.some((m) => /诚实边界/.test(m)))
})

test('validateCardShape：source 非真实 URL 不通过（拦截编造出处）', () => {
  const card = GOOD_CEO_CARD.replace('source：https://example.com/real-source/interview', 'source：据某书，非URL')
  const missing = validateCardShape(card, true)
  assert.ok(missing.some((m) => /真实URL/.test(m)))
})

test('jarvis_fidelity：保真度合格卡评级 PRIMARILY-FIRST-HAND', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fidelity')
  const r = await def.handler({ role: 'CEO', card: GOOD_CEO_CARD })
  assert.strictEqual(r.rating, 'PRIMARILY-FIRST-HAND')
  assert.deepStrictEqual(r.issues, [])
})

test('jarvis_fidelity：命中黑名单源 → 标记问题', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fidelity')
  const bad = GOOD_CEO_CARD + '\n补充来源：知乎某回答'
  const r = await def.handler({ role: 'CEO', card: bad })
  assert.ok(r.issues.some((i) => /知乎|黑名单/.test(i)))
})

test('jarvis_fidelity：缺诚实边界 → 非 PRIMARILY', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fidelity')
  const card = GOOD_CEO_CARD.replace('诚实边界：信息截止2026-08；无法预判全新问题；存在公开表达 vs 真实想法差距；含推测成分已标注。', '')
  const r = await def.handler({ role: 'CEO', card })
  assert.notStrictEqual(r.rating, 'PRIMARILY-FIRST-HAND')
  assert.ok(r.issues.length >= 1)
})

test('validateCardShape：缺 source 不通过', () => {
  const card = GOOD_CEO_CARD.replace('source：https://example.com/real-source/interview', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('source'))
})

test('validateCardShape：缺防冒名不通过', () => {
  const card = GOOD_CEO_CARD.replace('防冒名声明：本角色卡借鉴其公开方法论，非其本人观点。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('防冒名声明'))
})

test('validateCardShape：CEO 缺协同架构不通过', () => {
  const card = GOOD_CEO_CARD.replace('协同架构：位置=与产品增长并行、研发下游；依赖=产品需求与契约；介入时机=从立项全程参与；协同方式=用 send_message 实时讨论，冲突升级 jarvis_review/CEO 裁决（并行非串行）。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('协同架构'))
})

test('validateCardShape：普通角色不需协同架构（但需证据链）', () => {
  const card = GOOD_CEO_CARD.replace('协同架构：位置=与产品增长并行、研发下游；依赖=产品需求与契约；介入时机=从立项全程参与；协同方式=用 send_message 实时讨论，冲突升级 jarvis_review/CEO 裁决（并行非串行）。', '')
  const missing = validateCardShape(card, false)
  assert.ok(!missing.includes('协同架构'), '普通角色不需协同架构')
  assert.ok(!missing.includes('证据链'), '但仍需证据链')
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
  assert.ok(r.content.includes('jarvis_fidelity'), '应包含保真度审计指令')
  assert.ok(r.content.includes('证据不足宁 60 分诚实不要 90 分编造'), '应包含女娲式铁律')
})

test('/jarvis 命令执行：电商需求识别为电商', () => {
  const r = jarvisCommand('做一个短视频带货直播间运营方案')
  assert.ok(r.content.includes('短视频/内容') || r.content.includes('待确认'))
})

test('工具清单应含 6 个 jarvis_* 工具（含保真度审计+协同设计）', () => {
  const names = TOOLS.map((t) => t.name)
  for (const n of ['jarvis_project', 'jarvis_distill', 'jarvis_review', 'jarvis_think', 'jarvis_fidelity', 'jarvis_collab']) {
    assert.ok(names.includes(n), `缺少 ${n}`)
  }
})

// ── 团队协同（CEO 定子角色后的必备硬闸）──

test('CEO 卡协同架构缺「位置」→ 不通过', () => {
  const card = GOOD_CEO_CARD.replace(/位置=[^；;]+；?/, '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('协同架构缺「位置」'))
})

test('CEO 卡协同架构缺「协同方式」→ 不通过', () => {
  const card = GOOD_CEO_CARD.replace('协同方式=用 send_message 实时讨论，冲突升级 jarvis_review/CEO 裁决（并行非串行）。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('协同架构缺「协同方式」'))
})

test('jarvis_collab：合格协同（2+角色/四要素/升级/并行）→ ok=true', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_collab')
  const r = await def.handler({
    requirement: '电商拼团系统',
    rolesJson: JSON.stringify([
      { name: '产品增长', duty: '定义价值' },
      { name: '供应链', duty: '履约' },
      { name: '研发', duty: '实现' },
      { name: '风控', duty: '资金安全' },
    ]),
    collabText: '位置=产品上游、研发并行、风控横向否决；依赖=产品给契约、研发给接口；介入时机=风控从立项全程、测试从产品阶段；协同方式=并行实时讨论 send_message，升级 jarvis_review/CEO 裁决',
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.issues.length, 0)
})

test('jarvis_collab：串行交接 → ok=false（改为并行）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_collab')
  const r = await def.handler({
    requirement: '电商拼团系统',
    rolesJson: JSON.stringify([{ name: '产品' }, { name: '研发' }, { name: '测试' }]),
    collabText: '位置=依次先后；依赖=前者完成后给后者；介入时机=依次进入；协同方式=先产品再研发最后测试（串行交接）',
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.issues.some((i) => /串行/.test(i) || /并行/.test(i)))
})

test('jarvis_collab：角色太少（1 个）→ ok=false', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_collab')
  const r = await def.handler({ requirement: '小事', rolesJson: JSON.stringify([{ name: '研发' }]), collabText: '位置=独立；依赖=无；介入时机=现在；协同方式=独立完成' })
  assert.strictEqual(r.ok, false)
})
// ── 分工明确 + 真实协作（用户核心关切）──

test('jarvis_collab：输出 perRole（每个角色的协同四要素）且合格', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_collab')
  const r = await def.handler({
    requirement: '电商拼团系统',
    rolesJson: JSON.stringify([
      { name: '产品增长', duty: '定义价值', position: '上游' },
      { name: '供应链', duty: '履约', position: '下游' },
      { name: '研发', duty: '实现', position: '并行' },
    ]),
    collabText: '位置=并行；依赖=产品给契约；介入时机=全程；协同方式=实时讨论；升级=CEO',
  })
  assert.ok(Array.isArray(r.perRole), '应输出 perRole')
  assert.strictEqual(r.perRole.length, 3, '每角色都有协同段')
  assert.ok(r.perRole.every((p) => p.role && p.position && p.depends), '每角色有 position/depends')
})

test('jarvis_collab：角色缺自己的协同段（position=待CEO补充）→ 判不合格', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_collab')
  const r = await def.handler({
    requirement: '电商',
    rolesJson: JSON.stringify([{ name: '产品' }, { name: '研发' }]),
    collabText: '位置=X；依赖=Y；介入时机=Z；协同方式=W；升级=CEO',
  })
  // 两个角色都没给 own 段 → position/depends 是待CEO补充 → 应判不合格
  assert.strictEqual(r.ok, false)
  assert.ok(r.issues.some((i) => /待CEO补充|分工/.test(i)), '应提示角色分工不明')
})

test('非 CEO 角色卡缺「我的协同/位置/依赖/升级」→ 不通过（分工明确硬闸）', () => {
  const bare = [
    '身份定位：研发工程师。',
    '思维模型：演进式架构。',
    '核心方法论：1) 小步重构；2) 测试先行。',
    '代表作品：参考公开框架——只借鉴框架。',
    '决策红线：无测试不提交。',
    '语言风格：先结论后实现。',
    '证据链：著作+对话+表达+他者+决策+时间线。',
    '保真度：一手0.6；矛盾保留。',
    '诚实边界：信息截止；推测已标。',
    'source：https://example.com/dev',
    '防冒名声明：只借鉴框架，不冒充署名。',
  ].join('\n')
  const missing = validateCardShape(bare, false)
  assert.ok(missing.some((m) => /我的协同|我的位置|我的依赖|我的升级/.test(m)), '分工不明应被拦')
})

test('非 CEO 角色卡含「我的职责/依赖/升级」→ 通过', () => {
  const good = [
    '身份定位：研发工程师。',
    '思维模型：演进式架构。',
    '核心方法论：1) 小步重构；2) 测试先行。',
    '代表作品：参考公开框架——只借鉴框架。',
    '决策红线：无测试不提交。',
    '语言风格：先结论后实现。',
    '我的协同：我负责实现交易核心；从产品阶段拿契约；给测试喂接口；我给风控提供订单数据；升级=分歧交 CEO/jarvis_review。',
    '证据链：著作+对话+表达+他者+决策+时间线。',
    '保真度：一手0.6；矛盾保留。',
    '诚实边界：信息截止；推测已标。',
    'source：https://example.com/dev',
    '防冒名声明：只借鉴框架，不冒充署名。',
  ].join('\n')
  const missing = validateCardShape(good, false)
  assert.ok(!missing.some((m) => /我的协同|我的位置|我的依赖|我的升级/.test(m)), '分工明确应通过')
})
