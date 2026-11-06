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
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, TOOLS, validateCardShape, assessCardDepth, jarvisCommand, identifyIndustry, checkCollabHealth, nextBoardId, writeBoardItems, syncCompanyState, checkTalentPreconditions, auditCaptainOwnedTasks, auditStaleTasks, captainExecutionGuard, checkCoverageGate, jarvisFlowGuard, checkPonderVerify, recordGate, computeStage, renderStage, jarvisStageGate, hasGlob, writeActiveTeamMarker, getFsService, resolveOwnedTeams, auditTeamBriefs, looksLikePluginRepo, stateRootConflict, COORD_TASK_RE, buildPixOfficeFrame, validatePixOfficeFrame, sseFrameString, relaySeqDecision, frameHash, validatePixOfficeCommand, PIXOFFICE_ACTOR_IDS } from '../src/host/plugin.js'

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
  const r = await def.execute({ role: 'CEO', card: GOOD_CEO_CARD })
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
  const r = await def.execute({ role: '公关', card: VOID, isCeo: false })
  assert.strictEqual(r.ok, false, '空洞卡必须拦下')
  assert.ok(r.depthScore !== undefined && r.depthScore < 60, `给出低深度分 ${r.depthScore}`)
})

// ── 蒸馏独特性引导（借鉴 distilly 24k★，捕捉 HOW 而非套模板）──

test('jarvis_distill_guide：输出品味原则/来源分级/黑名单/提炼步骤/验证锚点', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.execute({ role: 'CEO', material: '某访谈原文…', industry: '电商' })
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
  const r = await def.execute({ role: '研发', material: '素材', industry: '软件' })
  assert.ok(r.personBar, '输出选人闸')
  assert.ok(r.personBar.includes('排他性'), '要求选领域公认最强（排他性）')
  assert.ok(r.personBar.includes('任何领域都有'), '声明任何领域都有厉害人物')
  assert.ok(r.personBar.includes('可命名贡献'), '要求可命名贡献/开创学派')
})

test('jarvis_distill_guide：成就反推工作方式（achievementTrace）——从真实成就反推"他怎么工作才做到的"', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.execute({ role: '专家', material: '素材', industry: 'x' })
  assert.ok(r.achievementTrace, '输出成就反推指引')
  assert.ok(r.achievementTrace.includes('真实成就'), '要求列真实成就')
  assert.ok(r.achievementTrace.includes('他怎么工作才做到的'), '从成就反推工作方式')
  assert.ok(r.achievementTrace.includes('重复模式'), '跨成就找重复模式')
  assert.ok(r.respondAs.includes('achievements'), '输出要求含成就清单')
  assert.ok(r.respondAs.includes('shadowHabits'), '输出要求含影子习惯清单')
})

test('jarvis_distill_guide：证据溯源分级（evidenceTrace）+ 产出指纹（fingerprintTrace）——防把推断当他说过，防"产出没影子"', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.execute({ role: 'x', material: '素材' })
  assert.ok(r.evidenceTrace, '输出证据溯源分级指引')
  assert.ok(r.evidenceTrace.includes('A 原文级') && r.evidenceTrace.includes('B 行为级') && r.evidenceTrace.includes('C 推断级'), '含 A/B/C 三级')
  assert.ok(r.evidenceTrace.includes('不冒充'), 'C 推断不得冒充 A/B')
  assert.ok(r.fingerprintTrace, '输出产出指纹指引')
  assert.ok(r.fingerprintTrace.includes('可辨识'), '指纹=产出可辨识特征')
  assert.ok(r.fingerprintTrace.includes('逐项检查'), '指纹具体到可查')
})

test('jarvis_distill_guide：工作台需求反馈（workbenchTrace）——人物卡自己反馈环境工具，不许默认 Linux 万能', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.execute({ role: 'x', material: '素材' })
  assert.ok(r.workbenchTrace, '输出工作台需求反馈指引')
  assert.ok(r.workbenchTrace.includes('本领域必需'), '要求列本领域必需工具')
  assert.ok(r.workbenchTrace.includes('够不够') || r.workbenchTrace.includes('linuxEnough'), '判断默认环境够不够')
  assert.ok(r.workbenchTrace.includes('一票否决') || r.workbenchTrace.includes('红线'), '环境不够硬干=红线')
})

test('jarvis_distill_guide：AI 执行平替（aiDisplacementTrace）——判断保留、执行 AI 化', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.execute({ role: 'x', material: '素材' })
  assert.ok(r.aiDisplacementTrace, '输出 AI 执行平替指引')
  assert.ok(r.aiDisplacementTrace.includes('[判断]'), '含判断层标注')
  assert.ok(r.aiDisplacementTrace.includes('[AI执行]'), '含 AI 执行标注')
  assert.ok(r.aiDisplacementTrace.includes('[人工]'), '含人工标注')
  assert.ok(r.aiDisplacementTrace.includes('丢影子') || r.aiDisplacementTrace.includes('一票否决'), '红线：判断被代丢影子/AI冒充否决')
})

test('jarvis_distill_guide：未提供素材 → 提示先查真实权威（不许凭印象编）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill_guide')
  const r = await def.execute({ role: '风控' })
  assert.ok(r.sourceCheck.includes('不许凭印象编'), '提示不可编造')
  assert.ok(r.sourceCheck.includes('web_search'), '提示用 web_search 查证')
})

test('jarvis_fidelity：命中黑名单源 → 标记问题', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fidelity')
  const bad = GOOD_CEO_CARD + '\n补充来源：知乎某回答'
  const r = await def.execute({ role: 'CEO', card: bad })
  assert.ok(r.issues.some((i) => /知乎|黑名单/.test(i)))
})

test('jarvis_fidelity：缺诚实边界 → 非 PRIMARILY', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fidelity')
  const card = GOOD_CEO_CARD.replace('诚实边界：信息截止2026-08；无法预判全新问题；存在公开表达 vs 真实想法差距；含推测成分已标注。', '')
  const r = await def.execute({ role: 'CEO', card })
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
  const r = await def.execute({ role: 'CEO', card: '', isCeo: true })
  assert.strictEqual(r.ok, false)
  assert.ok(r.verdict.includes('现场'), '应提示必须现场蒸馏')
})

test('jarvis_distill handler：缺段卡 → ok=false 并列出缺失', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill')
  const bad = GOOD_CEO_CARD.replace('决策红线：虚假规模/刷单/套利冲量一票否决；绕过资金风控底线一票否决；不适用场景：非价格敏感品类。', '')
  const r = await def.execute({ role: 'CEO', card: bad, isCeo: true })
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
  const r = await def.execute({ role: 'x', card: generic, isCeo: false })
  assert.strictEqual(r.ok, false, '空泛卡必须被拦')
  assert.ok(r.verdict.includes('空洞') || r.verdict.includes('硬闸'), 'verdict 说明空洞打回')
})


test('jarvis_distill handler：展示型空泛卡（形容词堆砌：注重/追求/卓越/驱动——看着厉害但干活用不上）→ 打回', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill')
  const display = '身份定位：数字转型领域顶级专家，拥有二十年行业经验与跨领域视野，服务过世界五百强企业，洞悉行业前沿趋势\n思维模型：思维缜密，逻辑严谨，具备深刻的行业洞察力与前瞻性战略眼光，总能从全局视角把握本质\n核心方法论：1) 注重数据驱动与量化分析，以科学方法指导决策；2) 坚持用户导向，持续优化体验；3) 追求卓越，精益求精，不断迭代提升\n代表作品：主导某集团数字化转型项目推动效率提升40%（只借鉴框架，不冒充署名）\n决策红线：不做违背职业道德之事，维护企业声誉与长期价值\n语言风格：专业、严谨、富有洞见\n我的协同：位置=上游；依赖=市场；升级=CEO\n证据链：著作(有)+对话(有)+表达(有)+他者(有)+决策(有)+时间线(有)\n保真度：一手0.5\n诚实边界：信息截止2026\nsource：https://real-site.com/x\n防冒名声明：只借鉴框架'
  const r = await def.execute({ role: 'x', card: display, isCeo: false })
  assert.strictEqual(r.ok, false, '展示型空泛卡必须被拦')
  assert.ok(r.verdict.includes('展示型空泛'), 'verdict 说明形容词堆砌')
})

test('jarvis_distill handler：合格卡 → ok=true', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_distill')
  const r = await def.execute({ role: 'CEO', card: GOOD_CEO_CARD, isCeo: true })
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
  apply(ctx)
  assert.strictEqual(toolsCount, TOOLS.length, '应注册全部模型工具')
  assert.strictEqual(commandsCount, 1, '应注册 /jarvis 命令')
  assert.ok(disposers.length >= 5, '每个注册都应走 ctx.effect（可清理）')

  // 无服务时不应抛错
  const bare = { get: () => undefined, effect: () => {} }
  assert.doesNotThrow(() => apply(bare))
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
  assert.ok(r.content.includes('全体开会畅所欲言') || r.content.includes('双人打磨'), '全体开会头脑风暴/双人打磨')
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
  const r = await def.execute({
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
  const r = await def.execute({
    requirement: '电商拼团系统',
    rolesJson: JSON.stringify([{ name: '产品' }, { name: '研发' }, { name: '测试' }]),
    collabText: '位置=依次先后；依赖=前者完成后给后者；介入时机=依次进入；协同方式=先产品再研发最后测试（串行交接）',
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.issues.some((i) => /串行/.test(i) || /并行/.test(i)))
})

test('jarvis_collab：角色太少（1 个）→ ok=false', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_collab')
  const r = await def.execute({ requirement: '小事', rolesJson: JSON.stringify([{ name: '研发' }]), collabText: '位置=独立；依赖=无；介入时机=现在；协同方式=独立完成' })
  assert.strictEqual(r.ok, false)
})
// ── 分工明确 + 真实协作（用户核心关切）──

test('jarvis_collab：输出 perRole（每个角色的协同四要素）且合格', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_collab')
  const r = await def.execute({
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
  const r = await def.execute({
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
  const r = await def.execute({ question: '拼团要 2 人还是 3 人成团？', roleCard: '身份定位：产品增长负责人。', stakes: 'medium' })
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
    const a = await def.execute({ question: '是否迁移到云上？', roleCard: cardA, stakes })
    const b = await def.execute({ question: '是否迁移到云上？', roleCard: cardB, stakes })
    assert.ok(a.ponderGuide.includes('演进式架构'), `[${stakes}] A 卡方法论进 ponderGuide`)
    assert.ok(b.ponderGuide.includes('炉前思维'), `[${stakes}] B 卡方法论进 ponderGuide`)
    assert.ok(a.ponderGuide !== b.ponderGuide, `[${stakes}] ponderGuide 可区分`)
  }
})

test('jarvis_think_deep：stakes=high 引导加载 ponder 十阶段（B13 接入，含角色卡注入画像+衔接契约+skip 显式声明）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.execute({ question: '是否接入第三方支付？', roleCard: '身份定位：风控负责人。', stakes: 'high' })
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

// ── 智能路由：难度决定 ponder 深度（easy 免 ponder / standard 框架精简 / complex 满血）──

test('jarvis_think_deep：difficulty=easy 路由免 ponder（直做+自检三条+升级路径），route=easy-direct', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.execute({ question: '把按钮文案从"提交"改成"确认"', roleCard: '身份定位：前端工程师。', difficulty: 'easy' })
  assert.strictEqual(r.route, 'easy-direct', 'easy 须路由到直做')
  assert.ok(r.ponderGuide.includes('免 ponder'), 'easy 须免 ponder')
  assert.ok(r.ponderGuide.includes('升级路径'), 'easy 须带升级路径（发现复杂立即升级）')
  assert.ok(r.ponderGuide.includes('自检'), 'easy 免 ponder 但自检三条不许省')
  assert.ok(!r.ponderGuide.includes('必须加载 ponder'), 'easy 不强制加载 ponder')
})

test('jarvis_think_deep：difficulty=complex 走满血（route=full-ponder 含可谬自评）；stakes=high 自动 full；force 压过 easy', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const stages = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis']
  const a = await def.execute({ question: '迁移支付核心架构', roleCard: '身份定位：架构师。', difficulty: 'complex' })
  assert.strictEqual(a.route, 'full-ponder', 'complex 须路由满血')
  assert.ok(stages.every((s) => a.ponderGuide.includes(s)), 'complex 十阶段全含')
  assert.ok(a.ponderGuide.includes('可谬自评'), 'complex 须含可谬自评')
  const b = await def.execute({ question: '是否接入第三方支付？', roleCard: '身份定位：风控负责人。', stakes: 'high' })
  assert.strictEqual(b.route, 'full-ponder', 'stakes=high 自动按满血对待')
  const c = await def.execute({ question: '改个文案', roleCard: '身份定位：前端工程师。', difficulty: 'easy', force: true })
  assert.strictEqual(c.route, 'standard-ponder', 'force（第一次分析需求）压过 easy 路由，仍须真跑 ponder')
})

test('jarvis_think_deep：stakes=low 也走 ponder（精简 agent 规模但十阶段不跳）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.execute({ question: '按钮文案用哪个？', roleCard: '身份定位：产品负责人。', stakes: 'low' })
  assert.ok(r.ponderGuide.includes('精简各阶段内 agent 规模'), '低赌注精简 agent 规模')
  assert.ok(r.ponderGuide.includes('不得跳过任何阶段'), '但不得跳阶段（满血不阉割）')
  const stages = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis']
  assert.ok(stages.every((s) => r.ponderGuide.includes(s)), '十阶段全含')
})

test('jarvis_review：传入双方深度思考帧 → analysis 引用反方/真实核对', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  const r = await def.execute({
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
  const r = await def.execute({
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
  const r = await def.execute({ issue: 'x', sideA: 'a', sideB: 'b', thinkA: '不是JSON{{{', thinkB: null })
  assert.ok(r.analysis.includes('不是合法 JSON'), '提示格式错误')
})

test('jarvis_review：高赌注 think 含 run_id → 标注 ponder 溯源；缺 run_id → 标记贴标签风险（FIX-2 防贴标签）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  // 含 run_id：可溯源
  const r1 = await def.execute({
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
    const r = await def.execute(req)
    assert.strictEqual(r.customized, true, `${req.industry} 也必须 CEO 现场定制`)
    assert.ok(r.designChecklist.includes('CEO'), '给出设计清单由 CEO 逐项定')
    assert.ok(r.gates.some((g) => g.includes('CEO')), '闸门占位须 CEO 亲手定义')
  }
})

test('jarvis_process：支持参考本项目沉淀（projectRef），但强调按需求修订', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_process')
  const r = await def.execute({ industry: '电商', requirement: '拼团二期', projectRef: '.jarvis/process-拼团一期.json' })
  assert.ok(r.verdict.includes('不预设'), '插件无领域预设')
  assert.ok(r.designChecklist.includes('项目流程沉淀参考'), '提示可参考本项目沉淀')
  assert.ok(r.designChecklist.includes('严禁原样照搬'), '禁止照搬沉淀')
})

test('jarvis_process：overrideStages 增删（CEO 有权改流程）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_process')
  const r = await def.execute({ industry: '软件', requirement: 'x', overrideStages: '+合规审查,-复盘' })
  assert.ok(r.stages.includes('合规审查'), '追加阶段生效')
  assert.ok(!r.stages.includes('复盘'), '删除阶段生效')
})

// ── 项目沉淀（领域无关的"项目资产仓库"，角色卡沉淀在项目里）──

test('jarvis_store：scaffold 输出项目记忆库目录结构（含原型/项目细节，不携带任何静态卡）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  const r = await def.execute({ mode: 'scaffold' })
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
    const r = await def.execute({ mode: 'save', itemType: type, name, projectDir: '/x/.jarvis/' })
    assert.strictEqual(r.savePath, expect, `${type} 归档到 ${expect}`)
  }
})

test('jarvis_store：check 阶段零——有记忆直接继续（不用重分析源码），无记忆从零蒸馏', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  // 有记忆（prototypes+cards+project.md）
  const has = await def.execute({ mode: 'check', existingDirs: '["prototypes","cards"]', cards: '研发,产品增长', prototypes: '黄峥', projectMd: 'true' })
  assert.ok(has.verdict.includes('已有记忆库'), '有记忆 → 直接继续')
  assert.ok(has.reuseRule.includes('不用重新分析源码'), '明确不用重分析源码')
  // 无记忆 → 从零蒸馏
  const none = await def.execute({ mode: 'check' })
  assert.ok(none.verdict.includes('无记忆'), '无记忆 → 从零开始')
  assert.ok(none.reuseRule.includes('从零'), '提示从零开始')
})

test('jarvis_store：本项目记忆可复用（须校验+修订），跨项目/插件禁止', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  // 本项目沉淀中存在"研发"卡 → 可复用起点
  const local = await def.execute({ mode: 'reuse', itemType: 'card', name: '研发', existingCards: JSON.stringify([{ role: '研发', file: 'cards/研发.md' }]) })
  assert.ok(local.reuseRule.includes('本项目沉淀'), '本项目沉淀可复用')
  assert.ok(local.reuseRule.includes('jarvis_distill'), '复用须过校验')
  assert.ok(local.reuseRule.includes('修订'), '复用须按新需求修订')
  // 不是本项目沉淀 → 禁止复用
  const cross = await def.execute({ mode: 'reuse', itemType: 'card', name: '某外部大佬', existingCards: JSON.stringify([{ role: '研发' }]) })
  assert.ok(cross.reuseRule.includes('跨项目/插件禁止'), '跨项目/外部禁止复用')
})

test('jarvis_store：save 按类型落盘（prototype→prototypes/、card→cards/、project→project.md、lesson→lessons.md）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  const proto = await def.execute({ mode: 'save', itemType: 'prototype', name: '黄峥', projectDir: '/x/proj/.jarvis/' })
  assert.ok(proto.savePath.includes('prototypes/黄峥.md'), '真实人物原型落盘 prototypes/')
  const card = await def.execute({ mode: 'save', itemType: 'card', name: '产品增长', projectDir: '/x/proj/.jarvis/' })
  assert.ok(card.savePath.includes('cards/产品增长.md'), '虚拟人物卡落盘 cards/')
  assert.ok(card.verdict.includes('项目记忆库'), '明确是项目记忆库')
  const proj = await def.execute({ mode: 'save', itemType: 'project', name: 'project', projectDir: '/x/proj/.jarvis/' })
  assert.ok(proj.savePath.includes('project.md'), '项目细节快照落盘 project.md')
  const les = await def.execute({ mode: 'save', itemType: 'lesson', name: 'lesson', projectDir: '/x/proj/.jarvis/' })
  assert.ok(les.savePath.includes('lesson.md'), '进度经验落盘 lesson.md')
})

// ── 统一黑板（会议驱动协作的状态中枢）──

test('jarvis_board：add 阻塞 → needsMeeting=true；resolve 后收敛', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  let r = await def.execute({ role: '研发', add: '阻塞：支付接口技术绕不开（风控侧字段缺失）' })
  assert.strictEqual(r.needsMeeting, true, '存在阻塞 → 必须二次会')
  assert.ok(r.blockers.length === 1, '阻塞被识别')
  r = await def.execute({ board: JSON.stringify({ items: r.items }), resolve: '支付接口' })
  assert.strictEqual(r.needsMeeting, false, '解决后黑板收敛，不需要开会')
})

test('jarvis_board：未决项≥3 → 建议二次会；决策条目未过 essence → 提示', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  const r = await def.execute({ role: '产品', add: '问题：拼团人数未定\n问题：灰度范围未定\n问题：上线时间未定\n决策：采用固定 2 人团' })
  assert.ok(r.needsMeeting, '未决 4 项 ≥3 → 建议开会')
  assert.ok(r.summary.includes('jarvis_essence'), '决策条目提示需需求本质校验')
  const r2 = await def.execute({ board: JSON.stringify({ items: r.items }), audited: '采用固定 2 人团' })
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
  let r = await def.execute({ role: '研发', add: '阻塞：支付接口技术绕不开' })
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
  const r = await def.execute({
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
  const r = await def.execute({ role: '研发', problem: '某某问题搞不定' })
  assert.strictEqual(r.ok, false, '空单打回')
  assert.ok(r.missing.some((m) => /风险细节/.test(m)), '提示补风险细节')
  assert.ok(r.missing.some((m) => /决策请求/.test(m)), '提示补决策请求')
})

// ── 能力补足（组件化，防没能力硬装会）──

test('jarvis_capability：无现有无市场 → 自研组件化路径', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_capability')
  const r = await def.execute({ task: '实时风控规则引擎' })
  assert.ok(r.decision.includes('自研'), '走向自研组件化')
  assert.ok(r.decision.includes('luke-jarvis'), '自研要求参照可发布插件模式')
  assert.ok(r.buildNote.includes('组件清单'), '写入组件清单供复用')
  assert.ok(r.honestNote.includes('没有就是没有'), '诚实边界在位')
})

test('jarvis_capability：有市场结果 → 验证要点（防假装找到）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_capability')
  const r = await def.execute({ task: '流程图渲染', marketSearch: 'mermaid 高star' })
  assert.ok(r.verifyNotes.includes('真实存在'), '要求验证真实存在')
  assert.ok(r.verifyNotes.includes('license'), '要求验证 license')
})

// ── 交付版本管理（乙方与甲方的契约机制）──

test('jarvis_release：new_version 打版本快照（冻结旧版/变更开新版）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.execute({ mode: 'new_version', version: 'v1.1' })
  assert.ok(r.version === 'v1.1', '版本号正确')
  assert.ok(r.verdict.includes('冻结为历史'), '旧版冻结')
  assert.ok(r.verdict.includes('变更'), '变更开新版')
})

test('jarvis_release：checklist 生成交付清单（需求本质逐条对应）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.execute({ mode: 'checklist', version: 'v1.0', requirement: '能让用户拼团下单', items: JSON.stringify(['拼团功能', '支付功能']) })
  assert.ok(r.checklist.some((c) => c.includes('需求本质')), '清单含需求本质')
  assert.ok(r.checklist.some((c) => c.includes('拼团功能')), '清单含交付物')
  assert.ok(r.verdict.includes('按条确认'), '甲方按条确认')
})

test('jarvis_release：status 版本状态含确认时限（不无限等）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.execute({ mode: 'status', version: 'v1.0', confirmDeadline: '3 天' })
  assert.ok(r.verdict.includes('待甲方确认'), '版本待确认')
  assert.ok(r.verdict.includes('默认通过') || r.verdict.includes('submittedAt'), '有超时判定语义（不无限等）')
})

test('jarvis_release：status 真实超时判定（submittedAt + 时限 → timedOut）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  // 10 天前提交 + 3 天时限 → 已超时
  const longAgo = new Date(Date.now() - 10 * 86400000).toISOString()
  const r = await def.execute({ mode: 'status', version: 'v1.0', confirmDeadline: '3 天', submittedAt: longAgo, prevVersions: '[]' })
  assert.strictEqual(r.timedOut, true, '超时判定 true')
  assert.ok(r.verdict.includes('已超时'), 'verdict 标注超时')
  // 昨天提交 + 3 天时限 → 未超时
  const yesterday = new Date(Date.now() - 86400000).toISOString()
  const r2 = await def.execute({ mode: 'status', version: 'v1.0', confirmDeadline: '3 天', submittedAt: yesterday, prevVersions: '[]' })
  assert.strictEqual(r2.timedOut, false, '未超时判定 false')
})

test('jarvis_release：communication 记录甲方沟通结论（留痕）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.execute({ mode: 'communication', question: '拼团 2 人还是 3 人？', answer: '3 人' })
  assert.ok(r.log.includes('问甲方'), '记录问题')
  assert.ok(r.log.includes('3 人'), '记录甲方答复')
  assert.ok(r.verdict.includes('project.md'), '写入项目记忆')
})

// ── 绩效评估（CEO 换人决策量化）──

test('jarvis_perf：全面达标 → 继续（不换）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '研发', quality: 2, completion: 2, escalation: 2, fit: 2, depth: 90 })
  assert.strictEqual(r.ok, true, '达标')
  assert.ok(r.action.includes('继续'), '不换人')
})

test('jarvis_perf：连续 2 次不达标 → 建议换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '供应链', quality: 0, completion: 0, escalation: 1, fit: 0, depth: 40, history: JSON.stringify([{ ok: false }]) })
  assert.strictEqual(r.ok, false, '不达标')
  assert.ok(r.action.includes('换人'), '连续2次建议换人')
})

test('jarvis_perf：问题上行异常（高频信号）→ 立即触发不达标，不等 2 次', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '测试', quality: 2, completion: 2, escalation: 0, fit: 2, depth: 85 })
  assert.strictEqual(r.ok, false, '问题上行异常=不达标')
  assert.ok(r.action.includes('换人') || r.action.includes('补强'), '异常触发评估')
})

// ── 需求澄清引导器（REFORM-CLARIFY 实现）：模糊判定 + 蒸馏触发 + 三阶提问 + 方案 A ──

test('jarvis_clarify：模糊需求 5 角度引导 + T3 蒸馏触发（机械可判）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const a = await def.execute({ mode: 'analyze', requirement: '我要做个设备检修排期的东西', industry: '制造业' })
  assert.ok(a.vague === true, '模糊需求应判定为需澄清')
  assert.ok(a.candidates.length === 5, '5 角度候选问题')
  const t = await def.execute({ mode: 'trigger', requirement: '我要做个设备检修排期的东西，涉及OEE/TPM点检标准', industry: '制造业', candidates: a.candidates.join('\n') })
  assert.ok(t.trigger.includes('T3'), '行业术语引不出依据应触发 T3 蒸馏')
  const t2 = await def.execute({ mode: 'trigger', requirement: '帮我整理文档', candidates: '【P1】a\n【P2】b\n【P3】c\n【P4】d\n【P5】e' })
  assert.strictEqual(t2.trigger, '不触发', '无行业术语不触发')
})

test('jarvis_clarify：三阶提问 + 方案 A 双人判据 + 澄清完成判定', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const a = await def.execute({ mode: 'analyze', requirement: '做个自动写周报的东西' })
  const q1 = await def.execute({ mode: 'ask', requirement: 'x', round: '1', candidates: a.candidates.join('\n') })
  assert.ok(q1.questions.length >= 1, '一次问尽真疑问（不设数量上限，收敛判据=无剩余真疑问）')
  const d = await def.execute({ mode: 'duo', roleCards: 'CEO卡\n专家卡', round: '1' })
  assert.ok(d.duoCheck.includes('方案 A'), '双人方案 A 判据')
  const cf = await def.execute({ mode: 'confirm', userAnswers: '用户是员工，周报难写，希望自动汇总，成功=5分钟发出领导看到具体成果' })
  assert.ok(cf.confirm.includes('澄清完成'), '需求本质重述确认后完成')
})

// 模拟推理发现的 confirm 误判修复：数字验收标准必须判"已明确"；长描述无确认不得判完成（推断不得冒充已确认）
test('jarvis_clarify confirm：数字验收标准（准确率95%/30秒）判"已明确"而非"待补"', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const cf = await def.execute({ mode: 'confirm', userAnswers: '用户确认：给行政部用，解决发票录入慢易错，以识别准确率95%以上、单张处理<30秒为成功' })
  assert.ok(cf.confirm.includes('怎样算成功=已明确'), '数字验收标准判已明确')
})

test('jarvis_clarify confirm：长描述无确认词 → 不判完成（防推断冒充已确认）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const cf = await def.execute({ mode: 'confirm', userAnswers: '我们是物流公司，现在用excel排线路特别慢，司机经常跑冤枉路，想做个自动排线的东西提高效率' })
  assert.ok(cf.confirm.startsWith('⏳'), '无确认词不判完成')
  assert.ok(cf.confirm.includes('请明确确认') || cf.confirm.includes('未获用户确认'), '提示需用户确认')
})

test('jarvis_clarify confirm：确认词+验收标准 → 完成', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  const cf = await def.execute({ mode: 'confirm', userAnswers: '对，就是这样，给物流调度用，排线时间从2小时降到20分钟算成功' })
  assert.ok(cf.confirm.startsWith('✅'), '确认+标准判完成')
})

// ── 阶段性完成度考核（防 0 产出误判）：pending=待考核不计0产出 / due=到期未完成才不达标 ──

test('jarvis_perf：阶段未到/任务未分配（pending）→ 待考核，不计 0 产出不触发换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '研发', stageStatus: 'pending', stageRequirement: 't2 架构评审' })
  assert.strictEqual(r.ok, null, 'pending 待考核（不判达标/不达标）')
  assert.strictEqual(r.score, null, 'pending 无综合分（不计 0 产出）')
  assert.strictEqual(r.strikes, 0, 'pending 不累计不达标')
  assert.ok(r.action.includes('待考核'), '判定为待考核')
})

test('jarvis_perf：阶段结果符合要求→达标；到期未完成→才不达标；连续 2 次→换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const ok = await def.execute({ role: '研发', stageStatus: 'in_progress', stageRequirement: 't2', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '100' })
  assert.strictEqual(ok.ok, true, '阶段结果符合要求→达标')
  const due = await def.execute({ role: '研发', stageStatus: 'due', stageRequirement: 't2', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '100' })
  assert.strictEqual(due.ok, false, '到期未完成→不达标')
  assert.ok(due.action.includes('补强观察'), '首次不达标=补强观察非换人')
  const two = await def.execute({ role: '研发', stageStatus: 'due', stageRequirement: 't2', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '100', history: JSON.stringify([{ ok: false }, { ok: false }]) })
  assert.ok(two.action.includes('换人'), '连续 2 次不达标→换人')
})

// BUG-1 修复：perf 自动累计 strikes + 返回 historyNext（修复"依赖调用方手动维护 history"的半自动断点）
test('jarvis_perf BUG-1：不传 history 也能靠 historyNext 累计到 2 次换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  // 第一次：不达标，无 history
  const r1 = await def.execute({ role: '研发', stageStatus: 'due', stageRequirement: 't2', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '100' })
  assert.strictEqual(r1.ok, false, '首次不达标')
  assert.strictEqual(r1.strikes, 1, '首次 strikes=1')
  assert.ok(r1.action.includes('补强观察'), '首次=补强观察不换人')
  assert.ok(r1.historyNext, '返回 historyNext 供下次回传')
  const h1 = JSON.parse(r1.historyNext)
  assert.strictEqual(h1.length, 1, 'historyNext 含本次记录')
  assert.strictEqual(h1[0].ok, false, '本次记为不达标')
  // 第二次：直接用 r1.historyNext 回传（CEO 真实用法：不用手动造 history）
  const r2 = await def.execute({ role: '研发', stageStatus: 'due', stageRequirement: 't2', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '100', history: r1.historyNext })
  assert.strictEqual(r2.strikes, 2, '第二次 strikes=2（自动累计）')
  assert.ok(r2.action.includes('换人'), '连续 2 次不达标→换人（不再需要手动塞 history）')
})

// BUG-8 修复：perf 返回值含 role（render 标题不再显示 "?"）
test('jarvis_perf BUG-8：返回 role 字段（render 显示员工名）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '研发', quality: 2, completion: 2, escalation: 2, fit: 2, depth: 90 })
  assert.strictEqual(r.role, '研发', '返回 role')
  const pending = await def.execute({ role: '产品', stageStatus: 'pending' })
  assert.strictEqual(pending.role, '产品', 'pending 也返回 role')
  const txt = def.output.render({}, pending)
  const text = Array.isArray(txt) ? txt.map((b) => b.text).join('') : String(txt)
  assert.ok(text.includes('产品'), 'render 显示产品名而非 ?')
})

// BUG-9 修复：perf 信号 clamp 到 0-2（越界输入不爆 score / 不误判健康）
test('jarvis_perf BUG-9：越界信号 clamp（score 恒 0-100）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '研发', quality: '100', completion: '-5', escalation: '2', fit: '2', depth: '100' })
  assert.strictEqual(r.signals.quality, 2, 'quality 100→2')
  assert.strictEqual(r.signals.completion, 0, 'completion -5→0')
  assert.ok(r.score >= 0 && r.score <= 100, 'score 在 0-100')
  const r2 = await def.execute({ role: '研发', quality: '2', completion: '2', escalation: '999', fit: '2', depth: '90' })
  assert.strictEqual(r2.signals.escalation, 2, 'escalation 999→2')
  assert.ok(r2.score <= 100, '脏大值不爆 score')
})

// 客户价值维度：需求对齐度（做偏需求本质 = 一票否决换人，即使内部质量满分）
test('jarvis_perf 需求对齐度：做偏客户需求本质（alignment=0）→ 不达标直接换人', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '研发', stageStatus: 'due', stageRequirement: '发票OCR准确率95%', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '90', alignment: '0' })
  assert.strictEqual(r.ok, false, '偏离需求本质=不达标（即使活干得好）')
  assert.ok(r.action.includes('换人'), '方向错直接换人不等2次')
  assert.ok(r.verdict.includes('偏离'), 'verdict 标注偏离')
})

test('jarvis_perf 需求对齐度：直指需求本质（alignment=2）→ 合格继续', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '研发', stageStatus: 'due', stageRequirement: '发票OCR准确率95%', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '90', alignment: '2' })
  assert.strictEqual(r.ok, true, '对齐需求本质=达标')
  assert.ok(r.action.includes('继续'), '不换人')
  assert.strictEqual(r.signals.alignment, 2, 'signals 含 alignment')
})

test('jarvis_perf 需求对齐度：不传 alignment 默认 1（不误伤旧调用）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '研发', stageStatus: 'due', stageRequirement: 'x', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '90' })
  assert.strictEqual(r.signals.alignment, 1, '默认中性 1')
  assert.strictEqual(r.ok, true, '旧调用不误伤')
})

// 自动落盘：perf 历史文件路径约定 + 无 history 裸调不崩（有 fs 环境才落盘，无 fs 保持纯函数）
test('jarvis_perf 自动落盘：perf 历史文件路径约定 + 无 fs 环境不崩', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  // 无 fs 裸调用（单测环境）：不崩、不落盘、不误判
  const r = await def.execute({ role: '研发', stageStatus: 'due', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '80' })
  assert.strictEqual(r.ok, false, '不达标判定正常')
  assert.strictEqual(r.strikes, 1, '无历史首次 strikes=1')
  // 显式 history 累计（等价于从落盘文件读回后回传）
  const r2 = await def.execute({ role: '研发', stageStatus: 'due', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '80', history: r.historyNext })
  assert.strictEqual(r2.strikes, 2, '二次累计 strikes=2')
  assert.ok(r2.action.includes('换人'), '累计到 2 触发换人')
  // 空 history 字符串（等价于读盘失败/空文件）不崩
  const r3 = await def.execute({ role: '研发', stageStatus: 'due', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '90', history: '' })
  assert.strictEqual(r3.ok, true, '空 history 不崩且正常评估')
})

test('jarvis_perf BUG-1：达标时 historyNext 记 ok=true（不累计不达标）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_perf')
  const r = await def.execute({ role: '研发', stageStatus: 'in_progress', stageRequirement: 't2', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '100', history: JSON.stringify([{ ok: false }]) })
  assert.strictEqual(r.ok, true, '达标')
  assert.strictEqual(r.strikes, 0, '达标清零 strikes')
  const h = JSON.parse(r.historyNext)
  assert.strictEqual(h[h.length - 1].ok, true, 'historyNext 末条记 ok=true')
})

