/** 阶段状态机：由插件按 .jarvis 产物 + 闸门「算」出当前阶段（不是模型自述），并据此拦流程/执行工具。
 *
 *  判据来源全部是事实（docs 产物、gates.json、.agent-teams 归属）；缺口与下一步直接注入 systemPrompt。
 *  依赖：gates/store（读闸、工作区画像）、gates/ownership（归属团队）。
 */
import { createRequire } from 'node:module'
import { _readGates, _flowState } from './store.js'
import { resolveOwnedTeams, ACTIVE_TEAM_MAX_AGE_MS, ARCHIVED_TEAM_RE } from './ownership.js'
import { renderMeetingStatus } from '../state/meetings.js'
const _require = createRequire(import.meta.url)

// ── 插件级「顶层 captain 不得亲自执行」硬拦截 ─────────────────────────────
// 背景（scan 教训）：老会话的 preset 带完整执行工具（bash/edit），且 preset 在会话创建时
// 固化、无法追溯修改 → 顶层 captain 于是自己把活干完（实证：某 captain 会话 bash 5.7 万次）。
// 此 guard 直接拦在工具执行前，**对已存在会话同样生效**：
//   • 仅当调用会话 = 「jarvis 工作区（有 .jarvis/）+ 某团队 team.json 的 captainSessionId」时才拦；
//   • 只拦执行类工具（bash/pwsh/edit/write/subagent/workflow/ralph）；
//     read/glob/grep（只读查看）与 jarvis_*（派发与流程）不受影响；
//   • 成员会话（非 captain）完全不受影响。
const CAPTAIN_DENY_TOOLS = new Set([
  'bash', 'pwsh', 'edit', 'write',
  'subagent', 'subagent_fork', 'subagent_codex', 'subagent_claude_code',
  'workflow', 'ralph',
])
const _captainCache = { at: 0, cwd: '', ids: new Set() }
/** 未建队时的「默认 captain」标记：认不出真实 captain 但工作区是 jarvis 时，
 *  把所有调用当作顶层 captain 处理（见 captainExecutionGuard 的兜底分支）。 */
export const ANY_TOPLEVEL = '__jarvis-any-toplevel__'

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
      let found = 0
      let names = []
      try { names = fs.readdirSync(teamsDir) } catch { names = [] }
      for (const team of names) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(teamsDir, team, 'team.json'), 'utf8'))
          if (d && d.captainSessionId) { ids.add(String(d.captainSessionId)); found++ }
        } catch { /* 单个团队坏文件忽略 */ }
      }
      // 根治（2026-11-16 实证）：认不出 captain（没建队 / team.json 缺失）时，
      // 原实现返回空集 → 守卫完全失效 → 用户在会话里用原生 subagent 随便开子 agent，
      // 全部绕过任务单（实测 14 个会话 tracked=0，UI 只能靠提示卡兜底）。
      // 修法：jarvis 工作区里没有可识别的 captain 时，插入 ANY_TOPLEVEL 标记，
      // 让 captainExecutionGuard 对所有调用方生效——「未建队时谁都别自己执行」。
      if (!found) ids.add(ANY_TOPLEVEL)
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
    { id: 'build', ok: cards >= 2 && teams > 0 && gateOk('build'), missing: [...(cards >= 2 ? [] : [`.jarvis/cards/ 角色卡（当前 ${cards} 张，需≥2：带队卡+岗位卡）`]), ...(teams > 0 ? [] : ['建队（jarvis_company 员工落盘）']), ...(gateOk('build') ? [] : ['jarvis_flowguard(step="build")'])], next: 'jarvis_distill 蒸馏角色卡 → jarvis_company 员工落盘 → jarvis_flowguard(step="build")' },
    { id: 'execute', ok: openTasks === 0 && teams > 0, missing: [...(openTasks === 0 ? [] : [`未完成任务 ${openTasks} 个`])], next: 'jarvis_dispatch_task 派活（自动带卡+须知，开单即派原生 subagents 执行）→ 盯控(jarvis_ticket list/get) → 交付物/证据验收' },
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
    r.stage === 'build' ? '本阶段固化用法：jarvis_dispatch_task(assignee, subject, description, acceptance) 一步完成「角色卡+须知+开单」，开单即由原生 subagents 派成员执行；卡住用 jarvis_ticket（action=retry）重派。' : '',
    (() => { try { return renderMeetingStatus(cwd, undefined, { teams: r.artifacts.activeTeams || [] }) } catch { return '' } })(),
    `事实快照：需求规格=${r.artifacts.reqDoc ? '有' : '无'} 任务编排=${r.artifacts.taskmap ? '有' : '无'} 方案设计=${r.artifacts.designDoc ? '有' : '无'} 角色卡=${r.artifacts.cards} 团队=${r.artifacts.teams} 未完成任务=${r.artifacts.openTasks} ponder记录（可选，不作闸）=${r.artifacts.verify}`,
    '规则：只做当前阶段允许的动作；下游动作（建队/派活）在阶段未过时会被机械闸拒绝。',
  ]
  return lines.join('\n')
}

