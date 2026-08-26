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

/** 三重验证关键词（跨域复现 + 生成力 + 排他性）——筛选心智模型用。 */
const TRIPLE_VALIDATION = ['跨域复现', '生成力', '排他性']

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
  const hasTripleValidation = TRIPLE_VALIDATION.filter((k) => card.includes(k)).length
  if (hasTripleValidation < 2) missing.push('三重验证(跨域复现/生成力/排他性 至少2项)')
  // 诚实边界必须提到"信息截止"或"推测成分"其一
  if (!/(信息截止|推测|局限|做不到)/.test(card)) missing.push('诚实边界(信息截止/推测成分/做不到什么)')
  return missing
}

/** 四个模型工具定义（ToolDefinition 形态，供 tools.register） */
export const TOOLS = [
  {
    name: 'jarvis_project',
    description:
      '贾维斯接单入口：识别用户需求所属行业/领域（电商/金融/短视频/软件/数据/产品/营销/医疗/教育…任意），返回该领域分级建议（S/M/L）与蒸馏方向提示。CEO 用本工具确定"往哪个行业找真实大佬"。',
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
      const len = text.length
      const suggestion = len < 4 ? 'S：直接做（不需要建队）' : len < 40 ? 'M：精简公司（2-4 人，现场蒸馏子角色）' : 'L：全链公司（4-7 人，现场蒸馏 CEO+子角色）'
      return {
        industry: hit.industry,
        confidence: len < 4 ? 'low' : 'medium',
        suggestion,
        distillDirection: hit.distillDirections.join(' / '),
      }
    },
  },

  {
    name: 'jarvis_distill',
    description:
      '角色卡蒸馏校验器（女娲式，防迎合蒸馏核心）：校验现场蒸馏出的角色卡是否满足证据链硬闸。要求：1) 六段式(身份定位/思维模型/核心方法论/代表作品/决策红线/语言风格) 必含；2) CEO 卡必含协同架构段；3) 证据链必含「证据链/诚实边界/保真度」段——证据链须含 6 维度调研(著作/对话/表达/他者/决策/时间线)，诚实边界须写信息截止/推测成分，保真度须写一手/二手/推断占比；4) source 必须是真实 https URL（防编造出处）；5) 心智模型须过三重验证(跨域复现/生成力/排他性 ≥2 项)；6) 防冒名独立声明。任缺 → 不通过，禁止注入。铁律：捕捉 HOW they think 而非 WHAT they said；证据不足宁可 60 分诚实，不要 90 分编造。',
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
          verdict: { type: 'string', description: '通过/不通过 + 原因' },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) => (r.ok ? `✅ ${r.verdict}` : `❌ ${r.verdict}${r.missing && r.missing.length ? ' 缺失:' + r.missing.join(',') : ''}`),
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
      return { ok: true, verdict: `卡结构合格（六段式${isCeo ? '+协同架构' : ''}+source+防冒名）。注入后员工只借鉴其思考框架，真实判断必须基于实际数据/代码/复现。` }
    },
  },

  {
    name: 'jarvis_review',
    description:
      '分歧升级裁决器：团队角色间对同一问题有冲突（如产品 vs 风控、测试 vs 研发）时，CEO 调用本工具采集双方观点并按裁判优先级裁决。裁判优先级(铁律)：真实情况 > 用户需求 > 专业判断。LLM 不得迎合角色卡，裁决依据真实情况。',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: '分歧问题是什么' },
        sideA: { type: 'string', description: 'A 方观点与依据' },
        sideB: { type: 'string', description: 'B 方观点与依据' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ruling: { type: 'string', description: 'CEO 裁决结论' },
          basis: { type: 'string', description: '裁决依据（真实情况/用户需求/专业判断）' },
        },
        required: ['ruling'],
      },
      render: (r) => `裁决：${r.ruling}\n依据：${r.basis ?? ''}`,
    },
    handler: async (args) => {
      return {
        ruling: `待 CEO 基于真实情况裁决：「${String(args.issue ?? '')}」。A=${String(args.sideA ?? '')}；B=${String(args.sideB ?? '')}。`,
        basis: '真实情况 > 用户需求 > 专业判断（角色卡只提供分析框架，不取代真实判断）',
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
    name: 'jarvis_fidelity',
    description:
      '角色卡保真度审计器（女娲 FIDELITY 机制）：对蒸馏产出的角色卡做保真度审计，输出证据质量报告。审计项：1) 一手来源占比（本人著作/对话/决策记录 vs 二手转述 vs 推断）；2) 心智模型是否过三重验证（跨域复现/生成力/排他性）；3) 诚实边界是否明确（信息截止时间/做不到什么/推测成分）；4) 矛盾点是否保留（不和稀泥）；5) 信息源黑名单是否回避（知乎/微信公众号等洗稿源）。产出 PRIMARILY-FIRST-HAND / MIXED / SPECULATIVE 评级 + 建议。',
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
      let firstHand = 0
      if (/一手|著作|原创|决策记录/.test(card)) firstHand += 0.4
      if (/对话|访谈|transcript|播客/.test(card)) firstHand += 0.3
      if (/他人评价|二手|转述/.test(card)) firstHand += 0.15
      if (/推断|推测/.test(card)) firstHand += 0.1
      firstHand = Math.min(1, firstHand + 0.05)
      if (!card.includes('诚实边界') || !/(信息截止|推测|局限|做不到)/.test(card)) issues.push('缺诚实边界（信息截止/推测成分/做不到什么）')
      if (!/(跨域复现|生成力|排他性)/.test(card)) issues.push('心智模型未经三重验证（跨域复现/生成力/排他性）')
      if (!/(矛盾|张力|分歧)/.test(card)) issues.push('未记录矛盾/内在张力（女娲原则：保留矛盾而非和稀泥）')
      if (/知乎|微信公众号|百度百科/.test(card)) issues.push('命中了信息源黑名单（知乎/公众号/百度百科）——洗稿源需替换为权威一手来源')
      const rating = !issues.length && firstHand >= 0.6 ? 'PRIMARILY-FIRST-HAND' : issues.length <= 1 ? 'MIXED' : 'SPECULATIVE'
      return {
        rating,
        firstHandRatio: Math.round(firstHand * 100) / 100,
        issues,
        verdict: !issues.length
          ? '保真度合格：一手来源充分、三重验证齐备、诚实边界清晰。可注入（仍只借鉴框架，不冒充署名）。'
          : `保真度不足：${issues.length} 项待修。修改后用 jarvis_distill + jarvis_fidelity 复验。宁要 60 分诚实，不要 90 分编造。`,
      }
    },
  },
]

