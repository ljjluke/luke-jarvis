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



import { execSync, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { toPixOfficeSnapshot } from './office-bridge.js'
import { Engine, reasonText } from './core/index.js'
import { JsonTicketRepositories } from './adapters/json-tickets.js'
import { SECTIONS, EVIDENCE_SECTIONS, COLLAB_FOUR, checkCollabHealth, validateCardShape, assessCardDepth, distillGuide, identifyIndustry, checkContentFingerprint } from './distill/index.js'
import { JARVIS_SYSTEM_PROTOCOL, JARVIS_CULTURE } from './protocol/index.js'
import { COORD_TASK_RE, TERMINAL_TASK_STATUS, ACTIVE_TEAM_MARKER_TTL_MS, ACTIVE_TEAM_MAX_AGE_MS, ARCHIVED_TEAM_RE, resolveOwnedTeams, looksLikePluginRepo, stateRootConflict, writeActiveTeamMarker } from './gates/ownership.js'
import { setRuntimeContext, rememberExec, getRuntimeContext, getLatestExec, getResolvedWorkspace, resolveWorkspace, ponderVerifyProjectDir, getFsService, listNames, readTextSafe, hasTeamJson, markJarvisSession, isJarvisSession } from './runtime.js'
import { boardFilePath, readBoardItems, writeBoardItems, nextBoardId } from './state/board.js'
import { companyStateFile, readCompanyState, writeCompanyState, syncCompanyState } from './state/company.js'
import { auditTeamBriefs, auditCaptainOwnedTasks, auditStaleTasks, checkTalentPreconditions, checkPonderVerify, checkCoverageGate, hasGlob, _dropMissing } from './gates/audit.js'
import { MEMORY_MAX_AGE_MS, checkMemoryFresh, _readGates, _memoryState, recordGate, _flowState } from './gates/store.js'
import { JARVIS_STAGES, STAGE_LABELS, STAGE_GATE, STAGE_DENY, PAID_WORK_TOOLS, computeStage, renderStage, jarvisStageGate, captainExecutionGuard } from './gates/stage.js'
import { TEAM_TOOLS, jarvisFlowGuard } from './gates/flow.js'
import { PIXOFFICE_ACTOR_IDS, PIXOFFICE_EVENT_KINDS, PIXOFFICE_COMMANDS, PIXOFFICE_LIMITS, normalizeEventKind, buildPixOfficeFrame, validatePixOfficeFrame, sseFrameString, relaySeqDecision, frameHash, validatePixOfficeCommand } from './pixoffice/index.js'
// 保持对外导入面不变（test/plugin.test.js 等直接 import 这些名字）
export { checkCollabHealth, validateCardShape, assessCardDepth, distillGuide, identifyIndustry } from './distill/index.js'
export { JARVIS_SYSTEM_PROTOCOL, JARVIS_CULTURE } from './protocol/index.js'
export { COORD_TASK_RE, TERMINAL_TASK_STATUS, ACTIVE_TEAM_MARKER_TTL_MS, ACTIVE_TEAM_MAX_AGE_MS, resolveOwnedTeams, looksLikePluginRepo, stateRootConflict, writeActiveTeamMarker } from './gates/ownership.js'
export { resolveWorkspace, ponderVerifyProjectDir, getFsService, listNames, readTextSafe, hasTeamJson } from './runtime.js'
export { boardFilePath, readBoardItems, writeBoardItems, nextBoardId } from './state/board.js'
export { companyStateFile, readCompanyState, writeCompanyState, syncCompanyState } from './state/company.js'
export { auditTeamBriefs, auditCaptainOwnedTasks, auditStaleTasks, checkTalentPreconditions, checkPonderVerify, checkCoverageGate, hasGlob } from './gates/audit.js'
export { MEMORY_MAX_AGE_MS, checkMemoryFresh, recordGate } from './gates/store.js'
export { JARVIS_STAGES, STAGE_LABELS, STAGE_GATE, STAGE_DENY, PAID_WORK_TOOLS, computeStage, renderStage, jarvisStageGate, captainExecutionGuard } from './gates/stage.js'
export { TEAM_TOOLS, jarvisFlowGuard } from './gates/flow.js'
export { PIXOFFICE_ACTOR_IDS, PIXOFFICE_EVENT_KINDS, PIXOFFICE_COMMANDS, PIXOFFICE_LIMITS, normalizeEventKind, buildPixOfficeFrame, validatePixOfficeFrame, sseFrameString, relaySeqDecision, frameHash, validatePixOfficeCommand } from './pixoffice/index.js'
const _require = createRequire(import.meta.url)


/** 全局协作健康检查：依赖图是否闭环/孤立/有升级路径。 */
import { TOOLS } from './tools/index.js'

// 对外导入面不变：30 个工具汇总在 tools/index.js，这里 re-export（test/plugin.test.js 直接 import TOOLS）
export { TOOLS }
// ── jarvis_flowguard 辅助函数（模块级，TOOLS 数组外）──
/** F4：在**调用方数组上原地**删除满足 pred 的缺项（`missing = missing.filter(...)` 只是参数重绑定，
 *  pre 项永远留在 handler 的数组里 → decompose/design/build/execute 恒 BLOCKED）。
 *  handler 侧也兼容「check 返回新数组」的写法（返回数组则整体替换）。 */
/** /jarvis 命令执行：需求分级 → 返回真实执行产物（含蒸馏/流程/沉淀指令），不再是占位文本 */
export function jarvisCommand(requirement) {
  const text = String(requirement ?? '').trim()
  if (!text) return { content: '用法：/jarvis <需求描述>（可模糊）；续跑用 /jarvis 继续 <上次的工作>' }
  const strict = [
    '【严格模式 · 用户显式调用 /jarvis 时不可违反】',
    '• 能力自检（第一步）：确认可用工具里有 jarvis_flowguard / jarvis_project / jarvis_distill / jarvis_distill_guide / jarvis_member_brief / jarvis_ponder_check / jarvis_coverage / jarvis_board 等 jarvis_* 工具；缺任一 = jarvis 能力未注册 → 明确告知用户「jarvis 能力未注册（插件/预设问题），请检查 luke-jarvis 是否装入当前预设」并停止，禁止用普通会话硬做（否则=跳过 jarvis 能力）。',
    '• 顶层只做四件事：接单判领域 / 派发任务 / 盯控与裁决 / 回显结果。绝不亲自实现、测试、写代码、改文件、跑数据——顶层亲自干 = 缺陷。',
    '• 执行一律由团队成员完成：任务用 agent_teams_create_task 派给成员；成员会话休眠/任务卡住（claimed 未交付、attempt 高产出空）→ agent_teams_reassign_task 唤醒成员或换人，禁止顶层自己顶替。',
    '• 每步过闸：jarvis_flowguard(step=clarify/decompose/design/build/execute/close)；execute 阶段出现「captain 自领未完成任务」或「疑似卡死任务」= BLOCKED，先处理（reassign/换人）再继续。',
  ].join('\n')
  // 续跑意图（/jarvis 继续 / 接着上次 / resume）——绝不能当"模糊需求"反问用户（实测旧版会把"继续"判成模糊）
  if (/^(继续|接着|续跑|续做|接续|resume|continue)/i.test(text)) {
    const resumeActions = [
      '⓪ **先读现状，不许凭记忆猜**：`jarvis_store(mode=check)` 看记忆库；读 `.jarvis/project.md` / `.jarvis/board.json` / `.jarvis/lessons.md`；`agent_teams_status` 看团队与未完成任务清单',
      '① **判你的身份**：你是该团队 captain（回到原会话续跑）→ 直接调度；**不是 captain（新会话）→ agent-teams 绑定 captainSessionId，你无法接管旧团队** → 明确告知用户「请回原 captain 会话续跑，或授权我新建团队」，不许假装接管',
      '② **处理卡死任务**：未完成里 `claimed` 未交付 / `attempt≥4` 产出为空 → `agent_teams_reassign_task` 唤醒成员或换人（**顶层不得自己顶替**）',
      '③ **过闸**：`jarvis_flowguard(step=execute)`——缺前置产物 = BLOCKED，先补齐；出现「captain 自领任务/卡死任务」= BLOCKED，先处理',
      '④ **续跑**：把"下一步该谁做什么"用 `agent_teams_create_task` / `agent_teams_reassign_task` 派给成员，盯控到完成；顶层只派发/盯控/回显',
    ]
    return {
      content: `已识别为「续跑」意图[${text.slice(0, 120)}]。\n⚠️ 续跑 ≠ 新需求：**不要重新判领域、不要重新建队**，先读现状再接着做。\n\n${strict}\n\n【接下来 5 分钟该做什么（照做即可）】\n${resumeActions.join('\n')}\n\n（续跑别的项目：先 cd 到该项目工作区——jarvis 读的是当前工作区 .jarvis/ 记忆。）`,
    }
  }
  const hit = identifyIndustry(text)
  const vague = hit.vague
  // 判领域分支：判不出 → 请用户说具体想干什么；能判 → 走猎头→CEO→专家流程
  let actions = []
  let guidance = ''
  if (vague) {
    // 判不出领域方向（乱用/你好/做个东西）→ 请用户说详细点，从描述判断领域
    actions = [
      '⓪ **先提问（不是干等）**：用 `ask_user_question` 请用户说具体想干什么（想做什么/解决什么问题/给谁用——不用问"哪个领域"这种抽象问题），从回答判断领域方向；再按角色卡专业视角追问细节直到无疑问',
      '① 回复用户：「你想做什么/解决什么问题/给谁用？能具体说说吗」——请用户说详细点',
      '② 从用户的具体描述判断领域方向（如"给员工做考勤"→软件/HR；"养鸡场自动喂食"→农业/自动化）——循环请补充说到能判出',
      '③ 领域判出后 → 蒸馏该领域猎头（人才调度层）→ 猎头供该领域 CEO → CEO 分析需求定一个领域专家 → 双人打磨需求（继续问直到无疑问）',
    ]
    guidance = '⚠️ 判不出领域方向（需求太模糊/无领域线索）——先用 ask_user_question 请用户说具体想干什么（说详细点），从中判断领域，再启动人才'
  } else {
    // 领域可判（或小需求）→ 走完整人才流程；但**第一步永远是按角色卡深度思考需求，真疑问才问，不是机械提问**（lyj 教训：详细需求 0 思考直接开干；用户要求"要的是真正的思考，不是必须问问题——需求很详细也可能没问题"）
    actions = [
      '⓪ **第一步：按角色卡深度思考需求（强制，不是机械提问）**：CEO+领域专家先按各自角色卡专业视角把需求真正想一遍——产出"我的理解 + 我的真疑问清单"；**有真疑问才用 `ask_user_question` 问用户**（问尽所有真疑问、不设数量上限，只问真拿不准的：为谁/边界/优先级/约束/专业盲点），**思考后确实无疑问（需求详细自洽）就直接进下一步，不许硬凑问题打扰用户**；用户回答前涉及该疑问的功能暂停、不猜着做；**没经过角色卡深度思考就建队 = 缺陷**',
      '① 蒸馏该领域猎头（人才调度层——蒸馏自该领域知名猎头/人才寻访权威，过 distill 双闸）',
      '② 猎头供该领域 CEO（按岗位画像找最合适的带队大佬）→ 贾维斯确认',
      '③ CEO 分析需求 → 向猎头定一个领域专家搭档 → 猎头调度给 CEO 确认',
      '④ **全体开会畅所欲言（头脑风暴）+ 归拢**：每个角色（含 CEO+专家+团队）先各自 ponder 理解需求（有自己的见解）→ 全体开会按各自角色工作方式风格自由发言、互相碰撞、挑战用户信息 → **会议后归拢**成"内部共识 + 分歧点 + 待用户确认清单"（写贾维斯公屏）→ 真疑问才用 `ask_user_question` 问用户（问尽所有真疑问、不设数量上限）；**若 ⓪ 已思考过且无疑问则复用结论，不重复问** → 需求清晰',
      '⑤ 需求无问题 → CEO+专家定团队规模/人员列表 → 猎头逐个调度 → CEO+专家确认够格 → kickoff 开工',
      '⑥ **每步过「步骤守卫」jarvis_flowguard（"每个步骤必须执行"——用户强调，不可跳过）**：进 拆解/方案/建队/执行/收口 每个阶段前，先 `jarvis_flowguard(step=<阶段>)` 检查前置产物，**缺 = BLOCKED = 不许进下一步，先补齐**（需求规格→任务编排→方案设计→开工须知→黑板/差异销项——前一步产物没齐，后一步不许开工）；**每个阶段产物没齐就往下走 = 跳步 = 缺陷**',
    ]
    guidance = hit.domainDeterminable ? '✅ 领域可从文本判断，启动人才流程（**注意：先按角色卡思考需求、真疑问才问，再建队；每个阶段过 jarvis_flowguard 步骤守卫，缺前置产物=BLOCKED 不许跳过**）' : '（小需求/无领域线索但可直接做——按需走或直接做，但有真疑问就先问；每个阶段过 jarvis_flowguard 步骤守卫）'
  }
  return {
    content: `已收到需求[${text.slice(0, 120)}]。\n${guidance}\n\n${strict}\n\n【接下来 5 分钟该做什么（照做即可）】\n${actions.join('\n')}\n\n（完整协议见 jarvis 技能：核心协议 5 步主干 + 判领域/猎头调度/CEO+专家打磨/三产物闸/测试返工/收口核对。铁律：真实优先不编造；做客户要的；卡不贵多贵有用。）`,
  }
}


// 声明注入：apply 在 tools 服务就绪后才执行（修复"服务不可用导致工具未注册"）
export const inject = ['tools', 'webServer', 'agents', 'systemPrompt']
let officeSeq = 0



/**
 * 路由期工作区解析（HTTP handler 没有 exec，不能只靠 apply 期单例）。
 * 顺序：?workspace=<真实路径> > agents.list() 里的会话 cwd > 最近一次工具调用的会话 cwd > 单例。
 * 背景：systemd 起服务时 process.cwd()='/'，apply 期预热会缓存 '/'，导致
 *       /api/luke-jarvis/board 读 `/.jarvis/board.json`（真机实测 404）。
 */
function firstSessionCwd(ctx) {
  try {
    const agents = ctx && typeof ctx.get === 'function' ? ctx.get('agents') : undefined
    const list = agents && typeof agents.list === 'function' ? agents.list() : []
    for (const a of Array.isArray(list) ? list : []) {
      const w = a && a.session && a.session.header && a.session.header.cwd
      if (typeof w === 'string' && w.length > 0) return w
    }
  } catch { /* 无 agents 服务：继续降级 */ }
  return ''
}

function requestWorkspace(ctx, req) {
  try {
    const m = String((req && req.url) || '').match(/[?&]workspace=([^&]+)/)
    if (m) {
      const v = decodeURIComponent(m[1])
      if (v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v)) return v
    }
  } catch { /* 非法 query：忽略 */ }
  try {
    const ag = getLatestExec() && getLatestExec().agent
    const w = ag && ag.session && ag.session.header && ag.session.header.cwd
    if (typeof w === 'string' && w.length > 0) return w
  } catch { /* 没 exec：继续 */ }
  const live = firstSessionCwd(ctx)
  if (live) return live
  // 不吃 apply 期缓存：它是 process.cwd()（systemd 下 '/'、测试里是插件仓库），拿它拼出的 .jarvis 必错。
  // 宁可明确说「没解析到工作区」，也不给一个看起来能用、实际读到空/别处的路径。
  return ''
}