// ── 流程产物写入闸（v0.27·用户定调 2026-11-26「每个动作都需要代码控制」）──
//
// 为什么需要：阶段网关（STAGE_DENY）只按**工具名**拦，绕开它只需要换个写文件的方式：
//   clarify 阶段 → jarvis_store(itemType=doc, name=方案设计-xxx) → 方案设计文件凭空出现
//   → design 闸看到文件存在就放行 → **方案设计这一步实质被跳过**。
//   这不是提示词能挡住的（它是真实的文件写入动作），必须在写入前机械拒绝。
//
// 判据（全部机械可判，不看模型自述）：
//   · 目标是 .jarvis/docs/ 下的**流程产物**（按文件名前缀识别，表见 PRODUCT_STAGE）
//   · 该产物归属某个阶段（需求规格→clarify / 任务编排→decompose / 方案设计→design）
//   · 当前阶段必须 >= 该产物所属阶段 —— 不许超前写下游产物
//   · 允许重写本阶段及更早阶段的产物（返工是正常流程）
//
// 边界（刻意收窄，避免误伤）：
//   · 只针对 docs/ 下的流程产物；reports/designs/scripts/docs 里的**交付文档**、
//     成员写的代码/报告/交付物，完全不拦
//   · 只拦「写」动作（jarvis_store 的 save、write/edit 工具写到 docs/ 流程产物路径）
//   · 只在写入时校验，不重判历史（存量项目已写好的产物不追溯推翻）
export const PRODUCT_STAGE = [
  { re: /^需求规格[-_]/, stage: 'clarify', label: '需求规格' },
  { re: /^任务编排[-_]/, stage: 'decompose', label: '任务编排图' },
  { re: /^方案设计[-_]/, stage: 'design', label: '方案设计' },
  { re: /^基线清单[-_]/, stage: 'clarify', label: '基线清单' },
]
const STAGE_ORDER = ['clarify', 'decompose', 'design', 'build', 'execute', 'close']
/** 判断一个文件名属于哪个阶段的产物；不属于任何阶段产物返回 null。 */
export function productStageOf(fileName) {
  const n = String(fileName || '').replace(/^.*[/\\]/, '').trim()
  if (!n) return null
  for (const p of PRODUCT_STAGE) if (p.re.test(n)) return p
  return null
}
/** 当前阶段是否允许写该产物。允许返回 null；不允许返回拒绝文案。 */
function _productWriteDeny(st, fileName, toolName) {
  const prod = productStageOf(fileName)
  if (!prod) return null
  const curIdx = STAGE_ORDER.indexOf(String(st.stage || ''))
  const needIdx = STAGE_ORDER.indexOf(prod.stage)
  if (curIdx < 0 || needIdx < 0) return null    // 判不出阶段 → 放行（不误伤）
  if (curIdx >= needIdx) return null            // 当前阶段 >= 产物阶段 → 允许（含返工）
  return [
    `【jarvis 阶段闸·产物写入】当前是「阶段 ${st.index}/${st.total} ${st.label}」，不允许写「${prod.label}」（那是第 ${needIdx + 1} 阶段 ${STAGE_LABELS[prod.stage]} 的产物）。`,
    `被拒目标：${fileName}（工具 ${toolName}）`,
    `为什么拦：跳过 ${prod.label} 之外的下游步骤会让后续闸看到"文件存在"就放行，等于这步没真做过。`,
    `当前缺口：${(st.missing || []).join('；') || '无'}`,
    `下一步：${st.next}`,
    '这是插件按 .jarvis 磁盘事实+阶段算出来的，不是提示词建议——先完成当前阶段并过闸，再写下游产物。',
  ].join('\n')
}

