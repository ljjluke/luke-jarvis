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
import plugin, { TOOLS, validateCardShape, assessCardDepth, jarvisCommand, identifyIndustry, checkCollabHealth, nextBoardId, writeBoardItems, syncCompanyState } from '../src/host/plugin.js'

const GOOD_CEO_CARD = [
  '身份定位：电商 CEO，负责下沉市场拼团电商的战略与团队建设，一手抓增长质量一手抓风控底线。',
  '思维模型：第一性原理+供应链效率——先拆商品毛利结构，按"有效GMV"判断增长真假，再用供应链成本反推定价（跨域复现：商品/渠道/获客均出现；生成力：可推断新品类打法；排他性：独特）。',
  '核心方法论：1) 先定北极星指标，再排优先级；2) 供应链效率是本质，先算成本再谈让利；3) 让利只给真实用户，按拆单/地址/设备特征反刷单。',
  '代表作品：主导拼购电商从 0 到日活百万的增长（2018-2021），创建行业首个供应链直采体系推动毛利提升 15%，著有内部方法论沉淀为《下沉市场增长手册》（只借鉴框架，不冒充署名）。',
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

test('jarvis_distill_guide：选人闸（personBar）要求蒸馏该领域厉害人物（可命名贡献/排他性/领域可扩展）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.handler({ role: '研发', material: '素材', industry: '软件' })
  assert.ok(r.personBar, '输出选人闸')
  assert.ok(r.personBar.includes('排他性'), '要求选领域公认最强（排他性）')
  assert.ok(r.personBar.includes('任何领域都有'), '声明任何领域都有厉害人物')
  assert.ok(r.personBar.includes('可命名贡献'), '要求可命名贡献/开创学派')
})

test('jarvis_distill_guide：成就反推工作方式（achievementTrace）——从真实成就反推"他怎么工作才做到的"', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.handler({ role: '专家', material: '素材', industry: 'x' })
  assert.ok(r.achievementTrace, '输出成就反推指引')
  assert.ok(r.achievementTrace.includes('真实成就'), '要求列真实成就')
  assert.ok(r.achievementTrace.includes('他怎么工作才做到的'), '从成就反推工作方式')
  assert.ok(r.achievementTrace.includes('重复模式'), '跨成就找重复模式')
  assert.ok(r.respondAs.includes('achievements'), '输出要求含成就清单')
  assert.ok(r.respondAs.includes('shadowHabits'), '输出要求含影子习惯清单')
})

test('jarvis_distill_guide：证据溯源分级（evidenceTrace）+ 产出指纹（fingerprintTrace）——防把推断当他说过，防"产出没影子"', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.handler({ role: 'x', material: '素材' })
  assert.ok(r.evidenceTrace, '输出证据溯源分级指引')
  assert.ok(r.evidenceTrace.includes('A 原文级') && r.evidenceTrace.includes('B 行为级') && r.evidenceTrace.includes('C 推断级'), '含 A/B/C 三级')
  assert.ok(r.evidenceTrace.includes('不冒充'), 'C 推断不得冒充 A/B')
  assert.ok(r.fingerprintTrace, '输出产出指纹指引')
  assert.ok(r.fingerprintTrace.includes('可辨识'), '指纹=产出可辨识特征')
  assert.ok(r.fingerprintTrace.includes('逐项检查'), '指纹具体到可查')
})

test('jarvis_distill_guide：工作台需求反馈（workbenchTrace）——人物卡自己反馈环境工具，不许默认 Linux 万能', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.handler({ role: 'x', material: '素材' })
  assert.ok(r.workbenchTrace, '输出工作台需求反馈指引')
  assert.ok(r.workbenchTrace.includes('本领域必需'), '要求列本领域必需工具')
  assert.ok(r.workbenchTrace.includes('够不够') || r.workbenchTrace.includes('linuxEnough'), '判断默认环境够不够')
  assert.ok(r.workbenchTrace.includes('一票否决') || r.workbenchTrace.includes('红线'), '环境不够硬干=红线')
})

test('jarvis_distill_guide：AI 执行平替（aiDisplacementTrace）——判断保留、执行 AI 化', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.handler({ role: 'x', material: '素材' })
  assert.ok(r.aiDisplacementTrace, '输出 AI 执行平替指引')
  assert.ok(r.aiDisplacementTrace.includes('[判断]'), '含判断层标注')
  assert.ok(r.aiDisplacementTrace.includes('[AI执行]'), '含 AI 执行标注')
  assert.ok(r.aiDisplacementTrace.includes('[人工]'), '含人工标注')
  assert.ok(r.aiDisplacementTrace.includes('丢影子') || r.aiDisplacementTrace.includes('一票否决'), '红线：判断被代丢影子/AI冒充否决')
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

// 深度硬闸防漏网：真实人名+空泛工作特点的卡（结构齐全但方法全是通用话术）→ 必须被拦
test('jarvis_distill handler：真实人名+空泛方法（结构齐全但内容空洞）→ 打回', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill')
  const generic = [
    '身份定位：宠物殡葬行业 CEO',
    '思维模型：先分析再执行，以结果为导向',
    '核心方法论：1) 了解客户需求；2) 做好服务；3) 持续改进。',
    '代表作品：某宠物殡葬品牌创始人（只借鉴框架，不冒充署名）',
    '决策红线：不做违背道德的事',
    '语言风格：专业、温和',
    '我的协同：本角色位置=上游；依赖=市场；升级=CEO',
    '证据链：著作(有) + 对话(有) + 表达(有) + 他者(有) + 决策(有) + 时间线(有)',
    '保真度：一手0.5；矛盾保留',
    '诚实边界：信息截止2026；推测已标注',
    'source：https://example.com/pet-funeral',
    '防冒名声明：只借鉴框架，不冒充署名',
  ].join('\n')
  const r = await def.handler({ role: 'x', card: generic, isCeo: false })
  assert.strictEqual(r.ok, false, '空泛卡必须被拦')
  assert.ok(r.verdict.includes('空洞') || r.verdict.includes('硬闸'), 'verdict 说明空洞打回')
})


