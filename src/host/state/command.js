/** 能力台（UI → 31 个 jarvis 工具的真实执行通道）。

 *  为什么需要它：UI 之前只有只读快照，用户要求"能力全部接入"。
 *  设计原则（不绕过插件的硬闸）：
 *   ① UI 只能调 `jarvis_*` 这 31 个工具，别的（read/write/bash/agent_teams_*）一律拒绝；
 *   ② 执行走宿主真实的 `tools.execute`，因此 **captain 闸 / 阶段闸 / 流程闸照常生效** ——
 *      UI 点一下不能变成"绕过闸"的后门；被闸拦住时把拒绝原因如实返回给界面；
 *   ③ 必须绑定一个真实活动会话（agent）：工具要按该会话的 cwd 落盘，且闸按该会话判定；
 *   ④ 每次调用落一条 `command` 事件，界面/时间轴/审计都能看到"谁在什么时候点了什么"。
 */
import { TOOLS } from '../tools/index.js'
import { createJarvisEngine } from '../engine.js'

/** 工具分组（纯展示用，方便界面归类；未知工具落到 other）。 */
export const TOOL_GROUPS = {
  '需求与规划': ['jarvis_project', 'jarvis_clarify', 'jarvis_taskgraph', 'jarvis_process', 'jarvis_collab'],
  '人才与角色': ['jarvis_distill_guide', 'jarvis_distill', 'jarvis_fidelity', 'jarvis_member_brief', 'jarvis_perf', 'jarvis_capability'],
  '记忆与知识': ['jarvis_store', 'jarvis_lesson', 'jarvis_snapshot', 'jarvis_board', 'jarvis_essence'],
  '流程与闸': ['jarvis_flowguard', 'jarvis_ticket', 'jarvis_escalate', 'jarvis_review'],
  '交付与验收': ['jarvis_baseline', 'jarvis_coverage', 'jarvis_fingerprint', 'jarvis_release', 'jarvis_dispatch_task'],
  '运行与协作': ['jarvis_meeting', 'jarvis_company', 'jarvis_update'],
  '深度思考': ['jarvis_think', 'jarvis_think_deep', 'jarvis_ponder_check'],
}

/** 工具元数据（给界面渲染表单用）。派生自真实 TOOLS，不手抄。 */
export function toolSpecs() {
  const byName = new Map()
  for (const [group, names] of Object.entries(TOOL_GROUPS)) {
    for (const n of names) byName.set(n, group)
  }
  return TOOLS.map((t) => ({
    name: t.name,
    group: byName.get(t.name) || 'other',
    description: String(t.description || '').trim(),
    parameters: t.parameters || { type: 'object', properties: {} },
    required: Array.isArray((t.parameters || {}).required) ? t.parameters.required : [],
    invokable: true,
  }))
}

const INVOKABLE = /^jarvis_[a-z_]+$/

/** 轻量参数校验/规整：只挡"明显不可能执行"的调用，深校验交给工具自己（并如实回传错误）。 */
export function normalizeArgs(spec, rawArgs) {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...rawArgs } : {}
  const props = (spec.parameters && spec.parameters.properties) || {}
  const errors = []
  for (const key of spec.required) {
    const v = args[key]
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)) {
      errors.push(`缺少必填参数 ${key}`)
    }
  }
  for (const [key, schema] of Object.entries(props)) {
    if (!(key in args) || args[key] === undefined || args[key] === null) continue
    const v = args[key]
    const type = String((schema && schema.type) || '')
    if (type === 'number' || type === 'integer') {
      const n = typeof v === 'number' ? v : Number(String(v).trim())
      if (!Number.isFinite(n)) errors.push(`${key} 需要数字`)
      else args[key] = type === 'integer' ? Math.round(n) : n
    } else if (type === 'boolean') {
      if (typeof v === 'string') args[key] = /^(true|1|yes|是)$/i.test(v.trim())
    } else if (type === 'array') {
      if (typeof v === 'string') {
        const s = v.trim()
        if (s.startsWith('[')) {
          try { args[key] = JSON.parse(s) } catch { errors.push(`${key} 不是合法 JSON 数组`) }
        } else {
          args[key] = s ? s.split('\n').map((x) => x.trim()).filter(Boolean) : []
        }
      }
      const itemType = String((schema.items && schema.items.type) || '')
      if (Array.isArray(args[key]) && itemType === 'number') args[key] = args[key].map((x) => Number(x)).filter(Number.isFinite)
      if (Array.isArray(args[key]) && itemType === 'string') args[key] = args[key].map((x) => String(x))
    } else if (type === 'string') {
      if (typeof v !== 'string') args[key] = String(v)
    } else if (type === 'object' && typeof v === 'string') {
      try { args[key] = JSON.parse(v) } catch { errors.push(`${key} 不是合法 JSON 对象`) }
    }
  }
  return { args, errors }
}

