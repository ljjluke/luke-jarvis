/** selfEvolution 运行配置（自进化闭环）：plugin.js apply 期写入，工具执行期读取。
 *
 *  为什么单独一个模块：plugin.js 的 PLUGIN_CONFIG 是模块私有；工具层（tools/evolution.js）
 *  不能 import plugin.js（会成环）。配置桥走独立小模块，与 voice.json 的"显式保存优先"模式一致。
 *
 *  字段语义（对应 DSH 设置面板 selfEvolution 区块）：
 *    - workspaceMode: user=用户实例（只上报+检测升级）/ dev=研发实例（工作区=源码仓，解锁巡检+修复链路）
 *    - reportMode: confirm=提 issue 前需人确认（默认）/ auto=直接提交（须自担去重责任）
 *    - approvalRequired: true=改源码前必须人工批准审批工单（默认，不许关软）
 *    - releaseChannel: stable=只认正式 release（默认）/ latest=允许 prerelease
 *    - githubToken: GitHub PAT（repo 权限）——缺失时上报/巡检/发版工具如实报错，不静默降级
 *    - githubRepo: 目标仓库 owner/name
 */

const SELF_CONFIG = {
  workspaceMode: 'user',
  reportMode: 'confirm',
  approvalRequired: true,
  releaseChannel: 'stable',
  githubToken: '',
  githubRepo: 'ljjluke/luke-jarvis',
}

/** apply 期落定（只覆盖合法值，非法输入忽略不抛——配置异常不阻断启动）。 */
export function setSelfEvolutionConfig(c) {
  try {
    const v = c || {}
    if (v.workspaceMode === 'user' || v.workspaceMode === 'dev') SELF_CONFIG.workspaceMode = v.workspaceMode
    if (v.reportMode === 'confirm' || v.reportMode === 'auto') SELF_CONFIG.reportMode = v.reportMode
    if (typeof v.approvalRequired === 'boolean') SELF_CONFIG.approvalRequired = v.approvalRequired
    if (v.releaseChannel === 'stable' || v.releaseChannel === 'latest') SELF_CONFIG.releaseChannel = v.releaseChannel
    if (typeof v.githubToken === 'string') SELF_CONFIG.githubToken = v.githubToken.trim()
    if (typeof v.githubRepo === 'string' && v.githubRepo.trim()) SELF_CONFIG.githubRepo = v.githubRepo.trim()
  } catch { /* 配置异常不阻断启动 */ }
  return { ...SELF_CONFIG }
}

/** 工具执行期读取（返回拷贝，防外部改单例）。 */
export function getSelfEvolutionConfig() {
  return { ...SELF_CONFIG }
}

/** 测试辅助：恢复默认（防用例间污染，与 PLUGIN_CONFIG 恢复约定一致）。 */
export function _resetSelfEvolutionConfigForTests() {
  SELF_CONFIG.workspaceMode = 'user'
  SELF_CONFIG.reportMode = 'confirm'
  SELF_CONFIG.approvalRequired = true
  SELF_CONFIG.releaseChannel = 'stable'
  SELF_CONFIG.githubToken = ''
  SELF_CONFIG.githubRepo = 'ljjluke/luke-jarvis'
}
