/** 35 个 jarvis_* 工具的汇总入口（唯一 TOOLS 事实源 + DSH 工具契约适配）。
 *
 *  为什么要适配：DSH 的 ToolDefinition 契约（@deepseek-ai/dsh-tools 0.2.x）要求
 *  `execute(args, exec)` 与 `output.render(args, value) → ContentBlock[]`。
 *  工具文件里保留精简写法（execute + 单参 render 返回字符串），在注册边界统一校验
 *  schema 并包装成 ContentBlock——契约只有这一处实现，30 个工具不用重复样板。
 *
 *  顺序沿用历史（intake→memory→distill→review→org→deliver），新增工具请放进对应域模块并在此登记。
 */
// 本地断言：不依赖 @deepseek-ai/dsh-tools（它连带 peer 依赖会让插件在 profile 里加载失败）
import { assertObjectJsonSchema, assertSupportedJsonSchema } from './schema.js'
import { getRuntimeContext, setRuntimeContext, rememberExec, markJarvisSession } from '../runtime.js'
import { renderStage } from '../gates/stage.js'
import { renderResumeFacts } from '../state/resume.js'
import { INTAKE_TOOLS } from './intake.js'
import { MEMORY_TOOLS } from './memory.js'
import { DISTILL_TOOLS } from './distill.js'
import { REVIEW_TOOLS } from './review.js'
import { ORG_TOOLS } from './org.js'
import { DELIVER_TOOLS } from './deliver.js'
import { EVOLUTION_TOOLS } from './evolution.js'
import { GC_TOOLS } from './gc.js'

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
 * 两个注册时机（都要）：① apply 里 agent/created（首个请求就有阶段——新会话/压缩后重建也生效）
 * ② 首次执行 jarvis_* 工具（兜底：宿主不派发 agent/created 时仍能补上）。按 agent 幂等。
 */

const DYNAMIC_PAGES_HINT = '\n\n[动态页面·现写现用] 需要给用户展示可视化详情（看板/报告/图表/长表格）时，把完整、可独立打开的 HTML 写到 <工作区>/.jarvis/pages/<id>.html（id 用小写字母数字连字符，≤64 字符；同一主题更新内容就覆盖同一 id）。用户在 Wings UI「动态页面」卡里点击查看；页面闲置 24 小时自动回收，无需手动清理。主页面/团队办公室/任务看板三个固定页之外的所有详情页都走这个通道。'

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
          const cwd = agentCwd(agent)
          const stage = renderStage(cwd)
          // 续接事实：插件自己把磁盘事实（进度/下一步/未决/团队/已过闸）读出来放进上下文，
          // 不用提示词要求模型"先去读记忆"——压缩后提示词会掉精度，事实不会。
          let facts = ''
          try {
            facts = renderResumeFacts(cwd)
          } catch {
            facts = ''
          }
          return (facts ? stage + '\n\n' + facts : stage) + DYNAMIC_PAGES_HINT
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
  ...EVOLUTION_TOOLS,
  ...GC_TOOLS,
].map(toToolDefinition)
