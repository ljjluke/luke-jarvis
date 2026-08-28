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
import plugin, { TOOLS, validateCardShape, assessCardDepth, jarvisCommand, identifyIndustry, checkCollabHealth } from '../src/host/plugin.js'

const GOOD_CEO_CARD = [
  '身份定位：电商 CEO，负责下沉市场拼团电商的战略与团队建设，一手抓增长质量一手抓风控底线。',
  '思维模型：第一性原理+供应链效率——先拆商品毛利结构，按"有效GMV"判断增长真假，再用供应链成本反推定价（跨域复现：商品/渠道/获客均出现；生成力：可推断新品类打法；排他性：独特）。',
  '核心方法论：1) 先定北极星指标，再排优先级；2) 供应链效率是本质，先算成本再谈让利；3) 让利只给真实用户，按拆单/地址/设备特征反刷单。',
  '代表作品：参考拼购模式与供应链整合的公开打法——只借鉴框架，不冒充署名。',
  '决策红线：虚假规模/刷单/套利冲量一票否决；绕过资金风控底线一票否决；不适用场景：非价格敏感品类。',
  '语言风格：数据驱动，结论先行，直指本质。',
  '协同架构：位置=与产品增长并行、研发下游；依赖=产品需求与契约、供应链成本；介入时机=从立项全程参与；协同方式=用 send_message 实时讨论，冲突升级 jarvis_review/CEO 裁决（并行非串行）。',
  '证据链：著作(内部方法论，2009年起多篇) + 对话(2段访谈，2021 podcast) + 表达(个人社媒长文) + 他者评价(供应链同行背书) + 决策记录(拼购案例复盘) + 时间线(2015-2023 逐年公开动作)——6维度达标。',
  '保真度：一手占比约0.7；矛盾点1处已保留（对规模与利润的立场存在张力，未和稀泥）。',
  '诚实边界：信息截止2026-08；无法预判全新问题；存在公开表达 vs 真实想法差距；含推测成分已标注。',
  'source：https://www.chinastarmarket.cn/article/26317（本次 web 搜索确认该访谈原文，方法论摘自其决策记录段落）',
  '防冒名声明：本角色卡借鉴其公开方法论，非其本人观点。',
].join('\n')

test('validateCardShape：合格 CEO 卡（女娲式证据链完整）通过', () => {
  assert.deepStrictEqual(validateCardShape(GOOD_CEO_CARD, true), [])
})

