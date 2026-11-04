import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

/** 蒸馏内核：角色卡结构校验 / 深度打分 / 蒸馏引导 / 领域判定 / 内容指纹。
 *  纯逻辑，无宿主依赖；从 plugin.js 拆出，plugin.js re-export 保持导入面不变。 */

export const SECTIONS = ['身份定位', '思维模型', '核心方法论', '代表作品', '决策红线', '语言风格']

/** 女娲式蒸馏证据链必含段（防"迎合蒸馏/编造 source"硬闸）。 */
export const EVIDENCE_SECTIONS = [
  '证据链',      // 六维度调研记录（著作/对话/表达/他者/决策/时间线）
  '诚实边界',    // 做不到什么、信息截止时间、推测成分
  '保真度',      // 一手/二手/推断占比，矛盾点
]


/**
 * 协同架构四要素（CEO 卡硬闸）：子角色如何协同的最小完备集。
 * CEO 决定子角色后，必须为每个角色明确：位置/依赖/介入时机/协同方式。
 * 缺任一 → 协同设计不完整，禁止建队。
 */
export const COLLAB_FOUR = ['位置', '依赖', '介入时机', '协同方式']

export function checkCollabHealth(collabText, roleCount) {
  const issues = []
  if (!collabText || !collabText.trim()) return ['缺少协同架构（每个角色需 位置/依赖/介入时机/协同方式）']
  for (const f of COLLAB_FOUR) {
    if (!collabText.includes(f)) issues.push(`协同架构缺「${f}」`)
  }
  if (!/(升级|裁决|CEO|review|上报|复核)/.test(collabText)) issues.push('无冲突升级路径（角色分歧向谁升级？应有 jarvis_review/CEO 裁决）')
  if (!/并行|同时|实时|讨论|辩论/.test(collabText)) issues.push('未体现并行协作（应非串行交接：角色并行讨论/实时同步）')
  if (roleCount && !/(每个角色|逐角色|all|所有角色)/.test(collabText) && roleCount > 1) {
    // 仅当文本明显只描述单一角色而无全局协同视角时提示
  }
  return issues
}

/** 六段式/协同架构/证据链/保真度 结构校验（女娲式：不只要"有"，还要"查实"）。 */
export function validateCardShape(card, isCeo) {
  const missing = []
  if (typeof card !== 'string' || !card.trim()) {
    return ['角色卡全文'].concat(isCeo ? ['协同架构'] : []).concat(EVIDENCE_SECTIONS)
  }
  for (const s of SECTIONS) {
    if (!card.includes(s)) missing.push(s)
  }
  if (isCeo && !card.includes('协同架构')) missing.push('协同架构')
  if (isCeo && !card.includes('协同')) missing.push('协同')
  if (!card.includes('source')) missing.push('source')
  // 防冒名声明必须【独立出现】：
  //   - 含 "防冒名" 字样（如"防冒名声明：…"），或
  //   - 存在一行【独立】的"不冒充署名/只借鉴框架…"声明（行首起、不含其他段内容）。
  //   纯粹混在"代表作品：…不冒充署名"一行内不算独立声明（防 bug：避免漏加防冒名段）。
  const lines = card.split('\n')
  const hasDisclaimer =
    card.includes('防冒名') ||
    lines.some((l) => {
      const t = l.trim()
      return (t.startsWith('不冒充署名') || t.startsWith('本角色卡借鉴') || t.startsWith('只借鉴框架')) && t.length < 60
    })
  if (!hasDisclaimer) missing.push('防冒名声明')

  // ── 女娲式证据链硬闸（防迎合蒸馏：source 必须可查实，不能只是出现字样）──
  for (const es of EVIDENCE_SECTIONS) {
    if (!card.includes(es)) missing.push(es)
  }
  const hasSourceUrl = /https?:\/\/[^\s）)】]+/.test(card)
  if (!hasSourceUrl) missing.push('source 真实URL(需 https://…，防编造出处)')
  // 诚实边界必须提到"信息截止"或"推测成分"其一
  if (!/(信息截止|推测|局限|做不到)/.test(card)) missing.push('诚实边界(信息截止/推测成分/做不到什么)')

  // ── 协同架构四要素硬闸（"子角色如何协同"最小完备集；CEO 卡必含）──
  if (isCeo) {
    for (const f of COLLAB_FOUR) {
      if (!card.includes(f)) missing.push(`协同架构缺「${f}」`)
    }
    const collabIssues = checkCollabHealth(card, 1)
    for (const ci of collabIssues) {
      if (!card.includes('并行') && /并行/.test(ci)) missing.push(ci)
    }
  } else {
    // 非 CEO 角色卡：分工明确硬闸——必须含"我的协同/我的位置"声明（知道自己干什么、依赖谁、向谁升级），
    // 不能只是一张"思考风格"卡。缺 → 分工不明确，禁止注入。
    const myCollab =
      card.includes('我的协同') ||
      card.includes('我的位置') ||
      card.includes('我的依赖') ||
      card.includes('本角色') ||
      card.includes('我负责')
    if (!myCollab) missing.push('我的协同（本角色位置/依赖/介入时机/升级路径——分工明确硬闸）')
    if (!/位置|上游|下游|并行|横向/.test(card) && !/负责|职责|干什么/.test(card)) missing.push('我的位置/职责')
    if (!/(依赖|从.*(拿|获取|接收|取)|给.*(喂|提供|交)|喂|提供)/.test(card)) missing.push('我的依赖（依赖谁/给谁喂产出）')
    if (!/(升级|裁决|CEO|review|上报|向谁)/.test(card)) missing.push('我的升级路径（分歧向谁升级）')
  }
  return missing
}

