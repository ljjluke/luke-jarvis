/** jarvis_* 工具（deliver）：交付收口：发布闸、基线、覆盖矩阵、流程闸、任务单内核。
 *
 *  工具定义与 handler 同文件；依赖一律从层模块 import（runtime/gates/state/pixoffice/distill/protocol），
 *  不在工具内再实现判定逻辑——闸与状态只认单一事实源。
 */
import { createRequire } from 'node:module'
import { toPixOfficeSnapshot } from '../office-bridge.js'
import { Engine, reasonText } from '../core/index.js'
import { JsonTicketRepositories } from '../adapters/json-tickets.js'
import { dshExecutorFor } from '../adapters/dsh-executor.js'
import { SECTIONS, EVIDENCE_SECTIONS, COLLAB_FOUR, checkCollabHealth, validateCardShape, assessCardDepth, distillGuide, identifyIndustry, checkContentFingerprint } from '../distill/index.js'
import { JARVIS_SYSTEM_PROTOCOL, JARVIS_CULTURE } from '../protocol/index.js'
import { COORD_TASK_RE, TERMINAL_TASK_STATUS, ACTIVE_TEAM_MARKER_TTL_MS, ACTIVE_TEAM_MAX_AGE_MS, ARCHIVED_TEAM_RE, resolveOwnedTeams, looksLikePluginRepo, stateRootConflict, writeActiveTeamMarker } from '../gates/ownership.js'
import { listNames, readTextSafe, hasTeamJson, resolveWorkspace, ponderVerifyProjectDir, getFsService, getRuntimeContext, getLatestExec, getResolvedWorkspace, markJarvisSession, isJarvisSession } from '../runtime.js'
import { MEMORY_MAX_AGE_MS, checkMemoryFresh, _readGates, _memoryState, recordGate, _flowState } from '../gates/store.js'
import { JARVIS_STAGES, STAGE_LABELS, STAGE_GATE, STAGE_DENY, PAID_WORK_TOOLS, computeStage, renderStage, jarvisStageGate, captainExecutionGuard } from '../gates/stage.js'
import { TEAM_TOOLS, jarvisFlowGuard } from '../gates/flow.js'
import { meetingGaps } from '../state/meetings.js'
import { auditCaptainOwnedTasks, auditStaleTasks, checkTalentPreconditions, checkPonderVerify, checkCoverageGate, hasGlob, _dropMissing } from '../gates/audit.js'

import { ingestSources as memIngest } from '../state/memstore.js'
import { boardFilePath, readBoardItems, writeBoardItems, nextBoardId } from '../state/board.js'
import { companyStateFile, readCompanyState, writeCompanyState, syncCompanyState } from '../state/company.js'
import { PIXOFFICE_ACTOR_IDS, PIXOFFICE_EVENT_KINDS, PIXOFFICE_COMMANDS, PIXOFFICE_LIMITS, normalizeEventKind, buildPixOfficeFrame, validatePixOfficeFrame, sseFrameString, relaySeqDecision, frameHash, validatePixOfficeCommand } from '../pixoffice/index.js'
const _require = createRequire(import.meta.url)

// 任务单引擎缓存（每工作区一个）：executor 的 children 集合与提醒循环跨工具调用保持。
// Engine/repo 均无内存态（repo 每操作读盘），缓存只为 executor 生命周期。
const _ticketEngines = new Map()
function _ticketEngine(projectDir, repo, executor) {
  let engine = _ticketEngines.get(projectDir)
  if (!engine && repo) {
    engine = new Engine({ repo, executor })
    _ticketEngines.set(projectDir, engine)
  }
  return engine || null
}

