/** 30 个 jarvis_* 工具的汇总入口（唯一 TOOLS 事实源 + DSH 工具契约适配）。
 *
 *  为什么要适配：DSH 的 ToolDefinition 契约（@deepseek-ai/dsh-tools 0.2.x）要求
 *  `execute(args, exec)` 与 `output.render(args, value) → ContentBlock[]`。
 *  工具文件里保留精简写法（execute + 单参 render 返回字符串），在注册边界统一校验
 *  schema 并包装成 ContentBlock——契约只有这一处实现，30 个工具不用重复样板。
 *
 *  顺序沿用历史（intake→memory→distill→review→org→deliver），新增工具请放进对应域模块并在此登记。
 */
import { assertObjectJsonSchema, assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import { getRuntimeContext, setRuntimeContext, rememberExec, markJarvisSession } from '../runtime.js'
import { renderStage } from '../gates/stage.js'
import { INTAKE_TOOLS } from './intake.js'
import { MEMORY_TOOLS } from './memory.js'
import { DISTILL_TOOLS } from './distill.js'
import { REVIEW_TOOLS } from './review.js'
import { ORG_TOOLS } from './org.js'
import { DELIVER_TOOLS } from './deliver.js'

const STAGE_SECTION = Symbol.for('luke-jarvis.stageSection')

/** 取会话工作区（exec.agent 只有在真实宿主里才有；测试桩可以没有）。 */
function agentCwd(agent) {
  try {
    return (agent && agent.session && agent.session.header && agent.session.header.cwd) || ''
  } catch {
    return ''
  }
}

/** 每个 agent 的启动来源（agent/created 的 source：startup/resume/clear/compact）。 */
const AGENT_START = new WeakMap()

/**
 * 记录 agent 是怎么起来的（由 apply 里的 agent/created 监听调用）。
 * 'compact'（上下文压缩后重建）/ 'resume'/'clear' 都要在首轮提醒"以磁盘事实为准、先把记忆读回来"——
 * 压缩丢的是对话记忆，不是流程；流程从 .jarvis/ 重新算得出来。
 */
export function noteAgentStart(agent, source) {
  try {
    if (agent && typeof agent === 'object') AGENT_START.set(agent, String(source || 'startup'))
  } catch {
    /* WeakMap 写入失败不影响主流程 */
  }
}

function agentStart(agent) {
  try {
    return AGENT_START.get(agent) || ''
  } catch {
    return ''
  }
}

/** 压缩/恢复后的首轮提醒（确定性文本，不依赖模型记忆）。 */
export function continuationNotice(agent) {
  const src = agentStart(agent)
  if (src !== 'compact' && src !== 'resume' && src !== 'clear') return ''
  const label = src === 'compact' ? '上下文压缩后重建' : src === 'clear' ? '会话清空重建' : '会话恢复'
  return [
    `⚠️ 本会话是「${label}」：你之前的对话记忆可能不完整。**以磁盘事实为准，不要凭记忆假设**：`,
    '- 先 jarvis_store(check) 读回 .jarvis/project.md（当前进度/下一步/未决项/团队清单/关键决策与依据）+ 需求规格/方案/黑板，再继续；',
    '- 当前第几步、缺什么、下一步做什么，以本段「jarvis 当前阶段」实时计算为准（它是每次请求从磁盘重算的）；',
    '- 用户原始需求细节如果记不全 → 从 .jarvis/docs/需求规格-*.md 读，不要凭印象补。',
  ].join('\n')
}

/**
 * 按 agent 注入「当前第几步」：
 * 全局 systemPrompt section 的 AssembleContext 只有 { scope, signal }，拿不到会话工作区；
 * 按规范，per-agent 贡献要注册在该 agent 自己的 ctx 上（DSH 的报错原文也是这么说）。
 * 两个注册时机（都要）：① apply 里 agent/created（首个请求就有阶段——新会话/压缩后重建也生效）
 * ② 首次执行 jarvis_* 工具（兜底：宿主不派发 agent/created 时仍能补上）。按 agent 幂等。
 */
export function ensureAgentStageSection(agent) {
  if (!agent || agent[STAGE_SECTION]) return
  const sp = agent.ctx && agent.ctx.systemPrompt
  if (!sp || typeof sp.section !== 'function') return
  try {
    sp.section({
      name: 'luke-jarvis:stage',
      order: 119,
      text: () => {
        try {
          const stage = renderStage(agentCwd(agent))
          const notice = continuationNotice(agent)
          return notice ? stage + '\n\n' + notice : stage
        } catch {
          return ''
        }
      },
    })
    agent[STAGE_SECTION] = true
  } catch {
    /* 宿主不支持/重复注册：静默——阶段仍可用 jarvis_snapshot / jarvis_flowguard 获取 */
  }
}

/** 每次工具调用的宿主侧记账：记录 ctx/exec、标记 jarvis 会话、按需挂阶段 section。 */
function trackExecution(tool, args, exec) {
  try {
    if (!getRuntimeContext() && exec && exec.ctx) setRuntimeContext(exec.ctx)
    rememberExec(exec)
    if (String(tool.name).startsWith('jarvis_')) {
      const sid = exec && exec.agent && exec.agent.session && exec.agent.session.id
      markJarvisSession(sid)
      ensureAgentStageSection(exec && exec.agent)
    }
  } catch {
    /* 记账失败不影响工具本身执行 */
  }
  return tool.execute(args, exec)
}

/** 工具渲染结果 → 模型可见文本块（render 契约要求 ContentBlock[]，必须纯、不抛）。 */
function textBlocks(rendered) {
  let text
  if (typeof rendered === 'string') text = rendered
  else if (rendered === null || rendered === undefined) text = ''
  else if (typeof rendered === 'object') text = JSON.stringify(rendered, null, 2)
  else text = String(rendered)
  return [{ type: 'text', text }]
}

/** 把一个工具定义规范成 DSH 的 ToolDefinition（注册前就校验，坏定义在 apply 期直接报错）。 */
function toToolDefinition(tool) {
  if (!tool || typeof tool.name !== 'string' || typeof tool.description !== 'string') {
    throw new TypeError(`jarvis tool 定义不完整：${JSON.stringify(tool && tool.name)}`)
  }
  if (typeof tool.execute !== 'function') throw new TypeError(`jarvis tool "${tool.name}" 缺少 execute(args, exec)`)
  if (!tool.output || typeof tool.output.schema !== 'object' || typeof tool.output.render !== 'function') {
    throw new TypeError(`jarvis tool "${tool.name}" 必须声明 output { schema, render }`)
  }
  assertObjectJsonSchema(tool.parameters)
  assertSupportedJsonSchema(tool.output.schema)
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    output: {
      schema: tool.output.schema,
      // 兼容单参调用（value 省略时把 first 当 value）：render 必须纯、可重放。
      render: (args, value) => textBlocks(tool.output.render(value === undefined ? args : value)),
    },
    execute: (args, exec) => trackExecution(tool, args, exec),
  }
}

export const TOOLS = [
  ...INTAKE_TOOLS,
  ...MEMORY_TOOLS,
  ...DISTILL_TOOLS,
  ...REVIEW_TOOLS,
  ...ORG_TOOLS,
  ...DELIVER_TOOLS,
].map(toToolDefinition)