// ── 阶段网关（P2 · 完全体核心）：工具调用前按 computeStage 阶段机械拒绝「越阶段」────────────────
// 为什么需要：v0.9.0 只有 computeStage + 每请求注入（提示词层），阶段推进全靠模型自觉；
// 长会话/弱模型必然跳步。文字拦不住 → 必须在工具执行前让它**机械失败**（与 flowguard 同族思路）。
// 设计（方案设计-luke-jarvis完全体.md §2）：
//   • deny-list（不是 allowlist）：未知工具默认放行，避免误伤 read/glob/grep/bash 等只读/执行类工具；
//   • 只对流程类工具生效（jarvis_*；agent_teams_* 已退役，命中即拒作防御）；
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
  clarify: ['jarvis_dispatch_task', 'agent_teams_create', 'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_amend_task', 'agent_teams_update_task', 'agent_teams_delete', 'agent_teams_resume', 'agent_teams_approve', 'agent_teams_edit_plan', 'jarvis_taskgraph', 'jarvis_coverage', 'jarvis_release'],
  decompose: ['jarvis_dispatch_task', 'agent_teams_create', 'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_amend_task', 'agent_teams_update_task', 'agent_teams_delete', 'agent_teams_resume', 'agent_teams_approve', 'agent_teams_edit_plan', 'jarvis_coverage', 'jarvis_release'],
  design: ['jarvis_dispatch_task', 'agent_teams_create', 'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_amend_task', 'agent_teams_update_task', 'agent_teams_delete', 'agent_teams_resume', 'agent_teams_approve', 'agent_teams_edit_plan', 'jarvis_taskgraph', 'jarvis_coverage', 'jarvis_release'],
  build: ['agent_teams_claim_task', 'agent_teams_amend_task', 'jarvis_taskgraph', 'jarvis_coverage', 'jarvis_release'], // 建队期不许改验收契约/认领（dispatch_task 派活、ticket open 仍允许——ticket 的 open/adjudicate 已在 deliver.js 内部按 action 过闸，成员 report/propose 不受影响）
  execute: ['jarvis_baseline', 'jarvis_taskgraph', 'jarvis_release'], // 执行期不回头改基线/重拆/改版本账本；claim/update/amend 放行（交活与返工需要）
  close: ['jarvis_dispatch_task', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_add_member'],
}
/** 派活类工具：除「本阶段允许」外，还必须持完整链（R3：build 必须建立在 clarify→decompose→design 之上） */
export const PAID_WORK_TOOLS = new Set(['jarvis_dispatch_task', 'agent_teams_create_task', 'agent_teams_reassign_task'])
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
// ── 阶段判据基址（D1：闸的判据源必须与工具的落点同向）────────────────────────
// 缺陷机理：闸只读会话 cwd，而工具按 args.projectDir 落状态 → 两者指向不同目录时，
// 闸永远按「另一个目录的阶段」放行/拒绝（flowguard 在 A 目录落闸、闸按 B 目录判 → 永远过不完第一阶段）。
// 修法：优先用**本次调用**里声明的 projectDir（与 flowguard/coverage 等写状态用的是同一个值），
// 无/不合法才回退会话 cwd。
// 边界（为什么只认白名单）：只有「工具 schema 真声明了 projectDir」的工具才可能把 projectDir 写进状态；
// 其他工具即使收到同名字段也不该改变判据（否则随便传参就能把闸判到别处）。
export const PROJECTDIR_TOOLS = new Set([
  'jarvis_baseline', 'jarvis_coverage', 'jarvis_flowguard', 'jarvis_ticket', 'jarvis_gc',
  'jarvis_store', 'jarvis_snapshot', 'jarvis_recall', 'jarvis_mind', 'jarvis_company',
  'jarvis_dispatch_task', 'jarvis_member_brief', 'jarvis_ponder_check',
  'jarvis_taskgraph', // 批次1b（D1 覆盖补全）：taskgraph 现在声明 projectDir 且产物写在该目录 → 判据跟它走
])
/** 绝对路径且是已存在目录才认（相对路径/不存在目录会让判据落到别处或凭空判阶段）。 */
function _absExistingDir(p) {
  try {
    const fs = _require('node:fs')
    const path = _require('node:path')
    const s = String(p || '').trim()
    if (!s || !path.isAbsolute(s)) return ''
    return fs.statSync(s).isDirectory() ? s : ''
  } catch { return '' }
}
/**
 * 本次工具调用的状态根（阶段判据基址）：
 *   ① 工具声明了 projectDir 且传了「绝对路径+存在的目录」→ 用它（= 工具落状态的地方）；
 *   ② 否则 → 会话 header.cwd；
 *   ③ 都没有 → 空串（判不出工作区，调用方按「放行」处理，不误拦 headless 会话）。
 */
