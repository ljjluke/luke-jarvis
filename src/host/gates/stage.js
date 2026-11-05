/** 阶段状态机：由插件按 .jarvis 产物 + 闸门「算」出当前阶段（不是模型自述），并据此拦流程/执行工具。
 *
 *  判据来源全部是事实（docs 产物、gates.json、.agent-teams 归属）；缺口与下一步直接注入 systemPrompt。
 *  依赖：gates/store（读闸、工作区画像）、gates/ownership（归属团队）。
 */
import { createRequire } from 'node:module'
import { _readGates, _flowState } from './store.js'
import { resolveOwnedTeams, ACTIVE_TEAM_MAX_AGE_MS, ARCHIVED_TEAM_RE } from './ownership.js'
const _require = createRequire(import.meta.url)

// ── 插件级「顶层 captain 不得亲自执行」硬拦截 ─────────────────────────────
// 背景（scan 教训）：老会话的 preset 带完整执行工具（bash/edit），且 preset 在会话创建时
// 固化、无法追溯修改 → 顶层 captain 于是自己把活干完（实证：某 captain 会话 bash 5.7 万次）。
// 此 guard 直接拦在工具执行前，**对已存在会话同样生效**：
//   • 仅当调用会话 = 「jarvis 工作区（有 .jarvis/）+ 某团队 team.json 的 captainSessionId」时才拦；
//   • 只拦执行类工具（bash/pwsh/edit/write/subagent/workflow/ralph）；
//     read/glob/grep（只读查看）与 agent_teams_*/jarvis_*（派发与流程）不受影响；
//   • 成员会话（非 captain）完全不受影响。
const CAPTAIN_DENY_TOOLS = new Set([
  'bash', 'pwsh', 'edit', 'write',
  'subagent', 'subagent_fork', 'subagent_codex', 'subagent_claude_code',
  'workflow', 'ralph',
])
const _captainCache = { at: 0, cwd: '', ids: new Set() }
export function _captainIds(cwd) {
  const now = Date.now()
  if (_captainCache.cwd === cwd && now - _captainCache.at < 3000) return _captainCache.ids
  const ids = new Set()
  try {
    const fs = _require('node:fs')
    const path = _require('node:path')
    // 只对 jarvis 工作区生效（非 jarvis 项目不受影响）；.jarvis/allow-captain-exec = 逃生阀
    if (fs.existsSync(path.join(cwd, '.jarvis')) && !fs.existsSync(path.join(cwd, '.jarvis/allow-captain-exec'))) {
      const teamsDir = path.join(cwd, '.agent-teams')
      for (const team of fs.readdirSync(teamsDir)) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(teamsDir, team, 'team.json'), 'utf8'))
          if (d && d.captainSessionId) ids.add(String(d.captainSessionId))
        } catch { /* 单个团队坏文件忽略 */ }
      }
    }
  } catch { /* 无 .agent-teams/权限 → 不拦 */ }
  _captainCache.at = now
  _captainCache.cwd = cwd
  _captainCache.ids = ids
  return ids
}
/** guard：返回字符串 = 拒绝该次工具调用；返回 undefined = 放行。 */
// ── 阶段状态机（补充 P1，借鉴 dsh-superagent 的 core/stage.ts）────────────────
// 核心思想：**阶段由插件按事实计算，不是模型自述**。每次请求把"当前第几步/缺什么/下一步做什么"注入 systemPrompt。
export const JARVIS_STAGES = ['clarify', 'decompose', 'design', 'build', 'execute', 'close']
export const STAGE_LABELS = {
  clarify: '需求打磨', decompose: '拆解', design: '方案设计', build: '建队派活', execute: '执行盯控', close: '收口',
}
export const STAGE_GATE = { // 该阶段必须持哪个闸才算过
  clarify: 'clarify', decompose: 'decompose', design: 'design', build: 'build', execute: null, close: null,
}
/** 计算当前阶段（纯读文件，无副作用） */
export function computeStage(cwd, opts = {}) {
  const fs = _require('node:fs')
  const path = _require('node:path')
  const base = String(cwd || '')
  const sessionIdOpt = String((opts && opts.sessionId) || '')
  const gates = _readGates(base)
  const gateOk = (k) => Boolean(gates[k] && gates[k].ok)
  const hasDoc = (re) => { try { return fs.readdirSync(path.join(base, '.jarvis/docs')).some((n) => re.test(n)) } catch { return false } }
  let cards = 0
  try { cards = fs.readdirSync(path.join(base, '.jarvis/cards')).filter((n) => n.endsWith('.md')).length } catch {}
  const td = path.join(base, '.agent-teams')
  let teams = 0
  let openTasks = 0
  const now = Date.now()
  // D5-v2：归属标记优先（见上方 readActiveTeamMarker 注释）；无标记才回退 72h 启发式。
  // T13 ①：归属判定只走 resolveOwnedTeams（单一实现）；marker 过期/缺失时它内部回退 72h。
  const ownedInfo = resolveOwnedTeams(base, sessionIdOpt)
  const marker = ownedInfo.marker
  const activeSet = new Set(ownedInfo.teams)
  try {
    for (const t of fs.readdirSync(td)) {
      if (ARCHIVED_TEAM_RE.test(String(t))) continue // 归档目录不是活跃团队
      let teamFile = ''
      try {
        teamFile = path.join(td, String(t), 'team.json')
        if (!fs.statSync(teamFile).isFile()) continue
      } catch { continue } // 无 team.json（retired-members.json 等杂项）不计
      teams += 1
      try {
        const d = JSON.parse(fs.readFileSync(teamFile, 'utf8'))
        // 归属只认 resolveOwnedTeams 的结果（T13：单一判定源；不再在这里手写第二份归属逻辑）
        if (activeSet.size > 0 && !activeSet.has(String(t))) continue
        if (activeSet.size === 0 && now - fs.statSync(teamFile).mtimeMs > ACTIVE_TEAM_MAX_AGE_MS) continue
        openTasks += (d.tasks || []).filter((x) => !['completed', 'cancelled'].includes(String(x.status))).length
      } catch { /* 坏 JSON/无权限 → 该团队不计未完成，不崩 */ }
    }
  } catch { /* 无 .agent-teams → teams=0/openTasks=0 */ }
  const reqDoc = hasDoc(/^需求规格/)
  const taskmap = hasDoc(/^任务编排/)
  const designDoc = hasDoc(/^方案设计/)
  let verify = 0
  try { verify = fs.readdirSync(path.join(base, '.jarvis/docs/ponder-verify')).filter((n) => n.endsWith('.json')).length } catch {}

  const states = [
    { id: 'clarify', ok: reqDoc && gateOk('clarify'), missing: [...(reqDoc ? [] : ['.jarvis/docs/需求规格-*.md（≥300字且含验收）']), ...(gateOk('clarify') ? [] : ['jarvis_flowguard(step="clarify")'])], next: '打磨需求 → 产出需求规格 → jarvis_flowguard(step="clarify")' },
    { id: 'decompose', ok: taskmap && gateOk('decompose'), missing: [...(taskmap ? [] : ['.jarvis/docs/任务编排-*.md（先跑 jarvis_taskgraph）']), ...(gateOk('decompose') ? [] : ['jarvis_flowguard(step="decompose")'])], next: 'jarvis_taskgraph 出任务编排 → jarvis_flowguard(step="decompose")' },
    { id: 'design', ok: designDoc && gateOk('design'), missing: [...(designDoc ? [] : ['.jarvis/docs/方案设计-*.md']), ...(gateOk('design') ? [] : ['jarvis_flowguard(step="design")'])], next: '产出方案设计（每条需求→实现落点）→ jarvis_flowguard(step="design")' },
    { id: 'build', ok: cards >= 2 && teams > 0 && gateOk('build'), missing: [...(cards >= 2 ? [] : [`.jarvis/cards/ 角色卡（当前 ${cards} 张，需≥2：带队卡+岗位卡）`]), ...(teams > 0 ? [] : ['建队（agent_teams_create）']), ...(gateOk('build') ? [] : ['jarvis_flowguard(step="build")'])], next: 'jarvis_distill 蒸馏角色卡 → jarvis_flowguard(step="build") → agent_teams_create → add_member' },
    { id: 'execute', ok: openTasks === 0 && teams > 0, missing: [...(openTasks === 0 ? [] : [`未完成任务 ${openTasks} 个`])], next: 'jarvis_dispatch_task 派活（自动带卡+须知）→ 盯控(agent_teams_status) → 交付物/证据验收' },
    // R1/②：close.ok 不再恒 false——由「收口闸」真实判定（gateOk('close')），过了才算收口完成。
    // 否则过了 flowguard(step="close") 阶段也永远停在 6/6「收口未完成」，`done` 永不包含 close（T3 报告 §三 边界 5）。
    // 纵深防御：再加 openTasks===0（闸是「历史上跑过一次」，任务可能被重新打开；闸过期不能授予「完成」）。
    // 诚实边界：close.ok 只表示「闸已过 + 当前无未完成任务」，不等于收口质量——质量由 flowguard(step="close") 的 9 条检查决定。
    { id: 'close', ok: gateOk('close') && openTasks === 0, missing: [...(gateOk('close') ? [] : ['jarvis_flowguard(step="close")（三产物闭环+覆盖矩阵+黑板归拢）']), ...(openTasks === 0 ? [] : [`未完成任务 ${openTasks} 个（收口闸过期或被重开任务，需重跑 flowguard(step="close")）`])], next: 'jarvis_coverage(persist) → jarvis_essence → jarvis_flowguard(step="close") → jarvis_snapshot' },
  ]
  const firstOpen = states.findIndex((x) => !x.ok)
  const allOk = firstOpen === -1
  const idx = allOk ? states.length - 1 : firstOpen
  const cur = states[idx]
  // close 已通过（全部 ok）时 done 必须包含 close（原实现 slice(0,5) 会漏掉最后一态 → 永远显示「收口未完成」）。
  const done = allOk ? states.map((x) => x.id) : states.slice(0, idx).map((x) => x.id)
  return {
    stage: cur.id,
    index: idx + 1,
    total: states.length,
    label: STAGE_LABELS[cur.id] || cur.id,
    missing: cur.missing,
    next: cur.next,
    done,
    artifacts: {
      reqDoc, taskmap, designDoc, cards, teams, openTasks, verify,
      // D5-v2 观测：归属判据来源（marker=有归属标记 / mtime-fallback=回退 72h / none=无团队目录）
      activeTeamSource: ownedInfo.source,
      activeTeams: ownedInfo.teams,
    },
    gates,
  }
}
/** 渲染成注入文本 */
export function renderStage(cwd, opts = {}) {
  const r = computeStage(cwd, opts)
  const lines = [
    '【jarvis 当前阶段 · 插件实时计算（不是你的自述）】',
    `阶段 ${r.index}/${r.total}：${r.label}（${r.stage}）`,
    r.done.length ? `已通过：${r.done.join(' → ')}` : '已通过：（无）',
    r.missing.length ? `当前缺口：${r.missing.join('；')}` : '当前缺口：无',
    `下一步：${r.next}`,
    r.stage === 'build' ? '本阶段固化用法：jarvis_dispatch_task(assignee, subject, description, acceptance) 一步完成「角色卡+须知+建任务」，再用 agent_teams_reassign_task 唤醒成员。' : '',
    `事实快照：需求规格=${r.artifacts.reqDoc ? '有' : '无'} 任务编排=${r.artifacts.taskmap ? '有' : '无'} 方案设计=${r.artifacts.designDoc ? '有' : '无'} 角色卡=${r.artifacts.cards} 团队=${r.artifacts.teams} 未完成任务=${r.artifacts.openTasks} ponder记录（可选，不作闸）=${r.artifacts.verify}`,
    '规则：只做当前阶段允许的动作；下游动作（建队/派活）在阶段未过时会被机械闸拒绝。',
  ]
  return lines.join('\n')
}

