/** jarvis_* 工具（distill）：角色蒸馏：六段式校验、蒸馏引导、保真度、内容指纹。
 *
 *  工具定义与 handler 同文件；依赖一律从层模块 import（runtime/gates/state/pixoffice/distill/protocol），
 *  不在工具内再实现判定逻辑——闸与状态只认单一事实源。
 */
import { createRequire } from 'node:module'
import { toPixOfficeSnapshot } from '../office-bridge.js'
import { Engine, reasonText } from '../core/index.js'
import { JsonTicketRepositories } from '../adapters/json-tickets.js'
import { SECTIONS, EVIDENCE_SECTIONS, COLLAB_FOUR, checkCollabHealth, validateCardShape, assessCardDepth, distillGuide, identifyIndustry, checkContentFingerprint } from '../distill/index.js'
import { JARVIS_SYSTEM_PROTOCOL, JARVIS_CULTURE } from '../protocol/index.js'
import { COORD_TASK_RE, TERMINAL_TASK_STATUS, ACTIVE_TEAM_MARKER_TTL_MS, ACTIVE_TEAM_MAX_AGE_MS, ARCHIVED_TEAM_RE, resolveOwnedTeams, looksLikePluginRepo, stateRootConflict, writeActiveTeamMarker } from '../gates/ownership.js'
import { listNames, readTextSafe, hasTeamJson, resolveWorkspace, ponderVerifyProjectDir, getFsService, getRuntimeContext, getLatestExec, getResolvedWorkspace, markJarvisSession, isJarvisSession } from '../runtime.js'
import { MEMORY_MAX_AGE_MS, checkMemoryFresh, _readGates, _memoryState, recordGate, _flowState } from '../gates/store.js'
import { JARVIS_STAGES, STAGE_LABELS, STAGE_GATE, STAGE_DENY, PAID_WORK_TOOLS, computeStage, renderStage, jarvisStageGate, captainExecutionGuard } from '../gates/stage.js'
import { TEAM_TOOLS, jarvisFlowGuard } from '../gates/flow.js'
import { auditTeamBriefs, auditCaptainOwnedTasks, auditStaleTasks, checkTalentPreconditions, checkPonderVerify, checkCoverageGate, hasGlob, _dropMissing } from '../gates/audit.js'
import { boardFilePath, readBoardItems, writeBoardItems, nextBoardId } from '../state/board.js'
import { companyStateFile, readCompanyState, writeCompanyState, syncCompanyState } from '../state/company.js'
import { PIXOFFICE_ACTOR_IDS, PIXOFFICE_EVENT_KINDS, PIXOFFICE_COMMANDS, PIXOFFICE_LIMITS, normalizeEventKind, buildPixOfficeFrame, validatePixOfficeFrame, sseFrameString, relaySeqDecision, frameHash, validatePixOfficeCommand } from '../pixoffice/index.js'
const _require = createRequire(import.meta.url)


