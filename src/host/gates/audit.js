/** 机械审计：开工须知 / 人才层 / 顶层自领 / 卡死任务 / ponder 核验 / 覆盖矩阵。
 *
 *  这些函数全部「读 .agent-teams 与 .jarvis 的事实」，不看模型自述；查不了就按各自语义降级（绝不静默放行成「良性」）。
 *  依赖方向：runtime（fs 服务与兼容读） + gates/ownership（归属判定，唯一实现）。
 *  返回空数组/0 = 没发现问题；返回 null = 查不了（调用方要自己选 fail-open 还是 fail-closed）。
 */
import { listNames, readTextSafe, hasTeamJson } from '../runtime.js'
import { findRoleCard, CARD_SECTION_MARK } from '../state/cards.js'
import { COORD_TASK_RE, TERMINAL_TASK_STATUS, ACTIVE_TEAM_MAX_AGE_MS, ARCHIVED_TEAM_RE, resolveOwnedTeams } from './ownership.js'

// ── jarvis_flowguard 辅助函数（模块级，TOOLS 数组外）──
/** F4：在**调用方数组上原地**删除满足 pred 的缺项（`missing = missing.filter(...)` 只是参数重绑定，
 *  pre 项永远留在 handler 的数组里 → decompose/design/build/execute 恒 BLOCKED）。
 *  handler 侧也兼容「check 返回新数组」的写法（返回数组则整体替换）。 */
export function _dropMissing(missing, pred) {
  for (let i = missing.length - 1; i >= 0; i -= 1) if (pred(missing[i])) missing.splice(i, 1)
  return missing
}

// 在目录里找含关键字的文件（fs 支持时；不支持则返回 true=放行，防环境缺 fs 误拦）
// 兼容两种 fs 服务形态：
//   ① 旧/测试形态：list(dir) → 文件名数组；
//   ② DSH FileSystem（真实生产）：无 list，只有 resolve(path) + listDir(target) → FsDirEntry[]（entry.name 才是文件名）。
// 旧实现只认 list → 真实环境恒返回 true（flowguard 的产物前置检查形同虚设，gates.json 里人工补写 note 即其痕迹）。
// 语义不变：服务能力缺失或任何异常 → true（fail-open，不把"查不了"变成"拦截"）。
export async function hasGlob(fsSvc, dir, keyword, opts = {}) {
  // 语义（F4b，T7 复验要求可区分）：
  //   • 无 fs 服务 / 服务不提供列举能力 → true（"查不了"放行，与历史 fail-open 一致，不能把环境缺失变成拦截）
  //   • 目录不存在（ENOENT/ENOTDIR/NOT_FOUND）→ false（明确"没有这个目录" = 没产物 → 流程闸必须拦）
  //   • 列举成功但无关键字命中 → false
  //   • 其他异常（权限/超时/后端错误）→ true（不确定=放行，避免误拦）
  //
  // 缺陷 a 修复（2026-11-14 实证）：原实现只列**一层**文件名。
  //   标准团队结构是 `.agent-teams/<team>/team.json`——team.json 在子目录里，
  //   一层 list 永远找不到 → 插件仓库判定 hasGlob=false → STATE_ROOT_CONFLICT → 流程自锁。
  //   现场只能靠伪造根级空 team.json（tasks:[]）绕过，导致快照读不到任何任务。
  // 修法：depth 参数（默认 0 = 只列当前层，保持原有调用语义不变）；
  //       depth>0 时递归向下，深度用尽即停。递归失败按 fail-open。
  const depth = Math.max(0, Number(opts.depth) || 0)
  const MAX_ENTRIES = 5000
  const isMissing = (e) => {
    const code = String((e && (e.code || e.errno)) || '')
    if (/ENOENT|ENOTDIR|NOT_FOUND|absent/i.test(code)) return true
    return /no such file|not exist|not found|不存在/i.test(String((e && e.message) || ''))
  }
  if (!fsSvc) return true
  let seen = 0

  /** 列一层，返回 [{name, isDir}]（适配两种 fs 形态）。查不了返回 null。 */
  const listOnce = async (d) => {
    try {
      if (typeof fsSvc.listDir === 'function' && typeof fsSvc.resolve === 'function') {
        let target
        try { target = await fsSvc.resolve(d) } catch (e) { return isMissing(e) ? [] : null }
        if (!target) return []
        const entries = await fsSvc.listDir(target)
        return (Array.isArray(entries) ? entries : []).map((e) => {
          const n = String(e && e.name !== undefined ? e.name : e)
          const isDir = Boolean(e && (e.isDirectory || e.kind === 'directory' || e.type === 'dir'))
          return { name: n, isDir }
        })
      }
      if (typeof fsSvc.list === 'function') {
        const names = await fsSvc.list(d)
        return (Array.isArray(names) ? names : []).map((n) => ({ name: String(n), isDir: false }))
      }
      return null   // 无列举能力
    } catch (e) { return isMissing(e) ? [] : null }
  }

  const search = async (d, left) => {
    const entries = await listOnce(d)
    if (entries === null) return null           // 查不了 → 交给上层 fail-open
    for (const en of entries) {
      if (++seen > MAX_ENTRIES) return false     // 防失控
      if (en.name.includes(keyword)) return true
    }
    if (left <= 0) return false
    // 递归进子目录（只进目录项；旧形态 list 无法区分，按「不知道就试一层」处理）
    for (const en of entries) {
      if (!en.isDir && typeof fsSvc.listDir !== 'function') continue
      const child = d.replace(/[\\/]+$/, '') + '/' + en.name
      const r = await search(child, left - 1)
      if (r === true) return true
      // 子目录不存在是正常的（文件被当目录试），继续
    }
    return false
  }

  try {
    const r = await search(dir, depth)
    return r === null ? true : r               // 查不了 = fail-open
  } catch (e) { return isMissing(e) ? false : true }
}
// 审计团队任务是否每个都附了开工须知（含 ponder 指引）
// 统计群聊会议进度：已有几轮发言、还剩几轮（供成员/CEO 看会议进行到哪）
export async function countMeetingProgress(existingText, maxRounds) {
  try {
    const lines = String(existingText || '').split(/\n/)
    const speakerCount = lines.filter((l) => l.includes('发言]')).length
    const round = Math.floor(speakerCount / Math.max(1, lines.filter((l) => l.includes('发言]')).length || 1)) || 0
    return { roundsUsed: Math.max(1, Math.ceil(speakerCount / 2)), maxRounds: Number(maxRounds) || 3, speakers: speakerCount }
  } catch { return { roundsUsed: 1, maxRounds: Number(maxRounds) || 3 } }
}