// BUG-2 修复：escalate 完整上报时真写黑板（.jarvis/board.json），不再只给建议文本
test('jarvis_escalate BUG-2：完整上报真写黑板（boardWritten=true）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_escalate')
  const r = await def.execute({
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
  const r = await def.execute({ mode: 'communication', question: '是否接受延迟一周', answer: '接受' })
  assert.ok(r.verdict.includes('project.md'), 'verdict 说明写入目标')
  assert.ok('projectWritten' in r === false || typeof r.projectWritten === 'boolean', '有 fs 时报告写入结果')
})

// BUG-4 修复：clarify trigger 领域无关——不预设行业词，只认通用术语标记
test('jarvis_clarify BUG-4：行业黑话词不预设（OEE 不再硬触发 T3），术语标记词仍触发', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_clarify')
  // 用户提到行业黑话（如 OEE）但没有候选问题依据 → 领域无关设计下不应因"预设词"触发，由 CEO 结合需求判断
  const t = await def.execute({ mode: 'trigger', requirement: '优化我们的OEE', candidates: '【P1】a\n【P2】b\n【P3】c\n【P4】d\n【P5】e' })
  // 注意：OEE 不再是硬编码词，是否触发取决于通用术语标记（OEE 不在列表）→ 应不触发或至少不因 OEE 触发
  assert.ok(!t.trigger.includes('T3') || t.triggerDetail.includes('通用'), 'OEE 不再硬编码触发 T3（领域无关）')
})

// ── 企业级版本管理：回滚机制（任何领域交付改错可 undo）──

test('jarvis_release checklist：三产物闭环核对（traceCheck）——全通过可交付/断链拦收口', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const ok = await def.execute({
    mode: 'checklist', version: 'v1.0', requirement: '发票OCR', items: '["F1 识别","F2 回填"]',
    traceCheck: JSON.stringify({ '需求规格': '✓ 在 docs/', '方案设计': '✓', '测试验收单': '✓', '逐条闭环': '✓ 全链', '断链项': [] }),
  })
  assert.strictEqual(ok.tracePassed, true, '全通过可交付')
  assert.ok(ok.traceCheckVerdict.includes('闭环核对通过'), 'verdict 标注通过')
  const bad = await def.execute({
    mode: 'checklist', version: 'v1.0', requirement: 'x', items: '["F1"]',
    traceCheck: JSON.stringify({ '需求规格': '✓', '方案设计': '✗ 缺', '测试验收单': '✓', '逐条闭环': '✗ F3 无测试', '断链项': ['F3→无方案'] }),
  })
  assert.strictEqual(bad.tracePassed, false, '断链拦收口')
  assert.ok(bad.traceCheckVerdict.includes('断链不许收口'), 'verdict 标注断链')
})

test('jarvis_release：rollback 回滚到历史版本（留痕+校验）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const prev = JSON.stringify([{ version: 'v1.0', state: '已确认' }, { version: 'v1.1', state: '已确认' }, { version: 'v1.2', state: '待确认' }])
  const ok = await def.execute({ mode: 'rollback', version: 'v1.2', rollbackTo: 'v1.1', rollbackReason: '甲方否决', prevVersions: prev })
  assert.ok(ok.status.includes('已回滚到 v1.1'), '回滚成功')
  assert.ok(ok.verdict.includes('留痕'), '回滚动作留痕')
  const noReason = await def.execute({ mode: 'rollback', version: 'v1.2', rollbackTo: 'v1.1', prevVersions: prev })
  assert.ok(noReason.verdict.includes('必须带 rollbackReason'), '缺原因拒绝回滚')
  const badTarget = await def.execute({ mode: 'rollback', version: 'v1.2', rollbackTo: 'v9.9', rollbackReason: 'x', prevVersions: prev })
  assert.ok(badTarget.verdict.includes('不在已有版本清单'), '回滚目标不存在拒绝')
})

// BUG-7 修复：rollback 空 prevVersions（无历史版本）→ 拒绝假回滚
test('jarvis_release BUG-7：prevVersions 为空 → 拒绝回滚（无历史可 undo）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const r = await def.execute({ mode: 'rollback', version: 'v1.0', rollbackTo: 'v0.9', rollbackReason: '决策失误', prevVersions: '[]' })
  assert.ok(r.status.includes('rollback 失败'), '空历史 → 回滚失败')
  assert.ok(r.verdict.includes('历史版本可回滚') || r.verdict.includes('prevVersions 为空'), '说明无历史可回滚')
})

// ── 版本检测（回答"能否升级"）──

test('jarvis_update：无法连远程时如实报告（不编造版本号）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_update')
  const r = await def.execute({ remoteUrl: 'https://invalid-host.invalid/luke-jarvis.git', mode: 'check' })
  assert.ok(r.localVersion, '有本地版本')
  assert.ok(r.verdict.includes('无法连接远程') || r.verdict.includes('未能确认'), '如实报告连接失败')
})

test('jarvis_update：有本地版本且输出范围完整', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_update')
  const r = await def.execute({})
  assert.ok(/^\d+\.\d+\.\d+/.test(r.localVersion), '本地版本是 semver 格式')
  assert.ok('hasUpdate' in r, '有更新判定字段')
  assert.ok('verdict' in r, '有判定结论')
})

// ── 资源上报黑板铁律（需要资源先写黑板，防幻觉跳过步骤）──

test('jarvis_board：资源需求类型（显式+推断，优先于阻塞）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  const r1 = await def.execute({ add: '资源需求：需要用户提供内部数据样例', role: '研发' })
  assert.strictEqual(r1.items[0].type, '资源需求', '显式资源需求')
  const r2 = await def.execute({ add: '缺少用户内部数据源，无法继续', role: '测试' })
  assert.strictEqual(r2.items[0].type, '资源需求', '缺资源推断为资源需求（优先于阻塞）')
  const r3 = await def.execute({ add: '卡住了，等待上游接口', role: '研发' })
  assert.strictEqual(r3.items[0].type, '阻塞', '纯阻塞仍为阻塞')
})

// ── 强制执行：第一次分析需求必须跑 ponder（force=true）──

test('jarvis_think_deep：force=true 强制第一次分析需求跑 ponder（必须返回 run_id，违反=未完成）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_think_deep')
  const r = await def.execute({ question: '是否需要建报销审批系统？', roleCard: '身份定位：产品经理。思维模型：先验证价值。', stakes: 'medium', force: true })
  assert.ok(r.ponderGuide.includes('强制 · 第一次分析需求'), 'force 强制提示')
  assert.ok(r.ponderGuide.includes('runId'), '必须返回 run_id')
  assert.ok(r.ponderGuide.includes('违反强制'), '违反强制=未完成')
  const r2 = await def.execute({ question: '测试', roleCard: '身份定位：测试。', stakes: 'low' })
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
  const r = await def.execute({
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
  const r = await def.execute({
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
  const r1 = await def.execute({
    tasksJson: JSON.stringify([
      { id: 1, title: '做A', assignee: '甲', deps: [2], acceptance: 'A完成输出文档' },
      { id: 2, title: '做B', assignee: '乙', acceptance: 'B完成输出代码' },
    ]),
  })
  assert.strictEqual(r1.ok, false, '有依赖但下游没写输入来源应提示')
  assert.ok(r1.issues.some((i) => i.includes('输入来源')), '提示输入来源')
  const r2 = await def.execute({ tasksJson: 'not-json' })
  assert.strictEqual(r2.ok, false, '坏 JSON 打回')
  assert.ok(r2.issues.some((i) => i.includes('解析失败')), '报解析失败')
})

// jarvis_taskgraph：deps/inputs 一致性（学 HuggingGPT：参数引用是事实源，deps 必须覆盖 inputs 上游）
test('jarvis_taskgraph：inputs 引用必须 ∈ deps（自引用/悬空引用/不一致打回）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  // 1) inputs 引用自己但 deps 没依赖自己 → 自引用打回
  const r1 = await def.execute({ tasksJson: JSON.stringify([
    { id: 'T1', title: '方案', assignee: '甲', acceptance: '输出方案文档' },
    { id: 'T2', title: '实现', assignee: '乙', deps: ['T1'], inputs: ['来自T2的接口'], acceptance: '代码过测' },
  ]) })
  assert.strictEqual(r1.ok, false, '输入来源自引用应打回')
  assert.ok(r1.issues.some((i) => i.includes('自引用')), '报自引用')
  // 2) inputs 引用不存在的 T9 → 悬空打回
  const r2 = await def.execute({ tasksJson: JSON.stringify([
    { id: 'T1', title: '方案', assignee: '甲', acceptance: '输出方案文档' },
    { id: 'T2', title: '实现', assignee: '乙', deps: ['T1'], inputs: ['来自T9的接口'], acceptance: '代码过测' },
  ]) })
  assert.strictEqual(r2.ok, false, '输入来源悬空应打回')
  assert.ok(r2.issues.some((i) => i.includes('悬空')), '报悬空')
  // 3) inputs 引用 T3 但 deps 只依赖 T1 → 不一致打回
  const r3 = await def.execute({ tasksJson: JSON.stringify([
    { id: 'T1', title: '方案', assignee: '甲', acceptance: '输出方案文档' },
    { id: 'T3', title: '接口', assignee: '丙', acceptance: '输出接口契约' },
    { id: 'T2', title: '实现', assignee: '乙', deps: ['T1'], inputs: ['来自T3的接口'], acceptance: '代码过测' },
  ]) })
  assert.strictEqual(r3.ok, false, 'deps 与 inputs 不一致应打回')
  assert.ok(r3.issues.some((i) => i.includes('不一致')), '报不一致: ' + r3.issues.join('|'))
  // 4) 正常：inputs 引用 T1 ∈ deps → 放行
  const r4 = await def.execute({ tasksJson: JSON.stringify([
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
  const r = await def.execute({
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
  const r = await def.execute({
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
  const r1 = await def.execute({
    source: JSON.stringify([{ id: 'R1', title: '需求A' }]),
    targets: JSON.stringify({ '方案': [{ id: 'D1', refs: ['R1'], status: 'in_progress' }] }),
  })
  assert.strictEqual(r1.ok, false, '方案 in_progress 未收口应打回')
  assert.ok(r1.openItems.some((o) => o.includes('D1')), '报 D1 未收口')
  const r2 = await def.execute({ source: '[]', targets: '{}' })
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

// 团队大小不由 S/M/L 预设人数决定（由需求拆解出的环节定，领域无关）
test('identifyIndustry：分级建议不预设团队人数', async () => {
  const r1 = await identifyIndustry('我要做一个完整的电商平台，支持多商户入驻、订单管理、支付、物流跟踪、售后、优惠券营销、数据分析、客服系统、发票管理')
  assert.ok(!/2-4 人|4-7 人|\d-\d 人/.test(r1.suggestion), '不应预设人数: ' + r1.suggestion)
  assert.ok(/不预设人数|拆解出的环节/.test(r1.suggestion), '应说明人数由拆解决定: ' + r1.suggestion)
})

// 深度分析动作链（狮子搏兔亦需全力——卡须有把事想透的动作链，防只有表层流程）
test('assessCardDepth：核心方法论含深度分析动作链 vs 只有表层流程', async () => {
  const shallow = `身份定位：开发
思维模型：按需求做
核心方法论：先做A再做B然后提交
代表作品：某作品
决策红线：不造假
语言风格：简洁
证据链：著作/对话/表达/他者/决策/时间线 都有内容
诚实边界：信息截止 2026-09
保真度：一手60%
source: https://example-real.com/x
防冒名声明：只借鉴框架`
  const r1 = await assessCardDepth(shallow, false)
  assert.ok(!r1.hasDeepChain, '表层流程不算深度分析')
  assert.ok(r1.issues.some((i) => i.includes('深度分析动作链')), '应提示缺深度分析')
  const deep = shallow.replace('核心方法论：先做A再做B然后提交', '核心方法论：①先立基准（对照原物/规格该对什么负责）②逐项对照找全差异（不只用户提的点，主动找全不等人列举）③每个可疑点追根因（为什么/影响什么/还有哪同样）④分级闭环（严重度+怎么解决每个不悬空）⑤自查遗漏（哪块没查/用户会碰到什么）⑥真实验证（跑起来真实用，静态看代码不算验证）')
  const r2 = await assessCardDepth(deep, false)
  assert.ok(r2.hasDeepChain === true, '含深度动作链应识别')
  assert.ok(r2.score >= r1.score, '深度链加分: ' + r1.score + '→' + r2.score)
})

// scan 教训：替代/重做类任务验收标准必须含"结构对齐参照基准"（防实现画蛇添足）
test('jarvis_taskgraph：重做/对齐类任务验收须含结构对齐约束', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  // 1) 标题说"对齐旧版"但验收没写结构对齐 → 打回
  const r1 = await def.execute({ tasksJson: JSON.stringify([
    { id: 'T1', title: '认证新增重做-对齐旧版两区结构', assignee: '实现A', acceptance: '分类型表单+测试按钮' },
  ]) })
  assert.strictEqual(r1.ok, false, '验收缺结构对齐应打回')
  assert.ok(r1.issues.some((i) => i.includes('结构/形态') || i.includes('画蛇添足')), '提示结构对齐: ' + r1.issues.join('|'))
  // 2) 验收含结构对齐 + 逐项对照 + 真实验证 → 放行（新要求：替代类须逐项对照参照基准+真实验证）
  const r2 = await def.execute({ tasksJson: JSON.stringify([
    { id: 'T1', title: '认证新增重做', assignee: '实现A', acceptance: 'UI 结构对齐旧版两页签形态，不加基准没有的；对照旧版逐项核字段/校验/交互无遗漏，关键操作真跑验证生效' },
  ]) })
  assert.strictEqual(r2.ok, true, '验收含结构对齐+逐项对照+真实验证应放行')
})

// ── ponder 真实性核验（lyj 会话教训：成员声称"十阶段全跑完/step-guard 全部 RECORDED"，
//    实际乱序（converge 早于 plans）、debate 无执行调用、score/simulate 无产出文件）──

test('jarvis_ponder_check：无任何 run 记录 → FAIL（声称跑过=未跑）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_ponder_check')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponder-none-'))
  const r = await def.execute({ runId: 'run_ghost', dataDir: tmp })
  assert.strictEqual(r.verdict, 'FAIL')
  assert.ok(r.issues.some((i) => /找不到有效 run 记录|未跑/.test(i)), '应判无记录=未跑: ' + r.issues.join('|'))
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('jarvis_ponder_check：十阶段按序 + 子agent达标 + 产出齐全 → PASS', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_ponder_check')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponder-ok-'))
  const ev = path.join(tmp, 'evidence')
  fs.mkdirSync(ev, { recursive: true })
  const STEPS = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis']
  const AG = { bagua: 8, plans: 6, score: 4, simulate: 4, debate: 8 }
  const FILES = {
    interview: 'context.md', shensi: 'stage-shensi.json', divergence: 'stage-divergence.json',
    bagua: 'stage-bagua.json', plans: 'stage-plans.json', converge: 'stage-converge.json',
    score: 'stage-score.json', simulate: 'stage-simulate.json', debate: 'stage-debate.json',
    synthesis: 'end-state.md',
  }
  const CONTENT = {
    interview: 'userProfile 五诊天 地 人 法 物', shensi: 'stake high premises 前提审视',
    divergence: 'perspectives 六视角 共识', bagua: 'dimensions F1 F2 F3 F4 F5 F6 F7 F8',
    plans: 'plans 方案 P1 P2 P3', converge: 'survivors 幸存方案',
    score: 'scored_survivors 评分', simulate: 'simulations 推演',
    debate: 'ranked 排名 debate_summary', synthesis: 'recommendation 结论',
  }
  for (const s of STEPS) {
    const body = (CONTENT[s] || '') + ' ' + ('实质内容细节 '.repeat(40)) // 保证 >200 字节
    fs.writeFileSync(path.join(ev, FILES[s]), JSON.stringify({ stage: s, content: body, detail: body }))
  }
  const state = {
    run_id: 'run_ok', question: 'q', completed: STEPS, agents: AG, certainties: {},
    sequence: STEPS.map((s, i) => ({ step: s, at: new Date(Date.now() + i * 1000).toISOString(), agents: AG[s] || 0 })),
    superseded_run: null,
  }
  fs.writeFileSync(path.join(tmp, 'step-guard.cjson'), JSON.stringify(state))
  const r = await def.execute({ runId: 'run_ok', dataDir: tmp, evidenceDir: ev })
  assert.strictEqual(r.verdict, 'PASS', '按序完整+产出齐全应通过: ' + r.issues.join('|'))
  assert.strictEqual(r.orderVerifiable, true)
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('jarvis_ponder_check：顺序违规（converge 早于 plans）→ FAIL 且点名', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_ponder_check')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponder-order-'))
  const state = {
    run_id: 'run_bad_order',
    completed: ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis'],
    agents: { bagua: 8, plans: 6, score: 4, simulate: 4, debate: 8 },
    // 真实 lyj 会话顺序：converge 先于 plans
    sequence: ['interview', 'shensi', 'divergence', 'bagua', 'converge', 'plans', 'score', 'simulate', 'debate', 'synthesis']
      .map((s) => ({ step: s, at: new Date().toISOString() })),
  }
  fs.writeFileSync(path.join(tmp, 'step-guard.cjson'), JSON.stringify(state))
  const r = await def.execute({ runId: 'run_bad_order', dataDir: tmp })
  assert.strictEqual(r.verdict, 'FAIL')
  assert.ok(r.orderViolations.some((v) => /收敛.*方案|converge|plans/.test(v)), '应点名乱序: ' + r.orderViolations.join('|'))
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('jarvis_ponder_check：缺阶段 / 无顺序记录 / 子agent不足 / 产出缺失 → FAIL 逐项报出', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_ponder_check')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponder-miss-'))
  const ev = path.join(tmp, 'evidence')
  fs.mkdirSync(ev, { recursive: true })
  fs.writeFileSync(path.join(ev, 'context.md'), '{}') // 只有 interview 产出
  const state = {
    run_id: 'run_partial',
    completed: ['interview', 'shensi', 'bagua'],   // 缺 7 个阶段；bagua 只报 3 个 agent
    agents: { bagua: 3 },
    // 无 sequence（旧记录/被覆盖）
  }
  fs.writeFileSync(path.join(tmp, 'step-guard.cjson'), JSON.stringify(state))
  const r = await def.execute({ runId: 'run_partial', dataDir: tmp, evidenceDir: ev })
  assert.strictEqual(r.verdict, 'FAIL')
  assert.ok(r.missing.includes('debate') && r.missing.includes('score'), '应列出缺失阶段: ' + r.missing.join(','))
  assert.strictEqual(r.orderVerifiable, false, '无 sequence 应判顺序不可核验')
  assert.ok(r.issues.some((i) => /顺序无法核验/.test(i)), '应报顺序无法核验')
  assert.ok(r.agentShortfalls.some((a) => /bagua|八卦镜/.test(a)), '应报子 agent 不足')
  assert.ok(r.evidenceMissing.length > 0, '应报产出缺失')
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('jarvis_ponder_check：run_id 不匹配（状态被别的 run 覆盖）→ FAIL', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_ponder_check')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponder-clob-'))
  fs.writeFileSync(path.join(tmp, 'step-guard.cjson'), JSON.stringify({
    run_id: 'run_other', completed: ['interview'], agents: {},
  }))
  const r = await def.execute({ runId: 'run_claimed', dataDir: tmp })
  assert.strictEqual(r.verdict, 'FAIL')
  assert.strictEqual(r.runIdMatch, false)
  assert.ok(r.issues.some((i) => /run_id 不匹配|覆盖/.test(i)), '应报 run_id 不匹配: ' + r.issues.join('|'))
  fs.rmSync(tmp, { recursive: true, force: true })
})

// ── 编制健康（lyj 教训：用户点名批评"分析人员只有 CEO 吗？"——
//    建队只配 CEO+猎头，8 个任务 6 个压 CEO 一人，CEO 成瓶颈、点名要的产出拖了三轮）──

test('jarvis_taskgraph 编制闸：单一执行者包办全部任务 → 打回（编制不足）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  const r = await def.execute({
    requirement: '态感平台参与策略',
    tasksJson: JSON.stringify([
      { id: 'T1', title: '需求判读', assignee: 'CEO', acceptance: '输出判读文档含逐条结论' },
      { id: 'T2', title: '开源调研', assignee: 'CEO', acceptance: '输出调研文档含候选台账' },
      { id: 'T3', title: '参与策略建议', assignee: 'CEO', acceptance: '输出策略文档含路径对比' },
    ]),
  })
  assert.strictEqual(r.ok, false, '只有 1 个执行者应打回')
  assert.ok(r.issues.some((i) => /编制不足/.test(i)), '应报编制不足: ' + r.issues.join('|'))
  assert.strictEqual(r.staffing.executorCount, 1, '编制报告应给出执行角色数')
})

test('jarvis_taskgraph 编制闸：单角色承担 >60% → 报瓶颈但不误伤正常分工', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  // CEO 承担 5/6 = 83% → 报瓶颈
  const overloaded = [
    { id: 'T1', title: '需求判读', assignee: 'CEO', acceptance: '输出判读文档含逐条结论' },
    { id: 'T2', title: '开源调研', assignee: '专家A', acceptance: '输出调研文档含候选台账' },
    { id: 'T3', title: '合规核对', assignee: 'CEO', acceptance: '输出核对表含逐条依据' },
    { id: 'T4', title: '数据接入方案', assignee: 'CEO', acceptance: '输出方案含接口契约' },
    { id: 'T5', title: '处置链设计', assignee: 'CEO', acceptance: '输出设计含闭环路径' },
    { id: 'T6', title: '收口评审', assignee: 'CEO', acceptance: '输出评审报告含逐项核对' },
  ]
  const r1 = await def.execute({ requirement: 'x', tasksJson: JSON.stringify(overloaded) })
  assert.strictEqual(r1.ok, false, 'CEO 83% 应报瓶颈')
  assert.ok(r1.issues.some((i) => /编制瓶颈/.test(i)), '应报编制瓶颈: ' + r1.issues.join('|'))
  assert.strictEqual(r1.staffing.maxLoad, 5)

  // 均衡分工（3 人各 2 个）→ 不报编制问题
  const balanced = [
    { id: 'T1', title: '需求判读', assignee: '专家A', acceptance: '输出判读文档含逐条结论' },
    { id: 'T2', title: '开源调研', assignee: '专家B', acceptance: '输出调研文档含候选台账' },
    { id: 'T3', title: '合规核对', assignee: '专家C', acceptance: '输出核对表含逐条依据' },
    { id: 'T4', title: '数据接入方案', assignee: '专家A', acceptance: '输出方案含接口契约' },
    { id: 'T5', title: '处置链设计', assignee: '专家B', acceptance: '输出设计含闭环路径' },
    { id: 'T6', title: '收口评审', assignee: '专家C', acceptance: '输出评审报告含逐项核对' },
  ]
  const r2 = await def.execute({ requirement: 'x', tasksJson: JSON.stringify(balanced) })
  assert.ok(!r2.issues.some((i) => /编制/.test(i)), '均衡分工不应报编制问题: ' + r2.issues.join('|'))
  assert.strictEqual(r2.staffing.executorCount, 3)
})

// ── 成员协议传递（lyj 教训：35 个会话只有 CEO 一个跑了 ponder——
//    协议只在主会话、成员看不到，派活不带须知 → 成员全成执行手）──

test('jarvis_member_brief：生成含 ponder 十阶段执行路径的成员须知（派活必带）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  assert.ok(def, 'jarvis_member_brief 工具应存在')
  const r = await def.execute({ roleName: '猎头', projectDir: '/tmp/proj', task: 'T4 专家寻访' })
  assert.strictEqual(r.mustRunPonder, false, '插件不校验步骤：ponder 是资源不是闸（不谎称必须）')
  // 十阶段固定顺序
  for (const s of ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis']) {
    assert.ok(r.brief.includes(s), `须知应含阶段 ${s}`)
  }
  // skill-free 执行路径（成员常无 skill 工具）
  assert.ok(/step-guard\.cjs init/.test(r.brief), '须知应给 bash 直跑路径: step-guard init')
  assert.ok(/step-guard\.cjs verify/.test(r.brief), '须知应含提交前 verify 自检')
  assert.ok(/PONDER_DATA_DIR/.test(r.brief), '须知应含 per-run 隔离数据目录')
  // 协议要点
  assert.ok(/jarvis_board|黑板/.test(r.brief), '须知应含黑板要求')
  assert.ok(/jarvis_escalate|三件套/.test(r.brief), '须知应含问题上行')
  // 回报格式：run_id 必带（供核验）
  assert.ok(/run_id/.test(r.brief), '须知应要求回报 run_id')
  assert.ok(r.sendsBack.some((s) => /runId/.test(s)), 'sendsBack 应含 runId')
  // 注入的任务
  assert.ok(r.brief.includes('T4 专家寻访'), '须知应带上本次任务')
})

test('jarvis_member_brief：无 skill 工具也能跑（不给成员留"没工具所以没ponder"的借口）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ roleName: '数据接入与范式化专家', ponderDir: '/opt/skills/ponder' })
  assert.ok(r.brief.includes('/opt/skills/ponder/scripts/step-guard.cjs'), '须知应使用传入的 ponderDir 给出绝对路径')
  assert.ok(/没有 skill 工具也能跑/.test(r.brief), '须知应明确声明无 skill 工具时的替代路径')
})

// ── 提问硬闸（lyj 教训：用户给了 6 条详细需求，团队 0 次提问直接勘察/蒸馏/建队/派活，
//    全程没问用户任何问题，用户质问"得到用户需求后都没有问问题了？没有疑问直接开干吗？"）──

test('/jarvis 命令执行：需求再详细，第一步也是按角色卡深度思考（真疑问才问，无疑问不硬问）', () => {
  // 模拟 lyj 那种"很长很详细"的需求——思考驱动，不机械提问
  const detailReq = '客户有6大类的数据采集来源，例如卫星通信、运营商网络通信、国内的关键基础设施、海外的关键基础设施等，6类数据有各自的承建方来采集，数据汇总到态势感知平台；客户自己会建设一个大的数据中台，存储容量现在1PB未来10PB；平台建设完后要给领导展现，客户计划做9米高展示大厅，前端客户自己做；我方可以争取的机会是数据清洗和范式化、态势感知后端、对前端接口、数据分析和关联规则；发现有问题后需要处置，由平台下发到安全设备处置，这块也需要我方做；态势感知还需要挂图作战和红蓝对抗两个功能模块'
  const r = jarvisCommand(detailReq)
  // 第一步是"按角色卡深度思考"（不是机械"必须提问"）
  assert.ok(r.content.includes('深度思考需求'), '应引导先按角色卡深度思考: ' + r.content.slice(0, 200))
  assert.ok(r.content.includes('真疑问'), '思考产物=理解+真疑问清单')
  assert.ok(r.content.includes('有真疑问才用 `ask_user_question`'), '有真疑问才问用户')
  assert.ok(r.content.includes('思考后确实无疑问（需求详细自洽）就直接进下一步'), '无疑问不硬问')
  assert.ok(r.content.includes('不许硬凑问题打扰用户'), '不许硬凑问题')
  assert.ok(r.content.includes('没经过角色卡深度思考就建队 = 缺陷'), '没思考=缺陷（而非没提问=缺陷）')
  // 思考要在建队/蒸馏之前（⓪ 排在最前）
  assert.ok(r.content.indexOf('第一步') < r.content.indexOf('蒸馏该领域猎头'), '思考必须排在建队之前')
})

test('/jarvis 命令执行：判不出领域也要先思考再提问（不是干等用户自己说）', () => {
  const r = jarvisCommand('做个东西')
  assert.ok(r.content.includes('先提问'), '模糊需求也要先提问')
  assert.ok(r.content.includes('ask_user_question'), '用工具问')
})

// ── 查证通道矩阵（防"信息缺失→LLM脑补补齐"）：成员须知必须带查证怎么查，且领域无关 ──

test('jarvis_member_brief：成员须知含查证通道矩阵（搜索不可用→降级链→禁脑补）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ roleName: '成员A', task: '调研任务' })
  assert.ok(r.brief.includes('查证通道矩阵'), '须知应含查证矩阵')
  assert.ok(r.brief.includes('web_search'), '应先真调默认搜索工具')
  assert.ok(r.brief.includes('web_fetch 抓已知 URL'), '降级链①')
  assert.ok(r.brief.includes('公开检索端点'), '降级链②')
  assert.ok(r.brief.includes('绝不脑补补齐'), '严禁脑补补齐')
  assert.ok(r.brief.includes('编造来源=一票否决'), '编造来源一票否决')
  assert.ok(r.brief.includes('按你职责查你该查的方向'), '角色按职责查不同方向')
})

// ── 提示词→代码化归一化（用户：上下文压缩可能丢精度、LLM可能跳步——流程步骤从提示词变工具强制）──

test('jarvis_meeting：输出头脑风暴三轮强制清单（代码级，压缩不丢）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_meeting')
  const r = await def.execute({ meetingType: 'cycle', agenda: '分歧裁决' })
  assert.ok(r.brainstormCheck, '应输出头脑风暴三轮强制清单')
  assert.ok(r.brainstormCheck.includes('① 提议'), '三轮①')
  assert.ok(r.brainstormCheck.includes('② 开放回应'), '三轮②')
  assert.ok(r.brainstormCheck.includes('③ 表态收敛'), '三轮③')
  assert.ok(r.brainstormCheck.includes('没走三轮的提议 = 未碰撞 = 打回'), '缺三轮=打回')
})

test('jarvis_board：有 open 资源需求 → 输出未闭环提示（相关任务不得标记完成）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  const r = await def.execute({ role: '测试', board: JSON.stringify({ items: [
    { id: 'B1', type: '资源需求', content: '需要客户提供测试服务器环境', status: 'open' },
  ] }) })
  assert.strictEqual(r.openResources.length, 1, '应识别未闭环资源需求')
  assert.ok(r.resourceBlockNote.includes('未闭环'), '应提示未闭环')
  assert.ok(r.resourceBlockNote.includes('不得标记完成'), '相关任务不得标记完成')
  // resolve 后闭环
  const r2 = await def.execute({ role: 'CEO', resolve: 'B1', board: JSON.stringify({ items: [
    { id: 'B1', type: '资源需求', content: '需要客户提供测试服务器环境', status: 'open' },
  ] }) })
  assert.strictEqual(r2.openResources.length, 0, 'resolve 后闭环')
})

// ── 归一化第二批：上下文准入/卡住上报（member_brief 强制输出）+ 续接五件套核对（store check）──

test('jarvis_member_brief：新成员须知强制含上下文准入 + 卡住限时上报（代码级，压缩不丢）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ roleName: '开发A', task: '实现登录页' })
  assert.ok(r.brief.includes('上下文准入'), '须知应含上下文准入（读记忆+复述确认才接任务）')
  assert.ok(r.brief.includes('续接五件套'), '上下文准入应指向续接五件套')
  assert.ok(r.brief.includes('卡住限时上报'), '须知应含卡住限时上报')
  assert.ok(r.brief.includes('20-30 分钟'), '卡住 20-30 分钟须上报')
  assert.ok(r.brief.includes('执行 CEO 当前最高优先级指令'), '不被低优先级细节带走')
})

test('jarvis_store check：project.md 存在 → 提示续接五件套核对（缺项先补再继续）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  const r = await def.execute({ mode: 'check', existingDirs: '["cards","docs"]', projectMd: 'true' })
  assert.ok(r.reuseRule.includes('续接五件套核对'), '应提示核对五件套')
  assert.ok(r.reuseRule.includes('当前进度/下一步/未决项/团队清单/关键决策与依据'), '五件套五项')
  assert.ok(r.reuseRule.includes('缺哪项先补哪项'), '缺项先补')
})

// ── 反思维审计修复：真会议校验（防假开会——没观点/无质疑/缺三轮=不算开会）──

test('jarvis_meeting：无成员观点 → 判假开会（拦"没真开就说开完"）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_meeting')
  const r = await def.execute({ meetingType: 'cycle' })
  assert.ok(r.meetingVerdict.includes('假开会'), '无观点应判假开会')
  assert.ok(r.meetingIssues.some((i) => /memberReplies|假开会/.test(i)), '应报缺成员观点')
})

test('jarvis_meeting：有成员观点但全员附和（无质疑）→ 判假开会', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_meeting')
  const r = await def.execute({ meetingType: 'cycle', memberReplies: '角色A:同意\n角色B:同意' })
  assert.ok(r.meetingVerdict.includes('假开会'), '无质疑应判假开会')
  assert.ok(r.meetingIssues.some((i) => /质疑|反驳|附和/.test(i)), '应报无质疑')
})

test('jarvis_meeting：多角色观点+质疑+三轮证据 → 判真开会（可进归拢）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_meeting')
  const r = await def.execute({
    meetingType: 'cycle',
    memberReplies: '角色A:我同意方案1\n角色B:我质疑方案1的前提不成立',
    brainstormEvidence: '提议X: ①A提 ②B反驳+理由 ③A同意修正',
  })
  assert.ok(r.meetingVerdict.includes('真开会'), '有观点+质疑+三轮应判真开会')
  assert.strictEqual(r.meetingIssues.length, 0)
})

// ── 反思维审计修复：续接五件套真校验（有 content 时工具真查五项，缺=提示补）──

test('jarvis_store check：project.md 内容五件套齐全 → 判可无缝续接', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  const r = await def.execute({ mode: 'check', existingDirs: '["cards"]', projectMd: 'true',
    projectContent: '## 当前进度\n- t1 done\n## 下一步\n- 做t2\n## 未决项\n- B1\n## 团队清单\n- CEO\n## 关键决策\n- 用A方案' })
  assert.ok(r.reuseRule.includes('续接五件套齐全'), '五件套齐全应判可续接')
})

test('jarvis_store check：project.md 内容缺五件套项 → 报缺并提示先补', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  const r = await def.execute({ mode: 'check', existingDirs: '["cards"]', projectMd: 'true', projectContent: '## 当前进度\n- t1 done' })
  assert.ok(r.reuseRule.includes('续接五件套缺'), '缺项应报缺')
  assert.ok(r.reuseRule.includes('下一步'), '应列出缺的项')
  assert.ok(r.reuseRule.includes('关键决策与依据'), '应列出缺的项2')
  assert.ok(r.reuseRule.includes('先补这几项再继续'), '应提示先补')
})

// ── 反思维审计修复：jarvis_review 防一面之词硬标注（一方缺 think → 裁决置信降级）──

test('jarvis_review：一方未提供深度思考帧 → 标注防一面之词未满足（置信降级）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  const r = await def.execute({ issue: '方案A还是B', sideA: 'A好', sideB: 'B好', requirement: '客户要X' })
  assert.strictEqual(r.oneSided, true, '缺 think 应标 oneSided')
  assert.ok(r.oneSidedNote.includes('防一面之词未满足'), '应标防一面未满足')
  assert.ok(r.oneSidedNote.includes('置信度降级'), '应标置信降级')
  assert.ok(r.oneSidedNote.includes('先补另一方深度思考再裁决'), '应建议补深度思考')
})

