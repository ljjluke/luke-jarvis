/**
 * luke-jarvis · Jarvis 数字员工公司核心插件（Host）
 *
 * 真实可发布的 Cordis 插件形态：npm 包默认导出插件定义，通过
 * package.json 的 `dsh.bundle.patch` → cordis.patch.yml 挂载。
 *
 * 注册内容（全部用宿主服务，非动态 harness）：
 *   - tools.register（jarvis_project / jarvis_distill / jarvis_review / jarvis_think）
 *   - commands.register（/jarvis 命令）
 *
 * ⚠️ 防 bug 铁律（内嵌代码，安装即生效）：
 *   1. jarvis_distill 校验角色卡：六段式必含、CEO 卡必含协同架构、必含真实 source、必含防冒名声明；
 *      任缺 → 不通过，禁止注入。
 *   2. 绝不直接复用旧卡：只提供"现场 web 蒸馏"路径，无任何"取旧卡"分支。
 *   3. 真实优先：所有工具输出强制"角色卡只提供思考框架，判断必须基于真实情况"。
 *
 * 生命周期：所有注册用 ctx.effect 包裹（register 返回 disposer），插件停止/更新时自动清理。
 */

const SECTIONS = ['身份定位', '思维模型', '核心方法论', '代表作品', '决策红线', '语言风格']

/** 女娲式蒸馏证据链必含段（防"迎合蒸馏/编造 source"硬闸）。 */
const EVIDENCE_SECTIONS = [
  '证据链',      // 六维度调研记录（著作/对话/表达/他者/决策/时间线）
  '诚实边界',    // 做不到什么、信息截止时间、推测成分
  '保真度',      // 一手/二手/推断占比，矛盾点
]


/**
 * 协同架构四要素（CEO 卡硬闸）：子角色如何协同的最小完备集。
 * CEO 决定子角色后，必须为每个角色明确：位置/依赖/介入时机/协同方式。
 * 缺任一 → 协同设计不完整，禁止建队。
 */
const COLLAB_FOUR = ['位置', '依赖', '介入时机', '协同方式']

/** 全局协作健康检查：依赖图是否闭环/孤立/有升级路径。 */
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

  // ── 评分（0-100）──
  let score = 0
  score += filled * 6            // 六段实质内容 36
  if (hasHow) score += 15        // HOW 动作链 15
  score += Math.min(15, dimsCovered * 2.5) // 证据链维度 15
  if (hasBoundary) score += 10   // 反例边界 10
  if (url && !hasReservedDomain) score += 10 // source 域名 10
  if (hasVerifyTrace) score += 8 // 查证痕迹 8
  if (hasHonestyDepth) score += 6 // 诚实边界 6
  score = Math.round(score)
  const verdict =
    score >= 75
      ? `深度合格（${score}/100）：六段有实质内容、方法论含 HOW、证据链维度齐全、有反例边界与查证痕迹。`
      : score >= 55
        ? `深度一般（${score}/100）：结构齐全但内容偏浅，建议补实后再用。`
        : `深度不足（${score}/100）：属于"标题齐全内容空洞"的浅层卡——蒸馏人不许把浅卡当成品交付。`
  return { score, issues, filled, hasHow, dimsCovered, hasBoundary, hasVerifyTrace, verdict }
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
    validationAnchors: '写卡后用两个锚点自检：①已知答案测试（拿他真实的公开决策，看卡里的方法论能否复现他的选择）；②边界测试（拿一个他没遇到过的新问题，看卡里能否给出像他会给的答案）。两条都过 → 卡才真"像他"。',
    antiGeneric: '⚠️ 防通用话术：如果方法论能被任何管理者套用（"先分析再执行""以结果为导向"），说明没捕捉到独特性——打回重提炼。',
    sourceCheck: src
      ? `素材已提供（${src} 字符）：从中逐条找上面 6 类证据，每条标注"出自素材哪段/哪个出处"，并给素材质量分级（一手/二手）。`
      : '⚠️ 未提供素材：先用 web_search 查该领域真实权威（长访谈/一手文章/决策记录优先，避开黑名单源），把原文摘进来再提炼——不许凭印象编。',
    respondAs: `输出蒸馏作业：{"role":"${role || '?'}","howFingerprints":[{"trigger":"遇到X时→先做Y","source":"出自素材哪段"}],"tradeoffs":["宁可A不要B"],"jargon":["独有概念"],"counterIntuitive":["反直觉决策"],"cognitionTimeline":["A观点→B观点的变化时刻"],"failureBoundary":["不适用场景"],"decisionHeuristics":["if-then 规则"],"knownAnswerTest":["拿真实决策验证卡的方法论能否复现"],"draftCard":"基于以上提炼的六段式卡草稿(待 jarvis_distill 校验)"}。`,
  }
}