/** 角色卡深度评估（防"浅层蒸馏"：结构标题齐全 ≠ 内容有深度）。
 * 无网可判定的"实质"证据：六段正文不是空话、方法论含 HOW 动作链、证据链六维度逐项带内容、
 * 有反例/失效边界（真实方法的边界感）、source 域名真实（非保留域）+ 有查证痕迹（蒸馏时实际搜过）。
 * 返回 0-100 深度分 + 各维度问题清单。浅层卡（标题齐全但内容空洞）必须被拦住。
 */
export function assessCardDepth(card, isCeo) {
  const issues = []
  const text = String(card ?? '')
  // ── 1. 六段式正文实质（标题后要有内容，不能是空话/占位）──
  const PLACEHOLDER = /待(填|补|写)|xxx|……|…\s*$|暂缺|未写|TODO|不详|无内容/i
  const depthSections = {}
  const lines = text.split('\n')
  let cur = ''
  for (const ln of lines) {
    const m = ln.match(/^\s*([^：:\n]{2,12})[：:]\s*(.*)$/)
    if (m && SECTIONS.includes(m[1].trim())) {
      cur = m[1].trim()
      depthSections[cur] = m[2] || ''
    } else if (cur && ln.trim()) {
      depthSections[cur] = (depthSections[cur] || '') + ln
    }
  }
  let filled = 0
  for (const s of SECTIONS) {
    const body = (depthSections[s] || '').trim()
    if (body.length >= 15 && !PLACEHOLDER.test(body)) filled++
    else issues.push(`「${s}」内容太空洞（应≥15字且非占位/空话，当前='${body.slice(0, 20)}'）`)
  }
  // ── 2. HOW 而非 WHAT：思维模型/核心方法论须含动作链（怎么做，不是贴标签）──
  const HOW = /(先|再|然后|若|则|当|按|根据|判断|优先级|流程|步骤|对比|拆解|验证|假设|原则[：:]|反推|复盘|迭代)/
  const methodologyText = (depthSections['思维模型'] || '') + (depthSections['核心方法论'] || '')
  const hasHow = HOW.test(methodologyText)
  if (!hasHow) issues.push('思维模型/核心方法论只有标签没有"怎么做"的动作链（HOW 而非 WHAT：要写出先做什么、遇到什么情况怎么办）')
  // ── 2b. 防"展示型空泛"（卡不贵多贵有用——"注重数据驱动/追求卓越/思维缜密"看着厉害但干活用不上）──
  //   评价性形容词/空泛名词堆砌（无具体对象+动作）= 展示型内容：检测高密度空泛词 → 内容不可用
  const FLAIR_WORDS = /注重|坚持|追求|秉持|卓越|严谨|缜密|深刻|敏锐|洞察|前瞻|科学|专业|高效|优质|全面|深入|不断|持续|优化|提升|驱动|创新|赋能|以.{0,6}(为导向|为核心|为原则)|全局视角|战略眼光|行业经验|跨领域/
  const flairMatches = (methodologyText.match(new RegExp(FLAIR_WORDS.source, 'g')) || [])
  // 空泛密度：方法论文本里每 25 字出现 ≥1 个空泛词 = 空泛堆砌（如"注重数据驱动与量化分析以科学方法指导决策"密度极高）
  const flairDensity = methodologyText.length > 0 ? flairMatches.length / (methodologyText.length / 25) : 0
  const hasFlairOverload = flairDensity >= 2.5 && flairMatches.length >= 3
  if (hasFlairOverload) issues.push('思维模型/核心方法论是"展示型空泛"（评价性形容词堆砌：注重/追求/卓越/严谨/洞察/驱动/优化…看着厉害但干活用不上——无具体对象+动作）。卡不贵多贵有用：每条内容须是"遇到X→做Y"的可执行行为，纯评价词=没用=删掉换成具体做法')
  // ── 3. 证据链六维度逐项带内容（不是光秃秃列词）──
  // 证据链/诚实边界不在 SECTIONS 六段里，直接在全文中定位
  const evidenceText = text
  const DIMS = ['著作', '对话', '表达', '他者', '决策', '时间线']
  let dimsCovered = 0
  for (const dim of DIMS) {
    const idx = evidenceText.indexOf(dim)
    // 该维度出现且后面 30 字内有实质内容（非空话）
    if (idx >= 0) {
      const tail = evidenceText.slice(idx + dim.length, idx + dim.length + 30)
      if (tail.trim().length >= 2 && !PLACEHOLDER.test(tail)) dimsCovered++
    }
  }
  if (dimsCovered < 5) issues.push(`证据链六维度只覆盖 ${dimsCovered}/6（著作/对话/表达/他者/决策/时间线 须逐项带实际内容，不是列词）`)
  // ── 4. 反例/失效边界（真实方法的边界感；女娲"保留矛盾"）──
  const hasBoundary = /不适用|边界|例外|反例|失效|不成立|局限|矛盾|张力|做不到/.test(text)
  if (!hasBoundary) issues.push('无反例/失效边界（真实方法论应写明"什么情况不适用/会失效"，防把方法当万能）')
  // ── 5. source 真实性：域名非保留域 + 蒸馏有查证痕迹 ──
  const url = (text.match(/https?:\/\/[^\s）)】]+/) || [''])[0]
  const RESERVED = /example\.com|localhost|127\.0\.0\.1|\.test\b|your-domain|占位/
  const hasReservedDomain = RESERVED.test(url)
  if (!url) issues.push('无 source URL')
  else if (hasReservedDomain) issues.push(`source 域名不可信（${url.slice(0, 40)} 是保留/示例域，不可能有真实内容——需换成真实查到的 URL）`)
  const hasVerifyTrace = /查证|核实|搜索|检索|web 搜|查到|访问.*页|原文|出处|检索记录/.test(text)
  if (!hasVerifyTrace) issues.push('无查证痕迹（应写明"本次 web 搜索了什么/在哪页确认了真人与其方法"——证明真查过，不是编 URL）')
  // ── 6. 诚实边界实质（信息截止须带具体时间/版本；不只在六段式里找）──
  const hasHonestyDepth = /(信息截止[:：]?\s*(20\d\d|202\d|至今|某月|v\d|版本)|截至\s*20\d\d|推测成分[:：]?\s*(已标注|已标)|做不到[:：])/.test(text)
  if (!hasHonestyDepth) issues.push('诚实边界缺具体信息截止（应写"信息截止到 20XX-XX"或"截至版本"，不是只说"有推测"）')

  // ── 6b. 职业底线（学 agent-qa 实证：报告真相/验证用户实际感受/歧义问清/判失败有证据——比"红线"主动）──
  //   真大佬的卡应写出"他面对过关压力/模糊/失败时怎么保证真实负责"（红线=不许做什么；职业底线=必须怎么想）
  // 职业底线 = "主动的职业操守"（报告真相/验证用户所见/宁诚实不编造…）——不含被动红线词（不虚报/不假装是红线，不是职业底线）
  const PROFESSION_HIT = /职业底线|报告真相|报告真实|不让测试通过|验证用户(实际|所见)|用户实际(看到|感受)|客户实际(看到|感受)|宁[可愿]?.*分诚实|宁可.*不要.*编造|真相优先|职业操守|以用户所见|对使用者负责|对客户负责.*真实/
  // 红线（决策红线段）里的"不虚报/不假装"是"不许做什么"，不算主动职业底线——用上下文排除：若整卡只在"决策红线"后出现被动词，不算命中
  const hasPassiveOnly = /决策红线[\s\S]{0,200}不虚报|决策红线[\s\S]{0,200}不假装|决策红线[\s\S]{0,200}不硬撑/
  let hasProfession = PROFESSION_HIT.test(text)
  // 若唯一命中的是被动红线表述（决策红线段内的不虚报/不假装），不算主动职业底线
  if (hasProfession && !/职业底线|报告真相|报告真实|不让测试通过|验证用户(实际|所见)|宁[可愿]?.*分诚实/.test(text)) {
    hasProfession = false
  }
  if (!hasProfession) issues.push('建议含"职业底线"（该人物怎么保证产出真实/负责/不糊弄：真相优先/验证用户实际感受/歧义问清/判失败有证据/先查自身——红线是不许做什么，职业底线是他必须怎么想。例：测试大师"报告真相不让测试通过"）')

  // ── 6c. 深度分析动作链（防"卡只有标签没深度"——狮子搏兔亦需全力：分析须有把事彻底想透的动作链）──
  //   卡的核心方法论除了"先做A再做B"流程，须有"深挖信号"（对照基准/逐项找全/追根因/找全遗漏）——只贴标签没深挖动作=浅层卡
  const DEEP_CHAIN = /立基准|参照|对照|逐项|逐[字词字段规则环节部分]|找全|不漏|全覆盖|追(问|到|根)|根因|影响面|反(问|查)|自查|还有哪|遗漏|闭环|严重度|边界情况|异常处理|用户(视角|角度|实际|会)/
  const hasDeepChain = DEEP_CHAIN.test(methodologyText)
  if (!hasDeepChain) issues.push('核心方法论只有表层流程没有"深度分析动作链"（狮子搏兔亦需全力：应有 立基准→逐项对照找全→追问根因→自查遗漏 这类把事想透的动作——如"对照基准逐项查差异/追到根因/反问哪块没查"；只写"先做A再做B"=浅层，小任务也要深度分析）')

  // ── 评分（0-100）──
  let score = 0
  score += filled * 6            // 六段实质内容 36
  if (hasHow) score += 15        // HOW 动作链 15
  score += Math.min(15, dimsCovered * 2.5) // 证据链维度 15
  if (hasBoundary) score += 10   // 反例边界 10
  if (url && !hasReservedDomain) score += 10 // source 域名 10
  if (hasVerifyTrace) score += 8 // 查证痕迹 8
  if (hasHonestyDepth) score += 6 // 诚实边界 6
  if (hasProfession) score += 5  // 职业底线
  if (hasDeepChain) score += 5  // 深度分析动作链
  score = Math.min(100, Math.round(score))
  const verdict =
    score >= 75
      ? `深度合格（${score}/100）：六段有实质内容、方法论含 HOW、证据链维度齐全、有反例边界与查证痕迹。`
      : score >= 55
        ? `深度一般（${score}/100）：结构齐全但内容偏浅，建议补实后再用。`
        : `深度不足（${score}/100）：属于"标题齐全内容空洞"的浅层卡——蒸馏人不许把浅卡当成品交付。`
  return { score, issues, filled, hasHow, dimsCovered, hasBoundary, hasVerifyTrace, hasProfession, hasDeepChain, verdict }
}

