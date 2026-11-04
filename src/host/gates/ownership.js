/** 归属判定 + 状态根守卫（gates 的最底层，零依赖：只用 node:fs）。
 *
 *  为什么单独成模块：历史上「本项目归哪些团队」被 computeStage 与四个审计函数各写一份，
 *  三份口径漂移直接导致「假收口 / 永远到不了 close」。这里收敛成唯一实现：
 *    · resolveOwnedTeams：标记内团队 ∪ 同 captainSessionId 团队；标记缺失/过期回退 72h 启发式；
 *    · looksLikePluginRepo / stateRootConflict：插件仓库自身不是 jarvis 状态根，一律拒写 .jarvis/；
 *    · readActiveTeamMarker / writeActiveTeamMarker：归属标记（.jarvis/active-team.json，7 天有效期）。
 *  行为与拆分前逐字一致（只搬家，不改判据）。
 */
import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

// 顶层不得自领执行任务（scan 教训：成员会话死后 captain 自己 claim 任务干完 → "全是上层在干活"）。
// 规则：未完成任务里 assignee==='captain' 且 subject 未标协调类豁免 = 顶层亲自执行 → BLOCKED。
/** T13：协调类任务豁免（create_task 闸与 auditTeamBriefs **共用同一常量**，禁止两处各写一份口径） */
export const COORD_TASK_RE = /【协调】|协调|需求分析|拆解|排期|会议|汇报|盯控|裁决|验收|评审/
/** T13：终态任务不参与任何审计（completed/cancelled） */
export const TERMINAL_TASK_STATUS = Object.freeze(['completed', 'cancelled'])
/** T13：归属标记有效期（默认 7 天；过期→回退 72h 启发式并标 source=mtime-fallback） */
export const ACTIVE_TEAM_MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * T13：**唯一**的「本项目归属团队」判定（禁止三处各写一份：computeStage / 四个审计 / marker 写入）。
 * 判据 = active-team 标记内团队 ∪ 与当前 captainSessionId 相同的团队（建队发生在 build 闸之后，
 * 只按标记快照会漏掉「本项目刚建的团队」→ 少算 = 假收口）。
 * 标记缺失或过期 → 回退 mtime 72h 启发式（source='mtime-fallback'）。
 * @returns {{teams:string[], source:'marker'|'mtime-fallback'|'none', sessionId:string, marker:object|null}}
 */
export function resolveOwnedTeams(baseDir, captainSessionId) {
  const fs = _require('node:fs')
  const path = _require('node:path')
  const base = String(baseDir || '')
  const sidArg = String(captainSessionId || '')
  const td = path.join(base, '.agent-teams')
  const marker = readActiveTeamMarker(base)
  const sid = sidArg || (marker ? marker.sessionId : '')
  const teams = []
  let anyTeam = 0
  try {
    for (const t of fs.readdirSync(td)) {
      const name = String(t)
      if (ARCHIVED_TEAM_RE.test(name)) continue
      let teamFile = ''
      try {
        teamFile = path.join(td, name, 'team.json')
        if (!fs.statSync(teamFile).isFile()) continue
      } catch { continue }
      anyTeam += 1
      const inMarker = Boolean(marker && marker.teams.includes(name))
      let sameSession = false
      if (sid) {
        try { sameSession = String((JSON.parse(fs.readFileSync(teamFile, 'utf8')) || {}).captainSessionId || '') === sid } catch { sameSession = false }
      }
      if (inMarker || sameSession) teams.push(name)
      // 回退 72h **只在「既无标记、也不知道 captainSessionId」时**使用（computeStage 无会话就是这种）。
      // 一旦有 sessionId，归属必须按「同会话」严格判定——否则会把同一工作区里别人的新鲜团队全算进来（T13 跨项目污染）。
      else if (!marker && !sid && Date.now() - fs.statSync(teamFile).mtimeMs <= ACTIVE_TEAM_MAX_AGE_MS) teams.push(name)
    }
  } catch { /* 无 .agent-teams */ }
  return { teams, source: marker ? 'marker' : (anyTeam > 0 ? 'mtime-fallback' : 'none'), sessionId: sid, marker }
}

/** T13：该目录是否「插件仓库自身」（不是 jarvis 状态根）——用于拒绝写第二个状态根 */
export function looksLikePluginRepo(dir) {
  const fs = _require('node:fs')
  const path = _require('node:path')
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(String(dir || ''), 'package.json'), 'utf8'))
    if (String((pkg && pkg.name) || '').startsWith('luke-jarvis')) return true
  } catch { /* 无 package.json */ }
  try { return fs.statSync(path.join(String(dir || ''), 'src/host/plugin.js')).isFile() } catch { return false }
}

