/** jarvis_* 工具（org）：组织运行：会议、绩效、能力补足、问题上行、公司状态、协同健康。
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
import { auditTeamBriefs, auditCaptainOwnedTasks, auditStaleTasks, checkTalentPreconditions, checkPonderVerify, checkCoverageGate, hasGlob, _dropMissing, countMeetingProgress } from '../gates/audit.js'
import { boardFilePath, readBoardItems, writeBoardItems, nextBoardId } from '../state/board.js'
import { companyStateFile, readCompanyState, writeCompanyState, syncCompanyState } from '../state/company.js'
import { PIXOFFICE_ACTOR_IDS, PIXOFFICE_EVENT_KINDS, PIXOFFICE_COMMANDS, PIXOFFICE_LIMITS, normalizeEventKind, buildPixOfficeFrame, validatePixOfficeFrame, sseFrameString, relaySeqDecision, frameHash, validatePixOfficeCommand } from '../pixoffice/index.js'
const _require = createRequire(import.meta.url)


/** 本组工具（按原始顺序）；由 tools/index.js 汇总成 TOOLS。 */
export const ORG_TOOLS = [
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
          boardEntry: { type: 'string', description: '写入黑板的阻塞条目（完整上报时已真写入）' },
          boardWritten: { type: 'boolean', description: '阻塞条目是否已写入黑板' },
          boardError: { type: 'string', description: '黑板写入失败原因（如实上报，不假装已写入）' },
          protocol: { type: 'string', description: '上报纪律（不许跳过）' },
        },
        required: ['ok', 'record'],
      },
      render: (r) =>
        `问题上行：${r.ok ? '✅ 可上报' : '❌ 打回补细节：' + (r.missing || []).join('、')}\n${r.record}\n黑板条目：${r.boardEntry ?? ''}\n纪律：${r.protocol ?? ''}`,
    },
    execute: async (args, exec) => {
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
      // BUG-2 修复：上报单完整时真写黑板（.jarvis/board.json），不再只给建议文本
      //   ——"上报后写黑板（阻塞条目）"是承诺，必须兑现，否则阻塞可能没人看见
      let boardWritten = false
      let boardError = ''
      if (ok) {
        const fsSvc = (() => {
          try { return getFsService(exec) } catch { return null }
        })()
        const disk = await readBoardItems(fsSvc)
        const items = disk.fromDisk ? disk.items : []
        // 去重：同问题上行（内容相同且未解决）不重复写
        const dup = items.some((it) => it.type === '阻塞' && it.status === 'open' && it.content.includes(problem.slice(0, 30)))
        if (!dup) {
          items.push({ id: nextBoardId(items), role, type: '阻塞', content: boardEntry, status: 'open', essenceChecked: true, time: new Date().toISOString().slice(0, 16) })
          // 状态根守卫：插件仓库不写 .jarvis/board.json（防记忆文件污染插件项目）
          const escConflict = stateRootConflict(resolveWorkspace(getRuntimeContext(), exec))
          const w = escConflict ? { ok: false, error: escConflict.error } : await writeBoardItems(fsSvc, items, disk.version)
          boardWritten = w.ok
          boardError = w.ok ? '' : w.error
        } else {
          boardWritten = true // 已存在相同阻塞条目，视为已登记
        }
      }
      const out = { ok, missing, record, boardEntry, protocol }
      if (ok) {
        out.boardWritten = boardWritten
        if (boardError) out.boardError = boardError
      }
      return out
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
        `【能力补足】缺口=${r.gap}\n决策=${r.decision}\n验证：${r.verifyNotes ?? ''}\n自研要求：${r.buildNote ?? ''}\n诚实边界：${r.honestNote ?? ''}`,
    },
    execute: async (args, exec) => {
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
    execute: async (args, exec) => {
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
    name: 'jarvis_perf',
    description:
      '员工绩效评估器（CEO 时刻盯人的量化工具，含阶段性完成度考核）：多角度评估员工能力——⓪需求对齐度（客户价值，最重要：产出是否直指客户需求本质的可判定验收项——2=直指/1=方向对有偏差/0=偏离需求本质做别的，**偏离=一票否决直接换人**）；①成果质量（产出被打回几次/过验收标准没）；②任务完成度（负责任务持续未完成/超时）；③问题上行健康度（过度上报=没判断力，长期不上报=在闷着，高频信号加权）；④角色卡契合度（产出与蒸馏卡方法论是否符合）；⑤深度分（角色卡 distill 深度分）。**阶段性考核（防 0 产出误判）**：必须传 stageStatus——pending（阶段未到/任务未分配）= 判定"待考核"，不计 0 产出、不累计不达标、不触发换人；assigned/in_progress = 按阶段结果考核（阶段完成度是否符合要求）；due（阶段到期未完成）= 才算不达标。判定规则：阶段结果不符合要求才计不达标；连续 2 次不达标 → 建议换人（走离任→重蒸馏补位流程）；高频信号异常（问题上行异常）→ 立即触发评估，不等 2 次；**需求对齐度=0（产出不是客户要的东西）→ 立即换人，不等 2 次**。不武断：每次评估写"哪项不足+依据"，留痕可追溯。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '被评估的员工角色名（必填）' },
        stageStatus: { type: 'string', description: '阶段状态（必填）：pending=阶段未到/任务未分配（判待考核，不计0产出）/ assigned=已分配任务（按阶段结果考核）/ in_progress=进行中（按阶段性产出考核）/ due=阶段到期（到期未完成才计不达标）' },
        stageRequirement: { type: 'string', description: '本阶段要求（验收标准/产出定义），评估"阶段性结果是否符合要求"的基准' },
        quality: { type: 'string', description: '成果质量信号：0-2（0=多次打回/不过验收，1=偶有小问题，2=稳定达标）；阶段未到可省略' },
        completion: { type: 'string', description: '阶段完成度信号：0-2（0=阶段到期未完成，1=部分完成/延迟，2=按时完成符合要求）；pending 时忽略' },
        escalation: { type: 'string', description: '问题上行健康度信号：0-2（0=过度上报或长期不上报，1=偶有异常，2=健康（及时且合理））' },
        fit: { type: 'string', description: '角色卡契合度信号：0-2（0=产出与卡方法论明显不符，1=部分符合，2=契合）' },
        alignment: { type: 'string', description: '需求对齐度（客户价值）：2=产出直指需求本质的可判定验收项 / 1=方向对但有偏差 / 0=偏离需求本质做别的（一票否决，直接换人）' },
        depth: { type: 'string', description: '角色卡深度分（jarvis_distill 输出，0-100）' },
        history: { type: 'string', description: '历史评估记录 JSON（连续判定用），如 [{"ok":false,"at":"2026-08-01"}]' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', description: '被评估员工角色名' },
          ok: { oneOf: [{ type: 'boolean' }, { type: 'null' }], description: '本次是否达标（pending=null 待考核，非达标也非不达标）' },
          score: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '综合分 0-100（pending 时=null，不计 0 产出）' },
          signals: {
            type: 'object',
            description: '各信号明细',
            properties: {
              stageStatus: { type: 'string' },
              stageRequirement: { type: 'string' },
              quality: { type: 'number' },
              completion: { type: 'number' },
              escalation: { type: 'number' },
              fit: { type: 'number' },
              alignment: { type: 'number' },
              depth: { type: 'number' },
              note: { type: 'string' },
            },
          },
          strikes: { type: 'number', description: '连续不达标次数（pending 不累计）' },
          action: { type: 'string', description: '建议动作：待考核/继续观察/补强/换人' },
          historyNext: { type: 'string', description: '下次评估应回传的 history（含本次结果，JSON 字符串）——修复"需调用方手动维护历史"的断点' },
          perfFile: { type: 'string', description: '本角色绩效历史自动落盘文件（.jarvis/perf-<role>.json）' },
          persisted: { type: 'boolean', description: '本次考核是否已自动落盘（有 fs 环境）' },
          verdict: { type: 'string' },
        },
        required: ['ok', 'score', 'action', 'verdict'],
      },
      render: (r) => `【绩效评估 · ${r.role ?? '?'}】${r.action}\n${r.verdict}`,
    },
    execute: async (args, exec) => {
      const role = String(args.role ?? '').trim()
      const stageStatus = String(args.stageStatus ?? 'in_progress').trim()
      const stageRequirement = String(args.stageRequirement ?? '').trim()
      const num = (v, d = 1) => { const n = Number(v); return Number.isFinite(n) ? n : d }
      // BUG-9 修复：信号语义 0-2（0=差/异常，1=偶有，2=健康/达标），越界输入（100/-5/非数字）必须 clamp，
      //   否则 score 会爆出 0-100 范围，且脏值（如 escalation=999）会被误判为"健康满分"
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
      const quality = clamp(num(args.quality, 1), 0, 2)
      const completion = clamp(num(args.completion, 1), 0, 2)
      const escalation = clamp(num(args.escalation, 1), 0, 2)
      const fit = clamp(num(args.fit, 1), 0, 2)
      const depth = clamp(num(args.depth, 0), 0, 100)
      // 需求对齐度（客户价值维度）：2=产出直指需求本质的可判定验收项 / 1=方向对但有偏差 / 0=偏离需求本质做别的
      //   默认 1（中性：CEO 未特别标注时按"方向对"处理，不误伤；显式传 0 = 偏离 → 一票否决）
      const alignment = clamp(num(args.alignment, 1), 0, 2)
      // 自动持久化（修复"换人机制状态不落盘"系统性断点）：perf 历史存 .jarvis/perf-<role>.json，
      //   跨调用自动累计 strikes（CEO 无需手动传 history/存 historyNext）。
      //   有 ctx 且有 fs → 自动读写；无 ctx（单测/裸调）→ 纯函数行为不变（history 走参数）。
      const fsSvc = (() => {
        try { return getFsService(exec) } catch { return null }
      })()
      const perfFile = role ? '.jarvis/perf-' + role.replace(/[\\/:*?"<>|]/g, '_') + '.json' : ''
      let history = []
      const explicitHistory = args.history !== undefined && args.history !== null && String(args.history).trim() !== ''
      if (explicitHistory) {
        try { history = JSON.parse(String(args.history)) } catch { history = [] }
      } else if (fsSvc && typeof fsSvc.readText === 'function' && role) {
        // 无显式 history 时自动从磁盘读历史（跨调用累计 strikes 的持久化源）
        try {
          const target = await fsSvc.resolve(perfFile)
          if (target) {
            const text = await fsSvc.readText(target)
            if (text) {
              const data = JSON.parse(text)
              if (data && Array.isArray(data.history)) history = data.history
            }
          }
        } catch { history = [] }
      }
      // ── 阶段性考核：阶段未到/任务未分配 = 待考核，不计 0 产出、不累计不达标、不触发换人 ──
      if (stageStatus === 'pending') {
        const pout = {
          role,
          ok: null,
          score: null,
          signals: { stageStatus, stageRequirement, note: '阶段未到/任务未分配' },
          strikes: 0,
          action: '待考核（阶段未到，不计 0 产出）',
          historyNext: JSON.stringify(history),
          verdict: `${role} 当前阶段未到/任务未分配（stageStatus=pending）——按阶段性考核规则判定"待考核"：不因 0 产出扣分、不累计不达标、不触发换人。待其阶段任务分配/到期后再评估"阶段性结果是否符合要求（${stageRequirement || '本阶段验收标准'}）"。`,
        }
        if (role && fsSvc && typeof fsSvc.readText === 'function') pout.perfFile = perfFile
        return pout
      }
      // ── 阶段已分配/进行中/到期：按阶段性结果考核 ──
      // 信号权重：需求对齐度（客户价值）+ 成果质量 + 完成度 + 上行健康度（高频加权）+ 契合 + 深度
      const weighted = alignment * 0.2 + quality * 0.2 + completion * 0.15 + escalation * 0.25 + fit * 0.1 + Math.min(2, depth / 50) * 0.1
      let score = Math.round(weighted * 50) // 0-2 → 0-100
      // 阶段性结果是否符合要求：completion 达标（≥1）+ 成果质量达标（≥1）
      const stageOk = completion >= 1 && quality >= 1
      // 需求对齐度一票否决：产出偏离客户需求本质（做的是别的）→ 即使内部质量/完成度满分也判不达标（客户价值铁律）
      const misaligned = alignment === 0
      // 分数与判定一致：偏离时 score 封顶 59（不再出现"80 分却换人"的分数-结论矛盾）
      if (misaligned) score = Math.min(score, 59)
      // 高频信号异常（问题上行=0）→ 立即触发评估：即使阶段产出达标，上行=0（过度上报或闷着）也判本次不达标
      const isTriggered = escalation === 0
      const okThis = score >= 60 && escalation > 0 && stageOk && !misaligned
      // BUG-1 修复：strikes 语义——历史不达标数 + 本次不达标(1)/达标(0)；isTriggered 时本次必为不达标（escalation=0 已含在 okThis 判定）
      const prevFails = history.filter((h) => h.ok === false).length
      const totalStrikes = okThis ? 0 : prevFails + 1
      const action = misaligned
        ? '换人（需求本质偏离：产出不是客户要的东西——方向错再补也是错，直接走 离任→重蒸馏补位）'
        : !okThis && (isTriggered || prevFails + 1 >= 2)
          ? '换人（走 离任→重蒸馏补位 流程）'
          : !okThis ? '补强观察（阶段结果不符合要求，本次不达标）' : '继续（阶段结果符合要求，达标）'
      const verdict = role
        ? `${role} 阶段状态=${stageStatus}，阶段要求=${stageRequirement || '（未注明）'}。阶段结果${stageOk ? '符合要求' : '不符合要求'}（完成度${completion}/质量${quality}），需求对齐${alignment === 0 ? '❌ 偏离需求本质（做偏了客户要的东西）' : alignment === 1 ? '方向对（部分对齐）' : '✅ 直指需求本质'}，综合 ${score}/100（对齐${alignment}/成果${quality}/完成${completion}/上行${escalation}/契合${fit}/深度${depth}）。${action}。依据已留痕。`
        : `缺 role 参数。`
      // historyNext：把本次结果并入历史，供 CEO 下次评估直接回传（修复"依赖调用方手动维护 history"的半自动断点）
      const historyNext = JSON.stringify(history.concat([{ ok: okThis, at: new Date().toISOString().slice(0, 10), action: action.split('（')[0], misaligned: misaligned || undefined }]).slice(-10))
      // 自动落盘：考核记录写 .jarvis/perf-<role>.json（跨调用累计 strikes 的持久化源）
      let persisted = false
      if (fsSvc && typeof fsSvc.writeText === 'function' && role) {
        try {
          const target = await fsSvc.resolve(perfFile)
          if (target) {
            await fsSvc.writeText(target, JSON.stringify({ role, updatedAt: new Date().toISOString(), history: JSON.parse(historyNext) }, null, 2))
            persisted = true
          }
        } catch { persisted = false }
      }
      // 公司状态自动同步（3D 画面反映评估结果：员工 perfScore/strikes/状态——CEO 评估后画面即时可见谁达标/谁被开）
      if (role && fsSvc && typeof fsSvc.readText === 'function') {
        const empStatus = action.includes('换人') ? 'terminated' : (okThis ? 'working' : 'on_probation')
        await syncCompanyState(fsSvc, { type: 'employee_evaluated', role, score, strikes: totalStrikes, status: empStatus, note: stageRequirement || undefined })
      }
      const out = { role, ok: okThis, score, signals: { stageStatus, stageRequirement, alignment, quality, completion, escalation, fit, depth }, strikes: totalStrikes, action, verdict, historyNext }
      if (role && (fsSvc && typeof fsSvc.readText === 'function' && typeof fsSvc.writeText === 'function')) {
        out.perfFile = perfFile
        out.persisted = persisted
      }
      return out
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
        memberReplies: { type: 'string', description: '会后实际收齐的每个成员回复/观点（JSON 或文本：谁给了什么观点）——用于真校验"会议真开了且收了每个成员观点"' },
        brainstormEvidence: { type: 'string', description: '头脑风暴三轮完成证据（JSON：哪些提议走完了"提议→开放回应→表态收敛"三轮，谁反驳过谁）——缺三轮=未充分碰撞' },
        groupchat: { type: 'boolean', description: 'true=群聊会议模式：建共享发言线程（全员可见，每个人能发言、所有人能看到——真会议不是单对单）；输出广播话术+线程路径' },
        post: { type: 'string', description: '群聊模式：某个成员的发言（追加到共享线程，全员可见）；配合 groupchat=true' },
        speaker: { type: 'string', description: '群聊模式：发言者角色名（post 用）' },
        minutes: { type: 'string', description: '会议纪要（落盘 .jarvis/meetings/<id>-minutes.json）：JSON {topic:沟通主题,date,startTime,endTime,type,attendees[],agenda[],content[{who,what}],disputes[],conclusion:结论,resolutions[],boardUpdates[],actions[{who,what}]}——每次内部开会都要有纪要（主题/时间/人员/内容/结论）' },
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
          realMeetingCheck: { type: 'string', description: '真会议执行清单：开会必须真拉每个成员用自己的卡+ponder 独立给观点质疑并留痕，缺任一项=假开会' },
          brainstormCheck: { type: 'string', description: '头脑风暴三轮强制清单（代码级归一化，压缩不丢）：每个提议必须走"提议→开放回应→表态收敛"三轮且过程留痕，缺任一=未充分碰撞' },
          meetingVerdict: { type: 'string', description: '真会议校验结果：真开会 / 假开会/未充分开会（按 memberReplies+brainstormEvidence 判定）' },
          meetingVerdictNote: { type: 'string', description: '真会议校验明细（缺什么/通过）' },
          meetingIssues: { type: 'array', items: { type: 'string' }, description: '假开会的问题清单（缺观点/无质疑/缺三轮）' },
        },
        required: ['goal', 'resolutions'],
      },
      render: (r) =>
        `【${r.type} 会 · 目标】${r.goal}\n流程：${r.protocol ?? ''}\n决议记录：${r.resolutions}\n会后任务：${r.actions ?? ''}\n纪要格式：${r.respondAs ?? ''}`,
    },
    execute: async (args, exec) => {
      const type = String(args.meetingType ?? 'kickoff')
      const fsSvc = getFsService(exec)
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
      // ── 群聊会议协议（groupchat=true，用户定义的真实会议效果）：
      //    排队发言（按顺序，不乱写）+ 每发言须对前面所有发言给评价/看法（同意/反驳/补充+理由，真碰撞）
      //    + 明确时长（轮次上限）+ 明确主题 + 收敛判据（所有细节都没问题才结束，收敛才散会）──
      if (args.groupchat === true) {
        const path = _require('node:path')
        const fsSvc3 = getFsService(exec)
        const projectDir = String(args.projectDir ?? '').trim() || (resolveWorkspace(getRuntimeContext()) || '.')
        const topic = String(args.topic ?? args.agenda ?? '未命名议题').trim()
        const attendees = String(args.attendees ?? '全员').trim().split(',').map((x) => x.trim()).filter(Boolean)
        const order = String(args.order ?? attendees.join('→')).trim() // 排队发言顺序
        const maxRounds = String(args.maxRounds ?? '3').trim() // 时长：最多几轮（每轮每人发言一次）
        const meetId = 'm' + Date.now().toString(36)
        const threadRel = '.jarvis/meetings/' + meetId + '.jsonl'
        const threadPath = path.join(projectDir, threadRel)
        const post = String(args.post ?? '').trim()
        const speaker = String(args.speaker ?? '').trim()
        // post 模式：成员追加发言到共享线程（含对前面发言的评价——用户要求"每个发言对前面每个意见给评价/看法"）
        if (post) {
          if (!fsSvc3 || typeof fsSvc3.readText !== 'function' || typeof fsSvc3.writeText !== 'function') {
            return { verdict: '⚠️ 环境无 fs 服务，无法追加发言（需项目 .jarvis/meetings/ 目录）', ok: false, meetId, thread: threadRel }
          }
          try {
            const existing = (await fsSvc3.readText(threadPath)) || ''
            // 发言格式：必含"对前面发言的评价/看法"（用户要求）+ 自己的观点
            const lines = existing.trim().split(/\n/).filter(Boolean)
            const prevSpeakers = lines.filter((l) => l.includes('发言]')).length
            const speakerLabel = speaker || ('成员' + (prevSpeakers + 1))
            const mustEvaluate = prevSpeakers > 0
            const entry = `[${new Date().toISOString().slice(0, 16)}][${speakerLabel} 发言] 对前面 ${prevSpeakers} 个发言的评价/看法：${String(args.evaluate ?? '（未写对前面发言的评价——用户要求"每个发言对前面每个意见给出评价或自己的看法"）')}\n 自己的观点：${post}`
            await fsSvc3.writeText(threadPath, existing + (existing ? '\n' : '') + entry + '\n')
            return {
              verdict: `✅ ${speakerLabel} 已发言（${mustEvaluate ? '含对前面发言的评价' : '首位发言'}）——线程=${threadRel}，全员可见`,
              ok: true, meetId, thread: threadRel, mustEvaluate,
              meetingStatus: await countMeetingProgress(existing, maxRounds),
            }
          } catch (e) { return { verdict: '⛔ 追加发言失败：' + (e.message || e), ok: false } }
        }
        // 发起模式：建线程 + 输出会议协议（主题/时长/自由发言/主持人盯控/收敛判据）+ 广播话术
        // 真实会议形态（用户定义）：自由发言、随机、可沉默——像真实会议；不是机械排队、不强制每人说
        const protocol = [
          `【群聊会议 · ${topic}】`,
          `主题（要打磨的细节）：${topic}`,
          `时长：最多 ${maxRounds} 轮（超时未收敛 → CEO 判定：继续或归拢）`,
          '发言方式（真实会议形态，用户要求）：',
          '  ① **自由发言**：任何成员有观点/疑问/回应随时说（不排队、不轮流、不强制）——像真实会议，谁想到谁说；',
          '  ② **可沉默**：没观点/没疑问的成员可以不发言（真实会议也有人不说话）——沉默≠缺席，议题相关才需要发声；',
          '  ③ **接话碰撞**：看到别人观点，愿意就接（同意/反驳/补充+理由）——碰撞靠自愿接话，不靠轮流；',
          '  ④ 所有人能看到所有人的发言（共享线程=群聊，read 线程即见全员）。',
          '主持人（CEO）盯控（真实会议主持人的职责）：',
          '  - **该发声的没发声**：某个议题明显与该角色相关（测试对验收、实现对方案）而 TA 没说话 → CEO 点名问"你怎么看"（像真实会议主持人叫到人），不是强制，是确保相关视角被听到；',
          '  - **观点没人回应**：某观点提出后无人接话 → CEO 追问"有人同意/反对吗"（防观点悬空）；',
          '  - **沉默允许**：点完名仍没话说 = 真没观点，尊重沉默。',
          `收敛判据（用户要求）：所有细节都被确认没问题（每个议题/细节有成员明确"无问题/已闭环"）才散会；有遗留细节 → 继续下一轮。`,
          `线程：${threadRel}（发言写这里，read 即见全员）`,
        ].join('\n')
        // 建线程（写议题）
        try {
          if (fsSvc3 && typeof fsSvc3.writeText === 'function') {
            await fsSvc3.writeText(threadPath, protocol + '\n')
          }
        } catch {}
        // 会议纪要（minutes 参数：产出/更新结构化纪要，落盘 .jarvis/meetings/<id>-minutes.json）
        //   要素：沟通主题/时间/人员/内容/结论（用户要求每次内部开会都有纪要）
        const minutesRaw = String(args.minutes ?? '').trim()
        if (minutesRaw) {
          try {
            const minutesPath = path.join(projectDir, '.jarvis/meetings', meetId + '-minutes.json')
            const existing = fsSvc3 && typeof fsSvc3.readText === 'function' ? await fsSvc3.readText(await fsSvc3.resolve(minutesPath)).catch(() => null) : null
            let minutes = existing ? JSON.parse(existing) : {}
            try { minutes = { ...minutes, ...JSON.parse(minutesRaw) } } catch { minutes = { ...minutes, minutes: minutesRaw } }
            minutes.meetId = meetId; minutes.topic = minutes.topic || topic; minutes.attendees = minutes.attendees || attendees
            if (fsSvc3 && typeof fsSvc3.writeText === 'function') {
              await fsSvc3.writeText(minutesPath, JSON.stringify(minutes, null, 2))
            }
            return {
              verdict: `会议纪要已落盘：主题=${minutes.topic || topic}，${Object.keys(minutes).filter((k) => ['date', 'startTime', 'endTime', 'conclusion', 'resolutions', 'actions'].includes(k)).length} 项要素（主题/时间/人员/内容/结论），路径=${'.jarvis/meetings/' + meetId + '-minutes.json'}`,
              ok: true, meetId, thread: threadRel, minutesPath: '.jarvis/meetings/' + meetId + '-minutes.json', minutes,
            }
          } catch (e) {
            return { verdict: '⚠️ 纪要落盘失败：' + (e.message || e), ok: false, meetId, thread: threadRel }
          }
        }
        const broadcast = `【群聊会议发起 · ${topic}】请到共享线程发言（真实会议形态：自由发言、可沉默、接话碰撞，CEO 主持人盯控该发声的没发声会点名；最多 ${maxRounds} 轮，所有细节没问题才散会）：${threadRel}`
        return {
          verdict: `群聊会议已发起：主题=${topic}，时长≤${maxRounds}轮，自由发言（可沉默）+主持人(CEO)盯控点名，收敛=所有细节无问题才结束`,
          ok: true, topic, meetId, thread: threadRel,
          protocol,
          broadcast, // CEO/captain 逐个 send_message 给 attendee（内容=此 broadcast）
          attendees,
          order, maxRounds,
          mustEvaluate: true, // 每个发言必须评价前面
          convergeRule: '所有细节被确认无问题才结束；有遗留 → 下一轮',
        }
      }
      const m = META[type] || META.kickoff
      // 公司状态自动同步（3D 画面显示"正在开会/会议结束"）
      try {
        const fsSvc2 = getFsService(exec)
        // 状态根守卫：显式 projectDir 指向插件仓库时不写 .jarvis（防记忆文件污染插件项目）
        const syncDir = String(args.projectDir ?? '').trim()
        if (fsSvc2 && !(syncDir && stateRootConflict(syncDir))) {
          if (type === 'close') await syncCompanyState(fsSvc2, { type: 'meeting_done', meetingId: 'm', projectDir: syncDir || undefined })
          else await syncCompanyState(fsSvc2, { type: 'meeting_started', meeting: { id: 'm', type, topic: agenda || m.goal, attendees: attendees.split(',') }, projectDir: syncDir || undefined })
        }
      } catch {}
      // ── 真会议校验（防假开会：capatin 传实际收齐的成员观点 + 三轮证据，工具判定真开会 or 假开会）──
      const replies = String(args.memberReplies ?? '').trim()
      const bstorm = String(args.brainstormEvidence ?? '').trim()
      const meetingIssues = []
      if (!replies) {
        meetingIssues.push('未提供 memberReplies（每个成员的实际回复/观点）——**没有"每个成员独立观点"的会 = 假开会 = 不算评审**')
      } else {
        // 至少要有 2 个不同角色的观点（单人自说自话不算开会）
        const replyRoles = (replies.match(/[^\n，,]{1,12}\s*[:：]\s*[^\n，,]{2,}/g) || [])
        if (replyRoles.length < 2) meetingIssues.push('memberReplies 角色数 <2（只有一个人说话不算开会——须有不同角色的独立观点/质疑）')
        if (!/质疑|反驳|不同意|担心|异议|不对|有疑问|挑战/.test(replies)) meetingIssues.push('memberReplies 中没有任何成员提出质疑/反驳/不同观点——全员附和 = 不算评审，重开')
      }
      if (!bstorm) {
        meetingIssues.push('未提供 brainstormEvidence（头脑风暴三轮完成证据）——**每个提议必须走完"提议→开放回应→表态收敛"三轮才能进归拢**')
      } else {
        if (!/③|表态|收敛|同意|反对|保留/.test(bstorm)) meetingIssues.push('brainstormEvidence 缺"表态收敛"（第③轮）——提议没走完三轮 = 未充分碰撞')
        if (!/反驳|质疑|不同意/.test(bstorm)) meetingIssues.push('brainstormEvidence 中无任何"反驳/质疑"——没有对抗的头脑风暴 = 全员附和')
      }
      const meetingVerdict = meetingIssues.length === 0 ? '真开会' : '假开会/未充分开会'
      const meetingVerdictNote = meetingIssues.length
        ? '⛔ ' + meetingIssues.join(' | ')
        : '✅ 真会议通过：收齐了各成员独立观点（含质疑）+ 提议走完三轮（含反驳/表态）——可进归拢'
      // 闭环：假开会 = 本次会结论作废（不许基于它推进拆解/派活/收口）——防"判了假开会还继续"
      const meetingClosed = meetingIssues.length === 0
        ? '本次会议结论可进入后续（拆解/派活/收口）；收口防迎合总闸第4条（对抗碰撞过）以本次 meetingVerdict 为证据。'
        : '⛔ **本次会议结论作废**：未达到真会议标准（见上），**后续拆解/派活/收口不得基于本次会结论**——先重开会议收齐成员观点+三轮证据（补 memberReplies/brainstormEvidence 或重新开会），收口防迎合总闸第4条（对抗碰撞过）将按本次 verdict=假开会 拦截。'
      return {
        type,
        goal: m.goal,
        protocol: m.protocol + (agenda ? `\n议程：${agenda}` : '') + (ctx ? `\n上下文：${ctx}` : ''),
        resolutions: m.resolutions,
        actions: m.actions,
        meetingVerdict,
        meetingVerdictNote,
        meetingIssues,
        realMeetingCheck: '真会议执行清单（开会 = 做完这些才算开，缺任一项 = 假开会 = 不算开）：\n' +
          '  ① 把议题逐个 send_message 发给每个与会成员（不是自己心里过一遍）；\n' +
          '  ② 每个成员用自己的角色卡思维 + ponder 独立给观点/质疑（不同角色对同一议题的不同视角：验收的质疑「这怎么验」、实现的质疑「这改得动吗」、独立的质疑「用户会满意吗」）——**收集每个成员的独立观点，不许只自己宣布**；\n' +
          '  ③ 观点/质疑汇总到黑板（谁提了什么，留痕）；\n' +
          '  ④ 分歧项 jarvis_review 裁决（吃双方观点+requirement）；\n' +
          '  ⑤ 决议落黑板 + 会后任务（谁负责什么）。\n' +
          '  自检：本次会有没有至少一个成员提出过质疑/不同观点？没有 = 全员附和 = 不算评审，重开。',
        respondAs: `完成本次「${type}」会后，以 JSON 输出完整会议纪要（含每个成员观点/质疑——没有=假开会）：{"topic":"沟通主题（一句话说清这次会解决什么）","date":"日期","startTime":"开始时间","endTime":"结束时间","type":"${type}","attendees":["${attendees}"],"agenda":["议题清单"],"content":[{"who":"发言者","what":"发言/观点/质疑内容"}],"disputes":[{"issue":"分歧","resolvedBy":"jarvis_review 裁决结果"}],"conclusion":"本次结论（最终定论：达成了什么/定了什么）","resolutions":["决议逐条"],"boardUpdates":["写回黑板的条目"],"actions":[{"who":"角色","what":"会后负责什么+截止"}]}——纪要要素完整：沟通主题/时间/人员/内容/结论，缺任一=不完整`,
        brainstormCheck: `🧠 头脑风暴三轮强制清单（代码级——每个提议必须走完三轮，缺任一=未充分碰撞=不能进归拢；过程留痕到会议纪要）：
  ① 提议：某角色抛出疑问/方案/想法（记录：谁提的 + 提了什么）；
  ② 开放回应：任何人可解答/补充/同意/反驳（记录：谁回应 + 同意/反驳 + 理由）；
  ③ 表态收敛：全员表态 同意/反对/保留（记录：各自态度）；有分歧 → 继续辩（回到②）→ 辩到多数认同或 CEO 裁决；
  每个提议都走完三轮 → 才进归拢（共识/分歧/待确认）；没走三轮的提议 = 未碰撞 = 打回；
  同时：挑战用户信息本身（用户说的不是圣旨）；归拢 = 最好的结果（坏方案被反驳淘汰、好方案吸收胜出，不是并集/折中/多数即对）。
  自检：有没有至少一个提议走完了三轮且有人反驳过？没有 = 全员附和 = 假头脑风暴 = 重开。`,
      }
    },
  },

  {
    name: 'jarvis_company',
    description:
      '公司状态快照读写器（3D 办公室可视化/UI 的数据源——把你的"CEO 走动监控/会议室开会/猎头招募/员工工位"变成 UI 可读的结构化状态）：维护 <项目>/.jarvis/company-state.json，含 employees(员工表: 角色/人物/状态[working/reporting/meeting/idle/on_probation/terminated]/任务/绩效/离任原因)、meetings(会议表: 类型/议题/参会/状态)、recruiting(招募表: 岗位/目标人物/候选/状态[searching/interviewing/confirmed]/补谁)、ceo/headhunter(当前动作/位置)——headhunter=猎头(寻访专家)。动作模式：update=CEO/主面板在关键动作后更新快照（如派活/汇报/开会/评估/开除/招募确认后），传对应字段；action=员工/角色单动作局部同步（入职/开工/汇报/开会/评估/开除——内部自动合并，不覆盖他表数据）；snapshot=读当前快照（UI 轮询用）；clear=新项目/项目结束清空。UI（3D 办公室）只读 snapshot 渲染，不直接改。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'update=更新快照 / snapshot=读当前快照（UI 轮询）/ clear=清空' },
        employees: { type: 'string', description: '员工表 JSON 数组（update 用）：[{id,role,persona,cardFile,status,taskId,currentWork,lastReport,perfScore,strikes,note}]——status∈working/reporting/meeting/idle/on_probation/terminated' },
        meetings: { type: 'string', description: '会议表 JSON 数组（update 用）：[{id,type,topic,attendees,status}]——status∈scheduled/in_progress/done' },
        recruiting: { type: 'string', description: '招募表 JSON 数组（update 用）：[{id,position,targetPersona,candidates,status,replacesEmp}]——status∈searching/interviewing/confirmed/cancelled' },
        ceo: { type: 'string', description: 'CEO 当前状态 JSON（update 用）：{persona,currentAction,location}——location∈ceo_office/hall/meeting_room' },
        headhunter: { type: 'string', description: '猎头当前状态 JSON（update 用）：{persona,currentAction}' },
        phase: { type: 'string', description: '项目当前阶段（如 kickoff/开发/测试/收口）' },
        actionType: { type: 'string', description: '单动作类型（mode=action 用）：employee_hired(入职, 配role/persona/replaces) / employee_started(开工领任务, 配role/currentWork) / employee_reporting(汇报, 配role/note=汇报内容) / employee_terminated(开除, 配role/note=离任原因——自动触发猎头补位) / employee_evaluated(绩效评估同步, 配role/score/strikes/status) / recruiting_started(开招募, 配position/targetPersona/replacesEmp) / recruiting_interviewing(猎头开始面试, 配position) / meeting_started(开会, 配meeting={id,type,topic,attendees}——参会员工自动标meeting) / meeting_done(散会, 配meetingId)——自动同步状态防 3D 画面失真' },
        note: { type: 'string', description: '汇报内容/离任原因等备注（mode=action 用）' },
        meeting: { type: 'string', description: '会议信息 JSON（meeting_started 用）：{id,type,topic,attendees:[角色名]}——参会员工自动标 meeting' },
        meetingId: { type: 'string', description: '会议 id（meeting_done 用）' },
        score: { type: 'number', description: '绩效分（employee_evaluated 用）' },
        strikes: { type: 'number', description: '不达标次数（employee_evaluated 用）' },
        status: { type: 'string', description: '评估后状态 working/on_probation/terminated（employee_evaluated 用）' },
        role: { type: 'string', description: '动作针对的员工角色（mode=action 用）' },
        persona: { type: 'string', description: '入职员工人物（employee_hired 用）' },
        currentWork: { type: 'string', description: '当前任务（employee_started 用）' },
        replaces: { type: 'string', description: '补谁的空缺（employee_hired/recruiting_started 用）' },
        position: { type: 'string', description: '招募岗位（recruiting_started 用）' },
        targetPersona: { type: 'string', description: '招募目标人物（recruiting_started 用）' },
        replacesEmp: { type: 'string', description: '补谁（recruiting_started 用）' },
        projectDir: { type: 'string', description: '（T8）快照落盘项目目录（缺省=调用会话 cwd；再缺省=进程兜底）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          snapshot: { type: 'object', additionalProperties: true, description: '当前公司状态快照（UI 渲染数据源）' },
          updated: { type: 'boolean', description: '本次是否更新了快照' },
          written: { type: 'boolean', description: '（T8）本次是否真的写盘（fs 服务或 node:fs 兜底成功）' },
          storage: { type: 'string', description: '快照文件绝对路径' },
          storageMode: { type: 'string', description: '（T8）落盘通道：fs-service / node-fs-fallback / failed / auto / none' },
          verdict: { type: 'string' },
        },
        required: ['snapshot', 'verdict'],
      },
      render: (r) =>
        `【公司状态】${r.verdict}\n快照文件：${r.storage || '.jarvis/company-state.json'}`,
    },
    execute: async (args, exec) => {
      const mode = String(args.mode ?? 'snapshot').trim()
      // T8：模块级工具 handler 拿不到 apply 的形参 ctx（旧写法 `ctx && ctx.get` 会 ReferenceError → fsSvc 恒 null，
      // 这正是「无 fs 未落盘」的根因之一）；改用 apply 写入的模块级 getRuntimeContext()。
      const fsSvc = (() => {
        try { return (getRuntimeContext() && getRuntimeContext().get && getRuntimeContext().get('fs')) || null } catch { return null }
      })()
      const path = _require('node:path')
      // T8：落盘目录取「本次调用的事实」——args.projectDir > 调用会话 cwd > 进程兜底；
      // 并用**绝对路径**（旧实现用相对 '.jarvis/company-state.json'，依赖进程 cwd → GUI 侧永远读不到数据）。
      const projectDir = String(args.projectDir ?? '').trim()
        || String((exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd) || '').trim()
        || resolveWorkspace(getRuntimeContext()) || '.'
      const stateFile = path.join(projectDir, '.jarvis/company-state.json')
      // 读当前快照（fs 服务优先，失败/不可用 → node:fs 兜底，见 readCompanyState）
      let state = await readCompanyState(fsSvc, projectDir)
      // 状态根守卫：插件仓库不写 .jarvis（防记忆文件污染插件项目）；snapshot 只读放行
      if (mode !== 'snapshot') {
        const conflict = stateRootConflict(projectDir)
        if (conflict) return { snapshot: state, updated: false, written: false, storage: stateFile, storageMode: 'state-root-conflict', verdict: `⛔ ${conflict.message}` }
      }
      if (mode === 'snapshot') {
        return { snapshot: state, written: false, storage: stateFile, verdict: `公司快照：${state.employees?.length || 0} 员工 / ${state.meetings?.length || 0} 会议 / ${state.recruiting?.length || 0} 招募中（UI 轮询渲染用）` }
      }
      if (mode === 'clear') {
        state = { company: {}, employees: [], meetings: [], recruiting: [], ceo: {}, headhunter: {}, tasks: [], updatedAt: '' }
      } else if (mode === 'update') {
        // 更新各表（传哪个字段更新哪个）
        if (args.employees !== undefined) { try { state.employees = JSON.parse(String(args.employees)) } catch {} }
        if (args.meetings !== undefined) { try { state.meetings = JSON.parse(String(args.meetings)) } catch {} }
        if (args.recruiting !== undefined) { try { state.recruiting = JSON.parse(String(args.recruiting)) } catch {} }
        if (args.ceo !== undefined) { try { state.ceo = JSON.parse(String(args.ceo)) } catch {} }
        if (args.headhunter !== undefined) { try { state.headhunter = JSON.parse(String(args.headhunter)) } catch {} }
        if (args.phase !== undefined) state.phase = String(args.phase)
        state.updatedAt = new Date().toISOString()
      } else if (mode === 'action') {
        // 单动作局部同步（员工入职/开工/汇报/开除等）——复用 syncCompanyState，只改对应表不覆盖他表
        const act = { type: args.actionType, role: args.role, persona: args.persona, currentWork: args.currentWork, replaces: args.replaces, position: args.position, targetPersona: args.targetPersona, replacesEmp: args.replacesEmp, note: args.note, score: args.score, strikes: args.strikes, status: args.status, meetingId: args.meetingId, meeting: args.meeting ? (typeof args.meeting === 'string' ? (() => { try { return JSON.parse(args.meeting) } catch { return null } })() : args.meeting) : null }
        const actionTypes = ['employee_hired', 'employee_started', 'employee_reporting', 'employee_terminated', 'employee_evaluated', 'recruiting_started', 'recruiting_interviewing', 'meeting_started', 'meeting_done']
        if (!actionTypes.includes(args.actionType)) return { snapshot: state, updated: false, storage: stateFile, verdict: `未知 actionType：${args.actionType || '(空)'}（支持 ${actionTypes.join('/')}）——未改动` }
        if (args.actionType === 'employee_hired' && !args.role) return { snapshot: state, updated: false, storage: stateFile, verdict: 'employee_hired 缺 role（入职谁）——未改动' }
        if ((args.actionType === 'employee_started' || args.actionType === 'employee_reporting' || args.actionType === 'employee_terminated') && !args.role) return { snapshot: state, updated: false, storage: stateFile, verdict: `${args.actionType} 缺 role——未改动` }
        if (args.actionType === 'recruiting_started' && !args.position) return { snapshot: state, updated: false, storage: stateFile, verdict: 'recruiting_started 缺 position——未改动' }
        if ((args.actionType === 'recruiting_interviewing') && !args.position) return { snapshot: state, updated: false, storage: stateFile, verdict: 'recruiting_interviewing 缺 position——未改动' }
        if (args.actionType === 'meeting_started' && !args.meeting) return { snapshot: state, updated: false, storage: stateFile, verdict: 'meeting_started 缺 meeting(含 attendees)——未改动' }
        if (args.actionType === 'meeting_done' && !args.meetingId) return { snapshot: state, updated: false, storage: stateFile, verdict: 'meeting_done 缺 meetingId——未改动' }
        if (args.actionType === 'employee_evaluated' && (!args.role || args.score === undefined)) return { snapshot: state, updated: false, storage: stateFile, verdict: 'employee_evaluated 缺 role/score——未改动' }
        act.projectDir = projectDir
        const ok = await syncCompanyState(fsSvc, act)
        if (!ok) return { snapshot: state, updated: false, written: false, storage: stateFile, storageMode: 'failed', verdict: `action ${args.actionType} 同步失败（fs 服务与 node:fs 兜底均未写入）` }
        return { snapshot: state, updated: true, written: true, storage: stateFile, storageMode: 'auto', verdict: `action ${args.actionType} 已同步（状态局部更新，不覆盖他表）` }
      }
      // 写回磁盘：fs 服务 → node:fs 原子兜底（T8：不再「无 fs 就静默不落盘」）
      const w = await writeCompanyState(fsSvc, state, projectDir)
      const persisted = Boolean(w && w.ok)
      const storageMode = String((w && w.mode) || 'failed')
      const summary = `员工 ${state.employees?.length || 0}（${(state.employees || []).filter((e) => e.status === 'working').length} 工作中 / ${(state.employees || []).filter((e) => e.status === 'terminated').length} 已离任）· 会议 ${state.meetings?.length || 0} · 招募中 ${state.recruiting?.length || 0}`
      const modeText = storageMode === 'fs-service' ? 'fs 服务' : storageMode === 'node-fs-fallback' ? 'node:fs 兜底' : '两路均失败'
      return {
        snapshot: state,
        updated: mode !== 'snapshot' && persisted,
        written: mode !== 'snapshot' && persisted,
        storage: stateFile,
        storageMode,
        verdict: `公司状态${persisted ? `已落盘（${modeText}）` : '未落盘（fs 服务与 node:fs 兜底均失败）'}：${summary}`,
      }
    },
  },

