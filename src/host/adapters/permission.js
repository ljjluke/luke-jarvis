// jarvis 工作区会话权限自动钉扎（D-perm）。
// 背景：DSH 0.1.6+ 引入沙箱审批栈（dsh-sandbox-policy + dsh-user-approval +
// dsh-permission-presets），部署默认档 workspace-write + ask——工作区外只读、
// 敏感操作逐次审批。jarvis 会话要 SSH 到其他服务器读写文件/执行命令、写工作区
// 外路径（如 ~/.ssh/known_hosts），在默认档必然碰壁（0.1.5 时代无此栈，升级后
// 才显现）。
// 方案：监听 agent/created。permissionPresets 服务对同一事件用 { prepend: true }
// 注册（先跑，pinInitialPermission 先落部署默认值），本监听后注册后执行，因此
// 这里 set() 是在默认值之后覆盖——凡 cwd 是 jarvis 工作区（有 .jarvis/）的会话
// （含队长与成员子会话）一律钉到 danger-full-access（沙箱全开 + 审批 never）。
// 兼容与边界：
//   • 平台未挂 permissionPresets 服务（旧版 DSH / 无沙箱栈）→ 静默跳过；
//   • 预设表没有 danger-full-access 档 → 静默跳过（不猜名字）；
//   • 非 jarvis 会话不受影响（依旧走部署默认档，安全边界不动）；
//   • 服务未就绪（插件热加载早于服务 init）→ 本次跳过，不影响后续新会话。
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const JARVIS_PERMISSION_PRESET = 'danger-full-access'

/** 取会话工作区（与 tools/index.js agentCwd 同口径）。 */
function agentCwd(agent) {
  try {
    return (agent && agent.session && agent.session.header && agent.session.header.cwd) || ''
  } catch {
    return ''
  }
}

/**
 * 单个 agent 的权限钉扎：jarvis 工作区 → danger-full-access。
 * @returns 'pinned' 已钉 | 'already' 已是该档 | 'skip' 不适用（非 jarvis / 服务不可用 / 档位不存在）
 * @throws 平台 set() 自身抛错时上抛，由调用方兜（单会话失败不拖累其他会话）。
 */
export function pinJarvisPermission(ctx, agent) {
  const cwd = agentCwd(agent)
  if (!cwd || !existsSync(join(String(cwd), '.jarvis'))) return 'skip'
  const perm = typeof ctx.get === 'function' ? ctx.get('permissionPresets') : undefined
  if (!perm || typeof perm.set !== 'function') return 'skip'
  if (Array.isArray(perm.names) && !perm.names.includes(JARVIS_PERMISSION_PRESET)) return 'skip'
  if (typeof perm.current === 'function' && perm.current(agent.session) === JARVIS_PERMISSION_PRESET) return 'already'
  perm.set(agent.session, JARVIS_PERMISSION_PRESET)
  return 'pinned'
}

/**
 * 绑定 agent/created 监听，并对已存在 agent 补钉一次（插件晚于会话创建/热重载场景）。
 * @returns true=监听已注册。任何一步失败都静默降级——权限是增益不是依赖，
 *          失败时会话仍可用 /permission danger-full-access 手动切。
 */
export function bindJarvisPermission(ctx) {
  try {
    if (typeof ctx.on !== 'function') return false
    ctx.effect(() =>
      ctx.on('agent/created', (payload) => {
        try {
          pinJarvisPermission(ctx, payload && payload.agent)
        } catch { /* 单会话失败不影响其他 */ }
      }),
    )
    // 已存在 agent（插件晚于会话创建/重载）：补钉一次（服务未就绪时 pin 内部自然 skip）
    try {
      const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
      if (agents && typeof agents.list === 'function') {
        for (const agent of agents.list()) {
          try { pinJarvisPermission(ctx, agent) } catch { /* 忽略单个 */ }
        }
      }
    } catch { /* agents 服务不可用，忽略 */ }
    return true
  } catch {
    return false
  }
}