export const name = 'luke-jarvis'

export function apply(ctx) {
    setRuntimeContext(ctx)
    resolveWorkspace(ctx) // 预热：apply 时即解析用户工作区（首个工具调用即用对路径）

    // ── T11：PixOffice relay 路由（方案B）──
    // 上游页面用 EventSource(<relayUrl>/api/pixoffice/events) 拉单帧 JSON 快照，再发 messages/reply 命令。
    // 我们这里只做「投影 + 下发」，不实现上游的业务逻辑；命令校验按白名单（越界明确拒绝，不静默吞）。
    try {
      const webSvcRelay = (ctx && ctx.webServer) || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
      if (webSvcRelay && typeof webSvcRelay.register === 'function') {
        const relayPath = _require('node:path') // apply 作用域里没有模块级 path（relay 路由里要用 basename）
        const relayDir = (req) => {
          try {
            const q = String((req && req.url) || '')
            const m = q.match(/[?&]workspace=([^&]+)/)
            if (m) {
              const v = decodeURIComponent(m[1])
              // 上游页面把 workspace 当**布尔开关**发（?workspace=1）；只有「看起来像路径」的值才当目录，
              // 否则会把 workspace.id 派生成 jarvis-1 且读到空员工表（实测：employees=0）。
              if (v && (v.startsWith('/') || v.includes('/'))) return v
            }
          } catch { /* 忽略 */ }
          return resolveWorkspace(getRuntimeContext()) || process.cwd()
        }
        const relayReadState = async (req) => {
          const cwd = relayDir(req)
          let fsSvc = null
          try { fsSvc = getFsService(null) } catch { fsSvc = null }
          const state = await readCompanyState(fsSvc, cwd)
          return { cwd, state: state || {}, seq0: Number((state && state.__seq) || 0) }
        }
        // ① SSE：/api/pixoffice/events
        ctx.effect(() =>
          webSvcRelay.register({
            kind: 'exact',
            path: '/api/pixoffice/events',
            handler: async (req, res) => {
              const headers = {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-store',
                connection: 'keep-alive',
                'access-control-allow-origin': '*',
              }
              try {
                res.writeHead(200, headers)
                if (typeof res.flushHeaders === 'function') res.flushHeaders()
              } catch { return }
              // seq 必须**跨连接单调**：上游页面把 offices+seq 持久化（localStorage），重连后按 seq>=local 才应用；
              // 旧实现每条连接从 1 数 → 重连后前 N 帧被上游当过期静默丢弃（画面冻结、无错误提示）。
              const relaySeqState = (globalThis.__JARVIS_RELAY_SEQ__ = globalThis.__JARVIS_RELAY_SEQ__ || new Map())
              let workspaceIdForSeq = ''
              const lastEventId = Number((req && req.headers && req.headers['last-event-id']) || 0)
              let seq = 1
              let prev = null
              let closed = false
              const write = (frame) => {
                const verdict = validatePixOfficeFrame(frame)
                if (!verdict.ok) {
                  // 校验失败必须发 error 帧（页面据此判断 INVALID_BINDING 等），不能静默丢弃
                  try { res.write(sseFrameString({ type: 'error', seq: frame.seq, code: verdict.errors[0].code, errors: verdict.errors })) } catch {}
                  return false
                }
                try {
                  // id: 让浏览器在重连时回传 Last-Event-ID（配合上面的跨连接 seq，实现断线续传）
                  res.write('id: ' + String(frame.seq) + '\n')
                  res.write(sseFrameString(frame))
                  relaySeqState.set(workspaceIdForSeq, frame.seq)
                } catch { return false }
                return true
              }
              const tick = async () => {
                if (closed) return
                try {
                  const { cwd, state } = await relayReadState(req)
                  workspaceIdForSeq = 'jarvis-' + relayPath.basename(cwd)
                  const floor = Math.max(Number(relaySeqState.get(workspaceIdForSeq) || 0), lastEventId)
                  if (seq <= floor) seq = floor + 1 // 跨连接续传：从工作区已发到的 seq 之后继续
                  const frame = buildPixOfficeFrame(state, { seq, workspaceId: workspaceIdForSeq, workspaceName: 'Jarvis 数字员工公司' })
                  const decision = relaySeqDecision(prev, frame)
                  if (!prev) {
                    if (write(frame)) { prev = { seq: frame.seq, hash: frameHash(frame) }; seq += 1 }
                  } else if (decision.status === 'fresh') {
                    const distinct = frameHash(frame)
                    if (distinct !== prev.hash) {
                      if (write(frame)) { prev = { seq: frame.seq, hash: distinct }; seq += 1 }
                    } else if (Number(prev.seq) === frame.seq) {
                      // 内容没变 → 同 seq 幂等跳过（不重发，避免上游把重复帧当 409）
                      return
                    }
                  } else if (decision.status === 'conflict') {
                    try { res.write(sseFrameString({ type: 'error', seq: frame.seq, code: 'STALE_SEQ', message: decision.reason })) } catch {}
                  }
                  // 心跳（保持 EventSource 不被中间层断开）
                  try { res.write(': keep-alive\n\n') } catch {}
                } catch (e) {
                  try { res.write(sseFrameString({ type: 'error', seq, code: 'RELAY_ERROR', message: String((e && e.message) || e) })) } catch {}
                }
              }
              await tick()
              const timer = setInterval(() => { tick() }, 4000)
              const close = () => { closed = true; clearInterval(timer); try { res.end() } catch {} }
              if (req && typeof req.on === 'function') req.on('close', close)
              if (typeof res.on === 'function') res.on('close', close)
            },
          })
        )
        // ② 页面 → relay 的命令：/api/pixoffice/messages（白名单校验）
        ctx.effect(() =>
          webSvcRelay.register({
            kind: 'exact',
            path: '/api/pixoffice/messages',
            handler: async (req, res) => {
              const send = (status, body) => {
                try { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)) } catch {}
              }
              if (!req || req.method !== 'POST') return send(405, { ok: false, error: 'method-not-allowed' })
              let body = null
              try {
                const chunks = []
                if (typeof req.on === 'function') {
                  await new Promise((resolve) => {
                    req.on('data', (c) => chunks.push(c))
                    req.on('end', resolve)
                    req.on('error', resolve)
                  })
                } else if (typeof req.text === 'function') {
                  chunks.push(await req.text())
                }
                const raw = chunks.map((c) => (Buffer.isBuffer(c) ? c.toString('utf8') : String(c))).join('')
                body = raw ? JSON.parse(raw) : null
              } catch { body = null }
              const verdict = validatePixOfficeCommand(body)
              if (!verdict.ok) return send(400, verdict)
              return send(200, { ok: true, accepted: verdict.command, at: new Date().toISOString() })
            },
          })
        )
        // ③ UI 状态：/api/pixoffice/ui
        ctx.effect(() =>
          webSvcRelay.register({
            kind: 'exact',
            path: '/api/pixoffice/ui',
            handler: async (req, res) => {
              const send = (status, body) => {
                try { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)) } catch {}
              }
              try {
                const { cwd, state } = await relayReadState(req)
                return send(200, { ok: true, workspace: { id: 'jarvis-' + relayPath.basename(cwd), name: 'Jarvis 数字员工公司' }, phase: String((state && state.phase) || ''), employees: Array.isArray(state && state.employees) ? state.employees.length : 0 })
              } catch (e) {
                return send(500, { ok: false, error: String((e && e.message) || e) })
              }
            },
          })
        )
        // ④ 回执：/api/pixoffice/reply（上游发送后等回执，缺了会重试）
        ctx.effect(() =>
          webSvcRelay.register({
            kind: 'exact',
            path: '/api/pixoffice/reply',
            handler: async (req, res) => {
              const send = (status, body) => {
                try { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)) } catch {}
              }
              if (!req || req.method !== 'POST') return send(405, { ok: false, error: 'method-not-allowed' })
              return send(200, { ok: true, at: new Date().toISOString() })
            },
          })
        )
      }
    } catch { /* webServer 不可用：relay 降级（页面会显示连接失败） */ }

    // ── webServer route：client 静态 bundle 读取黑板（host.call 仅 dynamic 沙箱可用，静态走 HTTP）──
    try {
      const webSvc = (ctx && ctx.webServer) || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
      if (webSvc && typeof webSvc.register === 'function') {
        ctx.effect(() =>
          webSvc.register({
            kind: 'exact',
            path: '/api/luke-jarvis/board',
            handler: async (req, res) => {
              const send = (status, body) => {
                try { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) } catch {}
              }
              if (!req || req.method !== 'GET') return send(405, { items: [], error: 'method-not-allowed' })
              try {
                const cwd = requestWorkspace(ctx, req)
                if (!cwd) return send(200, { items: [], active: false, reason: 'no workspace（未从会话解析到工作区，可加 ?workspace=<路径>）' })
                const boardPath = cwd + '/.jarvis/board.json'
                let fsSvc = null
                try { fsSvc = ctx.get('fs') } catch { fsSvc = null }
                if (!fsSvc || typeof fsSvc.readText !== 'function') return send(200, { items: [], error: 'fs 不可用' })
                const target = await fsSvc.resolve(boardPath)
                if (!target) return send(200, { items: [], active: false, reason: 'no .jarvis' })
                const text = await fsSvc.readText(target)
                if (!text) return send(200, { items: [], active: false, reason: 'empty board' })
                let data = null
                try { data = JSON.parse(text) } catch { data = null }
                if (!data || !Array.isArray(data.items)) return send(200, { items: [], active: true, reason: 'bad json' })
                return send(200, {
                  items: data.items.map((it) => ({
                    id: String(it.id || ''),
                    role: String(it.role || ''),
                    type: String(it.type || '问题'),
                    content: String(it.content || '').slice(0, 200),
                    status: String(it.status || 'open'),
                    essenceChecked: Boolean(it.essenceChecked),
                  })),
                  active: true,
                })
              } catch (e) {
                return send(200, { items: [], error: String(e && e.message ? e.message : e) })
              }
            }
          })
        )
      }
    } catch {}

    // ── 像素办公室（PixOffice）一体托管：静态页 + 业务快照接口 ──────────────────
    // 数据流：jarvis_company 写 .jarvis/company-state.json → 本进程读文件 → 投影成
    // PixOffice 快照 → 前端页面（SSE/POST 同源）→ 人物/任务/白板动起来。
    try {
      const webSvc2 = (ctx && ctx.webServer) || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
      if (webSvc2 && typeof webSvc2.register === 'function') {
        const path = _require('node:path')
        const fsm = _require('node:fs')
        const officeRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '../../office')
        const MIME = {
          '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
          '.svg': 'image/svg+xml', '.gif': 'image/gif', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
          '.map': 'application/json; charset=utf-8',
        }
        // 0) 官方 UI 入口（T8/T9）：GET /jarvis-ui → 302 跳 /jarvis-office/jarvis.html。
        //    T9 起指向「本公司数据适配页」（左侧实时数据面板 + PixOffice 场景 iframe）；
        //    上游 demo 页 /jarvis-office/office/index.html 保持不动（仍可直接访问，用于对照）。
        //    必须是 exact route 且注册在 prefix 静态路由之前（否则前缀路由会先吃掉匹配）。
        ctx.effect(() =>
          webSvc2.register({
            kind: 'exact',
            path: '/jarvis-ui',
            handler: async (req, res) => {
              try {
                res.writeHead(302, { location: '/jarvis-office/jarvis.html', 'cache-control': 'no-store' })
                res.end('→ /jarvis-office/jarvis.html')
              } catch {}
            },
          })
        )
        // 1) 快照接口：把 company-state.json 投影成 PixOffice 业务快照
        ctx.effect(() =>
          webSvc2.register({
            kind: 'exact',
            path: '/api/luke-jarvis/company',
            handler: async (req, res) => {
              const send = (status, body) => {
                try { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)) } catch {}
              }
              try {
                const cwd = requestWorkspace(ctx, req)
                if (!cwd) return send(200, { ok: true, active: false, reason: 'no workspace' })
                const target = path.join(cwd, '.jarvis/company-state.json')
                let state = null
                try { state = JSON.parse(fsm.readFileSync(target, 'utf8')) } catch { state = null }
                const seq = Number(state && state.__seq) > 0 ? Number(state.__seq) : (officeSeq = (officeSeq || 0) + 1)
                const snap = toPixOfficeSnapshot(state || {}, { seq, workspaceId: 'jarvis-' + path.basename(cwd), workspaceName: (state && state.company && state.company.name) || 'Jarvis 数字员工公司' })
                return send(200, { ok: true, active: Boolean(state), snapshot: snap })
              } catch (e) {
                return send(200, { ok: false, active: false, error: String((e && e.message) || e) })
              }
            },
          })
        )
        // 2) 静态托管 /jarvis-office/*
        ctx.effect(() =>
          webSvc2.register({
            kind: 'prefix',
            path: '/jarvis-office',
            handler: async (req, res) => {
              try {
                const url = String((req && req.url) || '/')
                let rel = decodeURIComponent(url.split('?')[0].replace(/^\/jarvis-office\/?/, ''))
                if (!rel || rel.endsWith('/')) rel += 'office/index.html'
                const abs = path.join(officeRoot, rel)
                if (!abs.startsWith(officeRoot)) { res.writeHead(403); return res.end('forbidden') }
                const data = fsm.readFileSync(abs)
                const ext = path.extname(abs).toLowerCase()
                res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' })
                return res.end(data)
              } catch {
                try { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found') } catch {}
              }
            },
          })
        )
      }
    } catch {}
    // 0) 固定注入 jarvis 工作方式（每次请求都带，不依赖 skill、不受压缩影响）
    try {
      const sp = (ctx && ctx.systemPrompt) || (typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined)
      if (sp && typeof sp.section === 'function') {
        ctx.effect(() =>
          sp.section({
            name: 'luke-jarvis:protocol',
            order: 118,
            // 全局 section 的 AssembleContext 只有 { scope, signal }，拿不到会话工作区；
            // 「当前第几步」由 tools/index.js 按 agent 注册 luke-jarvis:stage section 提供。
            text: () => JARVIS_SYSTEM_PROTOCOL,
          })
        )
      }
    } catch {}

    // 1) 模型工具：tools 已注入（ctx.tools 就绪）；对无注入能力的宿主/测试环境降级 ctx.get
    const toolsSvc =
      (ctx && ctx.tools) || (typeof ctx.get === 'function' ? ctx.get('tools') : undefined)
    if (toolsSvc && typeof toolsSvc.register === 'function') {
      // TOOLS 已在 tools/index.js 规范成 DSH ToolDefinition（execute + output{schema,render}），
      // 这里直接注册，不再二次包装（包装会让「契约」出现两份实现）。
      for (const def of TOOLS) ctx.effect(() => toolsSvc.register(def))
    } else {
      console.error('[luke-jarvis] tools 服务不可用，模型工具未注册')
    }

    // 1.5) 插件级硬拦截：顶层 captain 不得亲自执行（作用于**已存在**会话——preset 无法追溯修改时的兜底）
    //      顺序：captain 拦截（capability）→ 阶段网关（stage）→ 流程闸（具体工具前置条件）。
    //      阶段网关在前，是为了让「你走错阶段」的指引先于具体前置条件到达模型（方案设计 §2.3）。
    try {
      if (toolsSvc && typeof toolsSvc.guard === 'function') {
        ctx.effect(() => toolsSvc.guard(captainExecutionGuard))
        ctx.effect(() => toolsSvc.guard(jarvisStageGate))
        ctx.effect(() => toolsSvc.guard(jarvisFlowGuard))
      }
    } catch {}

    // 2) /jarvis 命令：commands 为可选服务——优先懒注入（就绪后自动注册），无 inject 能力时降级 get
    const registerJarvisCommand = (commandCtx) => {
      ctx.effect(() =>
        commandCtx.register({
          name: 'jarvis',
          description: '贾维斯数字员工公司（领域无关）：需求分级 → CEO 定领域流程(jarvis_process) → 现场蒸馏角色卡(jarvis_distill 校验) → 项目沉淀(jarvis_store) → 协同(jarvis_collab) → kickoff 会 → 独思(think_deep) → 黑板(board) → 按需二次会(review+essence) → 问题上行(escalate) → 能力补足(capability) → 收口',
          usage: '/jarvis <需求描述>',
          execute: async (agent, line) => {
            const r = jarvisCommand(line)
            return { kind: 'success', text: typeof r === 'string' ? r : r.content }
          },
        }),
      )
    }
    if (typeof ctx.inject === 'function') {
      ctx.inject(['commands'], registerJarvisCommand)
    } else {
      const commands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined
      if (commands && typeof commands.register === 'function') registerJarvisCommand(commands)
      else console.error('[luke-jarvis] commands 服务不可用，/jarvis 命令未注册')
    }

    // ── Client RPC：读黑板（web 面板用）──
    // 仅当当前会话工作区存在 .jarvis/board.json 时返回内容，否则返回空（Client 不渲染）
    // 这样：用了 /jarvis 的会话（工作区有 .jarvis/）才有黑板面板，其他会话不显示 = 不入侵。
    // harness 为全局服务，就绪时间不定：internal/service 事件 + 有界轮询兜底，注册一次后停止。
    let boardRpcRegistered = false
    const registerBoardRpc = () => {
      if (boardRpcRegistered) return true
      if (!globalThis.harness || typeof globalThis.harness.handle !== 'function') return false
      try {
        ctx.effect(
          () =>
            globalThis.harness.handle('jarvis/board', async (args) => {
              const sessionId = args && args.sessionId ? String(args.sessionId) : ''
              try {
                // RPC 路径没有 req/res：用同一个解析器（无 query 时按 live 会话走），返回对象而非 HTTP
                const cwd = requestWorkspace(ctx, { url: '' })
                if (!cwd) return { items: [], active: false, reason: 'no workspace' }
                const boardPath = cwd + '/.jarvis/board.json'
                let fsSvc = null
                try { fsSvc = ctx.get('fs') } catch { fsSvc = null }
                if (!fsSvc || typeof fsSvc.readText !== 'function') {
                  return { items: [], error: 'fs 不可用' }
                }
                const target = await fsSvc.resolve(boardPath)
                if (!target) return { items: [], active: false, reason: 'no .jarvis' }
                const text = await fsSvc.readText(target)
                if (!text) return { items: [], active: false, reason: 'empty board' }
                let data = null
                try { data = JSON.parse(text) } catch { data = null }
                if (!data || !Array.isArray(data.items)) return { items: [], active: true, reason: 'bad json' }
                return {
                  items: data.items.map((it) => ({
                    id: String(it.id || ''),
                    role: String(it.role || ''),
                    type: String(it.type || '问题'),
                    content: String(it.content || '').slice(0, 200),
                    status: String(it.status || 'open'),
                    essenceChecked: Boolean(it.essenceChecked),
                  })),
                  active: true,
                  sessionId,
                }
              } catch (e) {
                return { items: [], error: String(e && e.message ? e.message : e) }
              }
            }),
        )
        boardRpcRegistered = true
        return true
      } catch {
        return false
      }
    }
    if (!registerBoardRpc()) {
      let tries = 0
      let timer = null
      try {
        ctx.on('internal/service', () => {
          if (!boardRpcRegistered) registerBoardRpc()
        })
      } catch { /* 事件钩子不可用时靠轮询兜底 */ }
      try {
        timer = ctx.setInterval(() => {
          tries += 1
          if (registerBoardRpc() || tries >= 20) {
            if (timer && typeof timer === 'function') timer()
          }
        }, 1500)
      } catch { /* 定时器不可用时静默（黑板 RPC 为可选能力） */ }
    }
}
