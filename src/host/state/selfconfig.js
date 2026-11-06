/** selfEvolution 运行配置（自进化闭环）：plugin.js apply 期写入，工具执行期读取。
 *
 *  为什么单独一个模块：plugin.js 的 PLUGIN_CONFIG 是模块私有；工具层（tools/evolution.js）
 *  不能 import plugin.js（会成环）。配置桥走独立小模块，与 voice.json 的"显式保存优先"模式一致。
 *
 *  字段语义（对应 DSH 设置 → 内置插件 → luke-jarvis 配置卡片）：
 *    - workspaceMode: user=用户实例（只上报+检测升级）/ dev=研发实例（工作区=源码仓，解锁巡检+修复链路）
 *    - reportMode: confirm=提 issue 前需人确认（默认）/ auto=直接提交（须自担去重责任）
 *    - approvalRequired: true=改源码前必须人工批准审批工单（默认，不许关软）
 *    - releaseChannel: stable=只认正式 release（默认）/ latest=允许 prerelease
 *    - githubToken: GitHub PAT（repo 权限）——缺失时上报/巡检/发版工具如实报错，不静默降级
 *    - githubRepo: 目标仓库 owner/name
 *
 *  volatile：apply 收到的是 { get() } 引用时（DSH 设置面板实时源），bindSelfEvolutionLive
 *  记住引用，getSelfEvolutionConfig 每次读取都叠加实时值——面板保存后工具下一轮即用新值。
 */

import { isConfigRef } from './liveconfig.js'

const SELF_CONFIG = {
  workspaceMode: 'user',
  reportMode: 'confirm',
  approvalRequired: true,
  releaseChannel: 'stable',
  githubToken: '',
  githubRepo: 'ljjluke/luke-jarvis',
}

/** volatile 实时源（无则 null，走 apply 期落定值）。 */
const LIVE = { selfEvolution: null, workspaceMode: null }

/** 只覆盖合法值，非法输入忽略不抛——配置异常不阻断启动。 */
function applyValid(target, v) {
  const c = v || {}
  if (c.workspaceMode === 'user' || c.workspaceMode === 'dev') target.workspaceMode = c.workspaceMode
  if (c.reportMode === 'confirm' || c.reportMode === 'auto') target.reportMode = c.reportMode
  if (typeof c.approvalRequired === 'boolean') target.approvalRequired = c.approvalRequired
  if (c.releaseChannel === 'stable' || c.releaseChannel === 'latest') target.releaseChannel = c.releaseChannel
  if (typeof c.githubToken === 'string') target.githubToken = c.githubToken.trim()
  if (typeof c.githubRepo === 'string' && c.githubRepo.trim()) target.githubRepo = c.githubRepo.trim()
}

/** apply 期落定（扁平 raw 值；volatile ref 请另调 bindSelfEvolutionLive）。 */
export function setSelfEvolutionConfig(c) {
  try { applyValid(SELF_CONFIG, c) } catch { /* 配置异常不阻断启动 */ }
  return { ...SELF_CONFIG }
}

/** apply 期登记 volatile 实时源（config 原样传入，内部识别 ref）。 */
export function bindSelfEvolutionLive(config) {
  const c = config || {}
  LIVE.selfEvolution = isConfigRef(c.selfEvolution) ? c.selfEvolution : null
  LIVE.workspaceMode = isConfigRef(c.workspaceMode) ? c.workspaceMode : null
}

/** 工具执行期读取：落定值 + 实时源叠加（返回拷贝，防外部改单例）。 */
export function getSelfEvolutionConfig() {
  const out = { ...SELF_CONFIG }
  try {
    if (LIVE.selfEvolution) {
      const se = LIVE.selfEvolution.get()
      if (se && typeof se === 'object') applyValid(out, se)
    }
    if (LIVE.workspaceMode) {
      const wm = LIVE.workspaceMode.get()
      if (wm === 'user' || wm === 'dev') out.workspaceMode = wm
    }
  } catch { /* ref 读取异常：回落落定值 */ }
  return out
}

/** 测试辅助：恢复默认（防用例间污染，与 PLUGIN_CONFIG 恢复约定一致）。 */
export function _resetSelfEvolutionConfigForTests() {
  SELF_CONFIG.workspaceMode = 'user'
  SELF_CONFIG.reportMode = 'confirm'
  SELF_CONFIG.approvalRequired = true
  SELF_CONFIG.releaseChannel = 'stable'
  SELF_CONFIG.githubToken = ''
  SELF_CONFIG.githubRepo = 'ljjluke/luke-jarvis'
  LIVE.selfEvolution = null
  LIVE.workspaceMode = null
}