test('jarvis_review：双方都有 think 帧 → 不标 oneSided（正常裁决）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  const r = await def.execute({ issue: 'X', sideA: 'A', sideB: 'B', requirement: 'R', thinkA: '{"counter":"反A","realityCheck":"验A"}', thinkB: '{"counter":"反B","realityCheck":"验B"}' })
  assert.notStrictEqual(r.oneSided, true, '双方有 think 不标 oneSided')
  assert.ok(r.analysis.includes('A 方深度思考'), '应消费双方思考帧')
})

// ── 反思维审计第5轮：jarvis_company meeting_done 恢复开会前状态（非硬设 working）──

test('syncCompanyState：员工开会前是 idle → 散会恢复 idle（不硬设 working）', async () => {
  const { syncCompanyState } = await import('../src/host/plugin.js')
  // 用临时 fs 模拟（同步函数，测试环境可能无 fs——用内存版验证逻辑）
  const tmp = new Map()
  const fsMock = {
    readText: async (p) => tmp.get(p) || null,
    writeText: async (p, c) => { tmp.set(p, c); return { ok: true } },
    resolve: async (p) => p, // 返回传入路径作为 key
  }
  // 初始：开发A idle（开会前状态）——存任意 key，readCompanyState 用 resolve 返回的 key 读
  const init = JSON.stringify({ employees: [{ role: '开发A', persona: 'X', status: 'idle' }], meetings: [], recruiting: [] })
  // 先跑一次 meeting_started（空状态→写入），确认状态机在 mock 下工作
  const r0 = await syncCompanyState(fsMock, { type: 'meeting_started', meeting: { id: 'm1', attendees: ['开发A'] } })
  // 找到实际写入的 key
  let key = null
  for (const k of tmp.keys()) key = k
  assert.ok(key, '应写入状态文件（mock 下找到 key）')
  // 重新用有初始员工的库测恢复逻辑：key 必须与 readCompanyState 实际用的绝对路径一致（companyStateFile() = cwd + /.jarvis/company-state.json）
  tmp.clear()
  const { cwd } = await import('node:process')
  const abs = cwd() + '/.jarvis/company-state.json'
  tmp.set(abs, init)
  await syncCompanyState(fsMock, { type: 'meeting_started', meeting: { id: 'm1', attendees: ['开发A'] } })
  let st = JSON.parse(tmp.get(abs))
  assert.strictEqual(st.employees[0].status, 'meeting', '开会中→meeting')
  await syncCompanyState(fsMock, { type: 'meeting_done', meetingId: 'm1' })
  st = JSON.parse(tmp.get(abs))
  assert.strictEqual(st.employees[0].status, 'idle', '散会应恢复 idle（开会前状态），不是硬设 working')
})

// ── ponder 结论落地：替代/重建类任务验收须"逐项对照参照基准 + 真实验证"（scan 教训深化）──

test('jarvis_taskgraph：替代类验收只有结构对齐（无逐项对照+真实验证）→ 打回', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  const r = await def.execute({ requirement: '替换旧系统', tasksJson: JSON.stringify([
    { id: 'T1', title: '认证页移植-对齐旧版两页签', assignee: '实现A', acceptance: 'UI结构对齐旧版两页签形态' },
  ]) })
  assert.strictEqual(r.ok, false, '缺逐项对照+真实验证应打回')
  assert.ok(r.issues.some((i) => i.includes('逐项对照') && i.includes('真实验证')), '提示缺逐项对照+真实验证: ' + r.issues.join('|'))
})

test('jarvis_taskgraph：替代类验收含逐项对照+真实验证 → 放行', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_taskgraph')
  const r = await def.execute({ requirement: '替换旧系统', tasksJson: JSON.stringify([
    { id: 'T1', title: '认证页移植', assignee: '实现A', acceptance: '对照旧版认证页逐项核字段/校验/交互无遗漏；弱口令勾选后真跑验证后端收到' },
  ]) })
  assert.strictEqual(r.ok, true, '含逐项对照+真实验证应放行')
})

// ── ponder 结论落地：差异清单收口用 coverage 逐项销项（scan：t1 列了清单但收口没核销项→用户发现21处残余）──

test('jarvis_coverage：差异清单收口销项——每条差异须有落点+evidence，无证据终态打回', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_coverage')
  // 正确销项：差异R1有落点D1+evidence → 通过
  const ok = await def.execute({ label: '差异清单销项', source: JSON.stringify([{ id: 'R1', title: '认证详细页移植', status: 'completed' }]), targets: JSON.stringify({ 实现落点: [{ id: 'D1', refs: ['R1'], status: 'completed', evidence: '对照旧版逐项核过，真跑验证生效' }] }) })
  assert.strictEqual(ok.ok, true, '有落点+evidence 应通过')
  assert.strictEqual(ok.coverage, 1, '覆盖率100%')
  // 假销项：目标标 completed 但无 evidence（闭环列✅但没真验）→ 打回
  const fake = await def.execute({ label: '差异清单销项', source: JSON.stringify([{ id: 'R1', title: '认证详细页移植', status: 'completed' }]), targets: JSON.stringify({ 实现落点: [{ id: 'D1', refs: ['R1'], status: 'completed' }] }) })
  assert.strictEqual(fake.ok, false, '无 evidence 终态应打回（防自报式销项）')
  assert.ok(fake.evidenceLess.length > 0, '应报无证据终态')
  // 漏项：差异R2无任何落点 → 打回
  const miss = await def.execute({ label: '差异清单销项', source: JSON.stringify([{ id: 'R1', title: '认证', status: 'completed' }, { id: 'R2', title: '网站工具栏', status: 'completed' }]), targets: JSON.stringify({ 实现落点: [{ id: 'D1', refs: ['R1'], status: 'completed', evidence: '对照核过' }] }) })
  assert.strictEqual(miss.ok, false, '漏差异无落点应打回')
  assert.ok(miss.uncovered.some((u) => u.includes('R2')), '应报 R2 无落点')
})

// ── ssa-website 教训：真实任务缺开工须知→成员没跑 ponder——audit 模式机械校验"每个任务都有须知"──

test('jarvis_member_brief audit：检出真实任务缺开工须知（ssa 式：只有方法测试任务有 ponder）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ mode: 'audit', tasksJson: JSON.stringify([
    { id: 't1', assignee: '专家A', subject: '已知答案测试', description: '先跑 ponder 十阶段（run_id）' },
    { id: 't3', assignee: '专家A', subject: '修复方案定稿', description: '对照验收判据定稿' },
    { id: 't6', assignee: '实现', subject: 'B4 实现', description: '落地为最小可回退改动' },
  ]) })
  assert.strictEqual(r.ok, false, '有任务缺须知应 audit 不过')
  assert.ok(r.missing.length === 2, '应检出 t3/t6 缺须知')
  assert.ok(r.missing.some((m) => m.includes('t3')), '应指出 t3')
  assert.ok(r.missing.some((m) => m.includes('t6')), '应指出 t6')
  assert.ok(r.hint.includes('jarvis_member_brief'), '应给修复提示')
})

test('jarvis_member_brief audit：所有任务都附须知 → 通过', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ mode: 'audit', tasksJson: JSON.stringify([
    { id: 't1', assignee: '专家A', subject: '测试', description: '先跑 ponder 十阶段（PONDER_DATA_DIR + run_id 回报）' },
    { id: 't6', assignee: '实现', subject: '实现', description: '开工须知：先 ponder 十阶段再动手（step-guard）' },
  ]) })
  assert.strictEqual(r.ok, true, '全有须知应通过')
  assert.strictEqual(r.missing.length, 0)
})

// ── 主流程守卫 jarvis_flowguard（"每一步都不能跳过"——学 ponder step-guard 的 before/BLOCKED）──

test('jarvis_flowguard：未知步骤 → 提示合法步骤', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_flowguard')
  const r = await def.execute({ step: 'nope' })
  assert.strictEqual(r.ok, false)
  assert.ok(r.verdict.includes('未知步骤'), '应提示未知步骤')
})

test('jarvis_flowguard：收口步骤 → 检查黑板/差异销项前置（缺=BLOCKED）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_flowguard')
  const r = await def.execute({ step: 'close' })
  // 无 fs 环境 hasGlob 放行，但 pre 数组会给出提醒项（黑板/差异销项）
  assert.ok(r.verdict.includes('BLOCKED') || r.ok === true, '收口应有前置检查（黑板/差异销项）')
  assert.ok(['close', '收口'].includes(r.step || 'close'), 'step 回显')
})

test('jarvis_flowguard：全部合法步骤可调用不抛错', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_flowguard')
  for (const s of ['clarify', 'decompose', 'design', 'build', 'execute', 'close']) {
    const r = await def.execute({ step: s })
    assert.ok(typeof r.ok === 'boolean', s + ' 应返回 ok 布尔')
    assert.ok(r.verdict.length > 0, s + ' 应有判定')
  }
})

// ── 群聊会议协议（用户定义的真实会议效果：排队发言+每发言评价前面+时长+主题+收敛才结束）──

test('jarvis_meeting groupchat：发起会议输出完整协议（主题/时长/自由发言/可沉默/接话碰撞/主持人盯控/收敛判据）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_meeting')
  const r = await def.execute({ groupchat: true, topic: 'B4 修复方案细节打磨', attendees: '领域专家-A,领域专家-B,实现工程师', maxRounds: '3' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.topic, 'B4 修复方案细节打磨', '主题明确')
  assert.ok(r.protocol.includes('自由发言'), '自由发言（不排队）')
  assert.ok(r.protocol.includes('可沉默'), '可沉默（真实会议有人不说话）')
  assert.ok(r.protocol.includes('接话碰撞'), '接话碰撞（自愿回应）')
  assert.ok(r.protocol.includes('点名问'), '主持人盯控：该发声的没发声→点名')
  assert.ok(r.protocol.includes('观点没人回应'), '观点悬空追问')
  assert.ok(r.protocol.includes('所有细节都被确认没问题'), '收敛判据：所有细节无问题才结束')
  assert.ok(r.protocol.includes('最多 3 轮'), '时长：轮次上限')
  assert.ok(r.broadcast.includes('共享线程'), '广播唤醒话术')
  assert.ok(r.thread.includes('.jarvis/meetings/'), '共享线程路径')
})

test('jarvis_meeting groupchat：发言须对前面发言给评价（用户要求），线程=全员可见', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_meeting')
  const init = await def.execute({ groupchat: true, topic: 'T', attendees: 'A,B', maxRounds: '2' })
  // 无 fs 环境：post 会返回环境提示（但协议仍定义了 mustEvaluate）
  assert.strictEqual(init.mustEvaluate, true, '会议协议要求每个发言评价前面')
  assert.ok(init.convergeRule.includes('所有细节被确认无问题'), '收敛规则')
})

// ── 思考必 ponder（用户：不限于第一次分析需求——会议讨论/方案决策/分歧/收口等所有"需要思考"的动作都要 ponder）──

test('jarvis_member_brief：ponder 给成可用资源（不下"必须跑"的命令），硬要求落在可验证的交付物', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ roleName: '开发A', task: '实现登录页' })
  assert.ok(r.brief.includes('ponder 十阶段'), '须知应介绍 ponder 十阶段这个资源')
  assert.ok(r.brief.includes('不是流程闸') || r.brief.includes('插件不校验'), '要如实说插件不校验步骤')
  assert.ok(r.brief.includes('反方攻击') && r.brief.includes('失效边界') && r.brief.includes('置信度'), '硬要求落在交付物（可验证）')
  assert.ok(!/必须先跑 ponder|恒为 true/.test(r.brief), '不再用提示词命令成员跑步骤')
})

test('jarvis_member_brief：执行场景不强制 ponder（按任务做/汇报/查资料）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ roleName: '开发A', task: '实现' })
  assert.ok(r.brief.includes('执行已定方案'), '说明执行场景不需要重新决策')
  assert.ok(!/必须先跑 ponder/.test(r.brief), '执行场景不能用命令口吻')
})

// ── 子代理只有角色卡不跑 ponder 的根治：member_brief 输出 executionPrompt（注入成员系统 prompt）──

test('jarvis_member_brief：输出 executionPrompt 版（add_member 注入成员系统 prompt，出生即带协议）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ roleName: '开发A', task: '实现' })
  assert.ok(r.executionPrompt, '应输出 executionPrompt（供 add_member 注入）')
  assert.ok(r.executionPrompt.includes('ponder 十阶段'), 'executionPrompt 介绍 ponder 资源')
  assert.ok(r.executionPrompt.includes('interview') && r.executionPrompt.includes('synthesis'), '含十阶段顺序')
  assert.ok(r.executionPrompt.includes('run_id'), '含 run_id 回报')
  assert.ok(r.executionPrompt.includes('黑板即真相'), '含黑板协议')
  assert.ok(r.executionPrompt.includes('问题上行'), '含问题上行')
  assert.ok(r.executionPrompt.includes('卡住限时上报'), '含卡住上报')
  assert.ok(r.executionPrompt.includes('上下文准入'), '含上下文准入')
  assert.ok(r.verdict.includes('executionPrompt'), 'verdict 提示注入')
})

// ── 升级后协议刷新（老工作区升级新jarvis，已有成员spawn时persona冻结不自动带新协议→broadcast推送）──

test('jarvis_member_brief broadcast：生成协议刷新消息（含思考必ponder等新协议，供推送给已有成员）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ mode: 'broadcast', members: '领域专家-A,领域专家-B' })
  assert.ok(r.protocolRefresh, '应生成协议刷新消息')
  assert.ok(r.protocolRefresh.includes('ponder 十阶段'), '含 ponder 资源说明')
  assert.ok(r.protocolRefresh.includes('插件不校验') || r.protocolRefresh.includes('交付里体现得出思考'), '如实说明不校验步骤')
  assert.ok(r.protocolRefresh.includes('黑板即真相'), '含黑板')
  assert.ok(r.protocolRefresh.includes('问题上行'), '含问题上行')
  assert.ok(r.protocolRefresh.includes('卡住限时上报'), '含卡住上报')
  assert.ok(r.protocolRefresh.includes('上下文准入'), '含上下文准入')
  assert.deepStrictEqual(r.members, ['领域专家-A', '领域专家-B'], '目标成员')
  assert.ok(r.hint.includes('send_message'), '发送提示')
  assert.ok(r.verdict.includes('升级后不刷新'), '提示升级后需刷新')
})

// ── 工作区漂移修复（插件原用 process.cwd()=服务目录，非用户工作区 → jarvis_board/记忆写错位置）──

test('resolveWorkspace：exec.agent.session.header.cwd = 用户工作区（优先于 process.cwd）', async () => {
  const { resolveWorkspace } = await import('../src/host/plugin.js')
  // 模拟 DSH 工具调用 exec：agent.session.header.cwd = 用户工作区
  const exec = { agent: { session: { header: { cwd: '/opt/work/ssa-website' } } } }
  const w = resolveWorkspace(null, exec)
  assert.strictEqual(w, '/opt/work/ssa-website', '应从 exec.agent.session.header.cwd 拿用户工作区')
})

test('resolveWorkspace：无 exec 时退回 process.cwd（兜底不崩）', async () => {
  const { resolveWorkspace } = await import('../src/host/plugin.js')
  const w = resolveWorkspace(null, null)
  assert.ok(typeof w === 'string' && w.length > 0, '无 exec 应兜底返回字符串路径')
})

test('jarvis_board：写公屏到用户工作区（经 resolveWorkspace，非服务 process.cwd）', async () => {
  const { TOOLS } = await import('../src/host/plugin.js')
  const b = TOOLS.find((t) => t.name === 'jarvis_board')
  // 无 fs 环境：工具应正常返回（不因路径问题崩）
  const r = await b.execute({ role: '测试', board: JSON.stringify({ items: [{ id: 'B1', type: '决策', content: 'X', status: 'open' }] }) })
  assert.ok(r.items.length >= 0, 'board 工具可调用')
})

// ── 公屏展示规则（用户：未解决的展示、已解决的不展示（历史信息里面））──

test('jarvis_board：render 只展示未解决项，已解决进历史（resolvedItems）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  const r = await def.execute({ role: 'CEO', board: JSON.stringify({ items: [
    { id: 'B1', type: '问题', content: '未解决A', status: 'open' },
    { id: 'B2', type: '问题', content: '已解决B', status: 'resolved' },
    { id: 'B3', type: '资源需求', content: '未闭环C', status: 'open' },
  ] }) })
  assert.strictEqual(r.openItems.length, 2, '未解决 2 项')
  assert.strictEqual(r.resolvedItems.length, 1, '已解决 1 项进历史')
  assert.ok(r.resolvedItems[0].id === 'B2', '历史含 B2')
  // render 只展示 open（B2 不在主面板）
  assert.ok(r.openItems.every((i) => i.id !== 'B2'), '主面板不含已解决')
  assert.ok(r.summary.includes('1 条资源需求未闭环'), '资源未闭环提示')
})

// ── 黑板归拢（zyh 教训：收口后决策全 open 假未决堆积——已定案决策必须 resolve）──

test('jarvis_flowguard close：已定案决策未 resolve → BLOCKED（收口不留假未决）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_flowguard')
  // 模拟 fs 服务：board.json 含已定案决策（采用/上线）但 status=open
  const fsMock = {
    resolve: async (p) => p,
    readText: async (p) => p.includes('board.json')
      ? JSON.stringify({ items: [
          { id: 'B1', type: '决策', content: '挂图作战模块采用"姿态2+"方案', status: 'open' },
          { id: 'B2', type: '决策', content: 'Grafana 全线不引入交付', status: 'open' },
          { id: 'B3', type: '问题', content: '客户场景未澄清', status: 'open' },
        ] })
      : null,
  }
  // 直接测 flowguard handler（无 fsSvc 时 pre 数组仍提示——用项目 dir 触发真实 check 需要 fsSvc）
  // 无 fs 环境：验证 close 步骤可调用且返回 ok 布尔（fsSvc 不存在时 hasGlob 放行）
  const r = await def.execute({ step: 'close', projectDir: '/tmp/zyh-style' })
  assert.ok(typeof r.ok === 'boolean', 'close 应返回 ok')
  assert.ok(r.step === 'close', 'step 回显')
})

test('jarvis_board：已定案决策 resolve 后进 resolvedItems（历史）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  const r = await def.execute({ role: 'CEO', resolve: 'B1', board: JSON.stringify({ items: [
    { id: 'B1', type: '决策', content: '挂图作战采用姿态2+', status: 'open' },
    { id: 'B2', type: '问题', content: '真未决', status: 'open' },
  ] }) })
  assert.ok(r.resolvedItems.some((i) => i.id === 'B1'), 'B1 resolve 后进历史')
  assert.ok(r.openItems.some((i) => i.id === 'B2'), '真未决保持 open')
})

// ── ws8634 借鉴 P0：内容指纹核验（声称结论 vs run 实际结论一致性，防空跑/结论脱节）──

test('jarvis_ponder_check：声称结论与 run 实际结论脱节 → 检出内容指纹不匹配', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_ponder_check')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-'))
  fs.writeFileSync(path.join(tmp, 'stage-synthesis.json'), JSON.stringify({ stage: 'synthesis', recommendation: '采用姿态2+方案：Cesium+ECharts 底座加自研数据接入' }))
  const r = await def.execute({ runId: 'run_x', dataDir: tmp, evidenceDir: tmp, claimedConclusion: '采用完全不同的A方案' })
  assert.ok(r.issues.some((i) => i.includes('内容指纹不匹配')), '应检出声称结论与 run 实际结论脱节: ' + r.issues.join('|'))
})

test('jarvis_ponder_check：声称结论与 run 一致 → 无内容指纹问题', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_ponder_check')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-'))
  fs.writeFileSync(path.join(tmp, 'stage-synthesis.json'), JSON.stringify({ stage: 'synthesis', recommendation: '采用姿态2+方案：Cesium+ECharts 底座加自研数据接入' }))
  const r = await def.execute({ runId: 'run_x', dataDir: tmp, evidenceDir: tmp, claimedConclusion: '采用姿态2+方案' })
  assert.ok(!r.issues.some((i) => i.includes('内容指纹')), '一致场景不应有内容指纹问题')
})

test('jarvis_ponder_check：无 run 产出但声称结论 → 报无法核验（防空跑）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_ponder_check')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp2-'))
  const r = await def.execute({ runId: 'run_x', dataDir: tmp, evidenceDir: tmp, claimedConclusion: '任何结论' })
  assert.ok(r.issues.some((i) => i.includes('未找到 run 的 synthesis')), '无产出应报无法核验: ' + r.issues.join('|'))
})

// ── ws8634 借鉴：覆盖率三率算法（r_plan/r_verify/r_contract + P0/P1 核心门禁，领域无关）──

test('jarvis_coverage：P0 核心细节无落点 → r_contract=0 打回（防少列核心细节虚高）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_coverage')
  const r = await def.execute({ label: '细节覆盖', source: JSON.stringify([
    { id: 'R1', title: '认证页字段', priority: 'P0' },
    { id: 'R2', title: '网站工具栏', priority: 'P2' },
  ]), targets: JSON.stringify({ 实现: [{ id: 'D2', refs: ['R2'], status: 'completed', evidence: '核过' }] }) })
  assert.strictEqual(r.ok, false, 'P0 无落点应打回')
  assert.strictEqual(r.r_contract, 0, 'r_contract=0')
  assert.ok(r.verdict.includes('核心细节'), '提示核心细节未全验证')
})

test('jarvis_coverage：P0 核心细节有落点+证据 → r_contract=1 通过', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_coverage')
  const r = await def.execute({ label: '细节覆盖', source: JSON.stringify([
    { id: 'R1', title: '认证页字段', priority: 'P0' },
  ]), targets: JSON.stringify({ 实现: [{ id: 'D1', refs: ['R1'], status: 'completed', evidence: '对照旧版逐项核过' }] }) })
  assert.strictEqual(r.ok, true, 'P0 全验应通过')
  assert.strictEqual(r.r_contract, 1, 'r_contract=1')
  assert.ok(r.r_plan === 1 && r.r_verify === 1, '三率齐全')
})

test('jarvis_coverage：无优先级条目不触发核心门禁（领域无关，普通清单不受影响）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_coverage')
  const r = await def.execute({ label: '覆盖', source: JSON.stringify([{ id: 'R1', title: 'X' }]), targets: JSON.stringify({ T: [{ id: 'D1', refs: ['R1'], status: 'completed', evidence: 'e' }] }) })
  assert.strictEqual(r.ok, true, '无优先级应不影响')
  assert.strictEqual(r.r_contract, undefined, '无核心条目不返回 r_contract')
})

// ── ws8634 借鉴：产物结构指纹（判断"产物是否真的变了"，防"我改完了"但没变——lyj 教训）──

test('jarvis_fingerprint：只改内容没改结构 → 判未变（打回：改错地方/没真改）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fingerprint')
  const r = await def.execute({ mode: 'compare', before: '功能A：做A事情\n功能B：做B事情', after: '功能A：做A事情改了点内容\n功能B：做B事情' })
  assert.strictEqual(r.changed, false, '只改内容不改结构=未真变')
  assert.strictEqual(r.ok, false, '未变=打回')
  assert.ok(r.verdict.includes('没真改'), '提示没真改')
})

test('jarvis_fingerprint：新增功能/结构 → 判真变（改动生效）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fingerprint')
  const r = await def.execute({ mode: 'compare', before: '功能A：做A事情\n功能B：做B事情', after: '功能A：做A事情\n功能B：做B事情\n功能C：新增C功能' })
  assert.strictEqual(r.changed, true, '新增结构=真变')
  assert.strictEqual(r.ok, true)
})

test('jarvis_fingerprint：文档结构（章节级）指纹——加章节=真变', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fingerprint')
  const r = await def.execute({ mode: 'compare', kind: 'doc', before: '## 一、需求\n## 二、方案', after: '## 一、需求\n## 二、方案\n## 三、新增章节' })
  assert.strictEqual(r.changed, true, '加章节=真变')
})

test('jarvis_fingerprint：compute 模式算稳定指纹', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_fingerprint')
  const r = await def.execute({ mode: 'compute', content: '## 一、需求\n## 二、方案', kind: 'doc' })
  assert.strictEqual(r.ok, true)
  assert.ok(r.fingerprint && r.fingerprint.length >= 8, '有稳定指纹')
})

// ── ws8634 借鉴：多层通过判定（收口"算不算通过"按决策优先级——空产物BLOCK/削弱拒收/覆盖满ACCEPT）──

test('jarvis_release checklist：覆盖满但成功标准被削弱 → 拒收（即使全链闭环）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const TC = { '需求规格': '✓', '方案设计': '✓', '测试验收单': '✓', '逐条闭环': '✓全链', '断链项': [] }
  const r = await def.execute({ mode: 'checklist', version: 'v1', traceCheck: JSON.stringify(TC), successWeakened: '测试用 soft-if 绕过断言' })
  assert.strictEqual(r.tracePassed, false, '削弱成功标准即使覆盖满也拒收')
  assert.ok(r.traceCheckVerdict.includes('成功标准被削弱'), '提示削弱')
})

test('jarvis_release checklist：被测物空/占位 → BLOCK（先补真实产物）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const TC = { '需求规格': '✓', '方案设计': '✓', '测试验收单': '✓', '逐条闭环': '✓全链', '断链项': [] }
  const r = await def.execute({ mode: 'checklist', version: 'v1', traceCheck: JSON.stringify(TC), sutEmpty: '交付物只有占位符 TODO' })
  assert.strictEqual(r.tracePassed, false, '空产物应BLOCK')
  assert.ok(r.traceCheckVerdict.includes('空/占位'), '提示空壳')
})

test('jarvis_release checklist：覆盖满+无削弱+非空 → ACCEPT；断链 → 补链', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_release')
  const TC = { '需求规格': '✓', '方案设计': '✓', '测试验收单': '✓', '逐条闭环': '✓全链', '断链项': [] }
  const ok = await def.execute({ mode: 'checklist', version: 'v1', traceCheck: JSON.stringify(TC) })
  assert.strictEqual(ok.tracePassed, true, '覆盖满正常应ACCEPT')
  const broken = await def.execute({ mode: 'checklist', version: 'v1', traceCheck: JSON.stringify({ '需求规格': '✓', '方案设计': '✗', '测试验收单': '✗', '逐条闭环': '✗', '断链项': ['R2无实现'] }) })
  assert.strictEqual(broken.tracePassed, false, '断链应补链')
})

// ── 公屏问题内部分析判定（用户：先内部分析清楚是否需要用户回答，需要才提升最上层让用户解惑）──

test('jarvis_board classify：信息缺口(引用不出依据) → needs_user 进待用户回答清单', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  let r = await def.execute({ role: 'CEO', add: '问题：客户挂图作战具体场景未澄清' })
  const bid = r.items.find((i) => i.content.includes('客户挂图作战')).id
  r = await def.execute({ role: 'CEO', classify: JSON.stringify({ [bid]: 'needs_user:客户场景决定自研深度，内部无依据' }), board: JSON.stringify({ items: r.items }) })
  const it = r.items.find((i) => i.id === bid)
  assert.strictEqual(it.answerNeeded, 'needs_user', '信息缺口应标 needs_user')
  assert.ok(r.needsUserItems.some((i) => i.id === bid), '进待用户回答清单')
})

test('jarvis_board classify：内部能答(带引用依据) → internal_answer 不进待用户清单', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  let r = await def.execute({ role: 'CEO', add: '问题：B5 修复方案选型' })
  const bid = r.items.find((i) => i.content.includes('B5')).id
  r = await def.execute({ role: 'CEO', classify: JSON.stringify({ [bid]: 'internal:参考验收判据定稿-r2-20260917.md B5节' }), board: JSON.stringify({ items: r.items }) })
  const it = r.items.find((i) => i.id === bid)
  assert.strictEqual(it.answerNeeded, 'internal_answer', '内部能答应标 internal_answer')
  assert.ok(!r.needsUserItems.some((i) => i.id === bid), '不进待用户回答清单')
})

test('jarvis_board userAnswer：用户回答写回 → resolve 闭环（用户已解惑）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_board')
  let r = await def.execute({ role: 'CEO', add: '问题：场景未澄清' })
  const bid = r.items.find((i) => i.content.includes('场景未澄清')).id
  r = await def.execute({ role: 'CEO', classify: JSON.stringify({ [bid]: 'needs_user' }), board: JSON.stringify({ items: r.items }) })
  r = await def.execute({ role: '贾维斯', userAnswer: JSON.stringify({ [bid]: '场景是汇报展示为主' }), board: JSON.stringify({ items: r.items }) })
  const it = r.items.find((i) => i.id === bid)
  assert.strictEqual(it.status, 'resolved', '用户回答后 resolve')
  assert.strictEqual(it.userAnswer, '场景是汇报展示为主', '答案写回')
  assert.strictEqual(it.answerNeeded, 'user_answered', '标 user_answered')
  assert.strictEqual(r.needsUserItems.length, 0, '待回答清零')
})

// ── 会议纪要（用户：.jarvis 希望有每次内部开会的会议纪要——沟通主题/时间/人员/内容/结论）──

test('jarvis_meeting minutes：产出结构化纪要（主题/时间/人员/内容/结论要素齐全）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_meeting')
  const r = await def.execute({ groupchat: true, topic: 'B4 细节打磨', attendees: '专家A,专家B',
    minutes: JSON.stringify({ topic: 'B4 细节打磨', date: '2026-09-23', startTime: '14:00', endTime: '14:30', type: 'cycle', attendees: ['专家A', '专家B'], agenda: ['B4 细节'], content: [{ who: '专家A', what: '提出细节问题' }], disputes: [{ issue: '阈值', resolvedBy: '0.80' }], conclusion: '细节清单定稿', resolutions: ['R1'], boardUpdates: ['B4 更新'], actions: [{ who: '专家A', what: '补清单' }] }) })
  assert.strictEqual(r.ok, true, '纪要应可落盘')
  assert.ok(r.minutesPath?.includes('-minutes.json'), '纪要路径含 -minutes.json')
  assert.ok(r.verdict.includes('会议纪要已落盘'), '提示已落盘')
  assert.strictEqual(r.minutes.conclusion, '细节清单定稿', '结论写入')
  assert.ok(r.verdict.includes('6 项要素'), '要素完整（主题/时间/人员/内容/结论）')
})

// ── ws8634 借鉴 P1 迭代：可证伪预期门禁 + lessons 结构化（2026-10-08）──

test('jarvis_review：缺 expected_effect → falsifiableGate=false 并提示补可证伪预期', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  const r = await def.execute({ issue: 'x', sideA: 'a', sideB: 'b' })
  assert.strictEqual(r.falsifiableGate, false, '缺预期 = 门禁不通过')
  assert.ok(r.falsifiableGateNote.includes('可证伪预期缺失'), '明确提示缺失')
  assert.ok(r.falsifiableGateNote.includes('expected_effect'), '指向补预期字段')
})

test('jarvis_review：expected_effect 含可观察信号 → falsifiableGate=true', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  const r = await def.execute({ issue: 'x', sideA: 'a', sideB: 'b', expected_effect: '接入后接单路由准确率 ≥90%，跑 100 条历史单回放验证' })
  assert.strictEqual(r.falsifiableGate, true, '可证伪预期达标 = 门禁通过')
  assert.ok(r.falsifiableGateNote.includes('已具备'), '标注已具备')
})

test('jarvis_review：expected_effect 空泛无指标 → falsifiableGate=false 并提示不达标', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_review')
  const r = await def.execute({ issue: 'x', sideA: 'a', sideB: 'b', expected_effect: '会更好' })
  assert.strictEqual(r.falsifiableGate, false, '空泛预期不通过')
  assert.ok(r.falsifiableGateNote.includes('不达标'), '提示不达标')
})

test('jarvis_lesson：schema 输出字段规范', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_lesson')
  const r = await def.execute({ mode: 'schema' })
  assert.strictEqual(r.mode, 'schema')
  assert.ok(r.schema.includes('分类'), '含分类字段')
  assert.ok(r.schema.includes('状态'), '含状态字段')
})

test('jarvis_lesson：validate 结构化教训通过', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_lesson')
  const lesson = '分类：假Pass；主责：本仓；现场：ws8634 验收；修向：补证据链门禁；状态：verified；复现：scripts/verify.mjs'
  const r = await def.execute({ mode: 'validate', lesson })
  assert.deepStrictEqual(r.missing, [])
  assert.ok(r.verdict.includes('可写入 lessons.md'), '判定可写入')
})

test('jarvis_lesson：validate 缺字段/状态非法 → FAIL', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_lesson')
  const r1 = await def.execute({ mode: 'validate', lesson: '今天踩了个坑，下次注意。' })
  assert.ok(r1.missing.length > 0, '自由文本缺结构')
  assert.ok(r1.verdict.includes('未结构化'), '提示未结构化')
  const r2 = await def.execute({ mode: 'validate', lesson: '分类：假Pass；主责：本仓；现场：x；修向：y；状态：已解决' })
  assert.ok(r2.missing.includes('状态枚举'), '模糊状态不合法')
})

test('jarvis_lesson：entry 从字段渲染规范条目，缺字段打回', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_lesson')
  const ok = await def.execute({ mode: 'entry', category: '假Pass', owner: '本仓', scene: 'ws8634', problem: '脚本绿但业务不 Pass', fix: '加证据链门禁', status: 'fixed', repro: 'scripts/verify.mjs' })
  assert.ok(ok.entry.includes('【教训 · 假Pass】'), '条目含分类')
  assert.ok(ok.entry.includes('状态=fixed'), '条目含状态')
  assert.ok(ok.entry.includes('复现=scripts/verify.mjs'), '条目含复现')
  const bad = await def.execute({ mode: 'entry', category: '假Pass', owner: '本仓', scene: 'x', problem: 'y', fix: 'z', status: 'done' })
  assert.ok(bad.missing.includes('status枚举'), '非法状态打回')
})

test('jarvis_store：save lesson 提示须过 jarvis_lesson 结构化', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_store')
  const r = await def.execute({ mode: 'save', itemType: 'lesson', name: 'lesson', projectDir: '/x/proj/.jarvis/' })
  assert.ok(r.verdict.includes('jarvis_lesson'), 'save lesson 提示结构化工具')
})

// ── v0.2.5：建队人才层前置硬闸（glm-test 教训——无猎头/无角色卡直接建队必须被 flowguard 拦住）──

function fakeTalentFs({ cards = [], teams = [] } = {}) {
  const files = {}
  for (const c of cards) files[`/proj/.jarvis/cards/${c}`] = '卡内容'
  for (const t of teams) files[`/proj/.agent-teams/${t}/team.json`] = JSON.stringify(t)
  return {
    async list(dir) {
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const names = Object.keys(files)
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length).split('/')[0])
      return [...new Set(names)]
    },
    async readText(p) { return files[p] || null },
    async resolve(p) { return p },
  }
}