/** 蒸馏独特性引导器（蒸馏能力核心：借鉴 distilly 24k★ 方法论，引导捕捉"这个大佬独有的 HOW"）。
 * 蒸馏最强的卡 = 方法论里能看出"这是谁在想"：独有的决策触发词、独特取舍、领域黑话、
 * 反直觉原则、认知变化轨迹——而不是"先分析再执行"这种任何人都能写的通用话术。
 * 融合 distilly 的 7 品味原则 + 来源分级 + 认知时间线 + 决策启发式 + 验证锚点。
 */
export function distillGuide(role, material, industry) {
  const src = String(material ?? '').length
  return {
    role,
    industry: industry || '（CEO 判断）',
    purpose: '从真实素材提炼「这个大佬独有的思考方式（HOW）」，不是填六段式模板。',
    tastePrinciples: [
      '长文 > 碎片（一篇文章的思维结构 > 50 条推文）',
      '争议 > 共识（被争论的立场比被一致夸赞的更能暴露独特性）',
      '变化 > 固定（他改主意的地方比始终如一的地方更有信息量）',
      '一手 > 二手（本人的话 > 别人的转述）',
      '讲过程 > 传记（怎么谈做事过程 > 人生故事）',
      '重复模式 > 单句金句（跨 5 个情境反复出现的模式 > 一句爆款）',
      '失败讨论 > 成功叙事（怎么讲栽过的跟头 > 胜利复盘）',
    ],
    sourceHierarchy: [
      '一手著作/长文/Newsletter（最高权重）',
      '长访谈/播客 30min+（含时间戳）',
      '有据可查的决策与转折点（案例/公开记录）',
      '短视频/短文/问答',
      '他人分析/传记（仅用于定位一手源，不作独立证据）',
      '二手转述（只用来找源头）',
    ],
    sourceBlacklist: ['知乎（匿名/道听途说）', '微信公众号（二手洗稿）', '百度百科（不可靠/过时）', '搜狐/网易/腾讯自动聚合', 'SEO 内容农场', 'AI 生成的传记页', 'Listicle（"X 的 10 堂课"除非直引一手）'],
    sourceRecommended: ['B站长视频/访谈', '小宇宙播客完整集', '36氪/晚点LatePost/财新/极客公园/虎嗅', '认证微博原发（非转发/粉号）', '正规出版物', 'Youtube 长访谈(Fridman/Ferriss 等)', '个人博客/Substack', 'TED/大会完整视频+转录'],
    steps: [
      '① 抓决策触发词：从素材里找出他/她"遇到什么情况，第一反应做什么"的固定句式（如"先看现金流，再谈增长"）——独有 HOW 的指纹',
      '② 抓独特取舍：找出"宁可 A 也不要 B"式偏好（如"宁可慢一点也要自己掌控供应链"）——他与别人的分野',
      '③ 抓领域黑话/专有概念：他自创或用得独特的词（如"有效GMV""第一性原理拆解"）——他看世界的独特坐标系',
      '④ 抓反直觉原则：他做过的"看起来反常识但坚持"的决策——最能体现真本事',
      '⑤ 抓认知变化轨迹：他"从 A 观点变成 B 观点"的时刻（比始终如一更能揭示思考演进）——写成认知时间线而非生平',
      '⑥ 抓失效边界：他自己承认"这个方法在什么情况不适用"——真实方法的边界感',
    ],
    decisionHeuristics: '提炼决策启发式：他面对不确定性时的默认动作（如"先最小验证再放大""先假设对方是善意的"）——是可执行的 if-then 规则，不是泛泛原则。',
    achievementTrace:
      '🏆 **成就反推工作方式（"影子"的真正来源——不是他说过什么，是他做出了什么）**：真实人物取得的成就是**结果证据**（他真做到了，骗不了人），从成就反推的工作方式比访谈里说的更真实（访谈可能包装，成就不会）。做法：\n' +
      '  ① 列出他**取得的真实成就**（做出了什么/改变了什么/被公认的成果——不只职位头衔）；\n' +
      '  ② 对每个成就问"**他怎么工作才做到的？**"——反推背后的**工作习惯**（每天怎么投入/怎么决策/怎么取舍/怎么对待失败/怎么组织人），写成可执行的"他工作时的固定动作"；\n' +
      '  ③ 成就与成就之间找**重复模式**（跨多个成就反复出现的工作方式 = 他最可靠的习惯，不是偶然）；\n' +
      '  ④ 反推时区分"成就的归因"（什么工作方式真导致了成就 vs 运气/时代红利）——找因果证据，不把时代红利当他本事；\n' +
      '  ⑤ 产出 = "他的影子习惯清单"：遇到 X 情况 → 他会怎么工作（不是他怎么想，是**他怎么动手**）——这是员工干活时的行为指南。\n' +
      '  例：Hamel 做出 Humanocracy（成就）→ 反推工作方式：先量化官僚成本再设计新组织（先算账再动手）、拿 7000 人调研做证据（用数据不用感觉）、对照去层级化标杆（找参照系）。',
    validationAnchors: '写卡后用两个锚点自检：①已知答案测试（拿他真实的公开决策，看卡里的方法论能否复现他的选择）；②边界测试（拿一个他没遇到过的新问题，看卡里能否给出像他会给的答案）。两条都过 → 卡才真"像他"。',
    antiGeneric: '⚠️ 防通用话术：如果方法论能被任何管理者套用（"先分析再执行""以结果为导向"），说明没捕捉到独特性——打回重提炼。',
    personBar:
      '🔒 **选人闸（蒸馏前先确认：这是该领域真正厉害的人物，不是"真实但平庸"）**——虚拟办公的完成度=员工能力=蒸馏对象的水平，所以选人必须选强的。判断是否"领域厉害人物"：\n' +
      '  ① 可命名贡献：他/她的方法被命名/被引用（如"PDCA=Deming""情境驱动测试=Bach"）或开创了学派/范式（不只做过项目）；\n' +
      '  ② 公认度：被该领域同行广泛引用/教科书收录/权威机构认可（不止个人博客自夸）；\n' +
      '  ③ 排他性：**蒸馏前先想"这个领域公认最强的是谁"**——如果知道还有更被公认/更顶级的人物，就选那个，不将就；\n' +
      '  ④ 反例：真实存在但方法可被任何人套用（无独有命名贡献/无公认度）= 不合格，换人；\n' +
      '  ⑤ 领域可扩展：任何领域都有厉害人物（软件=大师、制造=质量/精益大师、教育=教学法开创者、医疗=循证权威、农业=育种/植保权威…）——**没有"这个领域没有厉害人物"这回事，只有没去找**。\n' +
      '  选人闸不过 → 不进入素材提炼，先换更强的人选再蒸馏。',
    evidenceTrace:
      '🔎 **证据溯源分级（每项能力标注"真实环境查得到影子的等级"——防把推断当他说过/做过）**：蒸馏出的每项能力/工作方式必须标证据级，员工只把 A/B 当真影子用，C 不冒充：\n' +
      '  [A 原文级]：他**亲口说过/亲手写过**（著作/访谈/文章原文）——标"出自哪篇哪句"（如 Hamel"先算官僚税"出自 HBR 2011 原文）——影子最硬；\n' +
      '  [B 行为级]：他**真实做过**（决策/项目/调研/行为记录，有公开记录）——标"哪个行为/项目"（如 Hamel 做过 7000 人 HBR 读者调研）——影子可靠；\n' +
      '  [C 推断级]：从成就**反推**的工作方式（他没直接说过/无行为记录，是蒸馏者推断"他大概这么工作"）——**必须显式标 [C推断]**，且**不得冒充 A/B 当真影子驱动员工产出**（防止把脑补当他本事）；C 只作"可能的工作方式"参考，写卡时优先找 A/B 证据替代它。\n' +
      '  铁律：**A/B/C 混着不标 = 不合格**——用户分不清哪些真查得到影子、哪些是推断；宁可 60 分诚实（标 C 推断）不要 90 分编造（把推断写成他说过）。每项能力写卡格式：[A|B|C] 能力内容（出处/行为/推断依据）。',
    fingerprintTrace:
      '🎨 **产出指纹提炼（"产出能看出人物影子"的判据——不是方法论描述，是产出本身可辨识的特征）**：每个人物的产出都有"指纹"——他做出来的东西里**反复出现、可辨识、别人难模仿**的特征（跨作品/成就找重复），员工产出对照指纹就能看出"像不像他做的"。\n' +
      '  做法（从真实作品/成就提炼，不是从他说过什么）：\n' +
      '  ① 看他反复做出来的东西（画作/著作/方案/产品/决策记录）——跨多个找**重复出现的特征**（如梵高跨画作反复出现厚涂笔触/高饱和黄蓝/漩涡笔法——他的视觉指纹；Fowler 反复小步重构/演进式架构——他的工作指纹）；\n' +
      '  ② 每条指纹要**具体到能在产出里逐项检查**（"厚涂笔触/黄蓝高饱和"可查；"有创意"不可查——抽象词不是指纹）；\n' +
      '  ③ 指纹 = 员工产出时的**创作/工作判据**：每步问"这样做像不像他的指纹"；产出后验证者**对照指纹逐项查产出**（有厚涂?有黄蓝?——有=有影子，无=没影子）。\n' +
      '  产出格式：指纹清单每条 = 指纹名 + 可查特征（怎么在产出里认出它）+ 出自哪个作品/成就（证据）。',
    workbenchTrace:
      '🧰 **工作台需求反馈（人物卡自己反馈"这领域做这活要什么环境工具"——不许默认 Linux 万能、不许乱搞）**：蒸馏时一并反馈该人物的"工作台需求"（写进卡的 `工作台需求：` 段）：\n' +
      '  ① 做这类产出要什么环境/工具（本领域必需，不是通用 Linux——软件=编译器/运行环境；短视频=剪辑工具；画画=绘图工具/画布；设计=设计软件）；\n' +
      '  ② 默认环境（Linux shell）够不够——够=直接干；不够=明确列出缺什么工具/环境；\n' +
      '  ③ 缺了会怎样（能否降级产出/还是产不出真东西）；\n' +
      '  ④ 红线：默认环境不够却硬干/假装产出 = 一票否决（产出是假的）——环境不到位如实上报等准备，不硬装不糊弄。\n' +
      '  反馈格式：{"workspaceNeeds":{"tools":["本领域必需工具/环境"],"linuxEnough":true|false,"missing":["缺什么"],"fallback":"缺了能否降级/还是做不了真产出"}}。',

    aiDisplacementTrace:
      '🤖 **AI 执行平替（人物保留判断/审美/决策，执行从人工工具平移到 AI 工具——前 AI 时代的工具太重）**：真实人物成就多是前 AI 时代用人工工具做的（一笔笔画/手动剪片/手写代码），数字员工在 AI 时代要用 AI 替代人工执行。蒸馏时给每条工作方式标执行方式：\n' +
      '  [判断] 必须人物亲自判断（怎么选/怎么评好坏/审美取舍/AI 生成后他选哪个）——AI 不能代，代了=丢影子；\n' +
      '  [AI执行] 可用 AI 工具提速（调研→AI 分析、生成初稿→AI 生成、批量→自动化），保留判断标准 AI 只做执行；\n' +
      '  [人工] 必须真实人工/真实验证（真测试/真部署/真人确认）——不许 AI 假装完成。\n' +
      '  红线：判断被 AI 代=丢影子；执行不 AI 化=工具太重；[人工] 环节 AI 冒充=一票否决。\n' +
      '  反馈格式：每条工作方式标 [判断]/[AI执行]/[人工]，如 {"workHabits":[{"habit":"先量化再动手","execMode":"判断","aiNote":"量化可用AI分析提速但「量什么」是判断"}]}。',

    professionTrace:
      '🛡️ **职业底线提炼（该人物"怎么保证自己产出的真实/负责/不糊弄"——比红线更主动：红线是不许做什么，职业底线是他必须怎么想）**：每个专业领域真正厉害的人物，都有"职业操守"——面对"过关压力 vs 真相"时他怎么做。蒸馏任何角色（不只测试）都要提炼，学 agent-qa 源码实证的测试职业素养（报告真相/验证用户所见/歧义问清/失败有证据），抽象为领域无关的通用职业底线：\n' +
      '  ① **真相优先于过关**：他面对"显得完成 vs 真实情况"怎么选（如测试大师"报告真相，不让测试通过"；质量大师"不虚报合格"；医生"不隐瞒误诊"）——他宁可承认没做完也不假装做完；\n' +
      '  ② **验证用户/客户实际感受到的**：他不只用内部技术指标自证，会站在使用者角度验证真实体验（测试看用户所见、产品问用户感受、制造查客户使用）——不被"指标达标"骗过"体验有问题"；\n' +
      '  ③ **歧义先问清不瞎猜**：目标不唯一/信息不足时他怎么做（问清/上报/暂停），不硬猜硬干；\n' +
      '  ④ **判失败/判不合格要有证据**：他什么时候认定"这个不行"（有可复现证据/验证矛盾/确证缺失），不轻易下结论也不硬撑；\n' +
      '  ⑤ **先排除自身问题再归咎对方**：出错时他先查自己（自己的理解/操作/假设对不对），再判对方问题；\n' +
      '  ⑥ **区分问题类型**：他把失败/缺陷分类（产品问题 vs 我的问题 vs 环境问题），分类指向修复方向，不笼统说"失败了"；\n' +
      '  ⑦ **经验沉淀**：他做过的事会沉淀成方法/清单/教训，下次直接复用，不每次从零。\n' +
      '  做法：从素材找这位人物"面对压力/错误/模糊/失败时的真实选择"（访谈/著作/决策记录里他对"该不该糊弄/该不该凑合/该不该硬撑"的态度）→ 提炼成他的职业底线清单。\n' +
      '  产出格式：{"professionLines":[{"line":"职业底线(如 报告真相不让测试通过)","evidence":"出自素材哪段/他哪个真实选择","applyTo":"这个角色干活时怎么用(如 QA 测出问题必须报不因进度压力放水)"}]}。',

    deepAnalysisTrace:
      '🔬 **深度分析动作链（防"人物卡分析问题浅层"——蒸馏的核心缺口：卡里只有思维标签/方法论标签，没有"把一件事彻底想透"的完整动作链）**：真人厉害不只在"怎么想"，更在遇到核心任务时**自动走一套把问题分析到透的动作**（多年经验形成的深度习惯）。**铁律：狮子搏兔亦需全力——无论项目大小/任务大小，都要最深度分析透彻，不许因为"小需求/小改动"就浅层分析、表层就觉得透了**（小问题里的细节缺失，和大事一样会让用户验收时发现问题）。蒸馏任何角色必须提炼：**他做这类核心任务时，怎么系统地把事情彻底分析清楚**——写成可执行的完整动作链（不是标签，是"先做什么→再做什么→直到什么才算分析透"）。\n' +
      '  深度动作链的通用骨架（任何领域，按角色核心任务填具体动作）：\n' +
      '  ① **立基准/找参照**：分析"新东西/现状"前先找到"该对什么负责"的基准（原物/规格/标准/用户期望）——没有基准的分析是飘的；\n' +
      '  ② **逐项对照找全**：对着基准**逐构成部分/逐规则/逐环节/逐交互点**查一遍（不只用户提过的点）——找"该有却没有/不一样"的全部差异，**主动找全不等人列举**；\n' +
      '  ③ **每个发现追问到底**：对每个可疑点问"为什么会这样/影响什么/还有哪会同样问题"——追到根因和影响面，不浮于表面；\n' +
      '  ④ **分级与闭环**：发现的问题标严重度（用户会不会觉得有问题）、标怎么解决（自己修/需上报/需裁决），**每个都闭环不悬空**；\n' +
      '  ⑤ **自查"分析透了吗"**：反问"基准里还有哪块没查？用户实际用会碰到什么我没想的？"——直到找不出遗漏才算分析完；\n' +
      '  ⑥ **真实验证（静态核对 ≠ 验证——scan 教训：测试"读代码 diff"就判通过，用户一用发现问题）**：他的分析/判断**必须靠真实运行/真实使用验证**（把东西跑起来用、真实环境试、真机走查），**不许"看代码/看文档/能编译"就当验证过**——静态只能证明"看起来对"，真实验证才证明"用起来对"。\n' +
      '  做法：从素材找这位大佬"做核心任务时的完整过程/方法"（访谈讲他怎么做一个东西/著作写他的工作方法/决策记录）→ 提炼成他的**深度动作链**（遇核心任务→他先做什么→再…→直到怎么算透）。\n' +
      '  产出格式：{"deepAnalysisChain":{"task":"他的核心任务类型","chain":["①立基准…","②逐项对照…","③追问到底…"],"completeWhen":"怎么算分析透了(找不出遗漏/基准全覆盖)"}}。',

    sourceCheck: src
      ? `素材已提供（${src} 字符）：从中逐条找上面 6 类证据，每条标注"出自素材哪段/哪个出处"，并给素材质量分级（一手/二手）。`
      : '⚠️ 未提供素材：先用 web_search 查该领域真实权威（长访谈/一手文章/决策记录优先，避开黑名单源），把原文摘进来再提炼——不许凭印象编。',
    respondAs: `输出蒸馏作业：{"role":"${role || '?'}","achievements":[{"achievement":"他取得的真实成就","workHabits":["从该成就反推的工作方式(怎么动手做到的)"]}],"shadowHabits":[{"trigger":"遇到X情况时","habit":"他会怎么工作(固定动作)"}],"howFingerprints":[{"trigger":"遇到X时→先做Y","source":"出自素材哪段"}],"tradeoffs":["宁可A不要B"],"jargon":["独有概念"],"counterIntuitive":["反直觉决策"],"cognitionTimeline":["A观点→B观点的变化时刻"],"failureBoundary":["不适用场景"],"decisionHeuristics":["if-then 规则"],"knownAnswerTest":["拿真实决策验证卡的方法论能否复现"],"draftCard":"基于以上提炼的六段式卡草稿(待 jarvis_distill 校验)"}。`,
  }
}