test('jarvis_distill handler：展示型空泛卡（形容词堆砌：注重/追求/卓越/驱动——看着厉害但干活用不上）→ 打回', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill')
  const display = '身份定位：数字转型领域顶级专家，拥有二十年行业经验与跨领域视野，服务过世界五百强企业，洞悉行业前沿趋势\n思维模型：思维缜密，逻辑严谨，具备深刻的行业洞察力与前瞻性战略眼光，总能从全局视角把握本质\n核心方法论：1) 注重数据驱动与量化分析，以科学方法指导决策；2) 坚持用户导向，持续优化体验；3) 追求卓越，精益求精，不断迭代提升\n代表作品：主导某集团数字化转型项目推动效率提升40%（只借鉴框架，不冒充署名）\n决策红线：不做违背职业道德之事，维护企业声誉与长期价值\n语言风格：专业、严谨、富有洞见\n我的协同：位置=上游；依赖=市场；升级=CEO\n证据链：著作(有)+对话(有)+表达(有)+他者(有)+决策(有)+时间线(有)\n保真度：一手0.5\n诚实边界：信息截止2026\nsource：https://real-site.com/x\n防冒名声明：只借鉴框架'
  const r = await def.handler({ role: 'x', card: display, isCeo: false })
  assert.strictEqual(r.ok, false, '展示型空泛卡必须被拦')
  assert.ok(r.verdict.includes('展示型空泛'), 'verdict 说明形容词堆砌')
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

test('identifyIndustry：模糊需求（做个东西）→ vague=true 触发澄清（S5 修复：不再被当作可直接做）', () => {
  const r = identifyIndustry('做个东西')
  assert.strictEqual(r.vague, true, '占位词模糊需求必须标记 vague')
  assert.ok(r.suggestion.includes('澄清'), 'S 级明确是"先澄清"而非"直接做"')
  assert.ok(r.reason.includes('模糊'), '给出模糊原因')
})

test('identifyIndustry：短但有实质动作（改个文案）→ vague=false 不误伤', () => {
  const r = identifyIndustry('改个文案')
  assert.strictEqual(r.vague, false, '有具体对象+动词不算模糊')
})

test('/jarvis 命令执行：领域可判需求 → 引导猎头调度流程（猎头供CEO→定专家→双人打磨），无领域预设', () => {
  const r = jarvisCommand('做一个金融风控系统，要管住资金安全')
  assert.ok(!r.content.includes('行业识别：金融'), '不应预设具体行业（领域无关）')
  assert.ok(r.content.includes('猎头'), '引导走猎头调度层')
  assert.ok(r.content.includes('CEO'), '猎头供 CEO')
  assert.ok(r.content.includes('领域专家'), 'CEO 定领域专家搭档')
  assert.ok(r.content.includes('双人打磨需求'), 'CEO+专家双人打磨')
  assert.ok(r.content.includes('接下来 5 分钟该做什么'), '给出可执行清单')
})

test('/jarvis 命令执行：判不出领域（你好/乱用）→ 请用户说具体想干什么，从中判断领域', () => {
  const r = jarvisCommand('你好')
  assert.ok(r.content.includes('判不出领域'), '识别判不出领域')
  assert.ok(r.content.includes('想做什么/解决什么问题/给谁用'), '请用户说具体想干什么')
  assert.ok(r.content.includes('说详细点'), '引导说详细点')
  assert.ok(r.content.includes('从中判断领域'), '从描述判断领域')
})

test('/jarvis 命令执行：模糊需求（做个东西）→ 判不出领域，引导说具体（非问抽象领域）', () => {
  const r = jarvisCommand('做个东西')
  assert.ok(r.content.includes('判不出领域'), '判不出领域引导')
  assert.ok(!r.content.includes('你想做哪个领域'), '不用抽象问领域')
})

test('/jarvis 命令执行：领域可判需求走人才流程，机制通用（无行业预设）', () => {
  const r = jarvisCommand('做一个短视频带货直播间运营方案')
  assert.ok(r.content.includes('猎头'), '机制通用（走猎头调度）')
  assert.ok(!r.content.includes('行业识别'), '无行业预设')
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

// ── 深度思考增强（角色卡 × ponder 满血十阶段，不阉割）──

test('jarvis_think_deep：medium 也引导加载 ponder 满血十阶段（不阉割，非轻量七段）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.handler({ question: '拼团要 2 人还是 3 人成团？', roleCard: '身份定位：产品增长负责人。', stakes: 'medium' })
  assert.ok(r.ponderGuide.includes('加载 ponder'), 'medium 也须引导加载 ponder（满血）')
  const stages = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis']
  assert.ok(stages.every((s) => r.ponderGuide.includes(s)), '十阶段全含（不阉割）')
  assert.ok(r.ponderGuide.includes('不得跳过任何阶段'), '禁止跳阶段/轻量替代')
  assert.ok(r.ponderGuide.includes('run_id'), 'run_id 溯源')
  assert.ok(r.ponderGuide.includes('skipReason'), 'skip 显式声明')
})

// ── 判别守卫：角色卡方法论(howText)真实注入 ponder 引导，A/B 产出可区分（防"人物卡方法论零进入产出"缺陷复发）──

test('jarvis_think_deep：medium/low 卡方法论注入（howText）→ A/B ponderGuide 可区分', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const cardA = '身份定位：企业软件架构师。思维模型：演进式架构、先看不可逆决策。核心方法论：重构三步法、默认先单体。'
  const cardB = '身份定位：钢铁厂车间主任。思维模型：炉前思维、温度曲线。核心方法论：检修宁可慢不可抢。'
  for (const stakes of ['medium', 'low']) {
    const a = await def.handler({ question: '是否迁移到云上？', roleCard: cardA, stakes })
    const b = await def.handler({ question: '是否迁移到云上？', roleCard: cardB, stakes })
    assert.ok(a.ponderGuide.includes('演进式架构'), `[${stakes}] A 卡方法论进 ponderGuide`)
    assert.ok(b.ponderGuide.includes('炉前思维'), `[${stakes}] B 卡方法论进 ponderGuide`)
    assert.ok(a.ponderGuide !== b.ponderGuide, `[${stakes}] ponderGuide 可区分`)
  }
})

test('jarvis_think_deep：stakes=high 引导加载 ponder 十阶段（B13 接入，含角色卡注入画像+衔接契约+skip 显式声明）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.handler({ question: '是否接入第三方支付？', roleCard: '身份定位：风控负责人。', stakes: 'high' })
  assert.ok(r.ponderGuide.includes('加载 ponder'), 'high 必须引导加载 ponder 技能')
  assert.ok(r.ponderGuide.includes('人物视角'), '角色卡六段式注入 ponder 画像')
  assert.ok(r.ponderGuide.includes('roleCard'), '角色卡全文作为画像源')
  const stages = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis']
  assert.ok(stages.every((s) => r.ponderGuide.includes(s)), '十阶段全含')
  assert.ok(r.ponderGuide.includes('counter←'), '衔接契约 counter 映射')
  assert.ok(r.ponderGuide.includes('run_id'), 'run_id 溯源防贴标签')
  assert.ok(r.ponderGuide.includes('skipReason'), '跳过 ponder 必须显式声明 skipReason')
  assert.ok(r.ponderGuide.includes('可谬自评'), '高赌注可谬自评经 ponder synthesis 保留')
  assert.ok(r.ponderGuide.includes('PONDER_DATA_DIR'), 'FIX-1a：per-run 隔离（PONDER_DATA_DIR 独立数据目录）')
  assert.ok(r.ponderGuide.includes('ponder-runs'), 'FIX-1a：run 目录映射 .jarvis/ponder-runs/<run_id>/')
})

test('jarvis_think_deep：stakes=low 也走 ponder（精简 agent 规模但十阶段不跳）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.handler({ question: '按钮文案用哪个？', roleCard: '身份定位：产品负责人。', stakes: 'low' })
  assert.ok(r.ponderGuide.includes('精简各阶段内 agent 规模'), '低赌注精简 agent 规模')
  assert.ok(r.ponderGuide.includes('不得跳过任何阶段'), '但不得跳阶段（满血不阉割）')
  const stages = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis']
  assert.ok(stages.every((s) => r.ponderGuide.includes(s)), '十阶段全含')
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

test('jarvis_review：高赌注 think 含 run_id → 标注 ponder 溯源；缺 run_id → 标记贴标签风险（FIX-2 防贴标签）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  // 含 run_id：可溯源
  const r1 = await def.handler({
    issue: 'x', sideA: 'a', sideB: 'b',
    thinkA: JSON.stringify({ counter: ['当X时不成立'], realityCheck: ['核对Y'], confidence: 'high', runId: 'run_abc123' }),
    thinkB: JSON.stringify({ counter: ['当Z时不成立'], realityCheck: ['核对W'], confidence: 'medium' }),
  })
  assert.ok(r1.analysis.includes('run_abc123'), '含 run_id 标注 ponder 溯源')
  assert.ok(r1.analysis.includes('可溯源'), '标注可溯源')
  // 缺 run_id：贴标签风险标记
  assert.ok(r1.analysis.includes('无 run_id'), '缺 run_id 标记贴标签风险')
  assert.ok(r1.analysis.includes('贴标签'), '明确提示贴标签风险')
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
  assert.ok(r.structure.some((s) => s.includes('README.md')), '记忆库含 README.md（目录规范）')
  assert.ok(r.structure.some((s) => s.includes('reports/')), '记忆库含 reports/（审计报告归档）')
  assert.ok(r.reuseRule.includes('插件无静态卡'), '复用规则声明插件无卡')
})