// ── 阶段网关（P2 · 完全体核心）：工具调用前按 computeStage 阶段机械拒绝「越阶段」────────────────
// 为什么需要：v0.9.0 只有 computeStage + 每请求注入（提示词层），阶段推进全靠模型自觉；
// 长会话/弱模型必然跳步。文字拦不住 → 必须在工具执行前让它**机械失败**（与 flowguard 同族思路）。
// 设计（方案设计-luke-jarvis完全体.md §2）：
//   • deny-list（不是 allowlist）：未知工具默认放行，避免误伤 read/glob/grep/bash 等只读/执行类工具；
//   • 只对流程类工具生效（jarvis_* / agent_teams_*）；
//   • 先判「是否 jarvis 工作区」+「有没有 cwd」——判不出来就放行（与 captainExecutionGuard/jarvisFlowGuard 同款保护），
//     否则全局 guard（dsh-tools：plain-context guard 全局生效）会把纯 agent-teams 用户全误伤；
//   • 否定文案必含三要素：阶段 N/6+名称、当前缺口、下一步（R2 验收点，也是模型唯一的纠错输入）。
// D6：deny 补集显式收窄——把「新流程工具」并入 clarify/decompose/design/build。
// 实测 @nanmicoder/dsh-agent-teams 的 TEAM_TOOL_NAMES 有 14 个（create/approve/edit_plan/add_member/
// remove_member/create_task/reassign_task/claim_task/update_task/amend_task/send_message/status/resume/delete），
// 本表原来只表态 6 个 → amend_task（可改 objective/acceptance/verify、等价于放宽验收）、claim_task（认领任务）
// 在 clarify/design 阶段也能调，阶段隔离形同虚设。
// 边界（诚实标注）：这只是「显式补几项」，不是穷举——完整闭合按 project.md D6 裁决排进 P3 的 meta 穷举
// （遍历流程类工具名，未表态即测试红）。未知工具仍默认放行（deny-list 的固有取舍）。
// F1（T3 打回 medium，R2「clarify 拒绝交活」）：update_task 是成员交活（status=completed）入口，
//   原表未含 → 两道闸都放行，clarify 阶段就能把任务标 completed 造成「假交活」。现并入 clarify/decompose/design；
//   build 阶段起放行（建队后派活/盯控需要）。
// D6b：delete（归档团队）与 resume（复活团队）都能零成本把 openTasks 归零 → 并入 clarify/decompose/design；
//   execute 放行 resume/update/claim/amend（执行期需要复活/交活/返工）。
export const STAGE_DENY = {
  clarify: ['agent_teams_create', 'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_amend_task', 'agent_teams_update_task', 'agent_teams_delete', 'agent_teams_resume', 'agent_teams_approve', 'agent_teams_edit_plan', 'jarvis_taskgraph', 'jarvis_coverage', 'jarvis_release'],
  decompose: ['agent_teams_create', 'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_amend_task', 'agent_teams_update_task', 'agent_teams_delete', 'agent_teams_resume', 'agent_teams_approve', 'agent_teams_edit_plan', 'jarvis_coverage', 'jarvis_release'],
  design: ['agent_teams_create', 'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_amend_task', 'agent_teams_update_task', 'agent_teams_delete', 'agent_teams_resume', 'agent_teams_approve', 'agent_teams_edit_plan', 'jarvis_taskgraph', 'jarvis_coverage', 'jarvis_release'],
  build: ['agent_teams_claim_task', 'agent_teams_amend_task', 'jarvis_taskgraph', 'jarvis_coverage', 'jarvis_release'], // 建队期不许改验收契约/认领（换人 add/remove 仍允许）
  execute: ['jarvis_baseline', 'jarvis_taskgraph', 'jarvis_release'], // 执行期不回头改基线/重拆/改版本账本；claim/update/amend 放行（交活与返工需要）
  close: ['agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_add_member'],
}
/** 派活类工具：除「本阶段允许」外，还必须持完整链（R3：build 必须建立在 clarify→decompose→design 之上） */
export const PAID_WORK_TOOLS = new Set(['agent_teams_create_task', 'agent_teams_reassign_task'])
/** 链式校验：复用 computeStage 返回的 gates（同一份读取结果，避免与 flowguard 两处口径漂移） */
function _stageChainMissing(gates) {
  const g = gates || {}
  const out = []
  if (!(g.clarify && g.clarify.ok)) out.push('clarify（需求打磨）')
  if (!(g.decompose && g.decompose.ok)) out.push('decompose（拆解）')
  if (!(g.design && g.design.ok)) out.push('design（方案设计）')
  if (!(g.build && g.build.ok)) out.push('build（建队）')
  return out
}
/** 拒绝文案（三要素固定：阶段 N/6+名称 / 当前缺口 / 下一步） */
function _stageGateText(st, name, extra) {
  return [
    `【jarvis 阶段网关】当前是「阶段 ${st.index}/${st.total} ${st.label}」，不允许调用 ${name}。`,
    ...(extra ? [extra] : []),
    `当前缺口：${st.missing && st.missing.length ? st.missing.join('；') : '无'}`,
    `下一步：${st.next}`,
    '这是插件按 .jarvis 产物+闸门算出来的阶段，不是提示词建议——先补当前阶段再往下一阶段走（不要试图绕过）。',
  ].join('\n')
}
/**
 * guard：按阶段机械放行/拒绝流程类工具调用。
 * 返回字符串 = 拒绝该次调用；返回 undefined = 放行。
 */