export async function auditTeamBriefs(fsSvc, projectDir, path, owned) {
  if (!fsSvc) return true
  try {
    const teamsDir = path.join(projectDir, '.agent-teams')
    const teamNamesRaw = await listNames(fsSvc, teamsDir)
    if (teamNamesRaw === null) return true // 查不了 → 放行
    const names = teamNamesRaw
    // T13 ①：只审计本项目归属团队（owned 为空=归属判不出来 → 保持原行为，避免把「判不出」变成「全放行」）
    const teamNames = owned && owned.size ? names.filter((n) => owned.has(String(n))) : names
    let anyMissing = false
    for (const team of Array.isArray(teamNames) ? teamNames : []) {
      try {
        const txt = await readTextSafe(fsSvc, path.join(teamsDir, String(team), 'team.json'))
        if (!txt) continue
        const d = JSON.parse(txt)
        const PONDER_MARK = /ponder|开工须知|step-guard|十阶段|run_id|PONDER_DATA_DIR|先跑 ponder/
        for (const t of d.tasks || []) {
          // T13 ①/②：终态任务不参与审计；协调类任务豁免开工须知（与 create_task 闸共用 COORD_TASK_RE）
          if (TERMINAL_TASK_STATUS.includes(String(t.status || ''))) continue
          if (COORD_TASK_RE.test(String(t.subject || ''))) continue
          const text = String(t.description || '') + ' ' + String(t.subject || '') + ' ' + String(t.acceptance || '')
          if (!PONDER_MARK.test(text)) { anyMissing = true; break }
        }
      } catch {}
    }
    return !anyMissing
  } catch { return true }
}