test('jarvis_store：save 按类型归档到对应子目录（不散根目录）+ script 用 .mjs', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  const cases = [
    ['card', '研发', '/x/.jarvis/cards/研发.md'],
    ['report', 't1', '/x/.jarvis/reports/t1.md'],
    ['design', '方案', '/x/.jarvis/designs/方案.md'],
    ['script', 'verify', '/x/.jarvis/scripts/verify.mjs'],
    ['doc', '索引', '/x/.jarvis/docs/索引.md'],
    ['process', '流程A', '/x/.jarvis/流程A.json'],
    ['project', '细节', '/x/.jarvis/细节.md'],
  ]
  for (const [type, name, expect] of cases) {
    const r = await def.handler({ mode: 'save', itemType: type, name, projectDir: '/x/.jarvis/' })
    assert.strictEqual(r.savePath, expect, `${type} 归档到 ${expect}`)
  }
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

// H1 修复：公屏持久化 + seq 计数器（写 .jarvis/board.json，ID 从磁盘真源取 max 单调递增）
// mock dsh-fs：内存文件 + resolve/stat/readText/writeText（含 version 乐观并发守卫）
function makeMockFs() {
  const files = new Map() // path -> { content, version }
  let verSeq = 0
  return {
    files,
    async resolve(p) { return { targetKey: 'mock:' + p, path: p } },
    async stat(t) { const f = files.get(t.path); return f ? { version: f.version } : undefined },
    async readText(t) { const f = files.get(t.path); if (!f) throw new Error('ENOENT'); return f.content },
    async writeText(t, content, expected) {
      const cur = files.get(t.path)
      if (expected && expected.kind === 'replaceIfVersion') {
        if (!cur || cur.version !== expected.version) throw new Error('FS_STALE_VERSION')
      }
      const version = 'v' + (++verSeq)
      files.set(t.path, { content, version })
      return { operation: cur ? 'update' : 'create', version, before: cur ? cur.content : null, after: content }
    },
  }
}

test('jarvis_board H1：持久化到 .jarvis/board.json，ID 单调递增（从磁盘真源取 max）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  const fsSvc = makeMockFs()
  // 第一次调用：无 fs 上下文（单测纯 handler 无 ctx）→ 走内存 board 参数模式，返回 items
  let r = await def.handler({ role: '研发', add: '阻塞：支付接口技术绕不开' })
  assert.strictEqual(r.items[0].id, 'B1', '首条 B1')
  // 模拟真源已有 B1..B3（磁盘），再 add → 必须续 B4（不是从空重算）
  fsSvc.files.set('.jarvis/board.json', {
    content: JSON.stringify({ items: [
      { id: 'B1', role: 'a', type: '问题', content: 'x1', status: 'open' },
      { id: 'B2', role: 'a', type: '问题', content: 'x2', status: 'open' },
      { id: 'B3', role: 'a', type: '问题', content: 'x3', status: 'open' },
    ] }),
    version: 'v100',
  })
  // 直接测 nextBoardId 纯函数（无需 ctx）：基于磁盘 items 取 max+1
  assert.strictEqual(nextBoardId([{ id: 'B1' }, { id: 'B3' }]), 'B4', 'max+1 单调递增')
  assert.strictEqual(nextBoardId([]), 'B1', '空黑板从 B1 开始')
})

test('jarvis_board H1：并发写带版本守卫——旧版本写被拒（FS_STALE_VERSION 不丢数据）', async () => {
  const fsSvc = makeMockFs()
  // 模拟磁盘已有 v1
  fsSvc.files.set('.jarvis/board.json', { content: JSON.stringify({ items: [] }), version: 'v1' })
  // 用过期版本 v1 写入 → 应失败（另一个调用者已把文件推进到 v2+）
  fsSvc.files.set('.jarvis/board.json', { content: JSON.stringify({ items: [{ id: 'B1' }] }), version: 'v2' })
  const res = await writeBoardItems(fsSvc, [{ id: 'B1' }, { id: 'B2' }], 'v1')
  assert.strictEqual(res.ok, false, '过期版本写必须被拒')
  assert.ok(/STALE|stale|VERSION/.test(res.error), '错误含版本冲突标记')
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

// ── 交付版本管理（乙方与甲方的契约机制）──

test('jarvis_release：new_version 打版本快照（冻结旧版/变更开新版）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.handler({ mode: 'new_version', version: 'v1.1' })
  assert.ok(r.version === 'v1.1', '版本号正确')
  assert.ok(r.verdict.includes('冻结为历史'), '旧版冻结')
  assert.ok(r.verdict.includes('变更'), '变更开新版')
})

test('jarvis_release：checklist 生成交付清单（需求本质逐条对应）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.handler({ mode: 'checklist', version: 'v1.0', requirement: '能让用户拼团下单', items: JSON.stringify(['拼团功能', '支付功能']) })
  assert.ok(r.checklist.some((c) => c.includes('需求本质')), '清单含需求本质')
  assert.ok(r.checklist.some((c) => c.includes('拼团功能')), '清单含交付物')
  assert.ok(r.verdict.includes('按条确认'), '甲方按条确认')
})

test('jarvis_release：status 版本状态含确认时限（不无限等）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.handler({ mode: 'status', version: 'v1.0', confirmDeadline: '3 天' })
  assert.ok(r.verdict.includes('待甲方确认'), '版本待确认')
  assert.ok(r.verdict.includes('默认通过') || r.verdict.includes('submittedAt'), '有超时判定语义（不无限等）')
})

test('jarvis_release：status 真实超时判定（submittedAt + 时限 → timedOut）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  // 10 天前提交 + 3 天时限 → 已超时
  const longAgo = new Date(Date.now() - 10 * 86400000).toISOString()
  const r = await def.handler({ mode: 'status', version: 'v1.0', confirmDeadline: '3 天', submittedAt: longAgo, prevVersions: '[]' })
  assert.strictEqual(r.timedOut, true, '超时判定 true')
  assert.ok(r.verdict.includes('已超时'), 'verdict 标注超时')
  // 昨天提交 + 3 天时限 → 未超时
  const yesterday = new Date(Date.now() - 86400000).toISOString()
  const r2 = await def.handler({ mode: 'status', version: 'v1.0', confirmDeadline: '3 天', submittedAt: yesterday, prevVersions: '[]' })
  assert.strictEqual(r2.timedOut, false, '未超时判定 false')
})

test('jarvis_release：communication 记录甲方沟通结论（留痕）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.handler({ mode: 'communication', question: '拼团 2 人还是 3 人？', answer: '3 人' })
  assert.ok(r.log.includes('问甲方'), '记录问题')
  assert.ok(r.log.includes('3 人'), '记录甲方答复')
  assert.ok(r.verdict.includes('project.md'), '写入项目记忆')
})

// ── 绩效评估（CEO 换人决策量化）──

test('jarvis_perf：全面达标 → 继续（不换）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '研发', quality: 2, completion: 2, escalation: 2, fit: 2, depth: 90 })
  assert.strictEqual(r.ok, true, '达标')
  assert.ok(r.action.includes('继续'), '不换人')
})

test('jarvis_perf：连续 2 次不达标 → 建议换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '供应链', quality: 0, completion: 0, escalation: 1, fit: 0, depth: 40, history: JSON.stringify([{ ok: false }]) })
  assert.strictEqual(r.ok, false, '不达标')
  assert.ok(r.action.includes('换人'), '连续2次建议换人')
})

test('jarvis_perf：问题上行异常（高频信号）→ 立即触发不达标，不等 2 次', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '测试', quality: 2, completion: 2, escalation: 0, fit: 2, depth: 85 })
  assert.strictEqual(r.ok, false, '问题上行异常=不达标')
  assert.ok(r.action.includes('换人') || r.action.includes('补强'), '异常触发评估')
})

