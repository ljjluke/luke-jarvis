/** 核心错误（借鉴 dsh-superagent src/core/errors.ts）。
 *
 *  规则：一个人或一个 agent 能触发的拒绝，必须是 `UserError(code, values)`，
 *  code 来自固定的 USER_ERRORS 表（UI/HTTP 可按 code 定文案与状态码），
 *  不允许抛自由文本——自由文本无法被界面词典化。
 */

/** 固定拒绝码表（code → 默认文案）。新增码必须在这里登记。 */
export const USER_ERRORS = {
  unknown_action: '未知的公司动作',
  state_root_conflict: '状态根冲突：插件仓库自身不是 jarvis 状态根',
  write_failed: '状态写入失败',
  executor_unavailable: '宿主没有可用的执行器',
  command_denied: '命令被拒绝',
}

/** 用户可触发的拒绝（对应 superagent 的 UserError）。 */
export class UserError extends Error {
  /**
   * @param {keyof typeof USER_ERRORS} code
   * @param {Record<string, unknown>} [values]
   */
  constructor(code, values = {}) {
    super(`${code}: ${USER_ERRORS[code] || code}`)
    this.name = 'UserError'
    this.code = code
    this.values = values
  }
}