test('validateCardShape：缺证据链段不通过', () => {
  const card = GOOD_CEO_CARD.replace('证据链：著作(内部方法论，2009年起多篇) + 对话(2段访谈，2021 podcast) + 表达(个人社媒长文) + 他者评价(供应链同行背书) + 决策记录(拼购案例复盘) + 时间线(2015-2023 逐年公开动作)——6维度达标。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('证据链'))
})

test('validateCardShape：缺诚实边界不通过（防编造型蒸馏）', () => {
  const card = GOOD_CEO_CARD.replace('诚实边界：信息截止2026-08；无法预判全新问题；存在公开表达 vs 真实想法差距；含推测成分已标注。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.some((m) => /诚实边界/.test(m)))
})

test('validateCardShape：source 非真实 URL 不通过（拦截编造出处）', () => {
  const card = GOOD_CEO_CARD.replace('source：https://www.chinastarmarket.cn/article/26317（本次 web 搜索确认该访谈原文，方法论摘自其决策记录段落）', 'source：据某书，非URL')
  const missing = validateCardShape(card, true)
  assert.ok(missing.some((m) => /真实URL/.test(m)))
})

test('jarvis_fidelity：保真度合格卡评级 PRIMARILY-FIRST-HAND', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fidelity')
  const r = await def.handler({ role: 'CEO', card: GOOD_CEO_CARD })
  assert.strictEqual(r.rating, 'PRIMARILY-FIRST-HAND')
  assert.deepStrictEqual(r.issues, [])
})

// ── 深度硬闸（防"标题齐全内容空洞"的浅层蒸馏）──

test('assessCardDepth：空洞但关键词齐全的卡 → 深度分低（浅层卡拦下）', () => {
  const VOID = [
    '身份定位：高管。', '思维模型：很强（跨域复现：有；生成力：有）。', '核心方法论：方法论。',
    '代表作品：作品——只借鉴框架，不冒充署名。', '决策红线：底线。', '语言风格：简洁。',
    '我的协同：本角色位置=上游；依赖=产品给契约；给测试喂接口；升级=CEO。',
    '证据链：著作+对话+表达+他者+决策+时间线。', '保真度：一手0.6；矛盾保留。',
    '诚实边界：信息截止；推测已标。', 'source：https://example.com/fake', '防冒名声明：只借鉴框架，不冒充署名。',
  ].join('\n')
  const d = assessCardDepth(VOID, false)
  assert.ok(d.score < 60, `空洞卡深度分应<60，实际 ${d.score}`)
  assert.ok(d.issues.some((i) => /太空洞/.test(i)), '应指出段内容空洞')
})

test('assessCardDepth：真实感深度卡 → 高分（六段实content+HOW+反例+查证痕迹+真实域）', () => {
  const d = assessCardDepth(GOOD_CEO_CARD, true)
  assert.ok(d.score >= 75, `深度卡应≥75 分，实际 ${d.score}`)
  assert.ok(d.hasHow, '方法论含 HOW 动作链')
  assert.ok(d.dimsCovered >= 5, `证据链维度覆盖 ≥5，实际 ${d.dimsCovered}`)
  assert.ok(d.hasBoundary, '含反例/失效边界')
  assert.ok(d.hasVerifyTrace, '含查证痕迹')
})

test('jarvis_distill：空洞卡 → ok=false（深度闸拦截，不是只看标题）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill')
  const VOID = [
    '身份定位：高管。', '思维模型：很强（跨域复现：有；生成力：有）。', '核心方法论：方法论。',
    '代表作品：作品——只借鉴框架，不冒充署名。', '决策红线：底线。', '语言风格：简洁。',
    '我的协同：本角色位置=上游；依赖=产品给契约；给测试喂接口；升级=CEO。',
    '证据链：著作+对话+表达+他者+决策+时间线。', '保真度：一手0.6；矛盾保留。',
    '诚实边界：信息截止；推测已标。', 'source：https://example.com/fake', '防冒名声明：只借鉴框架，不冒充署名。',
  ].join('\n')
  const r = await def.handler({ role: '公关', card: VOID, isCeo: false })
  assert.strictEqual(r.ok, false, '空洞卡必须拦下')
  assert.ok(r.depthScore !== undefined && r.depthScore < 60, `给出低深度分 ${r.depthScore}`)
})

// ── 蒸馏独特性引导（借鉴 distilly 24k★，捕捉 HOW 而非套模板）──

test('jarvis_distill_guide：输出品味原则/来源分级/黑名单/提炼步骤/验证锚点', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.handler({ role: 'CEO', material: '某访谈原文…', industry: '电商' })
  assert.ok(r.tastePrinciples.length >= 5, '7 品味原则（长文>碎片/争议>共识/变化>固定/一手>二手/失败>成功）')
  assert.ok(r.sourceHierarchy.length >= 4, '来源分级（一手>长访谈>决策>二手）')
  assert.ok(r.sourceBlacklist.some((x) => x.includes('知乎')), '黑名单含知乎')
  assert.ok(r.sourceRecommended.some((x) => x.includes('晚点')), '推荐源含晚点/36氪')
  assert.ok(r.steps.some((x) => x.includes('决策触发词')), '抓决策触发词')
  assert.ok(r.steps.some((x) => x.includes('认知变化轨迹')), '抓认知变化轨迹')
  assert.ok(r.validationAnchors.includes('已知答案测试'), '验证锚点：已知答案测试')
  assert.ok(r.antiGeneric.includes('防通用话术'), '防通用话术')
  assert.ok(r.respondAs.includes('howFingerprints'), '结构化输出要求')
})

test('jarvis_distill_guide：未提供素材 → 提示先查真实权威（不许凭印象编）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.handler({ role: '风控' })
  assert.ok(r.sourceCheck.includes('不许凭印象编'), '提示不可编造')
  assert.ok(r.sourceCheck.includes('web_search'), '提示用 web_search 查证')
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
  const card = GOOD_CEO_CARD.replace('source：https://www.chinastarmarket.cn/article/26317（本次 web 搜索确认该访谈原文，方法论摘自其决策记录段落）', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('source'))
})