export function stageBase(exec) {
  let cwd = ''
  try {
    cwd = String((exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd) || '')
  } catch { cwd = '' }
  try {
    const name = String((exec && exec.name) || '')
    const args = exec && exec.arguments
    if (PROJECTDIR_TOOLS.has(name) && args && typeof args === 'object') {
      const pd = _absExistingDir(args.projectDir)
      if (pd) return pd
    }
  } catch { /* 参数形态异常 → 回退 cwd */ }
  return cwd
}
/**
 * guard：按阶段机械放行/拒绝流程类工具调用。
 * 返回字符串 = 拒绝该次调用；返回 undefined = 放行。
 */
export function jarvisStageGate(exec) {
  try {
    const name = String((exec && exec.name) || '')
    const args = exec && exec.arguments
    // ── 0) 流程产物写入闸（v0.27）──
    // 这一支**优先于**工具名判断，因为产物写入可以发生在两类工具上：
    //   · jarvis_store(mode=save, itemType, name)：captain 唯一的写通道
    //   · write / edit：有写工具的会话（成员/旧 preset）也能直接写 docs/ 流程产物
    // 顺序很重要：先判"这次要写的是不是下游阶段的流程产物"，再判工具名白/黑名单。
    const writeTarget = _writeTargetOf(name, args)
    if (writeTarget) {
      const cwdW = stageBase(exec)
      if (cwdW && _flowState(String(cwdW)).jarvis) {
        const stW = computeStage(String(cwdW))
        const denyW = _productWriteDeny(stW, writeTarget, name)
        if (denyW) return denyW
      }
    }
    if (!/^(jarvis_|agent_teams_)/.test(name)) return undefined // 只管流程类；read/glob/bash 等不受影响
    const cwd = stageBase(exec) // D1：优先本次调用的 projectDir，回退会话 cwd（唯一入口）
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

/** 从工具调用参数里取出「本次要写的产物文件名」。
 *  只认会写 docs/ 流程产物的两类：
 *    · jarvis_store(mode=save)：name + 扩展名（itemType 决定这是 docs 还是别的目录）
 *    · write / edit：file_path 里含 .jarvis/docs/
 *  返回 null = 这次调用不涉及流程产物写入（放行）。 */
function _writeTargetOf(name, args) {
  try {
    if (!args || typeof args !== 'object') return null
    if (name === 'jarvis_store') {
      if (String(args.mode ?? '').trim() !== 'save') return null
      const itemType = String(args.itemType ?? '').trim()
      // 只有 doc 类会落到 .jarvis/docs/；card/project/lesson/report 等不属流程产物
      if (itemType !== 'doc') return null
      const nm = String(args.name ?? '').trim()
      return nm ? (nm.endsWith('.md') ? nm : nm + '.md') : null
    }
    if (name === 'write' || name === 'edit') {
      const p = String(args.file_path ?? args.path ?? '')
      if (!/\.jarvis[/\\]docs[/\\]/.test(p)) return null
      return p
    }
    return null
  } catch { return null }
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
        _require('node:path').join(_require('node:os').tmpdir(), 'jarvis-captain-guard.log'),
        `${new Date().toISOString()} tool=${name} sid=${sessionId} cwd=${cwd} captains=[${[..._captainIds(String(cwd))].join(',')}]\n`,
      )
    } catch {}
    const captains = _captainIds(String(cwd))
    // 根治（2026-11-16）：ANY_TOPLEVEL 表示「jarvis 工作区但认不出 captain（未建队）」——
    // 此时任何顶层会话都按 captain 处理，禁止自行执行/开子 agent。
    const isCaptain = captains.has(String(sessionId)) || captains.has(ANY_TOPLEVEL)
    if (!isCaptain) return undefined
    // 未建队时的专属提示：不是「改走派活」（还没队可派），而是「先建队」。
    const unbeaten = captains.has(ANY_TOPLEVEL)
    if (unbeaten) {
      return `【jarvis 严格闸·插件级】当前工作区是 jarvis 项目，但**还没建队**，不能直接开子任务/亲自执行 ${name}。\n` +
        '**正确顺序**：① 过需求/拆解/方案三闸（jarvis_flowguard step=clarify/decompose/design）；' +
        '② jarvis_distill 蒸馏角色卡 → jarvis_company 让员工落盘（建队）；' +
        '③ 用 jarvis_dispatch_task(assignee=成员, subject, description, acceptance) 派活。\n' +
        '**为什么**：直接开的子任务不进任务单 → 没有进度/没有验收/无法追溯，UI 也看不到。\n' +
        '**确需临时调试**：在工作区新建空文件 `.jarvis/allow-captain-exec` 即可放行（调试完请删除）。'
    }
    // 缺陷 d 修复（2026-11-14 实证）：拒绝文案必须带「当前阶段 + 卡在哪 + 该走哪一步」。
    // 原因：原文案只说「改走派活」，但若流程还停在 clarify（前置产物没齐），
    // captain 派活也会被阶段网关拦 → 模型反复试 → 现象上像死锁。
    // 真正的问题不是「守卫拦得太多」（jarvis_* 从不拦，出路一直存在），
    // 而是「被拦的人不知道该先去过哪个闸」。
    let stageHint = ''
    try {
      const st = computeStage(String(cwd))
      if (st) {
        const label = STAGE_LABELS[st.stage] || st.stage
        const gaps = (st.missing || []).slice(0, 3).join('；')
        stageHint =
          `\n\n【当前进度】阶段 ${st.index}/${st.total}「${label}」` +
          (gaps ? `｜还差：${gaps}` : '｜本阶段产物已齐') +
          `\n【走出困境的正确顺序】① 本阶段产物没齐 → 先补齐再 jarvis_flowguard(step="${st.stage}")；` +
          `② 闸过了 → jarvis_ticket(action=list) 看现有单，或 jarvis_dispatch_task 派给成员；` +
          `③ 不要反复重试 ${name}（守卫不会因此放行，只会浪费回合）。`
      }
    } catch { /* 算不出阶段：退回原文案 */ }
    return `【jarvis 严格闸·插件级】顶层 captain 不得用 ${name} 亲自执行。**立刻改走派活**：① jarvis_ticket（action=list）先看现有任务单与成员在办情况；② 派活：jarvis_dispatch_task(assignee=成员, subject, description, acceptance) 一步开单（自动带角色卡+须知，开单即由原生 subagents 派成员子会话执行）；卡住的单 → jarvis_ticket（action=retry, ticketId=...）重派；③ 只读查看用 read/glob/grep；④ **不要重试本工具**——开单后成员子会话即开始干活（页面可见子任务）；⑤ **保持本回合活跃**直至成员经 jarvis_ticket report 回报并验收完成（A2A 闭环），期间不做任何 dsh 重启；⑥ **成员数量没有上限**：队伍大就让 CEO 成员用原生子代理辅助（深度限 1 层），正式扩编/加人提 jarvis_ticket（action=propose）由你裁决后开单；**绝不要用 subagent 绕过派活**（那是顶层自己干，属于违规）。${stageHint}`
  } catch {
    return undefined
  }
}