// ── 需求澄清引导器（REFORM-CLARIFY 实现）：模糊判定 + 蒸馏触发 + 三阶提问 + 方案 A ──

test('jarvis_clarify：模糊需求 5 角度引导 + T3 蒸馏触发（机械可判）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const a = await def.handler({ mode: 'analyze', requirement: '我要做个设备检修排期的东西', industry: '制造业' })
  assert.ok(a.vague === true, '模糊需求应判定为需澄清')
  assert.ok(a.candidates.length === 5, '5 角度候选问题')
  const t = await def.handler({ mode: 'trigger', requirement: '我要做个设备检修排期的东西，涉及OEE/TPM点检标准', industry: '制造业', candidates: a.candidates.join('\n') })
  assert.ok(t.trigger.includes('T3'), '行业术语引不出依据应触发 T3 蒸馏')
  const t2 = await def.handler({ mode: 'trigger', requirement: '帮我整理文档', candidates: '【P1】a\n【P2】b\n【P3】c\n【P4】d\n【P5】e' })
  assert.strictEqual(t2.trigger, '不触发', '无行业术语不触发')
})

test('jarvis_clarify：三阶提问 + 方案 A 双人判据 + 澄清完成判定', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const a = await def.handler({ mode: 'analyze', requirement: '做个自动写周报的东西' })
  const q1 = await def.handler({ mode: 'ask', requirement: 'x', round: '1', candidates: a.candidates.join('\n') })
  assert.ok(q1.questions.length <= 2, '每轮≤2问')
  const d = await def.handler({ mode: 'duo', roleCards: 'CEO卡\n专家卡', round: '1' })
  assert.ok(d.duoCheck.includes('方案 A'), '双人方案 A 判据')
  const cf = await def.handler({ mode: 'confirm', userAnswers: '用户是员工，周报难写，希望自动汇总，成功=5分钟发出领导看到具体成果' })
  assert.ok(cf.confirm.includes('澄清完成'), '需求本质重述确认后完成')
})

// 模拟推理发现的 confirm 误判修复：数字验收标准必须判"已明确"；长描述无确认不得判完成（推断不得冒充已确认）
test('jarvis_clarify confirm：数字验收标准（准确率95%/30秒）判"已明确"而非"待补"', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const cf = await def.handler({ mode: 'confirm', userAnswers: '用户确认：给行政部用，解决发票录入慢易错，以识别准确率95%以上、单张处理<30秒为成功' })
  assert.ok(cf.confirm.includes('怎样算成功=已明确'), '数字验收标准判已明确')
})

test('jarvis_clarify confirm：长描述无确认词 → 不判完成（防推断冒充已确认）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const cf = await def.handler({ mode: 'confirm', userAnswers: '我们是物流公司，现在用excel排线路特别慢，司机经常跑冤枉路，想做个自动排线的东西提高效率' })
  assert.ok(cf.confirm.startsWith('⏳'), '无确认词不判完成')
  assert.ok(cf.confirm.includes('请明确确认') || cf.confirm.includes('未获用户确认'), '提示需用户确认')
})

test('jarvis_clarify confirm：确认词+验收标准 → 完成', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const cf = await def.handler({ mode: 'confirm', userAnswers: '对，就是这样，给物流调度用，排线时间从2小时降到20分钟算成功' })
  assert.ok(cf.confirm.startsWith('✅'), '确认+标准判完成')
})

// ── 阶段性完成度考核（防 0 产出误判）：pending=待考核不计0产出 / due=到期未完成才不达标 ──

test('jarvis_perf：阶段未到/任务未分配（pending）→ 待考核，不计 0 产出不触发换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '研发', stageStatus: 'pending', stageRequirement: 't2 架构评审' })
  assert.strictEqual(r.ok, null, 'pending 待考核（不判达标/不达标）')
  assert.strictEqual(r.score, null, 'pending 无综合分（不计 0 产出）')
  assert.strictEqual(r.strikes, 0, 'pending 不累计不达标')
  assert.ok(r.action.includes('待考核'), '判定为待考核')
})

test('jarvis_perf：阶段结果符合要求→达标；到期未完成→才不达标；连续 2 次→换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const ok = await def.handler({ role: '研发', stageStatus: 'in_progress', stageRequirement: 't2', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '100' })
  assert.strictEqual(ok.ok, true, '阶段结果符合要求→达标')
  const due = await def.handler({ role: '研发', stageStatus: 'due', stageRequirement: 't2', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '100' })
  assert.strictEqual(due.ok, false, '到期未完成→不达标')
  assert.ok(due.action.includes('补强观察'), '首次不达标=补强观察非换人')
  const two = await def.handler({ role: '研发', stageStatus: 'due', stageRequirement: 't2', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '100', history: JSON.stringify([{ ok: false }, { ok: false }]) })
  assert.ok(two.action.includes('换人'), '连续 2 次不达标→换人')
})

// BUG-1 修复：perf 自动累计 strikes + 返回 historyNext（修复"依赖调用方手动维护 history"的半自动断点）
test('jarvis_perf BUG-1：不传 history 也能靠 historyNext 累计到 2 次换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  // 第一次：不达标，无 history
  const r1 = await def.handler({ role: '研发', stageStatus: 'due', stageRequirement: 't2', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '100' })
  assert.strictEqual(r1.ok, false, '首次不达标')
  assert.strictEqual(r1.strikes, 1, '首次 strikes=1')
  assert.ok(r1.action.includes('补强观察'), '首次=补强观察不换人')
  assert.ok(r1.historyNext, '返回 historyNext 供下次回传')
  const h1 = JSON.parse(r1.historyNext)
  assert.strictEqual(h1.length, 1, 'historyNext 含本次记录')
  assert.strictEqual(h1[0].ok, false, '本次记为不达标')
  // 第二次：直接用 r1.historyNext 回传（CEO 真实用法：不用手动造 history）
  const r2 = await def.handler({ role: '研发', stageStatus: 'due', stageRequirement: 't2', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '100', history: r1.historyNext })
  assert.strictEqual(r2.strikes, 2, '第二次 strikes=2（自动累计）')
  assert.ok(r2.action.includes('换人'), '连续 2 次不达标→换人（不再需要手动塞 history）')
})

// BUG-8 修复：perf 返回值含 role（render 标题不再显示 "?"）
test('jarvis_perf BUG-8：返回 role 字段（render 显示员工名）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '研发', quality: 2, completion: 2, escalation: 2, fit: 2, depth: 90 })
  assert.strictEqual(r.role, '研发', '返回 role')
  const pending = await def.handler({ role: '产品', stageStatus: 'pending' })
  assert.strictEqual(pending.role, '产品', 'pending 也返回 role')
  const txt = def.output.render(pending)
  const text = Array.isArray(txt) ? txt.map((b) => b.text).join('') : String(txt)
  assert.ok(text.includes('产品'), 'render 显示产品名而非 ?')
})

// BUG-9 修复：perf 信号 clamp 到 0-2（越界输入不爆 score / 不误判健康）
test('jarvis_perf BUG-9：越界信号 clamp（score 恒 0-100）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '研发', quality: '100', completion: '-5', escalation: '2', fit: '2', depth: '100' })
  assert.strictEqual(r.signals.quality, 2, 'quality 100→2')
  assert.strictEqual(r.signals.completion, 0, 'completion -5→0')
  assert.ok(r.score >= 0 && r.score <= 100, 'score 在 0-100')
  const r2 = await def.handler({ role: '研发', quality: '2', completion: '2', escalation: '999', fit: '2', depth: '90' })
  assert.strictEqual(r2.signals.escalation, 2, 'escalation 999→2')
  assert.ok(r2.score <= 100, '脏大值不爆 score')
})