/**
 * 派活一步到位（用户定调：固化流程，不考核步骤）。
 *
 * 旧做法：先用 jarvis_member_brief 生成须知 → 人工把须知抄进任务描述 → 再用闸检查「描述里有没有须知/角色卡标记」。
 * 那是「考核员工有没有按流程填表」。新做法：把流程做进工具——一次调用内部完成
 * ① jarvis_member_brief（含角色卡全文 + ponder 指引）② agent_teams_create_task（须知自动拼进描述）。
 * 正确的路 = 最省事的路，于是不需要再靠闸去验证某一步有没有做。
 */
{
  name: 'jarvis_dispatch_task',
  description:
    '派活一步到位（推荐用法）：内部先调 jarvis_member_brief 生成「角色卡全文 + ponder 指引 + 回报格式」的成员须知，再调 agent_teams_create_task 把须知自动拼进任务描述创建任务。把「正确流程」做成最省事的路：不用手工抄须知，不需要外部闸去检查你有没有抄。若任务已建好只想补须知，用 jarvis_member_brief + agent_teams_update_task。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      assignee: { type: 'string', description: '成员名（与 agent_teams_add_member 的 name 一致；也是找角色卡的键）' },
      subject: { type: 'string', description: '任务标题（写清交付物与验收口径）' },
      description: { type: 'string', description: '任务正文：要做什么、输入在哪、验收标准（成员须知会自动附在后面）' },
      acceptance: { type: 'string', description: '验收标准（可判定；会一并进入须知与任务描述）' },
      team: { type: 'string', description: '团队 id（agent_teams_create_task 的 team 参数；不传由 agent-teams 决定）' },
      taskId: { type: 'string', description: '显式任务 id（可选）' },
      stakes: { type: 'string', description: '赌注 high/medium/low（默认 medium，影响 ponder 深度说明）' },
      dependencies: { type: 'string', description: '依赖任务 id（JSON 数组字符串或逗号分隔，可选）' },
      projectDir: { type: 'string', description: '项目目录（默认当前会话工作区）' },
    },
    required: ['assignee', 'subject'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', description: '整条链路是否成功' },
        dispatched: { type: 'boolean', description: '任务是否真的建出来了（agent_teams_create_task 返回成功）' },
        taskId: { type: 'string', description: '建出的任务 id（拿得到就填）' },
        cardPath: { type: 'string', description: '注入的角色卡文件；空=该角色还没卡' },
        cardMissing: { type: 'boolean', description: 'true=没有角色卡（流程建议先蒸馏，但不阻塞派活）' },
        briefChars: { type: 'number', description: '写进任务描述的须知长度' },
        inner: { type: 'array', items: { type: 'string' }, description: '内部调用轨迹（brief → create_task）' },
        summary: { type: 'string', description: '结果摘要 + 失败时的补救办法' },
      },
      required: ['ok', 'summary'],
    },
    render: (r) =>
      `${r.ok ? '✅' : '⚠️'} 派活${r.dispatched ? '已建任务' : '未建任务'}${r.taskId ? `（task=${r.taskId}）` : ''}\n` +
      `角色卡：${r.cardPath || '（无——该角色还没蒸馏卡，建议先蒸馏再派活）'}\n` +
      `须知：${r.briefChars ?? 0} 字已拼进任务描述\n` +
      (Array.isArray(r.inner) && r.inner.length ? `内部调用：${r.inner.join(' → ')}\n` : '') +
      `${r.summary || ''}`,
  },
  execute: async (args, exec) => {
    const assignee = String(args.assignee ?? '').trim()
    const subject = String(args.subject ?? '').trim()
    if (!assignee || !subject) return { ok: false, summary: '⛔ 派活需要 assignee（成员名）与 subject（任务标题）' }
    const projectDir = String(args.projectDir ?? '').trim() || resolveWorkspace(getRuntimeContext()) || ''
    const rt = getRuntimeContext()
    const toolsSvc = rt && typeof rt.get === 'function' ? rt.get('tools') : undefined
    if (!toolsSvc || typeof toolsSvc.execute !== 'function') {
      return {
        ok: false,
        dispatched: false,
        summary: '⚠️ 当前宿主没有 tools.execute（工具内派活不可用）。手工两步：① jarvis_member_brief(roleName=成员) ② 把 brief 原文附进 agent_teams_create_task 的 description。',
      }
    }
    const signal = (exec && exec.signal) || new AbortController().signal
    const rootCallId = (exec && exec.rootCallId) || undefined
    const call = (name, a) =>
      toolsSvc.execute({ callId: `jarvis-dispatch-${name}-${Date.now().toString(36)}`, rootCallId, name, arguments: a, agent: exec && exec.agent, signal })
    const inner = []
    const textOf = (res) => {
      try {
        if (!res || res.isError) return ''
        const v = res.value
        if (v && typeof v === 'object' && typeof v.brief === 'string') return v.brief
      } catch {}
      return ''
    }
    let brief = ''
    let cardPath = ''
    let cardMissing = true
    try {
      inner.push('jarvis_member_brief')
      const b = await call('jarvis_member_brief', {
        roleName: assignee,
        task: [subject, args.description, args.acceptance].filter(Boolean).join('\n\n'),
        stakes: String(args.stakes ?? 'medium'),
        projectDir: projectDir || undefined,
      })
      brief = textOf(b)
      const bv = b && !b.isError ? b.value : undefined
      cardPath = String((bv && bv.cardPath) || '')
      cardMissing = bv ? Boolean(bv.cardMissing) : true
      if (b && b.isError) return { ok: false, dispatched: false, inner, cardPath, cardMissing, summary: `⚠️ 生成成员须知失败：${String((b.error && (b.error.message || b.error.code)) || '未知错误')}` }
    } catch (e) {
      return { ok: false, dispatched: false, inner, summary: `⚠️ 生成成员须知抛错：${String((e && e.message) || e)}` }
    }
    const body = String(args.description ?? '').trim()
    const acceptance = String(args.acceptance ?? '').trim()
    const description = [
      body || '（见 subject）',
      acceptance ? `验收标准：${acceptance}` : '',
      brief ? '\n---\n' : '',
      brief,
    ].filter(Boolean).join('\n')
    const taskArgs = { subject, description, assignee }
    if (args.team) taskArgs.team = String(args.team)
    if (args.taskId) taskArgs.task_id = String(args.taskId)
    if (args.dependencies) {
      const raw = String(args.dependencies).trim()
      let deps = raw
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) deps = parsed
      } catch {}
      taskArgs.dependencies = deps
    }
    try {
      inner.push('agent_teams_create_task')
      const created = await call('agent_teams_create_task', taskArgs)
      const cv = created && !created.isError ? created.value : undefined
      const taskId = String((cv && (cv.taskId || cv.id || (cv.task && cv.task.id))) || '')
      if (created && created.isError) {
        return {
          ok: false,
          dispatched: false,
          taskId,
          cardPath,
          cardMissing,
          briefChars: brief.length,
          inner,
          summary: `⚠️ 任务创建失败：${String((created.error && (created.error.message || created.error.code)) || '未知错误')}——须知已生成（${brief.length} 字），可手工建任务并把须知附进描述。`,
        }
      }
      return {
        ok: true,
        dispatched: true,
        taskId,
        cardPath,
        cardMissing,
        briefChars: brief.length,
        inner,
        summary: `任务「${subject}」已派给 ${assignee}；须知（含${cardPath ? '角色卡' : '角色卡缺失提示'} + ponder 指引）已自动写进描述。${cardMissing ? '⚠️ 该角色还没有卡：建议先蒸馏再让他开工。' : ''}`,
      }
    } catch (e) {
      return { ok: false, dispatched: false, cardPath, cardMissing, briefChars: brief.length, inner, summary: `⚠️ 建任务抛错：${String((e && e.message) || e)}` }
    }
  },
},
]