/** 四个模型工具定义（ToolDefinition 形态，供 tools.register） */
// 内容指纹核验（ws8634 借鉴 P0）：核验"声称结论 vs run 实际 synthesis/end-state 结论"一致性
// 防空跑/结论脱节/编造结论——独立于 step-guard 记录（即使无 run 记录，有产出文件也能核验）
export function checkContentFingerprint(evidenceDir, claimedConcl) {
  const _path = _require('node:path')
  const _fs = _require('node:fs')
  if (!claimedConcl) return null
  const dir = String(evidenceDir ?? '').trim()
  if (!dir) return '传了 claimedConclusion 但未传 evidenceDir——无法读 run 实际结论做一致性核验（防空跑）'
  const synthCands = ['stage-synthesis.json', 'end-state.md', 'outcome.json']
  let actualConcl = ''
  for (const c of synthCands) {
    try {
      const p = _path.join(dir, c)
      if (_fs.existsSync(p)) {
        const txt = _fs.readFileSync(p, 'utf8')
        const keys = ['recommendation', 'conclusion', '结论', '推荐']
        if (keys.some((k) => txt.includes(k))) { actualConcl = txt.slice(0, 800); break }
        if (c === 'end-state.md' || c === 'outcome.json') { actualConcl = txt.slice(0, 800); break }
      }
    } catch {}
  }
  if (!actualConcl) return '未找到 run 的 synthesis/end-state 产出——无法核验声称结论是否来自实际思考（防空跑）'
  const claimKeys = String(claimedConcl).replace(/[，。；：、\s]/g, ' ').split(/\s+/).filter((x) => x.length >= 2).slice(0, 4)
  const overlap = claimKeys.some((k) => actualConcl.includes(k))
  if (!overlap) return '内容指纹不匹配：声称结论「' + String(claimedConcl).slice(0, 40) + '」在 run 实际 synthesis/end-state 产出中找不到对应——结论疑似脱节/编造（run 可能空跑或结论对不上）'
  return null
}