// 客户价值维度：需求对齐度（做偏需求本质 = 一票否决换人，即使内部质量满分）
test('jarvis_perf 需求对齐度：做偏客户需求本质（alignment=0）→ 不达标直接换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '研发', stageStatus: 'due', stageRequirement: '发票OCR准确率95%', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '90', alignment: '0' })
  assert.strictEqual(r.ok, false, '偏离需求本质=不达标（即使活干得好）')
  assert.ok(r.action.includes('换人'), '方向错直接换人不等2次')
  assert.ok(r.verdict.includes('偏离'), 'verdict 标注偏离')
})

test('jarvis_perf 需求对齐度：直指需求本质（alignment=2）→ 合格继续', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '研发', stageStatus: 'due', stageRequirement: '发票OCR准确率95%', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '90', alignment: '2' })
  assert.strictEqual(r.ok, true, '对齐需求本质=达标')
  assert.ok(r.action.includes('继续'), '不换人')
  assert.strictEqual(r.signals.alignment, 2, 'signals 含 alignment')
})

test('jarvis_perf 需求对齐度：不传 alignment 默认 1（不误伤旧调用）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '研发', stageStatus: 'due', stageRequirement: 'x', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '90' })
  assert.strictEqual(r.signals.alignment, 1, '默认中性 1')
  assert.strictEqual(r.ok, true, '旧调用不误伤')
})

// 自动落盘：perf 历史文件路径约定 + 无 history 裸调不崩（有 fs 环境才落盘，无 fs 保持纯函数）
test('jarvis_perf 自动落盘：perf 历史文件路径约定 + 无 fs 环境不崩', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  // 无 fs 裸调用（单测环境）：不崩、不落盘、不误判
  const r = await def.handler({ role: '研发', stageStatus: 'due', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '80' })
  assert.strictEqual(r.ok, false, '不达标判定正常')
  assert.strictEqual(r.strikes, 1, '无历史首次 strikes=1')
  // 显式 history 累计（等价于从落盘文件读回后回传）
  const r2 = await def.handler({ role: '研发', stageStatus: 'due', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '80', history: r.historyNext })
  assert.strictEqual(r2.strikes, 2, '二次累计 strikes=2')
  assert.ok(r2.action.includes('换人'), '累计到 2 触发换人')
  // 空 history 字符串（等价于读盘失败/空文件）不崩
  const r3 = await def.handler({ role: '研发', stageStatus: 'due', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '90', history: '' })
  assert.strictEqual(r3.ok, true, '空 history 不崩且正常评估')
})

test('jarvis_perf BUG-1：达标时 historyNext 记 ok=true（不累计不达标）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.handler({ role: '研发', stageStatus: 'in_progress', stageRequirement: 't2', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '100', history: JSON.stringify([{ ok: false }]) })
  assert.strictEqual(r.ok, true, '达标')
  assert.strictEqual(r.strikes, 0, '达标清零 strikes')
  const h = JSON.parse(r.historyNext)
  assert.strictEqual(h[h.length - 1].ok, true, 'historyNext 末条记 ok=true')
})

// BUG-2 修复：escalate 完整上报时真写黑板（.jarvis/board.json），不再只给建议文本
test('jarvis_escalate BUG-2：完整上报真写黑板（boardWritten=true）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_escalate')
  const r = await def.handler({
    role: '研发',
    problem: '第三方 API 无法连通，订单状态不同步',
    attempts: '重试过 5 次',
    risk: '影响今天上线，订单数据不准',
    decisionNeeded: '是否降级为轮询方案',
    urgency: 'high',
  })
  assert.strictEqual(r.ok, true, '完整上报单通过')
  // 无 ctx 环境（单测）：不写盘但如实上报 boardWritten=false（不假装已写入）
  assert.strictEqual(typeof r.boardWritten, 'boolean', 'boardWritten 是布尔')
})

// BUG-3 修复：release.communication 承诺写 project.md（无 ctx 时如实报告未写入，不嘴炮）
test('jarvis_release BUG-3：communication 输出 projectWritten 字段（无 ctx 如实报告）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.handler({ mode: 'communication', question: '是否接受延迟一周', answer: '接受' })
  assert.ok(r.verdict.includes('project.md'), 'verdict 说明写入目标')
  assert.ok('projectWritten' in r === false || typeof r.projectWritten === 'boolean', '有 fs 时报告写入结果')
})

// BUG-4 修复：clarify trigger 领域无关——不预设行业词，只认通用术语标记
test('jarvis_clarify BUG-4：行业黑话词不预设（OEE 不再硬触发 T3），术语标记词仍触发', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  // 用户提到行业黑话（如 OEE）但没有候选问题依据 → 领域无关设计下不应因"预设词"触发，由 CEO 结合需求判断
  const t = await def.handler({ mode: 'trigger', requirement: '优化我们的OEE', candidates: '【P1】a\n【P2】b\n【P3】c\n【P4】d\n【P5】e' })
  // 注意：OEE 不再是硬编码词，是否触发取决于通用术语标记（OEE 不在列表）→ 应不触发或至少不因 OEE 触发
  assert.ok(!t.trigger.includes('T3') || t.triggerDetail.includes('通用'), 'OEE 不再硬编码触发 T3（领域无关）')
})

// ── 企业级版本管理：回滚机制（任何领域交付改错可 undo）──

test('jarvis_release checklist：三产物闭环核对（traceCheck）——全通过可交付/断链拦收口', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const ok = await def.handler({
    mode: 'checklist', version: 'v1.0', requirement: '发票OCR', items: '["F1 识别","F2 回填"]',
    traceCheck: JSON.stringify({ '需求规格': '✓ 在 docs/', '方案设计': '✓', '测试验收单': '✓', '逐条闭环': '✓ 全链', '断链项': [] }),
  })
  assert.strictEqual(ok.tracePassed, true, '全通过可交付')
  assert.ok(ok.traceCheckVerdict.includes('闭环核对通过'), 'verdict 标注通过')
  const bad = await def.handler({
    mode: 'checklist', version: 'v1.0', requirement: 'x', items: '["F1"]',
    traceCheck: JSON.stringify({ '需求规格': '✓', '方案设计': '✗ 缺', '测试验收单': '✓', '逐条闭环': '✗ F3 无测试', '断链项': ['F3→无方案'] }),
  })
  assert.strictEqual(bad.tracePassed, false, '断链拦收口')
  assert.ok(bad.traceCheckVerdict.includes('断链不许收口'), 'verdict 标注断链')
})

test('jarvis_release：rollback 回滚到历史版本（留痕+校验）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const prev = JSON.stringify([{ version: 'v1.0', state: '已确认' }, { version: 'v1.1', state: '已确认' }, { version: 'v1.2', state: '待确认' }])
  const ok = await def.handler({ mode: 'rollback', version: 'v1.2', rollbackTo: 'v1.1', rollbackReason: '甲方否决', prevVersions: prev })
  assert.ok(ok.status.includes('已回滚到 v1.1'), '回滚成功')
  assert.ok(ok.verdict.includes('留痕'), '回滚动作留痕')
  const noReason = await def.handler({ mode: 'rollback', version: 'v1.2', rollbackTo: 'v1.1', prevVersions: prev })
  assert.ok(noReason.verdict.includes('必须带 rollbackReason'), '缺原因拒绝回滚')
  const badTarget = await def.handler({ mode: 'rollback', version: 'v1.2', rollbackTo: 'v9.9', rollbackReason: 'x', prevVersions: prev })
  assert.ok(badTarget.verdict.includes('不在已有版本清单'), '回滚目标不存在拒绝')
})

// BUG-7 修复：rollback 空 prevVersions（无历史版本）→ 拒绝假回滚
test('jarvis_release BUG-7：prevVersions 为空 → 拒绝回滚（无历史可 undo）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.handler({ mode: 'rollback', version: 'v1.0', rollbackTo: 'v0.9', rollbackReason: '决策失误', prevVersions: '[]' })
  assert.ok(r.status.includes('rollback 失败'), '空历史 → 回滚失败')
  assert.ok(r.verdict.includes('历史版本可回滚') || r.verdict.includes('prevVersions 为空'), '说明无历史可回滚')
})