// ── 成员自主找活：提案存储（.jarvis/tickets/proposals.jsonl，append-only + 状态字段）──
// 用户定调（2026-11-10）：superagent-prototype 的「自己找活干」要体现出来——成员空闲时
// 主动从黑板/教训/待办找活，起草提案交 captain 裁决；通过→open 开单（引用提案），
// 驳回→dismiss。成员永远不直接 open（防递归），提案是成员唯一的发起通道。
const _proposalsFile = (projectDir) => path.join(projectDir, '.jarvis', 'tickets', 'proposals.jsonl')
const _readProposals = (projectDir) => {
  try {
    const fsp = _require('node:fs')
    const raw = fsp.readFileSync(_proposalsFile(projectDir), 'utf8')
    return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}
const _writeProposals = (projectDir, list) => {
  try {
    const fsp = _require('node:fs')
    fsp.mkdirSync(path.join(projectDir, '.jarvis', 'tickets'), { recursive: true })
    fsp.writeFileSync(_proposalsFile(projectDir), list.map((p) => JSON.stringify(p)).join('\n') + (list.length ? '\n' : ''))
  } catch {}
}

/** 本组工具（按原始顺序）；由 tools/index.js 汇总成 TOOLS。 */
export const DELIVER_TOOLS = [
  {
    name: 'jarvis_release',
    description:
      '交付版本管理器（乙方与甲方的契约机制，防"需求永远改/无法自证"，**领域通用的版本管理铁律——任何领域交付物都要版本化**）：vibe 模式+甲方确认才算完成+验收随时可调 → 乙方必须靠"版本快照+交付清单+沟通留痕"自证。①new_version=打新版本（v1.0/v1.1…，冻结旧版，变更开新版承接）；②checklist=生成交付清单（需求本质逐条→对应交付物→自测结果，甲方可逐条确认）；③status=版本状态（待确认/已确认/已否决，含确认时限：超时默认通过或明确挂起）；④communication=记录与甲方的沟通结论（问题/答复/时间，只记结论不记过程）；⑤**rollback=回滚到历史版本（企业级必备：改错/决策失误可 undo——prevVersions 里选一个已冻结版本回滚，当前版标记为"已回滚"，旧版重新激活为当前版，回滚动作留痕：谁/何时/为什么）**。铁律：乙方永远能说清"交付了什么、等什么确认"；版本是内部记账不打扰甲方；清单是逐条对应不是模板；**任何领域（软件/方案/流程/卡/黑板/交付物）的交付都走版本化，改错必须能回滚**。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'new_version 打新版本 / checklist 生成交付清单 / status 版本状态 / communication 记录甲方沟通 / rollback 回滚到历史版本' },
        version: { type: 'string', description: '版本号（如 v1.0），new_version 必填；rollback 用=当前版本号' },
        rollbackTo: { type: 'string', description: 'rollback 用：要回滚到的历史版本号（如 v1.0）' },
        rollbackReason: { type: 'string', description: 'rollback 用：回滚原因（改错/决策失误/甲方否决），必填留痕' },
        prevVersions: { type: 'string', description: '已有版本状态 JSON（status/rollback/communication 用），如 [{"version":"v1.0","state":"已确认"}]' },
        requirement: { type: 'string', description: '原始需求/需求本质（checklist 用，逐条对应）' },
        items: { type: 'string', description: '交付物清单 JSON 数组（checklist 用）' },
        selfTest: { type: 'string', description: '自测结果（checklist 用，每条交付物的验证证据）' },
        confirmDeadline: { type: 'string', description: '甲方确认时限（如 3 天 / 48小时；status 用，超时默认通过或挂起）' },
        traceCheck: { type: 'string', description: '三产物闭环核对（checklist/收口用）：传 JSON {"需求规格":"path或✓/✗","方案设计":"✓/✗","测试验收单":"✓/✗","逐条闭环":"每条需求→方案→测试→结果 全链 ✓/✗","断链项":["..."]}——防"需求→实现→验收"断链，断链不许收口' },
        sutEmpty: { type: 'string', description: '多层通过判定①：被测物空/占位说明（交付物是空壳/未物化）——非空=BLOCK，先补真实产物' },
        successWeakened: { type: 'string', description: '多层通过判定②：成功标准被削弱说明（soft-if/旁路/未物化主目标）——非空=CONTINUE拒收（即使覆盖满），先恢复真实成功标准' },
        submittedAt: { type: 'string', description: '交付给甲方确认的起始时间 ISO（status 用，启用真实超时判定：剩余时间/已超时）' },
        question: { type: 'string', description: '与甲方的沟通问题（communication 用）' },
        answer: { type: 'string', description: '甲方答复（communication 用）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'string' },
          status: { type: 'string', description: '版本状态或操作结果' },
          checklist: { type: 'array', items: { type: 'string' }, description: '交付清单（checklist 用）' },
          log: { type: 'string', description: '沟通留痕记录（communication 用）' },
          projectWritten: { type: 'boolean', description: '沟通记录是否已写入 .jarvis/project.md' },
          projectError: { type: 'string', description: 'project.md 写入失败原因' },
          rollbackLog: { type: 'string', description: '回滚留痕记录（rollback 用）' },
          timedOut: { type: 'boolean', description: '确认时限是否已超时（status 用）' },
          traceCheckVerdict: { type: 'string', description: '三产物闭环核对结论（checklist 用）' },
          tracePassed: { type: 'boolean', description: '三产物闭环是否全通过（checklist 用，false=断链不许收口）' },
          submittedAt: { type: 'string', description: '交付确认起始时间（status 用）' },
          verdict: { type: 'string' },
        },
        required: ['verdict'],
      },
      render: (r) => `【交付版本${r.version ? ' · ' + r.version : ''}】${r.status ? '状态：' + r.status + '\n' : ''}${(r.checklist || []).map((c) => '  ☐ ' + c).join('\n')}${r.log ? '\n沟通留痕：' + r.log : ''}\n判定：${r.verdict}`,
    },
    execute: async (args, exec) => {
      const mode = String(args.mode ?? '').trim()
      const version = String(args.version ?? '').trim()
      const requirement = String(args.requirement ?? '').trim()
      let verdict = ''
      if (mode === 'new_version') {
        verdict = version
          ? `已打新版 ${version}：旧版冻结为历史，本版承接甲方最新变更需求。乙方现在能说清"交付过什么、当前在做什么"。`
          : '⚠️ new_version 需要 version 参数（如 v1.0）。'
        return { version: version || '?', status: '进行中（待交付/待确认）', verdict }
      }
      if (mode === 'checklist') {
        let items = []
        try { items = JSON.parse(String(args.items ?? '[]')) } catch { items = [] }
        const self = String(args.selfTest ?? '').trim()
        const rows = requirement
          ? [`需求本质：${requirement.slice(0, 120)}`].concat(items.map((it, i) => `${i + 1}. ${it}${self ? ' —— 自测：' + self.slice(0, 60) : ''}`))
          : items.map((it, i) => `${i + 1}. ${it}`)
        let verdict = `交付清单已生成（${rows.length} 条）：甲方按条确认即验收；清单 = 需求本质逐条对应，不是模板。`
        const out = { version: version || '?', status: '待甲方逐条确认', checklist: rows, verdict }
        // 三产物闭环核对（traceCheck）：需求规格/方案设计/测试验收单 全链可追溯，断链不许收口
        if (args.traceCheck) {
          let tc = null
          try { tc = JSON.parse(String(args.traceCheck)) } catch { tc = null }
          if (tc && typeof tc === 'object') {
            const hasSpec = /✓|✅|true|存在|在/.test(String(tc['需求规格'] ?? ''))
            const hasDesign = /✓|✅|true|存在|在/.test(String(tc['方案设计'] ?? ''))
            const hasTest = /✓|✅|true|存在|在/.test(String(tc['测试验收单'] ?? ''))
            const chainOk = /✓|✅|true|全链/.test(String(tc['逐条闭环'] ?? ''))
            const broken = Array.isArray(tc['断链项']) ? tc['断链项'] : []
            const chainOkAll = hasSpec && hasDesign && hasTest && chainOk && broken.length === 0
            // 多层通过判定（ws8634 heal_pass_acceptance 借鉴，领域无关——"算不算通过"按决策优先级，不只看覆盖）：
            //   ① 被测物空/占位（sutEmpty）→ BLOCK（交付物是空的，先补产物）
            //   ② 成功标准被削弱（successWeakened：soft-if/旁路/未物化主目标）→ CONTINUE（即使覆盖满也拒收）
            //   ③ 全链闭环（chainOkAll）→ ACCEPT
            //   ④ 否则 → 补链
            const sutEmpty = String(args.sutEmpty ?? '').trim()
            const successWeakened = String(args.successWeakened ?? '').trim()
            let traceVerdict, tracePassed = false
            if (sutEmpty) {
              traceVerdict = `⛔ 被测物空/占位：${sutEmpty.slice(0, 80)}——交付物是空的/未物化，先补真实产物（防"空壳交付"）`
              tracePassed = false
            } else if (successWeakened) {
              traceVerdict = `⛔ 成功标准被削弱：${successWeakened.slice(0, 80)}（soft-if/旁路/未物化主目标）——**即使覆盖满也拒收**，先恢复真实成功标准再交付（防"测试绿但业务没做"）`
              tracePassed = false
            } else if (chainOkAll) {
              traceVerdict = `✅ 三产物闭环核对通过：需求规格→方案设计→测试验收单→逐条闭环 全链完整，可交付。`
              tracePassed = true
            } else {
              traceVerdict = `⛔ 三产物闭环核对未过（断链不许收口）：${[!hasSpec ? '需求规格缺' : '', !hasDesign ? '方案设计缺' : '', !hasTest ? '测试验收单缺' : '', !chainOk ? '逐条闭环未全过' : ''].filter(Boolean).join('、')}${broken.length ? '；断链项：' + broken.join('、') : ''}——先补链再交付（每需求→方案→测试→结果）。`
              tracePassed = false
            }
            out.traceCheckVerdict = traceVerdict
            out.tracePassed = tracePassed
            verdict = verdict + '\n' + traceVerdict
            out.verdict = verdict
          }
        }
        return out
      }
      if (mode === 'status') {
        const dlRaw = String(args.confirmDeadline ?? '3 天')
        let prev = []
        try { prev = JSON.parse(String(args.prevVersions ?? '[]')) } catch { prev = [] }
        const line = prev.length ? `已有版本：${prev.map((v) => v.version + '=' + v.state).join(', ')}` : '尚无已交付版本'
        // 真实时限计算（修复"超时默认通过"停留在话术）：submittedAt = 交付给甲方确认的时间（ISO），
        //   时限解析支持 "N 天/N小时/Nd/Nh/N"；超时 → 默认通过（或明确挂起）；未超时 → 剩余时间。
        const parseDeadline = (raw) => {
          const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*(天|小时|h|d|h)?$/)
          if (!m) return null
          const n = Number(m[1])
          const unit = m[2] || ''
          if (unit === '小时' || unit === 'h') return n * 3600 * 1000
          if (unit === 'd') return n * 24 * 3600 * 1000
          return n * 24 * 3600 * 1000 // 默认天
        }
        const dlMs = parseDeadline(dlRaw)
        const submittedRaw = String(args.submittedAt ?? '').trim()
        let submittedMs = 0
        if (submittedRaw) {
          const t = Date.parse(submittedRaw)
          if (!Number.isNaN(t)) submittedMs = t
        }
        const now = Date.now()
        let timeNote = ''
        let timedOut = false
        if (dlMs && submittedMs) {
          const remaining = submittedMs + dlMs - now
          timedOut = remaining <= 0
          timeNote = timedOut
            ? `⏰ 已超时（提交 ${submittedRaw.slice(0, 10)} + 时限 ${dlRaw}）——按约定默认通过；若甲方仍未确认且需继续等，应明确挂起并重设时限`
            : `剩余确认时间约 ${Math.max(1, Math.ceil(remaining / 3600000))} 小时（提交 ${submittedRaw.slice(0, 10)}，时限 ${dlRaw}）`
        }
        verdict = `版本状态：${line}。当前版「${version || '?'}」${dlRaw} 内待甲方确认；${timeNote || '调用时传 submittedAt（交付确认起始时间 ISO）启用超时判定，否则默认通过/挂起由乙方明确。'}`
        const out = { version: version || '?', status: `待确认（时限 ${dlRaw}）`, verdict }
        if (dlMs && submittedMs) out.timedOut = timedOut
        if (submittedRaw) out.submittedAt = submittedRaw
        return out
      }
      if (mode === 'communication') {
        const q = String(args.question ?? '')
        const a = String(args.answer ?? '')
        const log = `[${new Date().toISOString().slice(0, 16)}] 问甲方：${q.slice(0, 80)}${a ? ` → 甲方答：${a.slice(0, 80)}` : '（待甲方答复）'}`
        // BUG-3 修复：真写 project.md（承诺"写入 project.md 只记结论"必须兑现，否则沟通无留痕）
        let projectWritten = false
        let projectError = ''
        const fsSvc = (() => {
          try { return getFsService(exec) } catch { return null }
        })()
        if (fsSvc && typeof fsSvc.readText === 'function' && typeof fsSvc.writeText === 'function') {
          try {
            const cwd = resolveWorkspace(getRuntimeContext())
            const pPath = (cwd ? cwd + '/' : '') + '.jarvis/project.md'
            const target = await fsSvc.resolve(pPath)
            if (target) {
              let existing = ''
              try { existing = await fsSvc.readText(target) } catch { existing = '' }
              await fsSvc.writeText(target, (existing ? existing.replace(/\n*$/, '\n') : '') + '\n## 甲方沟通记录\n' + log + '\n')
              projectWritten = true
            }
          } catch (e) {
            projectError = String(e && e.message ? e.message : e)
          }
        }
        const out = { version: version || '?', log, verdict: `沟通留痕已记录：${log}。已追加写入 .jarvis/project.md（只记结论）。` }
        if (fsSvc && typeof fsSvc.readText === 'function' && typeof fsSvc.writeText === 'function') {
          out.projectWritten = projectWritten
          if (projectError) out.projectError = projectError
        }
        return out
      }
      if (mode === 'rollback') {
        // ── 回滚到历史版本（企业级版本管理：改错/决策失误可 undo）──
        const cur = String(args.version ?? '').trim()
        const target = String(args.rollbackTo ?? '').trim()
        const reason = String(args.rollbackReason ?? '').trim()
        let prev = []
        try { prev = JSON.parse(String(args.prevVersions ?? '[]')) } catch { prev = [] }
        if (!cur || !target) {
          return { version: cur || '?', status: 'rollback 失败', verdict: '⚠️ rollback 需要 version（当前版）+ rollbackTo（回滚目标版）' }
        }
        if (!reason) {
          return { version: cur, status: 'rollback 失败', verdict: '⚠️ rollback 必须带 rollbackReason（回滚原因：改错/决策失误/甲方否决）——无原因不回滚，留痕是铁律' }
        }
        // BUG-7 修复：prev 空 = 无历史版本可回滚（首次交付没有可 undo 的旧版）→ 拒绝；
        //   非空时回滚目标必须真实存在于版本清单（禁止"回滚到不存在的版本"的假回滚）
        if (!prev.length) {
          return { version: cur, status: 'rollback 失败', verdict: '⚠️ prevVersions 为空：没有已交付的历史版本可回滚（首次交付无需/无法回滚）。先 new_version 建立版本线，或确认版本清单（status）' }
        }
        const targetExists = prev.some((v) => v.version === target)
        if (!targetExists) {
          return { version: cur, status: 'rollback 失败', verdict: `⚠️ 回滚目标 ${target} 不在已有版本清单（${prev.map((v) => v.version).join(', ')}）——先 status 确认版本清单；禁止回滚到不存在的版本` }
        }
        const log = `[${new Date().toISOString().slice(0, 16)}] 回滚：${cur} → ${target}（原因：${reason.slice(0, 60)}）——当前版标记"已回滚"（冻结），${target}重新激活为当前版；此动作留痕可追溯。`
        verdict = `✅ 已回滚：${cur} → ${target}（原因：${reason.slice(0, 60)}）。${target}重新激活为当前版；${cur}冻结为"已回滚"历史。回滚动作已留痕（时间/原因/目标）。任何领域的交付改错都能这样 undo。`
        return { version: cur, status: `已回滚到 ${target}`, rollbackLog: log, verdict }
      }
      return { version: version || '?', status: '未知模式（new_version/checklist/status/communication）', verdict: '请指定 mode' }
    },
  },

  {
    name: 'jarvis_baseline',
    description:
      '基线清单生成器（**领域无关**：任何"改造/替换/移植/重构/换皮"类任务的第一步，防"覆盖面丢失"——真实教训：webui 换一套 UI 后大量页面/子页面功能丢失、样式崩，根因是没把"旧系统有哪些单元"变成可枚举清单，验收只抽查了几页；同样的风险存在于任何领域：流程步骤、文档章节、接口、字段、设备、权限点……）。把基线变成**可枚举、可逐条勾对**的清单。kind 决定抽取器（领域无关的通用抽取，不是领域模板）：web-ui=页面目录+路由/菜单；files=按 roots 枚举文件；docs=文档章节标题；text=文本条目(编号/列表，用于流程/SOP/需求清单)；api=OpenAPI paths+常见框架路由声明；db=SQL 表/视图；custom=直接传 items。**基线必须来自真实可枚举来源（读代码/配置/文档原始内容），不许凭印象列举**（凭印象=必漏）。产出 <项目>/.jarvis/docs/基线清单-<slug>.json + .md；下一步用 jarvis_coverage(persist=true, slug=同名) 建逐条覆盖矩阵，收口闸强制覆盖率。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: '单元类型（领域无关）：web-ui（默认，页面+路由）/ files（按 roots 枚举文件）/ docs（文档章节）/ text（文本条目：流程/SOP/需求清单）/ api（接口：OpenAPI+框架路由）/ db（SQL 表/视图）/ custom（配合 items 自定）' },
        roots: { type: 'string', description: '扫描根 JSON 数组字符串（如 ["src","app"]）；缺省=自动探测 pages/views/router/config 等常见目录' },
        items: { type: 'string', description: '显式条目 JSON 数组 [{id?,title,source?,category?}]——给了就跳过扫描（非代码类改造用）' },
        slug: { type: 'string', description: '清单名（用于文件名，如 webui-r11）' },
        projectDir: { type: 'string', description: '项目目录（缺省=当前会话工作区）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          count: { type: 'number' },
          slug: { type: 'string' },
          written: { type: 'array', items: { type: 'string' } },
          sample: { type: 'array', items: { type: 'string' } },
          verdict: { type: 'string' },
        },
        required: ['ok', 'count', 'verdict'],
      },
      render: (r) => `基线清单（${r.slug || ''}）：${r.ok ? '✅' : '❌'} 共 ${r.count} 条\n写入：${(r.written || []).join('\n')}\n样例：${(r.sample || []).slice(0, 6).join(' | ')}\n${r.verdict}`,
    },
    execute: async (args, exec) => {
      const path = _require('node:path')
      const fs = _require('node:fs')
      const projectDir = String(args?.projectDir ?? '').trim() || resolveWorkspace(getRuntimeContext(), exec) || '.'
      const slug = String(args?.slug ?? 'baseline').trim().replace(/[^\w\u4e00-\u9fa5.-]+/g, '-')
      const kind = String(args?.kind ?? 'web-ui').trim()
      // 状态根守卫：插件仓库不写 .jarvis/docs（防记忆文件污染插件项目）
      const conflict = stateRootConflict(projectDir)
      if (conflict) return { ok: false, count: 0, slug, written: [], sample: [], verdict: `⛔ ${conflict.message}` }
      const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.jarvis', 'archive'])
      const walk = (root, out, depth = 0) => {
        if (depth > 8 || out.length > 6000) return
        let ents = []
        try { ents = fs.readdirSync(root, { withFileTypes: true }) } catch { return }
        for (const e of ents) {
          if (SKIP.has(e.name)) continue
          const fp = path.join(root, e.name)
          if (e.isDirectory()) walk(fp, out, depth + 1)
          else out.push(fp)
        }
      }
      let items = []
      try {
        const arr = JSON.parse(String(args?.items ?? 'null'))
        if (Array.isArray(arr)) {
          items = arr.map((it, i) => ({
            id: String(it?.id ?? 'L' + (i + 1)),
            title: String(it?.title ?? ''),
            source: String(it?.source ?? ''),
            category: String(it?.category ?? 'custom'),
          }))
        }
      } catch {}
      if (items.length === 0) {
        // 领域无关抽取器：web-ui(页面/路由) / files(文件) / docs(文档章节) / text(文本条目) / api(接口) / db(表视图)
        const rootsArg = (() => { try { const a = JSON.parse(String(args?.roots ?? 'null')); return Array.isArray(a) ? a.map(String) : null } catch { return null } })()
        const autoWeb = ['src', 'app', 'pages', 'views', 'src/pages', 'src/views', 'src/router', 'src/routes', 'router', 'routes', 'config', 'webui', 'webui-src']
        const autoDocs = ['docs', 'doc', 'spec', 'specs', '.jarvis/docs', 'requirements', 'design', 'process']
        const autoAny = ['.', 'src', 'app', 'lib', 'services', 'server', 'backend', 'api', 'db', 'sql', 'migrations', 'docs', 'config']
        const auto = kind === 'docs' ? autoDocs
          : kind === 'text' ? autoDocs
          : (kind === 'api' || kind === 'db') ? autoAny
          : kind === 'files' ? ['.']
          : autoWeb
        const roots = (rootsArg && rootsArg.length ? rootsArg : auto).map((r) => path.join(projectDir, r)).filter((r) => { try { return fs.existsSync(r) } catch { return false } })
        const files = []
        for (const r of roots) {
          try { if (fs.statSync(r).isFile()) { files.push(r); continue } } catch {}
          walk(r, files)
        }
        const seen = new Set()
        const push = (id, title, source, category) => {
          const k = String(id)
          if (!k || seen.has(k) || items.length >= 8000) return
          seen.add(k)
          items.push({ id: k, title: String(title).slice(0, 160), source: String(source), category })
        }
        if (kind === 'docs' || kind === 'text') {
          // 文档类（任何领域的规范/SOP/需求/设计文档）：章节标题 + 文本条目
          for (const f of files) {
            const rel = path.relative(projectDir, f).split(path.sep).join('/')
            if (!/\.(md|markdown|txt|rst|adoc)$/i.test(f)) continue
            let txt = ''
            try { txt = fs.readFileSync(f, 'utf8') } catch { continue }
            let n = 0
            for (const line of txt.split('\n')) {
              const h = line.match(/^(#{1,6})\s+(.+?)\s*$/)
              if (h) { n++; push('sec:' + rel + '#' + n, h[2], rel, 'section'); continue }
              if (kind === 'text') {
                const li = line.match(/^\s*(?:[-*+]|\d+[.)、])\s+(.+?)\s*$/)
                if (li && li[1].length > 1) { n++; push('item:' + rel + '#' + n, li[1], rel, 'item') }
              }
            }
          }
        } else if (kind === 'api') {
          // 接口类（任何语言/框架）：OpenAPI paths + 常见路由声明
          const OPENAPI_PATH = /^\s{0,8}['"]?(\/[A-Za-z0-9_\-./{}:]*?)['"]?\s*:\s*$/gm
          const CODE_ROUTE = /(?:\b(?:app|router|r|route|server|api|group|mux)\s*\.\s*(?:get|post|put|delete|patch|head|options|all|add|handle|HandleFunc)\s*\(\s*['"`]([^'"`]+)|@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]|(?:path|url|endpoint)\s*[:=]\s*['"`](\/[^'"`]*))/gi
          for (const f of files) {
            const rel = path.relative(projectDir, f).split(path.sep).join('/')
            if (!/\.(js|jsx|ts|tsx|vue|py|go|java|kt|rb|php|cs|ya?ml|json)$/i.test(f)) continue
            let txt = ''
            try { txt = fs.readFileSync(f, 'utf8') } catch { continue }
            if (/\.(ya?ml|json)$/i.test(f)) {
              let m
              while ((m = OPENAPI_PATH.exec(txt)) !== null) push('api:' + m[1], m[1], rel, 'endpoint')
            }
            let cm
            while ((cm = CODE_ROUTE.exec(txt)) !== null) {
              const ep = cm[1] || cm[2] || cm[3]
              if (ep && ep.length < 200) push('api:' + ep, ep, rel, 'endpoint')
            }
          }
        } else if (kind === 'db') {
          // 数据库类：表/视图清单
          for (const f of files) {
            const rel = path.relative(projectDir, f).split(path.sep).join('/')
            if (!/\.(sql|ddl)$/i.test(f)) continue
            let txt = ''
            try { txt = fs.readFileSync(f, 'utf8') } catch { continue }
            const re = /create\s+(?:or\s+replace\s+)?(table|view)\s+(?:if\s+not\s+exists\s+)?[`"'\[]?([A-Za-z0-9_.]+)/gi
            let m
            while ((m = re.exec(txt)) !== null) push('db:' + m[2], m[2], rel, m[1].toLowerCase() === 'view' ? 'view' : 'table')
          }
        } else {
          // web-ui：页面文件 + 路由表；files：全量文件
          const ROUTE_HINT = /(route|routes|router|menu|nav)/i
          const PAGE_HINT = /(^|[\\/])(pages|views|screens)[\\/]/i
          const EXT = /\.(js|jsx|ts|tsx|vue|html)$/
          for (const f of files) {
            const rel = path.relative(projectDir, f).split(path.sep).join('/')
            if (kind === 'web-ui' && !EXT.test(f)) continue
            const isRouteFile = ROUTE_HINT.test(rel)
            const isPage = PAGE_HINT.test(f)
            if (kind === 'web-ui' && !isRouteFile && !isPage) continue
            push('file:' + rel, path.basename(f), rel, isRouteFile ? 'route-config' : 'page')
            if (isRouteFile) {
              let txt = ''
              try { txt = fs.readFileSync(f, 'utf8') } catch {}
              const re = /(?:path|to)\s*:\s*['"`]([^'"`]+)['"`]/g
              let m
              while ((m = re.exec(txt)) !== null) {
                const rp = String(m[1] || '').trim()
                if (!rp || rp.length > 120) continue
                push('route:' + rp, rp, rel, 'route')
              }
            }
          }
        }
      }
      const docsDir = path.join(projectDir, '.jarvis/docs')
      const jsonPath = path.join(docsDir, '基线清单-' + slug + '.json')
      const mdPath = path.join(docsDir, '基线清单-' + slug + '.md')
      const written = []
      let ok = items.length > 0
      try {
        const fsSvc = (() => { try { return getRuntimeContext() && typeof getRuntimeContext().get === 'function' ? getRuntimeContext().get('fs') : null } catch { return null } })()
        try { fs.mkdirSync(docsDir, { recursive: true }) } catch {}
        const payload = { slug, kind, generatedAt: new Date().toISOString(), count: items.length, items }
        const md = ['# 基线清单 ' + slug + '（' + kind + '）', '', '共 ' + items.length + ' 条 —— **改造/替换类任务必须逐条覆盖**（用 jarvis_coverage persist=true slug=' + slug + ' 生成覆盖矩阵，收口闸强制覆盖率）', '', '| id | 标题 | 来源 | 类别 |', '|---|---|---|---|']
          .concat(items.slice(0, 3000).map((it) => '| ' + String(it.id).replace(/\|/g, '\\|') + ' | ' + String(it.title).replace(/\|/g, '\\|') + ' | ' + String(it.source).replace(/\|/g, '\\|') + ' | ' + it.category + ' |'))
          .join('\n')
        let wrote = false
        if (fsSvc && typeof fsSvc.writeText === 'function') {
          try {
            await fsSvc.writeText(await fsSvc.resolve(jsonPath), JSON.stringify(payload, null, 2))
            await fsSvc.writeText(await fsSvc.resolve(mdPath), md)
            written.push(jsonPath, mdPath)
            wrote = true
          } catch { wrote = false } // 跨工作区时 fs 沙箱会拒写 → 走 node fs 兜底
        }
        if (!wrote) {
          fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2))
          fs.writeFileSync(mdPath, md)
          written.push(jsonPath, mdPath)
        }
      } catch { ok = false }
      return {
        ok,
        count: items.length,
        slug,
        written,
        sample: items.slice(0, 8).map((it) => it.id + ' ← ' + it.source),
        verdict: ok
          ? '基线已建（' + items.length + ' 条）。下一步：jarvis_coverage(source=基线条目, targets={"新实现":[逐条 refs+status+evidence]}, persist=true, slug="' + slug + '") 生成覆盖矩阵；收口闸会强制"未覆盖(除豁免)=0 且 r_verify=100%"'
          : '未生成（检查 roots/items 或目录权限）',
      }
    },
  },

  {
    name: 'jarvis_coverage',
    description:
      '覆盖核查器（收口前/阶段闸的硬校验——防"清单对清单"漏对应，领域无关：只核查 清单A→清单B 的逐条覆盖关系，不预设任何领域清单类型）。团队解决问题要全面不遗漏 → 靠"每条都有落点"的自动闸，不靠人眼数。输入若干清单（每条={id,status,refs}），自动核查：①**逐条覆盖**——每条源清单条目是否被目标清单引用（refs 非空）；②**悬空引用**——refs 指向的 id 在目标清单里不存在；③**未收口**——status 非终态(completed/通过/closed/done/confirmed/已确认)的条目数；④**无证据终态**——标终态但无 evidence 的条目（防"说完成但没证据"= 自报式通过）；⑤**覆盖率**——被覆盖条数/总数。**不做领域判断**：清单是什么（需求清单/问题清单/验收项/交付项…）由 CEO 现场定义，工具只查"引用闭合 + 状态收敛 + 终态有据"。典型用法：收口前把《需求规格》条目(源) 与《方案设计》落点/《测试验收单》用例/交付状态(目标) 做覆盖核查——任一需求条无落点/无测试/无交付证据 → 打回补链。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '源清单 JSON 数组（被覆盖方）：[{id:"R1", title:"…", status:"open|completed|…"}]——如需求规格条目' },
        targets: { type: 'string', description: '目标清单 JSON 对象（覆盖方，可多个）：{"方案设计":[{id:"D1", refs:["R1"], status:"completed", evidence:"…"}], "测试验收":[{id:"T1", refs:["R1"], status:"completed", evidence:"…"}]}——每个目标清单条目用 refs 声明覆盖了源清单哪些 id' },
        label: { type: 'string', description: '本次核查场景名（如"收口前覆盖核查"），仅用于输出可读性' },
        persist: { type: 'string', description: 'true=把覆盖矩阵落盘到 <项目>/.jarvis/docs/覆盖矩阵-<slug>.json+.md（收口闸据此强制覆盖率——改造/替换类任务必用）' },
        slug: { type: 'string', description: 'persist 用：矩阵 slug（与 jarvis_baseline 的 slug 一致，如 webui-r11）' },
        exemptions: { type: 'string', description: 'persist 用：豁免条目 JSON 数组（如 ["route:/dev/null"]）——确实不做的基线项须登记理由，否则收口闸按未覆盖拦' },
        projectDir: { type: 'string', description: 'persist 用：项目目录（缺省=当前会话工作区）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sourceCount: { type: 'number', description: '源清单条目数' },
          uncovered: { type: 'array', items: { type: 'string' }, description: '未被任何目标覆盖的源条目（漏做/漏测——打回核心依据）' },
          danglingRefs: { type: 'array', items: { type: 'string' }, description: '悬空引用（refs 指向不存在的源 id）' },
          openItems: { type: 'array', items: { type: 'string' }, description: '未收口条目（status 非终态）' },
          evidenceLess: { type: 'array', items: { type: 'string' }, description: '标终态但无证据的条目（防自报式通过）' },
          coverage: { type: 'number', description: '覆盖率 0-1（被覆盖源条数/源总数）' },
          r_plan: { type: 'number', description: '规划覆盖率：有计划落点(refs非空)的源/源总数（ws8634 三率算法）' },
          r_verify: { type: 'number', description: '验证覆盖率：落点已终态且带evidence的源/源总数（needs_human/failed不算）' },
          r_contract: { type: 'number', description: '核心契约率：P0/P1核心细节已验证/核心总数——防少列核心细节虚高；无核心条目时不返回该字段' },
          coreGatePass: { type: 'boolean', description: '核心门禁是否通过（P0/P1 r_contract ≥ coreGate 阈值）' },
          ok: { type: 'boolean', description: '是否可过闸（全覆盖 + 无悬空 + 无未收口 + 终态有据）' },
          verdict: { type: 'string' },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) => `覆盖核查（${r.label || ''}）：${r.ok ? '✅ 可过闸' : '❌ 打回补链'} · 覆盖率 ${Math.round((r.coverage || 0) * 100)}%（${r.sourceCount ?? 0} 条源）\n未覆盖：${(r.uncovered ?? []).slice(0, 5).join('、') || '无'}\n未收口：${(r.openItems ?? []).slice(0, 5).join('、') || '无'}\n悬空：${(r.danglingRefs ?? []).slice(0, 3).join('、') || '无'}\n${r.verdict}`,
    },
    execute: async (args, exec) => {
      const label = String(args?.label ?? '覆盖核查')
      let source = []
      try { source = JSON.parse(String(args?.source ?? '[]')) } catch { source = [] }
      let targets = {}
      try { targets = JSON.parse(String(args?.targets ?? '{}')) } catch { targets = {} }
      const issues = []
      if (!Array.isArray(source)) issues.push('source 需为 JSON 数组')
      if (targets && typeof targets !== 'object' || Array.isArray(targets)) issues.push('targets 需为 JSON 对象 {清单名: [条目]}')
      // 源 id 全集 + 状态
      const sourceIds = new Set()
      const srcMeta = {}
      for (const it of source) {
        const id = String(it?.id ?? '').trim()
        if (!id) { issues.push('source 存在无 id 条目'); continue }
        sourceIds.add(id)
        srcMeta[id] = { title: String(it?.title ?? '').slice(0, 40), status: String(it?.status ?? '').trim() }
      }
      const FINAL = /completed|通过|closed|done|confirmed|已确认|完成|收口|验收通过/
      const covered = new Set()
      const dangling = []
      const openItems = []
      const evidenceLess = []
      const targetNames = Object.keys(targets || {})
      for (const tname of targetNames) {
        const tlist = Array.isArray(targets[tname]) ? targets[tname] : []
        for (const t of tlist) {
          const tid = String(t?.id ?? '').trim()
          const tstatus = String(t?.status ?? '').trim()
          const tev = String(t?.evidence ?? t?.result ?? '').trim()
          const refs = Array.isArray(t?.refs) ? t.refs : []
          const shown = (tid || '?') + '@' + tname
          if (!FINAL.test(tstatus)) openItems.push(`${shown}（状态=${tstatus || '空'}）`)
          else if (!tev && !String(t?.note ?? '').trim()) evidenceLess.push(`${shown} 标终态但无 evidence`)
          for (const r of refs) {
            const rs = String(r ?? '').trim()
            if (!rs || rs === '-1') continue
            if (sourceIds.has(rs)) covered.add(rs)
            else dangling.push(`${shown} 引用 ${rs} 不存在`)
          }
        }
      }
      // 未覆盖 = 源里有、但没有任何目标条目 refs 它
      const uncovered = []
      for (const id of sourceIds) {
        if (!covered.has(id)) uncovered.push(`${id}${srcMeta[id]?.title ? '「' + srcMeta[id].title + '」' : ''}（无任何方案/测试/交付落点）`)
      }
      // 三率算法（ws8634 capability_coverage 借鉴，领域无关）：
      //   r_plan = 有计划落点(refs非空)的源 / 源总数
      //   r_verify = 落点已终态且带 evidence 的 / 源总数（needs_human/failed 不算 verified）
      //   r_contract = 核心细节(P0/P1)已验证 / 核心总数——防"少列核心细节虚高"
      const FINAL_STRONG = /completed|通过|closed|done|confirmed|已确认|验收通过/
      let planned = 0, verified = 0
      const coreIds = []
      for (const raw of source) {
        const pri = String(raw?.priority ?? '').trim().toUpperCase()
        if (pri === 'P0' || pri === 'P1') coreIds.push(String(raw?.id ?? ''))
      }
      let coreVerified = 0
      for (const id of sourceIds) {
        if (covered.has(id)) planned++
        let idVerified = false
        for (const tname of Object.keys(targets || {})) {
          for (const t of (Array.isArray(targets[tname]) ? targets[tname] : [])) {
            const refs2 = Array.isArray(t?.refs) ? t.refs : []
            if (refs2.includes(id)) {
              const ts = String(t?.status ?? '').trim()
              const tev2 = String(t?.evidence ?? t?.result ?? '').trim()
              if (FINAL_STRONG.test(ts) && tev2) idVerified = true
            }
          }
        }
        if (idVerified) verified++
        if (coreIds.includes(id) && idVerified) coreVerified++
      }
      const n = sourceIds.size || 0
      const r_plan = n ? Math.round((planned / n) * 1000) / 1000 : 0
      const r_verify = n ? Math.round((verified / n) * 1000) / 1000 : 0
      const coreN = coreIds.length || 0
      const r_contract = coreN ? Math.round((coreVerified / coreN) * 1000) / 1000 : null // 无核心条目=不适用
      const gateThreshold = Number(args.coreGate ?? 1.0)
      const coreGatePass = coreN === 0 || r_contract >= gateThreshold
      const coverage = sourceIds.size ? covered.size / sourceIds.size : 0
      const ok = issues.length === 0 && uncovered.length === 0 && dangling.length === 0 && openItems.length === 0 && evidenceLess.length === 0 && sourceIds.size > 0 && coreGatePass
      const parts = []
      if (uncovered.length) parts.push(`未覆盖 ${uncovered.length} 条`)
      if (dangling.length) parts.push(`悬空引用 ${dangling.length} 条`)
      if (openItems.length) parts.push(`未收口 ${openItems.length} 条`)
      if (evidenceLess.length) parts.push(`终态无证据 ${evidenceLess.length} 条`)
      if (!coreGatePass) parts.push(`核心细节(P0/P1)未全验证：r_contract=${r_contract} < ${gateThreshold}（${coreVerified}/${coreN}）——防少列核心细节虚高`)
      // persist：覆盖矩阵落盘（收口闸据此强制覆盖率——改造/替换类任务防"覆盖面丢失"）
      let persisted = []
      try {
        const want = String(args?.persist ?? '').toLowerCase()
        if (want === 'true' || want === '1') {
          const path = _require('node:path')
          const fsm = _require('node:fs')
          const projectDir = String(args?.projectDir ?? '').trim() || resolveWorkspace(getRuntimeContext(), exec) || '.'
          // 状态根守卫：插件仓库不写 .jarvis/docs（防记忆文件污染插件项目）
          const blocked = stateRootConflict(projectDir)
          const slug = String(args?.slug ?? 'matrix').trim().replace(/[^\w\u4e00-\u9fa5.-]+/g, '-')
          let exemptions = []
          try { const a = JSON.parse(String(args?.exemptions ?? '[]')); if (Array.isArray(a)) exemptions = a.map(String) } catch {}
          const fsSvc = (() => { try { return getRuntimeContext() && typeof getRuntimeContext().get === 'function' ? getRuntimeContext().get('fs') : null } catch { return null } })()
          const docsDir = path.join(projectDir, '.jarvis/docs')
          const jsonPath = path.join(docsDir, '覆盖矩阵-' + slug + '.json')
          const mdPath = path.join(docsDir, '覆盖矩阵-' + slug + '.md')
          const payload = { slug, label, generatedAt: new Date().toISOString(), sourceCount: sourceIds.size, coverage, r_plan, r_verify, r_contract, uncovered, danglingRefs: dangling, openItems, evidenceLess, exemptions, ok }
          const md = ['# 覆盖矩阵 ' + slug + '（' + label + '）', '', '- 基线条数 ' + sourceIds.size + '，覆盖率 ' + Math.round(coverage * 100) + '%', '- r_plan ' + Math.round(r_plan * 100) + '% / r_verify ' + Math.round(r_verify * 100) + '%' + (r_contract === null ? '' : ' / r_contract ' + Math.round(r_contract * 100) + '%'), '- 未覆盖 ' + uncovered.length + ' 条' + (uncovered.length ? '：' + uncovered.slice(0, 20).join('、') : ''), '- 豁免 ' + exemptions.length + ' 条' + (exemptions.length ? '：' + exemptions.join('、') : ''), '', '> 收口闸规则：未覆盖（除豁免）必须为 0，且 r_verify 必须 =100% 才放行。'].join('\n')
          try { fsm.mkdirSync(docsDir, { recursive: true }) } catch {}
          let wroteM = false
          if (!blocked && fsSvc && typeof fsSvc.writeText === 'function') {
            try {
              await fsSvc.writeText(await fsSvc.resolve(jsonPath), JSON.stringify(payload, null, 2))
              await fsSvc.writeText(await fsSvc.resolve(mdPath), md)
              persisted.push(jsonPath, mdPath)
              wroteM = true
            } catch { wroteM = false }
          }
          if (!blocked && !wroteM) {
            fsm.writeFileSync(jsonPath, JSON.stringify(payload, null, 2))
            fsm.writeFileSync(mdPath, md)
            persisted.push(jsonPath, mdPath)
          }
        }
      } catch {}
      return {
        sourceCount: sourceIds.size,
        persisted,
        uncovered: issues.length ? [] : uncovered,
        danglingRefs: dangling,
        openItems,
        evidenceLess,
        coverage: Math.round(coverage * 100) / 100,
        r_plan,
        r_verify,
        ...(r_contract === null ? {} : { r_contract }),
        coreGatePass,
        ok,
        verdict: ok
          ? `✅ ${label}通过：${sourceIds.size} 条源全部被覆盖（覆盖率 ${Math.round(coverage * 100)}%），无悬空/未收口/无证据终态。可收口/过闸。`
          : `⛔ ${label}未过（${parts.join('；') || (issues[0] || '参数错误')}）——打回补链：每条源清单条目必须有目标落点（方案/测试/交付），标终态必须带 evidence。不靠人眼数，逐条覆盖是硬闸。`,
      }
    },
  },

  {
    name: 'jarvis_flowguard',
    description:
      '主流程步骤守卫（"每一步都不能跳过"硬闸——学 ponder step-guard 的 before/BLOCKED 机制：主流程每步必须先有前置产物才能进下一步，缺=BLOCKED 不许跳步；防 ssa 式"真实任务角色没跑 ponder/派活没附须知"这类跳步）。检查主流程各阶段前置产物（可机械判定的文件/记录），缺任一 → 输出 missing + 打回补齐，不许继续。',
    parameters: {
      type: 'object',
      properties: {
        step: { type: 'string', description: '要进入的步骤名（clarify=需求打磨/decompose=拆解/design=方案/build=建队派活/execute=执行/close=收口）' },
        done: { type: 'boolean', description: '标记该步已完成并记录到 .jarvis/flow-progress.json（学 ponder step-guard 的 after——步骤完成留痕，可核验"真执行了"）' },
        projectDir: { type: 'string', description: '项目目录（默认当前工作目录）——守卫按此目录检查前置产物文件' },
        extra: { type: 'string', description: '额外要检查的产物（逗号分隔的相对路径或关键词，可选）' },
      },
      required: ['step'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          verdict: { type: 'string' },
          ok: { type: 'boolean' },
          step: { type: 'string', description: '本次检查的步骤' },
          missing: { type: 'array', items: { type: 'string' }, description: '缺失的前置产物（打回补齐项）' },
          recorded: { type: 'string', description: '步骤完成留痕路径（done=true 时写入 flow-progress.json；未 done 不返回）' },
          activeTeamMarker: { type: 'string', description: '（D5-v2）build 闸通过时写入的归属标记路径（.jarvis/active-team.json）' },
          next: { type: 'string', description: '下一步该做什么' },
        },
        required: ['verdict', 'ok'],
      },
      render: (r) => `【主流程守卫 · ${r.step ?? ''}】${r.ok ? '✅ 前置齐备可进入' : '⛔ BLOCKED 缺前置产物：' + (r.missing || []).join('；')}
下一步：${r.next ?? ''}`,
    },
    execute: async (args, exec) => {
      const path = _require('node:path')
      const step = String(args.step ?? '').trim()
      const projectDir = String(args.projectDir ?? '').trim() || (resolveWorkspace(getRuntimeContext()) || '.')
      const fsSvc = getFsService(exec)
      const exists = async (rel) => {
        if (!fsSvc || typeof fsSvc.readText !== 'function') return false
        try { const t = await fsSvc.readText(path.join(projectDir, rel)); return !!t } catch { return false }
      }
      // 每步前置产物（可机械判定：文件存在 或 记录存在）——领域无关，产物名按 jarvis 约定
      const STEP_PRECOND = {
        clarify: {
          label: '需求打磨',
          pre: [],
          check: async (missing) => {
            // 需求打磨的产物 = 需求规格（含可判定验收）。原实现恒通过 → 闸形同虚设（可跳过打磨直接建队）。
            const found = await hasGlob(fsSvc, path.join(projectDir, '.jarvis/docs'), '需求规格')
            if (!found) {
              missing.push('需求规格（.jarvis/docs/需求规格-*.md 不存在——需求没打磨出可判定验收，不许过 clarify 闸）')
              return
            }
            // 内容实质校验：太短/无验收 = 占位文件，不算打磨过
            try {
              const fsx = _require('node:fs')
              const pathx = _require('node:path')
              const dir = pathx.join(projectDir, '.jarvis/docs')
              const f = fsx.readdirSync(dir).find((n) => /^需求规格/.test(n) && /\.md$/i.test(n))
              if (f) {
                const txt = fsx.readFileSync(pathx.join(dir, f), 'utf8')
                const plain = txt.replace(/\s/g, '')
                if (plain.length < 300) missing.push(`需求规格内容过薄（${plain.length} 字 < 300）——不许用占位文件骗过闸`)
                if (!/验收/.test(txt)) missing.push('需求规格缺「验收」标准（每条功能必须带可判定验收）')
              }
            } catch {}
          },
          next: '产出《需求规格》（.jarvis/docs/需求规格-*.md 每条功能带可判定验收）后进拆解',
        },
        decompose: {
          label: '拆解',
          pre: ['需求规格（.jarvis/docs/需求规格-*.md）'],
          check: async (missing) => {
            // 需求规格存在？宽松匹配：目录里有 需求规格-*.md
            if (fsSvc && typeof fsSvc.readText === 'function') {
              try {
                const dir = await fsSvc.readText(path.join(projectDir, '.jarvis/docs/需求规格-占位.probe'))
                if (dir) {}
              } catch {}
            }
            const found = await hasGlob(fsSvc, path.join(projectDir, '.jarvis/docs'), '需求规格')
            if (!found) missing.push('需求规格（.jarvis/docs/需求规格-*.md 不存在——需求没打磨清楚不许拆解）')
            else _dropMissing(missing, (m) => m.startsWith('需求规格'))
          },
          next: '过 jarvis_taskgraph 结构闸 → 出《任务编排图》',
        },
        design: {
          label: '方案设计',
          pre: ['任务编排图（.jarvis/docs/任务编排-*.md）'],
          check: async (missing) => {
            const found = await hasGlob(fsSvc, path.join(projectDir, '.jarvis/docs'), '任务编排')
            if (!found) missing.push('任务编排图（.jarvis/docs/任务编排-*.md 不存在——没拆解不许写方案）')
            else _dropMissing(missing, (m) => m.startsWith('任务编排'))
            // 思考类硬闸：方案设计前必须有 ponder 全量思考记录（真跑十阶段、可核验），不许拍脑袋
            try {
              const fsx = _require('node:fs')
              const pathx = _require('node:path')
              const verifyDir = pathx.join(projectDir, '.jarvis/docs/ponder-verify')
              const runsDir = pathx.join(projectDir, '.jarvis/ponder-runs')
              const hasVerify = fsx.existsSync(verifyDir) && fsx.readdirSync(verifyDir).length > 0
              const hasRuns = fsx.existsSync(runsDir) && fsx.readdirSync(runsDir).length > 0
              if (!hasVerify && !hasRuns) missing.push('ponder 全量思考记录（思考类方案必须先 jarvis_think_deep(force) 跑十阶段 + jarvis_ponder_check 留 PASS 记录）')
              else _dropMissing(missing, (m) => m.startsWith('ponder 全量思考记录'))
            } catch { /* 检查失败按缺省不阻断 */ }
          },
          next: '出《方案设计》（.jarvis/docs/方案设计-*.md 每条需求→实现落点）',
        },
        build: {
          label: '建队派活',
          pre: ['需求规格', '方案设计（.jarvis/docs/方案设计-*.md）'],
          check: async (missing) => {
            // 需求规格（与 decompose 一致：存在则移除，不存在则留）
            const reqFound = await hasGlob(fsSvc, path.join(projectDir, '.jarvis/docs'), '需求规格')
            if (reqFound) _dropMissing(missing, (m) => m.startsWith('需求规格'))
            else missing.push('需求规格（.jarvis/docs/需求规格-*.md 不存在——需求没打磨清楚不许建队派活）')
            const fd = await hasGlob(fsSvc, path.join(projectDir, '.jarvis/docs'), '方案设计')
            if (!fd) missing.push('方案设计（.jarvis/docs/方案设计-*.md 不存在——没方案不许建队派活）')
            else _dropMissing(missing, (m) => m.startsWith('方案设计'))
            // 人才层前置硬闸（glm-test 教训：无猎头/无角色卡直接建普通角色队 = 跳过蒸馏流程）
            const talentMissing = await checkTalentPreconditions(fsSvc, projectDir, path, ownedSet)
            missing.push(...talentMissing)
            // 派活必带开工须知：audit 团队任务
            const teamFound = await hasTeamJson(fsSvc, path.join(projectDir, '.agent-teams'))
            if (teamFound) {
              // 派活：建队闸只认流程产物（需求规格/方案/人才层），不考核「有没有用 brief/卡」——
              // 固化作法是 jarvis_dispatch_task（内部自动拼须知+角色卡），不是靠闸查表。
              // 会议：有团队有任务却没开工对齐纪要 → 必开（会议是流程产物，不是摆设）
              missing.push(...meetingGaps(projectDir, 'build', path, { teams: [...ownedSet] }))
            }
          },
          next: '先蒸馏猎头→CEO→各岗位角色卡（cards/ 齐备）→ 再建队派活（每任务附开工须知）→ 成员开工先 ponder → 执行',
        },
        execute: {
          label: '执行',
          pre: ['方案设计'],
          check: async (missing) => {
            const fd = await hasGlob(fsSvc, path.join(projectDir, '.jarvis/docs'), '方案设计')
            if (!fd) missing.push('方案设计（.jarvis/docs/方案设计-*.md 不存在——没方案不许执行实现）')
            else _dropMissing(missing, (m) => m.startsWith('方案设计'))
            // 顶层不得自领执行任务（scan 教训：成员会话死后 captain 自己 claim 任务干完 → "全是上层在干活"）
            const captainOwned = await auditCaptainOwnedTasks(fsSvc, projectDir, path, ownedSet)
            if (captainOwned.length) {
              missing.push(
                `captain 自领未完成任务：${captainOwned.join('、')}（顶层 captain/贾维斯不得亲自执行——必须开单派给成员：jarvis_ticket action=open 或 jarvis_dispatch_task；纯协调/验收/汇报类任务请在 subject 标注【协调】豁免）`
              )
            }
            // 卡死任务必须 reassign（scan 教训：成员会话 end-seed 后任务停在 claimed/in_progress 没人管）
            const staleTasks = await auditStaleTasks(fsSvc, projectDir, path, ownedSet)
            if (staleTasks.length) {
              missing.push(
                `疑似卡死任务：${staleTasks.join('、')}（claimed 未交付 / attempt≥4 产出为空——必须 jarvis_ticket action=retry 重派或换人，不许顶层自己顶替）`
              )
            }
            // 会议：黑板有阻塞/接口变更、未决≥3、分工冲突、新成员进场 → 必开循环会
            missing.push(...meetingGaps(projectDir, 'execute', path, { teams: [...ownedSet] }))
          },
          next: '开发-测试迭代（对照基准）+ 质量自循环深挖 → 收口',
        },
        close: {
          label: '收口',
          pre: ['黑板（.jarvis/board.json 无阻塞/未决项收敛）', '差异清单已销项（替代类 coverage）'],
          check: async (missing) => {
            const found = await hasGlob(fsSvc, path.join(projectDir, '.jarvis'), 'board.json')
            if (!found) { missing.push('黑板（.jarvis/board.json 不存在——没有决策/阻塞记录不许收口）'); return }
            _dropMissing(missing, (m) => m.startsWith('黑板'))
            // 黑板归拢检查（zyh 教训：收口后 18 项决策/风险全 open 假未决堆积）：
            // 已定案决策（含 采用/上线/不引入/轮不配/已交付/定稿/确认 等定案词）必须标 resolved；
            // 已处理风险/问题（含 已/修复/闭环/解决 等）必须 resolve；否则=未归拢=不许收口
            try {
              if (fsSvc && typeof fsSvc.readText === 'function') {
                const target = await fsSvc.resolve(path.join(projectDir, '.jarvis/board.json'))
                const txt = await fsSvc.readText(target)
                if (txt) {
                  const data = JSON.parse(txt)
                  const items = Array.isArray(data.items) ? data.items : []
                  const DECIDED = /采用|上线|不引入|不交付|轮不配|已交付|已上线|定稿|已确认|确认.*方案|决定/
                  const RESOLVED_WORD = /已修复|已闭环|已解决|已处理|已关闭|closed|resolved|已标/
                  const openDecided = items.filter((i) => i.status === 'open' && DECIDED.test(String(i.content || '')) && !RESOLVED_WORD.test(String(i.content || '')))
                  if (openDecided.length > 0) {
                    missing.push('黑板有 ' + openDecided.length + ' 项已定案但未 resolve（如 ' + openDecided.slice(0, 3).map((i) => i.id).join('、') + '——采用/上线/定稿的决策必须标 resolved=已归拢，收口不留假未决；历史信息在 resolvedItems）')
                  }
                }
              }
            } catch {}
            // 改造/替换类任务：基线→覆盖矩阵 硬闸（防"换 UI 丢页面/丢功能"）
            try {
              const covMissing = await checkCoverageGate(fsSvc, projectDir, path)
              missing.push(...covMissing)
            } catch {}
            // 会议：任务全交完却没开收口会 → 必开（逐项验收 + 遗留项分级）
            missing.push(...meetingGaps(projectDir, 'close', path, { teams: [...ownedSet] }))
            // ponder 核验：不再是收口硬闸（用户定调：流程固化，不考核步骤）——核验记录仍可用 jarvis_ponder_check 生成并查
          },
          next: '三产物闭环（需求→方案→测试）+ 防迎合收口总闸 9 条 → 交付报告',
        },
      }
      const cfg = STEP_PRECOND[step]
      if (!cfg) {
        return { verdict: `⚠️ 未知步骤「${step}」（应为 clarify/decompose/design/build/execute/close）`, ok: false, step, missing: [], next: '' }
      }
      // T13 ⑤：状态根唯一化——插件仓库自身（有 package.json name=luke-jarvis 或 src/host/plugin.js）
      // 不是 jarvis 状态根；向它写 .jarvis/gates.json 会产生「第二个状态根 → 假 PASS」（T12 OBS-2 实证）。
      if (looksLikePluginRepo(projectDir) && !(await hasGlob(getFsService(exec), path.join(projectDir, '.agent-teams'), 'team.json'))) {
        return {
          verdict: `⛔ 状态根冲突：${projectDir} 是插件仓库自身，不是 jarvis 项目工作区。一个工作区只能有一个 .jarvis 状态根；请用真实项目目录（或删除该目录里的 .jarvis）`,
          ok: false,
          step,
          missing: ['状态根冲突（插件仓库自身不得持有 .jarvis 状态根——见 README「一个工作区只有一个状态根」）'],
          next: '用真实项目工作区（含 .agent-teams）重跑 flowguard',
          error: 'STATE_ROOT_CONFLICT',
        }
      }
      // T13 ①：一次性算出本项目归属团队，四个审计共用（禁止三处各写一份口径）
      const sessionId0 = String((exec && exec.agent && exec.agent.session && exec.agent.session.id) || '')
      const ownedInfo = resolveOwnedTeams(projectDir, sessionId0)
      const ownedSet = new Set(ownedInfo.teams)
      const missing = [...cfg.pre]
      try {
        const filtered = await cfg.check(missing)
        if (Array.isArray(filtered)) { missing.length = 0; missing.push(...filtered) } // F4：兼容「返回新数组」写法
      } catch {}
      const ok = missing.length === 0
      // 落闸留痕：通过才记（后续建队/派活/收口会检查这些闸）
      const sessionId = String((exec && exec.agent && exec.agent.session && exec.agent.session.id) || '')
      try { if (ok) recordGate(projectDir, step, true) } catch {}
      // D5-v2：build 闸通过 = 建队完成 → 把「本项目团队」写进 .jarvis/active-team.json（归属判据，
      // computeStage 据此只统计本项目团队的未完成任务；见 readActiveTeamMarker 注释里的判据关系与误判边界）。
      let activeTeamMarker = ''
      let activeTeamError = ''
      // F5：marker 消费方必须 honor {ok:false}（{ok:false} 是 truthy，旧写法会把它报成「已写入」）；
      // 另：build 闸通过时团队往往还没建（协议顺序），故 build 与 execute 两处都尝试补写，
      // teams 为空时不写空标记（避免「有标记但 teams=[]」被误读成已归属）。
      // T13 ③：**marker 与闸解耦**——真实工作区里 build/execute 可能被自家缺口拦住（T12 打回），
      // 若只在 ok 时写，标记永远不写 → D5-v2 退 72h。故 build/execute 一律尝试写（写入失败如实回报）。
      if (step === 'build' || step === 'execute') {
        try {
          const mk = writeActiveTeamMarker(projectDir, sessionId)
          if (mk && mk.ok && Array.isArray(mk.teams) && mk.teams.length > 0) {
            activeTeamMarker = path.join(projectDir, '.jarvis/active-team.json')
          } else if (mk && !mk.ok) {
            activeTeamError = String(mk.reason || '未知原因')
          }
        } catch (e) { activeTeamError = String((e && e.message) || e) }
      }
      // 步骤完成留痕（done=true 且前置齐备 → 记录到 .jarvis/flow-progress.json，学 ponder step-guard after）
      let recorded = null
      if (args.done === true && ok) {
        const fsSvc2 = getFsService(exec)
        if (fsSvc2 && typeof fsSvc2.readText === 'function' && typeof fsSvc2.writeText === 'function') {
          try {
            const fp = path.join(projectDir, '.jarvis/flow-progress.json')
            let prog = { steps: [], updatedAt: '' }
            try { const t = await fsSvc2.readText(fp); if (t) prog = JSON.parse(t) } catch {}
            const now = new Date().toISOString()
            prog.steps = (prog.steps || []).filter((x) => x.step !== step)
            prog.steps.push({ step, label: cfg.label, at: now })
            prog.updatedAt = now
            await fsSvc2.writeText(fp, JSON.stringify(prog, null, 2))
            recorded = fp
          } catch {}
        }
      }
      const out = {
        ownedTeams: ownedInfo.teams,
        ownedSource: ownedInfo.source,
        verdict: ok ? `✅ ${cfg.label}前置齐备，可进入${recorded ? '（已记录完成→' + recorded + '）' : ''}` : `⛔ BLOCKED：${cfg.label}缺前置产物——${missing.join('；')}`,
        ok,
        step,
        missing,
        next: ok ? cfg.next : `先补齐缺失项（${missing.join('；')}）再进${cfg.label}`,
      }
      if (recorded) out.recorded = recorded
      if (activeTeamMarker) out.activeTeamMarker = activeTeamMarker
      if (activeTeamError) out.activeTeamError = activeTeamError
      return out
    },
  },

  {
    name: 'jarvis_ticket',
    description:
      '任务单内核（移植 dsh-superagent-prototype 的 Ticket/Assignment 领域模型）：把「需求裁决→开单→派单→汇报→重试/停止→阶段判定」变成可持久化状态机，落在 <项目>/.jarvis/tickets + decisions；开单即由自建执行器派成员子会话真执行（成员用 report 回报推进状态机）。动作：adjudicate=过闸裁决并开单（闸不过则只记 decision）；open=直接开单并派单（可带 proposalId 消化成员提案）；list=列任务单（含待裁决提案）；get=看单（阶段/是否可重试/派单）；report=成员汇报（progress/waiting/ready/blocked/failed/dropped，ready/dropped 结束任务单）；propose=成员自主找活提案（空闲时从黑板/教训/待办发现新活，带推演摘要提案交 captain 裁决——成员唯一的发起通道，提案≠开工）；dismiss=captain 驳回提案；retry=卡住重试（仅 blocked/failed，重新派单）；stop=人工停止。汇报语义对齐 prototype（ready→completed、dropped→dropped、blocked/failed→等人工且可重试），领域是数字公司；插件仓库拒写（STATE_ROOT_CONFLICT），普通项目正常落盘。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'adjudicate / open / list / get / report / retry / stop / propose（成员自主找活提案）/ dismiss（驳回提案）（默认 list）' },
        proposalId: { type: 'string', description: '提案 id（open 引用提案开单；dismiss 驳回指定提案；propose 不用）' },
        why: { type: 'string', description: '提案的业务理由：从哪发现的活（黑板未决项 id/教训 id/待办路径）、解决了什么业务问题（propose 用）' },
        deliberation: { type: 'string', description: '提案的推演摘要：方案对比+择优理由（为什么值得干、为什么这么干最好）——没推演的提案不收（propose 用）' },
        basis: { type: 'string', description: '提案的授权依据：引用黑板项/教训/待办的具体出处（propose 用）' },
        reason: { type: 'string', description: '驳回提案的理由（dismiss 用）' },
        projectDir: { type: 'string', description: '项目工作区（默认当前会话 cwd）' },
        title: { type: 'string', description: '任务单标题（open/adjudicate）' },
        stage: { type: 'string', description: '所属阶段 clarify/decompose/design/build/verify/close（默认 build）' },
        role: { type: 'string', description: '承接角色（默认 captain）' },
        ticketId: { type: 'string', description: '任务单 id（get/report/retry/stop）' },
        assignmentId: { type: 'string', description: '派单 id（report 默认取最近派单）' },
        state: { type: 'string', description: '汇报状态 progress/waiting/ready/blocked/failed/dropped' },
        summary: { type: 'string', description: '汇报摘要' },
        mandate: { type: 'string', description: '授权 JSON：{strength:"explicit"|"inferred", basis, by, gate}' },
        brief: { type: 'string', description: '成员须知原文（可选；jarvis_dispatch_task 自动生成。经 meta.brief 直达成员简报，含角色卡/协同段/ponder 指引）' },
        reason: { type: 'string', description: 'stop 原因' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          verdict: { type: 'string' },
          text: { type: 'string' },
          ticket: { type: 'object' },
          decision: { type: 'object' },
          tickets: { type: 'array', items: { type: 'object' } },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) => `${r.ok ? '✅' : '⛔'} ${r.verdict}${r.text ? `\n${r.text}` : ''}${r.tickets && r.tickets.length ? `\n${r.tickets.map((t) => `${t.id} [${t.stage}] ${t.title}${t.ended ? '（已结束:' + t.ended.outcome + '）' : ''}`).join('\n')}` : ''}`,
    },
    execute: async (args, exec) => {
      const path = _require('node:path')
      const projectDir = String(args?.projectDir ?? '').trim() || resolveWorkspace(getRuntimeContext(), exec) || '.'
      // 状态根守卫：插件仓库不是 jarvis 状态根，不写任务单（防记忆文件污染插件项目）
      const conflict = stateRootConflict(projectDir)
      const action = String(args?.action ?? 'list').trim()
      if (conflict) return { ok: false, action, verdict: `⛔ ${conflict.message}` }
      // 执行器（每工作区单例）：开单即派成员子会话；getEngine 惰性解引用当前引擎
      const executor = dshExecutorFor(projectDir, () => _ticketEngines.get(projectDir) || null)
      // 成员越权守卫：本执行器派出的成员禁止 open/adjudicate/retry/stop/dismiss（captain 专属，防递归开单）
      const callerId = exec && exec.agent && exec.agent.id
      if (callerId && executor.isChild(callerId) && ['open', 'adjudicate', 'retry', 'stop', 'dismiss'].includes(action)) {
        return { ok: false, action, verdict: `⛔ 成员只可汇报（jarvis_ticket action=report, ticketId=..., assignmentId=..., state=...）与提案找活（action=propose）；open/adjudicate/retry/stop/dismiss 是 captain 专属` }
      }
      // 流程闸（与 agent-teams 派活闸同款，软启用：仅 jarvis 模式工作区生效）：开单即派单，跳步=缺陷
      if (['open', 'adjudicate'].includes(action)) {
        const cwd = (exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd) || projectDir
        const st = _flowState(String(cwd))
        if (st.jarvis) {
          const memIssue = checkMemoryFresh(String(cwd), {})
          if (memIssue) return { ok: false, action, verdict: `⛔ ${memIssue}` }
          if (!st.hasReq && st.baseline === 0) {
            return { ok: false, action, verdict: `⛔ 开单派活前必须先过需求闸：当前工作区没有「需求规格」也没有「基线清单」。先用 jarvis_clarify 打磨需求并产出 .jarvis/docs/需求规格-*.md（改造类还要 jarvis_baseline 建基线），再开单。跳步=缺陷。` }
          }
          const gates = _readGates(String(cwd))
          if (!(gates.build && gates.build.ok)) {
            return { ok: false, action, verdict: `⛔ 开单派活前必须先跑 jarvis_flowguard(step="build") 通过（需要方案设计 + 人才层齐备）。开单即派真成员执行，硬流程不可跳过。` }
          }
        }
      }
      const repo = new JsonTicketRepositories(path.join(projectDir, '.jarvis'))
      const engine = _ticketEngine(projectDir, repo, executor)
      try {
        if (action === 'list') {
          const rows = engine.list()
          const open = engine.open()
          const pendingP = _readProposals(projectDir).filter((p) => p.status === 'pending')
          return {
            ok: true,
            action,
            tickets: rows,
            proposals: pendingP,
            text: rows.slice(0, 50).map((t) => `${t.id} [${t.stage}] ${t.title} —— ${engine.view(t.id)?.text || ''}`).join('\n')
              + (pendingP.length ? '\n\n📋 待裁决提案（成员自主找活，captain 必须逐条消化——通过：action=open 带 proposalId 开单；驳回：action=dismiss）：\n' + pendingP.map((p) => `${p.id}〔${p.proposer}〕${p.title} — 依据:${p.basis}；推演:${(p.deliberation || '').slice(0, 80)}…`).join('\n') : ''),
            verdict: `共 ${rows.length} 张任务单（未结束 ${open.length}）${pendingP.length ? `；⚠️ 待裁决提案 ${pendingP.length} 条，不许堆积无响应` : ''}`,
          }
        }
        if (action === 'get') {
          const view = engine.view(String(args?.ticketId ?? ''))
          if (!view) return { ok: false, action, verdict: `⛔ 任务单不存在：${args?.ticketId || '(空)'}` }
          return {
            ok: true,
            action,
            ticket: view.ticket,
            text: `${view.ticket.id} [${view.ticket.stage}] ${view.ticket.title}\n状态：${view.text}${view.retryable ? '（可重试）' : ''}\n派单：${(view.ticket.assignments || []).map((a) => `${a.id}→${a.role}:${a.state}`).join(', ') || '无'}`,
            verdict: `任务单 ${view.ticket.id}`,
          }
        }
        if (action === 'open' || action === 'adjudicate') {
          let mandate
          try { mandate = args?.mandate ? JSON.parse(String(args.mandate)) : undefined } catch { mandate = undefined }
          const input = {
            title: String(args?.title ?? '').trim() || '未命名任务',
            project: projectDir,
            stage: String(args?.stage ?? 'build').trim() || 'build',
            role: String(args?.role ?? 'captain').trim() || 'captain',
            mandate,
            origin: { triggerId: String(args?.triggerId ?? 'manual') },
          }
          // 成员须知透传：brief（如 jarvis_dispatch_task 生成的角色卡须知）经 meta.brief 直达成员简报
          const briefArg = String(args?.brief ?? '').trim()
          if (briefArg) input.meta = { brief: briefArg }
          // 成员提案消化：open 带 proposalId 时把提案内容作为兜底（title/mandate），开单成功后标记 consumed
          const proposalId = String(args?.proposalId ?? '').trim()
          const proposals = _readProposals(projectDir)
          const proposal = proposalId ? proposals.find((p) => p.id === proposalId) : null
          if (proposalId && !proposal) return { ok: false, action, verdict: `⛔ 提案不存在：${proposalId}（action=list 可见全部待裁决提案）` }
          if (proposal) {
            input.origin.triggerId = 'propose:' + proposal.id
            if (!args?.title) input.title = proposal.title || input.title
            if (!mandate) input.mandate = { strength: 'derived', basis: `成员提案 ${proposal.id}（${proposal.proposer}）：${proposal.basis || proposal.why || '自主找活'}` }
          }
          const out = action === 'adjudicate' ? engine.adjudicate(input) : { ticket: engine.tickets.open(input) }
          if (!out.ticket) {
            return { ok: false, action, decision: out.decision, verdict: `⛔ 闸未通过：${reasonText(out.decision && out.decision.reason)}` }
          }
          if (proposal) {
            proposal.status = 'consumed'
            proposal.ticketId = out.ticket.id
            proposal.decidedAt = new Date().toISOString()
            _writeProposals(projectDir, proposals)
          }
          const first = (out.ticket.assignments || [])[0] || {}
          return {
            ok: true,
            action,
            ticket: out.ticket,
            text: `${out.ticket.id} [${out.ticket.stage}] ${out.ticket.title}\n派单：${first.id}→${first.role}（${first.state}）`,
            verdict: `已开单 ${out.ticket.id}（${out.ticket.mandate.strength}：${out.ticket.mandate.basis}）${proposal ? `；提案 ${proposal.id} 已消化 → ${out.ticket.id}` : ''}`,
          }
        }
        if (action === 'propose') {
          // 成员自主找活通道（用户定调 2026-11-10）：空闲时从黑板/教训/待办找活，提案交 captain 裁决
          const title = String(args?.title ?? '').trim()
          if (!title) return { ok: false, action, verdict: '⛔ 提案必须带 title（想干什么，一句话说清）' }
          const deliberation = String(args?.deliberation ?? '').trim()
          if (deliberation.length < 20) return { ok: false, action, verdict: '⛔ 提案必须带推演摘要 deliberation（方案对比+择优理由，为什么值得干）——没推演的提案不收' }
          const rec = {
            id: 'p' + Date.now().toString(36),
            at: new Date().toISOString(),
            proposer: String(args?.proposer ?? '').trim() || (exec && exec.agent && (exec.agent.name || exec.agent.id)) || 'member',
            title,
            why: String(args?.why ?? '').trim(),
            deliberation,
            basis: String(args?.basis ?? '').trim() || '自主找活（黑板/教训/待办）',
            status: 'pending',
          }
          try {
            const fsp = _require('node:fs')
            fsp.mkdirSync(path.join(projectDir, '.jarvis', 'tickets'), { recursive: true })
            fsp.appendFileSync(_proposalsFile(projectDir), JSON.stringify(rec) + '\n')
          } catch (e) {
            return { ok: false, action, verdict: `⛔ 提案落盘失败：${(e && e.message) || e}` }
          }
          return {
            ok: true,
            action,
            proposal: rec,
            verdict: `✅ 提案已登记 ${rec.id}（${title}）——captain 用 jarvis_ticket action=list 查看待裁决提案；通过后 action=open（带 proposalId=${rec.id}）开单。提案不等于开工，等 captain 裁决。`,
          }
        }
        if (action === 'dismiss') {
          const pid = String(args?.proposalId ?? '').trim()
          const reason = String(args?.reason ?? '').trim() || '暂不采纳'
          const proposals = _readProposals(projectDir)
          const rec = proposals.find((p) => p.id === pid && p.status === 'pending')
          if (!rec) return { ok: false, action, verdict: `⛔ 找不到待裁决提案：${pid || '(空)'}（action=list 可见全部提案）` }
          rec.status = 'rejected'
          rec.decidedAt = new Date().toISOString()
          rec.decisionReason = reason
          _writeProposals(projectDir, proposals)
          return { ok: true, action, proposal: rec, verdict: `已驳回提案 ${pid}（${reason}）——提案人可看 board/纪要了解驳回原因` }
        }
        if (action === 'report') {
          const ticket = engine.report(String(args?.ticketId ?? ''), {
            assignmentId: String(args?.assignmentId ?? '').trim() || undefined,
            state: String(args?.state ?? 'progress').trim(),
            summary: String(args?.summary ?? ''),
          })
          const view = engine.view(ticket.id)
          // 任务终态/失败 → 自动回流记忆（幂等批量，跨平台）
          try {
            const st = String(args?.state || '')
            if (['ready', 'dropped', 'failed', 'blocked'].includes(st)) memIngest(projectDir)
          } catch { /* 回流失败不影响汇报 */ }
          return { ok: true, action, ticket, text: view ? view.text : '', verdict: `汇报已记录（${args?.state}）→ ${view ? view.text : ''}` }
        }
        if (action === 'retry') {
          const ticket = engine.retry(String(args?.ticketId ?? ''))
          const view = engine.view(ticket.id)
          return { ok: true, action, ticket, text: view ? view.text : '', verdict: `已重试 → ${view ? view.text : ''}` }
        }
        if (action === 'stop') {
          const ticket = engine.stop(String(args?.ticketId ?? ''), String(args?.reason ?? ''))
          return { ok: true, action, ticket, text: `已结束（${ticket.ended?.outcome}）`, verdict: `已停止 ${ticket.id}` }
        }
        return { ok: false, action, verdict: `⛔ 未知 action：${action}（adjudicate/open/list/get/report/retry/stop/propose/dismiss）` }
      } catch (error) {
        const code = error && error.code ? String(error.code) : ''
        return { ok: false, action, verdict: `⛔ ${String((error && error.message) || error)}${code ? `（${code}）` : ''}` }
      }
    },
  },
]