/**
 * 状态根守卫（T13 泛化）：插件仓库自身**不是** jarvis 状态根——任何 `.jarvis/` 写入方
 * （闸记录/团队标记/公屏/公司状态/会话快照/基线/覆盖矩阵/ponder 核验记录）统一拒绝，
 * 防止「记忆文件污染插件项目」。状态根只属于具体项目工作区（一个工作区一个状态根）。
 * @returns {null|{error:string,message:string}} 非插件仓库返回 null（放行）
 */
export function stateRootConflict(dir) {
  if (!looksLikePluginRepo(String(dir || ''))) return null
  return {
    error: 'STATE_ROOT_CONFLICT',
    message: '插件仓库自身不是 jarvis 状态根：拒绝写入 .jarvis/（记忆文件不得污染插件项目）。状态根应在具体项目工作区——一个工作区只有一个状态根。',
  }
}

// ── D5：活跃团队判据（防「本项目被别的/历史团队的未完成任务钉死在 execute」）──────────────────
// 缺陷实证（t1 交付报告风险段）：openTasks 原遍历 `.agent-teams` 下所有 team.json → 真实工作区
// 12 个未完成任务里只有 4 个属本项目（其余属 dsh-neon-theme/dsh-web-hardening/tech-neo-theme 与历史团队），
// 于是本项目永远到不了 close（jarvis_release 在 execute 阶段被拒）。
// 判据：① 归档目录（名字含 archive/old/history）一律不计；② team.json mtime 超过 72h = 历史团队，其未完成任务不计。
// 诚实标注（72h 是启发式，不是归属判据，双向都会误判）：
//   • 多算（漏排除他人任务）→ 阶段多停在 execute，与修复前一致，只是没改善——代价小；
//   • 少算（把真在跑但静默>72h 的团队当历史）→ 未完成任务凭空消失 → 阶段提前进 close（假收口）——代价大；
//   • 验证者侧：git checkout / rsync / CI 会把 mtime 刷成新时间，历史团队又变"活跃"→ 同一份代码在不同机器上算出不同阶段。
//   真正的归属判据需要 team.json 里有项目标识（cwd/projectId），属上游 agent-teams 数据契约变更（本任务范围外，已上报）。
//   本轮只在两个"明确"信号上排除（明确归档名、明确超时），其余一律按活跃计。
export const ACTIVE_TEAM_MAX_AGE_MS = 72 * 60 * 60 * 1000
export const ARCHIVED_TEAM_RE = /archive|^old|^_old|history/i
// ── D5-v2：归属判据 `.jarvis/active-team.json`（替代 72h 墙钟启发式作为主判据）──────────────
// 结构：{ teams: ['团队目录名'], updatedAt: ISO, source: 'captain-session'|'fallback-all', sessionId }
// 写入时机：jarvis_flowguard(step="build") 通过时（建队完成=本项目归属可确定）。
// 与 72h 启发式的关系（注释即契约，勿只改一处）：
//   • 有有效标记：只统计「标记内团队」的未完成任务——不论 mtime 多旧（团队静默>72h 不再被误判历史 → 消除假收口主通道）；
//   • 无标记 / 标记坏 / teams 为空：回退原有 72h 启发式（老工作区没有标记时的唯一可用判据，保持向后兼容）；
//   • 误判边界：标记里多写别人的团队 = 多算（阶段停 execute，代价小）；漏写本项目团队 = 少算（假收口，代价大）
//     → 写标记时按 captainSessionId 精确匹配当前会话的团队，匹配不到才 fallback 写全部非归档团队（source='fallback-all' 供审计）。
//   • 标记本身可被手写（威胁模型仍是「防无意识跳步」，不防有意伪造；与 gas.json 同一边界）。
function readActiveTeamMarker(cwd) {
  try {
    const fs = _require('node:fs')
    const path = _require('node:path')
    const raw = fs.readFileSync(path.join(String(cwd || ''), '.jarvis/active-team.json'), 'utf8')
    const d = JSON.parse(raw)
    const teams = Array.isArray(d && d.teams) ? d.teams.map(String).filter(Boolean) : []
    if (!teams.length) return null
    // T13 ③：标记必须有有效期——旧标记（如 3 个月前的 fallback-all）不得继续被当作「本项目归属」，
    // 否则会造成 openTasks=0 / 假 close。过期 → 返回 null（调用方回退 72h 并标 source=mtime-fallback）。
    const updatedAt = String((d && d.updatedAt) || '')
    const expiresRaw = String((d && d.expiresAt) || '')
    const updatedMs = updatedAt ? Date.parse(updatedAt) : NaN
    const expiresMs = expiresRaw ? Date.parse(expiresRaw) : (Number.isFinite(updatedMs) ? updatedMs + ACTIVE_TEAM_MARKER_TTL_MS : NaN)
    if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) return null
    return { teams, updatedAt, expiresAt: expiresRaw || new Date(expiresMs).toISOString(), source: String((d && d.source) || 'unknown'), sessionId: String((d && d.sessionId) || '') }
  } catch { return null } // 无标记/坏 JSON/无权限 → null（调用方回退 72h 启发式）
}
/** 写归属标记（flowguard(step="build") 通过时调用）。返回写入的对象；失败返回 null（不改闸结论）。 */
export function writeActiveTeamMarker(cwd, captainSessionId) {
  const fs = _require('node:fs')
  const path = _require('node:path')
  const base = String(cwd || '')
  const td = path.join(base, '.agent-teams')
  const sid = String(captainSessionId || '')
  // T13 ⑤：插件仓库自身不是 jarvis 状态根 → 不写归属标记（也不 mkdir 空 .agent-teams，避免污染仓库根）
  if (looksLikePluginRepo(base)) {
    return { ok: false, reason: '插件仓库自身不是 jarvis 状态根（拒绝写 .jarvis/active-team.json，见 README）', teams: [], source: 'failed', sessionId: sid }
  }
  // F5（T7 打回 medium）：**先 mkdir `.agent-teams`**——首建队时该目录还不存在（flowguard(build) 在建队前跑），
  // 旧实现直接 readdirSync 抛 ENOENT → 整个函数 catch 返回 null → D5-v2 标记永不写入 → 阶段退 72h 启发式。
  try {
    fs.mkdirSync(td, { recursive: true })
  } catch (e) {
    return { ok: false, reason: `mkdir .agent-teams 失败：${(e && e.message) || e}`, teams: [], source: 'failed', sessionId: sid }
  }
  const all = []
  const mine = []
  try {
    for (const t of fs.readdirSync(td)) {
      if (ARCHIVED_TEAM_RE.test(String(t))) continue
      try {
        const teamFile = path.join(td, String(t), 'team.json')
        if (!fs.statSync(teamFile).isFile()) continue
        const d = JSON.parse(fs.readFileSync(teamFile, 'utf8'))
        all.push(String(t))
        if (sid && String((d && d.captainSessionId) || '') === sid) mine.push(String(t))
      } catch { /* 坏 team.json → 不计入标记 */ }
    }
  } catch (e) {
    return { ok: false, reason: `读 .agent-teams 失败：${(e && e.message) || e}`, teams: [], source: 'failed', sessionId: sid }
  }
  // T13 修订（八卦镜实证 F8-3/F5-2）：**有 sid 却匹配不到任何团队时，绝不写 fallback-all**——
  // 否则任何第三方会话（新 GUI 会话/成员会话/复验者）在共享工作区跑一次 flowguard(build/execute)
  // 就把全部非归档团队写成「本项目归属」并保 7 天 → 收窄立即反向失效。
  // fallback-all 只在「调用方没提供 sid」（如 computeStage 预热/marker 预热）时才允许，且由读端按 72h 校验。
  if (sid && mine.length === 0 && all.length > 0) {
    return { ok: true, written: false, teams: [], source: 'no-match', sessionId: sid, reason: `本会话 ${sid} 不属于任何现有团队（${all.length} 个团队）→ 不认领（避免把别家团队写成本项目归属）；可先建队再跑 flowguard` }
  }
  const teams = mine.length ? mine : all
  const source = mine.length ? 'captain-session' : 'fallback-all'
  const nowMs = Date.now()
  const marker = {
    ok: true, teams, updatedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ACTIVE_TEAM_MARKER_TTL_MS).toISOString(), // T13 ③：7 天有效期，读端校验
    source, sessionId: sid,
  }
  if (teams.length === 0) {
    // 建队前尚无 team.json（flowguard(build) 在 create 之前跑）：**不写空标记**——
    // 否则 active-team.json 存在但 teams=[] 会被读端当作「有标记但无归属」，比没有标记更难排查。
    return { ...marker, written: false, reason: '建队前尚无 team.json（下次 flowguard(build/execute) 通过时会补写）' }
  }
  const dir = path.join(base, '.jarvis')
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'active-team.json'), JSON.stringify(marker, null, 2))
  } catch (e) {
    // 如实回报失败原因（旧实现静默返回 null → 调用方只能看到「没标记」，无法归因）
    return { ok: false, reason: `写 .jarvis/active-team.json 失败：${(e && e.message) || e}`, teams, source: 'failed', sessionId: sid }
  }
  return marker
}