test('validateCardShape：缺防冒名不通过', () => {
  const card = GOOD_CEO_CARD.replace('防冒名声明：本角色卡借鉴其公开方法论，非其本人观点。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('防冒名声明'))
})

test('validateCardShape：CEO 缺协同架构不通过', () => {
  const card = GOOD_CEO_CARD.replace('协同架构：位置=与产品增长并行、研发下游；依赖=产品需求与契约、供应链成本；介入时机=从立项全程参与；协同方式=用 send_message 实时讨论，冲突升级 jarvis_review/CEO 裁决（并行非串行）。', '')
  const missing = validateCardShape(card, true)
  assert.ok(missing.includes('协同架构'))
})

test('validateCardShape：普通角色不需协同架构（但需证据链）', () => {
  const card = GOOD_CEO_CARD.replace('协同架构：位置=与产品增长并行、研发下游；依赖=产品需求与契约、供应链成本；介入时机=从立项全程参与；协同方式=用 send_message 实时讨论，冲突升级 jarvis_review/CEO 裁决（并行非串行）。', '')
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
  const bad = GOOD_CEO_CARD.replace('决策红线：虚假规模/刷单/套利冲量一票否决；绕过资金风控底线一票否决；不适用场景：非价格敏感品类。', '')
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

test('identifyIndustry：无领域预设（插件领域无关），只给分级建议', () => {
  const r = identifyIndustry('我要做一个下沉市场拼团电商小程序，2人团24h成团')
  assert.ok(r.industry.includes('CEO 现场判断'), '不应识别具体行业（领域由 CEO 结合项目判断）')
  assert.ok(r.suggestion.includes('L') || r.suggestion.includes('M'), '给出分级建议')
  assert.ok(r.distillDirections.some((d) => d.includes('CEO')), '蒸馏方向由 CEO 按需求特性决定')
})

test('identifyIndustry：短需求给 S 级（不需要建队）', () => {
  const r = identifyIndustry('改个文案')
  assert.ok(r.suggestion.includes('S'), '短需求 S 级')
})

test('/jarvis 命令执行：真实产物含流程/沉淀/蒸馏指令（非占位，无领域预设）', () => {
  const r = jarvisCommand('做一个金融风控系统，要管住资金安全')
  assert.ok(!r.content.includes('行业识别：金融'), '不应预设具体行业（领域无关）')
  assert.ok(r.content.includes('jarvis_distill'), '应包含蒸馏校验指令')
  assert.ok(r.content.includes('jarvis_process'), '应包含领域流程设计指令')
  assert.ok(r.content.includes('.jarvis/'), '应包含项目沉淀指令')
  assert.ok(r.content.includes('60 分诚实'), '应包含女娲式铁律')
})

test('/jarvis 命令执行：同一机制适配任意需求（无行业关键词命中）', () => {
  const r = jarvisCommand('做一个短视频带货直播间运营方案')
  assert.ok(r.content.includes('建议建队等级'), '机制通用')
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
    'source：https://developer.mozilla.org/zh-CN/docs/Web/API（本次 web 检索确认其公开演讲原文，方法论摘自决策记录段落）',
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
    'source：https://developer.mozilla.org/zh-CN/docs/Web/API（本次 web 检索确认其公开演讲原文，方法论摘自决策记录段落）',
    '防冒名声明：只借鉴框架，不冒充署名。',
  ].join('\n')
  const missing = validateCardShape(good, false)
  assert.ok(!missing.some((m) => /我的协同|我的位置|我的依赖|我的升级/.test(m)), '分工明确应通过')
})

// ── 深度思考增强（角色卡 × ponder 轻量七段）──

test('jarvis_think_deep：输出七段对抗式思考任务单（ponder 轻量化）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.handler({ question: '拼团要 2 人还是 3 人成团？', roleCard: '身份定位：产品增长负责人。', stakes: 'medium' })
  assert.ok(r.premises.includes('前提'), '前提审视段')
  assert.ok(r.perspective.includes('第一判断'), '视角展开段')
  assert.ok(r.counter.includes('当X时不成立'), '反方攻击段')
  assert.ok(r.failure.length > 0, '失效推演段')
  assert.ok(r.realityCheck.includes('真实'), '真实优先核对段')
  assert.ok(r.limits.includes('诚实边界'), '诚实边界段')
  assert.ok(r.conclusion.includes('置信度'), '收敛结论段')
  assert.ok(r.respondAs.includes('JSON'), '要求结构化回复')
})

test('jarvis_think_deep：stakes=high 强制更强对抗（反方≥3+可谬自评）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.handler({ question: '是否接入第三方支付？', roleCard: '身份定位：风控负责人。', stakes: 'high' })
  assert.ok(r.counter.includes('至少 3 条'), '高赌注反方≥3')
  assert.ok(r.failure.includes('至少 2 种'), '高赌注失效推演×2')
  assert.ok(r.conclusion.includes('最可能因为什么错'), '高赌注可谬自评')
})

