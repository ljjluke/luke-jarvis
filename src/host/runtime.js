/** 运行时上下文（process 级单例）+ 通用 fs 助手 + 用户工作区解析。
 *
 *  为什么单独成模块：plugin.js 里几千行工具 handler 拿不到 apply 的形参 ctx，只能从这个单例取；
 *  拆分后 `state/` / `gates/` / `tools/` 都从这里拿，**不允许各模块再存一份**（历史上同一口径写三份 = 漂移源）。
 *  行为与拆分前逐字一致（本模块只搬家，不改语义）：
 *    · resolveWorkspace 优先 exec 里的会话 cwd，其次 apply 预热，最后 process.cwd() 兜底；
 *    · getFsService 优先 exec.ctx.fs，其次宿主 ctx；
 *    · listNames/readTextSafe/hasTeamJson 兼容 mock 与真实 DSH FileSystem 两种形态。
 */
import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

// ── 用户工作区解析（修复：插件原用 process.cwd()=服务进程目录，不是用户工作区
//    ——导致 jarvis_board/company-state/记忆写到 /root/.dsh/profiles/web/.jarvis/
//    而非项目 <workspace>/.jarvis/（用户实测"交付了但文件不存在"=路径漂移）；
//    正确方式=从当前会话 header.cwd 拿用户工作区（agent-teams 同款），process.cwd 仅兜底）──
let _resolvedWorkspace = null
let moduleCtx = null
let latestExec = null // 最近一次工具调用的 exec（供全局路径函数取会话 cwd）

/** apply 时注入宿主 ctx（= 拆分前的 `moduleCtx = ctx`）。 */
export function setRuntimeContext(ctx) { moduleCtx = ctx }
/** 记录一次工具调用的 exec（= 拆分前的 `latestExec = latestExec || exec`，保持「首次为准」语义）。 */
export function rememberExec(exec) { latestExec = latestExec || exec || null }
/** 读宿主 ctx（= 拆分前的 moduleCtx；只读，改它必须走 setRuntimeContext）。 */
export function getRuntimeContext() { return moduleCtx }
/** 最近一次工具 exec（= 拆分前的 latestExec）。 */
export function getLatestExec() { return latestExec }
/** 已解析（含预热）的工作区（= 拆分前的 _resolvedWorkspace，仅供兜底读）。 */
export function getResolvedWorkspace() { return _resolvedWorkspace }

/**
 * F4b-p1：统一「列目录名」——支持 list(dir) 与 DSH FileSystem 的 resolve(dir)+listDir(target) 两种形态。
 * 返回 string[]（空数组=目录存在但为空）；返回 null=查不了（服务缺失/后端异常）→ 调用方按各自语义降级。
 * 为什么必须统一：六个审计函数原来都以 typeof fsSvc.list === 'function' 为前置，真实 FileSystem 没有 list
 * → 它们在 GUI 环境恒走「良性默认」分支（开工须知/人才层/自领/卡死/ponder核验/覆盖六闸形同不存在）。
 */
export async function listNames(fsSvc, dir) {
  if (!fsSvc) return null
  try {
    if (typeof fsSvc.list === 'function') {
      const n = await fsSvc.list(dir)
      return Array.isArray(n) ? n.map(String) : []
    }
    if (typeof fsSvc.resolve === 'function' && typeof fsSvc.listDir === 'function') {
      let target
      try { target = await fsSvc.resolve(dir) } catch { return null }
      if (!target) return []
      const entries = await fsSvc.listDir(target)
      return (Array.isArray(entries) ? entries : []).map((e) => String(e && e.name !== undefined ? e.name : e))
    }
    return null
  } catch { return null }
}
/**
 * F4b-p2：安全读文本——真实 FileSystem 的 readText 需要 FsTarget（先 resolve），
 * 旧代码直接传字符串路径 → 抛错被 catch 吞 → 审计函数「什么都没查」却返回良性结果（同 fail-open 家族缺陷）。
 * 兼容 mock（readText 直接吃字符串）：先试 resolve 后的 target，失败再回退原字符串。
 */
