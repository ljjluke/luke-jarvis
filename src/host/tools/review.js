/** jarvis_* 工具（review）：思考与验收：审查裁决、深度思考、ponder 核验、成员开工须知。
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
import { findRoleCard, cardStructureOk, CARD_SECTION_MARK } from '../state/cards.js'
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
export const REVIEW_TOOLS = [
  {
    name: 'jarvis_review',
    description:
      '分歧升级裁决器：团队角色间对同一问题有冲突（如产品 vs 风控、测试 vs 研发）时，CEO 调用本工具采集双方观点并按裁判优先级裁决。裁判优先级(铁律)：需求本质 > 真实情况 > 用户需求 > 专业判断——LLM 不得迎合角色卡/主流方案/会议多数，裁决必须回归原始需求本质（为谁解决什么、怎样算成功）。可选传入双方 thinkA/thinkB（各角色先跑 jarvis_think_deep 的结构化思考 JSON），裁决时会引用双方的 反方攻击/真实核对/诚实边界 来防一面之词；必填 requirement（原始需求），输出 essenceCheck 强制核对裁决是否偏离需求本质。**可证伪预期门禁（ws8634 Evolution adopt 借鉴）**：本裁决若构成"采纳方案/对外承诺/宣称改进"，必须带 expected_effect——写明"如果有效，应观察到什么（指标/场景 + 阈值 + 时限）"；没有可证伪预期 = 事后无法验证 = 打回补预期（防"采纳了但没用/宣称改进实则没变"）。',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: '分歧问题是什么' },
        sideA: { type: 'string', description: 'A 方观点与依据' },
        sideB: { type: 'string', description: 'B 方观点与依据' },
        requirement: { type: 'string', description: '原始需求（必填：裁决必须回归需求本质，不许脱离需求空谈）' },
        thinkA: { type: 'string', description: 'A 方 jarvis_think_deep 的结构化思考 JSON（可选）' },
        thinkB: { type: 'string', description: 'B 方 jarvis_think_deep 的结构化思考 JSON（可选）' },
        expected_effect: { type: 'string', description: '可证伪预期（ws8634 借鉴）：如果采纳本裁决/采纳某方案/对外承诺，应观察到什么可验证结果？格式：指标/场景 + 阈值 + 时限，如"接入后接单路由准确率 ≥90%，跑 100 条历史单回放验证"。没有可证伪预期的采纳 = 事后无法验证 = 打回补预期。' },
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
          expectedEffect: { type: 'string', description: '可证伪预期（用户传入 expected_effect 的回显）' },
          falsifiableGate: { type: 'boolean', description: '可证伪预期门禁是否通过（false=该裁决尚不可事后验证，须补预期才算定案）' },
          falsifiableGateNote: { type: 'string', description: '门禁判定说明（缺失/不达标/通过）' },
        },
        required: ['ruling'],
      },
      render: (r) =>
        `裁决：${r.ruling}\n依据：${r.basis ?? ''}${r.analysis ? '\n分析：' + r.analysis : ''}${r.essenceCheck ? '\n需求本质核对：' + r.essenceCheck : ''}${r.falsifiableGateNote ? '\n可证伪预期门禁：' + r.falsifiableGateNote : ''}`,
    },
    execute: async (args, exec) => {
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
          const runId = t.runId || t.run_id ? `（ponder run_id=${t.runId || t.run_id}，可溯源）` : '（⚠️ 无 run_id——高赌注思考未声明 ponder 溯源，若 stake=high 视为"未做深度对抗/贴标签"风险，须向该角色核验 step-guard 记录）'
          notes.push(`${label} 方深度思考${conf}${runId}：反方=${counter || '无'}；真实核对=${check || '无'}`)
        } catch {
          notes.push(`${label} 方 think 不是合法 JSON——请用 jarvis_think_deep 按要求格式输出后重传`)
        }
      }
      const essenceCheck = requirement
        ? `先重述需求本质：「${requirement.slice(0, 120)}」——为谁解决什么、怎样算成功。然后逐条核对裁决：① 偏离需求本质了吗（把用户要X做成了你想要的Y）？② 在迎合谁（用户原话/角色卡/主流方案/会议多数）？③ 有没有无依据断言（编造 source/数据/案例）？只要有一项打问号，裁决必须打回重做——回归需求本质优先于一切。必要时用 jarvis_essence 完成审计。`
        : '⚠️ 未提供原始需求（requirement）——裁决必须拿到需求本质才能定案：先补需求再裁决，禁止脱离需求空谈。'
      // 防一面之词硬标注：一方未提供深度思考帧 → 裁决置信降级（提示强度升级：不是"建议"，是"该裁决信息不全"）
      const missingSide = []
      if (!String(args.thinkA ?? '').trim()) missingSide.push('A方')
      if (!String(args.thinkB ?? '').trim()) missingSide.push('B方')
      const oneSided = missingSide.length > 0
      const reviewOut = {
        ruling: `待 CEO 基于需求本质与真实情况裁决：「${issue}」。A=${sideA}；B=${sideB}。`,
        basis: '需求本质 > 真实情况 > 用户需求 > 专业判断（不迎合角色卡/主流方案/会议多数，回归原始需求定案）',
        essenceCheck,
      }
      if (oneSided) {
        reviewOut.oneSided = true
        reviewOut.oneSidedNote = '⛔ 防一面之词未满足：' + missingSide.join('、') + ' 未提供深度思考帧（jarvis_think_deep/ponder）——**该裁决建立在信息不全上，置信度降级**；除非该分歧低赌注/单方可确认，否则应先补另一方深度思考再裁决（否则=迎合一面之词风险）'
      }
      if (notes.length) reviewOut.analysis = notes.join('\n')
      // ws8634 借鉴 P1：可证伪预期门禁——采纳方案/承诺/宣称改进必须带"如果有效会观察到什么"（无预测不采纳）
      const expectedEffect = String(args.expected_effect ?? '').trim()
      reviewOut.expectedEffect = expectedEffect
      const FALSIFIABLE_RE = /观察|回放|复现|验证|指标|阈值|达到|达标|≥|>|=\s*[0-9]|率|条|天|周|月|上线|接入|跑\s*[0-9]/
      if (!expectedEffect) {
        reviewOut.falsifiableGate = false
        reviewOut.falsifiableGateNote =
          '⛔ 可证伪预期缺失（ws8634 Evolution adopt 门禁借鉴）：本裁决若构成"采纳方案/对外承诺/宣称改进"，必须补 expected_effect——写明"如果有效，应观察到什么（指标/场景 + 阈值 + 时限）"，例如"接入后接单路由准确率 ≥90%，跑 100 条历史单回放验证"。没有可证伪预期 = 事后无法验证 = 防"采纳了但没用/宣称改进实则没变"。'
      } else if (!FALSIFIABLE_RE.test(expectedEffect) || expectedEffect.length < 8) {
        reviewOut.falsifiableGate = false
        reviewOut.falsifiableGateNote =
          `⚠️ 可证伪预期不达标：当前预期='${expectedEffect.slice(0, 80)}'——缺少可观察信号（指标/阈值/回放/复现/时限等）。请改成"如果 X 有效，应观察到 Y（阈值/时限/回放场景）"，否则视为无法验证。`
      } else {
        reviewOut.falsifiableGate = true
        reviewOut.falsifiableGateNote =
          `✅ 可证伪预期已具备：${expectedEffect}——事后可按此核验裁决/承诺是否兑现。`
      }
      return reviewOut
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
    execute: async (args, exec) => {
      return {
        note: `问题「${String(args.question ?? '')}」：先用该角色卡的框架如何分析（引用卡中思维模型），但结论必须回到真实情况——检查真实数据/代码/复现后再下判断，禁止为迎合角色卡而扭曲事实。`,
      }
    },
  },

  {
    name: 'jarvis_member_brief',
    description:
      '成员开工须知生成器（**派活必带**——lyj 教训：jarvis 协议只在 captain 会话里、成员会话看不到协议全文，结果整个项目 35 个会话里只有 CEO 一个真跑了 ponder，猎头/各专家 0 次；CEO 那 30 个子 agent 是"他一个人的思考过程"，不等于"各角色独立视角"）——**captain/CEO 每次派活（create_task 描述 或 send_message）必须把本工具生成的须知原文附上**，成员才知道：开工前先按自己的角色卡跑 ponder 满血十阶段（而不是等着被指挥）、怎么在**没有 skill 工具**的成员环境里照样跑（直接用 bash 调 step-guard + 读 stages/*.json）、产出要回传 run_id/dataDir/evidenceDir 供核验、以及黑板/问题上行三件套/资源上报/回报格式等协议要点。不附须知 = 成员退回"执行手"模式（只照消息干活、不做独立判断）= 全公司只有 CEO 一个有脑子的缺陷。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'generate=生成须知（默认）/ audit=审计团队任务是否每个都附了开工须知（含ponder）/ broadcast=生成协议刷新消息（升级新jarvis后推送给已有成员——老成员spawn时persona冻结不自动带新协议，需广播刷新）' },
        teamDir: { type: 'string', description: 'audit 用：团队目录（如 <项目>/.agent-teams/<team>，自动读 team.json 扫描任务）' },
        tasksJson: { type: 'string', description: 'audit 用：直接传任务清单 JSON（[{id,assignee,description,subject}]），不传 teamDir 时用' },
        roleName: { type: 'string', description: '成员在团队里的职位名（如 猎头/合规与信创涉密专家/开发-前端A）' },
        task: { type: 'string', description: '本次派给他的任务（写清交付物与验收）——须知会带上"你的本次任务"一节' },
        stakes: { type: 'string', description: '本次任务赌注 high/medium/low（默认 medium）——决定 ponder 深度说明' },
        projectDir: { type: 'string', description: '项目目录（默认当前工作目录）——用于给出黑板/产出/ponder 数据目录路径' },
        ponderDir: { type: 'string', description: 'ponder 技能目录（默认 ~/.dsh/skills/ponder）——成员无 skill 工具时按此路径用 bash 直接跑' },
      },
      required: ['roleName'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          brief: { type: 'string', description: '可直接粘贴进任务描述/消息的完整成员开工须知' },
          mustRunPonder: { type: 'boolean', description: '是否强制跑 ponder——恒为 false：插件不校验步骤，只要求交付物体现思考（反方攻击/失效边界/置信度）' },
          cardPath: { type: 'string', description: '已注入的角色卡文件（.jarvis/cards/ 下）；空=没找到卡' },
          cardMissing: { type: 'boolean', description: 'true=该角色还没有卡 → 须先蒸馏再派活（否则成员会用通用思路干）' },
          sendsBack: { type: 'array', items: { type: 'string' }, description: '成员回报必须带的字段' },
          verdict: { type: 'string' },
        },
        required: ['brief', 'verdict'],
      },
      render: (r) => `【成员开工须知（派活必带）】\n${r.brief}`,
    },
    execute: async (args, exec) => {
      const os = _require('node:os')
      const path = _require('node:path')
      const mode = String(args.mode ?? 'generate').trim()
      // 🔄 broadcast 模式：生成"协议刷新消息"（升级新 jarvis 后推送给已有成员——老成员 spawn 时 persona 冻结不自动带新协议，需广播刷新让成员下回合读到并遵守）
      if (mode === 'broadcast') {
        const protocolRefresh = [
          '【协议刷新 · 贾维斯】你所在工作区已升级到新版 jarvis——以下是升级后的成员协议（与你的角色卡不冲突，是新增的团队级约束），请立即纳入你的工作方式：',
          '① **深度思考（ponder 十阶段，可用资源不是闸）**：要做判断时（分析需求/方案决策/难点定位/返工根因/分歧/变更影响/收口判定/回应质疑）值得用它跑一轮（interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis）；执行已定方案/汇报/查资料不必跑。插件不校验、不记录——交付里体现得出思考（反方攻击/失效边界/置信度）就行。',
          '② ponder 执行：export PONDER_DATA_DIR=<项目>/.jarvis/ponder-runs/<run_id>/ → node <ponder技能>/scripts/step-guard.cjs init "<问题>" → 逐阶段 before/after → verify 自检 → 回报 run_id+dataDir+evidenceDir（派活方用 jarvis_ponder_check 核验：顺序/完整性/子agent数/产出文件）。',
          '③ 黑板即真相：问题/发现/决策/风险/阻塞/接口变更/资源需求 → jarvis_board 写公屏；资源需求（尤其只有客户能给的）必须上公屏闭环。',
          '④ 问题上行三件套：绕不开/无法抉择 → jarvis_escalate（问题+已尝试+风险细节+需决策什么），缺项打回。',
          '⑤ 卡住限时上报：同一问题约20-30分钟无进展必须上报；生产操作卡住立即上报。',
          '⑥ 上下文准入：先读 .jarvis/（project.md 续接五件套+需求规格+方案+黑板决策），复述理解给CEO确认后再接任务。',
          '⑦ 真实优先：不迎合不编造；查不到如实标注，绝不脑补补齐。',
          '请确认收到（回一句即可），并从此遵守上述协议。',
        ].join('\n')
        const teamDir = String(args.teamDir ?? '').trim()
        const members = String(args.members ?? '').trim()
        const target = members ? members.split(',').map((x) => x.trim()).filter(Boolean) : []
        return {
          verdict: `协议刷新消息已生成（${target.length ? '成员：' + target.join('、') : '发给所有成员'}）——用 agent_teams_send_message 逐个发给每个已有成员（落 mailbox，成员下回合读到并遵守）；升级后不刷新 = 老成员继续用旧 persona = 约束不生效`,
          protocolRefresh,
          members: target,
          broadcast: `【协议刷新 · 贾维斯】${protocolRefresh}`,
          hint: teamDir ? `发送：对 ${teamDir} 团队每个成员 agent_teams_send_message(to=<成员>, content=本消息)` : '发送：agent_teams_send_message(to=<成员>, content=本消息)',
        }
      }
      // ⚠️ audit 模式：机械校验"团队每个任务是否都附了开工须知（含 ponder 指引）"——ssa 教训：
      //   captain 只对"验证 ponder 的方法测试任务"附了须知，真实任务(实现/修复/验收)没附 → 成员没跑 ponder
      if (mode === 'audit') {
        const fsSvc = getFsService(exec)
        const projectDir = String(args.projectDir ?? '').trim() || (resolveWorkspace(getRuntimeContext()) || '.')
        const teamDir = String(args.teamDir ?? '').trim()
        const tasksJson = String(args.tasksJson ?? '').trim()
        let tasks = []
        if (tasksJson) {
          try { tasks = JSON.parse(tasksJson) } catch { return { verdict: '⛔ tasksJson 不是合法 JSON', ok: false } }
        } else if (fsSvc && typeof fsSvc.readText === 'function' && teamDir) {
          try {
            const text = await fsSvc.readText(teamDir.replace(/\/$/, '') + '/team.json')
            if (text) { const d = JSON.parse(text); tasks = d.tasks || [] }
          } catch (e) { return { verdict: '⛔ 读团队任务失败：' + (e.message || e), ok: false } }
        } else {
          return { verdict: '⚠️ audit 需要 teamDir（团队目录，自动读 team.json）或 tasksJson', ok: false }
        }
        // 任务描述/标题里是否含 ponder 须知特征（有 = 成员会知道先跑 ponder；无 = 成员只当执行手）
        const PONDER_MARK = /ponder|开工须知|step-guard|十阶段|run_id|PONDER_DATA_DIR|先跑 ponder/
        const missing = []
        for (const t of tasks || []) {
          const id = t?.id ?? '?'
          const text = String(t?.description || '') + ' ' + String(t?.subject || '') + ' ' + String(t?.acceptance || '')
          if (!PONDER_MARK.test(text)) missing.push(`${id}[${t?.assignee || '未指派'}] ${String(t?.subject || '').slice(0, 32)}`)
        }
        const ok = missing.length === 0
        return {
          verdict: ok
            ? '✅ 团队所有任务都附了开工须知（含 ponder 指引）——成员会知道先跑 ponder 十阶段'
            : `⛔ ${missing.length} 个任务缺开工须知（成员看不到 jarvis 协议，不附 = 当执行手 = 不会跑 ponder）：${missing.join('；')}`,
          missing,
          ok,
          total: (tasks || []).length,
          hint: ok ? '' : '修复：对缺须知的 assignee 用 jarvis_member_brief 生成须知，原文附进该任务 description（或 send_message 补发），成员才知道先跑 ponder。',
        }
      }
      const role = String(args.roleName ?? '成员').trim() || '成员'
      const task = String(args.task ?? '').trim()
      const stakes = String(args.stakes ?? 'medium').trim()
      const home = os.homedir ? os.homedir() : '/root'
      const projectDir = String(args.projectDir ?? '').trim() || (resolveWorkspace(getRuntimeContext()) || '.')
      const ponderDir = String(args.ponderDir ?? '').trim() || path.join(home, '.dsh/skills/ponder')
      const dataDirHint = projectDir + '/.jarvis/ponder-runs/<你的 run_id>/'
      const sg = ponderDir + '/scripts/step-guard.cjs'

      // 🎴 角色卡真注入（用户质疑点：卡只在写侧用、读侧没人读 → 成员其实没按大佬方式工作）
      const fsSvcForCard = getFsService(exec)
      const card = await findRoleCard(fsSvcForCard, projectDir, role, path)
      const cardCheck = card ? cardStructureOk(card.text) : { ok: false, missing: [] }
      const cardBlock = card
        ? [
            '',
            `${CARD_SECTION_MARK}（按这个人的方式思考——这是你的工作方式，不是装饰）`,
            `- 卡文件：${card.relPath}${cardCheck.ok ? '' : '（⚠️ 结构不全：缺 ' + cardCheck.missing.join('/') + '，按缺的段补蒸馏后再用）'}`,
            '- 用法：把下面六段式当作「人物视角」注入 ponder 画像（思维模型/方法论/红线驱动十阶段），产出要能看出是这个人的取舍，不是通用分析师的套话。',
            '',
            card.text.trim().slice(0, 12000),
          ].join('\n')
        : [
            '',
            '## 六、⛔ 你没有角色卡（先蒸馏再干）',
            `- 本项目 .jarvis/cards/ 里找不到「${role}」的卡。**不许用通用分析师的方式硬干**——派活方必须先：jarvis_distill_guide(role="${role}", material=真实素材) → jarvis_distill(...) 过六段式校验 → jarvis_store(save, itemType=card) 落到 .jarvis/cards/，再重新生成本须知派活。`,
            '- 没有卡就派活 = 成员只能凭模型默认思路做，等于「名义蒸馏、实际没按大佬方式工作」。',
          ].join('\n')

      const brief = [
        `【${role} · 开工须知（本项目团队正式成员，不是执行手）】`,
        '',
        JARVIS_CULTURE,
        '',
        '## 一、你首先是个"有判断的人"，不是等指令的手',
        '- 你以**该领域真实专家**的身份承接这块工作：先按**你的角色卡方法论**独立判断"这活该怎么做、客户真正要什么、哪里有坑"，再动手；不许只照着派活消息机械执行。',
        '- **发现派活/方案有问题（方向错/漏项/不可行），先质疑再干**（写黑板 + 直接找派活人/CEO 沟通），不许"明知不对也照做"。',
        '',
        '## 二、深度思考（可用资源：ponder 十阶段——不是流程闸，插件不校验）',
        '- **硬要求只有一条，且是可验证的**：交付里要有 4 反方攻击 / 5 失效边界 / 6 置信度（见第四节）——用产物证明思考发生过。跑不跑某个工具，插件不查、也不记录。',
        '- **ponder 是本机现成的深度思考技能**（十阶段 interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis）：要做判断时（需求分析/方案选择/难点定位/分歧/变更影响）值得用它，尤其赌注高的；执行已定方案/汇报/查资料不需要。',
        `- 本单赌注=${stakes}：low 可精简各阶段子 agent 规模，阶段骨架照旧；想跳过某阶段请自己判断并说明理由。`,
        '- **把本角色卡六段式作为"人物视角"注入画像**（思维模型/方法论/红线），让十阶段按这个人的方法论跑，而不是通用分析师套路。',
        '- **没有 skill 工具也能跑**（成员环境常缺 skill 工具——直接用 bash，效果相同）：',
        '```bash',
        '# 1) 起一个隔离数据目录（防与其他成员互相覆盖）',
        `export PONDER_DATA_DIR="${dataDirHint}"`,
        'mkdir -p "$PONDER_DATA_DIR"',
        '# 2) 初始化本次 run（记下返回的 run_id）',
        `node ${sg} init "<本次任务/决策摘要>"`,
        '# 3) 逐阶段执行：每阶段前 before、做完 after（阶段名与顺序固定）',
        `node ${sg} before interview`,
        `#    …按 ${ponderDir}/stages/<阶段>.json 的提示跑该阶段（配合 engine/*.md 的方法）…`,
        `node ${sg} after interview 0 0.45`,
        '#    …shensi/divergence/bagua/plans/converge/score/simulate/debate/synthesis 依次同样处理',
        '#      （子 agent 下限：bagua≥8、plans≥5、score≥3、simulate≥3、debate≥3）…',
        '# 4) 提交前自检（自己核对阶段是否跑完）',
        `node ${sg} verify <run_id> --evidence "$PONDER_DATA_DIR"`,
        '```',
        `- 跑了就把 **run_id + PONDER_DATA_DIR + 产出目录** 一起带回（派活方想复核时 jarvis_ponder_check 能查顺序/完整性/子 agent 数/产出文件）；没跑就不用编 run_id。`,
        '- 低赌注任务可精简子 agent 规模；跑不了/不打算跑，说明一句理由即可（插件不拦）。',
        '',
        '## 三、协议要点（成员会话看不到 jarvis 协议全文，这里给你必备项）',
        `- **黑板即真相**：问题/发现/决策/风险/阻塞/资源需求/接口变更 → 一律用 jarvis_board 写进 ${projectDir}/.jarvis/board.json（别只在消息里说，消息会淹没）。`,
        '- **问题上行三件套**：技术绕不开/自己无法抉择 → jarvis_escalate 上报，必须带 ①问题 ②已尝试的方案 ③风险细节（后果/影响范围/时限）④需要领导决策什么——**缺项会被打回**；不许沉默、降级、假装解决。',
        '- **资源需求**：缺数据/权限/凭据/环境/工具 → 写黑板登记（要什么+用于哪步+没有会怎样），不要幻觉跳过。',
        '- **查证通道矩阵**：查资料先真调默认搜索工具（web_search），不可用自动降级——①web_fetch 抓已知 URL ②公开检索端点（平台搜索 API 等）③直接网络抓取；**查到标来源、查不到如实标注"查证受限/基于既有知识推演"，绝不脑补补齐**（编造来源=一票否决）；按你职责查你该查的方向，带事实回会议。',
        '- **需要时找专业同事直连**：跨角色的接口/口径问题直接 agent_teams_send_message 找当事人（不必事事经 captain/CEO 中转）；分歧各自跑 ponder 后交 jarvis_review 裁决。',
        '- **我的模块质量深挖（质量自循环）**：你是自己负责模块的"质量第一责任人"——按本单质量维度清单（`.jarvis/docs/质量维度-<需求>.md`）对自己负责的模块自循环深挖（深挖→修→再深挖直到无问题），**不是等质量评审角色来挑**；连续一轮清单全部维度无毛病才算达标；会议归拢时把碰撞出的新细节方向回报 CEO（回流清单）。',
        '- **不要自己发挥**：成果要对照需求/参照基准做（功能对齐、不加基准里没有的东西）；拿不准先问，不凭感觉加。',
        '- **✍️ 改文件前必须先 Read（平台强制 read-before-edit）**：任何 `edit`/`write`（尤其改代码/插件源码）之前，**必须先用 `read` 读同一文件**——不读就改会被平台直接拒绝（报 `cannot modify "…": file has not been read`），白费一轮；改完再用 `read`/跑测试确认真改到了。',
        '- **🧭 改造/替换类任务禁区（防覆盖面丢失）**：凡是"换 UI/换框架/移植/重构/替换设备或流程"这类**改造**任务，**不许只按需求文档做、不许只抽查几页就算完**——必须先 `jarvis_baseline` 建旧系统**可枚举基线**（页面/路由/菜单/接口/字段，来自真实代码或配置），逐条覆盖到新实现并留验证证据；**未覆盖项一律显式登记**（补做或写理由豁免），静默丢功能/丢页面 = 一票打回。',
        '- **⚠️ 自改风险（改的是 jarvis/luke-jarvis 自己的插件、协议、脚本时）**：这类"自改"必须 ①改前备份原文件（`cp x x.bak_<时间>`）②`node --check` 语法自检 ③跑相关单测 ④在回报里写清回滚路径；**不许不留备份直接覆盖正在运行的安装副本**（改坏=整个公司停摆）。',
        '- **⚖️ ponder 可以跑很多次**：判断类动作（发言/决策/定位/回应/影响评估）想深挖就再跑一轮，跑前先读历史 run 结论（衔接深化）；高赌注满血、低赌注精简——骨架不省，run_id 有就带、没有不编。',
        '- **🔗 上下文准入（追加/新进场成员必做——不读记忆就接手 = 名义追加、实际重建）**：进场后**必须先读项目记忆**（`.jarvis/project.md` 续接五件套[当前进度/下一步/未决项/团队清单/关键决策与依据] + 需求规格 + 方案设计 + 一阶段交付物 + lessons + 黑板决策记录），然后**向 CEO 复述"我理解项目做到哪、为什么这么做、我要接什么"**，CEO 确认理解到位 → 才 claim 任务；**没读记忆/复述不过 → 不许接任务**（先补上下文，否则会重复问已解决的/做出一阶段不一致的东西）。',
        '- **⏱ 卡住限时上报（硬时限，不许自查到地老天荒）**：同一技术问题连续排查约 20-30 分钟仍无进展 → **必须上报**（写黑板：卡在哪 + 已试什么 + 需要什么 + 是否阻塞本任务/其他任务 + 预计何时能给），不许反复自查沉默；**生产/真实操作（升级/部署/改数据）卡住更要立即上报**；同时**执行 CEO 当前最高优先级指令，不被低优先级细节带走**（CEO 说"先X、Y延后"→先做X，Y记下延后）。',
        '- **有问题早暴露**：不等到交付才说"做不了/有风险"——卡住、超期、要改范围，第一时间说，并给出新时间点。',
        '',
        '## 四、回报格式（完成或阶段成果都按此报）',
        '```',
        `【${role} · 阶段成果/完成】`,
        '1. 交付物：<路径>（写清在哪、是什么）',
        '2. 结论：<核心判断 3 条以内，先结论后依据>',
        '3. 证据：<实测数据/截图/来源 URL——不许只有"我做完了">',
        '4. 反方攻击：<最强反对理由 + 你为什么不采纳；若反对成立，写你怎么补>（没有这一段 = 没做过对抗，结论不可信）',
        '5. 失效边界：<什么条件下这个结论会不成立、必须重新决策>',
        '6. 置信度：高/中/低 + 一句理由（信息不足就写低，不许硬装高）',
        '7. 未提及细节/盲点：<你主动挖出的"需求没说但客户会在意"的点>',
        '8. 阻塞/风险：<有则写：卡在哪+已试什么+要谁给什么+预计何时给；无则写"无">',
        '（如跑过 ponder：附 run_id=<...> | dataDir=<...> | evidenceDir=<...>——可溯源，但不是必填门槛）',
        '```',
        '- **为什么是这几段**：4/5/6 就是 ponder 真正产出的东西（对抗、边界、置信度）。插件不查你跑没跑某个步骤，但**交付物里看不出这三样 = 思考没发生**——用产物证明思考，不用调用记录证明。',
        '- **声称"已完成/已改好"之前，先自己回看产物确认它真的变了且符合要求**（文件读回/看 diff；改在副本/备份上=没改）；没成功就如实说没成功。',
        '',
        cardBlock,
        '',
        task ? '## 五、你的本次任务\n' + task : '## 五、你的本次任务\n（见派活消息/任务描述）',
        '',
        '> 派活方提示：本须知由 jarvis_member_brief 生成（成员会话看不到 jarvis 协议全文，附上才不会退回执行手）。jarvis_dispatch_task 会自动拼进任务描述。',
      ].join('\n')

      // executionPrompt 版：注入 add_member 的 executionPrompt（成员系统 prompt 自带协议——根治"子代理只有角色卡不跑ponder"）
      const executionPrompt = [
        `你是「${role}」，本项目团队正式成员（不是执行手）。以下是你作为成员必须遵守的协议（写入你的系统 prompt，不是可选项）：`,
        '① **深度思考（ponder 十阶段，可用资源不是闸）**：要做判断时（分析需求/方案决策/难点定位/返工根因/分歧/变更影响/收口判定/回应质疑）值得用它跑一轮（interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis）；执行已定方案/汇报/查资料不必跑。插件不校验、不记录——交付里体现得出思考（反方攻击/失效边界/置信度）就行。',
        `② ponder 执行（无 skill 工具用 bash 等价）：export PONDER_DATA_DIR="${dataDirHint}" → node ${sg} init "<问题>" → 逐阶段 before/after → verify 自检 → 回报 run_id+dataDir+evidenceDir（派活方用 jarvis_ponder_check 核验：顺序/完整性/子agent数/产出文件）。`,
        '③ 黑板即真相：问题/发现/决策/风险/阻塞/接口变更/资源需求 → jarvis_board 写公屏；资源需求（尤其只有客户能给的）必须上公屏闭环，不许假装有。',
        '④ 问题上行三件套：绕不开/无法抉择 → jarvis_escalate（问题+已尝试+风险细节+需决策什么），缺项打回；不许沉默/假装解决。',
        '⑤ 卡住限时上报：同一问题排查约20-30分钟无进展必须上报；生产操作卡住立即上报；执行CEO当前最高优先级指令，不被低优先级细节带走。',
        '⑥ 上下文准入：进场先读 .jarvis/（project.md 续接五件套+需求规格+方案+黑板决策），复述理解给CEO确认后才接任务。',
        '⑦ 回应/质疑别人观点：会议中接话碰撞前先 ponder；回应须对前面发言给评价（同意/反驳/补充+理由），不许现编。',
        '⑧ 真实优先：不迎合不编造；编造 source/数据/成果=一票否决；查证通道矩阵：查不到如实标注，绝不脑补补齐。',
      ].join('\n')
      return {
        brief,
        executionPrompt,
        mustRunPonder: false,
        cardPath: card ? card.relPath : '',
        cardMissing: !card,
        sendsBack: ['runId', 'dataDir(PONDER_DATA_DIR)', 'evidenceDir(阶段产出目录)', '交付物路径', '阻塞/风险'],
        verdict: `已生成「${role}」成员开工须知：含 ponder 十阶段执行路径（skill-free bash 版）、协议要点、回报格式${task ? '、本次任务' : ''}——派活时原文附上（create_task 描述 或 send_message）；**executionPrompt 版同步给出（add_member 时注入成员系统 prompt，成员出生即带协议）**。`,
      }
    },
  },

  {
    name: 'jarvis_think_deep',
    description:
      '角色深度思考器（ponder 满血入口引导器，防幻觉核心）：**每个角色的独立思考必须加载 ponder 技能跑完整十阶段**（DSH 平台级：interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis，十阶段资源全部在 ponder 技能包内自包含随 luke-jarvis 自带：stages/*.json + engine/*.md + scripts/step-guard.cjs + scripts/_lib/，子 agent 具备 skill 工具），step-guard.cjs init 开始本次 run，把本角色卡六段式作为"人物视角"注入画像后十阶段全量跑完，产出按衔接契约回填（counter←divergence/bagua/debate、realityCheck←interview/无知自检、confidence←converge/certainty、conclusion←synthesis、limits←epistemic_status）。**满血不阉割**：禁止只跑 interview+converge 两段或用轻量七段替代（那达不到思考效果）；低赌注（low）可精简各阶段内 agent 规模但不得跳过阶段。产出带 run_id 溯源，可直接喂给 jarvis_review 做分歧裁决双方依据（thinkA/thinkB）。铁律：真实情况优先于角色卡；宁 60 分诚实不要 90 分编造；跳过 ponder 必须显式声明 skipReason（技能不可用/用户成本优先）并留痕，禁止静默降级；查证类阶段（bagua 引源/divergence 查资料）**优先用默认搜索工具 web_search，真失败才降级（降级须是用户知情同意的降级，标注"受限环境推演"）**。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '需要深度思考的问题' },
        roleCard: { type: 'string', description: '该员工的角色卡（六段式+协同段）' },
        stakes: { type: 'string', description: '赌注 high/medium/low（默认 medium）：high=重大决策/对外承诺，medium=常规关键决策，low=可逆小事' },
        force: { type: 'boolean', description: '强制模式（默认 false）：true=本问题为角色第一次分析需求——必须真实加载 ponder 跑完整十阶段并返回 run_id，不得跳过/贴标签；强制模式下产出必须含 runId（或显式 skipReason），否则视为未完成' },
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
          ponderGuide: { type: 'string', description: '满血 ponder 十阶段入口引导（必须先加载 ponder 技能跑完整十阶段，不得跳过）' },
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
    execute: async (args, exec) => {
      const q = String(args.question ?? '').trim()
      const card = String(args.roleCard ?? '').trim()
      const stakes = String(args.stakes ?? 'medium')
      const force = Boolean(args.force)
      // ── 强制模式：角色第一次分析需求必须真实跑 ponder，产出须含 runId 否则未完成 ──
      const forceNote = force
        ? '\n【强制 · 第一次分析需求】本问题是你（该角色）对本次需求的第一立场分析，**必须真实加载 ponder 技能跑完整十阶段**：step-guard init → 十阶段全量 → 产出带回传的 runId。**产出违反强制 = 未完成**（无 runId 且无显式 skipReason 视为贴标签，CEO 打回重跑）。'
        : ''
      const roleName = (card.match(/身份定位[:：]\s*([^，。\n]+)/) || [])[1] || '该角色'
      // ── 角色卡方法论提取（主面板修复：让卡的方法论真实进入思考产出，medium/low 同 high 生效）──
      const extractHow = (label) => {
        const m = card.match(new RegExp(label + '[:：]\\s*([^\\n]+)'))
        return m ? m[1].trim().slice(0, 120) : ''
      }
      const cardModel = extractHow('思维模型')
      const cardMethod = extractHow('核心方法论')
      const cardRedline = extractHow('决策红线')
      const howBits = [cardModel, cardMethod, cardRedline].filter(Boolean)
      const howText = howBits.length ? howBits.join('；').slice(0, 200) : '（角色卡未提供方法论，按通用分析）'
      // ── 满血 ponder 入口引导（B13 · 满血版：所有 stakes 都加载 ponder 十阶段，不阉割）──
      // high=完整十阶段含可谬自评；medium/low=同十阶段框架、精简各阶段 agent 规模（控成本但不得跳过阶段/不得用轻量七段替代）
      const depthNote = stakes === 'high'
        ? '本问题赌注为 high（重大决策/对外承诺）：必须加载 ponder 完整十阶段 + synthesis 含可谬自评（这份结论最可能因为什么错？如果错改走什么方向——基于立场 A 最可能因 X 错+备选）。'
        : `本问题赌注为 ${stakes}：仍须加载 ponder 十阶段框架（满血不阉割），可精简各阶段内 agent 规模（如 bagua 8 维抽 4 维、debate 立论 3 个减为 2 个）控成本，但【不得跳过任何阶段、不得用轻量七段替代】——跳阶段=没达到思考效果。`
      return {
        role: roleName,
        stakes,
        ponderGuide: `【${roleName} · ${stakes} 赌注深度思考 · 必须加载 ponder 技能（满血版）】\n${depthNote}${forceNote}\n1. 用 skill 工具加载 ponder 技能（DSH 平台级十阶段管线，工具已注册）——step-guard.cjs init 开始本次 run；\n1a. per-run 隔离（防多成员并发互相覆盖 step-guard.json——runtime-paths.cjs 原生支持 PONDER_DATA_DIR env 覆盖 dataRoot）：本次 run 用独立数据目录 PONDER_DATA_DIR=<项目>/.jarvis/ponder-runs/<run_id>/ 或按 run_id 隔离的临时目录，跑完把 run_id 与阶段产出写回项目；禁止多成员共用同一全局 step-guard.json；\n2. 把本角色卡六段式全文（roleCard）作为 ponder 画像的"人物视角"注入（先于/并入 interview 五诊：思维模型=该人物怎么看问题、核心方法论=该人物的 HOW、决策红线=该人物不做什么）【本卡方法论=${howText}】，确保十阶段（shensi 前提审视/bagua 8 维盲点/plans 方案/synthesis 结论）全程以该人物方法论驱动，而不是通用分析师思考；\n3. 跑完整十阶段：interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis（**严格按此固定顺序，不得乱序、不得合并评分与推演、一个阶段都不能少**；子 agent 必须全部返回才进下一步；每步 step-guard before/after 记录）——${stakes !== 'high' ? '各阶段 agent 规模按低赌注精简（如 bagua 4 维/辩论 2 立论）但阶段一个不少' : '阶段与 agent 规模全量' }；\n3a. **提交前自检（必做，防"声称跑完实际乱序/缺阶段"）**：跑 step-guard.cjs verify <run_id> --evidence <本次数据目录>——只有 verdict=PASS（十阶段按序完整、子 agent 数达标、阶段产出落盘）才允许上报"ponder 已完成"；FAIL 先补齐再交。**step-guard 的 completed 是集合、看不出顺序，所以"全部 RECORDED"这句话本身证明不了按序跑全。**\n4. 产出按衔接契约回填：counter←divergence+bagua+debate 汇总去重、realityCheck←interview+无知自检、confidence←converge/certainty（0-1 映射 low/medium/high）、conclusion←synthesis、limits←各阶段 epistemic_status；${stakes === 'high' ? 'high 须含可谬自评（见上）。' : ''}\n5. 把 run_id、**本次 PONDER_DATA_DIR（数据目录路径）**与阶段产出目录一并写入输出——CEO/贾维斯会用 jarvis_ponder_check 工具拿这三样核验（run_id 只证明"跑过一次"，不证明"按序跑全十阶段"）；\n6. 若 ponder 技能不可用（无 skill 工具/运行时缺失）或用户明示成本优先 → 允许降级，但必须显式声明 skipReason 并上报留痕（评审按"未做深度对抗"降级标注置信度），禁止静默降级；查证类阶段（bagua 引源/divergence 查资料）**优先用默认搜索工具 web_search（先真调一次再判断，不许凭转述预设不可用）**，web_search 真报错 → 按资源/问题上行上报（充值/换 key/修配置），用户知情同意后才降级并标注"受限环境推演"。\n最终按衔接契约输出 JSON：{"premises":[…],"perspective":"以角色卡方法论的第一判断","counter":[…],"failure":"失败路径","realityCheck":[…],"limits":"诚实边界","conclusion":"保留结论","confidence":"low|medium|high","runId":"ponder run_id","ponderDataDir":"本次数据目录路径","evidenceDir":"阶段产出目录路径","skipReason":"降级原因或空"}。`,
        premises: `（已转 ponder 十阶段，本字段不适用——见 ponderGuide）`,
        perspective: `（已转 ponder 十阶段——以「${roleName}」角色卡方法论【${howText}】注入画像驱动全程）`,
        counter: `（已转 ponder 十阶段——由 divergence/bagua/debate 产出反方）`,
        failure: `（已转 ponder 十阶段——由 simulate 推演产出失败路径）`,
        realityCheck: `（已转 ponder 十阶段——由 interview 五诊+无知自检产出核对项）`,
        limits: `（已转 ponder 十阶段——由各阶段 epistemic_status 汇总诚实边界）`,
        conclusion: `（已转 ponder 十阶段——由 synthesis 产出收敛结论${stakes === 'high' ? '+可谬自评' : ''}）`,
        respondAs: `按 ponder 十阶段跑完后按衔接契约回填 JSON（见 ponderGuide 第 6 步）。`,
      }
    },
  },

  {
    name: 'jarvis_ponder_check',
    description:
      'ponder 真实性核验器（防"声称跑完十阶段但实际乱序/缺阶段/无产出"——**成员汇报"ponder 已跑完"时必须用它校验，不许听自报**）：读取该 run 的 step-guard 状态 + 项目阶段产出，五查：①**完整性**（十阶段 interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis 是否全部记录，缺哪些）；②**顺序**（sequence 记录的先后是否符合固定顺序——completed 只是集合看不出顺序，无 sequence 记录=顺序无法核验）；③**子 agent 数**（各阶段是否达下限：bagua≥8/plans≥5/score≥3/simulate≥3/debate≥3）；④**产出证据**（给了 evidenceDir 就逐阶段查产出文件是否真落盘——记录完成却无产出=存疑）；⑤**内容指纹**（传了 claimedConclusion 就核验"声称结论 vs run 实际 synthesis/end-state 结论"一致性——防空跑/结论脱节/编造结论，ws8634 借鉴）。另查 run_id 是否与声称一致（不一致=状态被别的 run 覆盖，本轮不可信）与 superseded_run（非空=init 覆盖过别人进度，多 agent 共用状态文件，须 per-run 隔离 PONDER_DATA_DIR）。verdict=PASS 才算真跑完；FAIL/无法核验 → 打回重跑，不许当"已深度思考"。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '（推荐）该 ponder 对应的团队任务 id——核验 PASS 后会落盘 .jarvis/docs/ponder-verify/，收口闸据此强制"每个成员任务都有 ponder 核验"' },
        runId: { type: 'string', description: '成员声称的 ponder run_id（如 run_mtveu8l8_vdkc）——不传则只核验当前状态文件的完整性/顺序，无法比对声称' },
        dataDir: { type: 'string', description: '该 run 的 step-guard 数据目录（PONDER_DATA_DIR，默认 ~/.dsh/data/ponder）——多成员并发时每人应隔离到自己的目录，核验要指向本人目录' },
        evidenceDir: { type: 'string', description: '阶段产出目录（如 <项目>/.jarvis/ponder-runs/<run_id>/）——传了就核验每阶段产出文件是否真落盘' },
        claimedConclusion: { type: 'string', description: '内容指纹核验（ws8634 借鉴 P0）：交付声称的结论/摘要——工具读 run 的 synthesis/end-state 产出，核验"声称结论 vs 实际结论"是否一致（防空跑/结论脱节/编造结论）' },
        projectDir: { type: 'string', description: '（D7）PASS 核验记录的落盘项目目录（缺省=调用会话工作区 exec.agent.session.header.cwd；再缺省=进程工作区兜底）——修「记录漂移到 profile 目录（resolveWorkspace 单例）」的缺陷' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verdict: { type: 'string', description: 'PASS / FAIL' },
          runId: { type: 'string' },
          runIdMatch: { type: 'boolean', description: '声称的 run_id 是否与状态文件一致' },
          completedCount: { type: 'number' },
          totalCount: { type: 'number' },
          missing: { type: 'array', items: { type: 'string' }, description: '未执行的阶段' },
          orderVerifiable: { type: 'boolean', description: '顺序是否可核验（无 sequence 记录=不可核验）' },
          orderViolations: { type: 'array', items: { type: 'string' }, description: '顺序违规明细' },
          agentShortfalls: { type: 'array', items: { type: 'string' }, description: '子 agent 数不足的阶段' },
          evidenceMissing: { type: 'array', items: { type: 'string' }, description: '记录完成但无产出文件的阶段' },
          issues: { type: 'array', items: { type: 'string' }, description: '核验发现的问题' },
          action: { type: 'string', description: '处置建议（通过/打回重跑/要求补证据）' },
          recordPath: { type: 'string', description: '（D7）PASS 核验记录的落盘绝对路径（未落盘=空）' },
          recordProjectDir: { type: 'string', description: '（D7）落盘所选的项目目录（供核验来源优先级是否正确）' },
        },
        required: ['verdict', 'issues', 'action'],
      },
      render: (r) =>
        `【ponder 核验 · ${r.runId ?? '当前状态'} → ${r.verdict}】\n`
        + `完成 ${r.completedCount ?? '?'}/${r.totalCount ?? 10} 阶段${r.missing?.length ? `（缺：${r.missing.join('、')}）` : ''}\n`
        + `顺序：${r.orderVerifiable ? (r.orderViolations?.length ? '⚠️ 违规 ' + r.orderViolations.join('；') : '✅ 按序') : '⚠️ 无顺序记录，无法核验'}\n`
        + `${r.agentShortfalls?.length ? '子 agent 不足：' + r.agentShortfalls.join('；') + '\n' : ''}`
        + `${r.evidenceMissing?.length ? '产出缺失：' + r.evidenceMissing.join('；') + '\n' : ''}`
        + `问题：${(r.issues ?? []).join(' | ') || '无'}\n处置：${r.action ?? ''}`,
    },
    execute: async (args, exec) => {
      const path = _require('node:path')
      const fs = _require('node:fs')
      const os = _require('node:os')

      const STEPS = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis']
      const LABELS = {
        interview: '需求打磨', shensi: '神思', divergence: '发散', bagua: '八卦镜', plans: '方案',
        converge: '收敛', score: '方案评分', simulate: '推演', debate: '辩论', synthesis: '综合',
      }
      const MIN_AGENTS = { interview: 0, shensi: 0, divergence: 0, bagua: 8, plans: 5, converge: 0, score: 3, simulate: 3, debate: 3, synthesis: 0 }
      const EXPECT_FILES = {
        interview: ['stage-interview.json', 'context.md'], shensi: ['stage-shensi.json'],
        divergence: ['stage-divergence.json'], bagua: ['stage-bagua.json'], plans: ['stage-plans.json'],
        converge: ['stage-converge.json'], score: ['stage-score.json'], simulate: ['stage-simulate.json'],
        debate: ['stage-debate.json'], synthesis: ['stage-synthesis.json', 'end-state.md'],
      }

      const claimed = String(args.runId ?? '').trim() || null
      const home = os.homedir ? os.homedir() : '/root'
      const dataDir = String(args.dataDir ?? '').trim() || path.join(home, '.dsh/data/ponder')
      const evidenceDir = String(args.evidenceDir ?? '').trim() || null

      // 读状态文件（新命名 step-guard.cjson，兼容旧 step-guard.json）
      let state = null
      for (const f of ['step-guard.cjson', 'step-guard.json']) {
        const p = path.join(dataDir, f)
        try {
          if (fs.existsSync(p)) {
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
            if (parsed && parsed.run_id) { state = parsed; break }
          }
        } catch { /* 试下一个 */ }
      }

      // 内容指纹（即使无 run 记录也核验——有产出文件就能查声称结论是否来自实际思考；防空跑/结论脱节）
      const fpIssueEarly = checkContentFingerprint(String(args.evidenceDir ?? args.dataDir ?? '').trim(), String(args.claimedConclusion ?? '').trim())

      if (!state) {
        const earlyIssues = [`在 ${dataDir} 找不到有效 run 记录（step-guard.cjson/json 缺失或为空）——**声称跑过 ponder 但无任何记录 = 未跑**；若用了 per-run 隔离目录，先核对 dataDir 是否指对`]
        if (fpIssueEarly) earlyIssues.push(fpIssueEarly)
        return {
          verdict: 'FAIL',
          runId: claimed ?? undefined,
          completedCount: 0,
          totalCount: STEPS.length,
          missing: STEPS,
          orderVerifiable: false,
          orderViolations: [],
          agentShortfalls: [],
          evidenceMissing: [],
          issues: earlyIssues,
          action: '⛔ 打回重跑：要求该角色真实加载 ponder 跑完整十阶段（并在其隔离目录留下 step-guard 记录 + 阶段产出）',
        }
      }

      const issues = []
      if (fpIssueEarly) issues.push(fpIssueEarly)
      const runIdMatch = claimed ? claimed === state.run_id : null
      if (claimed && !runIdMatch) issues.push(`run_id 不匹配：声称 ${claimed}，实际状态文件 ${state.run_id}（状态已被别的 run 覆盖，声称的 run 无法核验）`)
      if (state.superseded_run) issues.push(`本轮 init 覆盖过上一轮未完成的 ${state.superseded_run}（多 agent 共用同一状态文件——须 per-run 隔离 PONDER_DATA_DIR，否则顺序/完整性不可信）`)

      const completed = Array.isArray(state.completed) ? state.completed : []
      const missing = STEPS.filter((s) => !completed.includes(s))
      if (missing.length > 0) issues.push(`缺 ${missing.length} 个阶段未执行：${missing.map((s) => `${LABELS[s]}(${s})`).join('、')}`)

      const seq = Array.isArray(state.sequence) ? state.sequence : null
      const orderViolations = []
      if (seq) {
        let lastIdx = -1
        seq.forEach((e, i) => {
          const idx = STEPS.indexOf(e && e.step)
          if (idx === -1) return
          if (idx < lastIdx) orderViolations.push(`第 ${i + 1} 步 ${LABELS[e.step]}(${e.step}) 出现在 ${LABELS[STEPS[lastIdx]]}(${STEPS[lastIdx]}) 之后——违反固定顺序`)
          else lastIdx = idx
        })
        if (orderViolations.length > 0) issues.push(`顺序违规 ${orderViolations.length} 处：${orderViolations.join('；')}`)
      } else {
        issues.push('无顺序记录（completed 只是集合、看不出先后）——**顺序无法核验**，不能判定"按序跑完十阶段"')
      }

      const agentShortfalls = []
      STEPS.forEach((s) => {
        if (!completed.includes(s)) return
        const need = MIN_AGENTS[s] || 0
        const got = Number((state.agents && state.agents[s]) || 0)
        if (got < need) agentShortfalls.push(`${LABELS[s]}(${s}) 需 ${need} 个，实际 ${got} 个`)
      })
      if (agentShortfalls.length > 0) issues.push(`子 agent 数不足：${agentShortfalls.join('；')}`)

      const evidenceMissing = []
      // 各阶段产出文件的关键字段（防"文件存在但空壳/无实质内容"——fs.existsSync 只看存在，不看内容）
      const EXPECT_KEYS = {
        interview: ['userProfile', '五诊', '天', 'persona'],
        shensi: ['stake', 'premises'],
        divergence: ['perspectives', '共识', 'consensus'],
        bagua: ['dimensions', '八维度'],
        plans: ['plans', '方案'],
        converge: ['survivors'],
        score: ['scored', 'scored_survivors'],
        simulate: ['simulations'],
        debate: ['ranked', 'debate_summary'],
        synthesis: ['recommendation', 'conclusion'],
      }
      if (evidenceDir) {
        STEPS.forEach((s) => {
          if (!completed.includes(s)) return
          const cands = EXPECT_FILES[s] || []
          const hit = cands.some((f) => {
            try {
              const p = path.join(evidenceDir, f)
              if (!fs.existsSync(p)) return false
              const st = fs.statSync(p)
              if (st.size < 200) return false // 空壳/占位文件不算产出
              const txt = fs.readFileSync(p, 'utf8')
              const keys = EXPECT_KEYS[s] || []
              if (keys.length === 0) return true
              return keys.some((k) => txt.includes(k)) // 含关键字段才算实质产出
            } catch { return false }
          })
          if (!hit) evidenceMissing.push(`${LABELS[s]}(${s})，未见含实质内容的 ${cands.join('/')}（文件存在但空壳/缺关键字段=假产出）`)
        })
        if (evidenceMissing.length > 0) issues.push(`阶段产出证据缺失/空壳：${evidenceMissing.join('；')}（记录了完成却无实质产出文件=存疑）`)
      } else {
        issues.push('未提供 evidenceDir——只核验了 step-guard 记录，**未核验阶段产出是否真落盘**（应收该角色项目 .jarvis/ponder-runs/<run_id>/）')
      }

      // ⑤ 内容指纹核验（调用独立函数，防空跑/结论脱节）
      const fpIssue = checkContentFingerprint(String(args.evidenceDir ?? args.dataDir ?? '').trim(), String(args.claimedConclusion ?? '').trim())
      if (fpIssue) issues.push(fpIssue)

      const ok = missing.length === 0 && orderViolations.length === 0 && agentShortfalls.length === 0
        && (!claimed || runIdMatch) && (evidenceDir ? evidenceMissing.length === 0 : true) && !fpIssue

      // 核验留痕：PASS 且有 taskId → 写 .jarvis/docs/ponder-verify/<taskId>-<runId>.json
      // 收口闸据此强制"每个成员任务都经过 ponder 真核验"（scan 实证：jarvis_ponder_check 从未被调用）
      // D7：落盘目录必须来自「本次调用的事实」，不能用进程级单例 resolveWorkspace(getRuntimeContext())——
      // 实证漂移：成员会话里记录写到了 /root/.dsh/profiles/web/.jarvis（收口闸读的是项目目录 → 读不到记录）。
      // 来源优先级：args.projectDir > exec.agent.session.header.cwd > resolveWorkspace(getRuntimeContext()) > '.'
      const wrote = { path: '', dir: '' }
      try {
        const taskId = String(args.taskId ?? '').trim()
        if (ok && taskId) {
          const cwd = ponderVerifyProjectDir(args, exec)
          // 状态根守卫：插件仓库不写 .jarvis（防记忆文件污染插件项目）
          if (!stateRootConflict(cwd)) {
            const dir = path.join(cwd, '.jarvis/docs/ponder-verify')
            fs.mkdirSync(dir, { recursive: true })
            const rec = {
              taskId,
              runId: state.run_id,
              verdict: 'PASS',
              completedCount: completed.length,
              agentShortfalls,
              verifiedAt: new Date().toISOString(),
            }
            wrote.path = path.join(dir, `${taskId.replace(/[^\w.:-]/g, '_')}-${String(state.run_id).replace(/[^\w.:-]/g, '_')}.json`)
            wrote.dir = dir
            fs.writeFileSync(wrote.path, JSON.stringify(rec, null, 2))
          }
        }
      } catch { /* 落盘失败不改变核验结论（但 recordPath 为空，调用方可见） */ }
      return {
        verdict: ok ? 'PASS' : 'FAIL',
        runId: state.run_id,
        runIdMatch: runIdMatch === null ? undefined : runIdMatch,
        completedCount: completed.length,
        totalCount: STEPS.length,
        missing,
        orderVerifiable: !!seq,
        orderViolations,
        agentShortfalls,
        evidenceMissing,
        issues,
        action: ok
          ? '✅ 核验通过：十阶段按序完整执行、子 agent 数达标' + (evidenceDir ? '、阶段产出齐全' : '（本次未核验产出文件，建议下次带 evidenceDir）')
          : '⛔ 打回：不许把"声称已完成"当"已深度思考"——要求该角色补齐缺失阶段/按其隔离目录重跑并留下顺序记录与阶段产出，再交核验',
        ...(wrote.path ? { recordPath: wrote.path, recordProjectDir: wrote.dir.replace(/[/\\\\]\.jarvis[/\\\\]docs[/\\\\]ponder-verify$/, '') } : {}),
      }
    },
  },
]