// 建队人才层前置硬闸（glm-test 教训：跳过猎头/蒸馏直接建普通角色队——flowguard 原只查需求/方案/须知，
// 没拦住"无猎头/无角色卡"建队）。规则：cards/ 必须有猎头卡 + 带队卡；若已有团队，每个成员岗位要有对应角色卡。
// 无 fs 环境返回空数组=放行（防环境缺 fs 误拦，与 hasGlob 一致）。
const LEADER_CARD_RE = /CEO|总经理|厂长|店长|院长|校长|带队|leader/i
const HEADHUNTER_CARD_RE = /猎头|headhunter|人才寻访|recruiter/i
export async function checkTalentPreconditions(fsSvc, projectDir, path, owned) {
  const missing = []
  if (!fsSvc) return missing
  try {
    const cardsDir = path.join(projectDir, '.jarvis/cards')
    const cardNamesRaw = await listNames(fsSvc, cardsDir)
    if (cardNamesRaw === null) return missing
    const names = cardNamesRaw.map((n) => String(n))
    const hasHeadhunter = names.some((n) => HEADHUNTER_CARD_RE.test(n))
    if (!hasHeadhunter) missing.push('猎头卡（.jarvis/cards/ 缺 猎头/headhunter 卡——建队必须先蒸馏该领域猎头）')
    const hasLeader = names.some((n) => LEADER_CARD_RE.test(n))
    if (!hasLeader) missing.push('带队/CEO卡（.jarvis/cards/ 缺 CEO/总经理/厂长/店长 等带队卡——建队必须先蒸馏带队者）')
    // 已有团队 → 每个成员岗位要有对应角色卡
    const teamsDir = path.join(projectDir, '.agent-teams')
    const teamNamesRaw2 = await listNames(fsSvc, teamsDir)
    if (teamNamesRaw2 === null) return missing
    // T13 ①：只检查本项目归属团队的成员岗位卡（别家团队的成员缺卡不该拦本项目 build）
    const teamNames = owned && owned.size ? teamNamesRaw2.filter((n) => owned.has(String(n))) : teamNamesRaw2
    for (const team of teamNames) {
      try {
        const txt = await readTextSafe(fsSvc, path.join(teamsDir, String(team), 'team.json'))
        if (!txt) continue
        const d = JSON.parse(txt)
        for (const m of d.members || []) {
          const role = String(m.role || m.name || '').trim()
          if (!role) continue
          let hasCard
          if (LEADER_CARD_RE.test(role)) hasCard = hasLeader
          else if (HEADHUNTER_CARD_RE.test(role)) hasCard = hasHeadhunter
          else hasCard = names.some((n) => {
            const base = n.replace(/\.md$/i, '')
            return base.includes(role) || role.includes(base)
          })
          if (!hasCard) missing.push(`角色卡：${m.name || role}（.jarvis/cards/ 缺该岗位卡——每个岗位必须先蒸馏）`)
        }
      } catch {}
    }
  } catch {}
  return missing
}


export async function auditCaptainOwnedTasks(fsSvc, projectDir, path, owned) {
  const ids = []
  if (!fsSvc) return ids
  try {
    const teamsDir = path.join(projectDir, '.agent-teams')
    const teamNamesRaw = await listNames(fsSvc, teamsDir)
    if (teamNamesRaw === null) return ids
    const teamNames = owned && owned.size ? teamNamesRaw.filter((n) => owned.has(String(n))) : teamNamesRaw
    for (const team of teamNames) {
      try {
        const txt = await readTextSafe(fsSvc, path.join(teamsDir, String(team), 'team.json'))
        if (!txt) continue
        const d = JSON.parse(txt)
        for (const t of d.tasks || []) {
          const st = String(t.status || '')
          if (['completed', 'cancelled'].includes(st)) continue
          if (String(t.assignee || '') !== 'captain') continue
          const subj = String(t.subject || '')
          if (COORD_TASK_RE.test(subj)) continue
          ids.push(String(t.id || subj))
        }
      } catch {}
    }
  } catch {}
  return ids
}