export function jarvisStageGate(exec) {
  try {
    const name = String((exec && exec.name) || '')
    if (!/^(jarvis_|agent_teams_)/.test(name)) return undefined // 只管流程类；read/glob/bash 等不受影响
    const session = exec && exec.agent && exec.agent.session
    const cwd = session && session.header && session.header.cwd
    if (!cwd) return undefined // 判不出工作区 → 放行（不误拦 headless/无 cwd 会话）
    if (!_flowState(String(cwd)).jarvis) return undefined // 非 jarvis 工作区不拦（纯 agent-teams 用户不受影响）
    const st = computeStage(String(cwd))
    // ① 链式校验（R3）：派活必须持完整链；缺哪环点名哪环（与 flowguard 的 chainMissing 同口径）
    if (PAID_WORK_TOOLS.has(name)) {
      const chainMissing = _stageChainMissing(st.gates)
      if (chainMissing.length) {
        return _stageGateText(st, name,
          `缺少前置闸：${chainMissing.join('、')}——派活必须按 clarify → decompose → design → build 逐步过 jarvis_flowguard（每步产物要真实），不允许跳步。`)
      }
    }
    // ② 阶段隔离：命中本阶段 deny-list 即拒（未知工具默认放行）
    const deny = STAGE_DENY[st.stage] || []
    if (!deny.includes(name)) return undefined
    return _stageGateText(st, name)
  } catch { return undefined }
}


