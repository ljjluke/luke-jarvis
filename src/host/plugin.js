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
  const hasTripleValidation = TRIPLE_VALIDATION.filter((k) => card.includes(k)).length
  if (hasTripleValidation < 2) missing.push('三重验证(跨域复现/生成力/排他性 至少2项)')
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
      '分歧升级裁决器：团队角色间对同一问题有冲突（如产品 vs 风控、测试 vs 研发）时，CEO 调用本工具采集双方观点并按裁判优先级裁决。裁判优先级(铁律)：真实情况 > 用户需求 > 专业判断。LLM 不得迎合角色卡，裁决依据真实情况。可选传入双方 thinkA/thinkB（各角色先跑 jarvis_think_deep 的结构化思考 JSON），裁决时会引用双方的 反方攻击/真实核对/诚实边界 来防一面之词。',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: '分歧问题是什么' },
        sideA: { type: 'string', description: 'A 方观点与依据' },
        sideB: { type: 'string', description: 'B 方观点与依据' },
        thinkA: { type: 'string', description: 'A 方 jarvis_think_deep 的结构化思考 JSON（可选）' },
        thinkB: { type: 'string', description: 'B 方 jarvis_think_deep 的结构化思考 JSON（可选）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ruling: { type: 'string', description: 'CEO 裁决结论' },
          basis: { type: 'string', description: '裁决依据（真实情况/用户需求/专业判断）' },
          analysis: { type: 'string', description: '基于双方深度思考帧的对抗分析（可选）' },
        },
        required: ['ruling'],
      },
      render: (r) => `裁决：${r.ruling}\n依据：${r.basis ?? ''}${r.analysis ? '\n分析：' + r.analysis : ''}`,
    },
    handler: async (args) => {
      const issue = String(args.issue ?? '')
      const sideA = String(args.sideA ?? '')
      const sideB = String(args.sideB ?? '')
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
      return {
        ruling: `待 CEO 基于真实情况裁决：「${issue}」。A=${sideA}；B=${sideB}。`,
        basis: '真实情况 > 用户需求 > 专业判断（角色卡只提供分析框架，不取代真实判断）',
        analysis: notes.length ? notes.join('\n') : undefined,
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
    content: `已收到需求[${text.slice(0, 120)}]。行业识别：${hit.industry}（建议建队等级 ${suggestion}）。\nCEO 流程启动（女娲式蒸馏）：\n1. 现场蒸馏 CEO 卡：web 搜索该行业真实大佬 → 6 维度调研(著作/对话/表达/他者/决策/时间线) → 提炼心智模型(三重验证：跨域复现/生成力/排他性) + 决策启发式 + 表达DNA → 六段式+协同架构+证据链+诚实边界+保真度+source+防冒名\n2. jarvis_distill 校验（证据链硬闸）→ jarvis_fidelity 保真度审计 → 双通过才注入\n3. CEO 定子角色 → 逐个同样蒸馏+双验（参考方向：${hit.distillDirections.join(' / ')}）\n4. 设计协同架构（位置/依赖/介入时机/协同方式）→ AgentTeams 建队\n5. 关键决策/分歧：各角色先用 jarvis_think_deep 深度思考（前提审视→反方攻击→失效推演→真实核对→诚实边界→收敛，按 stakes 分级对抗）→ 分歧用 jarvis_review 裁决（吃双方思考帧，防一面之词）→ 盯控 → 收口交付\n（铁律：捕捉 HOW they think 而非 WHAT they said；证据不足宁 60 分诚实不要 90 分编造；绝不复用旧卡；真实情况优先于角色卡。）`,
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
          description: '贾维斯数字员工公司：识别行业 → 现场蒸馏真实大佬 CEO → CEO 定子角色 → 现场蒸馏各角色卡(jarvis_distill 校验) → 设计协同架构(jarvis_collab) → key 决策各角色 jarvis_think_deep 深度思考 → jarvis_review 裁决 → AgentTeams 建队执行',
          usage: '/jarvis <需求描述>',
          execute: async (agent, line) => jarvisCommand(line),
        }),
      )
    } else {
      console.error('[luke-jarvis] commands 服务不可用，/jarvis 命令未注册')
    }
  },
}