test('jarvis_think_deep：stakes=low 轻量对抗（反方≥1）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.handler({ question: '按钮文案用哪个？', roleCard: '身份定位：产品负责人。', stakes: 'low' })
  assert.ok(r.counter.includes('至少 1 条'), '低赌注反方≥1')
})

test('jarvis_review：传入双方深度思考帧 → analysis 引用反方/真实核对', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  const r = await def.handler({
    issue: '拼团是否允许虚拟拼单凑单？',
    sideA: '允许（增长视角）',
    sideB: '禁止（风控视角）',
    thinkA: JSON.stringify({ counter: ['当用户真实参团率不足时不成立'], realityCheck: ['核对真实参团率数据'], confidence: 'medium', conclusion: '建议允许但限频' }),
    thinkB: JSON.stringify({ counter: ['当风控规则无法拦截虚假身份时不成立'], realityCheck: ['核对黑产样本'], confidence: 'high', conclusion: '禁止' }),
  })
  assert.ok(r.analysis.includes('A 方深度思考'), '引用 A 方思考帧')
  assert.ok(r.analysis.includes('用户真实参团率不足'), 'A 方反方被引用')
  assert.ok(r.analysis.includes('黑产样本'), 'B 方真实核对被引用')
  assert.ok(r.basis.includes('真实情况 > 用户需求 > 专业判断'), '裁判优先级不变')
})

test('jarvis_review：一方缺深度思考帧 → 提示先跑 jarvis_think_deep（防一面之词）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  const r = await def.handler({
    issue: '上线时间',
    sideA: '本周上线',
    sideB: '下周上线',
    thinkA: JSON.stringify({ counter: ['当测试未完成时不成立'], confidence: 'medium' }),
    // thinkB 缺失
  })
  assert.ok(r.analysis.includes('B 方未提供深度思考帧'), '提示 B 方补深度思考')
  assert.ok(r.analysis.includes('jarvis_think_deep'), '指向深度思考器')
})

test('jarvis_review：think 为非法 JSON → 明确提示格式错误', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  const r = await def.handler({ issue: 'x', sideA: 'a', sideB: 'b', thinkA: '不是JSON{{{', thinkB: null })
  assert.ok(r.analysis.includes('不是合法 JSON'), '提示格式错误')
})

// ── 领域流程（CEO 决定流程：插件无领域预设，永远现场定制）──

test('jarvis_process：任何领域都不返回预设模板（插件领域无关，customized 恒 true）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_process')
  for (const req of [
    { industry: '电商', requirement: '下沉市场拼团商城' },
    { industry: '金融', requirement: '量化风控系统' },
    { industry: '医疗', requirement: '问诊平台' },
  ]) {
    const r = await def.handler(req)
    assert.strictEqual(r.customized, true, `${req.industry} 也必须 CEO 现场定制`)
    assert.ok(r.designChecklist.includes('CEO'), '给出设计清单由 CEO 逐项定')
    assert.ok(r.gates.some((g) => g.includes('CEO')), '闸门占位须 CEO 亲手定义')
  }
})