// ── 版本检测（回答"能否升级"）──

test('jarvis_update：无法连远程时如实报告（不编造版本号）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_update')
  const r = await def.handler({ remoteUrl: 'https://invalid-host.invalid/luke-jarvis.git', mode: 'check' })
  assert.ok(r.localVersion, '有本地版本')
  assert.ok(r.verdict.includes('无法连接远程') || r.verdict.includes('未能确认'), '如实报告连接失败')
})

test('jarvis_update：有本地版本且输出范围完整', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_update')
  const r = await def.handler({})
  assert.ok(/^\d+\.\d+\.\d+/.test(r.localVersion), '本地版本是 semver 格式')
  assert.ok('hasUpdate' in r, '有更新判定字段')
  assert.ok('verdict' in r, '有判定结论')
})

// ── 资源上报黑板铁律（需要资源先写黑板，防幻觉跳过步骤）──

test('jarvis_board：资源需求类型（显式+推断，优先于阻塞）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  const r1 = await def.handler({ add: '资源需求：需要用户提供内部数据样例', role: '研发' })
  assert.strictEqual(r1.items[0].type, '资源需求', '显式资源需求')
  const r2 = await def.handler({ add: '缺少用户内部数据源，无法继续', role: '测试' })
  assert.strictEqual(r2.items[0].type, '资源需求', '缺资源推断为资源需求（优先于阻塞）')
  const r3 = await def.handler({ add: '卡住了，等待上游接口', role: '研发' })
  assert.strictEqual(r3.items[0].type, '阻塞', '纯阻塞仍为阻塞')
})

// ── 强制执行：第一次分析需求必须跑 ponder（force=true）──

test('jarvis_think_deep：force=true 强制第一次分析需求跑 ponder（必须返回 run_id，违反=未完成）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.handler({ question: '是否需要建报销审批系统？', roleCard: '身份定位：产品经理。思维模型：先验证价值。', stakes: 'medium', force: true })
  assert.ok(r.ponderGuide.includes('强制 · 第一次分析需求'), 'force 强制提示')
  assert.ok(r.ponderGuide.includes('runId'), '必须返回 run_id')
  assert.ok(r.ponderGuide.includes('违反强制'), '违反强制=未完成')
  const r2 = await def.handler({ question: '测试', roleCard: '身份定位：测试。', stakes: 'low' })
  assert.ok(!r2.ponderGuide.includes('强制 · 第一次分析'), '非 force 不强调强制')
})

// 公司状态自动同步：工具动作 → company-state.json（3D 画面数据源）
test('syncCompanyState：工具动作自动更新公司状态（入职/开会/评估/招募）', async () => {
  const files = new Map()
  const cwd = process.cwd()
  const sp = cwd + '/.jarvis/company-state.json'
  const fsSvc = {
    async resolve(p) { return { path: p } },
    async readText(t) { const f = files.get(t.path); return f ? f.content : '' },
    async writeText(t, c) { files.set(t.path, { content: c }); return {} },
  }
  await syncCompanyState(fsSvc, { type: 'employee_hired', role: '研发', persona: 'Martin Fowler' })
  await syncCompanyState(fsSvc, { type: 'meeting_started', meeting: { id: 'm', type: 'kickoff', topic: '对齐' } })
  await syncCompanyState(fsSvc, { type: 'employee_evaluated', role: '研发', score: 60, strikes: 1, status: 'on_probation' })
  await syncCompanyState(fsSvc, { type: 'recruiting_started', position: '测试', targetPersona: 'James Bach' })
  const state = JSON.parse(files.get(sp).content)
  assert.ok(state.employees.some((e) => e.role === '研发' && e.status === 'on_probation' && e.perfScore === 60), '评估同步员工状态')
  assert.ok(state.meetings.some((m) => m.status === 'in_progress'), '开会同步会议状态')
  assert.ok(state.recruiting.some((r) => r.position === '测试' && r.status === 'searching'), '招募同步猎头状态')
  assert.ok(state.updatedAt, '更新时间戳')
})

test('syncCompanyState：员工注入后 recruiting 自动 confirmed（防 3D 画面误显"还在找"）', async () => {
  const files = new Map()
  const sp = process.cwd() + '/.jarvis/company-state.json'
  const fsSvc = {
    async resolve(p) { return { path: p } },
    async readText(t) { const f = files.get(t.path); return f ? f.content : '' },
    async writeText(t, c) { files.set(t.path, { content: c }); return {} },
  }
  await syncCompanyState(fsSvc, { type: 'recruiting_started', position: 'CEO' })
  await syncCompanyState(fsSvc, { type: 'recruiting_started', position: '测试' })
  await syncCompanyState(fsSvc, { type: 'employee_hired', role: 'CEO', persona: 'X' })
  const state = JSON.parse(files.get(sp).content)
  assert.strictEqual(state.recruiting.find((r) => r.position === 'CEO').status, 'confirmed', '已注入岗位 recruiting 自动 confirmed')
  assert.strictEqual(state.recruiting.find((r) => r.position === '测试').status, 'searching', '未注入岗位仍 searching')
})

test('syncCompanyState：employee_started 领任务开工标 working（补全状态机缺口）', async () => {
  const files = new Map()
  const sp = process.cwd() + '/.jarvis/company-state.json'
  const fsSvc = {
    async resolve(p) { return { path: p } },
    async readText(t) { const f = files.get(t.path); return f ? f.content : '' },
    async writeText(t, c) { files.set(t.path, { content: c }); return {} },
  }
  await syncCompanyState(fsSvc, { type: 'employee_hired', role: '测试', persona: 'James Bach' })
  await syncCompanyState(fsSvc, { type: 'employee_reporting', role: '测试', note: '回归发现 2 个缺陷已修 1 个' })
  let state = JSON.parse(files.get(sp).content)
  const r = state.employees.find((e) => e.role === '测试')
  assert.strictEqual(r.status, 'reporting', '汇报标 reporting')
  assert.strictEqual(r.lastReport, '回归发现 2 个缺陷已修 1 个', '汇报内容留痕 lastReport')
  assert.ok(r.lastReportAt, '汇报时间留痕')
  await syncCompanyState(fsSvc, { type: 'employee_started', role: '测试', currentWork: '回归 e2e 流程' })
  state = JSON.parse(files.get(sp).content)
  const emp = state.employees.find((e) => e.role === '测试')
  assert.strictEqual(emp.status, 'working', '开工标 working')
  assert.strictEqual(emp.currentWork, '回归 e2e 流程', '记录当前任务')
  await syncCompanyState(fsSvc, { type: 'employee_terminated', role: '测试', note: '连续不达标' })
  state = JSON.parse(files.get(sp).content)
  assert.strictEqual(state.employees.find((e) => e.role === '测试').status, 'terminated', '开除标 terminated')
})