// 卡死任务必须处理（scan 教训：成员会话被 end-seed 后任务停在 claimed/in_progress，没人 reassign → 顶层只能自己干）。
// 规则：未完成任务里 status==='claimed'（领了没交）或 attempt>=4 且产出为空 = 疑似卡死 → 必须 reassign 唤醒成员/换人。
export async function auditStaleTasks(fsSvc, projectDir, path, owned) {
  const stale = []
  if (!fsSvc) return stale
  try {
    const teamsDir = path.join(projectDir, '.agent-teams')
    const teamNamesRaw = await listNames(fsSvc, teamsDir)
    if (teamNamesRaw === null) return stale
    const teamNames = owned && owned.size ? teamNamesRaw.filter((n) => owned.has(String(n))) : teamNamesRaw
    for (const team of teamNames) {
      try {
        const txt = await readTextSafe(fsSvc, path.join(teamsDir, String(team), 'team.json'))
        if (!txt) continue
        const d = JSON.parse(txt)
        for (const t of d.tasks || []) {
          const st = String(t.status || '')
          if (['completed', 'cancelled'].includes(st)) continue
          const attempt = Number(t.attempt || 0)
          const outLen = String(t.output || '').trim().length
          if (st === 'claimed') stale.push(`${team}/${t.id}（claimed 未交付）`)
          else if (attempt >= 4 && outLen === 0) stale.push(`${team}/${t.id}（attempt=${attempt} 产出为空）`)
        }
      } catch {}
    }
  } catch {}
  return stale
}


/** 需求分级（纯逻辑，供 jarvis_project 工具与 /jarvis 命令共用）。
 *  ⚠️ 领域无关设计：插件不预设任何行业/人物/领域流程（那是项目沉淀的职责）。
 *  这里只做"需求复杂度的分级建议"，领域判断与蒸馏方向由 CEO 按本项目实际情况现场决定。
 *
 *  S5 修复（防"模糊需求被跳过澄清"）：不再按字符长度一刀切——"做个东西"(4字) 与 "改个文案"(4字)
 *  都短，但前者完全无实质内容（模糊需求），后者有明确对象+动作（可判定目标）。
 *  判据：含实质动词+具体对象 → 至少 M；纯占位/泛词（东西/一下/个东西/帮我弄）→ S（触发澄清，不直接建队）。
 */

// ── 基线/覆盖矩阵硬闸：改造/替换类任务防"覆盖面丢失"（webui 换皮丢页面教训）──
const BASELINE_FILE_RE = /^基线清单[-_](.+)\.json$/
/**
 * ponder 核验校验——**已接回 close 收口闸**（v0.16 恢复，见 deliver.js 收口段）。
 *
 * 用户定调反转（2026-11-19）：「每个员工思考时必须用 ponder」。
 * 旧口径（docs/执行流程.md §八、提交 a924bb7）是「固化流程但不考核步骤」，
 * 把这个闸撤了；撤闸的后果是执行器根本不再向成员提 ponder（adapters/dsh-executor.js
 * 只固定注入轻量四步），成员事实上全员裸干——scan 实证 6/6 会话
 * jarvis_ponder_check 从未调用。旧口径已作废，本函数重新成为收口硬闸。
 *
 * 分档（protocol/deliberation.js PONDER_TIER）：
 *   · easy-direct 档豁免——本单是模式化/可逆/有现成做法的活，跑十阶段是浪费；
 *     豁免凭据写在该任务单的 meta.route（缺省视为 standard，即"默认要核验"）。
 *   · standard / complex 档必须拿到 verdict=PASS 的核验记录。
 *   · 缺省 standard 是有意的：宁可为存量的老单多要求一次核验（ captain 补一条
 *     记录即可），也不要让"本该深度思考的单"悄悄漏过。
 */
