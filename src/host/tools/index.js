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

/**
 * 按 agent 注入「当前第几步」：
 * 全局 systemPrompt section 的 AssembleContext 只有 { scope, signal }，拿不到会话工作区；
 * 按规范，per-agent 贡献要注册在该 agent 自己的 ctx 上（DSH 的报错原文也是这么说）。
 * 所以在第一次执行 jarvis_* 工具时，把它挂到 exec.agent.ctx，并按 agent 幂等。
 */
function ensureAgentStageSection(exec) {
  const agent = exec && exec.agent
  if (!agent || agent[STAGE_SECTION]) return
  const sp = agent.ctx && agent.ctx.systemPrompt
  if (!sp || typeof sp.section !== 'function') return
  try {
    sp.section({
      name: 'luke-jarvis:stage',
      order: 119,
      text: () => {
        try {
          return renderStage(agentCwd(agent))
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
      ensureAgentStageSection(exec)
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
