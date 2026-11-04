/** jarvis_* 工具（intake）：接单与拆解：需求分级入口、进度回写、需求打磨、任务拆解。
 *
 *  工具定义与 handler 同文件；依赖一律从层模块 import（runtime/gates/state/pixoffice/distill/protocol），
 *  不在工具内再实现判定逻辑——闸与状态只认单一事实源。
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { defineTool } from '@deepseek-ai/dsh-tools'
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
export const INTAKE_TOOLS = [
  {
    name: 'jarvis_project',
    description:
      '贾维斯接单入口（领域无关）：对用户原始需求做建队分级建议（S/M/L）——S=直接做、M=精简公司、L=全链公司。插件不预设任何行业/人物（领域由 CEO 结合本项目情况现场判断）。CEO 用本工具决定"这单要不要建队"（团队大小由后续需求拆解出的环节定，不预设人数），再走现场蒸馏（jarvis_distill）与项目沉淀（jarvis_store）。',
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
          vague: { type: 'boolean', description: '需求是否过于模糊（需先澄清）' },
          clarifyHint: { type: 'string', description: '模糊时给出的澄清指引' },
        },
        required: ['industry', 'suggestion'],
      },
      render: (r) => `行业=${r.industry}（置信 ${r.confidence ?? '?'}）建议=${r.suggestion}\n蒸馏方向：${r.distillDirection ?? ''}`,
    },
    handler: async (args, exec) => {
      const text = String(args.requirement ?? '')
      const hit = identifyIndustry(text)
      const out = {
        industry: hit.industry,
        confidence: hit.vague ? 'low' : 'medium',
        suggestion: hit.suggestion,
        distillDirection: hit.distillDirections.join(' / '),
      }
      if (hit.vague) {
        out.vague = true
        out.clarifyHint = '需求过于模糊：先用 jarvis_clarify 做 REFORM-CLARIFY 澄清（问清"为谁解决什么、怎样算成功"），未清晰前不建队。'
      }
      return out
    },
  },

  {
    name: 'jarvis_update',
    description:
      '插件版本检测器（回答"我能不能升级"）：对比 本地 package.json version vs GitHub 远程最新 release tag（git ls-remote --tags origin），判断是否有新版本；有新版本输出 升级内容摘要（读 CHANGELOG.md 最新条目）+ 升级步骤（解包覆盖 node_modules + 重启生效）。用法：本地版本取 require(process.cwd()/package.json)，远程取 git ls-remote。诚实：网络/git 不可用则如实报告"无法检测"，不编造版本号。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'check 检测是否有新版本（默认）；detail 详情（含 CHANGELOG 摘要）' },
        remoteUrl: { type: 'string', description: '远程仓库 URL（默认 https://github.com/ljjluke/luke-jarvis.git）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          localVersion: { type: 'string' },
          remoteVersion: { type: 'string' },
          hasUpdate: { type: 'boolean' },
          changelog: { type: 'string' },
          upgradeStep: { type: 'string' },
          verdict: { type: 'string' },
        },
        required: ['localVersion', 'verdict'],
      },
      render: (r) =>
        `【版本检测】本地 ${r.localVersion} vs 远程 ${r.remoteVersion ?? '?'}${r.hasUpdate ? ' ⬆️ 有新版本' : ' ✅ 已是最新'}\n${r.changelog ? '变更摘要：' + r.changelog.slice(0, 120) + '\n' : ''}${r.upgradeStep ? '升级：' + r.upgradeStep + '\n' : ''}判定：${r.verdict}`,
    },
    handler: async (args, exec) => {
      const path = _require('node:path')
      const fs = _require('node:fs')
      const remoteUrl = String(args.remoteUrl ?? 'https://github.com/ljjluke/luke-jarvis.git')
      let localVersion = '0.2.0'
      // 插件自身目录（import.meta.url 定位，不用 process.cwd()——服务进程 cwd 不是插件目录）
      let pluginRoot = ''
      try { pluginRoot = path.dirname(new URL(import.meta.url).pathname) } catch {}
      if (!pluginRoot) { try { pluginRoot = process.cwd() } catch {} }
      try {
        const pkgPath = path.join(pluginRoot, 'package.json')
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
          if (pkg.version) localVersion = String(pkg.version)
        }
      } catch { /* 保持默认 */ }
      // 远程最新版本：git ls-remote --tags
      let remoteVersion = ''
      let remoteError = ''
      try {
        const out = execFileSync('git', ['ls-remote', '--tags', remoteUrl], { timeout: 20000, encoding: 'utf8' })
        // 取形如 v0.2.0 的最高语义版本 tag（排除 ^{} 与非 v 前缀）
        const tags = out.split('\n').map((l) => l.trim().split(/\s+/)[1]).filter((t) => t && t.startsWith('refs/tags/v'))
          .map((t) => t.replace('refs/tags/', '')).filter((t) => !t.endsWith('^{}'))
        const semver = tags.map((t) => t.replace(/^v/, '')).filter((t) => /^\d+\.\d+\.\d+/.test(t))
          .sort((a, b) => { const pa = a.split('.').map(Number); const pb = b.split('.').map(Number); return (pa[0] - pb[0]) || (pa[1] - pb[1]) || (pa[2] - pb[2]) })
        remoteVersion = semver.length ? 'v' + semver[semver.length - 1] : ''
      } catch (e) {
        remoteError = String(e.message || e).slice(0, 80)
      }
      const parse = (v) => String(v || '').replace(/^v/, '').split('.').map(Number)
      let hasUpdate = false
      if (remoteVersion) {
        const l = parse(localVersion); const r = parse(remoteVersion)
        hasUpdate = (l[0] !== r[0] ? r[0] > l[0] : l[1] !== r[1] ? r[1] > l[1] : r[2] > l[2])
      }
      // 变更摘要：读 CHANGELOG 最新版本块
      const changelog = (() => {
        try {
          const repo = path.join(pluginRoot, 'CHANGELOG.md')
          if (!fs.existsSync(repo)) return ''
          const s = fs.readFileSync(repo, 'utf8')
          const blocks = s.split(/^## /m)
          return blocks.length > 1 ? (blocks[1] || '').slice(0, 300) : ''
        } catch { return '' }
      })()
      const verdict = remoteError
        ? `无法连接远程（${remoteError}）——未能确认是否有新版本，请稍后重试或手动查看 https://github.com/ljjluke/luke-jarvis/releases`
        : !remoteVersion
          ? '远程无 v 前缀语义版本 tag（可能首次发布未打 tag）——请用 CHANGELOG 判断'
          : hasUpdate
            ? `有新版本 ${remoteVersion}（本地 ${localVersion}）：按 UPGRADE 文档升级（解包覆盖 node_modules/luke-jarvis + 重启 dsh web）。`
            : `已是本地最新 ${localVersion}（远程 ${remoteVersion}）：无需升级。`
      const updateOut = { localVersion, hasUpdate, verdict }
      if (remoteVersion) updateOut.remoteVersion = remoteVersion
      if (changelog) updateOut.changelog = changelog
      if (hasUpdate) updateOut.upgradeStep = 'docs/UPGRADE-*.md：解包 → 覆盖 ~/.dsh/profiles/web/node_modules/luke-jarvis/ → 重启 dsh web'
      return updateOut
    },
  },

  {
    name: 'jarvis_clarify',
    description:
      '需求澄清引导器（REFORM-CLARIFY 机制实现，领域无关）：用户需求模糊时，CEO 以专业角度分析用户需求并引导用户回答问题（不是干等/代为澄清）。模式：①analyze=CEO 专业分析先行——把模糊需求按行业常识/同类需求模式/可行域翻译成 5 角度候选问题（P1 场景/P2 现状/P3 痛点/P4 期望/P5 验收），返回候选问题清单+模糊度判定；②trigger=蒸馏触发判定（机械可判 T1-T5：T1 5 角度中≥2 个候选问题为空或仅含无具体名词追问（"再说说/展开讲讲"不计，须含对象/场景/行业词才算数）、T2 无同类卡与原型、T3 ≥2 角度命中行业术语但引不出行业依据（规范名/source/同类案例出处）、T4 用户回答超 CEO 专业范围、T5 单人 3 轮未收敛——任一触发=建议现场蒸馏该需求领域真实大佬（软件→软件大佬、制造→制造大佬，领域由需求决定插件无预设），六段式卡过 jarvis_distill 校验后双人进场）；③ask=三阶提问（开放→聚焦→确认，**问尽所有真疑问、不设数量上限**——收敛判据是"无剩余真疑问"不是"固定几个"）生成引导话术；④duo=双人协作方案 A 判据（同刻一人主问：用户回答前主问者 from≤1 可数，补充消息须标注"补充"；CEO 域=P5 验收+与交付相关的 P2 子集[频率/负责人/时限]，大佬域=P1-P4 场景/细节/专业盲区，防重复=问题含场景/现状/痛点/期望/验收关键词即同域）；⑤confirm=澄清完成判定（需求本质重述三段式[为谁/解决什么/怎样算成功可判定]+假设分级[已确认/推断待确认]，经用户确认=完成，缺一禁止进拆解）。铁律：推断不得冒充用户已确认；用户拒绝/失联=连续 2 轮无有效回答→按 CEO 推断+显式标注继续（3 轮=挂起）；澄清产出过 B16 黑板翻译/B22 可行性闸/B15 分层（标注为黑板决议目标态）；蒸馏查证优先用默认搜索工具 web_search（先真调再判断），真失败才降级（curl 验证 source+标注推演，降级须用户知情同意）。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'analyze 专业分析+候选问题 / trigger 蒸馏触发判定 / ask 三阶提问话术 / duo 双人协作判据 / confirm 澄清完成判定（默认 analyze）' },
        requirement: { type: 'string', description: '用户原始需求（可模糊，必填）' },
        industry: { type: 'string', description: 'CEO 判断的领域（可选，领域由需求决定插件无预设）' },
        candidates: { type: 'string', description: 'analyze 产出的 5 角度候选问题 JSON 或文本（trigger/ask 用）' },
        roleCards: { type: 'string', description: '双人协作：CEO 卡 + 蒸馏大佬卡清单 JSON（duo 用）' },
        round: { type: 'string', description: '当前澄清轮次（ask/duo 用）' },
        userAnswers: { type: 'string', description: '用户已回答内容 JSON（confirm 用：判定假设分级与完成）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', description: '本次执行的模式：analyze/trigger/ask/duo/confirm' },
          essence: { type: 'string', description: '需求本质判定' },
          candidates: { type: 'array', items: { type: 'string' }, description: '5 角度候选问题' },
          vague: { type: 'boolean', description: '需求是否模糊（需澄清）' },
          trigger: { type: 'string', description: '触发判定：不触发/T1-T5 触发/需蒸馏' },
          triggerDetail: { type: 'string' },
          questions: { type: 'array', items: { type: 'string' }, description: '本轮引导话术' },
          duoCheck: { type: 'string', description: '双人协作方案 A 判据核对结果' },
          confirm: { type: 'string', description: '澄清完成判定' },
          verdict: { type: 'string' },
        },
        required: ['verdict'],
      },
      render: (r) =>
        `【需求澄清 · ${r.mode ?? 'analyze'}】\n本质：${r.essence ?? ''}\n模糊度：${r.vague === undefined ? '' : r.vague ? '⚠️ 模糊需澄清' : '✅ 可判定'}\n${r.candidates?.length ? '候选问题：\n  ' + r.candidates.map((c) => '· ' + c).join('\n  ') : ''}${r.trigger ? '\n触发：' + r.trigger : ''}${r.questions?.length ? '\n本轮话术：\n  ' + r.questions.map((q) => '· ' + q).join('\n  ') : ''}${r.duoCheck ? '\n双人判据：' + r.duoCheck : ''}${r.confirm ? '\n完成判定：' + r.confirm : ''}\n裁决：${r.verdict}`,
    },
    handler: async (args, exec) => {
      const mode = String(args.mode ?? 'analyze').trim()
      const req = String(args.requirement ?? '').trim()
      const industry = String(args.industry ?? '').trim()
      // 仅 analyze/trigger 需要 requirement；ask/duo/confirm 可无（duo 只要 roleCards，confirm 只要 userAnswers）
      if (!req && (mode === 'analyze' || mode === 'trigger')) return { verdict: '⚠️ 缺 requirement：analyze/trigger 必须先有用户原始需求（可模糊）' }
      // ── 需求本质判定（领域无关：为谁解决什么、怎样算成功可判定）──
      const hasWho = /为谁|用户|谁|受众|客户|员工|患者|学生/.test(req)
      const hasWhat = /解决|做|建|实现|想要|需要|自动化|系统|工具|流程/.test(req)
      const hasSuccess = /成功|验收|指标|衡量|多少|怎样算|达标|效率|减少|提升/.test(req)
      const vague = !(hasWho && hasWhat && hasSuccess)
      if (mode === 'analyze') {
        // ── CEO 专业分析先行：5 角度候选问题（领域无关话术，P 编号）──
        const cand = [
          `【P1 场景】你提到想解决「${req.slice(0, 60)}」，具体在什么场景下遇到这个问题？（谁在用、什么时候发生）`,
          `【P2 现状】现在你们是怎么做的？（当前流程/手工方式/现有工具）哪里最费劲？`,
          `【P3 痛点】这个过程里最让你头疼的是哪一步？（最花时间/最易出错/最烦）`,
          `【P4 期望】你期望它做到什么程度？（理想结果/想要的效果）`,
          `【P5 验收】如果做成了，你拿什么判断成功？（指标/完成标准/多少时间内）`,
        ]
        return {
          mode: 'analyze',
          essence: `为谁解决什么：${req.slice(0, 120)}${industry ? `（领域：${industry}）` : ''}。模糊度判定：${vague ? '⚠️ 需求模糊——缺少' + [hasWho?'':'为谁(受众)',hasWhat?'':'解决什么(动作/对象)',hasSuccess?'':'怎样算成功(指标/验收)'].filter(Boolean).join('/') + '，需按 5 角度引导用户澄清' : '✅ 三要素齐备，可进拆解'}`,
          candidates: cand,
          vague,
          verdict: vague
            ? `需求模糊 → 按 5 角度候选问题引导用户回答（**问尽真疑问、不设数量上限**，先开放后聚焦，最后确认式）；用户回答后跑 trigger 判定是否需蒸馏行业大佬`
            : `需求可判定 → 无需澄清，直接进需求本质回归+拆解`,
        }
      }
      if (mode === 'trigger') {
        // ── 蒸馏触发判定（机械可判 T1-T5，领域无关）──
        const candText = String(args.candidates ?? '')
        const cands = candText.split('\n').map((s) => s.trim()).filter(Boolean)
        // T1：5 角度中候选问题为空或仅含无具体名词追问的角度≥2（"再说说/展开讲讲"不计，须含对象/场景/行业词）
        const generic = /再说说|展开讲讲|具体说说|详细说说|还有吗/.test(candText)
        const emptyCount = cands.filter((c) => !c || c.length < 4).length
        const t1 = emptyCount >= 2 || (generic && cands.length < 3)
        // T3：命中专业术语但引不出依据（领域无关——不预设任何行业的黑话词，只识别"用术语表达+给不出依据"的通用模式）
        //   插件不预设 OEE/TPM/GAAP/排课/良率 等具体行业词（那是领域知识，属项目沉淀职责）；
        //   只认跨领域的术语标记词（术语/黑话/规范/标准/合规/认证/SOP/KPI/指标…），其余交给 CEO 结合需求现场判断。
        const industryTerms = /术语|黑话|行话|规范|标准|认证|合规|审核|检定|SOP|KPI|ROI|指标体系|方法论|框架|协议|标准号|出处/.test(req)
        // canCite 只测"已给出的具体依据"（"依据…/按…规范/参考…/…出处/…source"），不含候选问题话术里的"完成标准/验收标准"字样
        const canCite = /(依据|按|参考|根据|引用|查)[^\n]{0,20}(规范|标准|规程|source|出处|案例)|(规范名|标准号|出处|source|案例)[：:]\s*\S+/.test(String(args.candidates ?? ''))
        const t3 = industryTerms && !canCite
        const t4 = /超出|不会|不懂|不知道.*专业|领域外/.test(req) || /专业.*(术语|知识)/.test(req)
        const triggered = t1 || t3 || t4
        return {
          mode: 'trigger',
          trigger: triggered ? (t1 ? 'T1 触发' : t3 ? 'T3 触发' : 'T4 触发') : '不触发',
          triggerDetail: triggered
            ? `CEO 对「${req.slice(0, 60)}」的${t1 ? '5 角度候选问题≥2 个引不出（含具体名词的）追问' : t3 ? '行业术语命中但引不出行业依据（规范名/source）' : '用户回答超出专业范围'}——建议现场蒸馏该需求领域真实大佬（${industry || '领域由需求决定'}：软件→软件大佬/制造→制造大佬/金融→金融大佬…，插件无预设），六段式卡过 jarvis_distill 校验后双人进场`
            : `CEO 专业分析足以覆盖，无需蒸馏大佬，继续引导`,
          verdict: triggered ? `触发蒸馏 → 现场 web 蒸馏「${industry || '该需求领域'}」真实权威（优先用默认搜索工具 web_search 查证，真失败才降级：curl 验证 source+标注推演，降级须用户知情同意）→ jarvis_distill 校验 → 双人协作` : `不触发 → CEO 单人三阶引导（开放→聚焦→确认）`,
        }
      }
      if (mode === 'ask') {
        // ── 三阶提问话术（开放→聚焦→确认，问尽真疑问、不设数量上限）──
        const round = Number(args.round ?? 1)
        const cands = String(args.candidates ?? '')
          .split('\n').map((s) => s.trim()).filter(Boolean)
        let questions = []
        if (round <= 1) {
          // 第 1 阶开放式：让用户展开（P1 场景 + P2 现状 各取一句）
          questions = [cands[0] || `你提到想解决「${req.slice(0, 50)}」，能说说在什么场景下遇到、现在怎么做的吗？`]
          if (cands[1]) questions.push(cands[1])
        } else if (round === 2) {
          // 第 2 阶聚焦式：追最痛一点 + 期望边界
          questions = [`你刚才提到最头疼的是哪一步？能举个具体例子吗？`]
          if (cands[3]) questions.push(cands[3])
        } else {
          // 第 3 阶确认式：需求本质重述确认（P5 验收）
          questions = [`如果做成了，你拿什么判断成功？（完成标准/指标/时限）`]
          if (cands[4]) questions.push(cands[4])
        }
        questions = questions.slice(0, 12) // 一次问尽真疑问（不设 2 个上限——用户要求"目的是对其需求所有疑问"，收敛判据=无剩余真疑问）
        return {
          mode: 'ask',
          questions,
          verdict: `第 ${round} 轮 · ${round === 1 ? '开放式（让用户展开）' : round === 2 ? '聚焦式（追痛点/期望）' : '确认式（钉验收标准）'}——用户回答后继续下一轮或跑 confirm`,
        }
      }
      if (mode === 'duo') {
        // ── 双人协作方案 A 判据（同刻一人主问）──
        const cards = String(args.roleCards ?? '')
        const hasCeo = /CEO|ceo/.test(cards) || cards.includes('CEO')
        const hasExpert = cards.split('\n').length >= 2 || /大佬|专家/.test(cards)
        const r = Number(args.round ?? 1)
        const mainAsker = r % 2 === 1 ? '蒸馏大佬' : 'CEO' // 奇数轮大佬先主问，偶数轮 CEO 主问
        return {
          mode: 'duo',
          duoCheck: `方案 A 判据：同刻一人主问（用户回答前主问者 from≤1，对话记录可数）；本轮（第 ${r} 轮）主问者=${mainAsker}；补充消息须标注"补充"（无标注=违规抢问）${hasCeo && hasExpert ? '' : '；⚠️ 双人进场需 CEO 卡 + 蒸馏大佬卡（roleCards）'}`,
          verdict: `双人分工：CEO 域=P5 验收+与交付相关的 P2 子集（频率/负责人/时限）；大佬域=P1-P4 场景/细节/专业盲区。防重复=问题含场景/现状/痛点/期望/验收关键词即同域，后问者降级为具体化追问`,
        }
      }
      if (mode === 'confirm') {
        // ── 澄清完成判定（需求本质重述三段式 + 假设分级）──
        const answers = String(args.userAnswers ?? '')
        const aLen = answers.trim().length
        // BUG-2 修复：必须显式确认才判完成——去掉 "aLen>=20 即算确认" 的宽松兜底（长描述≠用户确认，推断不得冒充已确认）。
        //   确认词（确认/可以/对/是的/没错/行/嗯/好的/就这么定）+ 或 明确验收标准（数字+单位）作隐含确认辅助。
        const explicitConfirm = /确认|可以|对|是的|没错|行|嗯|好的|就这么|没问题|同意|OK|ok|就这样/.test(answers)
        const hasAcceptance = /\d+\s*(%|％|秒|分钟|小时|天|单|次|个|元|万|倍)/.test(answers)
        const hasConfirm = explicitConfirm || (aLen >= 15 && hasAcceptance)
        const done = aLen >= 15 && hasConfirm
        return {
          mode: 'confirm',
          confirm: done
            ? `✅ 澄清完成：需求本质重述（为谁=${/用户|员工|患者|客户|学生/.test(answers) ? '已明确' : '待补'} / 解决什么=${aLen >= 15 ? '已明确' : '待补'} / 怎样算成功=${/指标|衡量|达标|多少|效率|准确率|成功率|\d+\s*(%|％|秒|分钟|小时|天|单|次)|减少|提升|降低/.test(answers) ? '已明确' : '待补'}）经用户确认 → 可进拆解`
            : `⏳ 未完成：${aLen < 15 ? '用户回答不足（需继续引导）' : '未获用户确认——请明确确认（"确认/可以/对，就是这样"）或给出可判定验收标准（数字+单位）'}——缺一禁止进拆解；用户拒绝/失联=连续 2 轮无有效回答→按 CEO 推断+显式标注继续（3 轮=挂起）`,
          verdict: done ? '澄清完成 → 产出过 B16 黑板翻译（转目标/验收/边界）+ B22 可行性闸（不可行前置反馈）+ B15 分层（标注黑板决议目标态）' : '继续澄清',
        }
      }
      return { mode, verdict: '未知模式（analyze/trigger/ask/duo/confirm）' }
    },
  },

  {
    name: 'jarvis_taskgraph',
    description:
      '任务编排图校验器（CEO 派活前的硬产物闸——学 HuggingGPT 的依赖图思想：先拆结构化任务图再执行，防"口头派活依赖漏接/下游等上游/验收不明确"）：输入 CEO 拆出的任务清单 JSON，输出健康检查——每个任务(id/负责人/依赖/输入槽位/验收标准)，校验：①依赖闭环（无悬空依赖——每个依赖 id 都真实存在）；②无自依赖/循环依赖；③并行可行性（无依赖的独立任务可并行，不硬串行）；④每任务验收可判（验收标准非空且可判定）；⑤上下游产出传递（下游任务标注了"输入=上游 X 的产出"，防下游等不到上游交付）。**任务类型不预设枚举**（领域无关：CEO 按需求现场拆，不受限固定清单）。**校验器只做结构健康检查，不替代 CEO 判断**——结构问题(悬空/循环/无验收)打回重拆，拆图过闸才派活。产物沉淀 `<项目>/.jarvis/docs/任务编排-<需求关键词>.md`，且任务图可直接写入 company-state.json 的 tasks 表（3D 任务看板数据源）。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '需求本质（任务图围绕它拆——每任务须指向需求某条可判定验收）' },
        tasksJson: { type: 'string', description: '任务清单 JSON 数组：[{id, title, assignee, deps, inputs, acceptance}]——id=任务编号(数字或字符串)；title=任务名；assignee=负责人角色；deps=依赖的上游任务 id 数组(无依赖=[]或省略)；inputs=输入槽位描述(注明来自哪个上游任务产出，如"来自T1的方案设计文档")；acceptance=验收标准(怎样算这个任务完成，可判定)' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskCount: { type: 'number', description: '任务总数' },
          issues: { type: 'array', items: { type: 'string' }, description: '健康检查问题（空=无问题）' },
          ok: { type: 'boolean', description: '任务图是否可派活' },
          parallelGroups: { type: 'array', items: { type: 'string' }, description: '可并行的任务组建议' },
          staffing: {
            type: 'object',
            additionalProperties: true,
            description: '编制健康报告：assignees(参与角色)/distribution(各角色任务数)/executorCount(执行角色数)/maxLoad(单人最大负载)——防"单一角色包办全部任务"',
          },
          verdict: { type: 'string' },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) => {
        const dist = r.staffing && r.staffing.distribution
          ? Object.entries(r.staffing.distribution).map(([k, v]) => k + ':' + v).join(', ')
          : ''
        const staffLine = r.staffing
          ? '\n编制：' + (r.staffing.executorCount ?? '?') + ' 个执行角色 / 单人最大负载 ' + (r.staffing.maxLoad ?? '?') + ' 任务' + (dist ? '（' + dist + '）' : '')
          : ''
        return `任务编排图：${r.ok ? '✅ 可派活' : '❌ 打回重拆'}（${r.taskCount} 任务）\n问题：${(r.issues ?? []).map((i) => '⚠️ ' + i).join('\n')}\n并行建议：${(r.parallelGroups ?? []).join(' / ')}${staffLine}`
      },
    },
    handler: async (args, exec) => {
      const req = String(args?.requirement ?? '')
      const issues = []
      let tasks = []
      try {
        const parsed = JSON.parse(String(args?.tasksJson ?? '[]'))
        if (Array.isArray(parsed)) tasks = parsed
        else issues.push('tasksJson 需为 JSON 数组')
      } catch {
        issues.push('tasksJson 解析失败（需合法 JSON 数组）')
      }
      const ids = new Set()
      const seen = new Set()
      const normId = (x) => String(x ?? '').trim()
      for (const t of tasks) {
        const id = normId(t?.id)
        if (!id) { issues.push('存在无 id 的任务（每个任务必须编号）'); continue }
        if (seen.has(id)) { issues.push(`任务 id 重复：${id}`); continue }
        seen.add(id)
        ids.add(id)
        const title = String(t?.title ?? '').trim()
        if (!title) issues.push(`任务 ${id} 缺标题（title）`)
        const assignee = String(t?.assignee ?? '').trim()
        if (!assignee) issues.push(`任务 ${id} 缺负责人（assignee——派活必须有主人）`)
        const acc = String(t?.acceptance ?? '').trim()
        if (!acc) issues.push(`任务 ${id} 缺验收标准（acceptance——没有"怎样算完成"的任务不许派）`)
        else if (/^\s*(做完|搞定|弄好|完成|做好|差不多|尽量|尽快|看着办|随便)\s*$/.test(acc)) issues.push(`任务 ${id} 验收标准不可判定：「${acc}」是空泛词——须写明可检查的结果（如"输出文档含 X 节/代码过 Y 测试/页面能 Z"）`)
        // scan 教训（实现A 画蛇添足）：标题/验收暗示"替代/重建/对齐旧版/重做"的任务，验收若没写清"对齐参照基准的什么结构"→ 实现照做也错
        else {
          const titleText = String(t?.title ?? '')
          const altSignal = /重做|移植|重建|复刻|替代|迁移|对齐旧|对照旧|同旧|按旧|还原/.test(titleText + ' ' + acc)
          const hasRefAlign = /(对齐|对照|一致|同旧|同原|参照|按旧|结构|形态|页签|布局|样式)/.test(acc)
          if (altSignal && !hasRefAlign) issues.push(`任务 ${id} 是替代/重建/对齐类（${titleText.slice(0, 30)}），验收标准没写"与参照基准对齐的什么结构/形态"（scan 教训：验收只写"分类型表单"漏了"UI 结构对齐旧版页签形态"，实现就画蛇添足加错东西——替代类任务的验收必须含结构对齐约束，如"UI 结构对齐旧版两页签形态、不加基准没有的"）`)
          else if (altSignal && hasRefAlign) {
            // scan 教训深化（用户指出"子页面缺失/bug 是验证深度不足，不是拆解/能力"）：
            // 替代/重建类任务，光有"结构对齐"还不够——须①逐项对照参照基准②真实验证，否则细节漏/静默失效（R22 协议名这类"代码在但错"静态复核拦不住）
            const hasPerItem = /逐项|逐条|全部|每一项|完整对照|逐一对/.test(acc)
            const hasRealVerify = /真机|实机|真跑|实际跑|实际用|实操|真实验证|部署后|点一遍|走一遍|验证生效|实际验证/.test(acc)
            if (!hasPerItem && !hasRealVerify) issues.push(`任务 ${id} 是替代/重建/对齐类（${titleText.slice(0, 30)}），验收有结构对齐但缺"逐项对照 + 真实验证"（scan 教训深化：子页面缺失/字段丢=没逐项对照旧版；R22 协议名错=没对照后端契约/真跑——替代类任务验收须含"逐项对照参照基准的每个子页/字段/校验/交互 + 关键路径真实验证"，如"对照旧版 auth 页逐项核字段/校验/交互，无遗漏；弱口令勾选后真跑验证后端收到 postgres 协议"）`)
          }
        }
        const deps = Array.isArray(t?.deps) ? t.deps : []
        const realDeps = deps.map(normId).filter((d) => d && d !== '-1' && d !== 'none')
        for (const d of deps) {
          const ds = normId(d)
          if (ds === id) issues.push(`任务 ${id} 自依赖（依赖自己——拆错）`)
          else if (ds && ds !== '-1' && ds !== 'none' && !tasks.some((o) => normId(o?.id) === ds)) issues.push(`任务 ${id} 依赖悬空：依赖 ${ds} 不存在（deps 必须指向真实任务 id）`)
        }
        // 输入槽位（学 HuggingGPT：参数引用是事实源，deps 必须覆盖 inputs 引用的上游）：
        //   inputs 里的"来自任务 X"必须真实存在且 ∈ deps——不允许 deps 与 inputs 两套信息不一致
        const inputsArr = Array.isArray(t?.inputs) ? t.inputs : (String(t?.inputs ?? '').split(/[、,;；]/).map((x) => x.trim()).filter(Boolean))
        const inputRefs = new Set()
        for (const inp of inputsArr) {
          const m = String(inp).match(/任务\s*([A-Za-z0-9_-]+|[0-9]+)/) || String(inp).match(/(?:来自|上游|依赖)\s*([A-Za-z0-9_-]+|[0-9]+)/)
          if (m) {
            const rid = normId(m[1])
            if (rid === id) issues.push(`任务 ${id} 输入来源自引用：inputs 引用任务 ${id} 自己（输入只能来自别的前置任务）`)
            else if (!tasks.some((o) => normId(o?.id) === rid)) issues.push(`任务 ${id} 输入来源悬空：inputs 引用任务 ${rid} 但不存在`)
            else if (!realDeps.includes(rid)) issues.push(`任务 ${id} deps 与 inputs 不一致：inputs 引用任务 ${rid} 的产出，但 deps=[${realDeps.join(',') || '空'}] 没依赖它——deps 必须覆盖 inputs 引用的全部上游`)
            inputRefs.add(rid)
          }
        }
        if (realDeps.length && inputsArr.length === 0) issues.push(`任务 ${id} 有依赖但未写输入来源（inputs——下游要等上游的什么产出？写明"来自任务 X 的什么"防空等）`)
      }
      if (!tasks.length && !issues.length) issues.push('任务清单为空（先拆任务再派活）')
      // 循环依赖检测（简化：DFS 报环）
      const adj = {}
      for (const t of tasks) {
        const id = normId(t?.id)
        if (!id) continue
        adj[id] = (Array.isArray(t?.deps) ? t.deps : []).map(normId).filter((d) => d && d !== '-1' && d !== 'none' && ids.has(d))
      }
      const WHITE = 0, GRAY = 1, BLACK = 2
      const color = {}
      const cyclePath = []
      const dfs = (u, path) => {
        color[u] = GRAY
        path.push(u)
        for (const v of adj[u] || []) {
          if (!color[v]) { if (dfs(v, path)) return true }
          else if (color[v] === GRAY) { cyclePath.push(...path.slice(path.indexOf(v)), v); return true }
        }
        path.pop()
        color[u] = BLACK
        return false
      }
      for (const id of ids) {
        if (!color[id]) {
          if (dfs(id, [])) { issues.push(`循环依赖：${cyclePath.join(' → ')}（任务互相等，永远不开始——拆错）`); break }
        }
      }
      // 并行组建议（拓扑分层：同层任务可并行；层 = 最长依赖链长度）
      // 防循环干扰：有环时跳过分层（环已报 issue，不产出误导性并行建议）
      const hasCycle = issues.some((i) => i.includes('循环依赖'))
      const levelOf = {}
      const parallelGroups = []
      if (!hasCycle) {
        const computeLevel = (id) => {
          if (levelOf[id] !== undefined) return levelOf[id]
          const deps = adj[id] || []
          if (!deps.length) { levelOf[id] = 0; return 0 }
          let mx = -1
          for (const d of deps) mx = Math.max(mx, computeLevel(d))
          levelOf[id] = mx + 1
          return levelOf[id]
        }
        for (const id of ids) computeLevel(id)
        const byLevel = {}
        for (const t of tasks) {
          const id = normId(t?.id)
          if (!id) continue
          const lv = levelOf[id] ?? 0
          ;(byLevel[lv] = byLevel[lv] || []).push(String(t?.title ?? id))
        }
        for (const lv of Object.keys(byLevel).map(Number).sort((a, b) => a - b)) {
          const group = byLevel[lv]
          if (group.length > 1) parallelGroups.push(`第${lv + 1}批可并行：${group.join(', ')}`)
          else if (group.length === 1 && lv === 0) parallelGroups.push(`首批开工：${group[0]}`)
        }
      }
      // ── 编制健康检查（lyj 教训：用户点名批评"分析人员只有 CEO 吗？"——建队只配 CEO+猎头，
      //    8 个任务 6 个压在 CEO 一人身上，CEO 成瓶颈、用户点名要的产出拖了三轮。
      //    拆图时若任务集中在单一执行者身上 = 编制不足，必须先配齐角色再派活。）──
      const byAssignee = {}
      for (const t of tasks) {
        const a = normId(t?.assignee)
        if (!a) continue
        byAssignee[a] = (byAssignee[a] || 0) + 1
      }
      const assigneeNames = Object.keys(byAssignee)
      const staffingReport = {
        assignees: assigneeNames,
        distribution: byAssignee,
        executorCount: assigneeNames.length,
        maxLoad: assigneeNames.length ? Math.max(...assigneeNames.map((a) => byAssignee[a])) : 0,
      }
      if (tasks.length >= 3 && assigneeNames.length === 1) {
        issues.push(`编制不足：${tasks.length} 个任务全部由「${assigneeNames[0]}」一人承担（只有 1 个执行者）——**建队必须先按拆解出的环节配齐角色再派活**（该角色若同时是带队者，其职责是带队/把关/盯人，不该是唯一执行者；lyj 教训：只配 CEO+猎头就开工，用户点名批评"分析人员只有 CEO 吗？"，CEO 成瓶颈导致点名要的产出拖了三轮）。先拆岗位《员工需求单》→ 猎头寻访 → 注入执行角色，再派任务`)
      } else if (tasks.length >= 4 && assigneeNames.length > 0) {
        const ranked = [...assigneeNames].sort((a, b) => byAssignee[b] - byAssignee[a])
        const top = ranked[0]
        const share = byAssignee[top] / tasks.length
        if (share > 0.6) {
          issues.push(`编制瓶颈：「${top}」一人承担 ${byAssignee[top]}/${tasks.length} 个任务（${Math.round(share * 100)}%）——单点过载会拖垮交付（lyj 教训：6/8 任务压 CEO 一人，用户点名要的产出拖了三轮、次晨用户发"？"追问）。按环节补充执行角色分担，或说明为何该角色必须一人承担`)
        }
      }
      const ok = issues.length === 0
      return {
        taskCount: tasks.length,
        issues,
        ok,
        parallelGroups,
        staffing: staffingReport,
        verdict: ok
          ? `任务编排图合格（${tasks.length} 任务）：依赖无悬空/无循环、每任务有负责人+可判定验收、独立任务可并行。可派活（agent_teams_create_task 逐个建，dependencies 按 deps 接）。任务图沉淀 docs/任务编排-*.md 并写入 company-state tasks 表（3D 看板可渲染）。`
          : `任务编排图待修（${issues.length} 项）：${issues.slice(0, 5).join('；')}。打回 CEO 重拆——任务图有结构问题不许派活（悬空依赖=下游等不到；循环=永远不开始；无验收=做完不知道算不算完）。`,
      }
    },
  },
]
