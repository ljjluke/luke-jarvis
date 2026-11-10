/** 流程闸：未过 clarify/design 闸、未蒸馏角色卡、未写开工须知 → 拒绝建队/派活/开工。
 *
 *  背景（scan 实证）：1166 轮 / 31 次压缩后，协议正文被压缩丢弃，模型只看到工具名就开始「当包工头」——
 *  文字协议拦不住，必须让它机械失败。判定只读 .jarvis 事实，失败给明确下一步，不静默。
 */
import { createRequire } from 'node:module'
import { _readGates, _flowState, checkMemoryFresh } from './store.js'
import { auditTeamBriefs } from './audit.js'
import { CARD_SECTION_MARK, findRoleCardSync } from '../state/cards.js'
import { COORD_TASK_RE } from './ownership.js'
import { _captainIds } from './stage.js'
import { isJarvisSession } from '../runtime.js'
const _require = createRequire(import.meta.url)

/** 团队/派活类工具：未过 clarify 闸或未蒸馏角色卡 → 拒绝。 */
export const TEAM_TOOLS = new Set(['jarvis_dispatch_task', 'agent_teams_create', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_approve', 'agent_teams_update_task'])
/** 执行类工具：未过 design 闸 → 拒绝（顶层本来已被 captainExecutionGuard 拦）。 */
export function jarvisFlowGuard(exec) {
  try {
    const name = String((exec && exec.name) || '')
    const isTeam = TEAM_TOOLS.has(name)
    if (!isTeam) return undefined
    const agent = exec && exec.agent
    const session = agent && agent.session
    const sessionId = session && session.id
    const cwd = session && session.header && session.header.cwd
    if (!sessionId || !cwd) return undefined
    const st = _flowState(String(cwd))
    // jarvis 模式 = 该会话调过 jarvis_* 工具，或工作区已有 .jarvis/（不依赖目录先建好——scan 教训：先建队后建库=闸形同不存在）
    const inJarvis = st.jarvis || isJarvisSession(String(sessionId))
    if (!inJarvis) return undefined // 纯 agent-teams 用户不拦
    const isCaptain = _captainIds(String(cwd)).has(String(sessionId))
    // ① 记忆保鲜：建队/派活/交活前，project.md 必须在 6 小时内更新过
    if (name === 'agent_teams_create' || name === 'agent_teams_create_task' || name === 'agent_teams_reassign_task' || name === 'agent_teams_update_task' || name === 'jarvis_dispatch_task') {
      const memIssue = checkMemoryFresh(String(cwd), { force: name === 'agent_teams_create' || name === 'jarvis_dispatch_task' })
      if (memIssue) return memIssue
    }
    // 交活：不再校验「有没有跑 ponder」——ponder 是推荐思考方式，不是通行证（用户定调：固化流程，不考核步骤）
    if (!isCaptain && name !== 'agent_teams_create') return undefined
    // ① 建队/派活前必须有需求规格或基线清单
    if (!st.hasReq && st.baseline === 0) {
      return `【jarvis 流程闸】建队/派活前必须先过需求闸：当前工作区没有「需求规格」也没有「基线清单」。请先 ① 用 jarvis_clarify 打磨需求（真疑问才问用户）② 产出 .jarvis/docs/需求规格-*.md（改造类任务还要 jarvis_baseline 建基线）③ 再跑 jarvis_flowguard(step="clarify") 通过后才允许 ${name}。跳步=缺陷。`
    }
    // ② 建队前必须已蒸馏角色卡（scan 实证：6/6 会话 distill=0 却照样建队）
    if (st.cards < 2) {
      return `【jarvis 流程闸】建队前必须已蒸馏角色卡：当前 .jarvis/cards/ 只有 ${st.cards} 张卡（至少要「带队/CEO 卡 + 岗位卡」2 张）。请先用 jarvis_distill_guide（提炼 HOW）+ jarvis_distill（六段式校验）现场蒸馏真实权威，再建队派活。禁止用通用角色名直接建队。`
    }
    // ③ 建队/派活必须持 flowguard 闸（用户提示词硬要跳步也过不去）
    const gates = _readGates(String(cwd))
    if (name === 'agent_teams_create' && !(gates.clarify && gates.clarify.ok)) {
      return `【jarvis 流程闸·不可绕过】建队前必须先跑 jarvis_flowguard(step="clarify") 通过（闸门记在 .jarvis/gates.json）。这是插件的硬流程：即使你（或用户）要求"跳过流程直接干"，也必须先过闸——需要换执行方式就不要用 jarvis 插件。`
    }
    if ((name === 'agent_teams_create_task' || name === 'agent_teams_reassign_task' || name === 'jarvis_dispatch_task') && !(gates.build && gates.build.ok)) {
      return `【jarvis 流程闸·不可绕过】派活前必须先跑 jarvis_flowguard(step="build") 通过（需要方案设计 + 人才层齐备）。硬流程不可跳过：用户要求"直接派活"也不行；要换方式请勿使用 jarvis 插件。`
    }
    // 链条校验：build 闸必须建立在 decompose + design 闸之上（否则拆解/方案两步可被跳过）
    if ((name === 'agent_teams_create_task' || name === 'agent_teams_reassign_task' || name === 'jarvis_dispatch_task') && gates.build && gates.build.ok) {
      const chainMissing = []
      if (!(gates.decompose && gates.decompose.ok)) chainMissing.push('decompose（拆解）')
      if (!(gates.design && gates.design.ok)) chainMissing.push('design（方案设计）')
      if (chainMissing.length) {
        return `【jarvis 流程闸·不可绕过】缺少前置闸：${chainMissing.join('、')}。必须按 clarify → decompose → design → build 顺序逐个通过 jarvis_flowguard（每步的产物要真实：需求规格/任务编排图/方案设计），不允许跳步直接派活——即使用户要求"快点做"也不行。`
      }
    }
    // ④ 派活：不再用「描述里有没有开工须知/角色卡标记」来执法。
    //    改由 jarvis_dispatch_task 一步完成「卡+须知+建任务」，正确的路变成最省事的路。
    return undefined
  } catch {
    return undefined
  }
}