/** 本组工具（按原始顺序）；由 tools/index.js 汇总成 TOOLS。 */
export const DISTILL_TOOLS = [
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
    execute: async (args, exec) => {
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
      //   ⛔ 空洞段一票否决：六段中 ≥3 段内容空洞（filled<4）→ 直接打回——防"真实人名+空泛工作特点"
      //     的结构凑分卡（只有 source/证据链齐全但方法论全空话，score 可能 ≥60 但实质是空卡）。
      const depth = assessCardDepth(card, isCeo)
      const hasReservedSource = /https?:\/\/[^\s）)】]+/.test(card) && /example\.com|localhost|127\.0\.0\.1|\.test\b|your-domain/.test(card.match(/https?:\/\/[^\s）)】]+/)?.[0] || '')
      // 代表作品须含"具体成就"（成就反推工作方式的依据——泛泛"某创始人/做过项目"无法反推能力影子，等于卡没有能力来源）
      //   具体成就信号：作品/成果名 + 做了什么/规模/影响/年份（"主导某项目/创建某体系/著有某书/推动某变革"且可验证）
      const worksSection = (card.match(/代表作品[：:]\s*([^\n]+)/) || [])[1] || ''
      const VAGUE_WORKS = /某[^，。]{0,6}(创始人|公司|品牌|项目|产品)|一个项目|一些项目|某企业|做过项目/
      // 成就证据两种合法形态：①具体动作+成果（主导/创建/著有/推动...）；②"借鉴《真实作品名》"（作品名本身就是他的成就——
      //   能"借鉴 Refactoring"说明作者写了 Refactoring；但"借鉴某品牌/某公司打法"仍是泛泛，不算）
      const actionAchievement = /主导|创建|建立|推出|发明|著有|推动|实现|打造|设计|开发|发起|创办|带领|让.{0,10}(提升|降低|增长|成为)|影响|规模|用户|年份/.test(worksSection)
      const workNamed = /《[^》]{2,30}》/.test(worksSection) || /Refactoring|Continuous|Humanocracy|Rework|Remote|Steve Jobs|Continuous Discovery/.test(worksSection)
      const hasConcreteAchievement = worksSection.length >= 15 && !VAGUE_WORKS.test(worksSection) && (actionAchievement || workNamed)
      const hasFlairVeto = depth.issues.some((i) => i.includes('展示型空泛'))
      if (depth.score < 60 || depth.filled < 4 || hasReservedSource || !hasConcreteAchievement || hasFlairVeto) {
        const reasons = []
        if (depth.score < 60) reasons.push(`深度不足（${depth.score}/100）`)
        if (depth.filled < 4) reasons.push(`六段中 ${6 - depth.filled} 段内容空洞（工作特点空泛——真实人物+空泛方法论 = 不合格，须补该人物独有的 HOW/决策触发词/取舍）`)
        if (hasReservedSource) reasons.push('source 是保留/示例域（example.com 等——编造出处嫌疑，须真实可查 URL）')
        if (!hasConcreteAchievement) reasons.push(`代表作品段无"具体成就"（当前='${worksSection.slice(0, 40) || '空'}'——泛泛"某创始人/做过项目"无法反推工作方式=卡没有能力影子来源。须写具体的：做出过什么成果/规模/影响/年份，如"著有 X 书/主导 X 项目推动 X 增长/创建 X 体系"）`)
        if (hasFlairVeto) reasons.push('方法论是"展示型空泛"（评价性形容词堆砌，无"遇到X→做Y"可执行行为）——卡不贵多贵有用，删空话换具体做法')
        return { ok: false, missing: [], depthScore: depth.score, depthIssues: depth.issues, verdict: `深度硬闸打回：${reasons.join('；')}——"结构齐全内容空洞"的浅层卡不得注入。${depth.issues.slice(0, 3).join('；')}` }
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
          industry: { type: 'string', description: 'CEO 判断的领域（可选）' },
          purpose: { type: 'string' },
          tastePrinciples: { type: 'array', items: { type: 'string' } },
          sourceHierarchy: { type: 'array', items: { type: 'string' } },
          sourceBlacklist: { type: 'array', items: { type: 'string' } },
          sourceRecommended: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { type: 'string' } },
          decisionHeuristics: { type: 'string' },
          validationAnchors: { type: 'string' },
          achievementTrace: { type: 'string', description: '成就反推工作方式：列出该人物真实成就 → 反推"他怎么工作才做到的"（影子习惯来源）' },
          evidenceTrace: { type: 'string', description: '证据溯源分级：每项能力标 A原文级/B行为级/C推断级（员工只把 A/B 当真影子，C 不冒充）' },
          fingerprintTrace: { type: 'string', description: '产出指纹提炼：从真实作品/成就提炼该人物产出的可辨识特征（对照指纹能看出产出像不像他做的）' },
          workbenchTrace: { type: 'string', description: '工作台需求反馈：人物卡自己反馈这领域做这活要什么环境/工具（不许默认 Linux 万能/不许乱搞）' },
          aiDisplacementTrace: { type: 'string', description: 'AI 执行平替：人物保留判断/审美/决策，执行从人工工具平移到 AI 工具（每条工作方式标 判断/AI执行/人工）' },
          professionTrace: { type: 'string', description: '职业底线：该人物怎么保证产出真实/负责/不糊弄（真相优先/验证用户实际感受/歧义问清/判失败有证据/先查自身/区分问题类型/经验沉淀）' },
          deepAnalysisTrace: { type: 'string', description: '深度分析动作链：他做核心任务时怎么把问题彻底分析透（立基准/逐项对照找全/追问到底/分级闭环/自查透没）——防卡只有标签没有深度' },
          antiGeneric: { type: 'string' },
          personBar: { type: 'string', description: '选人闸：蒸馏前先确认该人物是该领域真正厉害的人物（可命名贡献/公认度/排他性），防止注入"真实但平庸"的人' },
          sourceCheck: { type: 'string' },
          respondAs: { type: 'string' },
        },
        required: ['purpose', 'steps', 'respondAs'],
      },
      render: (r) =>
        `【${r.role ?? '角色'} 蒸馏引导 · 捕捉独有 HOW】\n目的：${r.purpose}\n品味原则：${(r.tastePrinciples || []).map((x) => '  · ' + x).join('\n')}\n来源分级：${(r.sourceHierarchy || []).map((x) => '  · ' + x).join('\n')}\n黑名单源：${(r.sourceBlacklist || []).join('、')}\n推荐源：${(r.sourceRecommended || []).join('、')}\n步骤：${(r.steps || []).map((x) => '  ' + x).join('\n')}\n决策启发式：${r.decisionHeuristics}\n验证锚点：${r.validationAnchors}\n防通用：${r.antiGeneric}\n职业底线：${r.professionTrace}\n深度动作链：${r.deepAnalysisTrace}\n${r.sourceCheck}\n响应格式：${r.respondAs}`,
    },
    execute: async (args, exec) => {
      const role = String(args.role ?? '').trim()
      const material = String(args.material ?? '').trim()
      const industry = String(args.industry ?? '').trim()
      return distillGuide(role, material, industry)
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
    execute: async (args, exec) => {
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
    name: 'jarvis_fingerprint',
    description:
      '产物结构指纹核验（ws8634 page_truth_fingerprint 借鉴，领域无关——判断"产物是否真的变了"的算法，防"我改完了"但实际没变（lyj 教训：用户说"没变化啊"））。算产物的**结构指纹**（可辨识结构的多重集，过滤内容噪音），改前改后比对：指纹相同 = 没真改 = 打回；不同 = 真变了。领域无关：软件代码=函数/类/字段/路由结构；制造=工序/参数/质检点；文书=章节/条款/字段名；界面=控件/路由——具体取什么由 kind 或内容定，算法通用（多重集哈希+结构行提取）。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'compute=算结构指纹（输入 content）/ compare=比对改前改后（输入 before/after，判"真变了没"）' },
        content: { type: 'string', description: 'compute 用：产物内容（文档/代码/文本）' },
        before: { type: 'string', description: 'compare 用：修改前的内容' },
        after: { type: 'string', description: 'compare 用：修改后的内容' },
        kind: { type: 'string', description: '结构提取方式（可选）：code=提取函数/类/字段定义；doc=提取章节/条款标题；text=按行结构；默认自动（有函数/类/def 特征→code，有#/##/章节/条款→doc，否则 text）' },
        detail: { type: 'boolean', description: 'true=输出指纹明细（提取了哪些结构项）' },
      },
      required: ['mode'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          verdict: { type: 'string' },
          ok: { type: 'boolean' },
          fingerprint: { type: 'string', description: '结构指纹（稳定哈希）' },
          changed: { type: 'boolean', description: 'compare 用：是否真变了' },
          structuralItems: { type: 'array', items: { type: 'string' }, description: '提取的结构项（detail=true 时）' },
          detail: { type: 'string' },
        },
        required: ['verdict', 'ok'],
      },
      render: (r) => `【产物结构指纹】${r.verdict}`,
    },
    execute: async (args, exec) => {
      const crypto = _require('node:crypto')
      const mode = String(args.mode ?? 'compute').trim()
      // 结构提取：按 kind 或内容特征取"可辨识结构"（多重集），过滤内容噪音（值/文案/空白）
      const extractStructural = (text, kind) => {
        const t = String(text ?? '')
        const lines = t.split(/\r?\n/)
        const items = []
        let k = kind || 'auto'
        if (k === 'auto') {
          if (/(^|\n)\s*(function|def|class|const\s+\w+\s*=\s*(async\s*)?\(|interface|struct|func\s)/.test(t)) k = 'code'
          else if (/(^|\n)\s*(#|##|###|第[一二三四五六七八九十]+[章节条]|\d+\.\d*\s+[\u4e00-\u9fa5])/.test(t)) k = 'doc'
          else k = 'text'
        }
        if (k === 'code') {
          // 提取函数/类/字段定义行（结构，不含实现体）
          for (const ln of lines) {
            const m = ln.match(/^\s*(export\s+)?(async\s+)?(function|def|class|interface|struct|type|const|let|var|func)\s+([\w$]+)/)
            if (m) items.push('DEF:' + m[4])
            const f = ln.match(/^\s*([\u4e00-\u9fa5\w]+)\s*[:：]\s*(.+)$/)
            if (f && !/^\s*[#\/\/]/.test(ln)) items.push('FIELD:' + f[1].trim())
          }
        } else if (k === 'doc') {
          // 提取章节/条款标题（结构）
          for (const ln of lines) {
            const m = ln.match(/^\s*(#{1,6}\s+|第[一二三四五六七八九十]+[章节条]\s+|\d+\.\d*\s+)([\u4e00-\u9fa5\w]+)/)
            if (m) items.push('SEC:' + m[2].slice(0, 30))
          }
        } else {
          // text：提取"结构键"（行首的键名/标题，不含值）——防"只改内容没改结构"误判真变
          for (const ln of lines) {
            const s = ln.trim()
            if (!s || s.length <= 1 || /^[\s\-—=*#]+$/.test(s)) continue
            // 键：冒号/等号/括号前的部分（功能A：xxx → 功能A）；无分隔符则取行首 12 字符
            const keyM = s.match(/^([\u4e00-\u9fa5A-Za-z0-9_\-]+)\s*[:：=]\s*/)
            const key = keyM ? keyM[1] : s.slice(0, 12)
            items.push('KEY:' + key)
          }
        }
        return items
      }
      const computeFp = (text, kind) => {
        const items = extractStructural(text, kind)
        // 多重集指纹：排序后哈希（结构相同顺序不同也算同）
        const sorted = [...items].sort()
        const h = crypto.createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 16)
        return { fp: h, items }
      }
      if (mode === 'compute') {
        const { fp, items } = computeFp(String(args.content ?? ''), String(args.kind ?? '').trim())
        return {
          verdict: `结构指纹已计算（${items.length} 个结构项）：${fp}`,
          ok: true,
          fingerprint: fp,
          ...(args.detail ? { structuralItems: items.slice(0, 60), detail: `共 ${items.length} 项结构` } : {}),
        }
      }
      if (mode === 'compare') {
        const before = String(args.before ?? '')
        const after = String(args.after ?? '')
        if (!before && !after) return { verdict: '⛔ compare 需要 before（改前）和 after（改后）', ok: false, changed: false }
        const { fp: fpB, items: itemsB } = computeFp(before, String(args.kind ?? '').trim())
        const { fp: fpA, items: itemsA } = computeFp(after, String(args.kind ?? '').trim())
        const changed = fpB !== fpA
        return {
          verdict: changed
            ? `✅ 产物结构真变了（指纹 ${fpB} → ${fpA}，${itemsB.length}→${itemsA.length} 项结构）——改动生效`
            : `⛔ 产物结构未变（指纹 ${fpB} 相同）——"改完了"但结构没变 = 没真改/改错地方 = 打回（核对是否改错文件/改在副本/只改内容没改结构）`,
          ok: changed,
          changed,
          fingerprint: fpA,
          ...(args.detail ? { structuralItems: itemsA.slice(0, 60), detail: `改前 ${itemsB.length} 项 → 改后 ${itemsA.length} 项` } : {}),
        }
      }
      return { verdict: '⚠️ 未知 mode（应为 compute/compare）', ok: false }
    },
  },
]