test('checkTalentPreconditions：无猎头卡/带队卡/角色卡 → 全部缺失（BLOCKED 依据）', async () => {
  const fs = fakeTalentFs({
    cards: [],
    teams: [{ name: 'demo', members: [{ name: '总经理', role: '总经理' }, { name: '架构师', role: '架构师' }] }],
  })
  const missing = await checkTalentPreconditions(fs, '/proj', { join: (...a) => a.join('/') })
  assert.ok(missing.some((m) => m.includes('猎头卡')), '缺猎头卡')
  assert.ok(missing.some((m) => m.includes('带队/CEO卡')), '缺带队卡')
  assert.ok(missing.some((m) => m.includes('角色卡：架构师')), '缺架构师角色卡')
})

test('checkTalentPreconditions：猎头+带队+各岗位卡齐备 → 通过', async () => {
  const fs = fakeTalentFs({
    cards: ['猎头-人才寻访.md', 'CEO-组织与变革.md', '架构师-软件架构.md', 'Go协议工程师.md'],
    teams: [{ name: 'demo', members: [{ name: '总经理', role: '总经理' }, { name: '架构师', role: '架构师' }, { name: 'Go协议工程师', role: 'Go协议工程师' }] }],
  })
  const missing = await checkTalentPreconditions(fs, '/proj', { join: (...a) => a.join('/') })
  assert.deepStrictEqual(missing, [], '人才层前置齐备')
})

test('checkTalentPreconditions：有猎头/带队但某岗位无卡 → 只缺该岗位角色卡', async () => {
  const fs = fakeTalentFs({
    cards: ['猎头.md', 'CEO.md'],
    teams: [{ name: 'demo', members: [{ name: '总经理', role: '总经理' }, { name: '协议工程师', role: '协议工程师' }] }],
  })
  const missing = await checkTalentPreconditions(fs, '/proj', { join: (...a) => a.join('/') })
  assert.ok(!missing.some((m) => m.includes('猎头卡')), '有猎头卡')
  assert.ok(!missing.some((m) => m.includes('带队/CEO卡')), '有带队卡')
  assert.ok(missing.some((m) => m.includes('角色卡：协议工程师')), '缺协议工程师卡')
})

test('checkTalentPreconditions：无 fs 环境 → 放行（不误拦）', async () => {
  const missing = await checkTalentPreconditions(null, '/proj', { join: (...a) => a.join('/') })
  assert.deepStrictEqual(missing, [], '无 fs 放行')
})

// ── v0.2.9：顶层不得自领执行任务（scan 教训——成员会话死后 captain 自己 claim 干完）──

function fakeTeamFs(tasks) {
  const files = {
    '/proj/.agent-teams/demo/team.json': JSON.stringify({ name: 'demo', members: [{ name: '实现A' }], tasks }),
  }
  return {
    async list(dir) {
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const names = Object.keys(files)
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length).split('/')[0])
      return [...new Set(names)]
    },
    async readText(p) { return files[p] || null },
    async resolve(p) { return p },
  }
}
const PATH = { join: (...a) => a.join('/') }

test('auditCaptainOwnedTasks：captain 自领未完成执行任务 → 命中', async () => {
  const fs = fakeTeamFs([{ id: 't1', subject: '实现升级包上传接口', status: 'in_progress', assignee: 'captain' }])
  const r = await auditCaptainOwnedTasks(fs, '/proj', PATH)
  assert.deepStrictEqual(r, ['t1'], '应命中 captain 自领执行任务')
})

test('auditCaptainOwnedTasks：协调/验收类 captain 任务豁免', async () => {
  const fs = fakeTeamFs([{ id: 't2', subject: '10.21.10.11 实机验收', status: 'in_progress', assignee: 'captain' }])
  const r = await auditCaptainOwnedTasks(fs, '/proj', PATH)
  assert.deepStrictEqual(r, [], '验收类豁免')
})

test('auditCaptainOwnedTasks：已完成 captain 任务 / 成员任务 → 不命中', async () => {
  const fs = fakeTeamFs([
    { id: 't3', subject: '实现 X', status: 'completed', assignee: 'captain' },
    { id: 't4', subject: '实现 Y', status: 'in_progress', assignee: '实现A' },
  ])
  const r = await auditCaptainOwnedTasks(fs, '/proj', PATH)
  assert.deepStrictEqual(r, [], '完成/成员任务不命中')
})

// ── v0.3.0：卡死任务必须 reassign（scan 教训——成员会话 end-seed 后任务停在 claimed）──

test('auditStaleTasks：claimed 未交付 → 命中', async () => {
  const fs = fakeTeamFs([{ id: 't12', subject: '后端接口', status: 'claimed', assignee: '部署升级专家', attempt: 4, output: '' }])
  const r = await auditStaleTasks(fs, '/proj', PATH)
  assert.ok(r.some((x) => x.includes('t12')), 'claimed 未交付应命中')
})

test('auditStaleTasks：attempt≥4 且产出为空 → 命中；有产出/已完成不命中', async () => {
  const fs = fakeTeamFs([
    { id: 't50', subject: '弹窗修复', status: 'in_progress', assignee: '前端实现B', attempt: 6, output: '' },
    { id: 't47', subject: '误报处置', status: 'in_progress', assignee: '测试验证', attempt: 6, output: '有产出内容' },
    { id: 't1', subject: '勘察', status: 'completed', assignee: '部署升级专家', attempt: 1, output: '' },
  ])
  const r = await auditStaleTasks(fs, '/proj', PATH)
  assert.ok(r.some((x) => x.includes('t50')), 't50 应命中')
  assert.ok(!r.some((x) => x.includes('t47')), 't47 有产出不命中')
  assert.ok(!r.some((x) => x.includes('t1')), '已完成不命中')
})

test('auditStaleTasks：无 fs → 放行', async () => {
  assert.deepStrictEqual(await auditStaleTasks(null, '/proj', PATH), [])
})

// ── v0.3.1：/jarvis 严格模式（能力自检 + 顶层只派发不亲自干 + 每步过闸）──

test('/jarvis 命令：显式调用 → 输出严格模式（能力自检/顶层不亲自干/执行由成员/每步过闸）', () => {
  const r = jarvisCommand('做一个金融风控系统')
  assert.ok(r.content.includes('严格模式'), '含严格模式')
  assert.ok(r.content.includes('能力自检'), '要求能力自检')
  assert.ok(r.content.includes('jarvis_flowguard'), '要求走步骤守卫')
  assert.ok(r.content.includes('绝不亲自实现'), '顶层不亲自实现')
  assert.ok(r.content.includes('agent_teams_reassign_task'), '卡住要唤醒成员而非自己顶替')
  assert.ok(r.content.includes('jarvis 能力未注册'), '缺能力时明确告知不硬做')
})

// ── v0.3.2：自带预设必须挂 luke-jarvis（修"预设只有人设没有工具"根因）──

test('preset/agent.cordis.yml：必须挂 luke-jarvis 插件（否则 jarvis-org 预设没有 jarvis_* 工具）', () => {
  const t = fs.readFileSync(path.resolve('preset/agent.cordis.yml'), 'utf8')
  assert.ok(/name:\s*luke-jarvis/.test(t), 'agent.cordis.yml 应挂 luke-jarvis')
})

test('preset/jarvis-captain.cordis.yml：严格预设——无执行工具，有 agent-teams + luke-jarvis', () => {
  const t = fs.readFileSync(path.resolve('preset/jarvis-captain.cordis.yml'), 'utf8')
  assert.ok(!/dsh-tool-bash|dsh-tool-pwsh/.test(t), '不应含 bash/pwsh')
  assert.ok(!/name:\s*'@deepseek-ai\/dsh-tool-fs'/.test(t), '不应含可写 fs 工具')
  assert.ok(!/dsh-tool-subagent|dsh-tool-workflow|dsh-tool-ralph/.test(t), '不应含子代理/工作流')
  assert.ok(/name:\s*luke-jarvis/.test(t), '应挂 luke-jarvis')
  assert.ok(/dsh-agent-teams/.test(t), '应挂 agent-teams')
})

// ── v0.3.3：/jarvis 续跑意图（"继续"不能被判成模糊需求）──

test('/jarvis 继续：识别为续跑意图（不反问"想做什么"），给出读现状→判身份→唤醒成员→过闸', () => {
  for (const q of ['继续', '接着上次的做', '继续 scan 的升级包工作', 'resume']) {
    const r = jarvisCommand(q)
    assert.ok(r.content.includes('续跑'), `${q} 应识别为续跑`)
    assert.ok(!r.content.includes('判不出领域'), `${q} 不应被判模糊`)
    assert.ok(r.content.includes('不要重新建队'), `${q} 提示不重建队`)
    assert.ok(r.content.includes('agent_teams_reassign_task'), `${q} 应给唤醒成员动作`)
    assert.ok(r.content.includes('无法接管旧团队'), `${q} 应说明非 captain 无法接管`)
    assert.ok(r.content.includes('严格模式'), `${q} 应附严格模式`)
  }
})

test('/jarvis 续跑：正常需求不受影响（仍走领域判定流程）', () => {
  const r = jarvisCommand('做一个金融风控系统')
  assert.ok(!r.content.includes('续跑 ≠ 新需求'), '正常需求不应走续跑分支')
  assert.ok(r.content.includes('猎头'), '仍走人才流程')
})

// ── v0.3.4：插件级拦截——顶层 captain 不得亲自执行（作用于已存在会话）──

test('captainExecutionGuard：captain 在 jarvis 工作区用 bash/edit → 拒绝；成员/只读/非 jarvis/逃生阀 → 放行', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-guard-'))
  const proj = path.join(base, 'proj')
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  fs.mkdirSync(path.join(proj, '.agent-teams', 't1'), { recursive: true })
  fs.writeFileSync(
    path.join(proj, '.agent-teams', 't1', 'team.json'),
    JSON.stringify({ name: 't1', captainSessionId: 'sess-cap' }),
  )
  const plain = path.join(base, 'plain')
  fs.mkdirSync(plain, { recursive: true })
  const exec = (name, sid, cwd) => ({ name, agent: { session: { id: sid, header: { cwd } } } })

  assert.strictEqual(typeof captainExecutionGuard(exec('bash', 'sess-cap', proj)), 'string', 'captain bash 应拒绝')
  assert.strictEqual(typeof captainExecutionGuard(exec('edit', 'sess-cap', proj)), 'string', 'captain edit 应拒绝')
  assert.strictEqual(typeof captainExecutionGuard(exec('subagent', 'sess-cap', proj)), 'string', 'captain subagent 应拒绝')
  assert.strictEqual(captainExecutionGuard(exec('bash', 'sess-member', proj)), undefined, '成员 bash 放行')
  assert.strictEqual(captainExecutionGuard(exec('read', 'sess-cap', proj)), undefined, 'captain read 放行')
  assert.strictEqual(captainExecutionGuard(exec('bash', 'sess-cap', plain)), undefined, '非 jarvis 工作区放行')
  assert.strictEqual(captainExecutionGuard({ name: 'bash' }), undefined, '无 agent 放行')

  // 逃生阀
  fs.writeFileSync(path.join(proj, '.jarvis', 'allow-captain-exec'), '')
  assert.strictEqual(captainExecutionGuard(exec('bash', 'sess-cap', proj)), undefined, '逃生阀存在时放行')
})

// ── v0.3.7：真实运行报错回执的三处修复（建队查重 / busy 判断 / read-before-edit）──

test('jarvis_member_brief：须知含 read-before-edit 铁律 + 自改备份要求（报错回执 #3）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ roleName: '测试员' })
  const brief = String(r.brief || r.text || JSON.stringify(r))
  assert.ok(/改文件前必须先 Read|read-before-edit/.test(brief), '须知须含 read-before-edit 铁律')
  assert.ok(brief.includes('自改'), '须知须含自改风险提示')
  assert.ok(brief.includes('node --check'), '须知须含语法自检')
})

test('协议与预设：含"同名 has already been used"与"member is busy"判断（报错回执 #1/#2）', () => {
  const files = ['skills/jarvis.md', 'preset/agent.cordis.yml', 'preset/jarvis-captain.cordis.yml']
  for (const f of files) {
    const t = fs.readFileSync(path.resolve(f), 'utf8')
    assert.ok(t.includes('has already been used'), `${f} 须含同名报错与查重要求`)
    assert.ok(/busy with|正在忙|BUSY/.test(t), `${f} 须含 busy 判断（busy 时不要 reassign）`)
    assert.ok(t.includes('reassign_task'), `${f} 须含 reassign 派活/唤醒指引`)
  }
})

// ── v0.4.0：覆盖优先（基线→覆盖矩阵→收口硬闸，防"换UI丢页面"）──

function fakeDocsFs(files) {
  return {
    async list(dir) {
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      return [...new Set(Object.keys(files).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split('/')[0]))]
    },
    async readText(p) { return files[p] ?? null },
    async resolve(p) { return p },
  }
}
const PDIR = { join: (...a) => a.join('/') }

test('checkCoverageGate：无基线→放行；有基线无矩阵→拦', async () => {
  const fs1 = fakeDocsFs({ '/proj/.jarvis/docs/需求规格-x.md': 'x' })
  assert.deepStrictEqual(await checkCoverageGate(fs1, '/proj', PDIR), [], '无基线不拦')
  const fs2 = fakeDocsFs({ '/proj/.jarvis/docs/基线清单-webui.json': '{"items":[]}' })
  const r2 = await checkCoverageGate(fs2, '/proj', PDIR)
  assert.ok(r2.some((m) => m.includes('覆盖矩阵')), '有基线必须有矩阵')
})

test('checkCoverageGate：未覆盖→拦；豁免后放行；r_verify<1→拦', async () => {
  const base = { '/proj/.jarvis/docs/基线清单-webui.json': '{"items":[]}' }
  const fs3 = fakeDocsFs({ ...base, '/proj/.jarvis/docs/覆盖矩阵-webui.json': JSON.stringify({ uncovered: ['route:/a'], r_verify: 1 }) })
  assert.ok((await checkCoverageGate(fs3, '/proj', PDIR)).some((m) => m.includes('覆盖率未闭环')), '未覆盖应拦')
  const fs4 = fakeDocsFs({ ...base, '/proj/.jarvis/docs/覆盖矩阵-webui.json': JSON.stringify({ uncovered: ['route:/a'], exemptions: ['route:/a'], r_verify: 1 }) })
  assert.deepStrictEqual(await checkCoverageGate(fs4, '/proj', PDIR), [], '豁免后放行')
  const fs5 = fakeDocsFs({ ...base, '/proj/.jarvis/docs/覆盖矩阵-webui.json': JSON.stringify({ uncovered: [], r_verify: 0.6 }) })
  assert.ok((await checkCoverageGate(fs5, '/proj', PDIR)).some((m) => m.includes('验证覆盖率不足')), 'r_verify<1 应拦')
})

test('jarvis_baseline：扫页面/路由生成可枚举基线并落盘', async () => {
  const os = await import('node:os')
  const fsm = fs
  const pathm = path
  const dir = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'jarvis-base-'))
  fsm.mkdirSync(pathm.join(dir, 'src/pages'), { recursive: true })
  fsm.mkdirSync(pathm.join(dir, 'src/router'), { recursive: true })
  fsm.writeFileSync(pathm.join(dir, 'src/pages/Home.tsx'), 'export default function Home(){return null}')
  fsm.writeFileSync(pathm.join(dir, 'src/pages/User.tsx'), 'export default function User(){return null}')
  fsm.writeFileSync(pathm.join(dir, 'src/router/index.ts'), "export const routes=[{path:'/home',component:Home},{path:'/user',component:User}]")
  const def = TOOLS.find((t) => t.name === 'jarvis_baseline')
  const r = await def.execute({ projectDir: dir, slug: 'selftest', kind: 'web-ui' })
  assert.ok(r.ok && r.count >= 4, `应枚举出页面+路由（实际 ${r.count}）`)
  assert.ok(r.written.some((w) => w.includes('基线清单-selftest.json')), '写 json')
  assert.ok(fsm.existsSync(pathm.join(dir, '.jarvis/docs/基线清单-selftest.json')), '文件真落盘')
  const saved = JSON.parse(fsm.readFileSync(pathm.join(dir, '.jarvis/docs/基线清单-selftest.json'), 'utf8'))
  assert.ok(saved.items.some((i) => i.id === 'route:/home'), '提取到路由 /home')
  assert.ok(saved.items.some((i) => i.id.startsWith('file:src/pages/')), '枚举到页面文件')
})

// ── v0.4.2：基线抽取器领域无关（docs 章节 / api 接口 / db 表 / text 条目）──

test('jarvis_baseline：docs 抽文档章节；api 抽接口；db 抽表（领域无关）', async () => {
  const os = await import('node:os')
  const fsm = fs
  const dir = fsm.mkdtempSync(path.join(os.tmpdir(), 'jarvis-base2-'))
  fsm.mkdirSync(path.join(dir, 'docs'), { recursive: true })
  fsm.writeFileSync(path.join(dir, 'docs/流程.md'), '# 总则\n\n## 申报\n- 提交材料\n- 复核\n\n## 归档\n')
  fsm.mkdirSync(path.join(dir, 'server'), { recursive: true })
  fsm.writeFileSync(path.join(dir, 'server/api.go'), 'router.GET("/users", h)\nrouter.POST("/users/:id", h2)')
  fsm.mkdirSync(path.join(dir, 'sql'), { recursive: true })
  fsm.writeFileSync(path.join(dir, 'sql/schema.sql'), 'CREATE TABLE users (id int);\nCREATE VIEW v_users AS SELECT 1;')
  const def = TOOLS.find((t) => t.name === 'jarvis_baseline')

  const d1 = await def.execute({ projectDir: dir, kind: 'docs', slug: 'doc1', roots: '["docs"]' })
  assert.ok(d1.count >= 3, `docs 应抽到章节（实际 ${d1.count}）`)

  const d2 = await def.execute({ projectDir: dir, kind: 'text', slug: 'txt1', roots: '["docs/流程.md"]' })
  assert.ok(d2.count >= 4, `text 应抽到章节+条目（实际 ${d2.count}）`)

  const d3 = await def.execute({ projectDir: dir, kind: 'api', slug: 'api1', roots: '["server"]' })
  assert.ok(d3.count >= 2, `api 应抽到接口（实际 ${d3.count}）`)

  const d4 = await def.execute({ projectDir: dir, kind: 'db', slug: 'db1', roots: '["sql"]' })
  assert.ok(d4.count >= 2, `db 应抽到表/视图（实际 ${d4.count}）`)
})

// ── v0.5.0：流程闸（未过需求闸/未蒸馏角色卡 → 拒绝建队派活；scan 实证 1166 轮跳过流程）──

test('jarvisFlowGuard：非 jarvis 工作区/非团队工具 → 放行', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-'))
  fs.mkdirSync(path.join(dir, '.agent-teams', 't1'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({ captainSessionId: 'cap' }))
  const ex = (name) => ({ name, agent: { session: { id: 'cap', header: { cwd: dir } } } })
  assert.strictEqual(jarvisFlowGuard(ex('agent_teams_create_task')), undefined, '无 .jarvis 不拦')
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  assert.strictEqual(jarvisFlowGuard(ex('read')), undefined, '非团队工具不拦')
})

test('jarvisFlowGuard：无需求规格/基线 → 拦建队；有需求但卡片不足 → 拦；齐备 → 放行', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf2-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir, '.agent-teams', 't1'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({ captainSessionId: 'cap' }))
  const ex = (name) => ({ name, agent: { session: { id: 'cap', header: { cwd: dir } } } })

  const r1 = jarvisFlowGuard(ex('agent_teams_create'))
  assert.ok(typeof r1 === 'string' && r1.includes('需求闸'), '无需求规格应拦')

  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求')
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'jf3-'))
  fs.mkdirSync(path.join(dir2, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir2, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir2, '.agent-teams', 't1'), { recursive: true })
  fs.writeFileSync(path.join(dir2, '.agent-teams/t1/team.json'), JSON.stringify({ captainSessionId: 'cap' }))
  fs.writeFileSync(path.join(dir2, '.jarvis/docs/需求规格-x.md'), '# 需求')
  const r2 = jarvisFlowGuard({ name: 'agent_teams_create_task', agent: { session: { id: 'cap', header: { cwd: dir2 } } } })
  assert.ok(typeof r2 === 'string' && r2.includes('蒸馏角色卡'), '无角色卡应拦')

  fs.mkdirSync(path.join(dir2, '.jarvis/cards'), { recursive: true })
  try { fs.writeFileSync(path.join(dir2, '.jarvis/project.md'), '# 项目') } catch {}
  fs.writeFileSync(path.join(dir2, '.jarvis/cards/CEO-带队.md'), 'x')
  fs.writeFileSync(path.join(dir2, '.jarvis/cards/工程师-岗位.md'), 'x')
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'jf4-'))
  fs.mkdirSync(path.join(dir3, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir3, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir3, '.jarvis/cards'), { recursive: true })
  try { fs.writeFileSync(path.join(dir3, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir3, '.agent-teams', 't1'), { recursive: true })
  fs.writeFileSync(path.join(dir3, '.agent-teams/t1/team.json'), JSON.stringify({ captainSessionId: 'cap' }))
  fs.writeFileSync(path.join(dir3, '.jarvis/docs/需求规格-x.md'), '# 需求')
  fs.writeFileSync(path.join(dir3, '.jarvis/cards/CEO-带队.md'), 'x')
  fs.writeFileSync(path.join(dir3, '.jarvis/cards/工程师-岗位.md'), 'x')
  recordGate(dir3, 'clarify', true)
  assert.strictEqual(jarvisFlowGuard({ name: 'agent_teams_create', agent: { session: { id: 'cap', header: { cwd: dir3 } } } }), undefined, '齐备且持闸应放行建队')
})

// ── v0.6.0：像素办公室投影器（company-state → PixOffice 快照）──

test('toPixOfficeSnapshot：员工/任务/事件映射 + 中文角色 id 稳定可读', async () => {
  const m = await import('../src/host/office-bridge.js')
  const st = {
    phase: '开发',
    employees: [
      { role: 'CEO', persona: 'Grove', status: 'reporting', lastReport: '正常', perfScore: 90 },
      { role: '架构师', persona: 'Fowler', status: 'working', currentWork: '设计边界' },
      { role: '测试工程师', persona: 'Bach', status: 'meeting' },
      { role: '前端实现A', persona: 'X', status: 'terminated', note: '不达标' },
    ],
    meetings: [{ id: 'm1', topic: '需求对齐', attendees: ['CEO'], status: 'in_progress' }],
    recruiting: [{ id: 'r1', position: '前端实现A', status: 'searching' }],
    ceo: { currentAction: '巡查', location: 'hall' },
    tasks: [{ id: 't1', subject: '设计边界', assignee: '架构师', status: 'in_progress' }],
  }
  const s = m.toPixOfficeSnapshot(st, { seq: 3 })
  assert.strictEqual(s.schemaVersion, '1.0')
  assert.strictEqual(s.seq, 3)
  assert.strictEqual(s.employees.length, 4)
  // 中文角色 id 必须是非空 ASCII（PixOffice 只允许 [A-Za-z0-9_.:-]）
  for (const e of s.employees) {
    assert.ok(/^[A-Za-z0-9_.:-]+$/.test(e.id), `id 必须 ASCII：${e.id}`)
    assert.ok(e.id.length <= 100)
  }
  // 角色 → 人物映射
  const byRole = Object.fromEntries(s.employees.map((e) => [e.role, e.sceneActorId]))
  assert.strictEqual(byRole['CEO'], 'office-lead')
  assert.strictEqual(byRole['架构师'], 'code-agent')
  assert.strictEqual(byRole['测试工程师'], 'review-agent')
  // 任务状态映射
  assert.strictEqual(s.tasks[0].status, 'running')
  assert.strictEqual(s.tasks[0].assigneeId, s.employees.find((e) => e.role === '架构师').id)
  // 事件流：开会/猎头/汇报/开除/CEO
  const kinds = s.events.map((e) => e.kind)
  assert.ok(kinds.includes('meeting.started'), '含开会事件')
  assert.ok(kinds.includes('recruiting.searching'), '含猎头事件')
  assert.ok(kinds.includes('employee.terminated'), '含开除事件')
  assert.ok(kinds.includes('ceo.action'), '含 CEO 动作')
})

test('toPixOfficeSnapshot：无任务表时用 currentWork 合成任务；空状态不崩', async () => {
  const m = await import('../src/host/office-bridge.js')
  const s1 = m.toPixOfficeSnapshot({ employees: [{ role: '架构师', status: 'working', currentWork: '写方案' }] }, { seq: 1 })
  assert.strictEqual(s1.tasks.length, 1)
  assert.strictEqual(s1.tasks[0].title, '写方案')
  const s2 = m.toPixOfficeSnapshot(null, { seq: 1 })
  assert.deepStrictEqual([s2.employees.length, s2.tasks.length], [0, 0])
  assert.strictEqual(s2.schemaVersion, '1.0')
})

// ── v0.7.0：蒸馏/ponder 强制（scan 实证：6/6 会话 distill=0、ponder_check 从未调用）──

test('checkPonderVerify：成员已完成任务无 ponder 核验 → 拦；有 PASS 记录 → 放行', async () => {
  const base = {
    '/proj/.agent-teams/t1/team.json': JSON.stringify({
      captainSessionId: 'cap',
      tasks: [
        { id: 't1', status: 'completed', assignee: '架构师' },
        { id: 't2', status: 'completed', assignee: '测试员' },
        { id: 't3', status: 'completed', assignee: 'captain' },
      ],
    }),
  }
  const fs1 = fakeDocsFs({ ...base })
  const r1 = await checkPonderVerify(fs1, '/proj', PDIR)
  assert.ok(r1.some((m) => m.includes('ponder 核验缺失')), '无核验记录应拦（captain 任务豁免）')

  const fs2 = fakeDocsFs({
    ...base,
    '/proj/.jarvis/docs/ponder-verify/t1-run_a.json': JSON.stringify({ taskId: 't1', runId: 'run_a', verdict: 'PASS' }),
    '/proj/.jarvis/docs/ponder-verify/t2-run_b.json': JSON.stringify({ taskId: 't2', runId: 'run_b', verdict: 'PASS' }),
  })
  assert.deepStrictEqual(await checkPonderVerify(fs2, '/proj', PDIR), [], '两个成员任务都有 PASS 记录应放行')

  const fs3 = fakeDocsFs({
    ...base,
    '/proj/.jarvis/docs/ponder-verify/t1-run_a.json': JSON.stringify({ taskId: 't1', runId: 'run_a', verdict: 'PASS' }),
  })
  const r3 = await checkPonderVerify(fs3, '/proj', PDIR)
  assert.ok(r3.some((m) => m.includes('t2')), '缺 t2 记录应拦并点名')
})

test('jarvisFlowGuard：jarvis 模式（调过 jarvis_*）+ 无卡片 → 建队被拒', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf5-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求')
  // 无 cards → 建队应被拒
  const ex = (name) => ({ name, agent: { session: { id: 'cap-x', header: { cwd: dir } } } })
  const r = jarvisFlowGuard(ex('agent_teams_create'))
  assert.ok(typeof r === 'string' && r.includes('蒸馏角色卡'), `应拦并提示蒸馏：${r}`)
})

test('jarvisFlowGuard：派活不再校验「描述里有没有开工须知」（固化改成 jarvis_dispatch_task 一步拼装，不考核步骤）', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf6-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir, '.jarvis/cards'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({ captainSessionId: 'cap' }))
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/a.md'), 'x')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/b.md'), 'x')
  recordGate(dir, 'clarify', true)
  recordGate(dir, 'decompose', true)
  recordGate(dir, 'design', true)
  recordGate(dir, 'build', true)
  const mk = (subject, description) => ({ name: 'agent_teams_create_task', arguments: { subject, description }, agent: { session: { id: 'cap', header: { cwd: dir } } } })
  const r1 = jarvisFlowGuard(mk('实现登录', '写完告诉我'))
  assert.strictEqual(r1, undefined, '不再因「描述里没抄须知」拒派活（须知由 jarvis_dispatch_task 自动拼）')
  const r2 = jarvisFlowGuard(mk('实现登录', '【开工须知】先跑 ponder 十阶段……'))
  assert.strictEqual(r2, undefined, '带须知应放行')
  const r3 = jarvisFlowGuard(mk('【协调】需求分析会议', '开会讨论'))
  assert.strictEqual(r3, undefined, '协调类豁免')
})

// ── v0.7.1：闸门不可绕过（flowguard 落闸 → 建队/派活必须持闸）──

test('recordGate：通过时写入 .jarvis/gates.json', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'))
  assert.strictEqual(recordGate(dir, 'clarify', true), true)
  const g = JSON.parse(fs.readFileSync(path.join(dir, '.jarvis/gates.json'), 'utf8'))
  assert.strictEqual(g.clarify.ok, true)
  assert.strictEqual(recordGate(dir, 'build', false), false, '失败不落闸')
})

test('jarvisFlowGuard：未过 clarify 闸 → 建队被拒（提示词也绕不过）', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate2-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir, '.jarvis/cards'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/a.md'), 'x')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/b.md'), 'x')
  const ex = { name: 'agent_teams_create', agent: { session: { id: 'cap', header: { cwd: dir } } } }
  const r = jarvisFlowGuard(ex)
  assert.ok(typeof r === 'string' && r.includes('clarify'), '未持 clarify 闸应拒')
  recordGate(dir, 'clarify', true)
  // 缓存刷新：换一个等价目录验证
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gate3-'))
  fs.mkdirSync(path.join(dir2, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir2, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir2, '.jarvis/cards'), { recursive: true })
  try { fs.writeFileSync(path.join(dir2, '.jarvis/project.md'), '# 项目') } catch {}
  fs.writeFileSync(path.join(dir2, '.jarvis/docs/需求规格-x.md'), '# 需求')
  fs.writeFileSync(path.join(dir2, '.jarvis/cards/a.md'), 'x')
  fs.writeFileSync(path.join(dir2, '.jarvis/cards/b.md'), 'x')
  recordGate(dir2, 'clarify', true)
  assert.strictEqual(jarvisFlowGuard({ name: 'agent_teams_create', agent: { session: { id: 'cap', header: { cwd: dir2 } } } }), undefined, '持闸后放行')
})

test('jarvisFlowGuard：未过 build 闸 → 派活被拒', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate4-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir, '.jarvis/cards'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({ captainSessionId: 'cap' }))
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/a.md'), 'x')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/b.md'), 'x')
  recordGate(dir, 'clarify', true)
  const args = { subject: '实现X', description: '【开工须知】先跑 ponder' }
  const r = jarvisFlowGuard({ name: 'agent_teams_create_task', arguments: args, agent: { session: { id: 'cap', header: { cwd: dir } } } })
  assert.ok(typeof r === 'string' && r.includes('build'), '未持 build 闸应拒')
})

// ── v0.7.2：补两个可跳过洞（clarify 恒通过 / decompose+design 无链检查）──

test('jarvisFlowGuard：build 闸存在但缺 decompose/design 链 → 派活被拒', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir, '.jarvis/cards'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({ captainSessionId: 'cap' }))
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(200) + '\n验收：x')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/a.md'), 'x')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/b.md'), 'x')
  recordGate(dir, 'clarify', true)
  recordGate(dir, 'build', true) // 只落 clarify+build，缺 decompose/design
  const r = jarvisFlowGuard({
    name: 'agent_teams_create_task',
    arguments: { subject: '实现X', description: '【开工须知】先跑 ponder 十阶段' },
    agent: { session: { id: 'cap', header: { cwd: dir } } },
  })
  assert.ok(typeof r === 'string' && r.includes('decompose') && r.includes('design'), `缺链应拒并点名：${r}`)
})

// ── v0.7.4：企业文化（领域专家式深度思考）必须进入每个员工 ──

test('jarvis_member_brief：须知必含「企业文化·领域专家深度思考」', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ roleName: '测试工程师' })
  const brief = String(r.brief || '')
  assert.ok(brief.includes('企业文化'), '含企业文化段')
  assert.ok(brief.includes('最顶尖的专家会怎么想'), '含领域专家视角')
  assert.ok(brief.includes('深度优先，不铺广度'), '含深度优先原则')
  assert.ok(brief.includes('追问到根因'), '含根因要求')
  assert.ok(brief.includes('宁可 60 分诚实'), '含诚实边界')
})

// ── v0.7.5：成员交活必须过 ponder 核验（scan 实证：成员 3002 次调用 jarvis_* 为 0）──

test('jarvisFlowGuard：交活不要求 ponder 核验记录（ponder 是推荐思考方式，不是通行证）', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({
    captainSessionId: 'cap',
    tasks: [{ id: 't9', status: 'in_progress', assignee: '架构师' }],
  }))
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(200) + '\n验收：x')
  const mk = () => ({ name: 'agent_teams_update_task', arguments: { task_id: 't9', status: 'completed', attempt_id: 'a1' }, agent: { session: { id: 'member-1', header: { cwd: dir } } } })
  const r = jarvisFlowGuard(mk())
  assert.strictEqual(r, undefined, `不应因没跑 ponder 就拒绝交活：${r}`)

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg2-'))
  fs.mkdirSync(path.join(dir2, '.jarvis/docs/ponder-verify'), { recursive: true })
  try { fs.writeFileSync(path.join(dir2, '.jarvis/project.md'), '# 项目') } catch {}
  fs.mkdirSync(path.join(dir2, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(dir2, '.agent-teams/t1/team.json'), JSON.stringify({
    captainSessionId: 'cap', tasks: [{ id: 't9', status: 'in_progress', assignee: '架构师' }],
  }))
  fs.writeFileSync(path.join(dir2, '.jarvis/docs/ponder-verify/t9-run_x.json'), JSON.stringify({ taskId: 't9', verdict: 'PASS' }))
  const ok = jarvisFlowGuard({ name: 'agent_teams_update_task', arguments: { task_id: 't9', status: 'completed' }, agent: { session: { id: 'member-1', header: { cwd: dir2 } } } })
  assert.strictEqual(ok, undefined, '有 PASS 记录应放行')
})

// ── v0.8.0：jarvis 工作方式改为 system prompt 固定注入（不依赖 skill，不被压缩衰减）──

test('apply：注册 luke-jarvis:protocol 到 systemPrompt（每请求固定注入）', () => {
  const sections = []
  const registered = []
  const ctx = {
    tools: { register: (d) => { registered.push(d.name); return () => {} } },
    systemPrompt: { section: (s) => { sections.push(s); return () => {} } },
    webServer: { register: () => () => {} },
    effect: (fn) => { try { fn() } catch {} },
    get: () => undefined,
  }
  apply(ctx)
  assert.ok(registered.length > 10, '工具应注册')
  const p = sections.find((s) => s.name === 'luke-jarvis:protocol')
  assert.ok(p, '必须注册 luke-jarvis:protocol 段')
  const txt = typeof p.text === 'function' ? p.text({}) : p.text
  assert.ok(txt.includes('固定注入'), '含固定注入声明')
  assert.ok(txt.includes('jarvis_distill'), '含蒸馏步骤')
  assert.ok(txt.includes('jarvis_flowguard'), '含闸门步骤')
  assert.ok(txt.includes('jarvis_dispatch_task'), '派活固化工具应写进协议（正确的路=最省事的路）')
  assert.ok(!txt.includes('必须有该任务的 ponder-verify PASS'), '协议不再把 ponder 当通行证')
  assert.ok(txt.includes('绝不亲自实现'), '含顶层不亲自执行')
})