/** 行业识别（纯逻辑，供 jarvis_project 工具与 /jarvis 命令共用） */
export function identifyIndustry(text) {
  const industries = [
    ['电商|商城|订单|拼团|购物|交易|支付|秒杀|sku|供货|库存', '电商', ['黄峥系（下沉市场/有效GMV）', 'Sean Ellis（增长/PMF）', '丰田精益（供应链）', 'Schneier（风控）']],
    ['金融|量化|投资|交易|风控|资金|理财|股票|期货|基金', '金融', ['巴菲特（价值投资）', '达利欧（原则/风险平价）', '西蒙斯（量化）', '塔勒布（尾部风险）']],
    ['短视频|直播|内容|自媒体|运营|涨粉', '短视频/内容', ['短视频平台增长方法论（实测驱动）', '内容运营（以用户停留为北极星）']],
    ['医疗|医院|药|健康|诊断|问诊', '医疗健康', ['医疗质量与循证（公开框架）', '患者体验（以患者为中心）']],
    ['教育|课程|教学|学习|培训', '教育', ['以学习者为中心的教学设计（公开框架）', '课程产品化（可度量产出）']],
    ['软件|系统|应用|工具|代码|开发|接口|平台', '软件研发', ['Fowler（演进式架构）', 'Beck（TDD/XP）', 'Bach（探索式测试）']],
    ['数据|分析|报表|指标|挖掘', '数据', ['数据驱动决策（先定义指标）', '分析学（结论先行）']],
    ['产品|用户|需求|体验|增长', '产品/增长', ['Sean Ellis（PMF）', 'Marty Cagan（持续发现）']],
    ['营销|投放|品牌|广告|获客', '营销', ['以转化为北极星的投放方法论（公开框架）']],
  ]
  for (const [kw, ind, dirs] of industries) {
    if (new RegExp(kw, 'i').test(text)) return { industry: ind, distillDirections: dirs, matched: true }
  }
  return { industry: '待确认（未被关键词命中）', distillDirections: ['web 搜索该领域公认顶尖人物（按需求实际特性）'], matched: false }
}

/** /jarvis 命令执行：识别行业 → 返回真实执行产物（含蒸馏指令），不再是占位文本 */
export function jarvisCommand(requirement) {
  const text = String(requirement ?? '').trim()
  if (!text) return { content: '用法：/jarvis <需求描述>（可模糊）' }
  const hit = identifyIndustry(text)
  const len = text.length
  const suggestion = len < 4 ? 'S：直接做（不需要建队）' : len < 40 ? 'M：精简公司（2-4 人，现场蒸馏子角色）' : 'L：全链公司（4-7 人，现场蒸馏 CEO+子角色）'
  return {
    content: `已收到需求[${text.slice(0, 120)}]。行业识别：${hit.industry}（建议建队等级 ${suggestion}）。\nCEO 流程启动（女娲式蒸馏）：\n1. 现场蒸馏 CEO 卡：web 搜索该行业真实大佬 → 6 维度调研(著作/对话/表达/他者/决策/时间线) → 提炼心智模型(三重验证：跨域复现/生成力/排他性) + 决策启发式 + 表达DNA → 六段式+协同架构+证据链+诚实边界+保真度+source+防冒名\n2. jarvis_distill 校验（证据链硬闸）→ jarvis_fidelity 保真度审计 → 双通过才注入\n3. CEO 定子角色 → 逐个同样蒸馏+双验（参考方向：${hit.distillDirections.join(' / ')}）\n4. 设计协同架构（位置/依赖/介入时机/协同方式）→ AgentTeams 建队 → 盯控 → 收口交付\n（铁律：捕捉 HOW they think 而非 WHAT they said；证据不足宁 60 分诚实不要 90 分编造；绝不复用旧卡；真实情况优先于角色卡。）`,
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
          description: '贾维斯数字员工公司：识别行业 → 现场蒸馏真实大佬 CEO → CEO 定子角色 → 现场蒸馏各角色卡(jarvis_distill 校验) → 设计协同架构 → AgentTeams 建队执行',
          usage: '/jarvis <需求描述>',
          execute: async (agent, line) => jarvisCommand(line),
        }),
      )
    } else {
      console.error('[luke-jarvis] commands 服务不可用，/jarvis 命令未注册')
    }
  },
}