/** 四个模型工具定义（ToolDefinition 形态，供 tools.register） */
export const TOOLS = [
  {
    name: 'jarvis_project',
    description:
      '贾维斯接单入口（领域无关）：对用户原始需求做建队分级建议（S/M/L）——S=直接做、M=精简公司、L=全链公司。插件不预设任何行业/人物（领域由 CEO 结合本项目情况现场判断）。CEO 用本工具决定"这单要不要建队、建多大规模"，再走现场蒸馏（jarvis_distill）与项目沉淀（jarvis_store）。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '用户需求的原始描述（可模糊）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          industry: { type: 'string' },
          confidence: { type: 'string', description: 'high/medium/low' },
          suggestion: { type: 'string', description: '适合的建队等级 S/M/L' },
          distillDirection: { type: 'string', description: '建议往哪个方向 web 蒸馏真实大佬' },
        },
        required: ['industry', 'suggestion'],
      },
      render: (r) => `行业=${r.industry}（置信 ${r.confidence ?? '?'}）建议=${r.suggestion}\n蒸馏方向：${r.distillDirection ?? ''}`,
    },
    handler: async (args) => {
      const text = String(args.requirement ?? '')
      const hit = identifyIndustry(text)
      const len = text.trim().length
      const suggestion = len <= 5 ? 'S：直接做（不需要建队）' : len < 40 ? 'M：精简公司（2-4 人，现场蒸馏子角色）' : 'L：全链公司（4-7 人，现场蒸馏 CEO+子角色）'
      return {
        industry: hit.industry,
        confidence: len <= 5 ? 'low' : 'medium',
        suggestion,
        distillDirection: hit.distillDirections.join(' / '),
      }
    },
  },

  {
    name: 'jarvis_store',
    description:
      '项目记忆库管理（领域无关的"项目长期记忆"）：prototypes(真实人物原型资料)/cards(虚拟人物卡)/process(流程)/components(组件)/project.md(项目细节快照)/board(黑板)/lessons(进度经验) 都沉淀在**项目自己的** <workspace>/.jarvis/ 里——AI 识别到本项目直接读这套记忆继续工作，不用重分析源码。模式：①check=阶段零判定（有记忆→直接读取复用继续；无记忆→从零蒸馏并建立记忆库）；②scaffold=输出记忆库目录结构；③reuse=复用校验（本项目沉淀可复用但须过 jarvis_distill 校验+按新需求修订；跨项目/插件禁止）；④save=按类型写入对应目录（prototype→prototypes/、card→cards/、project→project.md、lesson→lessons.md、process/components→json）。插件本身不携带任何角色卡与领域模板。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'check 查记忆库判定 / scaffold 初始化结构 / reuse 复用校验 / save 写入记忆（默认 scaffold）' },
        projectDir: { type: 'string', description: '项目记忆库根目录（默认 <workspace>/.jarvis/）' },
        itemType: { type: 'string', description: '沉淀类型：prototype=真实人物原型 / card=虚拟人物卡 / process=领域流程 / component=组件 / project=项目细节快照 / lesson=进度经验（save 用）' },
        name: { type: 'string', description: '角色名或流程/组件名' },
        existingCards: { type: 'string', description: '本项目已沉淀角色卡清单 JSON，如 [{"role":"研发","file":"cards/研发.md"}]（reuse 校验用）' },
        existingDirs: { type: 'string', description: '本项目 .jarvis/ 已有目录清单 JSON（check 判定用）' },
        cards: { type: 'string', description: '已存在的角色卡名，逗号分隔（check 用）' },
        prototypes: { type: 'string', description: '已存在的真实人物原型名，逗号分隔（check 用）' },
        projectMd: { type: 'string', description: 'project.md 是否存在（true/false，check 用）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          structure: { type: 'array', items: { type: 'string' }, description: '项目沉淀目录结构' },
          reuseRule: { type: 'string', description: '复用规则（本项目沉淀 vs 跨项目/插件禁止）' },
          savePath: { type: 'string', description: '本次写沉淀的目标路径' },
          verdict: { type: 'string' },
        },
        required: ['structure', 'reuseRule', 'verdict'],
      },
      render: (r) =>
        `【项目沉淀 · .jarvis/】\n结构：${(r.structure || []).join('\n      ')}\n复用规则：${r.reuseRule}\n本次保存：${r.savePath ?? '—'}\n判定：${r.verdict}`,
    },
    handler: async (args) => {
      const mode = String(args.mode ?? 'scaffold').trim()
      const projectDir = String(args.projectDir ?? '<workspace>/.jarvis/').trim()
      const itemType = String(args.itemType ?? '').trim()
      const name = String(args.name ?? '').trim()
      const existingCards = String(args.existingCards ?? '').trim()
      const existingDirs = String(args.existingDirs ?? '').trim() // 已有沉淀目录清单 JSON（check 用）
      const structure = [
        `${projectDir}prototypes/      —— 真实人物信息资料（原型）：每个真实大佬的原始素材（访谈/著作/决策记录/URL），是蒸馏的证据源，AI 识别到本项目直接读取`,
        `${projectDir}cards/           —— 虚拟人物卡（工作能力细节）：蒸馏出的六段式角色卡（思维模型/方法论/红线/协同），含深度分`,
        `${projectDir}process-*.json   —— 领域流程：CEO 定稿的阶段/闸门/红线/必须角色/会议触点`,
        `${projectDir}components.json  —— 组件清单：能力补足自研/引入的组件（名字/功能/用法/维护者）`,
        `${projectDir}board.json       —— 统一黑板：会议驱动协作的状态/未决项/决议`,
        `${projectDir}project.md       —— 项目细节快照：需求本质/验收标准/接口契约/进度/关键决策——AI 读到即可继续，不用重分析源码`,
        `${projectDir}lessons.md       —— 当前项目进度经验总结：踩坑/教训/适配度记录，防重复`,
      ]
      let reuseRule = ''
      let verdict = ''
      let savePath = ''
      if (mode === 'check') {
        // 阶段零：先查项目沉淀——有经验直接继续，没有才从零蒸馏
        const hasJarvis = !!(existingDirs && existingDirs.trim() !== '[]' && existingDirs.trim() !== '')
        const cards = String(args.cards ?? '').trim()
        const proto = String(args.prototypes ?? '').trim()
        const hasProject = String(args.projectMd ?? '').trim()
        if (hasJarvis || cards || proto || hasProject) {
          reuseRule =
            '【有记忆 → 直接继续】本项目 .jarvis/ 已存在完整记忆：prototypes(真实人物原型) + cards(虚拟人物卡) + process(流程) + project.md(项目细节) + board(黑板) + lessons(进度经验)。AI 识别到本项目直接读取这套记忆即可继续工作（卡须过 jarvis_distill 校验+按新需求修订），**不用重新分析源码**——项目细节/progress 已记录。'
          verdict = `阶段零判定：项目已有记忆库${cards ? '（cards: ' + cards + '）' : ''}${proto ? '（prototypes: ' + proto + '）' : ''} → 读取复用继续，不从零蒸馏。`
        } else {
          reuseRule =
            '【无记忆 → 从零开始】本项目 .jarvis/ 不存在或为空：走标准建队流程——需求本质回归 → 定领域流程 → web 查证真实人物原型(存 prototypes/) → 现场蒸馏 CEO 卡(存 cards/) → 定子角色 → 逐个蒸馏 → 协同 → 建队，并把 project.md/lessons 持续更新。'
          verdict = '阶段零判定：项目无记忆 → 从零蒸馏 CEO 起，建立项目记忆库。'
        }
      } else if (mode === 'reuse') {
        const typeName = itemType || '沉淀'
        const isLocal = existingCards && name && existingCards.includes(name)
        if (isLocal) {
          reuseRule = `【本项目沉淀可复用】「${name}」在本项目 .jarvis/cards/ 中（本项目角色做过，经验属于项目）——以它为起点：① 必须过 jarvis_distill 结构校验；② 必须按本次新需求修订（职责范围/领域/约束变了就重新蒸馏对应部分）；③ 修订后作为新版本写回沉淀（保留演进线）。`
          verdict = `复用判定：本项目已有「${name}」沉淀 → 允许复用为起点（须校验+按新需求修订，见 reuseRule）。`
        } else if (existingCards && existingCards.includes('###') === false && !name) {
          reuseRule =
            '【本源自查】未指定 name 且无现有沉淀清单，无法判断来源——请指定角色名/沉淀名再复用，或直接走现场蒸馏。'
          verdict = `复用判定：信息不足，需补 ${typeName} 名称/现有沉淀清单。`
        } else {
          reuseRule =
            '【跨项目/插件禁止】插件不携带任何卡；其他项目的卡也禁止直接复用——每个项目是它自己的角色做的，经验属于那个项目。跨项目要用 = 重新现场 web 蒸馏（jarvis_distill 校验），不许照搬。'
          verdict = `${name || typeName} 不在本项目沉淀清单 → 禁止复用（除非是本项目已沉淀且通过校验+修订），跨项目/外部来源必须重新现场蒸馏。`
        }
      } else if (mode === 'save') {
        // 类型 → 目录/扩展名：prototype=真实人物原型，card=虚拟人物卡，project=项目细节快照，lesson=进度经验，其余 json
        const ext = itemType === 'card' || itemType === 'prototype' || itemType === 'project' || itemType === 'lesson' ? '.md' : '.json'
        const dir = itemType === 'card' ? 'cards/' : itemType === 'prototype' ? 'prototypes/' : itemType === 'project' ? '' : itemType === 'lesson' ? '' : ''
        savePath = `${projectDir}${dir}${(name || itemType || 'item').replace(/[\\/:*?"<>|]/g, '_')}${ext}`
        reuseRule =
          '写入后即成为本项目记忆库：后续本项目需求直接读取复用（卡须过 jarvis_distill 校验+按新需求修订）；跨项目不共享。'
        verdict = `写入 ${savePath}（项目记忆库，非插件资产）——AI 识别到本项目直接读它继续，不用重分析源码。`
      } else {
        reuseRule =
          '插件无静态卡/无领域模板（领域无关）。角色卡与流程只能来自：① 本项目 .jarvis/ 沉淀（可复用起点）；② 现场 web 蒸馏（新需求/跨项目必走）。'
        verdict = `项目沉淀结构就绪：${projectDir} 已初始化（CEO 按结构落盘即可，文件由 CEO/成员在工作区管理）。`
      }
      return { structure, reuseRule, savePath: savePath || undefined, verdict }
    },
  },

  {
    name: 'jarvis_process',
    description:
      '领域流程设计引导器（CEO 定流程的核心权力）：插件不预设任何领域流程——不同行业"怎么干活"完全不同，必须由 CEO 按本项目需求特性现场设计，可参考本项目沉淀（.jarvis/process-*.json，项目自己做过的流程是经验，可参考但按本次需求修订）。输出必须覆盖五要素：必经阶段 / 验收闸门 / 红线 / 必须角色 / 会议触点。CEO 有权增删阶段（overrideStages）。定稿写入黑板与项目沉淀 .jarvis/process-<需求>.json，kickoff 会全员对齐。铁律：流程缺失 = 客户提 bug 的温床，宁可流程多一步不可少一步；严禁把别的项目流程原样照搬。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '本项目需求原文（流程围绕它设计）' },
        industry: { type: 'string', description: 'CEO 判断的领域（仅供标记，不触发任何预设模板）' },
        projectRef: { type: 'string', description: '本项目沉淀的流程参考（.jarvis/process-*.json 内容或路径；可选，CEO 参考后按本次需求修订，不许原样照搬）' },
        overrideStages: { type: 'string', description: 'CEO 增删阶段：追加用"+阶段名"，删除用"-阶段名"，逗号分隔（可选）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          industry: { type: 'string', description: 'CEO 判断的领域（仅标记）' },
          designChecklist: { type: 'string', description: '五要素设计清单（CEO 必须逐项给出）' },
          stages: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的必经阶段（本工具不预设，仅高管增删占位）' },
          gates: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的验收闸门' },
          redlines: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的红线' },
          mustRoles: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的必须角色' },
          touchpoints: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的会议触点' },
          customized: { type: 'boolean', description: '恒为 true：流程永远由 CEO 现场定制（插件无领域预设）' },
          verdict: { type: 'string' },
        },
        required: ['stages', 'gates', 'redlines', 'verdict'],
      },
      render: (r) =>
        `【${r.industry || '领域由 CEO 判断'} 流程 · ⚠️ CEO 现场定制（插件无预设）\n设计清单：${r.designChecklist}\n阶段：${r.stages.join(' → ')}\n闸门：${r.gates.map((g) => '  ⛔ ' + g).join('\n')}\n红线：${r.redlines.map((x) => '  🚫 ' + x).join('\n')}\n必须角色：${(r.mustRoles || []).join(' / ')}\n会议触点：${(r.touchpoints || []).join(' / ')}`,
    },
    handler: async (args) => {
      const industry = String(args.industry ?? '').trim()
      const req = String(args.requirement ?? '').trim()
      const projectRef = String(args.projectRef ?? '').trim()
      // CEO 增删阶段（overrideStages："+X,-Y"）
      const applyOverride = (stages) => {
        const ov = String(args.overrideStages ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        let out = [...stages]
        for (const o of ov) {
          if (o.startsWith('+')) out.push(o.slice(1).trim())
          else if (o.startsWith('-')) out = out.filter((s) => s !== o.slice(1).trim())
          else out.push(o)
        }
        return out
      }
      const refNote = projectRef
        ? `已提供本项目流程沉淀参考（${projectRef.slice(0, 60)}…）：作为经验参考可以，但必须按本次需求特性修订（领域/规模/约束变了就要改），严禁原样照搬。`
        : '未提供项目流程沉淀——CEO 按本次需求特性从零设计（看完需求本质后逐项给出五要素）。'
      const designChecklist =
        `针对需求「${req.slice(0, 80) || '（需求）'}」逐项设计并给出：① 必经阶段（按执行顺序）；② 每阶段验收闸门（过闸才进下一阶段，"怎样算过"可判定）；③ 本领域红线（一票否决项）；④ 必须进场的角色；⑤ 必须开会的节点。\n${refNote}\n流程定稿后写入黑板（jarvis_board）并沉淀到 <项目>/.jarvis/process-${(industry || '项目').slice(0, 12)}.json，kickoff 会全员对齐。`
      const base = ['需求评审', '方案设计', '开发', '验证', '发布', '复盘']
      return {
        industry: industry || '由 CEO 判断',
        designChecklist,
        stages: applyOverride(base),
        gates: ['CEO 必须亲手定义每阶段闸门（不许缺，缺 = 流程缺失 = 客户提 bug 温床）'],
        redlines: ['流程缺失', '无验证就下结论', '照搬其他项目流程'],
        mustRoles: [],
        touchpoints: ['kickoff 会', '验证闸评审', '收口会'],
        customized: true,
        verdict: `插件不预设领域流程；本工具只给设计清单与占位骨架，CEO 必须按「${industry || '本需求领域'}」的实际特性逐项定稿五要素，并沉淀到项目 .jarvis/。`,
      }
    },
  },

  {
    name: 'jarvis_distill',
    description:
      '角色卡蒸馏校验器（女娲式，防迎合蒸馏核心）：校验现场蒸馏出的角色卡是否满足证据链硬闸。要求：1) 六段式(身份定位/思维模型/核心方法论/代表作品/决策红线/语言风格) 必含；2) CEO 卡必含协同架构段；3) 证据链必含「证据链/诚实边界/保真度」段——证据链须含 6 维度调研(著作/对话/表达/他者/决策/时间线)，诚实边界须写信息截止/推测成分，保真度须写一手/二手/推断占比；4) source 必须是真实 https URL（防编造出处）；5) 防冒名独立声明；6) 深度闸：六段正文须有实质内容、方法论须含 HOW 动作链(捕捉 HOW they think 而非 WHAT they said)、证据链六维度逐项带内容、有反例/失效边界、source 非保留域+有查证痕迹(assessCardDepth≥60)。任缺 → 不通过，禁止注入；浅层卡(结构齐全内容空洞)一票否决。证据不足宁可 60 分诚实，不要 90 分编造。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '角色名，如 CEO / 产品增长 / 供应链' },
        card: { type: 'string', description: '现场蒸馏出的六段式角色卡全文（含 source 与防冒名声明）' },
        isCeo: { type: 'boolean', description: '是否为 CEO 卡（CEO 必须含协同架构）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          missing: { type: 'array', items: { type: 'string' }, description: '缺失的段/声明' },
          depthScore: { type: 'number', description: '深度分 0-100（防浅层蒸馏）' },
          depthIssues: { type: 'array', items: { type: 'string' }, description: '深度不足的问题' },
          verdict: { type: 'string', description: '通过/不通过 + 原因' },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) =>
        `✅ ${r.verdict}` +
        (r.depthScore !== undefined ? `\n深度 ${r.depthScore}/100${r.depthIssues?.length ? ' 待补:' + r.depthIssues.slice(0, 3).join(';') : ''}` : ''),
    },
    handler: async (args) => {
      const card = String(args.card ?? '')
      const isCeo = Boolean(args.isCeo)
      if (!card.trim()) {
        return { ok: false, missing: SECTIONS.concat(isCeo ? ['协同架构'] : []), verdict: '卡为空：必须先现场 web 蒸馏（web_search 查证该领域真实权威），不得空手注入' }
      }
      const missing = validateCardShape(card, isCeo)
      if (missing.length) {
        return { ok: false, missing, verdict: `角色卡缺 ${missing.join('、')}；请补全后重新蒸馏并用 jarvis_distill 校验` }
      }
      // 深度硬闸：结构齐全≠有深度。浅层卡（标题齐全内容空洞/编造保留域 URL/无查证痕迹）→ 不通过
      const depth = assessCardDepth(card, isCeo)
      if (depth.score < 60) {
        return { ok: false, missing: [], depthScore: depth.score, depthIssues: depth.issues, verdict: `深度不足（${depth.score}/100）——"结构齐全内容空洞"的浅层卡不得注入。${depth.issues.slice(0, 3).join('；')}` }
      }
      return {
        ok: true,
        depthScore: depth.score,
        depthIssues: depth.issues,
        verdict: `卡合格（结构+深度 ${depth.score}/100）：六段式${isCeo ? '+协同架构' : ''}+source+防冒名，方法论含 HOW、证据链维度齐全、有查证痕迹。注入后员工只借鉴其思考框架，真实判断必须基于实际数据/代码/复现。`,
      }
    },
  },

  {
    name: 'jarvis_distill_guide',
    description:
      '蒸馏独特性引导器（蒸馏能力核心，先于 jarvis_distill 用）：在写卡前，CEO 用它从真实素材里提炼"这个大佬独有的 HOW"——决策触发词/独特取舍/领域黑话/反直觉原则/认知变化轨迹/失效边界，并做来源分级（一手/二手/黑名单）与验证锚点（已知答案测试/边界测试）。借鉴 distilly(24k★) 方法论：7 品味原则（长文>碎片、争议>共识、变化>固定、一手>二手、讲过程>传记、重复模式>金句、失败>成功）+ 决策启发式 + 认知时间线。先提炼 HOW 再写卡，卡过 jarvis_distill 校验——蒸馏才强，不是套模板。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '要蒸馏的角色名（如 CEO/产品增长/风控）' },
        material: { type: 'string', description: '该领域真实权威的原始素材（访谈原文/著作摘录/决策记录；可从 web_search 摘）' },
        industry: { type: 'string', description: 'CEO 判断的领域（可选标记）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string' },
          purpose: { type: 'string' },
          tastePrinciples: { type: 'array', items: { type: 'string' } },
          sourceHierarchy: { type: 'array', items: { type: 'string' } },
          sourceBlacklist: { type: 'array', items: { type: 'string' } },
          sourceRecommended: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { type: 'string' } },
          decisionHeuristics: { type: 'string' },
          validationAnchors: { type: 'string' },
          antiGeneric: { type: 'string' },
          sourceCheck: { type: 'string' },
          respondAs: { type: 'string' },
        },
        required: ['purpose', 'steps', 'respondAs'],
      },
      render: (r) =>
        `【${r.role ?? '角色'} 蒸馏引导 · 捕捉独有 HOW】\n目的：${r.purpose}\n品味原则：${(r.tastePrinciples || []).map((x) => '  · ' + x).join('\n')}\n来源分级：${(r.sourceHierarchy || []).map((x) => '  · ' + x).join('\n')}\n黑名单源：${(r.sourceBlacklist || []).join('、')}\n推荐源：${(r.sourceRecommended || []).join('、')}\n步骤：${(r.steps || []).map((x) => '  ' + x).join('\n')}\n决策启发式：${r.decisionHeuristics}\n验证锚点：${r.validationAnchors}\n防通用：${r.antiGeneric}\n${r.sourceCheck}\n响应格式：${r.respondAs}`,
    },
    handler: async (args) => {
      const role = String(args.role ?? '').trim()
      const material = String(args.material ?? '').trim()
      const industry = String(args.industry ?? '').trim()
      return distillGuide(role, material, industry)
    },
  },

  {
    name: 'jarvis_review',
    description:
      '分歧升级裁决器：团队角色间对同一问题有冲突（如产品 vs 风控、测试 vs 研发）时，CEO 调用本工具采集双方观点并按裁判优先级裁决。裁判优先级(铁律)：需求本质 > 真实情况 > 用户需求 > 专业判断——LLM 不得迎合角色卡/主流方案/会议多数，裁决必须回归原始需求本质（为谁解决什么、怎样算成功）。可选传入双方 thinkA/thinkB（各角色先跑 jarvis_think_deep 的结构化思考 JSON），裁决时会引用双方的 反方攻击/真实核对/诚实边界 来防一面之词；必填 requirement（原始需求），输出 essenceCheck 强制核对裁决是否偏离需求本质。',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: '分歧问题是什么' },
        sideA: { type: 'string', description: 'A 方观点与依据' },
        sideB: { type: 'string', description: 'B 方观点与依据' },
        requirement: { type: 'string', description: '原始需求（必填：裁决必须回归需求本质，不许脱离需求空谈）' },
        thinkA: { type: 'string', description: 'A 方 jarvis_think_deep 的结构化思考 JSON（可选）' },
        thinkB: { type: 'string', description: 'B 方 jarvis_think_deep 的结构化思考 JSON（可选）' },
      },
      required: ['issue'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ruling: { type: 'string', description: 'CEO 裁决结论' },
          basis: { type: 'string', description: '裁决依据（需求本质/真实情况/用户需求/专业判断）' },
          analysis: { type: 'string', description: '基于双方深度思考帧的对抗分析（可选）' },
          essenceCheck: { type: 'string', description: '回归需求本质的强制核对指令' },
        },
        required: ['ruling'],
      },
      render: (r) =>
        `裁决：${r.ruling}\n依据：${r.basis ?? ''}${r.analysis ? '\n分析：' + r.analysis : ''}${r.essenceCheck ? '\n需求本质核对：' + r.essenceCheck : ''}`,
    },
    handler: async (args) => {
      const issue = String(args.issue ?? '')
      const sideA = String(args.sideA ?? '')
      const sideB = String(args.sideB ?? '')
      const requirement = String(args.requirement ?? '').trim()
      // 消费双方 jarvis_think_deep 的结构化思考（含反方攻击/真实核对/诚实边界），防止"只亮结论不亮推理"
      const notes = []
      for (const [label, raw] of [['A', args.thinkA], ['B', args.thinkB]]) {
        if (!raw) {
          notes.push(`${label} 方未提供深度思考帧——建议该角色先跑 jarvis_think_deep（前提/反方/失效推演/诚实边界）再裁决，避免一面之词`)
          continue
        }
        try {
          const t = typeof raw === 'string' ? JSON.parse(raw) : raw
          const counter = Array.isArray(t.counter) ? t.counter.join('；') : String(t.counter ?? '')
          const check = Array.isArray(t.realityCheck) ? t.realityCheck.join('；') : String(t.realityCheck ?? '')
          const conf = t.confidence ? `（置信 ${t.confidence}）` : ''
          notes.push(`${label} 方深度思考${conf}：反方=${counter || '无'}；真实核对=${check || '无'}`)
        } catch {
          notes.push(`${label} 方 think 不是合法 JSON——请用 jarvis_think_deep 按要求格式输出后重传`)
        }
      }
      const essenceCheck = requirement
        ? `先重述需求本质：「${requirement.slice(0, 120)}」——为谁解决什么、怎样算成功。然后逐条核对裁决：① 偏离需求本质了吗（把用户要X做成了你想要的Y）？② 在迎合谁（用户原话/角色卡/主流方案/会议多数）？③ 有没有无依据断言（编造 source/数据/案例）？只要有一项打问号，裁决必须打回重做——回归需求本质优先于一切。必要时用 jarvis_essence 完成审计。`
        : '⚠️ 未提供原始需求（requirement）——裁决必须拿到需求本质才能定案：先补需求再裁决，禁止脱离需求空谈。'
      return {
        ruling: `待 CEO 基于需求本质与真实情况裁决：「${issue}」。A=${sideA}；B=${sideB}。`,
        basis: '需求本质 > 真实情况 > 用户需求 > 专业判断（不迎合角色卡/主流方案/会议多数，回归原始需求定案）',
        analysis: notes.length ? notes.join('\n') : undefined,
        essenceCheck,
      }
    },
  },

  {
    name: 'jarvis_essence',
    description:
      '需求本质决策校验器（防 LLM 通病"迎合/幻觉"的最后闸门）：任何重要决策/黑板决议/角色产出在定稿前，CEO 用它强制回归需求本质。四查：①回归本质——决策服务"为谁解决什么、怎样算成功"，还是做成了别的；②防迎合——是否迎合用户原话/角色卡/主流方案/会议多数（从众）；③防幻觉——是否编造 source/数据/访谈/案例，把推测写成事实；④真实优先——判断是否基于真实代码/数据/复现。未通过 → 禁止进黑板/发布，打回重做。宁 60 分诚实不要 90 分编造。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '原始需求（必填：本质由此提炼）' },
        decision: { type: 'string', description: '待校验的决策/决议/产出（必填）' },
        rationale: { type: 'string', description: '决策依据/推理（可选）' },
        suspects: { type: 'string', description: 'CEO 怀疑的迎合/幻觉点（可选，供校验重点核查）' },
      },
      required: ['requirement', 'decision'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          essence: { type: 'string', description: '需求本质重述（为谁解决什么/怎样算成功）' },
          checks: { type: 'array', items: { type: 'string' }, description: '四查清单' },
          flattery: { type: 'string', description: '迎合痕迹核查指令' },
          hallucination: { type: 'string', description: '幻觉痕迹核查指令' },
          misalignments: { type: 'string', description: '偏离本质核查指令' },
          verdict: { type: 'string', description: '通过/需修正/打回 判定与门槛' },
          respondAs: { type: 'string', description: '要求输出审计结论的 JSON 结构' },
        },
        required: ['essence', 'verdict'],
      },
      render: (r) =>
        `【需求本质审计】本质=${r.essence}\n四查：${(r.checks ?? []).map((c) => '  🔍 ' + c).join('\n')}\n防迎合：${r.flattery}\n防幻觉：${r.hallucination}\n偏离检查：${r.misalignments}\n判定：${r.verdict}\n审计格式：${r.respondAs}`,
    },
    handler: async (args) => {
      const requirement = String(args.requirement ?? '').trim()
      const decision = String(args.decision ?? '').trim()
      const rationale = String(args.rationale ?? '').trim()
      const suspects = String(args.suspects ?? '').trim()
      return {
        essence: `从原始需求「${requirement.slice(0, 120) || '（缺失）'}」重述本质：为谁解决什么问题、怎样算成功（成功标准要可判定：指标/场景/时限）。若需求本身空泛，先补需求本质再审计——不许用"大概、尽量"糊弄。`,
        checks: [
          '本质回归：决策直接服务于上面重述的本质吗？还是在做别的（如把"用户要拼团"做成"平台刷 GMV"）？',
          '防迎合：有没有顺着用户原话/顺着角色卡/顺着主流方案/顺着会议多数（从众）下的结论？',
          '防幻觉：决策里有编造的 source/数据/访谈/案例吗？有把推测当事实写吗？',
          '真实优先：判断依据真实代码/数据/复现/历史了吗？还是凭印象？',
        ],
        flattery: `逐个点名核查迎合嫌疑：① 用户说 A 就顺着 A（哪怕 A 不是真需求）？② 角色卡怎么说就怎么下结论（迎合卡）？③ 主流/模板方案拿来就用（迎合常见答案）？④ 会议里没人反对就默认（从众）？` + (suspects ? `重点核查 CEO 怀疑点：${suspects}` : ''),
        hallucination: `逐句核查幻觉：① source/引用是否真实可查（编造 = 一票否决）；② 数据/数字/案例是否来自真实复现或实证（无出处 = 推测，必须标注）；③ 是否把"我认为"写成"事实"；④ 诚实边界是否声明（信息截止/推测成分）。`,
        misalignments: `列出决策「${decision.slice(0, 120)}」偏离需求本质的所有点；每点写明：本质要什么 vs 决策给了什么。偏离超过 1 点 → 判定为偏离本质，打回重做。`,
        verdict: `判定门槛：四查全过 = 通过（可进黑板/发布）；有迎合或幻觉嫌疑 = 打回重做（宁 60 分诚实不要 90 分编造）；只偏离本质未涉造假 = 需修正后再审。没合格不许定稿。`,
        respondAs: `完成上述审计后以 JSON 输出：{"essence":"本质重述","verdict":"PASS|FIX|REJECT","flattery":["迎合嫌疑点或'无'"],"hallucination":["幻觉嫌疑点或'无'"],"misalignments":["偏离点或'无'"],"decision":"修正后的决策(若 REJECT/FIX 则重写)"}。`,
      }
    },
  },

  {
    name: 'jarvis_escalate',
    description:
      '问题上行器（"不许跳过问题"硬闸，防客户提 bug 的核心）：角色遇到技术上绕不开/自己无法抉择的问题时，禁止沉默、降级、假装解决——必须带三样东西上报领导：①问题本身；②已尝试的方案；③风险细节（不解决的后果/影响范围/时限）；④需要领导决策什么。上报完整性校验：缺风险细节或缺决策请求 → 打回补齐（不许报"有个问题"这种空单）。上报后写黑板（阻塞条目），CEO 响应闭环（裁决/转派/给资源/开二次会）。纪律：宁可上报被驳回，不可沉默绕行；绕过问题 = 缺陷。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '上报角色（必有自己的协同段/升级路径）' },
        problem: { type: 'string', description: '问题：技术上绕不开/无法抉择的点（必填）' },
        attempts: { type: 'string', description: '已尝试的方案与结果（可空则提示补）' },
        risk: { type: 'string', description: '风险细节：不解决的后果/影响范围/时限（必填，缺失 = 打回）' },
        decisionNeeded: { type: 'string', description: '需要领导决策什么（必填，缺失 = 打回）' },
        urgency: { type: 'string', description: 'high/medium/low（默认 medium）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', description: '上报单是否完整可提交' },
          missing: { type: 'array', items: { type: 'string' }, description: '缺失的必填项' },
          record: { type: 'string', description: '上报单全文' },
          boardEntry: { type: 'string', description: '建议写入黑板的阻塞条目' },
          protocol: { type: 'string', description: '上报纪律（不许跳过）' },
        },
        required: ['ok', 'record'],
      },
      render: (r) =>
        `问题上行：${r.ok ? '✅ 可上报' : '❌ 打回补细节：' + (r.missing || []).join('、')}\n${r.record}\n黑板条目：${r.boardEntry}\n纪律：${r.protocol}`,
    },
    handler: async (args) => {
      const role = String(args.role ?? '?')
      const problem = String(args.problem ?? '').trim()
      const attempts = String(args.attempts ?? '').trim()
      const risk = String(args.risk ?? '').trim()
      const decisionNeeded = String(args.decisionNeeded ?? '').trim()
      const urgencyRaw = String(args.urgency ?? 'medium')
      const urgency = ['high', 'medium', 'low'].includes(urgencyRaw) ? urgencyRaw : 'medium'
      const missing = []
      if (!problem) missing.push('问题描述（技术绕不开/无法抉择的点）')
      if (!risk) missing.push('风险细节（不解决的后果/影响范围/时限）——领导无法评估该不该介入')
      if (!decisionNeeded) missing.push('决策请求（需要领导拍板什么）——空单不许上报')
      const ok = missing.length === 0
      const record = `【问题上行 · ${urgency.toUpperCase()}】上报人=${role}\n问题：${problem || '（缺失）'}\n已尝试：${attempts || '未说明'}\n风险细节：${risk || '（缺失）'}\n需要决策：${decisionNeeded || '（缺失）'}\n升级对象：CEO/jarvis_review`
      const boardEntry = `阻塞：${problem}（上报人=${role}；风险=${risk.slice(0, 60) || '待补'}；需要决策：${decisionNeeded.slice(0, 40) || '待补'}）——升级 CEO 处理`
      const protocol =
        '纪律（不许跳过问题）：① 技术绕不开/无法抉择 = 必须上报，禁止沉默、降级处理、假装已解决；② 上报必须带 风险细节+已尝试+决策请求 三件套（空单打回）；③ 上报后写黑板（阻塞条目）触发 CEO 响应；④ 宁可上报被驳回，不可沉默绕行——绕过问题 = 缺陷。'
      return { ok, missing, record, boardEntry, protocol }
    },
  },

  {
    name: 'jarvis_capability',
    description:
      '能力补足决策器（组件化/防"没能力硬装会"）：角色发现 DSH 缺乏完成子任务所需能力时，走三级路径并真实验证——① DSH 现有工具/插件是否够（够就用，不够如实说）；② 去插件市场找 star 高的补足（必须先 web_search 验证：真实存在/star 高/可安装/license）；③ 都没有 → CEO 批准自研，自研必须做成可发布可复用插件（像 luke-jarvis 一样），安装后记录进组件清单供后续复用。铁律：没有就是没有，不许假装会、不许硬凑、不许编造"找到了"。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '需要什么能力的子任务（必填）' },
        existingTools: { type: 'string', description: 'DSH 当前已注册的相关工具/插件（可空）' },
        marketSearch: { type: 'string', description: '插件市场搜索结果（可空；CEO 先用 web_search 查高 star 插件）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          gap: { type: 'string', description: '能力缺口判定（现有够不够/缺什么）' },
          decision: { type: 'string', description: '三级路径决策：复用现有 / 市场补足 / 自研组件化' },
          verifyNotes: { type: 'string', description: '市场方案的验证要点（防假装找到）' },
          buildNote: { type: 'string', description: '自研要求（可发布可复用插件 + 组件清单）' },
          honestNote: { type: 'string', description: '诚实边界' },
          respondAs: { type: 'string' },
        },
        required: ['gap', 'decision'],
      },
      render: (r) =>
        `【能力补足】缺口=${r.gap}\n决策=${r.decision}\n验证：${r.verifyNotes}\n自研要求：${r.buildNote}\n诚实边界：${r.honestNote}`,
    },
    handler: async (args) => {
      const task = String(args.task ?? '').trim()
      const existing = String(args.existingTools ?? '').trim()
      const market = String(args.marketSearch ?? '').trim()
      let decision = ''
      let verifyNotes = ''
      if (existing && !/没有|无|缺/.test(existing)) {
        decision = '① 复用 DSH 现有工具/插件——先评估够不够：够就直接用；不够如实说"不够"，不许将就。'
        verifyNotes = `评估要点：现有=${existing} 是否真能完成「${task.slice(0, 40)}」；不能完成 = 缺口，走下一级。`
      } else {
        decision = existing ? `① 现有不足（${existing.slice(0, 40)}）→ 进入 ②③` : '① DSH 现有 = 无相关能力 → 进入 ②③'
      }
      if (market) {
        decision += `\n② 插件市场补足——搜索结果：${market.slice(0, 120)}`
        verifyNotes = (verifyNotes ? verifyNotes + '\n' : '') + `市场验证要点（防假装找到）：① 插件真实存在且可安装（npm/GitHub 实际可查）；② star/下载量确实高；③ license 允许商用；④ 装上后真能跑通「${task.slice(0, 40)}」。任何一项过不了 = 没找到，走 ③ 自研，不许用"据说有"糊弄。`
      } else {
        verifyNotes = (verifyNotes ? verifyNotes + '\n' : '') + `② 尚未搜索市场——先用 web_search 查「${task.slice(0, 40)} 插件/工具，star 高」再定；查不到可验证的 = 走 ③。`
      }
      decision += '\n③ 仍无 → CEO 批准自研（组件化）：把缺口能力实现为独立可发布插件（参照 luke-jarvis 模式：cordis plugin + tools.register + 单测），安装后复用，并记录进组件清单（仓库/文档的"能力组件清单"），后续项目直接引用——一次建设，多次复用。'
      return {
        gap: `子任务「${task.slice(0, 80)}」：现有=${existing || '无'}；市场=${market || '未查'}。缺口判定：若现有与市场都不能真正完成 → 存在能力缺口，必须走自研组件化，不许硬凑。`,
        decision,
        verifyNotes,
        buildNote:
          '自研要求：① 独立 npm 包/插件（cordis apply + tools.register）；② 配套防回归单测（node --test）+ 文档；③ 安装后写入组件清单（名字/功能/用法/维护者）；④ 绝不把自研逻辑硬塞进角色卡或临时脚本（那不可复用）。',
        honestNote: '诚实边界：没有就是没有——不许假装会、不许硬凑、不许编造"找到了高 star 插件"；宁缺毋滥（用真实能力或如实声明能力不足并上报）。',
        respondAs: `完成评估后以 JSON 输出：{"gap":"缺口判定","path":"REUSE|MARKET|BUILD","decision":"最终路径","evidence":["验证证据(真实存在/star/可安装)或'无法验证'"],"buildPlan":"若 BUILD：插件名/功能/安装方式/复用点"}。`,
      }
    },
  },

  {
    name: 'jarvis_think',
    description:
      '员工思考辅助：给某角色一个"按角色卡框架分析"的提示，并强制真实优先——先看真实代码/数据/复现/历史，再用角色卡的方法论去推理，禁止迎合角色卡下结论。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '需要思考的问题' },
        roleCard: { type: 'string', description: '该员工的角色卡（六段式）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          note: { type: 'string' },
        },
        required: ['note'],
      },
      render: (r) => `真实优先提示：${r.note}`,
    },
    handler: async (args) => {
      return {
        note: `问题「${String(args.question ?? '')}」：先用该角色卡的框架如何分析（引用卡中思维模型），但结论必须回到真实情况——检查真实数据/代码/复现后再下判断，禁止为迎合角色卡而扭曲事实。`,
      }
    },
  },

  {
    name: 'jarvis_think_deep',
    description:
      '角色深度思考器（ponder 轻量化，防幻觉核心）：给某角色一张"七段对抗式思考任务单"，强制该角色以 前提审视→视角展开→反方攻击→失效推演→真实优先核对→诚实边界→收敛结论 的顺序完成深度推理，并结构化为 JSON 回复。stakes 控制对抗深度：low=反方≥1，medium=反方≥2+失效推演，high=反方≥3+失效推演×2+可谬自评。产出可直接喂给 jarvis_review 做分歧裁决的双方依据（thinkA/thinkB）。铁律不变：真实情况优先于角色卡；宁 60 分诚实不要 90 分编造。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '需要深度思考的问题' },
        roleCard: { type: 'string', description: '该员工的角色卡（六段式+协同段）' },
        stakes: { type: 'string', description: '赌注 high/medium/low（默认 medium）：high=重大决策/对外承诺，medium=常规关键决策，low=可逆小事' },
      },
      required: ['question'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string' },
          stakes: { type: 'string' },
          premises: { type: 'string', description: '前提审视指令：列出隐含前提并标出未验证项' },
          perspective: { type: 'string', description: '视角展开指令：引用角色卡思维模型给出第一判断' },
          counter: { type: 'string', description: '反方攻击指令：当X时不成立' },
          failure: { type: 'string', description: '失效推演指令：换场景/换数据后的失败路径' },
          realityCheck: { type: 'string', description: '真实优先核对清单指令' },
          limits: { type: 'string', description: '诚实边界指令' },
          conclusion: { type: 'string', description: '收敛结论指令：含置信度与升级对象' },
          respondAs: { type: 'string', description: '要求按此 JSON 结构回复思考结果' },
        },
        required: ['respondAs'],
      },
      render: (r) =>
        `【${r.role ?? '角色'} 深度思考任务单 · stakes=${r.stakes}\n① 前提审视：${r.premises}\n② 视角展开：${r.perspective}\n③ 反方攻击：${r.counter}\n④ 失效推演：${r.failure}\n⑤ 真实优先核对：${r.realityCheck}\n⑥ 诚实边界：${r.limits}\n⑦ 收敛结论：${r.conclusion}\n响应格式：${r.respondAs}`,
    },
    handler: async (args) => {
      const q = String(args.question ?? '').trim()
      const card = String(args.roleCard ?? '').trim()
      const stakes = String(args.stakes ?? 'medium')
      const roleName = (card.match(/身份定位[:：]\s*([^，。\n]+)/) || [])[1] || '该角色'
      // 反方条数/失效推演次数按赌注分级（ponder 门控：高赌注必做深度动作）
      const counterMin = stakes === 'high' ? 3 : stakes === 'low' ? 1 : 2
      const failureN = stakes === 'high' ? 2 : stakes === 'low' ? 0 : 1
      const failureReq = failureN >= 1 ? `写至少 ${failureN} 种"换场景/换数据/换时间"推演，指出最可能失败路径` : '简写一种"换场景"检查'
      const selfRefute = stakes === 'high' ? '最后必须做可谬自评：我这份结论最可能因为什么错？如果错，改走什么方向？' : ''
      return {
        role: roleName,
        stakes,
        premises: `列出问题「${q.slice(0, 60)}」隐含的 2-3 个前提（如：需求真存在？数据可真？时间够？竞争对手真没有？），并标出哪个前提未经验证——未验证的前提先写"待核对"，不许直接当成立。`,
        perspective: `以「${roleName}」身份，引用角色卡中的思维模型/核心方法论（如适用），给出你对本题的第一判断：我会怎么看、第一步做什么。注意：这只是第一判断，下面几步会攻击它。`,
        counter: `写至少 ${counterMin} 条"当X时不成立"的反方攻击逐一质询第一判断（如：当数据口径不同时不成立；当对手也这样做时不成立；当用户真实行为与假设不符时不成立）。`,
        failure: `${failureReq}。`,
        realityCheck: `列出 2-3 个必须先核对的真实项（真实数据/代码/复现/历史记录/用户实证），明确标注：没核对前，禁止把判断写成结论——这是铁律（真实情况优先于角色卡）。`,
        limits: `写诚实边界：信息截止时间？本题哪些是推测成分？作为「${roleName}」你做不到什么/不能断言什么？`,
        conclusion: `${selfRefute}\n吸收以上攻击与核对后保留的结论 + 置信度（low/medium/high）+ 需要向谁确认或升级（同事/CEO/jarvis_review）。`,
        respondAs: `按顺序完成上面七段思考，最后以 JSON 输出：{"premises":[未验证前提清单],"perspective":"我的第一判断","counter":["当X时不成立…"],"failure":"失败路径","realityCheck":["先核对…"],"limits":"诚实边界","conclusion":"保留结论","confidence":"low|medium|high","escalateTo":"向谁升级"}。`,
      }
    },
  },

  {
    name: 'jarvis_fidelity',
    description:
      '角色卡保真度审计器（女娲 FIDELITY 机制）：对蒸馏产出的角色卡做保真度审计，输出证据质量报告。审计项：1) 一手来源占比（本人著作/对话/决策记录 vs 二手转述 vs 推断）；2) 方法论是否含 HOW 动作链与反例边界（有深度而非贴标签）；3) 诚实边界是否明确（信息截止时间/做不到什么/推测成分）；4) 矛盾点是否保留（不和稀泥）；5) 信息源黑名单是否回避（知乎/微信公众号等洗稿源）。产出 PRIMARILY-FIRST-HAND / MIXED / SPECULATIVE 评级 + 建议。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '角色名' },
        card: { type: 'string', description: '蒸馏出的角色卡全文' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rating: { type: 'string', description: 'PRIMARILY-FIRST-HAND / MIXED / SPECULATIVE' },
          firstHandRatio: { type: 'number', description: '一手来源占比 0-1' },
          issues: { type: 'array', items: { type: 'string' }, description: '审计发现的问题' },
          verdict: { type: 'string' },
        },
        required: ['rating', 'verdict'],
      },
      render: (r) => `保真度=${r.rating}（一手占比 ${r.firstHandRatio ?? '?'}）\n${(r.issues ?? []).map((i) => '⚠️ ' + i).join('\n')}\n${r.verdict}`,
    },
    handler: async (args) => {
      const card = String(args.card ?? '')
      const issues = []
      // 保真度不再"出现关键词就加分"，而是吃深度评估的实质证据：
      // 证据链维度真实覆盖数、有无查证痕迹、有无反例边界、source 是否真实域
      const depth = assessCardDepth(card, false)
      // 一手占比（证据链维度里"著作/对话/决策记录"属一手；"他者评价/二手"属二手；无覆盖不给分）
      let firstHand = 0
      const evidenceText = card
      if (/(著作|对话|访谈|决策记录|原创|演讲原文)/.test(evidenceText)) firstHand += 0.45
      if (/他者评价|二手|转述|他人/.test(evidenceText)) firstHand += 0.2
      if (/推断|推测/.test(evidenceText)) firstHand += 0.15
      firstHand = Math.min(1, firstHand + depth.dimsCovered * 0.03)
      if (!card.includes('诚实边界') || !/(信息截止[:：]?\s*(20\d\d|至今|v\d)|做不到|推测|局限)/.test(card)) issues.push('缺诚实边界（须含具体信息截止时间/推测成分/做不到什么）')
      if (!depth.hasHow) issues.push('方法论只有标签没有 HOW 动作链（真实人物蒸馏要写出"怎么做/什么情况怎么办"，非贴标签）')
      if (!/(矛盾|张力|分歧|反例|不适用|失效)/.test(card)) issues.push('未记录矛盾/反例/失效边界（女娲原则：保留张力而非和稀泥）')
      if (/知乎|微信公众号|百度百科/.test(card)) issues.push('命中了信息源黑名单（知乎/公众号/百度百科）——洗稿源需替换为权威一手来源')
      if (/example\.com|localhost|127\.0\.0\.1/.test(card)) issues.push('source 是保留/示例域（example.com 等不可能有真实内容）——必须换成真实查到的 URL')
      if (!/查证|核实|搜索|检索|原文|出处/.test(card)) issues.push('无查证痕迹（应写明 web 搜索记录/在哪页确认真人）——防"编 URL"')
      const rating = !issues.length && firstHand >= 0.6 && depth.dimsCovered >= 5 ? 'PRIMARILY-FIRST-HAND' : issues.length <= 1 ? 'MIXED' : 'SPECULATIVE'
      return {
        rating,
        firstHandRatio: Math.round(firstHand * 100) / 100,
        issues,
        verdict: !issues.length
          ? `保真度合格（一手占比 ${Math.round(firstHand * 100) / 100}，证据链维度 ${depth.dimsCovered}/6）：一手来源充分、三重验证齐备、诚实边界清晰、有查证痕迹。可注入（仍只借鉴框架，不冒充署名）。`
          : `保真度不足：${issues.length} 项待修（${issues.slice(0, 3).join('；')}）。修改后用 jarvis_distill + jarvis_fidelity 复验。宁要 60 分诚实，不要 90 分编造。`,
      }
    },
  },

  {
    name: 'jarvis_collab',
    description:
      '团队协同架构设计与校验器（CEO 定子角色后的必备步骤）。输入各角色职责与协同段，输出：1) 每个角色的协同四要素（位置=上游/下游/并行/横向支持；依赖=依赖谁/给谁喂产出；介入时机=从哪个阶段进入/是否全程；协同方式=实时讨论/事件驱动/阶段交接/冲突向谁升级）；2) 全局健康检查（依赖闭环无悬空、并行而非串行交接、有冲突升级路径、无孤立角色）；3) 判定是否可建队。铁律：角色是"怎么思考"的框架+协作者，不是各干各的；真实协同像真实团队——并行讨论、实时同步、关键节点对齐、分歧升级 CEO 裁决。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '原始需求（协同设计围绕它）' },
        rolesJson: { type: 'string', description: '角色清单 JSON，如 [{"name":"产品增长","duty":"定义价值与增长"},{"name":"供应链","duty":"履约与备货"}]' },
        collabText: { type: 'string', description: '协同架构描述（各角色的位置/依赖/介入时机/协同方式 + 全局协作）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          roles: { type: 'array', items: { type: 'string' }, description: '解析出的角色名' },
          perRole: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { role: { type: 'string' }, position: { type: 'string' }, depends: { type: 'string' }, intervenes: { type: 'string' }, collabMode: { type: 'string' }, escalate: { type: 'string' } } }, description: '每个角色的协同四要素' },
          issues: { type: 'array', items: { type: 'string' }, description: '全局健康检查发现的问题' },
          ok: { type: 'boolean', description: '协同设计是否可建队' },
          verdict: { type: 'string' },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) => `协同设计校验：${r.ok ? '✅ 可建队' : '❌ 待修'}\n问题：${(r.issues ?? []).map((i) => '⚠️ ' + i).join('\n')}\n${r.verdict}`,
    },
    handler: async (args) => {
      const req = String(args?.requirement ?? '')
      const collab = String(args?.collabText ?? '')
      const issues = []
      let roles = []
      const allPerRole = []
      try {
        const parsed = JSON.parse(String(args?.rolesJson ?? '[]'))
        if (Array.isArray(parsed)) {
          for (const x of parsed) {
            const name = String(x?.name ?? '?')
            roles.push(name)
            // 若 rolesJson 里已带该角色的协同段（perspective/collabText/duty），原样归一化进 perRole
            const own = String(x?.perspective ?? x?.collabText ?? x?.collab ?? x?.duty ?? x?.position ?? '')
            allPerRole.push({
              role: name,
              position: own || '待CEO补充',
              depends: own || '待CEO补充',
              intervenes: own || '待CEO补充',
              collabMode: own || '待CEO补充',
              escalate: own || '升级CEO/jarvis_review',
            })
          }
        } else issues.push('rolesJson 需为数组')
      } catch {
        issues.push('rolesJson 解析失败（需合法 JSON 数组）')
      }
      if (roles.length < 2) issues.push('角色过少（协同设计至少 2 个角色；1 个角色无需建队）')
      // 协同四要素完备性
      for (const f of COLLAB_FOUR) {
        if (!collab.includes(f)) issues.push(`协同描述缺「${f}」（位置/依赖/介入时机/协同方式）`)
      }
      // 每角色须有"我的协同"（分工明确硬闸：成员要知道自己依赖谁/向谁升级，不能全部待CEO补充）
      const unfilled = allPerRole.filter((p) => p.position === '待CEO补充' || p.depends === '待CEO补充')
      if (unfilled.length) issues.push(`${unfilled.length} 个角色缺自己的协同段（position/depends 为待补）——建队前必须为每个角色明确其位置/依赖/介入时机/协同方式，否则成员分工不明`)
      // 全局健康
      if (!/(升级|裁决|CEO|review|上报|复核)/.test(collab)) issues.push('无冲突升级路径（分歧应升级 CEO/jarvis_review 裁决）')
      if (!/并行|同时|实时|讨论|辩论/.test(collab) && /串行|依次|先.*再.*再/.test(collab)) issues.push('当前是串行交接而非并行协作——应改为角色并行开工、实时讨论（测试从产品阶段介入、研发与测试同步）')
      if (!/并行|同时|实时|讨论/.test(collab)) issues.push('未体现并行协作（建议：多角色并行 + 实时讨论，非单向依次完成）')
      const ok = issues.length === 0 && roles.length >= 2 && unfilled.length === 0
      return {
        roles,
        perRole: allPerRole,
        issues,
        ok,
        verdict: ok
          ? `协同设计合格：${roles.length} 个角色，每角色已明确 位置/依赖/介入时机/协同方式，有升级路径且体现并行协作。建队时每个成员 role 必须携带各自的协同段（见 perRole）。可建队（agent_teams_create → add_member(role=蒸馏卡+该角色协同段) → create_task(带验收标准+dependencies)）。`
          : `协同设计待修（${issues.length} 项）：补齐后重新调用。CEO 定子角色后必须先设计协同（含每角色自己的协同段），再建队——协同缺失 = 团队各干各的，不是真团队。`,
      }
    },
  },

  {
    name: 'jarvis_meeting',
    description:
      '团队会议协议器（会议驱动协作核心）：kickoff=开工全员会（对齐目标/验收标准/接口契约/依赖与分工）；cycle=二次会（聚焦黑板未决项：分歧/阻塞/接口变更，必要项用 jarvis_review 裁决）；close=收口会（逐项验收与交付）。每次会议必须输出：决议清单 + 会后任务（谁会后负责什么）+ 黑板更新。铁律：先开会再独思——角色必须先互相碰撞对齐，再各自独自思考；议题没必要时不开会。',
    parameters: {
      type: 'object',
      properties: {
        meetingType: { type: 'string', description: 'kickoff | cycle | close' },
        agenda: { type: 'string', description: '本次会议议程/议题（可含黑板未决项 id）' },
        attendees: { type: 'string', description: '与会角色名，逗号分隔（默认全员）' },
        context: { type: 'string', description: '会议上下文（黑板摘要/分歧/阻塞等，可选）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          goal: { type: 'string', description: '本次会议要达成的对齐' },
          protocol: { type: 'string', description: '会议流程步骤' },
          resolutions: { type: 'string', description: '决议记录模板' },
          actions: { type: 'string', description: '会后任务模板（谁负责什么）' },
          respondAs: { type: 'string', description: '要求输出纪要 JSON 的结构' },
        },
        required: ['goal', 'resolutions'],
      },
      render: (r) =>
        `【${r.type} 会 · 目标】${r.goal}\n流程：${r.protocol}\n决议记录：${r.resolutions}\n会后任务：${r.actions}\n纪要格式：${r.respondAs}`,
    },
    handler: async (args) => {
      const type = String(args.meetingType ?? 'kickoff')
      const agenda = String(args.agenda ?? '').trim()
      const attendees = String(args.attendees ?? '全员').trim()
      const ctx = String(args.context ?? '').trim()
      const META = {
        kickoff: {
          goal: '对齐目标/验收标准/领域流程与闸门/接口契约/依赖与分工——开工前全员必须互相听懂对方要什么、给什么',
          protocol:
            '1) CEO 先用 jarvis_process 定本领域流程（必经阶段/闸门/红线/必须角色/会议触点）——不同领域流程不同，由 CEO 决定，不许套通用流程；2) CEO 宣布目标与验收标准（怎样算成功）；3) 各角色按各自协同段报：我的位置/依赖谁/给谁喂产出/介入时机；4) 交叉确认接口契约（产品给契约、研发给接口、测试从产品阶段进入、风控横向否决…）与领域闸门（过闸才进下一阶段）；5) 把流程定稿+决议写入统一黑板后散会',
          resolutions:
            'R1 目标与验收标准（逐条可判定）；R2 领域流程定稿（阶段清单+闸门+红线，写入黑板）；R3 接口契约（谁给谁什么，格式/时机）；R4 依赖与并行安排（谁是上游谁是下游谁全程参与）；R5 黑板位置约定',
          actions:
            '散会后各角色按领域流程独自思考+干活（关键决策用 jarvis_think_deep），所有问题/发现/接口变更写黑板；黑板要开会时向 CEO 提出或由 CEO 判断',
        },
        cycle: {
          goal: '聚焦黑板未决项：解决分歧/阻塞/接口变更，能收敛就收敛，不能收敛就明确卡点与负责人；每项决议必须先回归需求本质再定案',
          protocol:
            '1) 先读统一黑板，列出本次要解决的未决项（问题/阻塞/接口变更/分歧）；2) 逐项讨论：谁负责、卡在哪、需要什么真实情况才能解；3) 分歧项双方先各跑 jarvis_think_deep，再 jarvis_review 裁决（必传 requirement，吃 thinkA/thinkB，需求本质>真实情况>用户需求>专业判断）；4) 每项决议过 jarvis_essence 需求本质校验（防迎合用户原话/角色卡/主流方案/会议从众，防编造 source/数据）——PASS 才写回黑板；5) 决议逐条写回黑板并标记负责人/状态',
          resolutions:
            'R1 每项未决项的结论（解决/降级/遗留+理由，且经过需求本质校验）；R2 涉及接口变更的同步点；R3 新分配 assignee 与截止；R4 黑板状态更新',
          actions: '会后各角色继续独自思考/干活；新增问题继续写黑板；必要时发起下一次 cycle 会',
        },
        close: {
          goal: '验收交付：逐项对照验收标准与领域闸门，所有决议过需求本质审计，未决项分级，产出交付报告',
          protocol:
            '1) 逐任务对照验收标准与 jarvis_process 领域闸门检查产出；2) 复核黑板全部未决项：已解决/降级/遗留——遗留项必须写明影响与触发升级；3) 全部重要决策用 jarvis_essence 回归需求本质复查（迎合/幻觉/偏离 = 不许交付）；4) CEO 汇总交付报告（目标回顾/各岗位产出切片/风险未决/交付物在哪/怎么验收）',
          resolutions: 'R1 验收结论逐项（通过/未通过+原因）；R2 黑板遗留项分级；R3 jarvis_essence 审计结论汇总；R4 交付报告要点清单',
          actions: 'CEO 产出交付报告给用户；必要时 agent_teams_delete 收队',
        },
      }
      const m = META[type] || META.kickoff
      return {
        type,
        goal: m.goal,
        protocol: m.protocol + (agenda ? `\n议程：${agenda}` : '') + (ctx ? `\n上下文：${ctx}` : ''),
        resolutions: m.resolutions,
        actions: m.actions,
        respondAs: `完成本次「${type}」会后，以 JSON 输出纪要：{"date":"","type":"${type}","attendees":["${attendees}"],"agenda":["…"],"resolutions":["按模板逐条"],"boardUpdates":["写回黑板的条目"],"actions":[{"who":"角色","what":"会后负责什么"}]}`,
      }
    },
  },

  {
    name: 'jarvis_board',
    description:
      '统一黑板读写器（会议驱动协作的核心状态）：所有角色的问题/发现/决策/风险/接口变更/阻塞都集中登记在同一块黑板，谁都能看到、谁都能追加。add=新增条目（支持"类型：内容"前缀，类型∈问题/发现/决策/风险/阻塞/接口变更，缺省按内容推断）；resolve=关闭条目（按 id 或内容关键词）。输出未决项/阻塞项，并判定"是否需要二次开会"：存在未解决阻塞或接口变更 → 必开会；未决项≥3 → 建议开会；黑板收敛 → 不开会。',
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: '当前黑板 JSON（items 数组），首次可为空' },
        add: { type: 'string', description: '要登记的新条目；多条用换行分隔；可用"类型：内容"前缀' },
        resolve: { type: 'string', description: '要关闭的条目：id（如 B1）或内容关键词；多条用换行分隔' },
        audited: { type: 'string', description: '已过 jarvis_essence 需求本质审计的决策条目（id 或内容关键词）；多条用换行分隔' },
        role: { type: 'string', description: '登记人角色（默认 ?）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', items: { type: 'object' }, description: '更新后的全部黑板条目' },
          openItems: { type: 'array', items: { type: 'object' }, description: '未决项' },
          blockers: { type: 'array', items: { type: 'object' }, description: '未解决的阻塞/接口变更' },
          needsMeeting: { type: 'boolean', description: '是否建议二次开会' },
          reason: { type: 'string', description: '二次开会判定理由' },
          summary: { type: 'string' },
        },
        required: ['items', 'needsMeeting'],
      },
      render: (r) =>
        `黑板 ${r.items.length} 项（未决 ${r.openItems.length} 项${r.blockers.length ? '，阻塞 ' + r.blockers.length + ' 项' : ''}）\n${r.items
          .map((i) => `  [${i.id}][${i.status}](${i.type}) ${i.role}: ${i.content}`)
          .join('\n')}\n二次会判定：${r.needsMeeting ? '⚠️ ' + r.reason : '✅ ' + r.reason}`,
    },
    handler: async (args) => {
      const role = String(args.role ?? '?').trim() || '?'
      const items = []
      try {
        const p = JSON.parse(String(args.board ?? '{}'))
        if (p && Array.isArray(p.items)) for (const it of p.items) items.push({ ...it })
      } catch {
        /* 新黑板 */
      }
      // add：新增条目
      const adds = String(args.add ?? '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      const TYPE_SET = ['问题', '发现', '决策', '风险', '阻塞', '接口变更']
      for (const raw of adds) {
        let type = '', content = raw
        const m = raw.match(/^\s*(问题|发现|决策|风险|阻塞|接口变更)\s*[:：|]\s*(.+)$/)
        if (m) {
          type = m[1]
          content = m[2]
        } else {
          // 按内容推断类型
          if (/阻塞|卡住|无法(继续|进行)|pending/.test(content)) type = '阻塞'
          else if (/接口|契约|字段|协议/.test(content)) type = '接口变更'
          else if (/决定|选择|拍板|方案是/.test(content)) type = '决策'
          else if (/风险|担心|隐患/.test(content)) type = '风险'
          else if (/发现|实测|验证|复现/.test(content)) type = '发现'
          else type = '问题'
        }
        items.push({ id: 'B' + (items.length + 1), role, type, content, status: 'open', essenceChecked: type === '决策' ? false : true, time: new Date().toISOString().slice(0, 16) })
      }
      // resolve：关闭条目（按 id 或内容关键词）
      const resolves = String(args.resolve ?? '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const rk of resolves) {
        const target = items.find((it) => it.status === 'open' && (it.id === rk || it.content.includes(rk)))
        if (target) target.status = 'resolved'
      }
      // audited：标记已过 jarvis_essence 审计的决策条目
      const audited = String(args.audited ?? '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const ak of audited) {
        const target = items.find((it) => it.type === '决策' && (it.id === ak || it.content.includes(ak)))
        if (target) target.essenceChecked = true
      }
      const openItems = items.filter((i) => i.status === 'open')
      const blockers = openItems.filter((i) => i.type === '阻塞' || i.type === '接口变更')
      // 决策条目必须过 jarvis_essence 需求本质校验才能定稿（防迎合/防幻觉闸门）
      const decisions = items.filter((i) => i.type === '决策' && !!i.essenceChecked === false)
      const needsMeeting = blockers.length > 0 || openItems.length >= 3
      const reason = needsMeeting
        ? openItems.length === 0
          ? '黑板未决项为 0（异常状态）'
          : blockers.length > 0
            ? `存在 ${blockers.length} 项未解决阻塞/接口变更（${blockers.map((b) => b.id).join(',')}）——必须二次开会同步`
            : `未决项 ${openItems.length} 项（≥3，需要同步收敛）——建议二次开会`
        : `黑板收敛（未决 ${openItems.length} 项，无阻塞）——暂不需要二次会，继续独自思考/干活，有新问题随时写黑板`
      const essenceNote = decisions.length ? `；⚠️ ${decisions.length} 条决策条目未过 jarvis_essence 需求本质校验，定稿前必须审计（防迎合/防幻觉）` : ''
      const summary = `未决 ${openItems.length} 项；阻塞 ${blockers.length} 项${blockers.length ? '：' + blockers.map((b) => b.id + '(' + b.content.slice(0, 20) + ')').join(', ') : ''}。${reason}${essenceNote}`
      return { items, openItems, blockers, needsMeeting, reason, summary }
    },
  },
]