test('jarvis_process：支持参考本项目沉淀（projectRef），但强调按需求修订', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_process')
  const r = await def.handler({ industry: '电商', requirement: '拼团二期', projectRef: '.jarvis/process-拼团一期.json' })
  assert.ok(r.verdict.includes('不预设'), '插件无领域预设')
  assert.ok(r.designChecklist.includes('项目流程沉淀参考'), '提示可参考本项目沉淀')
  assert.ok(r.designChecklist.includes('严禁原样照搬'), '禁止照搬沉淀')
})

test('jarvis_process：overrideStages 增删（CEO 有权改流程）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_process')
  const r = await def.handler({ industry: '软件', requirement: 'x', overrideStages: '+合规审查,-复盘' })
  assert.ok(r.stages.includes('合规审查'), '追加阶段生效')
  assert.ok(!r.stages.includes('复盘'), '删除阶段生效')
})

// ── 项目沉淀（领域无关的"项目资产仓库"，角色卡沉淀在项目里）──

test('jarvis_store：scaffold 输出项目记忆库目录结构（含原型/项目细节，不携带任何静态卡）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  const r = await def.handler({ mode: 'scaffold' })
  assert.ok(r.structure.some((s) => s.includes('cards/')), '记忆库含 cards/（虚拟人物卡）')
  assert.ok(r.structure.some((s) => s.includes('prototypes/')), '记忆库含 prototypes/（真实人物原型）')
  assert.ok(r.structure.some((s) => s.includes('project.md')), '记忆库含 project.md（项目细节快照）')
  assert.ok(r.structure.some((s) => s.includes('lessons.md')), '记忆库含 lessons.md（进度经验）')
  assert.ok(r.reuseRule.includes('插件无静态卡'), '复用规则声明插件无卡')
})

test('jarvis_store：check 阶段零——有记忆直接继续（不用重分析源码），无记忆从零蒸馏', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  // 有记忆（prototypes+cards+project.md）
  const has = await def.handler({ mode: 'check', existingDirs: '["prototypes","cards"]', cards: '研发,产品增长', prototypes: '黄峥', projectMd: 'true' })
  assert.ok(has.verdict.includes('已有记忆库'), '有记忆 → 直接继续')
  assert.ok(has.reuseRule.includes('不用重新分析源码'), '明确不用重分析源码')
  // 无记忆 → 从零蒸馏
  const none = await def.handler({ mode: 'check' })
  assert.ok(none.verdict.includes('无记忆'), '无记忆 → 从零开始')
  assert.ok(none.reuseRule.includes('从零'), '提示从零开始')
})

test('jarvis_store：本项目记忆可复用（须校验+修订），跨项目/插件禁止', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  // 本项目沉淀中存在"研发"卡 → 可复用起点
  const local = await def.handler({ mode: 'reuse', itemType: 'card', name: '研发', existingCards: JSON.stringify([{ role: '研发', file: 'cards/研发.md' }]) })
  assert.ok(local.reuseRule.includes('本项目沉淀'), '本项目沉淀可复用')
  assert.ok(local.reuseRule.includes('jarvis_distill'), '复用须过校验')
  assert.ok(local.reuseRule.includes('修订'), '复用须按新需求修订')
  // 不是本项目沉淀 → 禁止复用
  const cross = await def.handler({ mode: 'reuse', itemType: 'card', name: '某外部大佬', existingCards: JSON.stringify([{ role: '研发' }]) })
  assert.ok(cross.reuseRule.includes('跨项目/插件禁止'), '跨项目/外部禁止复用')
})

test('jarvis_store：save 按类型落盘（prototype→prototypes/、card→cards/、project→project.md、lesson→lessons.md）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  const proto = await def.handler({ mode: 'save', itemType: 'prototype', name: '黄峥', projectDir: '/x/proj/.jarvis/' })
  assert.ok(proto.savePath.includes('prototypes/黄峥.md'), '真实人物原型落盘 prototypes/')
  const card = await def.handler({ mode: 'save', itemType: 'card', name: '产品增长', projectDir: '/x/proj/.jarvis/' })
  assert.ok(card.savePath.includes('cards/产品增长.md'), '虚拟人物卡落盘 cards/')
  assert.ok(card.verdict.includes('项目记忆库'), '明确是项目记忆库')
  const proj = await def.handler({ mode: 'save', itemType: 'project', name: 'project', projectDir: '/x/proj/.jarvis/' })
  assert.ok(proj.savePath.includes('project.md'), '项目细节快照落盘 project.md')
  const les = await def.handler({ mode: 'save', itemType: 'lesson', name: 'lesson', projectDir: '/x/proj/.jarvis/' })
  assert.ok(les.savePath.includes('lesson.md'), '进度经验落盘 lesson.md')
})