export function identifyIndustry(text) {
  const raw = String(text ?? '').trim()
  const len = raw.length
  const S_PLACEHOLDER = /(个|点|做|弄|搞|写|建|出|给|上|来|下)\s*(东西|那个|这个|一下|点点|点啥|啥|什么|随便|大概|差不多)|(东西|那个|这个|什么)\s*$/i
  const hasActionVerb = /(做|建|改|写|开发|设计|搭|搞|弄|出|给|帮我|规划|运营|方案|系统|平台|小程序|APP|应用|网站|页面|流程|功能|机器人|助手|工具|服务|产品)/i.test(raw)
  // 统一 vague：占位词 或 短且无动作词（如"你好"——短无动作=无实质需求线索）
  const vague = S_PLACEHOLDER.test(raw) || (len <= 5 && !hasActionVerb)
  // 领域可判性：有具体对象/行业线索（非占位非纯寒暄）→ 领域可从文本判；否则判不出
  const hasDomainClue = /系统|平台|小程序|网站|应用|电商|金融|制造|医疗|教育|农业|监测|管理|工具|服务|方案|APP|店|厂|矿|公司|项目/.test(raw)
  const suggestion = vague
    ? 'S：先澄清（需求过于模糊——请用户说具体想干什么/说详细点，从中判断需求方向与领域；未清晰前不建队）'
    : len <= 5
      ? 'S：直接做（不需要建队）'
      : len < 40
        ? 'M：精简公司（现场蒸馏子角色；团队大小由需求拆解出的环节定，不预设人数）'
        : 'L：全链公司（现场蒸馏带队者+子角色；团队大小由需求拆解出的环节定，不预设人数）'
  return {
    industry: '由 CEO 现场判断（插件不预设领域，避免套模板）',
    suggestion,
    distillDirections: ['CEO 按本项目需求特性，web 搜索该领域真实可查证权威（现场决定，不预置名单）'],
    matched: false,
    vague,
    // 领域是否可判：非模糊且文本含领域线索 → 可判；模糊/无线索 → 判不出(需请用户说详细点)
    domainDeterminable: !vague && hasDomainClue,
    reason: vague
      ? '需求过于模糊（占位词或短无动作）——判不出领域方向，请用户说具体想干什么（说详细点：想做什么/解决什么问题/给谁用），从描述中判断领域'
      : hasDomainClue
        ? '文本含领域线索，可按文本判断领域方向'
        : '文本无明显领域线索，但非模糊——进入需求打磨时由 CEO+专家进一步判断领域',
  }
}