/** 在活动会话里找与工作区匹配的 agent（含 jarvis 会话优先）。 */
export function pickAgent(agents, projectDir) {
  let list = []
  try { list = agents && typeof agents.list === 'function' ? agents.list() : [] } catch { list = [] }
  const withCwd = (Array.isArray(list) ? list : [])
    .map((a) => ({ agent: a, cwd: String((a && a.session && a.session.header && a.session.header.cwd) || '') }))
    .filter((x) => x.cwd)
  if (!withCwd.length) return null
  const sameDir = withCwd.filter((x) => x.cwd === projectDir)
  const pool = sameDir.length ? sameDir : withCwd
  return pool[pool.length - 1].agent
}

export function sessionFacts(agents) {
  let list = []
  try { list = agents && typeof agents.list === 'function' ? agents.list() : [] } catch { list = [] }
  return (Array.isArray(list) ? list : []).map((a) => ({
    id: String((a && a.session && a.session.id) || ''),
    cwd: String((a && a.session && a.session.header && a.session.header.cwd) || ''),
    status: String((a && a.status) || 'unknown'),
  })).filter((s) => s.id)
}

/**
 * 执行一个 UI 发起的工具调用。
 * @returns {{ok:boolean, tool:string, result?:string, value?:unknown, error?:string, denied?:boolean, elapsedMs?:number}}
 */
export async function runCommand({ ctx, projectDir, tool, args, agent, signal }) {
  const name = String(tool)
  if (!INVOKABLE.test(name)) return { ok: false, tool: name, error: `只允许调用 jarvis_* 工具（收到：${name}）` }
  const spec = TOOLS.find((t) => t.name === name)
  if (!spec) return { ok: false, tool: name, error: `未知工具：${name}（能力台只暴露 31 个 jarvis 工具）` }
  const specMeta = toolSpecs().find((t) => t.name === spec.name)
  const { args: norm, errors } = normalizeArgs(specMeta, args)
  if (errors.length) return { ok: false, tool: spec.name, error: errors.join('；') }
  if (norm.projectDir === undefined && (spec.parameters?.properties || {}).projectDir) norm.projectDir = projectDir
  const toolsSvc = ctx && typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  if (!toolsSvc || typeof toolsSvc.execute !== 'function') {
    return { ok: false, tool: spec.name, error: '宿主没有 tools 服务，能力台不可用' }
  }
  if (!agent) return { ok: false, tool: spec.name, error: '没有绑定活动会话：先在 DSH 里开一个会话（或带 ?agent=<会话id>）' }
  const startedAt = Date.now()
  const callId = `jarvis-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  // 架构变更（对齐 dsh-superagent）：执行与 command 事件审计统一走 core Engine
  // （Engine 是 command 事件的唯一写者；本函数只保留 glue 职责：校验/规整/找会话）。
  const engine = createJarvisEngine({ projectDir })
  return engine.runCommand({
    projectDir,
    tool: spec.name,
    args: norm,
    startedAt,
    execute: () => toolsSvc.execute({ callId, name: spec.name, arguments: norm, agent, signal: signal || AbortSignal.timeout(120000) }),
  })
}