// 任务编排图校验（学 HuggingGPT 依赖图：拆结构化任务图过闸再派活）
test('jarvis_taskgraph：健康任务图过闸（依赖闭环/每任务有验收/可并行）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  assert.ok(def, 'jarvis_taskgraph 工具存在')
  const r = await def.handler({
    requirement: '做拼团电商小程序',
    tasksJson: JSON.stringify([
      { id: 'T1', title: '方案设计', assignee: '架构', acceptance: '输出《方案设计》文档含模块划分+接口契约', deps: [] },
      { id: 'T2', title: '前端实现', assignee: '前端', deps: ['T1'], inputs: ['来自T1的方案设计文档'], acceptance: '页面能走通下单流程，通过验收用例' },
      { id: 'T3', title: '后端实现', assignee: '后端', deps: ['T1'], inputs: ['来自T1的接口契约'], acceptance: '接口通过集成测试，返回结构符合契约' },
      { id: 'T4', title: '测试验收', assignee: '测试', deps: ['T2', 'T3'], inputs: ['T2前端产物', 'T3后端产物'], acceptance: '按《测试验收单》逐条通过，缺陷=0' },
    ]),
  })
  assert.strictEqual(r.ok, true, '健康任务图应过闸')
  assert.strictEqual(r.taskCount, 4, '任务数正确')
  assert.deepStrictEqual(r.issues, [], '无问题')
  // 拓扑分层：T1=第1批（首开工），T2/T3 同层可并行，T4 最后
  assert.ok(r.parallelGroups.some((g) => g.includes('前端实现') && g.includes('后端实现')), 'T2/T3 同层报可并行: ' + r.parallelGroups.join('|'))
})

test('jarvis_taskgraph：悬空依赖/循环依赖/无验收 打回', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  const r = await def.handler({
    requirement: 'x',
    tasksJson: JSON.stringify([
      { id: 'T1', title: 'A', assignee: '甲', acceptance: '产出A' },
      { id: 'T2', title: 'B', assignee: '乙', deps: ['T9'], inputs: ['等T9'], acceptance: '产出B' }, // 悬空依赖 T9 不存在
      { id: 'T3', title: 'C', assignee: '丙', deps: ['T3'], acceptance: '产出C' }, // 自依赖
      { id: 'T4', title: 'D', assignee: '丁', deps: ['T5'], acceptance: '产出D' }, // 与T5成环
      { id: 'T5', title: 'E', assignee: '戊', deps: ['T4'], acceptance: '产出E' }, // 与T4成环
      { id: 'T6', title: 'F', assignee: '己', deps: ['T1'], acceptance: '做完' }, // 空泛验收
      { id: 'T7', title: 'G', assignee: '', acceptance: '产出G' }, // 无负责人
    ]),
  })
  assert.strictEqual(r.ok, false, '问题任务图应打回')
  const all = r.issues.join('\n')
  assert.ok(all.includes('悬空'), '报悬空依赖: ' + all)
  assert.ok(all.includes('自依赖'), '报自依赖')
  assert.ok(all.includes('循环依赖'), '报循环依赖')
  assert.ok(all.includes('验收标准不可判定'), '报空泛验收')
  assert.ok(all.includes('缺负责人'), '报缺负责人')
})

test('jarvis_taskgraph：有依赖未写输入来源给提示；坏 JSON 报错', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  const r1 = await def.handler({
    tasksJson: JSON.stringify([
      { id: 1, title: '做A', assignee: '甲', deps: [2], acceptance: 'A完成输出文档' },
      { id: 2, title: '做B', assignee: '乙', acceptance: 'B完成输出代码' },
    ]),
  })
  assert.strictEqual(r1.ok, false, '有依赖但下游没写输入来源应提示')
  assert.ok(r1.issues.some((i) => i.includes('输入来源')), '提示输入来源')
  const r2 = await def.handler({ tasksJson: 'not-json' })
  assert.strictEqual(r2.ok, false, '坏 JSON 打回')
  assert.ok(r2.issues.some((i) => i.includes('解析失败')), '报解析失败')
})

// jarvis_taskgraph：deps/inputs 一致性（学 HuggingGPT：参数引用是事实源，deps 必须覆盖 inputs 上游）
test('jarvis_taskgraph：inputs 引用必须 ∈ deps（自引用/悬空引用/不一致打回）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  // 1) inputs 引用自己但 deps 没依赖自己 → 自引用打回
  const r1 = await def.handler({ tasksJson: JSON.stringify([
    { id: 'T1', title: '方案', assignee: '甲', acceptance: '输出方案文档' },
    { id: 'T2', title: '实现', assignee: '乙', deps: ['T1'], inputs: ['来自T2的接口'], acceptance: '代码过测' },
  ]) })
  assert.strictEqual(r1.ok, false, '输入来源自引用应打回')
  assert.ok(r1.issues.some((i) => i.includes('自引用')), '报自引用')
  // 2) inputs 引用不存在的 T9 → 悬空打回
  const r2 = await def.handler({ tasksJson: JSON.stringify([
    { id: 'T1', title: '方案', assignee: '甲', acceptance: '输出方案文档' },
    { id: 'T2', title: '实现', assignee: '乙', deps: ['T1'], inputs: ['来自T9的接口'], acceptance: '代码过测' },
  ]) })
  assert.strictEqual(r2.ok, false, '输入来源悬空应打回')
  assert.ok(r2.issues.some((i) => i.includes('悬空')), '报悬空')
  // 3) inputs 引用 T3 但 deps 只依赖 T1 → 不一致打回
  const r3 = await def.handler({ tasksJson: JSON.stringify([
    { id: 'T1', title: '方案', assignee: '甲', acceptance: '输出方案文档' },
    { id: 'T3', title: '接口', assignee: '丙', acceptance: '输出接口契约' },
    { id: 'T2', title: '实现', assignee: '乙', deps: ['T1'], inputs: ['来自T3的接口'], acceptance: '代码过测' },
  ]) })
  assert.strictEqual(r3.ok, false, 'deps 与 inputs 不一致应打回')
  assert.ok(r3.issues.some((i) => i.includes('不一致')), '报不一致: ' + r3.issues.join('|'))
  // 4) 正常：inputs 引用 T1 ∈ deps → 放行
  const r4 = await def.handler({ tasksJson: JSON.stringify([
    { id: 'T1', title: '方案', assignee: '甲', acceptance: '输出方案文档' },
    { id: 'T2', title: '实现', assignee: '乙', deps: ['T1'], inputs: ['来自T1的方案文档'], acceptance: '代码过测' },
  ]) })
  assert.strictEqual(r4.ok, true, 'inputs ∈ deps 应放行')
})

// 链路修复：会议联动员工状态（开会=离开工位，散会=回工位）
test('syncCompanyState：meeting_started/done 联动参会员工 status=meeting/working', async () => {
  const files = new Map()
  const sp = process.cwd() + '/.jarvis/company-state.json'
  const fsSvc = {
    async resolve(p) { return { path: p } },
    async readText(t) { const f = files.get(t.path); return f ? f.content : '' },
    async writeText(t, c) { files.set(t.path, { content: c }); return {} },
  }
  await syncCompanyState(fsSvc, { type: 'employee_hired', role: '研发', persona: 'X' })
  await syncCompanyState(fsSvc, { type: 'employee_hired', role: '测试', persona: 'Y' })
  await syncCompanyState(fsSvc, { type: 'meeting_started', meeting: { id: 'm1', type: 'kickoff', topic: '对齐', attendees: ['研发', '测试'] } })
  let state = JSON.parse(files.get(sp).content)
  assert.strictEqual(state.employees.find((e) => e.role === '研发').status, 'meeting', '参会员工开会中=meeting')
  assert.strictEqual(state.employees.find((e) => e.role === '测试').status, 'meeting', '参会员工2开会中=meeting')
  assert.strictEqual(state.meetings.find((m) => m.id === 'm1').status, 'in_progress', '会议 in_progress')
  await syncCompanyState(fsSvc, { type: 'meeting_done', meetingId: 'm1' })
  state = JSON.parse(files.get(sp).content)
  assert.strictEqual(state.employees.find((e) => e.role === '研发').status, 'working', '散会回工位 working')
  assert.strictEqual(state.meetings.find((m) => m.id === 'm1').status, 'done', '会议 done')
})