// ── 统一黑板（会议驱动协作的状态中枢）──

test('jarvis_board：add 阻塞 → needsMeeting=true；resolve 后收敛', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  let r = await def.handler({ role: '研发', add: '阻塞：支付接口技术绕不开（风控侧字段缺失）' })
  assert.strictEqual(r.needsMeeting, true, '存在阻塞 → 必须二次会')
  assert.ok(r.blockers.length === 1, '阻塞被识别')
  r = await def.handler({ board: JSON.stringify({ items: r.items }), resolve: '支付接口' })
  assert.strictEqual(r.needsMeeting, false, '解决后黑板收敛，不需要开会')
})

test('jarvis_board：未决项≥3 → 建议二次会；决策条目未过 essence → 提示', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  const r = await def.handler({ role: '产品', add: '问题：拼团人数未定\n问题：灰度范围未定\n问题：上线时间未定\n决策：采用固定 2 人团' })
  assert.ok(r.needsMeeting, '未决 4 项 ≥3 → 建议开会')
  assert.ok(r.summary.includes('jarvis_essence'), '决策条目提示需需求本质校验')
  const r2 = await def.handler({ board: JSON.stringify({ items: r.items }), audited: '采用固定 2 人团' })
  assert.ok(!r2.summary.includes('决策条目未过'), '审计后不再提示')
})

// ── 问题上行（不许跳过问题）──

test('jarvis_escalate：完整上报（问题+尝试+风险+决策请求）→ 可上报', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_escalate')
  const r = await def.handler({
    role: '研发',
    problem: '分布式事务无法在两数据库间保持强一致，技术上绕不开',
    attempts: '尝试 TCC/SAGA/本地消息表，均不满足一致性要求',
    risk: '不解决将导致订单与库存数据不一致，资损风险高，影响上线',
    decisionNeeded: '是否允许引入 Seata 或接受最终一致降级',
    urgency: 'high',
  })
  assert.strictEqual(r.ok, true, '完整上报单通过')
  assert.ok(r.record.includes('风险细节'), '记录含风险')
  assert.ok(r.boardEntry.startsWith('阻塞：'), '黑板条目是阻塞类型')
  assert.ok(r.protocol.includes('不许跳过'), '纪律文本在位')
})

test('jarvis_escalate：缺风险细节或决策请求 → 打回（不许空单）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_escalate')
  const r = await def.handler({ role: '研发', problem: '某某问题搞不定' })
  assert.strictEqual(r.ok, false, '空单打回')
  assert.ok(r.missing.some((m) => /风险细节/.test(m)), '提示补风险细节')
  assert.ok(r.missing.some((m) => /决策请求/.test(m)), '提示补决策请求')
})

// ── 能力补足（组件化，防没能力硬装会）──

test('jarvis_capability：无现有无市场 → 自研组件化路径', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_capability')
  const r = await def.handler({ task: '实时风控规则引擎' })
  assert.ok(r.decision.includes('自研'), '走向自研组件化')
  assert.ok(r.decision.includes('luke-jarvis'), '自研要求参照可发布插件模式')
  assert.ok(r.buildNote.includes('组件清单'), '写入组件清单供复用')
  assert.ok(r.honestNote.includes('没有就是没有'), '诚实边界在位')
})

test('jarvis_capability：有市场结果 → 验证要点（防假装找到）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_capability')
  const r = await def.handler({ task: '流程图渲染', marketSearch: 'mermaid 高star' })
  assert.ok(r.verifyNotes.includes('真实存在'), '要求验证真实存在')
  assert.ok(r.verifyNotes.includes('license'), '要求验证 license')
})