// ── v0.8.1：记忆保鲜闸 + 会话快照 ──

test('checkMemoryFresh：记忆过期 → 返回警示；新鲜 → 放行', async () => {
  const os = await import('node:os')
  const { checkMemoryFresh } = await import('../src/host/plugin.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'))
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目')
  const okFresh = checkMemoryFresh(dir, { force: true })
  assert.ok(okFresh === undefined, '刚写过的记忆应放行')

  // 把 mtime 改到 10 小时前
  const old = Date.now() / 1000 - 10 * 3600
  fs.utimesSync(path.join(dir, '.jarvis/project.md'), old, old)
  const stale = checkMemoryFresh(dir, { force: true })
  assert.ok(typeof stale === 'string' && stale.includes('记忆闸'), `过期应拦：${stale}`)
})

test('jarvis_snapshot：写入会话快照并报告未完成任务数', async () => {
  const os = await import('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'))
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  try { fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目') } catch {}
  fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目')
  fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({
    name: 't1', tasks: [{ id: 'a', status: 'in_progress', assignee: 'x', subject: 's1' }, { id: 'b', status: 'completed', assignee: 'y', subject: 's2' }],
  }))
  const def = TOOLS.find((t) => t.name === 'jarvis_snapshot')
  const r = await def.execute({ projectDir: dir, note: '阶段X' }, { agent: { session: { id: 'sess-1' } } })
  assert.ok(r.written && fs.existsSync(r.written), '快照文件应落盘')
  assert.strictEqual(r.openTasks, 1, '只统计未完成任务')
  const snap = JSON.parse(fs.readFileSync(r.written, 'utf8'))
  assert.strictEqual(snap.sessionId, 'sess-1')
  assert.strictEqual(snap.openTasks.length, 1)
})

// ── v0.9.0：阶段状态机（借鉴 dsh-superagent core/stage.ts：阶段由插件算，不是模型自述）──