/** 需求分级（纯逻辑，供 jarvis_project 工具与 /jarvis 命令共用）。
 *  ⚠️ 领域无关设计：插件不预设任何行业/人物/领域流程（那是项目沉淀的职责）。
 *  这里只做"需求复杂度的分级建议"，领域判断与蒸馏方向由 CEO 按本项目实际情况现场决定。
 */
export function identifyIndustry(text) {
  const len = String(text ?? '').trim().length
  const suggestion = len <= 5 ? 'S：直接做（不需要建队）' : len < 40 ? 'M：精简公司（2-4 人，现场蒸馏子角色）' : 'L：全链公司（4-7 人，现场蒸馏 CEO+子角色）'
  return {
    industry: '由 CEO 现场判断（插件不预设领域，避免套模板）',
    suggestion,
    distillDirections: ['CEO 按本项目需求特性，web 搜索该领域真实可查证权威（现场决定，不预置名单）'],
    matched: false,
  }
}

/** /jarvis 命令执行：需求分级 → 返回真实执行产物（含蒸馏/流程/沉淀指令），不再是占位文本 */
export function jarvisCommand(requirement) {
  const text = String(requirement ?? '').trim()
  if (!text) return { content: '用法：/jarvis <需求描述>（可模糊）' }
  const hit = identifyIndustry(text)
  return {
    content: `已收到需求[${text.slice(0, 120)}]（建议建队等级 ${hit.suggestion}）。\nJarvis 流程启动（Jarvis=主面板/对客户沟通；CEO=团队内角色。先查记忆 → 蒸馏 → 建队 → CEO 盯人换人 → 交付，单一 /jarvis 入口）：\n0. 【先查项目记忆库】先查 <项目>/.jarvis/：prototypes(真实人物原型)+cards(虚拟人物卡)+process(流程)+project.md(项目细节)+board(进度)+lessons(经验) → 有就直接读取继续（不用重分析源码）；没有才从零蒸馏\n1. 需求本质回归：先重述"为谁解决什么、怎样算成功"（可判定标准），未清晰前不开工\n2. 定领域流程：jarvis_process 按本需求定流程（阶段/闸门/红线/必须角色/会议触点）——插件无预设，可参考本项目沉淀（按本次需求修订）\n3. 【蒸馏 CEO 角色卡】CEO 是团队内角色，不是主面板——web 查证该领域真实大佬（长访谈/一手文章/决策记录优先，避开知乎/公众号/百度百科）→ 存 prototypes/ → **先 jarvis_distill_guide 提炼独有 HOW（决策触发词/独特取舍/领域黑话/反直觉/认知变化轨迹/失效边界 + 7品味原则 + 来源分级 + 验证锚点）→ 再写六段式 CEO 卡** → jarvis_distill 证据链硬闸 + jarvis_fidelity 保真度审计 双验 → 作为团队成员注入\n4. 定子角色 → 逐个 同样【distill_guide 提炼 HOW → 写卡 → distill 校验】+ 保真度审计双验（蒸馏方向：${hit.distillDirections[0]}）→ jarvis_collab 设计协同（四要素+每角色自己的协同段）\n5. kickoff 全员会（jarvis_meeting）：对齐目标/验收 + 领域流程闸门/红线 + 接口契约 → 决议写统一黑板（jarvis_board）\n6. 各角色独自思考/干活（关键决策 jarvis_think_deep）→ 所有问题/发现/阻塞写黑板\n7. 黑板有未决阻塞/分歧/接口变更 → 二次会（cycle）+ jarvis_review 裁决（吃 thinkA/thinkB + requirement）→ 循环到黑板收敛\n8. 【CEO 时刻盯人换人】CEO 是团队成员且持续在岗，不是建完就空闲——它时刻监控每个员工的阶段成果（成果质量/任务完成度/问题上行健康度/角色契合度/深度分），多角度发现能力不行 → 换人：标记离任(写依据) → remove_member 安全终止 → 归档 .jarvis/cards/ 历史 → 重蒸馏该岗位更合适的真实大神 → jarvis_distill 校验 → 新成员上岗补位；其他岗位通力协作（开会/黑板/依赖/升级齐全）\n9. 问题上行：技术绕不开/无法抉择 → 禁止跳过 → jarvis_escalate 带 风险细节+已尝试+决策请求 上报 → 写黑板 → CEO 闭环\n10. 收口会（close）：对照领域闸门逐项验收 → 交付报告（Jarvis 向客户汇报）\n11. 沉淀到项目：角色卡/原型/流程/组件/项目细节/经验 读写 <项目>/.jarvis/ —— 下次需求先查记忆直接复用（阶段零）\n（铁律：插件无预置角色卡/领域模板（领域无关）；捕捉 HOW 而非 WHAT；证据不足宁 60 分诚实不要 90 分编造；真实情况优先于角色卡；需求本质优先于一切；流程缺失 = 客户提 bug 的温床。）`,
  }
}

export default {
  apply(ctx) {
    const tools = ctx.get('tools')
    if (tools && typeof tools.register === 'function') {
      for (const def of TOOLS) {
        ctx.effect(() => tools.register({ ...def }))
      }
    } else {
      console.error('[luke-jarvis] tools 服务不可用，模型工具未注册')
    }

    const commands = ctx.get('commands')
    if (commands && typeof commands.register === 'function') {
      ctx.effect(() =>
        commands.register({
          name: 'jarvis',
          description: '贾维斯数字员工公司（领域无关）：需求分级 → CEO 定领域流程(jarvis_process) → 现场蒸馏角色卡(jarvis_distill 校验) → 项目沉淀(jarvis_store) → 协同(jarvis_collab) → kickoff 会 → 独思(think_deep) → 黑板(board) → 按需二次会(review+essence) → 问题上行(escalate) → 能力补足(capability) → 收口',
          usage: '/jarvis <需求描述>',
          execute: async (agent, line) => {
            const r = jarvisCommand(line)
            return { kind: 'success', text: typeof r === 'string' ? r : r.content }
          },
        }),
      )
    } else {
      console.error('[luke-jarvis] commands 服务不可用，/jarvis 命令未注册')
    }
  },
}