export async function checkPonderVerify(fsSvc, projectDir, path, owned) {
  const missing = []
  if (!fsSvc) return missing
  try {
    // 档位豁免名单：从 .jarvis/tickets 的任务单里读 route/stakes。
    // 读不到（老单/异常）→ 当 standard 处理，不豁免。
    const exempt = new Set()
    try {
      const tdir = path.join(projectDir, '.jarvis/tickets')
      const names = (await listNames(fsSvc, tdir)) || []
      for (const n of names) {
        if (!/^ticket-.*\.json$/.test(String(n))) continue
        try {
          const t = JSON.parse((await readTextSafe(fsSvc, path.join(tdir, String(n)))) || '{}')
          const meta = (t && t.meta) || {}
          const route = String(meta.route || meta.difficulty || '').trim().toLowerCase()
          const stakes = String(meta.stakes || '').trim().toLowerCase()
          if (route === 'easy' || route === 'easy-direct') exempt.add(String(t.id || ''))
          // stakes=low 仍要核验（standard 档），只有显式 easy 档才豁免
          void stakes
        } catch { /* 坏单跳过 = 不豁免 */ }
      }
    } catch { /* 无任务单目录 = 无豁免 */ }
    const teamsDir = path.join(projectDir, '.agent-teams')
    const teamsRaw = await listNames(fsSvc, teamsDir)
    if (teamsRaw === null) return missing
    const teams = owned && owned.size ? teamsRaw.filter((n) => owned.has(String(n))) : teamsRaw
    const completedMemberTasks = []
    for (const t of teams) {
      try {
        const txt = await readTextSafe(fsSvc, path.join(teamsDir, String(t), 'team.json'))
        if (!txt) continue
        const d = JSON.parse(txt)
        for (const task of d.tasks || []) {
          const st = String(task.status || '')
          const who = String(task.assignee || '')
          if (st !== 'completed') continue
          if (!who || who === 'captain' || who === 'CEO') continue
          const id = String(task.id || '')
          if (exempt.has(id)) continue        // easy 档：凭任务单写明豁免
          completedMemberTasks.push(id)
        }
      } catch {}
    }
    // v0.15.9 根治：本部署派单走 jarvis/tickets（不是 .agent-teams/team.json），
    // 两套账本同时存在时旧实现只认 team.json → jarvis 单永远对不上。
    // 补读 .jarvis/tickets 中**已结束(ended)**的单，参与同一套 ponder 核验。
    try {
      const tdir = path.join(projectDir, '.jarvis/tickets')
      const names = (await listNames(fsSvc, tdir)) || []
      for (const n of names) {
        if (!/^ticket-.*\.json$/.test(String(n))) continue
        try {
          const t = JSON.parse((await readTextSafe(fsSvc, path.join(tdir, String(n)))) || '{}')
          if (!t || !t.ended) continue
          const asg = (Array.isArray(t.assignments) ? t.assignments : []).slice(-1)[0] || {}
          const who = String(asg.role || '')
          if (!who || who === 'captain' || who === 'CEO') continue
          const id = String(t.id || '')
          if (!id || exempt.has(id)) continue
          if (!completedMemberTasks.includes(id)) completedMemberTasks.push(id)
        } catch {}
      }
    } catch {}
    if (completedMemberTasks.length === 0) return missing
    let verifyFiles = []
    try { verifyFiles = (await fsSvc.list(path.join(projectDir, '.jarvis/docs/ponder-verify'))) || [] } catch { verifyFiles = [] }
    const passed = new Set()
    for (const f of verifyFiles) {
      const n = String(f)
      if (!n.endsWith('.json')) continue
      try {
        const rec = JSON.parse((await readTextSafe(fsSvc, path.join(projectDir, '.jarvis/docs/ponder-verify', n))) || '{}')
        if (String(rec.verdict || '').toUpperCase() === 'PASS' && rec.taskId) passed.add(String(rec.taskId))
      } catch {}
    }
    // v0.15.9：taskId 命名空间容错——team.json 的 t1/t3 与 tickets 的 ticket-xxx 是两套命名，
    // ponder-verify 记录里的 taskId 可能任一形态。归一比较（去前缀/小写/互为子串）。
    const normId = (x) => String(x || '').trim().toLowerCase()
      .replace(/^ticket-m?/, '').replace(/^task-/, '').replace(/^t\.?/, '')
    const passedNorm = new Set([...passed].map(normId))
    const unverified = completedMemberTasks.filter((id) => {
      const n = normId(id)
      if (passedNorm.has(n)) return false
      for (const pn of passedNorm) {
        if (pn && (n === pn || (n && n.startsWith(pn)) || (pn && pn.startsWith(n)))) return false
      }
      return true
    })
    if (unverified.length > 0) {
      missing.push(`ponder 核验缺失：${unverified.length}/${completedMemberTasks.length} 个成员任务没有 PASS 核验记录（${unverified.slice(0, 5).join('、')}）——这些单是 standard/complex 档，必须真跑 ponder 十阶段并留下核验。下一步：jarvis_ponder_check(runId=<成员回报的 run_id>, dataDir=<PONDER_DATA_DIR>, taskId=<该任务>, projectDir=${projectDir}) —— PASS 才会落 .jarvis/docs/ponder-verify/ 放行。若这单其实属于免跑档，请在任务单 meta.route 标 "easy-direct" 后重跑收口。`)
    }
  } catch {}
  return missing
}