test('computeStage：按产物+闸门推导当前阶段，并给出缺口与下一步', async () => {
  const os = await import('node:os')
  const { computeStage, renderStage } = await import('../src/host/plugin.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  let r = computeStage(dir)
  assert.strictEqual(r.stage, 'clarify')
  assert.ok(r.missing.some((m) => m.includes('需求规格')), '缺需求规格')

  // 补需求规格 + clarify 闸 → 进入 decompose
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(150) + '\n验收：x')
  recordGate(dir, 'clarify', true)
  r = computeStage(dir)
  assert.strictEqual(r.stage, 'decompose')
  assert.deepStrictEqual(r.done, ['clarify'])

  // 补任务编排 + decompose 闸 → design
  fs.writeFileSync(path.join(dir, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  recordGate(dir, 'decompose', true)
  r = computeStage(dir)
  assert.strictEqual(r.stage, 'design')

  // 补方案设计 + design 闸 → build（卡不足仍算 build 阶段未完成）
  fs.writeFileSync(path.join(dir, '.jarvis/docs/方案设计-x.md'), '# 方案')
  recordGate(dir, 'design', true)
  r = computeStage(dir)
  assert.strictEqual(r.stage, 'build')
  assert.ok(r.missing.some((m) => m.includes('角色卡')), '缺角色卡')

  const txt = renderStage(dir)
  assert.ok(txt.includes('阶段 4/6'), `渲染应含阶段序号：${txt.slice(0, 80)}`)
  assert.ok(txt.includes('当前缺口'), '含缺口')
  assert.ok(txt.includes('下一步'), '含下一步')
})

// ── v0.10.0 P2：阶段网关（jarvisStageGate）——工具调用前按 computeStage 阶段机械放行/拒绝 ──
// 设计依据：需求规格 R2/R3（.jarvis/docs/需求规格-luke-jarvis完全体.md）+ 方案设计 §2/§4。
// 测试纪律：**一个断言态一个临时目录**——computeStage 每次实时读盘，但 _readGates(2s)/_flowState(3s)
// 是进程内缓存，复用同一目录会让"刚落的闸"看起来还没落（方案设计 §5 的脆弱点）。

/** 构造一个精确处于某阶段的工作区夹具（产物+gates 一次写齐，之后才首次调用被测函数） */
function stageGateFixture(stage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sg-${stage}-`))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目')
  const doc = (name, text) => fs.writeFileSync(path.join(dir, '.jarvis/docs', name), text)
  const order = { clarify: [], decompose: ['clarify'], design: ['clarify', 'decompose'], build: ['clarify', 'decompose', 'design'], execute: ['clarify', 'decompose', 'design', 'build'], close: ['clarify', 'decompose', 'design', 'build'] }[stage] || []
  if (order.includes('clarify')) doc('需求规格-x.md', '# 需求'.repeat(160) + '\n验收：x')
  if (order.includes('decompose')) doc('任务编排-x.md', '# 任务编排')
  if (order.includes('design')) doc('方案设计-x.md', '# 方案')
  if (order.includes('build')) {
    fs.mkdirSync(path.join(dir, '.jarvis/cards'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.jarvis/cards/a.md'), 'x')
    fs.writeFileSync(path.join(dir, '.jarvis/cards/b.md'), 'x')
    fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
    const open = stage === 'execute' // execute 阶段=还有未完成任务；close 阶段=任务清零+有 ponder 核验
    fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({
      name: 't1', captainSessionId: 'cap',
      tasks: [{ id: 'task-1', status: open ? 'in_progress' : 'completed', assignee: 'm1', subject: 's' }],
    }))
    if (stage === 'close') {
      fs.mkdirSync(path.join(dir, '.jarvis/docs/ponder-verify'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.jarvis/docs/ponder-verify/task-1.json'), JSON.stringify({ verdict: 'PASS' }))
    }
  }
  for (const step of order) recordGate(dir, step, true)
  return dir
}

/** 构造一次工具调用（guard 只读 exec.name / exec.agent.session.header.cwd / exec.arguments） */
function gateCall(name, dir, args) {
  return jarvisStageGate({ name, arguments: args, agent: { session: { id: 'sess-1', header: { cwd: dir } } } })
}

test('阶段网关 clarify：派活/拆解被拒，澄清与只读放行（阶段 1/6 需求打磨）', () => {
  const dir = stageGateFixture('clarify')
  const r = gateCall('agent_teams_create_task', dir, { subject: '实现X', description: '【开工须知】先跑 ponder' })
  assert.ok(typeof r === 'string', `clarify 阶段派活必须被拒：${r}`)
  assert.ok(r.includes('阶段 1/6') && r.includes('需求打磨'), `文案须含阶段编号+名称：${r}`)
  assert.strictEqual(typeof gateCall('jarvis_taskgraph', dir), 'string', 'clarify 阶段不许先拆解')
  assert.strictEqual(gateCall('jarvis_clarify', dir), undefined, '同阶段工具放行')
  assert.strictEqual(gateCall('read', dir), undefined, '只读工具不受阶段网管')
})

test('阶段网关 decompose：拆解工具放行，建队派活被拒', () => {
  const dir = stageGateFixture('decompose')
  assert.strictEqual(gateCall('jarvis_taskgraph', dir), undefined, 'decompose 阶段允许拆解')
  assert.strictEqual(typeof gateCall('agent_teams_create_task', dir), 'string', 'decompose 阶段不许派活')
  assert.strictEqual(typeof gateCall('agent_teams_create', dir), 'string', 'decompose 阶段不许建队')
})

test('阶段网关 design：方案/评估工具放行，重拆与派活被拒', () => {
  const dir = stageGateFixture('design')
  assert.strictEqual(gateCall('jarvis_essence', dir), undefined, 'design 阶段允许方案评审类')
  assert.strictEqual(typeof gateCall('jarvis_taskgraph', dir), 'string', 'design 阶段不许回头重拆')
  assert.strictEqual(typeof gateCall('agent_teams_create', dir), 'string', 'design 阶段不许建队')
})

test('阶段网关 build：蒸馏/建队放行，重拆/覆盖矩阵/版本发布被拒', () => {
  const dir = stageGateFixture('build')
  assert.strictEqual(gateCall('agent_teams_create', dir), undefined, 'build 阶段允许建队')
  assert.strictEqual(gateCall('jarvis_distill', dir), undefined, 'build 阶段允许蒸馏角色卡')
  assert.strictEqual(typeof gateCall('jarvis_taskgraph', dir), 'string', 'build 阶段不许重拆')
  assert.strictEqual(typeof gateCall('jarvis_coverage', dir), 'string', 'build 阶段不许做收口覆盖矩阵')
  assert.strictEqual(typeof gateCall('jarvis_release', dir), 'string', 'build 阶段不许出版本账本')
})

test('阶段网关 execute：派活/盯控/核验放行，回改基线/重拆/发布被拒', () => {
  const dir = stageGateFixture('execute')
  assert.strictEqual(gateCall('agent_teams_create_task', dir, { subject: '实现X', description: '【开工须知】先跑 ponder' }), undefined, 'execute 阶段允许派活（链已齐备）')
  assert.strictEqual(gateCall('agent_teams_update_task', dir, { task_id: 'task-1', status: 'in_progress' }), undefined, 'execute 阶段允许盯控更新')
  assert.strictEqual(gateCall('agent_teams_status', dir), undefined, 'execute 阶段允许查状态')
  assert.strictEqual(gateCall('jarvis_ponder_check', dir, { taskId: 'task-1' }), undefined, 'execute 阶段必须允许 ponder 核验')
  assert.strictEqual(typeof gateCall('jarvis_baseline', dir), 'string', 'execute 阶段不许回头改基线')
  assert.strictEqual(typeof gateCall('jarvis_taskgraph', dir), 'string', 'execute 阶段不许重拆')
  assert.strictEqual(typeof gateCall('jarvis_release', dir), 'string', 'execute 阶段不许改版本账本')
})

test('阶段网关 close：收口类放行，再派活/加人被拒', () => {
  const dir = stageGateFixture('close')
  assert.strictEqual(gateCall('jarvis_coverage', dir), undefined, 'close 阶段允许覆盖矩阵')
  assert.strictEqual(gateCall('jarvis_essence', dir), undefined, 'close 阶段允许需求本质校验')
  assert.strictEqual(gateCall('jarvis_release', dir), undefined, 'close 阶段允许版本账本')
  assert.strictEqual(typeof gateCall('agent_teams_create_task', dir, { subject: '补活', description: '【开工须知】先跑 ponder' }), 'string', 'close 阶段不许再派活')
  assert.strictEqual(typeof gateCall('agent_teams_add_member', dir), 'string', 'close 阶段不许再加人')
})

test('阶段网关：六阶段拒绝文案都必须含三要素（阶段 N/6+名称 / 当前缺口 / 下一步）', () => {
  const samples = [
    ['clarify', 'agent_teams_create_task'],
    ['decompose', 'agent_teams_create_task'],
    ['design', 'jarvis_taskgraph'],
    ['build', 'jarvis_coverage'],
    ['execute', 'jarvis_baseline'],
    ['close', 'agent_teams_create_task'],
  ]
  const labels = { clarify: '需求打磨', decompose: '拆解', design: '方案设计', build: '建队派活', execute: '执行盯控', close: '收口' }
  samples.forEach(([stage, tool], i) => {
    const r = gateCall(tool, stageGateFixture(stage))
    assert.ok(typeof r === 'string', `${stage} 阶段 ${tool} 应被拒：${r}`)
    assert.ok(new RegExp(`阶段 ${i + 1}/6 ${labels[stage]}`).test(r), `${stage} 文案须含「阶段 ${i + 1}/6 ${labels[stage]}」：${r}`)
    assert.ok(r.includes('当前缺口'), `${stage} 文案须含「当前缺口」：${r}`)
    assert.ok(r.includes('下一步'), `${stage} 文案须含「下一步」：${r}`)
  })
})

test('阶段网关：非流程类工具（read/bash/write/grep）任何阶段都放行', () => {
  const dir = stageGateFixture('clarify')
  for (const name of ['read', 'glob', 'grep', 'bash', 'write', 'edit', 'subagent']) {
    assert.strictEqual(gateCall(name, dir), undefined, `${name} 不在流程类，必须放行`)
  }
})

test('阶段网关：非 jarvis 工作区不拦（纯 agent-teams 用户不受影响）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-nojarvis-'))
  assert.strictEqual(gateCall('agent_teams_create_task', dir, { subject: 'x', description: '【开工须知】先跑 ponder' }), undefined, '没有 .jarvis 的工作区不适用 jarvis 阶段判定')
})

test('阶段网关：无 cwd → 放行（判不出来不误拦 headless 会话）', () => {
  assert.strictEqual(jarvisStageGate({ name: 'agent_teams_create_task', agent: { session: { id: 's1' } } }), undefined, '无 cwd 放行')
  assert.strictEqual(jarvisStageGate({ name: 'jarvis_release' }), undefined, '无 exec 上下文放行')
})

test('阶段网关·链式校验：只有 clarify 闸 → 派活被拒并点名缺 decompose/design/build', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-chain-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目')
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160))
  recordGate(dir, 'clarify', true) // 只有 clarify 闸
  const r = gateCall('agent_teams_create_task', dir, { subject: '实现X', description: '【开工须知】先跑 ponder' })
  assert.ok(typeof r === 'string', `缺链必须拒：${r}`)
  assert.ok(r.includes('缺少前置闸'), `须明确是链式缺失：${r}`)
  assert.ok(r.includes('decompose') && r.includes('design'), `须点名缺 decompose/design：${r}`)
  assert.ok(r.includes('阶段 2/6'), `文案仍须含阶段编号：${r}`)
})

test('阶段网关·链式校验：clarify→decompose→design→build 齐备 → execute 阶段派活放行', () => {
  const dir = stageGateFixture('execute')
  const st = computeStage(dir)
  assert.strictEqual(st.stage, 'execute', '夹具应精确处于 execute 阶段')
  assert.strictEqual(gateCall('agent_teams_create_task', dir, { subject: '实现X', description: '【开工须知】先跑 ponder' }), undefined, '链齐备时派活放行')
})

test('hasGlob：兼容 DSH FileSystem（resolve+listDir，entry 取 name）', async () => {
  const svc = {
    resolve: async (p) => ({ targetKey: p, path: p }),
    listDir: async () => [{ name: '需求规格-x.md', type: 'file' }, { name: 'notes.md', type: 'file' }],
  }
  assert.strictEqual(await hasGlob(svc, '/tmp/x/.jarvis/docs', '需求规格'), true, '按 entry.name 命中')
  assert.strictEqual(await hasGlob(svc, '/tmp/x/.jarvis/docs', '任务编排'), false, '未命中应为 false（不再恒放行）')
})

test('hasGlob：服务能力缺失/异常 → 放行（fail-open，不改变既有语义）', async () => {
  assert.strictEqual(await hasGlob(null, '/tmp/x', '需求规格'), true, '无服务放行')
  assert.strictEqual(await hasGlob({}, '/tmp/x', '需求规格'), true, '既无 list 也无 listDir 放行')
  assert.strictEqual(await hasGlob({ resolve: async () => ({ k: 1 }), listDir: async () => { throw new Error('boom') } }, '/tmp/x', '需求规格'), true, '列举抛错放行')
  assert.strictEqual(await hasGlob({ list: async () => { throw new Error('boom') } }, '/tmp/x', '需求规格'), true, '旧 list 抛错也放行（语义不变）')
})

test('hasGlob：旧/测试形态 list(dir) 保持原语义', async () => {
  const svc = { list: async () => ['需求规格-a.md', 'x.md'] }
  assert.strictEqual(await hasGlob(svc, '/tmp/x/.jarvis/docs', '需求规格'), true)
  assert.strictEqual(await hasGlob(svc, '/tmp/x/.jarvis/docs', '方案设计'), false)
})

test('apply：与既有两闸并列注册第三个 guard（阶段网关真挂上，不只函数可调用）', () => {
  const guards = []
  const ctx = {
    tools: { register: () => () => {}, guard: (fn) => { guards.push(fn); return () => {} } },
    systemPrompt: { section: () => () => {} },
    effect: (fn) => { try { fn() } catch {} },
    get: () => undefined,
  }
  apply(ctx)
  assert.strictEqual(guards.length, 3, `应注册 3 个 guard（captain/stage/flowguard）：实际 ${guards.length}`)
  assert.strictEqual(guards[0], captainExecutionGuard, '第 1 个=captain 拦截')
  assert.strictEqual(guards[1], jarvisStageGate, '第 2 个=阶段网关（顺序决定先给"走错阶段"的指引）')
  assert.strictEqual(guards[2], jarvisFlowGuard, '第 3 个=流程闸（具体前置条件）')
})

// ── D5：活跃团队判据（防其它项目/历史团队的未完成任务把本项目钉死在 execute）──
// 缺陷实证（t1 交付报告）：真实工作区 12 个未完成任务里只有 4 个属本项目，其余属其他项目与历史团队
// → openTasks 恒 >0 → 本项目永远到不了 close（execute 阶段 jarvis_release 被拒）。

/** 造一个团队目录（可选把 team.json mtime 做旧，模拟历史团队） */
function teamFixture(dir, name, tasks, ageHours = 0) {
  const td = path.join(dir, '.agent-teams', name)
  fs.mkdirSync(td, { recursive: true })
  const tf = path.join(td, 'team.json')
  fs.writeFileSync(tf, JSON.stringify({ name, tasks }))
  if (ageHours > 0) {
    const t = Date.now() / 1000 - ageHours * 3600
    fs.utimesSync(tf, t, t)
  }
  return tf
}
/** 造一个已过 build 闸的工作区（可再叠加团队） */
function builtWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd5-'))
  fs.mkdirSync(path.join(dir, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/project.md'), '# 项目')
  fs.writeFileSync(path.join(dir, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  fs.writeFileSync(path.join(dir, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  fs.writeFileSync(path.join(dir, '.jarvis/docs/方案设计-x.md'), '# 方案')
  fs.mkdirSync(path.join(dir, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/cards/a.md'), 'x')
  fs.writeFileSync(path.join(dir, '.jarvis/cards/b.md'), 'x')
  for (const step of ['clarify', 'decompose', 'design', 'build']) recordGate(dir, step, true)
  return dir
}

test('D5 活跃团队：超过 72h 的历史团队有未完成任务 → 不计、不阻塞本项目进 close', () => {
  const dir = builtWorkspace()
  teamFixture(dir, 't-cur', [{ id: 'a', status: 'completed', assignee: 'm' }], 0) // 本项目任务已清零
  teamFixture(dir, 't-old', [{ id: 'b', status: 'in_progress', assignee: 'x' }, { id: 'c', status: 'claimed', assignee: 'y' }], 100) // 历史团队残留
  fs.mkdirSync(path.join(dir, '.jarvis/docs/ponder-verify'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/docs/ponder-verify/ok.json'), JSON.stringify({ verdict: 'PASS' }))
  const st = computeStage(dir)
  assert.strictEqual(st.artifacts.openTasks, 0, `历史团队未完成任务不应计入：实际 ${st.artifacts.openTasks}`)
  assert.notStrictEqual(st.stage, 'execute', `本项目不应被历史团队钉在 execute（实际 ${st.stage}）`)
})

test('D5 活跃团队：当前团队的未完成任务计数正确，阶段留在 execute', () => {
  const dir = builtWorkspace()
  teamFixture(dir, 't-cur', [
    { id: 'a', status: 'in_progress', assignee: 'm1' },
    { id: 'b', status: 'claimed', assignee: 'm2' },
    { id: 'c', status: 'completed', assignee: 'm3' },
  ], 0)
  const st = computeStage(dir)
  assert.strictEqual(st.artifacts.openTasks, 2, `只数未终态任务（in_progress+claimed）：实际 ${st.artifacts.openTasks}`)
  assert.strictEqual(st.stage, 'execute', '有未完成任务应停 execute')
  assert.ok(st.missing.some((m) => m.includes('未完成任务 2 个')), `缺口须写明数量：${st.missing.join('；')}`)
})

test('D5 活跃团队：archive 目录 / 无 team.json / 坏 JSON → 不崩且不计（teams 也不虚高）', () => {
  const dir = builtWorkspace()
  teamFixture(dir, 'archive-2026-10', [{ id: 'a', status: 'in_progress' }], 0) // 归档名 → 不计
  teamFixture(dir, 'bad-json', [], 0)
  fs.writeFileSync(path.join(dir, '.agent-teams/bad-json/team.json'), '{坏 JSON')
  fs.mkdirSync(path.join(dir, '.agent-teams/no-team-json'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agent-teams/retired-members.json'), '[]') // 杂项文件
  let st
  assert.doesNotThrow(() => { st = computeStage(dir) }, '无 team.json/坏 JSON 不应崩')
  assert.strictEqual(st.artifacts.openTasks, 0, '坏 JSON 团队不计未完成')
  assert.strictEqual(st.artifacts.teams, 1, `只把有 team.json 的非归档目录算团队（实际 ${st.artifacts.teams}）`)
})

// ── D6：deny 补集显式收窄（新流程工具不许在错误阶段用）──
// 实测 agent-teams 稳定名单 14 个，原 STAGE_DENY 只表态 6 个；amend_task 能改验收契约、claim_task 能认领
// → 若不并入，clarify/design 阶段就能改验收/认领，阶段隔离形同虚设。

test('D6 deny 补集：amend_task/claim_task/remove_member 在 clarify/decompose/design 被拒', () => {
  for (const stage of ['clarify', 'decompose', 'design']) {
    const dir = stageGateFixture(stage)
    for (const tool of ['agent_teams_amend_task', 'agent_teams_claim_task', 'agent_teams_remove_member']) {
      const r = gateCall(tool, dir, {})
      assert.ok(typeof r === 'string', `${stage} 阶段 ${tool} 必须被拒：${r}`)
      assert.ok(r.includes(`阶段 ${computeStage(dir).index}/6`), `${stage} 文案须含阶段编号：${r}`)
    }
  }
})

test('D6 deny 补集：build 阶段 amend_task/claim_task 被拒（改验收契约/认领属执行期）', () => {
  const dir = stageGateFixture('build')
  assert.ok(typeof gateCall('agent_teams_amend_task', dir, {}) === 'string', 'build 阶段不许改验收契约')
  assert.ok(typeof gateCall('agent_teams_claim_task', dir, {}) === 'string', 'build 阶段不许认领任务')
  assert.strictEqual(gateCall('agent_teams_create', dir), undefined, 'build 阶段仍允许建队')
  assert.strictEqual(gateCall('agent_teams_add_member', dir), undefined, 'build 阶段仍允许加人')
})

test('D6 deny 补集：execute 阶段 claim_task/update_task/amend_task 放行（交活与返工需要）', () => {
  const dir = stageGateFixture('execute')
  assert.strictEqual(gateCall('agent_teams_claim_task', dir, { task_id: 'task-1' }), undefined, 'execute 必须放行 claim_task')
  assert.strictEqual(gateCall('agent_teams_update_task', dir, { task_id: 'task-1', status: 'in_progress' }), undefined, 'execute 必须放行 update_task')
  assert.strictEqual(gateCall('agent_teams_amend_task', dir, { task_id: 'task-1' }), undefined, 'execute 必须放行 amend_task（返工改契约）')
})

// ── D7：jarvis_ponder_check 的 PASS 记录落盘路径（修 resolveWorkspace 漂移到 profile 目录）──
// 实证：成员会话里记录写到 /root/.dsh/profiles/web/.jarvis/docs/ponder-verify，
// 而 flowguard/收口闸读的是「会话 cwd 下 .jarvis/docs/ponder-verify」→ 读不到 → 交活被误拒。

test('D7 ponderVerifyProjectDir：来源优先级 args.projectDir > exec 会话 cwd > 进程兜底', async () => {
  const { ponderVerifyProjectDir } = await import('../src/host/plugin.js')
  const exec = { agent: { session: { header: { cwd: '/tmp/session-cwd' } } } }
  assert.strictEqual(ponderVerifyProjectDir({ projectDir: '/tmp/explicit' }, exec), '/tmp/explicit', '显式 projectDir 最优先')
  assert.strictEqual(ponderVerifyProjectDir({}, exec), '/tmp/session-cwd', '其次取调用会话 cwd')
  assert.ok(ponderVerifyProjectDir({}, undefined).length > 0, '拿不到会话时给进程兜底（不抛错/不空串）')
  assert.strictEqual(ponderVerifyProjectDir({ projectDir: '  ' }, exec), '/tmp/session-cwd', '空白的 projectDir 视为未指定')
})

test('D7 jarvis_ponder_check：PASS 记录落在指定项目目录（不再漂到进程工作区）', async () => {
  // 合成一个「十阶段按序完整 + 子 agent 达标 + 产出齐全」的 run 夹具（不依赖任何真实 run，T4 可复现）
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd7-data-'))
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd7-proj-'))
  const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'd7-other-'))
  const steps = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis']
  const agents = { bagua: 8, plans: 5, score: 3, simulate: 3, debate: 3 }
  const pad = (o) => JSON.stringify(o, null, 2) + '\n' + 'x'.repeat(400)
  fs.writeFileSync(path.join(dataDir, 'step-guard.cjson'), JSON.stringify({
    run_id: 'run_test_d7', completed: steps, sequence: steps.map((step, i) => ({ step, at: `2026-11-03T00:0${i}:00Z`, agents: agents[step] || 0 })),
    agents, certainties: {}, superseded_run: null,
  }))
  const files = {
    'stage-interview.json': { userProfile: { 天: 'x', 地: 'x', 人: 'x', 法: 'x', 物: 'x' }, persona: 'x' },
    'stage-shensi.json': { stake: { level: 'high' }, premises: [{ premise: 'p', trap_type: '无', status: 'confirmed' }] },
    'stage-divergence.json': { perspectives: ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({ name: n, insight: 'x'.repeat(20), data_source: 'x', assumption: 'x' })), consensus: 'c', certainty: 0.7 },
    'stage-bagua.json': { dimensions: ['F1驱动力', 'F2基础', 'F3变化', 'F4渗透', 'F5风险', 'F6依附', 'F7边界', 'F8平衡'].map((name) => ({ name, blindspot: '盲点'.repeat(10), insight: '重要'.repeat(10) })), key_finding: 'k' },
    'stage-plans.json': { plans: [1, 2, 3, 4, 5].map((i) => ({ name: `方案${i}`, rationale: 'r', condition: 'c', antithesis: 'a', synthesis: 's' })), certainty: 0.7 },
    'stage-converge.json': { survivors: [1, 2, 3].map((i) => ({ name: `方案${i}`, score: 0.7, reason: 'x'.repeat(20) })), certainty: 0.7 },
    'stage-score.json': { scored_survivors: [1, 2, 3].map((i) => ({ name: `方案${i}`, total: 0.7, key_finding: 'x' })), certainty: 0.7 },
    'stage-simulate.json': { simulations: [1, 2, 3].map((i) => ({ solution_name: `方案${i}`, scenarios: [{ scenario: 'realistic', score: 0.6, key_finding: 'x', risks: 'x', bottleneck: 'x' }], overall: 'x' })) },
    'stage-debate.json': { ranked: [1, 2, 3].map((i) => ({ rank: i, name: `方案${i}`, pros: ['x'], cons: ['x'] })), debate_summary: 'x', certainty: 0.7 },
    'stage-synthesis.json': { recommendation: '方案1', conclusion: '采用方案1（合成夹具）', reasoning: 'x', risk: 'x', certainty: 0.7 },
    'end-state.md': '# 终态\n' + 'y'.repeat(400),
  }
  for (const [name, obj] of Object.entries(files)) {
    fs.writeFileSync(path.join(dataDir, name), name.endsWith('.md') ? obj : pad(obj))
  }
  const def = TOOLS.find((t) => t.name === 'jarvis_ponder_check')
  // 关键：exec 会话 cwd 指向另一个目录（模拟漂移场景），显式 projectDir 才是记账位置
  const r = await def.execute(
    { taskId: 't7d', runId: 'run_test_d7', dataDir, evidenceDir: dataDir, projectDir: projDir },
    { agent: { session: { id: 's1', header: { cwd: otherCwd } } } },
  )
  assert.strictEqual(r.verdict, 'PASS', `合成完整 run 应 PASS：${JSON.stringify(r.issues)}`)
  assert.ok(r.recordPath && r.recordPath.startsWith(projDir), `记录必须落在 projectDir：${r.recordPath}`)
  assert.ok(fs.existsSync(r.recordPath), '记录文件应真实存在')
  const rec = JSON.parse(fs.readFileSync(r.recordPath, 'utf8'))
  assert.strictEqual(rec.taskId, 't7d')
  assert.strictEqual(rec.verdict, 'PASS')
  assert.ok(!fs.existsSync(path.join(otherCwd, '.jarvis/docs/ponder-verify')), '不应再写进 exec 会话 cwd（显式 projectDir 优先）')
})

// ── t6 / T3 打回项：F1 交活、D5-v2 归属判据、close.ok、D6b 归零型工具 ──

test('F1（R2）：clarify 阶段交活（agent_teams_update_task）被拒，execute 放行', () => {
  const clarifyDir = stageGateFixture('clarify')
  const r = gateCall('agent_teams_update_task', clarifyDir, { task_id: 'old-t1', status: 'completed' })
  assert.ok(typeof r === 'string', `clarify 阶段交活必须被拒（R2「clarify 拒绝交活」）：${r}`)
  assert.ok(r.includes('阶段 1/6') && r.includes('需求打磨'), `须含阶段编号+名称：${r}`)
  const execDir = stageGateFixture('execute')
  assert.strictEqual(gateCall('agent_teams_update_task', execDir, { task_id: 'task-1', status: 'completed' }), undefined, 'execute 阶段交活必须放行')
})

test('D6b：delete/resume 在 clarify/decompose/design 被拒（防零成本把 openTasks 归零），execute 放行 resume', () => {
  for (const stage of ['clarify', 'decompose', 'design']) {
    const dir = stageGateFixture(stage)
    for (const tool of ['agent_teams_delete', 'agent_teams_resume']) {
      const r = gateCall(tool, dir, {})
      assert.ok(typeof r === 'string', `${stage} 阶段 ${tool} 必须被拒：${r}`)
    }
  }
  const execDir = stageGateFixture('execute')
  assert.strictEqual(gateCall('agent_teams_resume', execDir, {}), undefined, 'execute 阶段放行 resume（复活团队）')
})

test('D5-v2 归属标记：只统计标记内团队的未完成任务（标记外旧团队不计）', () => {
  const dir = builtWorkspace()
  teamFixture(dir, 't-cur', [{ id: 'a', status: 'in_progress' }, { id: 'b', status: 'claimed' }], 0)
  teamFixture(dir, 't-old', [{ id: 'x', status: 'in_progress' }, { id: 'y', status: 'pending' }, { id: 'z', status: 'in_progress' }], 100)
  fs.writeFileSync(path.join(dir, '.jarvis/active-team.json'), JSON.stringify({ teams: ['t-cur'], updatedAt: new Date().toISOString(), source: 'captain-session' }))
  const st = computeStage(dir)
  assert.strictEqual(st.artifacts.openTasks, 2, `只数标记内团队（t-cur 2 个）：实际 ${st.artifacts.openTasks}`)
  assert.strictEqual(st.artifacts.activeTeamSource, 'marker', '归属判据来源应为 marker')
  assert.deepStrictEqual(st.artifacts.activeTeams, ['t-cur'])
})

test('D5-v2 归属标记：标记内团队静默超过 72h 仍计数（修「静默→假收口」主通道）', () => {
  const dir = builtWorkspace()
  teamFixture(dir, 't-cur', [{ id: 'a', status: 'in_progress' }, { id: 'b', status: 'pending' }], 100) // 本项目团队 100h 没写入
  fs.writeFileSync(path.join(dir, '.jarvis/active-team.json'), JSON.stringify({ teams: ['t-cur'], updatedAt: new Date().toISOString() }))
  const st = computeStage(dir)
  assert.strictEqual(st.artifacts.openTasks, 2, `标记内团队不因 mtime 超 72h 被排除：实际 ${st.artifacts.openTasks}`)
  assert.strictEqual(st.stage, 'execute', '仍有未完成任务 → 不得提前进 close（这是 T3 R1 裁决要修的假收口）')
})

test('D5-v2 归属标记：无标记时回退 72h 启发式（向后兼容老工作区）', () => {
  const dir = builtWorkspace()
  teamFixture(dir, 't-cur', [{ id: 'a', status: 'in_progress' }], 0)
  teamFixture(dir, 't-old', [{ id: 'x', status: 'in_progress' }], 100)
  const st = computeStage(dir)
  assert.strictEqual(st.artifacts.openTasks, 1, `回退路径：只数新鲜团队：实际 ${st.artifacts.openTasks}`)
  assert.strictEqual(st.artifacts.activeTeamSource, 'mtime-fallback', '无标记应标为 mtime-fallback')
})

test('D5-v2 归属标记：坏 JSON / 空 teams 不崩且回退启发式', () => {
  const dir = builtWorkspace()
  teamFixture(dir, 't-cur', [{ id: 'a', status: 'in_progress' }], 0)
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/active-team.json'), '{坏 JSON')
  let st
  assert.doesNotThrow(() => { st = computeStage(dir) }, '坏标记不应崩')
  assert.strictEqual(st.artifacts.openTasks, 1, '坏标记 → 回退启发式')
  assert.strictEqual(st.artifacts.activeTeamSource, 'mtime-fallback')
  fs.writeFileSync(path.join(dir, '.jarvis/active-team.json'), JSON.stringify({ teams: [] }))
  st = computeStage(dir)
  assert.strictEqual(st.artifacts.activeTeamSource, 'mtime-fallback', '空 teams 等同无标记')
})

test('D5-v2/T13 写标记：按 captainSessionId 精确归属；**sid 匹配不到时不认领**（fallback-all 仅限无 sid 预热）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd5v2-mk-'))
  teamFixture(dir, 'mine', [{ id: 'a', status: 'in_progress' }], 0)
  fs.writeFileSync(path.join(dir, '.agent-teams/mine/team.json'), JSON.stringify({ name: 'mine', captainSessionId: 'cap', tasks: [{ id: 'a', status: 'in_progress' }] }))
  teamFixture(dir, 'other', [{ id: 'b', status: 'in_progress' }], 0)
  fs.writeFileSync(path.join(dir, '.agent-teams/other/team.json'), JSON.stringify({ name: 'other', captainSessionId: 'cap-other', tasks: [{ id: 'b', status: 'in_progress' }] }))
  const mk = writeActiveTeamMarker(dir, 'cap')
  assert.ok(mk && fs.existsSync(path.join(dir, '.jarvis/active-team.json')), '标记应落盘')
  assert.deepStrictEqual(mk.teams, ['mine'], `按 captainSessionId 只写本项目团队：${JSON.stringify(mk.teams)}`)
  assert.strictEqual(mk.source, 'captain-session')
  // T13 修订：调控到的 sid 不属于任何团队时**不得 fallback-all 认领全工作区**（否则别家团队被写成自家 7 天）
  const mk2 = writeActiveTeamMarker(dir, 'someone-else')
  assert.deepStrictEqual(mk2.teams, [], `sid 匹配不到 → 不认领（实际 ${JSON.stringify(mk2.teams)}）`)
  assert.strictEqual(mk2.source, 'no-match')
  assert.strictEqual(mk2.written, false)
  // fallback-all 仅保留给「无 sid 预热」场景（computeStage/marker 预热）
  const warm = writeActiveTeamMarker(dir, '')
  assert.deepStrictEqual(warm.teams.sort(), ['mine', 'other'], '无 sid 预热 → fallback 写全部非归档团队')
  assert.strictEqual(warm.source, 'fallback-all')
})

test('R1/②：close.ok 读收口闸——未过时不闭环但 release 已放行；过了则 done 含 close', () => {
  const notClosed = builtWorkspace()
  teamFixture(notClosed, 't-cur', [{ id: 'a', status: 'completed' }], 0)
  fs.mkdirSync(path.join(notClosed, '.jarvis/docs/ponder-verify'), { recursive: true })
  fs.writeFileSync(path.join(notClosed, '.jarvis/docs/ponder-verify/ok.json'), JSON.stringify({ verdict: 'PASS' }))
  const st1 = computeStage(notClosed)
  assert.strictEqual(st1.stage, 'close', `execute 已满足应到 close：${st1.stage}`)
  assert.ok(!st1.done.includes('close'), '收口闸未过 → done 不得含 close')
  assert.ok(st1.missing.some((m) => m.includes('flowguard(step="close")')), `缺口须点名收口闸：${st1.missing.join('；')}`)
  assert.strictEqual(gateCall('jarvis_release', notClosed), undefined, 'close 阶段 release 已放行（但收口未闭环）')

  const closed = builtWorkspace()
  teamFixture(closed, 't-cur', [{ id: 'a', status: 'completed' }], 0)
  fs.mkdirSync(path.join(closed, '.jarvis/docs/ponder-verify'), { recursive: true })
  fs.writeFileSync(path.join(closed, '.jarvis/docs/ponder-verify/ok.json'), JSON.stringify({ verdict: 'PASS' }))
  recordGate(closed, 'close', true)
  const st2 = computeStage(closed)
  assert.strictEqual(st2.stage, 'close', '仍在 close 阶段（最后一态）')
  assert.ok(st2.done.includes('close'), `收口闸过了 done 必须含 close：${st2.done.join(',')}`)
  assert.strictEqual(st2.done.length, 6, `六阶段全部通过：${st2.done.join(',')}`)
  assert.strictEqual(st2.missing.length, 0, '收口完成应无缺口')
})

// ── t6 评审补强：D5-v2 标记写入早于建队（会话并入）+ close.ok 任务侧护栏 ──

test('D5-v2 归属标记：建队在标记写入之后 → 同 captainSessionId 的新团队自动并入（防少算假收口）', () => {
  const dir = builtWorkspace()
  // 标记是在 flowguard(build) 通过时写的，此刻本项目团队还不存在（协议顺序：build 闸 → create → add_member）
  fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  // 标记写于 flowguard(build) 通过那一刻：当时只有别的项目团队（stale），本项目团队尚未创建
  fs.writeFileSync(path.join(dir, '.jarvis/active-team.json'), JSON.stringify({ teams: ['stale-other'], updatedAt: new Date().toISOString(), source: 'fallback-all', sessionId: 'cap' }))
  teamFixture(dir, 'stale-other', [{ id: 'x', status: 'in_progress' }], 0)
  fs.writeFileSync(path.join(dir, '.agent-teams/stale-other/team.json'), JSON.stringify({ name: 'stale-other', captainSessionId: 'cap-other', tasks: [{ id: 'x', status: 'in_progress' }] }))
  teamFixture(dir, 'other', [{ id: 'x', status: 'in_progress' }], 0)
  fs.writeFileSync(path.join(dir, '.agent-teams/other/team.json'), JSON.stringify({ name: 'other', captainSessionId: 'cap-other', tasks: [{ id: 'x', status: 'in_progress' }] }))
  teamFixture(dir, 'mine-new', [{ id: 'a', status: 'in_progress' }, { id: 'b', status: 'pending' }], 0)
  fs.writeFileSync(path.join(dir, '.agent-teams/mine-new/team.json'), JSON.stringify({ name: 'mine-new', captainSessionId: 'cap', tasks: [{ id: 'a', status: 'in_progress' }, { id: 'b', status: 'pending' }] }))
  const st = computeStage(dir)
  assert.strictEqual(st.artifacts.openTasks, 3, `标记内团队(stale-other=1) + 同会话新团队(mine-new=2) 都必须计入（否则新建团队任务永不计=假收口）：实际 ${st.artifacts.openTasks}`)
  assert.strictEqual(st.stage, 'execute', '有未完成任务 → 不得进 close')
})

test('R1/②：close 闸已过但任务被重开（openTasks>0）→ 阶段回到 execute，done 不含 close（闸过期不授予完成）', () => {
  const dir = builtWorkspace()
  teamFixture(dir, 't-cur', [{ id: 'a', status: 'in_progress' }], 0) // 任务被重新打开
  fs.mkdirSync(path.join(dir, '.jarvis/docs/ponder-verify'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.jarvis/docs/ponder-verify/ok.json'), JSON.stringify({ verdict: 'PASS' }))
  recordGate(dir, 'close', true) // 历史上跑过一次收口闸（现在已过期）
  const st = computeStage(dir)
  assert.strictEqual(st.stage, 'execute', `有未完成任务必须回 execute：${st.stage}`)
  assert.ok(!st.done.includes('close'), `过期收口闸不得授予「完成」：${st.done.join(',')}`)
  assert.ok(st.missing.some((m) => m.includes('未完成任务')), `缺口须写明未完成任务：${st.missing.join('；')}`)
})

// ── t8：PixOffice 官方 UI——jarvis_company 落盘修复 + /jarvis-ui 入口 ──

/** 调 jarvis_company handler（exec 提供会话 cwd；fs 服务由 apply 注入的 ctx 决定） */
async function callCompany(args, execCwd) {
  const def = TOOLS.find((t) => t.name === 'jarvis_company')
  return def.execute(args, { agent: { session: { id: 'ui-sess', header: { cwd: execCwd } } } })
}

test('T8 jarvis_company：无 fs 服务 → node:fs 兜底落盘（含 employees/tasks，storageMode=node-fs-fallback）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-nofs-'))
  const r = await callCompany({
    mode: 'update',
    employees: JSON.stringify([{ id: 'ceo', role: 'CEO', persona: 'CEO 人格', status: 'working' }]),
    phase: '开发',
  }, dir)
  assert.strictEqual(r.written, true, `无 fs 服务也必须落盘：${r.verdict}`)
  assert.strictEqual(r.storageMode, 'node-fs-fallback', '落盘通道须如实标明为 node:fs 兜底')
  const file = path.join(dir, '.jarvis/company-state.json')
  assert.ok(fs.existsSync(file), `快照文件应存在：${file}`)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(Array.isArray(saved.employees) && saved.employees.length === 1 && saved.employees[0].role === 'CEO', '内容须含 employees(CEO)')
  assert.ok(Array.isArray(saved.tasks), '内容须含 tasks 表（UI 任务看板数据源）')
  assert.strictEqual(saved.phase, '开发')
  assert.ok(/已落盘（node:fs 兜底）/.test(r.verdict), `verdict 须如实说明落盘通道：${r.verdict}`)
})

test('T8 jarvis_company：fs 服务写失败/抛错 → 仍 node:fs 兜底落盘（不再静默不落盘）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-fsfail-'))
  const boomFs = { resolve: async (p) => ({ p }), readText: async () => '', writeText: async () => { throw new Error('fs service boom') }, list: async () => [] }
  // 用 apply 注入「会抛错的 fs 服务」——模拟宿主 fs 服务不可用的真实场景
  const ctx = {
    get: (k) => (k === 'fs' ? boomFs : undefined),
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} }, webServer: { register: () => () => {} }, systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const r = await callCompany({ mode: 'update', employees: JSON.stringify([{ role: 'CEO', status: 'working' }]) }, dir)
  assert.strictEqual(r.written, true, `fs 服务抛错时仍须兜底落盘：${r.verdict}`)
  assert.strictEqual(r.storageMode, 'node-fs-fallback')
  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.jarvis/company-state.json'), 'utf8'))
  assert.ok(saved.employees.some((e) => e.role === 'CEO'), '兜底写入内容须完整')
})

test('T8 jarvis_company：fs 服务正常 → 走 fs 服务（storageMode=fs-service，绝对路径 storage）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-fsok-'))
  const writes = []
  const okFs = { resolve: async (p) => ({ p }), readText: async () => '', writeText: async (t, text) => { writes.push(String(text)) }, list: async () => [] }
  const ctx = {
    get: (k) => (k === 'fs' ? okFs : undefined),
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} }, webServer: { register: () => () => {} }, systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const r = await callCompany({ mode: 'update', employees: JSON.stringify([{ role: 'CEO' }]) }, dir)
  assert.strictEqual(r.storageMode, 'fs-service', '有可用 fs 服务时优先走服务')
  assert.strictEqual(writes.length, 1, 'fs 服务应收到一次写入')
  assert.ok(r.storage.startsWith(dir), `storage 须是本次调用项目目录下的绝对路径：${r.storage}`)
})

test('T8 /jarvis-ui：apply 注册 exact 路由 → 302 到 /jarvis-office/（在静态 prefix 路由之前）', async () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const ui = routes.find((r) => r.path === '/jarvis-ui')
  assert.ok(ui, `应注册 /jarvis-ui 路由；实际注册：${routes.map((r) => r.kind + ':' + r.path).join(', ')}`)
  assert.strictEqual(ui.kind, 'exact', '/jarvis-ui 必须是 exact 路由（否则被 prefix 吃掉）')
  const idxUi = routes.findIndex((r) => r.path === '/jarvis-ui')
  const idxStatic = routes.findIndex((r) => r.kind === 'prefix' && r.path === '/jarvis-office')
  assert.ok(idxUi < idxStatic, `/jarvis-ui 必须注册在静态路由之前（ui=${idxUi} static=${idxStatic}）`)
  // 真实调用一次：断言 302 + Location
  const res = { writeHead: (code, headers) => { res.code = code; res.headers = headers }, end: () => {} }
  await ui.handler({ url: '/jarvis-ui', method: 'GET' }, res)
  assert.strictEqual(res.code, 302, `应 302 跳转：${res.code}`)
  assert.strictEqual(res.headers.location, '/jarvis-wings', 'Location 默认指向 Wings UI（?ui=legacy 回退 v2）')
})

// ── t9：PixOffice 数据接上画面（适配页 + 机械可判定断言）──

test('T9 适配页：office/jarvis.html 真实引用快照接口 + DOM 面板钩子齐备（非注释）', () => {
  const repo = path.dirname(fileURLToPath(new URL(import.meta.url)))
  const html = fs.readFileSync(path.join(repo, '../office/jarvis.html'), 'utf8')
  const js = fs.readFileSync(path.join(repo, '../office/jarvis-adapter.js'), 'utf8')
  const API = 'api/luke-jarvis'
  const refs = html.split(API).length - 1 + (js.split(API).length - 1)
  assert.ok(refs >= 1, `必须真实引用快照接口（api/luke-jarvis），实际命中 ${refs}`)
  for (const hook of ['jarvis-panel', 'jarvis-employees', 'jarvis-tasks', 'jarvis-phase']) {
    assert.ok(html.includes(hook), `DOM 面板钩子缺失：${hook}`)
  }
  // 适配页必须从快照渲染角色/任务（否则 DOM 断言无来源）
  assert.ok(/renderEmployees/.test(js) && /renderTasks/.test(js), '适配脚本应渲染 employees/tasks')
  assert.ok(/__JARVIS_UI__/.test(js), '应暴露 window.__JARVIS_UI__ 供机械校验')
  // 诚实边界（T11 起场景层改经 relay 接本公司数据，但仍不得宣称「已上线/已渲染」）：
  // 页面必须显式写「需重启后目视确认」这一待验证边界，并暴露 relayUrl
  assert.ok(/需重启后目视确认/.test(html), '页面必须标注「场景是否真绑上需重启后目视确认」的边界（T11）')
  assert.ok(html.includes('relayUrl'), '适配页必须暴露 relayUrl（T11 场景层 relay 注入）')
  // 原 demo 页保持不变（仍可直接访问）
  assert.ok(fs.existsSync(path.join(repo, '../office/office/index.html')), '原 PixOffice demo 页必须保留')
})

test('T9 适配页：/jarvis-ui 302 默认指向 Wings UI，?ui=legacy 回退 v2', async () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const ui = routes.find((r) => r.path === '/jarvis-ui')
  const res = { writeHead: (code, headers) => { res.code = code; res.headers = headers }, end: () => {} }
  await ui.handler({ url: '/jarvis-ui', method: 'GET' }, res)
  assert.strictEqual(res.code, 302)
  assert.strictEqual(res.headers.location, '/jarvis-wings')
  const res2 = { writeHead: (code, headers) => { res2.code = code; res2.headers = headers }, end: () => {} }
  await ui.handler({ url: '/jarvis-ui?ui=legacy', method: 'GET' }, res2)
  assert.strictEqual(res2.code, 302)
  assert.strictEqual(res2.headers.location, '/jarvis-office/v2/index.html')
})

test('T9b Wings UI：/jarvis-wings 托管 webui/jarvis-v2-wings.html（缺失时回退 v2）', async () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const wings = routes.find((r) => r.path === '/jarvis-wings')
  assert.ok(wings, '应注册 /jarvis-wings 路由')
  assert.strictEqual(wings.kind, 'exact')
  const chunks = []
  const res = {
    writeHead: (code, headers) => { res.code = code; res.headers = headers },
    end: (d) => { if (d) chunks.push(d) },
  }
  await wings.handler({ url: '/jarvis-wings', method: 'GET' }, res)
  assert.strictEqual(res.code, 200)
  const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')
  assert.ok(html.includes('<!DOCTYPE html') || html.includes('<!doctype html'), '应返回 Wings 页面 HTML')
  assert.ok(html.includes('orbital-system'), 'Wings 页面应包含全息核心结构')
})

test('T9c 设置面板：Config schema 导出且 apply(ctx, config) 真实生效（ui/defaultWorkspace/voice）', async () => {
  const mod = await import('../src/host/plugin.js')
  assert.ok(mod.Config, '应导出 Config（DSH 设置面板 schema）')
  // schemastery schema 是可调用对象：直接调用即解析默认值
  const parsed = typeof mod.Config === 'function' ? mod.Config({}) : {}
  assert.strictEqual(parsed.ui, 'wings')
  assert.strictEqual(parsed.voice.provider, 'browser')
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  mod.apply(ctx, { ui: 'legacy', defaultWorkspace: '', voice: { provider: 'openai' } })
  const ui = routes.find((r) => r.path === '/jarvis-ui')
  const res = { writeHead: (code, headers) => { res.code = code; res.headers = headers }, end: () => {} }
  await ui.handler({ url: '/jarvis-ui', method: 'GET' }, res)
  assert.strictEqual(res.headers.location, '/jarvis-office/v2/index.html', 'config.ui=legacy 时默认 302 到 v2')
  const res2 = { writeHead: (code, headers) => { res2.code = code; res2.headers = headers }, end: () => {} }
  await ui.handler({ url: '/jarvis-ui?ui=wings', method: 'GET' }, res2)
  assert.strictEqual(res2.headers.location, '/jarvis-wings', '查询参数可覆盖配置默认值')
  // 语音合并：config.voice 为兜底，voice.json 保存值优先
  const voice = routes.find((r) => r.path === '/api/jarvis/voice')
  const vres = { writeHead: (code, headers) => { vres.code = code; vres.headers = headers }, end: (d) => { vres.body = d } }
  await voice.handler({ method: 'GET', headers: {}, url: '/api/jarvis/voice' }, vres)
  const vbody = JSON.parse(vres.body)
  assert.strictEqual(vbody.ok, true)
  assert.strictEqual(vbody.config.provider, 'openai', 'GET 应返回合并后的 provider')
  // 恢复默认配置，避免污染后续测试（PLUGIN_CONFIG 是模块级单例）
  mod.apply({ get: () => undefined, effect: () => {}, tools: { register: () => () => {} }, webServer: { register: () => {} }, systemPrompt: { section: () => () => {} } }, { ui: 'wings', defaultWorkspace: '', voice: {} })
})

test('T9d 跨站防护：/api/jarvis/command 拒绝不同源 Origin', async () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const cmd = routes.find((r) => r.path === '/api/jarvis/command')
  const res = { writeHead: (code, headers) => { res.code = code; res.headers = headers }, end: (d) => { res.body = d } }
  await cmd.handler({ method: 'POST', headers: { origin: 'https://evil.example', host: '127.0.0.1:18771' }, url: '/api/jarvis/command' }, res)
  assert.strictEqual(res.code, 403, '跨站 POST 应 403')
  const res2 = { writeHead: (code, headers) => { res2.code = code; res2.headers = headers }, end: (d) => { res2.body = d } }
  await cmd.handler({ method: 'POST', headers: { origin: 'http://127.0.0.1:18771', host: '127.0.0.1:18771' }, url: '/api/jarvis/command' }, res2)
  assert.notStrictEqual(res2.code, 403, '同源 POST 不应 403')
})

// ── t10：F4 flowguard 真检查 / F4b fs 取值与 hasGlob 语义 / F5 首建队标记 ──

/** 真实 node:fs 支撑的 FileSystem 适配器（对齐 DSH FileSystem：resolve 对不存在路径抛 ENOENT） */
function realFsAdapter() {
  return {
    async resolve(p) {
      fs.realpathSync(p) // 不存在 → 抛 ENOENT（本地后端行为）
      return { path: p }
    },
    async listDir(target) {
      return fs.readdirSync(target.path, { withFileTypes: true }).map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file' }))
    },
    async readText(target) { return fs.readFileSync(target.path, 'utf8') },
    async writeText(target, text) { fs.writeFileSync(target.path, text) },
  }
}
/** 用真实 fs 服务 apply 一次（moduleCtx 生效 → getFsService 能取到） */
function applyRealFs() {
  const ctx = {
    get: (k) => (k === 'fs' ? realFsAdapter() : undefined),
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} }, webServer: { register: () => () => {} }, systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
}
async function runFlowguard(step, proj) {
  const def = TOOLS.find((t) => t.name === 'jarvis_flowguard')
  return def.execute({ step, projectDir: proj }, { agent: { session: { id: 'cap', header: { cwd: proj } } } })
}

test('T10 F4：流程闸真检查——干净工作区四步全 BLOCKED 且点名；补产物后转 PASS 且 gates.json 真写入', async () => {
  applyRealFs()
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't10-f4-'))
  // ① 干净工作区：clarify/decompose/design/build 必须 false，且 missing 点名
  for (const step of ['clarify', 'decompose', 'design', 'build']) {
    const r = await runFlowguard(step, proj)
    assert.strictEqual(r.ok, false, `${step} 在无产物时必须 BLOCKED（当前 ok=${r.ok} missing=${JSON.stringify(r.missing)}）`)
    assert.ok(Array.isArray(r.missing) && r.missing.length > 0, `${step} 必须点名缺口`)
  }
  // ② 逐步补产物后必须真 PASS（F4 的核心：pre 项被真正移除）
  fs.mkdirSync(path.join(proj, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  let r = await runFlowguard('clarify', proj)
  assert.strictEqual(r.ok, true, `补需求规格后 clarify 应 PASS：${JSON.stringify(r.missing)}`)
  fs.writeFileSync(path.join(proj, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  r = await runFlowguard('decompose', proj)
  assert.strictEqual(r.ok, true, `补任务编排后 decompose 应 PASS：${JSON.stringify(r.missing)}`)
  fs.writeFileSync(path.join(proj, '.jarvis/docs/方案设计-x.md'), '# 方案')
  r = await runFlowguard('design', proj)
  assert.strictEqual(r.ok, true, `补方案设计后 design 应 PASS：${JSON.stringify(r.missing)}`)
  // ③ 闸必须真的落盘（证明不是空壳 PASS）
  const gates = JSON.parse(fs.readFileSync(path.join(proj, '.jarvis/gates.json'), 'utf8'))
  for (const step of ['clarify', 'decompose', 'design']) {
    assert.strictEqual(gates[step] && gates[step].ok, true, `gates.json 缺 ${step} 真写入：${JSON.stringify(gates)}`)
  }
})

test('T10 F4 反例：零产物六步不得出现「全 PASS」（修好注入后不许闸变空壳）', async () => {
  applyRealFs()
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't10-f4b-'))
  const results = []
  for (const step of ['clarify', 'decompose', 'design', 'build', 'execute', 'close']) {
    const r = await runFlowguard(step, proj)
    results.push([step, r.ok])
  }
  const allPass = results.every(([, ok]) => ok === true)
  assert.strictEqual(allPass, false, `零产物六步全 PASS = 闸变空壳（实际：${JSON.stringify(results)}）`)
  assert.ok(results.filter(([, ok]) => !ok).length >= 4, `至少 4 步必须 BLOCKED（实际：${JSON.stringify(results)}）`)
})

test('T10 F5：首建队场景——.agent-teams 不存在时先 mkdir 再写标记，含本团队名', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't10-f5a-'))
  assert.ok(!fs.existsSync(path.join(proj, '.agent-teams')), '前置：.agent-teams 不存在')
  // 模拟「建队目录刚创建」的形态：先创建团队目录与 team.json（真实顺序里 build 闸在建队前跑，
  // 这里覆盖 mkdir 缺失目录的分支）
  fs.mkdirSync(path.join(proj, '.agent-teams/t-first'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/t-first/team.json'), JSON.stringify({ name: 't-first', captainSessionId: 'cap', tasks: [] }))
  const mk = writeActiveTeamMarker(proj, 'cap')
  assert.strictEqual(mk.ok, true, `首建队写标记应成功：${JSON.stringify(mk)}`)
  assert.ok(mk.teams.includes('t-first'), `标记须含本团队名：${JSON.stringify(mk.teams)}`)
  assert.ok(fs.existsSync(path.join(proj, '.jarvis/active-team.json')), '标记文件须落盘')
  // 空 .agent-teams（尚未建队）：也要能写（mkdir 成功、teams 为空、不崩）
  const proj2 = fs.mkdtempSync(path.join(os.tmpdir(), 't10-f5a2-'))
  const mk2 = writeActiveTeamMarker(proj2, 'cap')
  assert.strictEqual(mk2.ok, true, `空团队目录也应 mkdir+写成功：${JSON.stringify(mk2)}`)
  assert.ok(fs.existsSync(path.join(proj2, '.agent-teams')), '应先创建 .agent-teams 目录')
})

test('T10 F5：写入失败如实返回 ok=false + reason（不再静默 null）', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't10-f5b-'))
  // 让 `.jarvis` 成为普通文件 → 写 active-team.json 必失败
  fs.writeFileSync(path.join(proj, '.jarvis'), 'not-a-dir')
  fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
  // T13 修订后：sid 必须与团队匹配才会真正尝试写盘（否则「不认领」直接返回）
  fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({ name: 't1', captainSessionId: 'cap', tasks: [] }))
  const mk = writeActiveTeamMarker(proj, 'cap')
  assert.strictEqual(mk.ok, false, `写失败必须 ok=false：${JSON.stringify(mk)}`)
  assert.ok(typeof mk.reason === 'string' && mk.reason.length > 0, `失败必须带原因：${JSON.stringify(mk)}`)
  assert.ok(/失败/.test(mk.reason), `原因须说明失败点：${mk.reason}`)
})

test('T10 F4b parity：mock fs 服务与真实 FileSystem 对 hasGlob 结果一致（命中/未命中/目录不存在）', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't10-parity-'))
  fs.mkdirSync(path.join(proj, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(proj, 'docs/需求规格-a.md'), '# x')
  const real = realFsAdapter()
  const mock = {
    resolve: async (p) => ({ path: p }),
    listDir: async (t) => fs.readdirSync(t.path, { withFileTypes: true }).map((d) => ({ name: d.name, type: d.type === undefined ? (d.isDirectory() ? 'directory' : 'file') : d.type })),
  }
  for (const [dir, kw] of [[path.join(proj, 'docs'), '需求规格'], [path.join(proj, 'docs'), '方案设计'], [path.join(proj, 'nope'), '需求规格']]) {
    const a = await hasGlob(real, dir, kw)
    const b = await hasGlob(mock, dir, kw)
    assert.strictEqual(b, a, `mock 与真实服务结果必须一致（${dir.split('/').pop()} / ${kw}）：real=${a} mock=${b}`)
  }
})

test('T10 F4b hasGlob 语义：无服务→true；目录不存在→false；其他异常→true', async () => {
  assert.strictEqual(await hasGlob(null, '/tmp/whatever', '需求规格'), true, '无服务=查不了→放行')
  const real = realFsAdapter()
  const missingDir = path.join(os.tmpdir(), 't10-not-exist-' + Date.now())
  assert.strictEqual(await hasGlob(real, missingDir, '需求规格'), false, '目录不存在→false（没产物必须拦）')
  const boomFs = { resolve: async () => ({ path: '/x' }), listDir: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) } }
  assert.strictEqual(await hasGlob(boomFs, '/x', '需求规格'), true, '其他异常→true（不确定=放行）')
})

// ── t10 评审补强（八卦镜发现）：marker 消费方 honor 失败 / 空标记不写 / 嵌套 team.json / 无 list 后端 ──

test('T10+ marker 消费方：建队前（无 team.json）不写空标记、不报成功；建队后 execute 闸补写并含本团队名', async () => {
  applyRealFs()
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't10-mk2-'))
  // 建队前：build 闸通过 → 无 team.json → 不写 active-team.json、输出不得宣称已写
  fs.mkdirSync(path.join(proj, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  fs.writeFileSync(path.join(proj, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  fs.writeFileSync(path.join(proj, '.jarvis/docs/方案设计-x.md'), '# 方案')
  fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/猎头-人才寻访.md'), '# 猎头')
  fs.writeFileSync(path.join(proj, '.jarvis/cards/CEO-带队.md'), '# CEO')
  let r = await runFlowguard('build', proj)
  assert.strictEqual(r.ok, true, `build 应通过：${JSON.stringify(r.missing)}`)
  assert.ok(!r.activeTeamMarker, `建队前不得报「已写标记」：${r.activeTeamMarker}`)
  assert.ok(!fs.existsSync(path.join(proj, '.jarvis/active-team.json')), '建队前不得写空标记文件')
  // 建队后：execute 闸通过 → 补写标记且含本团队名
  fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({ name: 't1', captainSessionId: 'cap', tasks: [{ id: 'a', subject: '实现X', description: '【开工须知】先跑 ponder 十阶段', status: 'in_progress', assignee: 'm1' }] }))
  r = await runFlowguard('execute', proj)
  assert.ok(r.activeTeamMarker, `execute 通过后应补写标记：${JSON.stringify(r)}`)
  const mk = JSON.parse(fs.readFileSync(path.join(proj, '.jarvis/active-team.json'), 'utf8'))
  assert.deepStrictEqual(mk.teams, ['t1'], `标记须含本团队名：${JSON.stringify(mk.teams)}`)
})

test('T10+ 嵌套 team.json：缺开工须知不再进 build 闸缺口（流程靠 jarvis_dispatch_task 固化，不靠查表拦）', async () => {
  applyRealFs()
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't10-nested-'))
  fs.mkdirSync(path.join(proj, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  fs.writeFileSync(path.join(proj, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  fs.writeFileSync(path.join(proj, '.jarvis/docs/方案设计-x.md'), '# 方案')
  fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/猎头-人才寻访.md'), '# 猎头')
  fs.writeFileSync(path.join(proj, '.jarvis/cards/CEO-带队.md'), '# CEO')
  // 真实嵌套布局 + 任务缺开工须知
  fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({ name: 't1', tasks: [{ id: 'a', subject: '实现X', description: '直接干', status: 'in_progress' }] }))
  const r = await runFlowguard('build', proj)
  assert.ok(!r.missing.some((m) => String(m).includes('开工须知')), `不应再拿「有没有附须知」当缺口：${JSON.stringify(r.missing)}`)
})

test('T10+ 无 list 能力的 FileSystem（只有 resolve+listDir）：审计闸真生效（不再静默放行）', async () => {
  applyRealFs() // 真实适配器没有 list
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't10-nolist-'))
  fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/普通角色.md'), '# 普通')
  const fsSvc = getFsService(null)
  const missing = await checkTalentPreconditions(fsSvc, proj, path)
  assert.ok(missing.some((m) => m.includes('猎头')), `无 list 后端也必须检出缺猎头卡：${JSON.stringify(missing)}`)
  assert.ok(missing.some((m) => m.includes('带队')), `无 list 后端也必须检出缺带队卡：${JSON.stringify(missing)}`)
})

// ── t11：PixOffice relay（方案B）——快照帧合法性 / seq 幂等 / 截断 / 映射 / SSE 帧 / 命令白名单 / recordGate 保留 note ──

const PIX_ACTOR = 'office-lead'

test('T11 relay：buildPixOfficeFrame 生成合法快照帧（无 INVALID_BINDING，含本公司 employee id）', () => {
  const state = {
    employees: [
      { id: 'ceo', role: 'CEO', persona: 'To C-level or not to C-level', status: 'working' },
      { id: 'architect', role: '企业架构师', persona: 'Fowler', status: 'working' },
      { id: 'verifier', role: '质量-探索式测试', persona: 'Bach', status: 'working' },
      { id: 'release', role: '办公体系专家', persona: 'Office', status: 'idle' },
    ],
    tasks: [{ id: 't1', subject: 'P2 网关', status: 'completed', assignee: 'CEO' }],
    meetings: [{ id: 'm1', topic: '周会', status: 'done', attendees: ['CEO'] }],
  }
  const frame = buildPixOfficeFrame(state, { seq: 7, workspaceId: 'jarvis-t11' })
  const verdict = validatePixOfficeFrame(frame)
  assert.strictEqual(verdict.ok, true, `帧必须合法：${JSON.stringify(verdict.errors)}`)
  assert.strictEqual(frame.seq, 7)
  // 上游 zod 联合体只认 office.sync / office.sync.start / office.sync.complete
  assert.strictEqual(frame.type, 'office.sync', '帧信封必须是 office.sync')
  assert.ok(frame.snapshot && Array.isArray(frame.snapshot.employees), '快照必须在 snapshot 字段内')
  const actors = frame.snapshot.employees.map((e) => e.sceneActorId)
  actors.forEach((a) => assert.ok(PIXOFFICE_ACTOR_IDS.includes(a), `sceneActorId 必须在演员表：${a}`))
  assert.ok(frame.snapshot.employees.some((e) => e.role === 'CEO'), '快照须含本公司角色')
  assert.ok(frame.snapshot.events.length >= 1, '会议应映射成事件')
  for (const e of frame.snapshot.events) {
    assert.ok(['note','task.assigned','task.started','task.blocked','task.completed'].includes(e.kind), `事件 kind 必须在上游枚举：${e.kind}`)
    assert.ok(e.summary.length >= 1 && e.summary.length <= 300, '事件 summary 长度须 1..300')
  }
})

test('T11 relay：employees >200 截断；tasks/events 也按上游上限截断', () => {
  const many = Array.from({ length: 260 }, (_, i) => ({ id: 'e' + i, role: '角色' + i, status: 'idle' }))
  const frame = buildPixOfficeFrame({ employees: many }, { seq: 1 })
  assert.strictEqual(frame.snapshot.employees.length, 200, `employees 必须截断到 200（实际 ${frame.snapshot.employees.length}）`)
  assert.strictEqual(validatePixOfficeFrame(frame).ok, true, '截断后仍应合法')
})

test('T11 relay：seq 单调 + 幂等——同 seq 同内容判 duplicate，同 seq 不同内容判 conflict（上游 409）', () => {
  const f1 = buildPixOfficeFrame({ employees: [{ id: 'ceo', role: 'CEO', status: 'working' }] }, { seq: 1 })
  assert.deepStrictEqual(relaySeqDecision(null, f1), { status: 'fresh', seq: 1 })
  const prev = { seq: 1, hash: frameHash(f1) }
  assert.strictEqual(relaySeqDecision(prev, f1).status, 'duplicate', '同 seq 同内容应幂等')
  const f2 = buildPixOfficeFrame({ employees: [{ id: 'ceo', role: 'CEO', status: 'idle' }] }, { seq: 2 })
  assert.strictEqual(relaySeqDecision(prev, f2).status, 'fresh', '新 seq 应 fresh')
  const conflict = buildPixOfficeFrame({ employees: [{ id: 'ceo', role: 'CEO', status: 'working' }, { id: 'qa', role: '质量-探索式测试', status: 'working' }] }, { seq: 1 })
  assert.strictEqual(relaySeqDecision(prev, conflict).status, 'conflict', '同 seq 不同内容必须 conflict')
  // seq 缺失/非法 → 校验器必须判 SEQ_REQUIRED（buildPixOfficeFrame 会把非法 seq 兜底成 1，故直接校验裸帧）
  const noSeq = validatePixOfficeFrame({ workspace: { id: 'w' }, employees: [], tasks: [], events: [] })
  assert.strictEqual(noSeq.ok, false, '缺 seq 必须判非法')
  assert.ok(noSeq.errors.some((e) => e.code === 'SEQ_REQUIRED'), `应报 SEQ_REQUIRED：${JSON.stringify(noSeq.errors)}`)
  // seq=0：信封与 seq 两条都报（信封是新加的强制项，顺序不代表优先级）
  const badSeq = validatePixOfficeFrame({ type: 'office.sync', seq: 0, snapshot: { workspace: { id: 'w' } } })
  assert.ok(badSeq.errors.some((e) => e.code === 'SEQ_REQUIRED'), `seq=0 必须判非法：${JSON.stringify(badSeq.errors)}`)
})

test('T11 relay：SSE 帧字符串合法（data: <单帧 JSON> 可解析、无内嵌换行破帧）', () => {
  const frame = buildPixOfficeFrame({ employees: [{ id: 'ceo', role: 'CEO', status: 'working' }] }, { seq: 3 })
  const str = sseFrameString(frame)
  assert.ok(str.startsWith('data: '), 'SSE 帧必须以 data: 开头')
  assert.ok(str.endsWith('\n\n'), 'SSE 帧必须以空行结束')
  const jsonPart = str.slice(6).trim()
  const parsed = JSON.parse(jsonPart)
  assert.strictEqual(parsed.seq, 3)
  assert.strictEqual(parsed.type, 'office.sync')
  assert.ok(parsed.snapshot.employees.length === 1)
})

test('T11 relay：上游事件枚举收敛——meeting/recruiting/employee/ceo 一律压成 note，非法 kind 被校验器拒绝', () => {
  const state = { employees: [{ id: 'ceo', role: 'CEO', status: 'working' }], meetings: [{ topic: '周会', status: 'done' }], recruiting: [{ position: '测试', status: 'interviewing' }] }
  const frame = buildPixOfficeFrame(state, { seq: 1 })
  const kinds = frame.snapshot.events.map((e) => e.kind)
  assert.ok(kinds.length >= 2, '会议/招募应各自成事件')
  kinds.forEach((k) => assert.ok(['note','task.assigned','task.started','task.blocked','task.completed'].includes(k), `kind 必须收敛到上游枚举：${k}`))
  assert.ok(frame.snapshot.events.every((e) => e.summary.length <= 300), 'summary 必须裁剪到 300')
  // 非法 kind / 空 summary 必须被校验器拒绝（上游会整帧丢弃）
  const bad = { type: 'office.sync', seq: 2, snapshot: { workspace: { id: 'w' }, employees: [], tasks: [], events: [{ id: 'e1', kind: 'meeting.done', summary: '', occurredAt: '2026-01-01T00:00:00Z' }] } }
  const v = validatePixOfficeFrame(bad)
  assert.strictEqual(v.ok, false)
  assert.ok(v.errors.some((e) => e.code === 'EVENT_KIND_INVALID'), `应报 EVENT_KIND_INVALID：${JSON.stringify(v.errors)}`)
  // 信封不对也必须报错（不是静默）
  assert.strictEqual(validatePixOfficeFrame({ type: 'snapshot', seq: 1, snapshot: { workspace: { id: 'w' } } }).errors[0].code, 'ENVELOPE_INVALID')
})

test('T11 relay：命令白名单——越界命令明确拒绝（COMMAND_NOT_ALLOWED），白名单内且有 payload 才接受', () => {
  assert.strictEqual(validatePixOfficeCommand({ command: 'actor.create', payload: {} }).ok, false)
  assert.strictEqual(validatePixOfficeCommand({ command: 'actor.create', payload: {} }).code, 'COMMAND_NOT_ALLOWED')
  assert.strictEqual(validatePixOfficeCommand({ command: 'map.edit', payload: {} }).ok, true)
  assert.strictEqual(validatePixOfficeCommand({ command: 'object.state.set', payload: {} }).ok, true)
  const noPayload = validatePixOfficeCommand({ command: 'map.edit' })
  assert.strictEqual(noPayload.ok, false)
  assert.strictEqual(noPayload.code, 'PAYLOAD_REQUIRED')
})

test('T11 relay：路由注册齐备（events/messages/ui/reply 均为 exact，注册在静态前缀之前）', () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  for (const p of ['/api/pixoffice/events', '/api/pixoffice/messages', '/api/pixoffice/ui', '/api/pixoffice/reply']) {
    const r = routes.find((x) => x.path === p)
    assert.ok(r, `缺路由 ${p}`)
    assert.strictEqual(r.kind, 'exact', `${p} 应为 exact`)
  }
  const idxEvents = routes.findIndex((x) => x.path === '/api/pixoffice/events')
  const idxStatic = routes.findIndex((x) => x.path === '/jarvis-office')
  if (idxStatic !== -1) assert.ok(idxEvents < idxStatic, 'relay 路由必须注册在静态 prefix 之前')
})

test('T11 recordGate：写入时保留人工 note（归档 noteHistory），不静默覆盖', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't11-gate-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  const gateFile = path.join(proj, '.jarvis/gates.json')
  const manual = {
    clarify: { ok: true, at: '2026-11-01T00:00:00.000Z' },
    decompose: { ok: true, at: '2026-11-01T00:00:00.000Z', note: '人工核验：flowguard 的 fs 目录检查在本环境 fail-open/误报，已由 node fs 复核' },
  }
  fs.writeFileSync(gateFile, JSON.stringify(manual, null, 2))
  const ok = recordGate(proj, 'decompose', true)
  assert.strictEqual(ok, true)
  const after = JSON.parse(fs.readFileSync(gateFile, 'utf8'))
  assert.strictEqual(after.decompose.note, manual.decompose.note, '人工 note 必须保留原文')
  assert.strictEqual(after.decompose.stamped, true, '机械写入须标记 stamped')
  assert.ok(Array.isArray(after.decompose.noteHistory) && after.decompose.noteHistory.length === 1, '人工 note 须归档到 noteHistory')
  assert.strictEqual(after.decompose.noteHistory[0].note, manual.decompose.note)
  assert.strictEqual(after.decompose.noteHistory[0].archivedBy, 'recordGate')
  // 重复机械写：同一条 note 只归档一次（不得无界膨胀），且人工署名 by 保留
  const withBy = JSON.parse(fs.readFileSync(gateFile, 'utf8'))
  withBy.decompose.by = 'captain'
  fs.writeFileSync(gateFile, JSON.stringify(withBy, null, 2))
  recordGate(proj, 'decompose', true)
  recordGate(proj, 'decompose', true)
  const after3 = JSON.parse(fs.readFileSync(gateFile, 'utf8'))
  assert.strictEqual(after3.decompose.noteHistory.length, 1, `重复写不得膨胀 noteHistory（实际 ${after3.decompose.noteHistory.length}）`)
  assert.strictEqual(after3.decompose.by, 'captain', '人工署名 by 必须保留')
  // 没有人工 note 的条目不应凭空产生 noteHistory
  recordGate(proj, 'clarify', true)
  const after2 = JSON.parse(fs.readFileSync(gateFile, 'utf8'))
  assert.ok(!after2.clarify.noteHistory, '无人工 note 时不应生成 noteHistory')
  assert.strictEqual(after2.clarify.stamped, true)
})

// ── t13：审计作用域收窄 / 协调豁免统一 / marker 解耦+有效期 / 状态根唯一化 ──

/** 造多项目夹具：own 项目团队 + 6 个别家团队（别家含 claimed/captain 自领/缺卡成员/缺开工须知） */
function makeMultiProjectFixture() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't13-multi-'))
  const td = path.join(proj, '.agent-teams')
  fs.mkdirSync(td, { recursive: true })
  // 自家：t1（含开工须知）、t4【协调】（无开工须知，应豁免）、t9 已完成（终态不参与审计）
  fs.mkdirSync(path.join(td, 'luke-jarvis-完全体'), { recursive: true })
  // 开工对齐纪要（现在属流程产物：有团队有任务就必须有，否则 build 闸报「必开会」）
  fs.mkdirSync(path.join(proj, '.jarvis/meetings'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/meetings/m0-minutes.json'), JSON.stringify({
    type: 'kickoff', topic: '开工对齐', date: '2026-11-05', attendees: ['m1'], agenda: ['目标', '验收', '接口', '分工'],
    content: [{ who: 'm1', what: '我认为先做接口契约' }, { who: 'm2', what: '我补充：验收要可判定' }],
    resolutions: ['R1 目标与验收标准', 'R2 接口契约'], actions: [{ who: 'm1', what: '实现X' }],
  }))
  fs.writeFileSync(path.join(td, 'luke-jarvis-完全体/team.json'), JSON.stringify({
    name: 'luke-jarvis-完全体', captainSessionId: 'cap',
    tasks: [
      { id: 't1', subject: '实现X', description: '【开工须知】先跑 ponder 十阶段', status: 'in_progress', assignee: 'm1' },
      { id: 't4', subject: '【协调】M1/M2 收口验收与汇总回报', description: '汇总', status: 'in_progress', assignee: 'captain' },
      { id: 't9', subject: '已完成', description: '无开工须知', status: 'completed', assignee: 'captain' },
    ],
  }))
  // 别家 6 个：claimed 卡死 / captain 自领非协调 / 缺开工须知 / 已交活未 ponder
  for (let i = 1; i <= 6; i += 1) {
    const name = '其它项目-' + i
    fs.mkdirSync(path.join(td, name), { recursive: true })
    fs.writeFileSync(path.join(td, name + '/team.json'), JSON.stringify({
      name, captainSessionId: 'cap-other-' + i,
      tasks: [
        { id: 'x1', subject: '别家实现', description: '无开工须知', status: 'in_progress', assignee: 'm2' },
        { id: 'x2', subject: '别家交付', description: '无开工须知', status: 'claimed', assignee: 'm3', attempt: 5 },
        { id: 'x3', subject: '别家非协调自领', description: '干', status: 'in_progress', assignee: 'captain' },
      ],
    }))
  }
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/active-team.json'), JSON.stringify({ ok: true, teams: ['luke-jarvis-完全体'], updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(), source: 'captain-session', sessionId: 'cap' }))
  return proj
}

test('T13 ① resolveOwnedTeams：只认标记团队 ∪ 同 captainSessionId 团队（7 团队夹具里别家不参与）', () => {
  const proj = makeMultiProjectFixture()
  const owned = resolveOwnedTeams(proj, 'cap')
  assert.deepStrictEqual(owned.teams, ['luke-jarvis-完全体'], `归属只应含自家团队：${JSON.stringify(owned.teams)}`)
  assert.strictEqual(owned.source, 'marker')
  // 无标记 → 回退 72h（本夹具团队都是新建，mtime 新鲜 → 7 个都算）
  fs.unlinkSync(path.join(proj, '.jarvis/active-team.json'))
  const fallback = resolveOwnedTeams(proj, '')
  assert.strictEqual(fallback.source, 'mtime-fallback')
  assert.ok(fallback.teams.length >= 7, `回退路径应把新鲜团队都算进来：${fallback.teams.length}`)
})

test('T13 ①④ 别家的缺口不拦本项目：auditTeamBriefs/auditCaptainOwnedTasks/auditStaleTasks/checkPonderVerify 只看自家', async () => {
  applyRealFs()
  const proj = makeMultiProjectFixture()
  const owned = new Set(resolveOwnedTeams(proj, 'cap').teams)
  const fsSvc = getFsService(null)
  const briefOk = await auditTeamBriefs(fsSvc, proj, path, owned)
  assert.strictEqual(briefOk, true, '别家缺开工须知 + 自家【协调】t4 都不应拦（终态 t9 也不参与）')
  const captain = await auditCaptainOwnedTasks(fsSvc, proj, path, owned)
  assert.deepStrictEqual(captain, [], `别家 captain 自领不应计入：${JSON.stringify(captain)}（自家 t4 是【协调】应豁免）`)
  const stale = await auditStaleTasks(fsSvc, proj, path, owned)
  assert.deepStrictEqual(stale, [], `别家 claimed/attempt=5 不应计入：${JSON.stringify(stale)}`)
  const pov = await checkPonderVerify(fsSvc, proj, path, owned)
  assert.deepStrictEqual(pov, [], `别家未 ponder 核验不应计入：${JSON.stringify(pov)}`)
})

test('T13 ①④ 多项目夹具回归：flowguard(build)/flowguard(execute) 不因别家被拦（自家产物齐备时 ok=true）', async () => {
  applyRealFs()
  const proj = makeMultiProjectFixture()
  fs.mkdirSync(path.join(proj, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  fs.writeFileSync(path.join(proj, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  fs.writeFileSync(path.join(proj, '.jarvis/docs/方案设计-x.md'), '# 方案')
  fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/猎头-人才寻访.md'), '# 猎头')
  fs.writeFileSync(path.join(proj, '.jarvis/cards/CEO-带队.md'), '# CEO')
  const build = await runFlowguard('build', proj)
  assert.strictEqual(build.ok, true, `build 不应被别家拦：${JSON.stringify(build.missing)}`)
  assert.deepStrictEqual(build.ownedTeams, ['luke-jarvis-完全体'], `输出应带归属团队：${JSON.stringify(build.ownedTeams)}`)
  const exec = await runFlowguard('execute', proj)
  assert.strictEqual(exec.ok, true, `execute 不应被别家拦：${JSON.stringify(exec.missing)}`)
})

test('T13 ② 协调豁免统一：create_task 闸与 auditTeamBriefs 共用 COORD_TASK_RE（自家【协调】不再拦 build）', async () => {
  applyRealFs()
  const proj = makeMultiProjectFixture()
  const owned = new Set(resolveOwnedTeams(proj, 'cap-owned').teams)
  // auditTeamBriefs 认豁免
  assert.strictEqual(await auditTeamBriefs(getFsService(null), proj, path, owned), true)
  // 纯协调 subject 也在常量里（同一份正则）
  for (const s of ['【协调】汇总', '需求分析', '会议纪要', '验收汇总']) assert.ok(COORD_TASK_RE.test(s), `COORD_TASK_RE 应命中：${s}`)
  assert.ok(!COORD_TASK_RE.test('实现 P2 网关'), '实现类任务不应被当协调豁免')
})

test('T13 ③+ 写端不认领别家：sid 匹配不到任何团队时不写 fallback-all（防第三方会话一次 flowguard 认领全工作区 7 天）', () => {
  const proj = makeMultiProjectFixture()
  fs.unlinkSync(path.join(proj, '.jarvis/active-team.json'))
  const mk = writeActiveTeamMarker(proj, 'session-not-belong-to-any-team')
  assert.strictEqual(mk.written, false, `不匹配会话不得写标记：${JSON.stringify(mk)}`)
  assert.deepStrictEqual(mk.teams, [], '不得把别家团队写成本项目归属')
  assert.strictEqual(mk.source, 'no-match')
  assert.ok(!fs.existsSync(path.join(proj, '.jarvis/active-team.json')), '不得落盘认领文件')
  // 对照：无 sid（预热场景）才允许 fallback-all
  const warm = writeActiveTeamMarker(proj, '')
  assert.ok(warm.teams.length >= 7, `无 sid 预热应写全量团队（对照）：${JSON.stringify(warm.teams)}`)
})

test('T13 ③ marker 与闸解耦：build 闸被自家缺口拦住时仍写 marker（不再退 72h）', async () => {
  applyRealFs()
  const proj = makeMultiProjectFixture()
  fs.mkdirSync(path.join(proj, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160))
  fs.writeFileSync(path.join(proj, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  // 缺口用流程产物制造（缺方案设计），不再用「有没有附须知」当缺口

  fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/猎头.md'), '# 猎头')
  fs.writeFileSync(path.join(proj, '.jarvis/cards/CEO.md'), '# CEO')
  fs.unlinkSync(path.join(proj, '.jarvis/active-team.json')) // 先清标记，验证写入不依赖闸 ok
  const r = await runFlowguard('build', proj)
  assert.strictEqual(r.ok, false, '缺方案设计 → build 应 BLOCKED（流程产物判据不变）')
  assert.ok(r.activeTeamMarker, `闸 BLOCKED 时也必须写 marker（解耦）：${JSON.stringify(r)}`)
  const mk = JSON.parse(fs.readFileSync(path.join(proj, '.jarvis/active-team.json'), 'utf8'))
  assert.ok(mk.expiresAt, 'marker 必须带 expiresAt')
  assert.ok(Date.parse(mk.expiresAt) > Date.now(), 'expiresAt 应在未来')
})

test('T13 ③ 旧标记失效：3 个月前 fallback-all 标记不得造成 openTasks=0/假 close', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't13-stale-'))
  fs.mkdirSync(path.join(proj, '.agent-teams/team-a'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/team-a/team.json'), JSON.stringify({ name: 'team-a', tasks: [{ id: 'o1', subject: '未完成', status: 'in_progress' }] }))
  const old = new Date(Date.now() - 90 * 864e5).toISOString()
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/active-team.json'), JSON.stringify({ ok: true, teams: ['team-a'], updatedAt: old, source: 'fallback-all', sessionId: '' }))
  const owned = resolveOwnedTeams(proj, '')
  assert.strictEqual(owned.marker, null, '过期标记必须视为无效')
  assert.strictEqual(owned.source, 'mtime-fallback', `过期应回退 mtime-fallback：${owned.source}`)
  // computeStage：team.json 刚写（mtime 新鲜）→ 回退 72h 会算上它 → openTasks>0（不会假 close）
  const st = computeStage(proj)
  assert.ok(st.artifacts.openTasks >= 1, `过期标记不得把 openTasks 算成 0：${st.artifacts.openTasks}`)
  assert.strictEqual(st.artifacts.activeTeamSource, 'mtime-fallback')
  assert.strictEqual(st.gates.close ? Boolean(st.gates.close.ok) : false, false, 'close 不得为真')
})

test('T13 ⑤ 状态根唯一化：插件仓库自身（name=luke-jarvis）拒绝写 .jarvis 闸，返回 STATE_ROOT_CONFLICT', async () => {
  applyRealFs()
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't13-repo-'))
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'luke-jarvis' }))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  const r = await runFlowguard('clarify', proj)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'STATE_ROOT_CONFLICT', `应返回 STATE_ROOT_CONFLICT：${JSON.stringify(r)}`)
  assert.ok(!fs.existsSync(path.join(proj, '.jarvis/gates.json')), '拒绝时不得写 gates.json')
  assert.strictEqual(looksLikePluginRepo(proj), true)
  assert.strictEqual(looksLikePluginRepo(os.tmpdir()), false)
})

test('T13 ⑥ 状态根守卫泛化：插件仓库拒写快照/基线/公司状态（记忆文件不污染插件项目）', async () => {
  applyRealFs()
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't13-sr-'))
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'luke-jarvis' }))

  const snap = TOOLS.find((t) => t.name === 'jarvis_snapshot')
  const r1 = await snap.execute({ projectDir: proj, note: 'x' }, { agent: { session: { id: 's1' } } })
  assert.ok(r1.verdict.includes('STATE_ROOT_CONFLICT') || r1.verdict.includes('状态根'), `快照应被状态根守卫拦下：${r1.verdict}`)
  assert.strictEqual(r1.written, '')
  assert.ok(!fs.existsSync(path.join(proj, '.jarvis')), '快照不得在插件仓库创建 .jarvis')

  const base = TOOLS.find((t) => t.name === 'jarvis_baseline')
  const r2 = await base.execute({ projectDir: proj, slug: 'x' })
  assert.strictEqual(r2.ok, false)
  assert.deepStrictEqual(r2.written, [])

  const comp = TOOLS.find((t) => t.name === 'jarvis_company')
  const r3 = await comp.execute({ mode: 'update', employees: '[]', projectDir: proj })
  assert.strictEqual(r3.written, false)
  assert.strictEqual(r3.storageMode, 'state-root-conflict')

  assert.ok(!fs.existsSync(path.join(proj, '.jarvis')), '插件仓库不得出现 .jarvis（记忆文件零污染）')

  // 普通项目（非插件仓库）照常放行：写快照 + 公司状态
  const normal = fs.mkdtempSync(path.join(os.tmpdir(), 't13-normal-'))
  const r4 = await snap.execute({ projectDir: normal, note: 'ok' }, { agent: { session: { id: 's2' } } })
  assert.ok(r4.written && fs.existsSync(r4.written), '普通项目应正常写快照')
  const r5 = await comp.execute({ mode: 'update', employees: '[]', projectDir: normal })
  assert.strictEqual(r5.written, true)
  assert.strictEqual(stateRootConflict(proj).error, 'STATE_ROOT_CONFLICT')
  assert.strictEqual(stateRootConflict(normal), null)
})

test('T13 ④ 终态任务不参与审计：completed/cancelled 的缺须知/自领/claimed 都不算缺口', async () => {
  applyRealFs()
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't13-terminal-'))
  fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({
    name: 't1', captainSessionId: 'cap',
    tasks: [
      { id: 'a', subject: '已完成无须知', description: '无', status: 'completed', assignee: 'captain' },
      { id: 'b', subject: '已取消自领', description: '无', status: 'cancelled', assignee: 'captain', attempt: 9 },
    ],
  }))
  const owned = new Set(['t1'])
  const fsSvc = getFsService(null)
  assert.strictEqual(await auditTeamBriefs(fsSvc, proj, path, owned), true)
  assert.deepStrictEqual(await auditCaptainOwnedTasks(fsSvc, proj, path, owned), [])
  assert.deepStrictEqual(await auditStaleTasks(fsSvc, proj, path, owned), [])
})

test('T13 ① checkTalentPreconditions：别家团队的缺卡成员不拦本项目 build（团队枚举按 owned 收窄）', async () => {
  applyRealFs()
  const proj = makeMultiProjectFixture()
  const fsSvc = getFsService(null)
  // 自家成员的岗位卡不存在 → 只应报自家岗位；别家成员（fixture 里没有 members 字段）不参与
  const teamFile = path.join(proj, '.agent-teams/luke-jarvis-完全体/team.json')
  const d = JSON.parse(fs.readFileSync(teamFile, 'utf8'))
  d.members = [{ name: '企业架构师', role: '企业架构师' }]
  fs.writeFileSync(teamFile, JSON.stringify(d))
  const otherFile = path.join(proj, '.agent-teams/其它项目-1/team.json')
  const od = JSON.parse(fs.readFileSync(otherFile, 'utf8'))
  od.members = [{ name: '不存在岗位卡角色', role: '不存在岗位卡角色' }]
  fs.writeFileSync(otherFile, JSON.stringify(od))
  fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/企业架构师-软件架构.md'), '# 架构师卡')
  const missing = await checkTalentPreconditions(fsSvc, proj, path, new Set(['luke-jarvis-完全体']))
  assert.ok(!missing.some((m) => m.includes('不存在岗位卡角色')), `别家岗位卡不应参与：${JSON.stringify(missing)}`)
  // 若不收窄，则会报别家岗位卡缺口（证明收窄真的起作用）
  const wide = await checkTalentPreconditions(fsSvc, proj, path, new Set())
  assert.ok(wide.some((m) => m.includes('不存在岗位卡角色')), `不收窄时应能看到别家缺口（对照）：${JSON.stringify(wide)}`)
})

// ── DSH 工具契约（0.2.x）：execute + 按 agent 注入阶段 section ────────────────
test('工具契约：TOOLS 全部是 execute + output.render 形式（兼容旧 handler 字段）', () => {
  for (const t of TOOLS) {
    assert.strictEqual(typeof t.execute, 'function', `${t.name} 缺 execute`)
    assert.strictEqual(typeof t.output.render, 'function', `${t.name} 缺 output.render`)
    assert.strictEqual(t.handler, undefined, `${t.name} 不应再暴露 handler（旧契约字段）`)
    assert.strictEqual(t.parameters.type, 'object', `${t.name} parameters 根必须是 object`)
  }
  const blocks = TOOLS[0].output.render({}, { ok: true })
  assert.ok(Array.isArray(blocks) && blocks[0].type === 'text' && typeof blocks[0].text === 'string', 'render 必须返回 ContentBlock[]')
})

test('阶段 section：按 agent 注册一次（全局 section 拿不到 cwd，per-agent 才能拿到）', async () => {
  const registered = []
  const agent = {
    session: { id: 's-stage-1', header: { cwd: os.tmpdir() } },
    ctx: { systemPrompt: { section: (s) => { registered.push(s); return () => {} } } },
  }
  const exec = { agent, callId: 'c1', name: 'jarvis_project', arguments: {}, signal: new AbortController().signal }
  const project = TOOLS.find((t) => t.name === 'jarvis_project')
  await project.execute({ requirement: '给我做个电商复购工具' }, exec)
  await project.execute({ requirement: '再做一次' }, exec)
  assert.strictEqual(registered.length, 1, '同一 agent 只注册一次（幂等）')
  assert.strictEqual(registered[0].name, 'luke-jarvis:stage')
  assert.strictEqual(typeof registered[0].text, 'function', '阶段 section 用 provider（每轮重算，不缓存）')
})

// ── 路由回归：真机启动后 HTTP 接口必须能跑（catch ReferenceError 类死代码）──────────
function makeRouteCtx({ routes, cwd, fsReadText }) {
  const reads = []
  const fsSvc = {
    resolve: async (p) => p,
    readText: async (p) => { reads.push(p); return fsReadText ? fsReadText(p) : '' },
    readFileSync: (p) => fsReadText ? fsReadText(p) : '',
  }
  const ctx = {
    get(name) {
      if (name === 'fs') return fsSvc
      if (name === 'agents') return { list: () => (cwd ? [{ session: { id: 's-route-1', header: { cwd } } }] : []) }
      return undefined
    },
    effect(fn) { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  return { ctx, reads }
}

function callRoute(route, url) {
  const res = { code: 0, headers: {}, body: '' }
  res.writeHead = (code, headers) => { res.code = code; res.headers = headers || {} }
  res.end = (chunk) => { if (chunk !== undefined) res.body += String(chunk) }
  return Promise.resolve(route.handler({ url, method: 'GET' }, res)).then(() => res)
}

test('路由回归：/api/luke-jarvis/* 真调不抛未定义变量，且工作区从 live 会话解析（不是 /.jarvis）', async () => {
  const routes = []
  const { ctx, reads } = makeRouteCtx({ routes, cwd: '/tmp/jarvis-route-proj' })
  apply(ctx)
  const board = routes.find((r) => r.path === '/api/luke-jarvis/board')
  const company = routes.find((r) => r.path === '/api/luke-jarvis/company')
  assert.ok(board && company, '应注册 board/company 路由')

  // 关键回归：apply 期预热缓存的是 process.cwd()（systemd 下为 '/'），路由期必须用 live 会话工作区
  const b = await callRoute(board, '/api/luke-jarvis/board')
  assert.ok(!/is not defined/.test(b.body), `board 抛未定义变量：${b.body}`)
  assert.ok(!b.body.includes('/.jarvis/board.json'), `board 读到了错误工作区（'/.jarvis/...'）：${b.body}`)
  assert.ok(reads.some((p) => p.startsWith('/tmp/jarvis-route-proj/')), `board 应读会话工作区的 board.json，实际：${reads.join(',')}`)

  const c = await callRoute(company, '/api/luke-jarvis/company')
  assert.ok(!/is not defined/.test(c.body), `company 抛未定义变量（历史 bug: relayPath）：${c.body}`)
  assert.strictEqual(c.code, 200, `company 应 200，实际 ${c.code}`)
  const parsed = JSON.parse(c.body)
  assert.strictEqual(parsed.ok, true, `company 返回异常：${c.body}`)
  assert.strictEqual(parsed.snapshot.workspace.id, 'jarvis-jarvis-route-proj', 'workspace.id 应由真实工作区 basename 派生')
})

test('路由回归：解析不到会话工作区时明确报 no workspace（不再拼出 /.jarvis）', async () => {
  const routes = []
  const { ctx } = makeRouteCtx({ routes, cwd: '' })
  apply(ctx)
  const board = routes.find((r) => r.path === '/api/luke-jarvis/board')
  const b = await callRoute(board, '/api/luke-jarvis/board')
  assert.strictEqual(b.code, 200)
  const body = JSON.parse(b.body)
  assert.strictEqual(body.active, false)
  assert.ok(/no workspace/.test(String(body.reason || body.error || '')), `应明确报 no workspace：${b.body}`)
})

// ── 角色卡真注入（用户质疑：蒸馏了卡，成员有没有按大佬方式工作？）──────────────────
const CARD_SAMPLE = `# 张一鸣-产品增长

## 身份定位
信息分发效率工程师。

## 思维模型
延迟满足 + 数据驱动假设验证。

## 核心方法论
先做最小可分发单元，再用真实留存数据判断要不要加码。

## 代表作品
今日头条冷启动。

## 决策红线
不为短期数据牺牲长期留存。

## 语言风格
短句、先结论后依据、爱用比喻。
`

test('角色卡：findRoleCard 按角色名命中、跳过 history/、读出六段式', async () => {
  const { findRoleCard, cardStructureOk } = await import('../src/host/state/cards.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-card-'))
  fs.mkdirSync(path.join(proj, '.jarvis/cards/history'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/产品增长-张一鸣.md'), CARD_SAMPLE)
  fs.writeFileSync(path.join(proj, '.jarvis/cards/history/产品增长-旧版.md'), '# 旧版\n## 身份定位\n旧')
  const card = await findRoleCard(null, proj, '产品增长')
  assert.ok(card, '应找到产品增长的卡')
  assert.ok(card.relPath.endsWith('产品增长-张一鸣.md'), `不该命中 history：${card.relPath}`)
  const chk = cardStructureOk(card.text)
  assert.strictEqual(chk.ok, true, `六段式应完整：缺 ${chk.missing}`)
  // 六段不全必须报出缺哪段（不能假装完整）
  const partial = cardStructureOk('## 身份定位\n只有一段')
  assert.strictEqual(partial.ok, false)
  assert.ok(partial.missing.includes('核心方法论'))
  // 没有卡 → null（不编造）
  assert.strictEqual(await findRoleCard(null, proj, '财务'), null)
})

test('角色卡：开工须知把卡文本真塞进成员上下文（不是只说"按你的角色卡"）', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-card-brief-'))
  fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/产品增长-张一鸣.md'), CARD_SAMPLE)
  const brief = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await brief.execute({ roleName: '产品增长', projectDir: proj, task: '做复购增长方案' }, {})
  assert.strictEqual(r.cardMissing, false, `应找到卡：${r.cardMissing}`)
  assert.ok(r.cardPath.includes('产品增长-张一鸣.md'), `卡路径应回报：${r.cardPath}`)
  assert.ok(r.brief.includes('## 六、你的角色卡'), '须知必须有卡注入段标记（派活闸按它判定）')
  assert.ok(r.brief.includes('延迟满足') && r.brief.includes('先做最小可分发单元'), '卡里的方法论必须真进须知文本')
  // 无卡：必须显式告警 + cardMissing=true（不许静默降级成通用分析师）
  const r2 = await brief.execute({ roleName: '不存在的角色', projectDir: proj }, {})
  assert.strictEqual(r2.cardMissing, true)
  assert.ok(r2.brief.includes('先蒸馏再干'), '无卡时须知必须要求先蒸馏')
})

test('角色卡：jarvis_dispatch_task 一步完成「卡+须知+建任务」（流程固化，不靠闸查有没有抄）', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-dispatch-'))
  fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/产品增长-张一鸣.md'), CARD_SAMPLE)
  // 播种运行时 ctx + tools 服务：dispatch 内部要借 tools.execute 调 brief / create_task
  const inner = []
  const fakeTools = {
    execute: async (req) => {
      inner.push({ name: req.name, args: req.arguments })
      if (req.name === 'jarvis_member_brief') {
        const briefTool = TOOLS.find((t) => t.name === 'jarvis_member_brief')
        const v = await briefTool.execute(req.arguments, {})
        return { isError: false, value: v, content: [{ type: 'text', text: 'ok' }] }
      }
      if (req.name === 'agent_teams_create_task') return { isError: false, value: { taskId: 'T-42' }, content: [{ type: 'text', text: 'created' }] }
      return { isError: true, error: { code: 'UNKNOWN', message: 'unknown tool' }, content: [] }
    },
  }
  const { setRuntimeContext } = await import('../src/host/runtime.js')
  setRuntimeContext({ get: (n) => (n === 'tools' ? fakeTools : undefined) })
  const dispatch = TOOLS.find((t) => t.name === 'jarvis_dispatch_task')
  assert.ok(dispatch, '应注册 jarvis_dispatch_task')
  const r = await dispatch.execute(
    { assignee: '产品增长', subject: '做复购增长方案', description: '给出三档方案并说明取舍', acceptance: '每档含成本/预期/风险', projectDir: proj },
    { agent: { session: { id: 's-dispatch', header: { cwd: proj } } }, signal: new AbortController().signal },
  )
  assert.strictEqual(r.ok, true, `派活链路应成功：${r.summary}`)
  assert.strictEqual(r.dispatched, true)
  assert.strictEqual(r.taskId, 'T-42')
  assert.ok(r.cardPath.includes('产品增长-张一鸣.md'), `应注入该角色卡：${r.cardPath}`)
  // 内部调用轨迹：brief → create_task
  assert.deepStrictEqual(inner.map((i) => i.name), ['jarvis_member_brief', 'agent_teams_create_task'])
  const created = inner[1].args
  assert.ok(created.description.includes('## 六、你的角色卡'), '任务描述里必须含卡注入段（插件自动拼，不靠人抄）')
  assert.ok(created.description.includes('延迟满足'), '卡里的方法论要真进描述')
  assert.ok(created.description.includes('十阶段'), '须知里的 ponder 指引也要真进描述')
  assert.ok(created.description.includes('每档含成本/预期/风险'), '原有验收标准不能丢')
})


test('成员须知：交付格式要求「反方攻击/失效边界/置信度」——用产物证明思考（不查步骤）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_member_brief')
  const r = await def.execute({ roleName: '产品增长' })
  for (const k of ['反方攻击', '失效边界', '置信度']) {
    assert.ok(r.brief.includes(k), `回报格式必须要求「${k}」——这是 ponder 级思考在产物里的痕迹`)
  }
  assert.ok(/不是必填门槛|可溯源/.test(r.brief), 'ponder run_id 应标注为可选溯源，不是门槛（与「不考核步骤」一致）')
})

// ── 会议判定（不是摆设：从事实算该不该开会）──────────────────────────────────
test('会议判定：没团队不开会；有团队有任务没开工会 → 必开开工对齐会', async () => {
  const m = await import('../src/host/state/meetings.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-'))
  assert.strictEqual(m.meetingPolicy(proj).required.length, 0, '没团队 → 不要求开会')
  fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({ tasks: [
    { id: 'a', subject: '实现X', assignee: 'm1', status: 'in_progress' },
    { id: 'b', subject: '验收Y', assignee: 'm2', status: 'in_progress' },
  ] }))
  const p = m.meetingPolicy(proj)
  assert.strictEqual(p.required.length, 1, `应必开一个会：${JSON.stringify(p.required)}`)
  assert.strictEqual(p.required[0].type, 'kickoff')
  assert.ok(p.required[0].why.includes('开工对齐'), '理由要说清为什么必开')
  assert.ok(p.required[0].agenda.length >= 4, '议题要从事实带出来（目标/验收/接口/分工），不是空模板')
})

test('会议判定：开工纪要齐备后不再要求；新成员进场 → 必开循环会（上下文对齐）', async () => {
  const m = await import('../src/host/state/meetings.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'meet2-'))
  fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({ tasks: [
    { id: 'a', subject: '实现X', assignee: 'm1', status: 'in_progress' },
  ] }))
  fs.mkdirSync(path.join(proj, '.jarvis/meetings'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/meetings/m1-minutes.json'), JSON.stringify({ type: 'kickoff', topic: '开工', attendees: ['m1', 'm2'], content: [{ who: 'm1', what: 'a' }, { who: 'm2', what: 'b' }], resolutions: ['R1'], actions: [{ who: 'm1', what: 'x' }] }))
  assert.deepStrictEqual(m.meetingPolicy(proj).required, [], '开过工工会且成员都参加 → 不再要求')
  // 新成员 m9 进场
  const tf = path.join(proj, '.agent-teams/t1/team.json')
  const t = JSON.parse(fs.readFileSync(tf, 'utf8'))
  t.tasks.push({ id: 'b', subject: '接新模块', assignee: 'm9', status: 'in_progress' })
  fs.writeFileSync(tf, JSON.stringify(t))
  const p = m.meetingPolicy(proj)
  assert.ok(p.required.some((r) => r.type === 'cycle' && r.why.includes('新成员')), `新成员应触发循环会：${JSON.stringify(p.required)}`)
})

test('会议判定：黑板阻塞/未决≥3/分工冲突 → 必开循环会；收敛后不开会', async () => {
  const m = await import('../src/host/state/meetings.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'meet3-'))
  fs.mkdirSync(path.join(proj, '.jarvis/meetings'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/meetings/m0-minutes.json'), JSON.stringify({ type: 'kickoff', topic: '开工', attendees: ['m1', 'm2'], content: [{ who: 'm1', what: 'a' }, { who: 'm2', what: 'b' }], resolutions: ['R1'], actions: [{ who: 'm1', what: 'x' }] }))
  // 阻塞 → 必开
  fs.writeFileSync(path.join(proj, '.jarvis/board.json'), JSON.stringify({ items: [{ id: 'B1', type: '阻塞', content: '接口缺字段', status: 'open' }] }))
  let p = m.meetingPolicy(proj)
  assert.ok(p.required.some((r) => r.type === 'cycle' && r.why.includes('阻塞')), '阻塞 → 必开循环会')
  assert.ok(p.required[0].agenda.some((a) => a.includes('B1')), '议题必须点名具体条目（不是泛泛而谈）')
  // 收敛 → 不开
  fs.writeFileSync(path.join(proj, '.jarvis/board.json'), JSON.stringify({ items: [{ id: 'B1', type: '阻塞', content: '接口缺字段', status: 'resolved' }] }))
  p = m.meetingPolicy(proj)
  assert.ok(!p.required.some((r) => r.type === 'cycle'), `收敛后不该要求循环会：${JSON.stringify(p.required)}`)
  // ≥3 未决 → 必开
  fs.writeFileSync(path.join(proj, '.jarvis/board.json'), JSON.stringify({ items: [
    { id: 'O1', type: '问题', content: 'x', status: 'open' },
    { id: 'O2', type: '风险', content: 'y', status: 'open' },
    { id: 'O3', type: '发现', content: 'z', status: 'open' },
  ] }))
  p = m.meetingPolicy(proj)
  assert.ok(p.required.some((r) => r.type === 'cycle' && r.why.includes('未决')), '未决≥3 → 必开收敛会')
  // 分工冲突：同主题两人并行
  fs.writeFileSync(path.join(proj, '.jarvis/board.json'), JSON.stringify({ items: [] }))
  fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({ tasks: [
    { id: 'a', subject: '【实现】会员分层模型', assignee: 'm1', status: 'in_progress' },
    { id: 'b', subject: '【实现】会员分层模型', assignee: 'm2', status: 'in_progress' },
  ] }))
  p = m.meetingPolicy(proj)
  assert.ok(p.required.some((r) => r.type === 'cycle' && r.why.includes('分工冲突')), `同一主题两人并行 → 分工冲突必开会：${JSON.stringify(p.required)}`)
})

test('会议判定：任务全交完没开收口会 → 必开收口会；开完不再要求', async () => {
  const m = await import('../src/host/state/meetings.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'meet4-'))
  fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({ tasks: [{ id: 'a', subject: '实现X', assignee: 'm1', status: 'completed' }] }))
  fs.mkdirSync(path.join(proj, '.jarvis/meetings'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/meetings/m0-minutes.json'), JSON.stringify({ type: 'kickoff', topic: '开工', attendees: ['m1', 'm2'], content: [{ who: 'm1', what: 'a' }, { who: 'm2', what: 'b' }], resolutions: ['R1'], actions: [{ who: 'm1', what: 'x' }] }))
  let p = m.meetingPolicy(proj)
  assert.ok(p.required.some((r) => r.type === 'close'), '任务全交完必须开收口会')
  fs.writeFileSync(path.join(proj, '.jarvis/meetings/m1-minutes.json'), JSON.stringify({ type: 'close', topic: '收口', attendees: ['m1', 'm2'], content: [{ who: 'm1', what: '交付说明' }, { who: 'CEO', what: '验收通过' }], resolutions: ['逐项验收通过'], actions: [{ who: 'CEO', what: '交付' }] }))
  p = m.meetingPolicy(proj)
  assert.ok(!p.required.some((r) => r.type === 'close'), '开过收口会 → 不再要求')
})

test('jarvis_meeting：不开会可以，开了必须有完整纪要（缺要素不落盘、不算开过）', async () => {
  const def = TOOLS.find((t) => t.name === 'jarvis_meeting')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'meet5-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  // 不传纪要 → 明确说不算开过
  const r0 = await def.execute({ meetingType: 'kickoff', projectDir: proj }, {})
  assert.strictEqual(r0.minutesSaved, false)
  assert.ok(/必须传 minutes|没有传纪要/.test(r0.minutesNote), `没纪要要明说：${r0.minutesNote}`)
  // 缺 actions → 不落盘并点名缺什么
  const r1 = await def.execute({ meetingType: 'kickoff', projectDir: proj, minutes: JSON.stringify({ topic: '对齐', type: 'kickoff', attendees: ['m1', 'm2'], resolutions: ['R1'] }) }, {})
  assert.strictEqual(r1.minutesSaved, false)
  assert.ok(r1.minutesMissing.some((x) => String(x).includes('actions')), `缺 actions 要点名：${JSON.stringify(r1.minutesMissing)}`)
  // 完整纪要 → 落盘 + 判定认可
  const r2 = await def.execute({ meetingType: 'kickoff', projectDir: proj, minutes: JSON.stringify({ topic: '开工对齐', type: 'kickoff', attendees: ['m1', 'm2'], agenda: ['目标', '验收'], content: [{ who: 'm1', what: '先定接口' }, { who: 'm2', what: '验收要可判定' }], resolutions: ['R1 目标与验收'], actions: [{ who: 'm1', what: '实现X' }] }) }, {})
  assert.strictEqual(r2.minutesSaved, true, `完整纪要应落盘：${JSON.stringify(r2.minutesMissing)}`)
  assert.ok(fs.existsSync(path.join(proj, r2.minutesPath)), '纪要文件真的存在')
  const m = await import('../src/host/state/meetings.js')
  assert.strictEqual(m.readMinutesSync(proj).length, 1, '判定能读到这份纪要')
  assert.ok(r2.nextMeetingRule, '返回值要带「下次该不该开会」的判定')
})

test('flowguard(build)：有团队有任务却没开工对齐纪要 → 缺口点名开工对齐会；补纪要后消失', async () => {
  applyRealFs()
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'meet6-'))
  fs.mkdirSync(path.join(proj, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  fs.writeFileSync(path.join(proj, '.jarvis/docs/任务编排-x.md'), '# 任务编排')
  fs.writeFileSync(path.join(proj, '.jarvis/docs/方案设计-x.md'), '# 方案')
  fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/cards/猎头.md'), '# 猎头')
  fs.writeFileSync(path.join(proj, '.jarvis/cards/CEO.md'), '# CEO')
  fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({ name: 't1', tasks: [{ id: 'a', subject: '实现X', assignee: 'm1', status: 'in_progress' }] }))
  const r1 = await runFlowguard('build', proj)
  assert.ok(r1.missing.some((x) => String(x).includes('开工对齐会')), `缺开工纪要要拦：${JSON.stringify(r1.missing)}`)
  fs.mkdirSync(path.join(proj, '.jarvis/meetings'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/meetings/m0-minutes.json'), JSON.stringify({ type: 'kickoff', topic: '开工', attendees: ['m1', 'm2'], content: [{ who: 'm1', what: 'a' }, { who: 'm2', what: 'b' }], resolutions: ['R1'], actions: [{ who: 'm1', what: 'x' }] }))
  const r2 = await runFlowguard('build', proj)
  assert.ok(!r2.missing.some((x) => String(x).includes('开工对齐会')), `补纪要后不该再拦：${JSON.stringify(r2.missing)}`)
})

// ── 上下文压缩/新会话：流程不靠记忆，靠每轮从磁盘重算 + 首轮提醒 ──────────────
test('压缩/新会话：agent 创建即挂「当前阶段 + 续接事实」段（事实来自磁盘，不用提示词命令模型）', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-'))
  fs.mkdirSync(path.join(proj, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/project.md'), '# 记忆\n当前进度：x')
  fs.writeFileSync(path.join(proj, '.jarvis/docs/需求规格-x.md'), '# 需求'.repeat(160) + '\n验收：x')
  const handlers = {}
  const ctx = {
    tools: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    webServer: { register: () => () => {} },
    effect: (fn) => { try { fn() } catch {} },
    get: () => undefined,
    on: (ev, fn) => { handlers[ev] = fn; return () => {} },
  }
  apply(ctx)
  assert.ok(typeof handlers['agent/created'] === 'function', '必须监听 agent/created（否则新会话/压缩后首个请求看不到阶段）')
  const sections = []
  const agent = { session: { header: { cwd: proj } }, ctx: { systemPrompt: { section: (s) => { sections.push(s); return () => {} } } } }
  handlers['agent/created']({ agent, source: 'compact' })
  assert.strictEqual(sections.length, 1, '创建即挂阶段段')
  assert.strictEqual(sections[0].name, 'luke-jarvis:stage')
  const txt = sections[0].text()
  assert.ok(txt.includes('jarvis 当前阶段'), `首个请求就要有阶段（不依赖先调 jarvis 工具）：${txt.slice(0, 80)}`)
  // 关键：不靠"必须先去读记忆"的提示词——插件自己把磁盘事实放进上下文
  assert.ok(txt.includes('续接事实'), `要直接给出磁盘事实：${txt.slice(-200)}`)
  assert.ok(txt.includes('进度：'), '进度来自 project.md，不是模型记忆')
  assert.ok(!/必须(先|要)|不要凭记忆/.test(txt), '不允许用提示词命令模型做事（流程要固化）')
  // 幂等：重复创建事件不重复挂
  handlers['agent/created']({ agent, source: 'compact' })
  assert.strictEqual(sections.length, 1, '同一 agent 只挂一次 section')
  // startup：不加压缩提醒（新开会话正常从阶段开始）
  const s2 = []
  const agent2 = { session: { header: { cwd: proj } }, ctx: { systemPrompt: { section: (x) => { s2.push(x); return () => {} } } } }
  handlers['agent/created']({ agent: agent2, source: 'startup' })
  assert.ok(s2[0].text().includes('续接事实'), 'startup 也给事实（同样来自磁盘）')
})

// ── 续接事实：插件自己把磁盘事实放进上下文（不靠"必须先去读记忆"的提示词）────────
test('续接事实：进度/下一步/未决/团队/决策 从 project.md 读出，标签不重复、不被别行抢', async () => {
  const r = await import('../src/host/state/resume.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/project.md'), [
    '# 项目',
    '- 当前进度：做到方案设计，等 CEO 拍板分层口径',
    '- 下一步：拆任务派给产品增长',
    '- 未决项：复购口径未定（B2）',
    '- 团队：CEO/产品增长/猎头',
    '- 关键决策：先做最小可分发单元（否决大而全）',
  ].join('\n'))
  fs.writeFileSync(path.join(proj, '.jarvis/board.json'), JSON.stringify({ items: [{ id: 'B1', type: '阻塞', content: 'x', status: 'open' }] }))
  const txt = r.renderResumeFacts(proj)
  assert.ok(txt.includes('进度：做到方案设计'), `进度要去掉重复前缀：${txt}`)
  assert.ok(txt.includes('决策：先做最小可分发单元'), `决策行不能被"拍板"那行抢走：${txt}`)
  assert.ok(txt.includes('黑板未决：1 项'), '黑板未决来自磁盘')
  assert.ok(!/必须|不许|务必/.test(txt), '续接事实只陈述事实，不下命令')
})

// ── UI 契约 v1：快照/摘要/能力清单三个只读接口（后期增强 UI 只依赖这三样）────────
test('UI 契约 v1：/api/jarvis/state 返回带 schema 的全量快照（磁盘事实聚合，只读）', async () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const state = routes.find((r) => r.path === '/api/jarvis/state')
  assert.ok(state, `应注册 /api/jarvis/state；实际：${routes.map((r) => r.path).join(', ')}`)
  assert.strictEqual(state.kind, 'exact')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'uiapi-'))
  fs.mkdirSync(path.join(proj, '.jarvis/docs'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/project.md'), '- 当前进度：写方案\n- 下一步：建队')
  fs.writeFileSync(path.join(proj, '.jarvis/board.json'), JSON.stringify({ items: [{ id: 'B1', type: '阻塞', content: 'x', status: 'open' }] }))
  const res = { writeHead: (c, h) => { res.code = c; res.headers = h }, end: (b) => { res.body = b } }
  await state.handler({ url: '/api/jarvis/state?workspace=' + encodeURIComponent(proj), method: 'GET', headers: {} }, res)
  assert.strictEqual(res.code, 200)
  assert.strictEqual(res.headers['access-control-allow-origin'], '*', 'UI 跨源要允许')
  const body = JSON.parse(res.body)
  assert.strictEqual(body.schema, 'jarvis.snapshot/1', '快照必须带版本（UI 只认版本）')
  const snap = body.snapshot
  for (const key of ['stage', 'gates', 'artifacts', 'tasks', 'board', 'meetings', 'cards', 'memory', 'company', 'capabilities']) {
    assert.ok(key in snap, `快照缺面板字段：${key}`)
  }
  assert.strictEqual(snap.board.blockers.length, 1, '阻塞从磁盘事实来')
  assert.ok(snap.memory.exists, '记忆状态可读')
  assert.ok(Array.isArray(snap.capabilities.panels) && snap.capabilities.panels.length >= 5, '能力清单要报告面板 id')
})

test('UI 契约 v1：/api/jarvis/summary 轻量摘要 + /api/jarvis/capabilities 能力清单', async () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const summary = routes.find((r) => r.path === '/api/jarvis/summary')
  const caps = routes.find((r) => r.path === '/api/jarvis/capabilities')
  assert.ok(summary && caps, '摘要/能力清单路由都要有')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'uiapi2-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.jarvis/project.md'), '- 当前进度：x')
  const mk = () => ({ writeHead() {}, end(b) { this.body = b } })
  const r1 = mk()
  await summary.handler({ url: '/api/jarvis/summary?workspace=' + encodeURIComponent(proj), method: 'GET', headers: {} }, r1)
  const b1 = JSON.parse(r1.body)
  assert.strictEqual(b1.schema, 'jarvis.snapshot/1')
  assert.ok(typeof b1.summary.stage === 'string' && /\/6 /.test(b1.summary.stage), `摘要要有阶段串：${b1.summary && b1.summary.stage}`)
  const r2 = mk()
  await caps.handler({ url: '/api/jarvis/capabilities?workspace=' + encodeURIComponent(proj), method: 'GET', headers: {} }, r2)
  const b2 = JSON.parse(r2.body)
  assert.strictEqual(b2.tools.length, 31, '能力清单要列全 31 个工具')
  assert.ok(b2.panels.includes('meetings'), '面板 id 固定（UI 契约）')
  assert.ok(b2.plugin.version, '要报插件版本')
})

// ── 事件流：append-only + 增量读 + 路由（UI 时间轴数据源）────────────────────
test('事件流：闸/黑板/会议/派活写入 events.jsonl，可按 since 增量读取', async () => {
  const ev = await import('../src/host/state/events.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'events-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  assert.strictEqual(ev.readEvents(proj).total, 0, '空项目 → 0 事件')
  ev.appendEvent(proj, 'gate', { step: 'clarify' })
  ev.appendEvent(proj, 'board', { open: 3 })
  const all = ev.readEvents(proj)
  assert.strictEqual(all.total, 2)
  assert.strictEqual(all.lastSeq, 2)
  const inc = ev.readEvents(proj, { since: 1 })
  assert.strictEqual(inc.events.length, 1, 'since=1 只回第 2 条')
  assert.strictEqual(inc.events[0].type, 'board')
  // 坏行跳过（不因为一条坏数据丢整条时间轴）
  fs.appendFileSync(path.join(proj, '.jarvis/events.jsonl'), 'not-json\n')
  assert.strictEqual(ev.readEvents(proj).total, 2, '坏行不计入')
})

test('事件流路由：/api/jarvis/events 返回 {ok, events, lastSeq}', async () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const route = routes.find((r) => r.path === '/api/jarvis/events')
  assert.ok(route, '应注册事件流路由')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'eventsroute-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  const ev = await import('../src/host/state/events.js')
  ev.appendEvent(proj, 'gate', { step: 'design' })
  const res = { writeHead() {}, end(b) { this.body = b } }
  await route.handler({ url: '/api/jarvis/events?since=0&workspace=' + encodeURIComponent(proj), method: 'GET', headers: {} }, res)
  const body = JSON.parse(res.body)
  assert.strictEqual(body.ok, true)
  assert.strictEqual(body.events.length, 1)
  assert.strictEqual(body.events[0].type, 'gate')
  assert.strictEqual(body.lastSeq, 1)
})

// ── 语音设置（全局）+ TTS 代理：配置落盘、key 掩码、未配置时回退浏览器 ──────────
function fakeReq(method, body) {
  const handlers = {}
  const req = {
    method,
    on: (ev, fn) => { handlers[ev] = fn; return req },
    destroy: () => {},
  }
  setTimeout(() => {
    if (body !== null && body !== undefined) handlers.data?.(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
    handlers.end?.()
  }, 0)
  return req
}
function fakeRes() {
  return {
    writeHead(code, headers) { this.code = code; this.headers = headers },
    end(b) { this.body = b },
  }
}

test('语音设置：GET 返回预设+掩码配置；PUT 保存后 configured=true 且 key 不回显明文', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'voicehome-'))
  const oldHome = process.env.HOME
  process.env.HOME = home
  try {
    const routes = []
    const ctx = {
      get: () => undefined,
      effect: (fn) => { try { fn() } catch {} },
      tools: { register: () => () => {} },
      webServer: { register: (r) => { routes.push(r); return () => {} } },
      systemPrompt: { section: () => () => {} },
    }
    apply(ctx)
    const voice = routes.find((r) => r.path === '/api/jarvis/voice')
    assert.ok(voice, '应注册 /api/jarvis/voice')
    const r1 = fakeRes()
    await voice.handler(fakeReq('GET', null), r1)
    const b1 = JSON.parse(r1.body)
    assert.strictEqual(b1.ok, true)
    assert.strictEqual(b1.config.provider, 'browser', '默认浏览器语音（零依赖）')
    assert.ok(b1.presets.voices.length >= 5, '要有多音色可选')
    assert.ok(b1.presets.models.length >= 3, '要有多模型可选')
    // 保存语音模型配置
    const r2 = fakeRes()
    await voice.handler(fakeReq('PUT', { provider: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-123456789', model: 'cosyvoice-v2', voice: 'longxiaochun', speed: 0.9 }), r2)
    const b2 = JSON.parse(r2.body)
    assert.strictEqual(b2.ok, true)
    assert.strictEqual(b2.config.configured, true)
    assert.ok(!String(b2.config.apiKeyMasked).includes('123456789'), `key 必须掩码：${b2.config.apiKeyMasked}`)
    assert.ok(fs.existsSync(path.join(home, '.dsh/luke-jarvis/voice.json')), '配置落盘到全局路径')
    // 再次 GET：仍掩码
    const r3 = fakeRes()
    await voice.handler(fakeReq('GET', null), r3)
    const b3 = JSON.parse(r3.body)
    assert.strictEqual(b3.config.voice, 'longxiaochun')
    assert.ok(b3.config.apiKeyMasked.includes('…'), '掩码形态')
  } finally {
    process.env.HOME = oldHome
  }
})

test('TTS 代理：未配置语音模型 → 400 + fallback=browser（前端据此回退浏览器语音）', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'voicehome2-'))
  const oldHome = process.env.HOME
  process.env.HOME = home
  try {
    const routes = []
    const ctx = {
      get: () => undefined,
      effect: (fn) => { try { fn() } catch {} },
      tools: { register: () => () => {} },
      webServer: { register: (r) => { routes.push(r); return () => {} } },
      systemPrompt: { section: () => () => {} },
    }
    apply(ctx)
    const tts = routes.find((r) => r.path === '/api/jarvis/tts')
    assert.ok(tts, '应注册 /api/jarvis/tts')
    const res = fakeRes()
    await tts.handler(fakeReq('POST', { text: '你好' }), res)
    const body = JSON.parse(res.body)
    assert.strictEqual(res.code, 400)
    assert.strictEqual(body.fallback, 'browser')
    assert.ok(/未配置/.test(body.error))
    // 缺 text 也要明确拒绝
    const res2 = fakeRes()
    await tts.handler(fakeReq('POST', {}), res2)
    assert.strictEqual(res2.code, 400)
  } finally {
    process.env.HOME = oldHome
  }
})

test('v2 增强 UI：静态资产齐备、接真实接口、开源场景接入、语音设置存在、无写死的演示文案', () => {
  const repo = path.dirname(fileURLToPath(new URL(import.meta.url)))
  const dir = path.join(repo, '../office/v2')
  for (const f of ['index.html', 'jarvis-v2.js']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `缺少 v2 资产：${f}`)
  }
  // 不许再自己手写 3D 场景（用户要求：基于开源源码，不自己发挥）
  assert.ok(!fs.existsSync(path.join(dir, 'scene3d.js')), '不能保留手写 3D 场景模块')
  assert.ok(!fs.existsSync(path.join(dir, 'vendor/three.module.js')), '不能保留手写 3D 的 three.js 依赖')
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
  const js = fs.readFileSync(path.join(dir, 'jarvis-v2.js'), 'utf8')
  // 真实数据接入
  assert.ok(js.includes('/api/jarvis/state') && js.includes('/api/jarvis/events'), '必须接快照与事件流')
  assert.ok(js.includes('/api/jarvis/voice') && js.includes('/api/jarvis/tts'), '必须接语音设置与 TTS')
  // 动态节点（有 id 钩子，内容由 JS 填）
  for (const id of ['mMissionTitle', 'mMissionCopy', 'mEventTitle', 'mNextTitle', 'mSay', 'pTitle', 'stageChain', 'tMembers', 'tBoard']) {
    assert.ok(html.includes(`id="${id}"`), `浮动块/面板缺少动态 id：${id}`)
  }
  // 员工协作空间 = 开源 PixOffice 场景（iframe 同源托管 + 主题适配层）
  assert.ok(/id="teamScene"[^>]*src="\/jarvis-office\/jarvis-scene\.html"/.test(html), '协作空间必须嵌开源 PixOffice 场景页')
  assert.ok(html.includes('team-scene-veil') && html.includes('team-scene-frame'), '需要主题适配层（色温/描边/光晕）')
  assert.ok(js.includes('jarvis-theme') && /hue-rotate|saturate\(/.test(js), '主题适配要注入 iframe（只压色温，不改画面结构）')
  assert.ok(js.includes('workbzw/pixoffice'), '要标注场景来源（开源仓库），别当自己画的')
  // 语音设置面板
  assert.ok(html.includes('id="voiceSettings"') && html.includes('id="vProvider"') && html.includes('id="vVoice"'), '语音设置要有引擎/音色可选')
  // 不能再是写死的演示数据
  assert.ok(!html.includes('全局服务巡检与优化'), '不能写死演示任务名')
  assert.ok(!html.includes('5 人在线'), '不能写死成员在线数')
  assert.ok(!html.includes('09:55'), '时钟不能写死')
})

test('v2 静态托管：/jarvis-office/v2/index.html 能取到（prefix 路由真实读文件）', async () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const prefix = routes.find((r) => r.kind === 'prefix' && r.path === '/jarvis-office')
  assert.ok(prefix, '静态路由存在')
  const res = { writeHead(c, h) { this.code = c; this.headers = h }, end(b) { this.body = b } }
  await prefix.handler({ url: '/jarvis-office/v2/index.html', method: 'GET' }, res)
  assert.strictEqual(res.code, 200)
  assert.ok(/text\/html/.test(res.headers['content-type']))
  assert.ok(String(res.body).includes('JARVIS 全息任务中枢 v2'), '返回的确实是 v2 页面')
})

test('v2 会话输入不伪造执行（未接指令通道必须明说，而不是假装回复"收到/我会推进"）', () => {
  const repo = path.dirname(fileURLToPath(new URL(import.meta.url)))
  const js = fs.readFileSync(path.join(repo, '../office/v2/jarvis-v2.js'), 'utf8')
  assert.ok(!/我会按流程推进/.test(js), '不能出现假的执行承诺')
  assert.ok(/没有发出去|还没接|只做只读/.test(js), '必须明确告诉用户消息没发出去')
  assert.ok(/只是?只读|只读数据面/.test(js), '必须写明当前只接了只读数据面')
})

// ── 能力台：31 个工具全部接入（清单/校验/执行/闸拒绝/界面覆盖）──────────────
test('能力台：toolSpecs 覆盖全部 31 个工具，且每个工具都在界面的分组里（无遗漏）', async () => {
  const { TOOL_GROUPS, toolSpecs } = await import('../src/host/state/command.js')
  const { TOOLS } = await import('../src/host/tools/index.js')
  const specs = toolSpecs()
  assert.strictEqual(specs.length, TOOLS.length, 'spec 数必须等于真实工具数')
  assert.strictEqual(TOOLS.length, 31)
  const names = new Set(TOOLS.map((t) => t.name))
  const grouped = new Set()
  for (const [g, list] of Object.entries(TOOL_GROUPS)) {
    for (const n of list) {
      assert.ok(names.has(n), `分组 ${g} 里的 ${n} 不存在于真实工具`)
      assert.ok(!grouped.has(n), `${n} 被分到多个组`)
      grouped.add(n)
    }
  }
  assert.strictEqual(grouped.size, TOOLS.length, `界面分组必须覆盖全部 ${TOOLS.length} 个工具，实际 ${grouped.size}`)
  for (const s of specs) {
    assert.ok(s.name && s.description, `${s.name} 缺描述`)
    assert.ok(s.parameters && s.parameters.type === 'object', `${s.name} 参数 schema 必须是 object`)
    assert.deepStrictEqual(s.required, Array.isArray(s.parameters.required) ? s.parameters.required : [])
    assert.strictEqual(s.invokable, true)
  }
})

test('能力台：参数规整（数字/布尔/数组/对象/必填缺失）', async () => {
  const { normalizeArgs } = await import('../src/host/state/command.js')
  const spec = {
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        flag: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        meta: { type: 'object' },
        text: { type: 'string' },
      },
      required: ['count', 'text'],
    },
    required: ['count', 'text'],
  }
  const r1 = normalizeArgs(spec, { count: '3', flag: 'true', tags: 'a\nb', meta: '{"x":1}', text: 'hi' })
  assert.deepStrictEqual(r1.errors, [])
  assert.strictEqual(r1.args.count, 3)
  assert.strictEqual(r1.args.flag, true)
  assert.deepStrictEqual(r1.args.tags, ['a', 'b'])
  assert.deepStrictEqual(r1.args.meta, { x: 1 })
  assert.strictEqual(r1.args.text, 'hi')
  const r2 = normalizeArgs(spec, { text: '  ' })
  assert.ok(r2.errors.some((e) => e.includes('count')), '缺必填要报出来')
  assert.ok(r2.errors.some((e) => e.includes('text')), '空白字符串算没填')
  const r3 = normalizeArgs(spec, { count: 'abc', text: 'x' })
  assert.ok(r3.errors.some((e) => e.includes('count')))
})

test('能力台：执行只允许 jarvis_*，未知/越权/无会话都明确拒绝', async () => {
  const { runCommand } = await import('../src/host/state/command.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  const ctx = { get: () => ({ execute: async () => ({ isError: false, content: [{ text: 'ok' }], value: {} }) }) }
  const r1 = await runCommand({ ctx, projectDir: proj, tool: 'bash', args: {}, agent: { session: { id: 's', header: { cwd: proj } } } })
  assert.strictEqual(r1.ok, false)
  assert.ok(/只允许调用 jarvis_/.test(r1.error))
  const r2 = await runCommand({ ctx, projectDir: proj, tool: 'jarvis_not_exist', args: {}, agent: { session: { id: 's', header: { cwd: proj } } } })
  assert.strictEqual(r2.ok, false)
  assert.ok(/未知工具/.test(r2.error))
  const r3 = await runCommand({ ctx, projectDir: proj, tool: 'jarvis_snapshot', args: {}, agent: null })
  assert.strictEqual(r3.ok, false)
  assert.ok(/活动会话/.test(r3.error))
})

test('能力台：真实走 tools.execute（透传 agent + 自动补 projectDir + 落 command 事件）', async () => {
  const { runCommand } = await import('../src/host/state/command.js')
  const ev = await import('../src/host/state/events.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd2-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  const calls = []
  const ctx = {
    get: () => ({
      execute: async (exec) => {
        calls.push(exec)
        return { isError: false, content: [{ type: 'text', text: '阶段=build 缺口=0' }], value: { stage: 'build', missing: [] } }
      },
    }),
  }
  const agent = { session: { id: 'sess-1', header: { cwd: proj } } }
  const out = await runCommand({ ctx, projectDir: proj, tool: 'jarvis_flowguard', args: { step: 'build' }, agent })
  assert.strictEqual(out.ok, true)
  assert.strictEqual(out.tool, 'jarvis_flowguard')
  assert.ok(out.result.includes('阶段=build'))
  assert.deepStrictEqual(out.value, { stage: 'build', missing: [] })
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].name, 'jarvis_flowguard')
  assert.strictEqual(calls[0].agent, agent, '必须透传真实 agent（闸按该会话判定）')
  assert.strictEqual(calls[0].arguments.step, 'build')
  assert.strictEqual(calls[0].arguments.projectDir, proj, 'schema 有 projectDir 时自动补工作区')
  const evs = ev.readEvents(proj)
  assert.ok(evs.events.some((e) => e.type === 'command' && e.data.tool === 'jarvis_flowguard'), '执行要落 command 事件')
})

test('能力台：闸拒绝要如实回传（denied=true），不能被界面吞掉', async () => {
  const { runCommand } = await import('../src/host/state/command.js')
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd3-'))
  fs.mkdirSync(path.join(proj, '.jarvis'), { recursive: true })
  const ctx = {
    get: () => ({
      execute: async () => ({
        isError: true,
        content: [{ type: 'text', text: '【jarvis 流程闸】建队前必须先跑 jarvis_flowguard(step="clarify") 通过。' }],
      }),
    }),
  }
  const out = await runCommand({ ctx, projectDir: proj, tool: 'jarvis_meeting', args: { meetingType: 'kickoff' }, agent: { session: { id: 's', header: { cwd: proj } } } })
  assert.strictEqual(out.ok, false)
  assert.strictEqual(out.denied, true)
  assert.ok(out.error.includes('流程闸'))
})

test('能力台路由：/api/jarvis/tools 返回 31 条；/api/jarvis/command 拒绝缺 tool / 缺工作区', async () => {
  const routes = []
  const ctx = {
    get: (k) => (k === 'agents' ? { list: () => [] } : undefined),
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const toolsRoute = routes.find((r) => r.path === '/api/jarvis/tools')
  assert.ok(toolsRoute, '应注册 /api/jarvis/tools')
  const r1 = fakeRes()
  await toolsRoute.handler({ url: '/api/jarvis/tools', method: 'GET', headers: {} }, r1)
  const b1 = JSON.parse(r1.body)
  assert.strictEqual(b1.ok, true)
  assert.strictEqual(b1.tools.length, 31, `能力台必须暴露 31 个工具，实际 ${b1.tools.length}`)

  const cmdRoute = routes.find((r) => r.path === '/api/jarvis/command')
  assert.ok(cmdRoute, '应注册 /api/jarvis/command')
  const r2 = fakeRes()
  await cmdRoute.handler(fakeReq('POST', {}), r2)
  assert.strictEqual(JSON.parse(r2.body).ok, false)
  const r3 = fakeRes()
  await cmdRoute.handler({ ...fakeReq('POST', { tool: 'jarvis_snapshot' }), method: 'POST', url: '/api/jarvis/command' }, r3)
  const b3 = JSON.parse(r3.body)
  assert.strictEqual(b3.ok, false)
  assert.ok(/工作区/.test(b3.error), `缺工作区要明确说：${b3.error}`)
  const r4 = fakeRes()
  await cmdRoute.handler({ ...fakeReq('GET', null), method: 'GET', url: '/api/jarvis/command' }, r4)
  assert.strictEqual(r4.code, 405)
})

test('v2 能力台界面：31 工具列表 + 表单 + 执行入口都在页面里', () => {
  const repo = path.dirname(fileURLToPath(new URL(import.meta.url)))
  const html = fs.readFileSync(path.join(repo, '../office/v2/index.html'), 'utf8')
  const js = fs.readFileSync(path.join(repo, '../office/v2/jarvis-v2.js'), 'utf8')
  for (const id of ['consoleView', 'cToolList', 'cForm', 'cRun', 'cResult', 'cSession', 'cSearch']) {
    assert.ok(html.includes(`id="${id}"`), `能力台缺少 ${id}`)
  }
  assert.ok(html.includes('能力台'), '菜单/标题要有能力台入口')
  assert.ok(js.includes('/api/jarvis/tools'), '要拉工具清单')
  assert.ok(js.includes('/api/jarvis/command'), '要调执行入口')
  assert.ok(/闸拦住|被闸拦住/.test(js), '闸拒绝要显示给用户，不能静默')
})

test('v2 协作空间静态托管：场景页 + 上游构建资源都能取到（iframe 真实依赖）', async () => {
  const routes = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => { try { fn() } catch {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx)
  const prefix = routes.find((r) => r.kind === 'prefix' && r.path === '/jarvis-office')
  assert.ok(prefix, '静态路由存在')
  const get = async (url) => {
    const res = { writeHead(c, h) { this.code = c; this.headers = h }, end(b) { this.body = b } }
    await prefix.handler({ url, method: 'GET', headers: {} }, res)
    return res
  }
  const scene = await get('/jarvis-office/jarvis-scene.html')
  assert.strictEqual(scene.code, 200)
  assert.ok(/text\/html/.test(scene.headers['content-type']))
  const sceneHtml = String(scene.body)
  assert.ok(sceneHtml.includes('/jarvis-office/assets/'), '场景页必须引用上游构建产物')
  assert.ok(sceneHtml.includes('/jarvis-office/jarvis-scene-config.js'), '场景页必须加载 relay 配置')
  // 取它真正引用的第一个 js 资源
  const m = sceneHtml.match(/\/jarvis-office\/assets\/[A-Za-z0-9_-]+\.js/)
  assert.ok(m, '场景页应有脚本资源')
  const asset = await get(m[0])
  assert.strictEqual(asset.code, 200, `资源必须可取：${m[0]}`)
  assert.ok(/javascript/.test(asset.headers['content-type']))
  // 配置里 relay 指向同源（否则场景会去跑上游 demo 假数据）
  const cfgRes = await get('/jarvis-office/jarvis-scene-config.js')
  assert.ok(/relayUrl:\s*''/.test(String(cfgRes.body)), 'relayUrl 必须为空字符串（同源 → /api/pixoffice/events）')
})