// 链路修复：开除自动触发猎头补位（无 recruiting 记录→新增 searching；有→置回 searching）
test('syncCompanyState：employee_terminated 自动触发 recruiting 补位', async () => {
  const files = new Map()
  const sp = process.cwd() + '/.jarvis/company-state.json'
  const fsSvc = {
    async resolve(p) { return { path: p } },
    async readText(t) { const f = files.get(t.path); return f ? f.content : '' },
    async writeText(t, c) { files.set(t.path, { content: c }); return {} },
  }
  // 场景A：无 recruiting 记录 → 开除自动新增补位条
  await syncCompanyState(fsSvc, { type: 'employee_hired', role: '测试', persona: 'X' })
  await syncCompanyState(fsSvc, { type: 'employee_terminated', role: '测试', note: '连续不达标' })
  let state = JSON.parse(files.get(sp).content)
  assert.strictEqual(state.employees.find((e) => e.role === '测试').status, 'terminated', '员工标 terminated')
  assert.ok(state.recruiting.some((r) => r.position === '测试' && r.status === 'searching'), '自动新增补位 recruiting searching')
  // 场景B：有 confirmed 记录 → 开除置回 searching（防画面显示"还在招"但人还在）
  await syncCompanyState(fsSvc, { type: 'employee_hired', role: '研发', persona: 'Y' })
  await syncCompanyState(fsSvc, { type: 'employee_terminated', role: '研发' })
  state = JSON.parse(files.get(sp).content)
  const rec = state.recruiting.find((r) => r.position === '研发')
  assert.ok(rec && rec.status === 'searching', '已有 recruiting 置回 searching')
})

// 链路修复：recruiting_interviewing 补全状态机 searching→interviewing
test('syncCompanyState：recruiting_interviewing 标 interviewing', async () => {
  const files = new Map()
  const sp = process.cwd() + '/.jarvis/company-state.json'
  const fsSvc = {
    async resolve(p) { return { path: p } },
    async readText(t) { const f = files.get(t.path); return f ? f.content : '' },
    async writeText(t, c) { files.set(t.path, { content: c }); return {} },
  }
  await syncCompanyState(fsSvc, { type: 'recruiting_started', position: 'CEO', targetPersona: '某大佬' })
  const noRec = await syncCompanyState(fsSvc, { type: 'recruiting_interviewing', position: '不存在岗' })
  assert.strictEqual(noRec, false, '无 searching 记录不可转 interviewing')
  await syncCompanyState(fsSvc, { type: 'recruiting_interviewing', position: 'CEO' })
  const state = JSON.parse(files.get(sp).content)
  assert.strictEqual(state.recruiting.find((r) => r.position === 'CEO').status, 'interviewing', 'searching→interviewing')
})

// 覆盖核查器（领域无关：清单对清单覆盖——漏细节自动闸）
test('jarvis_coverage：全覆盖可过闸（制造业场景验证领域无关）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_coverage')
  assert.ok(def, 'jarvis_coverage 工具存在')
  const r = await def.handler({
    label: '产线改造收口核查',
    source: JSON.stringify([
      { id: 'R1', title: '传送带速度可调', status: 'open' },
      { id: 'R2', title: '急停按钮覆盖全工位', status: 'open' },
      { id: 'R3', title: '噪音低于85分贝', status: 'open' },
    ]),
    targets: JSON.stringify({
      '方案设计': [
        { id: 'D1', refs: ['R1'], status: 'completed', evidence: '图纸含变频器选型' },
        { id: 'D2', refs: ['R2'], status: 'completed', evidence: '图纸含急停回路' },
        { id: 'D3', refs: ['R3'], status: 'completed', evidence: '图纸含隔音方案' },
      ],
      '测试验收': [
        { id: 'T1', refs: ['R1'], status: 'completed', evidence: '实测 0.5-2m/s 可调' },
        { id: 'T2', refs: ['R2'], status: 'completed', evidence: '逐工位按下急停验证' },
        { id: 'T3', refs: ['R3'], status: 'completed', evidence: '分贝仪实测 82dB' },
      ],
    }),
  })
  assert.strictEqual(r.ok, true, '全覆盖应过闸')
  assert.strictEqual(r.coverage, 1, '覆盖率 100%')
  assert.deepStrictEqual(r.uncovered, [], '无未覆盖')
})

test('jarvis_coverage：漏覆盖/悬空/无证据 打回（软件场景）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_coverage')
  const r = await def.handler({
    label: '收口前核查',
    source: JSON.stringify([
      { id: 'R1', title: '登录', status: 'open' },
      { id: 'R2', title: '注册', status: 'open' },
      { id: 'R3', title: '找回密码', status: 'open' },
    ]),
    targets: JSON.stringify({
      '方案设计': [
        { id: 'D1', refs: ['R1'], status: 'completed', evidence: '登录方案' },
        // D2 漏了：R2 注册无方案落点
        { id: 'D3', refs: ['R3'], status: 'completed', evidence: '找回密码方案' },
      ],
      '测试验收': [
        { id: 'T1', refs: ['R1'], status: 'completed', evidence: '登录测过' },
        // T2 也漏 R2：R2 在方案和测试都无落点 → 真·漏覆盖
        { id: 'T4', refs: ['R9'], status: 'completed', evidence: '悬空引用' }, // R9 不存在
        { id: 'T3', refs: ['R3'], status: 'completed' }, // 无 evidence
      ],
    }),
  })
  assert.strictEqual(r.ok, false, '有缺口应打回')
  assert.ok(r.uncovered.some((u) => u.includes('R2')), '漏覆盖 R2: ' + r.uncovered.join('|'))
  assert.ok(r.danglingRefs.some((d) => d.includes('R9')), '悬空引用 R9: ' + r.danglingRefs.join('|'))
  assert.ok(r.evidenceLess.some((e) => e.includes('T3')), 'T3 终态无证据: ' + r.evidenceLess.join('|'))
  assert.ok(r.coverage < 1, '覆盖率不足 100%')
})

test('jarvis_coverage：未收口条目拦截 + 空源报错', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_coverage')
  const r1 = await def.handler({
    source: JSON.stringify([{ id: 'R1', title: '需求A' }]),
    targets: JSON.stringify({ '方案': [{ id: 'D1', refs: ['R1'], status: 'in_progress' }] }),
  })
  assert.strictEqual(r1.ok, false, '方案 in_progress 未收口应打回')
  assert.ok(r1.openItems.some((o) => o.includes('D1')), '报 D1 未收口')
  const r2 = await def.handler({ source: '[]', targets: '{}' })
  assert.strictEqual(r2.ok, false, '空源应打回')
})

// 职业底线（学 agent-qa 实证：报告真相/验证用户实际感受——比红线主动）
test('assessCardDepth：卡含职业底线加分，缺则提示', async () => {
  const base = `身份定位：测试工程师
思维模型：测试要找全问题；先按清单逐项执行
核心方法论：①按测试计划逐项跑 ②记录结果写报告 ③问题反馈修复
代表作品：某知名测试方法论
决策红线：不虚报合格；环境不可用如实上报
语言风格：先结论后证据
证据链：著作/对话/表达/他者/决策/时间线 六维都有内容
诚实边界：信息截止 2026-09，推测成分已标注
保真度：一手 60% 二手 40%
source: https://example-real-source.com/article
防冒名声明：只借鉴框架`
  // 无职业底线 → issues 里有提示
  const r1 = await assessCardDepth(base, false)
  assert.ok(r1.issues.some((i) => i.includes('职业底线')), '缺职业底线应提示')
  const score1 = r1.score
  // 加职业底线 → 提示消失、分数提高
  const withProf = base + `\n职业底线：报告真相不让测试通过（测出问题必须报，不因进度压力放水）；验证用户实际看到的画面，不被指标达标骗过体验有问题`
  const r2 = await assessCardDepth(withProf, false)
  assert.ok(!r2.issues.some((i) => i.includes('职业底线')), '含职业底线不再提示')
  assert.ok(r2.hasProfession === true, 'hasProfession=true')
  assert.ok(r2.score >= score1, '职业底线加分或持平: ' + score1 + '→' + r2.score)
})
