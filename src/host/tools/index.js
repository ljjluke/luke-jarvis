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
import { INTAKE_TOOLS } from './intake.js'
import { MEMORY_TOOLS } from './memory.js'
import { DISTILL_TOOLS } from './distill.js'
import { REVIEW_TOOLS } from './review.js'
import { ORG_TOOLS } from './org.js'
import { DELIVER_TOOLS } from './deliver.js'

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
    execute: tool.execute,
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