export function captainExecutionGuard(exec) {
  try {
    const name = String((exec && exec.name) || '')
    if (!CAPTAIN_DENY_TOOLS.has(name)) return undefined
    const agent = exec && exec.agent
    const session = agent && agent.session
    const sessionId = session && session.id
    const cwd = session && session.header && session.header.cwd
    if (!sessionId || !cwd) return undefined
    // 临时诊断（确认 guard 是否全局生效/是否匹配 captain）→ /tmp/jarvis-captain-guard.log
    try {
      _require('node:fs').appendFileSync(
        '/tmp/jarvis-captain-guard.log',
        `${new Date().toISOString()} tool=${name} sid=${sessionId} cwd=${cwd} captains=[${[..._captainIds(String(cwd))].join(',')}]\n`,
      )
    } catch {}
    if (!_captainIds(String(cwd)).has(String(sessionId))) return undefined
    return `【jarvis 严格闸·插件级】顶层 captain 不得用 ${name} 亲自执行。**立刻改走派活**：① agent_teams_status 先看现有成员与任务；② 建人前查重——add_member 同名会报 "has already been used"，同名就复用或换名；③ 派活：agent_teams_create_task(assignee=成员) 建任务，**任务卡住(claimed 无产出)/成员休眠 → agent_teams_reassign_task 唤醒**，但**成员在忙(member X is busy with tN) → 不要 reassign（会被拒），等它跑完或先看 status**；④ 只读查看用 read/glob/grep；⑤ **不要重试本工具**——派活后成员会开始干活（页面可见子任务）；⑥ **保持本回合活跃**直至成员回报并验收完成（A2A 闭环），期间不做任何 dsh 重启；⑦ **成员数量没有上限**（插件无 8 人限制，别把当前人数当上限）：队伍大就加人，或走三层——让 CEO 成员自己用 agent_teams_create 建子队带人（v0.7.3 已放开成员建队权限）；**绝不要用 subagent 绕过**（那是顶层自己干，属于违规）。`
  } catch {
    return undefined
  }
}
