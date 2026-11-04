/** 30 个 jarvis_* 工具的汇总入口（唯一 TOOLS 事实源）。
 *
 *  为什么要汇总而不是散着：apply 只注册一份；selfcheck 对账 `TOOLS.length === 30` 与 handler 完整性。
 *  顺序沿用历史（intake→memory→distill→review→org→deliver），新增工具请放进对应域模块并在此登记。
 */
import { INTAKE_TOOLS } from './intake.js'
import { MEMORY_TOOLS } from './memory.js'
import { DISTILL_TOOLS } from './distill.js'
import { REVIEW_TOOLS } from './review.js'
import { ORG_TOOLS } from './org.js'
import { DELIVER_TOOLS } from './deliver.js'

export const TOOLS = [
  ...INTAKE_TOOLS,
  ...MEMORY_TOOLS,
  ...DISTILL_TOOLS,
  ...REVIEW_TOOLS,
  ...ORG_TOOLS,
  ...DELIVER_TOOLS,
]