/** 成员绩效评估闸（v0.21）——收口时必须证明「CEO 评估过员工」，不是"有 jarvis_perf 工具就算有"。
 *
 *  用户质疑（2026-11-25）：「CEO 有绩效评估员工吗？如果不合格有通知猎头重新蒸馏吗？」
 *  排查结论：jarvis_perf 工具实现完整（六维信号/strikes 累计/perf-<role>.json 落盘/
 *  连续 2 次不达标或需求偏离 → 换人），但**没有任何闸强制 CEO 调用它**——
 *  四道流程闸只管建队前，close 闸只管 ponder 核验。所以 CEO 可以完全不评估就收口。
 *
 *  本函数补的就是这个触发点：有成员交付过任务、却没有对应的绩效评估记录 → 拦。
 *
 *  判据（刻意宽松，避免误拦）：
 *    · 只看「成员已完成任务」（captain 的任务不算——它是调度者，不自我评估）
 *    · 该角色有 .jarvis/perf-<role>.json 就算已评估（不校验内容质量——评估是 CEO 判断）
 *    · verdict 为"待考核"也算已评估（阶段未到，属正常）
 *    · 一个成员任务都没有 → 不要求（空项目/刚建队不误拦）
 */
export async function checkMemberPerf(fsSvc, projectDir, path, owned) {
  const missing = []
  if (!fsSvc) return missing
  try {
    const teamsDir = path.join(projectDir, '.agent-teams')
    const teamsRaw = await listNames(fsSvc, teamsDir)
    if (teamsRaw === null) return missing
    const teams = owned && owned.size ? teamsRaw.filter((n) => owned.has(String(n))) : teamsRaw
    // 收集「有交付的成员角色」
    const rolesWithWork = new Set()
    for (const t of teams) {
      try {
        const txt = await readTextSafe(fsSvc, path.join(teamsDir, String(t), 'team.json'))
        if (!txt) continue
        const d = JSON.parse(txt)
        for (const task of d.tasks || []) {
          if (String(task.status || '') !== 'completed') continue
          const who = String(task.assignee || '')
          if (!who || who === 'captain' || who === 'CEO' || who === '贾维斯') continue
          rolesWithWork.add(who)
        }
      } catch {}
    }
    if (rolesWithWork.size === 0) return missing
    // 查这些角色有没有绩效评估记录
    const unevaluated = []
    for (const role of rolesWithWork) {
      const safe = role.replace(/[\\/:*?"<>|]/g, '_')
      try {
        const txt = await readTextSafe(fsSvc, path.join(projectDir, '.jarvis', `perf-${safe}.json`))
        const data = txt ? JSON.parse(txt) : null
        const history = (data && Array.isArray(data.history)) ? data.history : []
        if (history.length === 0) unevaluated.push(role)
      } catch { unevaluated.push(role) }
    }
    if (unevaluated.length > 0) {
      missing.push(`绩效评估缺失：${unevaluated.length} 个已交付的成员从未被评估（${unevaluated.slice(0, 4).join('、')}）——收口前 CEO 必须用 jarvis_perf 逐个评估（六维：需求对齐/成果质量/完成度/上行健康度/角色契合/蒸馏深度），评估记录落 .jarvis/perf-<role>.json。判据：需求对齐度=0（产出偏离客户需求）→ 立即换人，不等 2 次；连续 2 次不达标 → 换人（jarvis_ticket action=retire），走离任→重蒸馏补位。不评估就收口 = 不知道谁合格谁不合格 = 换人机制永远不触发。`)
    }
  } catch {}
  return missing
}

export async function checkCoverageGate(fsSvc, projectDir, path) {
  const missing = []
  if (!fsSvc) return missing
  try {
    const docsDir = path.join(projectDir, '.jarvis/docs')
    const docsRaw = await listNames(fsSvc, docsDir)
    if (docsRaw === null) return missing
    const names = docsRaw
    const bases = names.map(String).filter((n) => BASELINE_FILE_RE.test(n))
    if (bases.length === 0) return missing // 没建基线 = 非改造类任务，不拦
    for (const b of bases) {
      const slug = b.match(BASELINE_FILE_RE)[1]
      const matrixName = `覆盖矩阵-${slug}.json`
      if (!names.map(String).includes(matrixName)) {
        missing.push(`覆盖矩阵：.jarvis/docs/${matrixName} 不存在（已建基线清单 ${b} —— 改造/替换类任务必须逐条覆盖；用 jarvis_coverage(persist=true, slug="${slug}") 生成）`)
        continue
      }
      try {
        const txt = await readTextSafe(fsSvc, path.join(docsDir, matrixName))
        const d = JSON.parse(txt || '{}')
        const uncovered = Array.isArray(d.uncovered) ? d.uncovered.map(String) : []
        const exempt = Array.isArray(d.exemptions) ? d.exemptions.map(String) : []
        const left = uncovered.filter((u) => !exempt.some((e) => e && u.includes(e)))
        if (left.length > 0) {
          missing.push(`覆盖率未闭环（${slug}）：${left.length} 条基线无落点 → ${left.slice(0, 3).join('、')}（补实现，或在 jarvis_coverage 传 exemptions 登记豁免+理由后才能收口）`)
        }
        const rv = typeof d.r_verify === 'number' ? d.r_verify : 1
        if (rv < 1) {
          missing.push(`验证覆盖率不足（${slug}）：r_verify=${Math.round(rv * 100)}%（落点须标终态且带 evidence 才算验证通过——防"改完没验"）`)
        }
      } catch (e) {
        missing.push(`覆盖矩阵读取失败（${slug}）：${String((e && e.message) || e)}`)
      }
    }
  } catch {}
  return missing
}

/**
 * 角色卡是否真的附进了任务（用户质疑点：卡只在写侧用、读侧没人读 → 成员按通用思路干）。
 * 判定：该 assignee 在 .jarvis/cards/ 有卡，但任务描述里没有卡注入段标记 → 记为缺。
 * 只审计未终态、非协调类任务（与 auditTeamBriefs 同口径）；查不了 → 返回空（fail-open）。
 * @returns {Promise<Array<{team:string,taskId:string,assignee:string,card:string}>>}
 */
export async function auditTeamCards(fsSvc, projectDir, path, owned) {
  if (!fsSvc || !projectDir) return []
  const out = []
  try {
    const teamsDir = path.join(projectDir, '.agent-teams')
    const names = await listNames(fsSvc, teamsDir)
    if (names === null) return []
    const teamNames = owned && owned.size ? names.filter((n) => owned.has(String(n))) : names
    for (const team of Array.isArray(teamNames) ? teamNames : []) {
      let d = null
      try {
        const txt = await readTextSafe(fsSvc, path.join(teamsDir, String(team), 'team.json'))
        if (!txt) continue
        d = JSON.parse(txt)
      } catch { continue }
      for (const t of d.tasks || []) {
        if (TERMINAL_TASK_STATUS.includes(String(t.status || ''))) continue
        if (COORD_TASK_RE.test(String(t.subject || ''))) continue
        const assignee = String(t.assignee || '')
        const text = String(t.description || '') + ' ' + String(t.subject || '') + ' ' + String(t.acceptance || '')
        if (text.includes(CARD_SECTION_MARK)) continue // 已注入
        const card = await findRoleCard(fsSvc, projectDir, assignee, path)
        if (card) out.push({ team: String(team), taskId: String(t.id ?? '?'), assignee, card: card.relPath })
      }
    }
  } catch { return [] }
  return out
}

/** 成员真交付检查（v0.26）——execute 阶段最缺的一道检查。
 *
 *  用户质疑（2026-11-26）：「整个工作流程没有代码细化下去，导致有些步骤被跳过了」。
 *  核实后确认：execute 闸原来只查「方案设计存在 + captain 不自领 + 无卡死任务」，
 *  全是"防 captain 越权"，**完全不查成员是否真的交付了东西**——这是流程中最长的一段，
 *  却是检查最薄的一段：成员报 ready 就算过了，哪怕什么产出都没有。
 *
 *  本函数只查两件可机械判定的事（不猜意图、不评判质量）：
 *    ① 声称 completed 的成员任务，其 STATUS.md 必须存在（成员失忆后唯一的进度锚点）
 *    ② 其交付物目录 .jarvis/outputs/<ticketId>/ 非空（至少有一个文件）
 *
 *  判据刻意克制：
 *    · 只看「已完成」的任务——在办任务不该有产出，查它会误拦正常流程
 *    · captain 的任务豁免（它是调度者）
 *    · 只查"有没有"，不查"好不好"（质量归 jarvis_perf / 覆盖矩阵）
 *    · 检查异常不抛，返回空（宁可放过也不要让流程死锁）
 */
export async function checkMemberDeliverables(fsSvc, projectDir, path, owned) {
  const missing = []
  if (!fsSvc) return missing
  try {
    const teamsDir = path.join(projectDir, '.agent-teams')
    const teamsRaw = await listNames(fsSvc, teamsDir)
    if (!teamsRaw) return missing
    const teams = owned && owned.size ? teamsRaw.filter((n) => owned.has(String(n))) : teamsRaw
    const completed = []
    for (const t of teams) {
      try {
        const txt = await readTextSafe(fsSvc, path.join(teamsDir, String(t), 'team.json'))
        if (!txt) continue
        const d = JSON.parse(txt)
        for (const task of d.tasks || []) {
          if (String(task.status || '') !== 'completed') continue
          const who = String(task.assignee || '')
          if (!who || who === 'captain' || who === 'CEO' || who === '贾维斯') continue
          completed.push({ id: String(task.id || ''), assignee: who })
        }
      } catch {}
    }
    if (!completed.length) return missing
    // ① STATUS.md 必须存在（成员自己维护的进度锚点）
    const noStatus = []
    for (const c of completed) {
      if (!c.id) continue
      let has = false
      try {
        const p = path.join(projectDir, '.jarvis/outputs', c.id, 'STATUS.md')
        const txt = await readTextSafe(fsSvc, p)
        has = !!(txt && String(txt).trim())
      } catch { has = false }
      if (!has) noStatus.push(`${c.id}(${c.assignee})`)
    }
    if (noStatus.length) {
      missing.push(`成员交付缺进度记录：${noStatus.length} 个已完成任务没有 STATUS.md（${noStatus.slice(0, 4).join('、')}）——成员声称做完却没留任何进度痕迹，无法确认是真干过还是空口报完成。要求成员在其任务目录补写 .jarvis/outputs/<ticketId>/STATUS.md（写清做了什么/产出在哪/怎么验证）。`)
    }
    // ② 产出目录必须非空（至少一个文件）
    const noOutput = []
    for (const c of completed) {
      if (!c.id) continue
      let count = 0
      try {
        const dir = path.join(projectDir, '.jarvis/outputs', c.id)
        const names = await listNames(fsSvc, dir)
        count = Array.isArray(names) ? names.length : 0
      } catch { count = 0 }
      // STATUS.md 不算产出（那是进度记录）——只有它没有别的东西 = 没交付物
      if (count <= 1) noOutput.push(`${c.id}(${c.assignee})`)
    }
    if (noOutput.length) {
      missing.push(`成员交付物为空：${noOutput.length} 个已完成任务在 .jarvis/outputs/<ticketId>/ 里没有任何产出文件（${noOutput.slice(0, 4).join('、')}）——"做完了"必须有东西证明：交付物写进该目录（报告/代码/测试/文档都算），只有 STATUS.md 不算。`)
    }
  } catch {}
  return missing
}
