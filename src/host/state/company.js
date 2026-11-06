/** 公司状态门面（<workspace>/.jarvis/company-state.json —— 3D 办公室数据源）。
 *
 *  架构变更（对齐 dsh-superagent）：本模块不再自含业务裁决——
 *   · 读/写 IO 在 state/company-io.js（端口适配器）；
 *   · 状态迁移规则在 src/core/model.js#applyCompanyActionTo（纯函数）；
 *   · 唯一写者是 src/core/engine.js 的 applyCompanyAction 命令；
 *  对外 API（companyStateFile/readCompanyState/writeCompanyState/syncCompanyState）
 *  保持不变，既有工具与测试零改动。
 */
export { companyStateFile, readCompanyState, writeCompanyState } from './company-io.js'
import { createJarvisEngine } from '../engine.js'

/**
 * 工具动作自动同步公司状态（3D 画面反映真实动作，不靠 CEO 手动 update）。
 * 动作清单与状态机见 src/core/model.js#applyCompanyActionTo。
 * @returns {Promise<boolean>} 是否发生了状态迁移并成功落盘
 */
export async function syncCompanyState(fsSvc, action) {
  try {
    const projectDir = String((action && action.projectDir) || '')
    // 状态根守卫：显式 projectDir 指向插件仓库时拒写（防记忆文件污染插件仓库）
    const engine = createJarvisEngine({ projectDir, fsSvc })
    const r = await engine.applyCompanyAction({ ...action, projectDir })
    return Boolean(r && r.ok && r.changed)
  } catch { return false }
}