export async function readTextSafe(fsSvc, absPath) {
  if (!fsSvc || typeof fsSvc.readText !== 'function') return null
  let first = absPath
  if (typeof fsSvc.resolve === 'function') {
    try { const t = await fsSvc.resolve(absPath); if (t) first = t } catch { /* 保留字符串再试 */ }
  }
  try {
    const text = await fsSvc.readText(first)
    if (text) return text
  } catch { /* 再试原字符串（mock 形态） */ }
  if (first !== absPath) {
    try {
      const text = await fsSvc.readText(absPath)
      if (text) return text
    } catch { /* 放弃 */ }
  }
  return null
}
/** 判断 .agent-teams 下是否有 team.json（真实布局 .agent-teams/<团队>/team.json，不是平铺；平铺兼容） */
export async function hasTeamJson(fsSvc, teamsDir) {
  const names = await listNames(fsSvc, teamsDir)
  if (names === null) return null // 查不了 → 调用方按 fail-open 处理
  if (names.includes('team.json')) return true
  for (const name of names) {
    const inner = await listNames(fsSvc, teamsDir + '/' + name)
    if (inner && inner.includes('team.json')) return true
  }
  return false
}
// ══════════════════════════════════════════════════════════════════════════════════
// T11：PixOffice relay 协议（方案B）——把 company-state 投影成「场景快照帧 + 命令」
//
// 上游事实（T9 逆向实测）：页面 EventSource(<relayUrl>/api/pixoffice/events?...)，只认 onmessage、
// 单帧 JSON（>512KB 丢弃）；快照里 employees[].sceneActorId 必须落在 readActors() 的演员集合内，
// 否则 INVALID_BINDING 整批丢弃；seq 必填且单调，同 seq 内容变 → 409；无 actor.create 命令，
// 员工只能靠快照 initialize 一次性换绑。
// 纯函数集中在这里，便于单测与探针脚本复用（不做 IO）。
// ══════════════════════════════════════════════════════════════════════════════════


/**
 * F4b：统一取 fs 服务。**模块级工具 handler 拿不到 apply 的形参 ctx**（裸 `ctx` 会 ReferenceError 被 catch 吞掉 →
 * fsSvc 恒 null → hasGlob fail-open → 闸变空壳）。优先级：exec.ctx.fs > moduleCtx.fs > moduleCtx.get('fs')。
 * 取不到返回 null（由 hasGlob/各审计函数按各自语义降级，绝不静默抛错）。
 */
export function getFsService(exec) {
  const pick = (holder) => {
    if (!holder) return null
    try {
      const direct = typeof holder.fs === 'object' && holder.fs ? holder.fs : null
      if (direct && typeof direct.resolve === 'function') return direct
    } catch { /* 继续 */ }
    try {
      const viaGet = typeof holder.get === 'function' ? holder.get('fs') : null
      if (viaGet && typeof viaGet.resolve === 'function') return viaGet
    } catch { /* 继续 */ }
    return null
  }
  try {
    const fromExec = pick(exec && exec.ctx)
    if (fromExec) return fromExec
  } catch { /* 继续 */ }
  try { return pick(moduleCtx) } catch { return null }
}

export function resolveWorkspace(ctx, exec) {
  if (exec) {
    try {
      // 工具调用标准：exec.agent = 调用工具的会话 agent（agent-teams 同款：
      //   agent.session.header.cwd = 用户工作区，process.cwd 仅兜底）
      const agent = exec.agent || (exec.session && { session: exec.session })
      const w = agent && agent.session && agent.session.header && agent.session.header.cwd
      if (w && typeof w === 'string' && w.length > 0) return w
    } catch { /* 拿不到则继续 */ }
  }
  if (_resolvedWorkspace) return _resolvedWorkspace
  try {
    const agents = ctx && typeof ctx.get === 'function' ? ctx.get('agents') : undefined
    const me = agents && typeof agents.get === 'function'
      ? (agents.get(ctx.scope?.sessionId) || agents.get(ctx.sessionId) || (agents.list && agents.list()?.[0]))
      : undefined
    const w = me && me.session && me.session.header && me.session.header.cwd
    if (w && typeof w === 'string' && w.length > 0) { _resolvedWorkspace = w; return w }
  } catch { /* 拿不到会话则用兜底 */ }
  _resolvedWorkspace = (typeof process !== 'undefined' && process.cwd ? process.cwd() : '')
  return _resolvedWorkspace
}

/**
 * D7：jarvis_ponder_check 核验记录的落盘项目目录（纯函数，可单测）。
 * 来源优先级（显式 > 会话 > 进程兜底）：
 *   ① args.projectDir（调用方显式指定，最可信）
 *   ② exec.agent.session.header.cwd（本次调用的会话工作区=用户真实工作区）
 *   ③ resolveWorkspace(moduleCtx)（进程级单例兜底——**已知会漂移**：成员会话曾把记录写到 profile 目录）
 *   ④ '.'（最后一档，保证不抛错）
 * 缺陷实证（D7）：原实现直接用 ③，记录落到 /root/.dsh/profiles/web/.jarvis/docs/ponder-verify，
 * 而收口闸/flowguard 读的是「会话 cwd 下的 .jarvis/docs/ponder-verify」→ 读不到记录 → 交活被误拒。
 */
export function ponderVerifyProjectDir(args, exec) {
  try {
    const explicit = String((args && args.projectDir) || '').trim()
    if (explicit) return explicit
  } catch { /* 继续下一档 */ }
  try {
    const agent = exec && (exec.agent || (exec.session && { session: exec.session }))
    const w = agent && agent.session && agent.session.header && agent.session.header.cwd
    if (w && typeof w === 'string' && w.length > 0) return w
  } catch { /* 继续下一档 */ }
  return resolveWorkspace(moduleCtx) || '.'
}
