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
export async function hasGlob(fsSvc, dir, keyword) {
  // 语义（F4b，T7 复验要求可区分）：
  //   • 无 fs 服务 / 服务不提供列举能力 → true（"查不了"放行，与历史 fail-open 一致，不能把环境缺失变成拦截）
  //   • 目录不存在（ENOENT/ENOTDIR/NOT_FOUND）→ false（明确"没有这个目录" = 没产物 → 流程闸必须拦）
  //   • 列举成功但无关键字命中 → false
  //   • 其他异常（权限/超时/后端错误）→ true（不确定=放行，避免误拦）
  const isMissing = (e) => {
    const code = String((e && (e.code || e.errno)) || '')
    if (/ENOENT|ENOTDIR|NOT_FOUND|absent/i.test(code)) return true
    return /no such file|not exist|not found|不存在/i.test(String((e && e.message) || ''))
  }
  if (!fsSvc) return true
  try {
    if (typeof fsSvc.list === 'function') {
      const names = await fsSvc.list(dir)
      return (Array.isArray(names) ? names : []).some((n) => String(n).includes(keyword))
    }
    if (typeof fsSvc.resolve === 'function' && typeof fsSvc.listDir === 'function') {
      let target
      try { target = await fsSvc.resolve(dir) } catch (e) { return isMissing(e) ? false : true }
      if (!target) return false // resolve 明确返回空 = 该目录不存在 → 没产物
      const entries = await fsSvc.listDir(target)
      return (Array.isArray(entries) ? entries : []).some((e) => String(e && e.name !== undefined ? e.name : e).includes(keyword))
    }
  } catch (e) { return isMissing(e) ? false : true }
  return true
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
 * 收口闸：团队成员任务必须有 ponder 真核验记录（.jarvis/docs/ponder-verify/<taskId>-*.json，verdict=PASS）。
 * 背景（scan 实证）：6/6 会话 jarvis_distill=0、成员会话 jarvis 工具 0~1 次、jarvis_ponder_check 从未调用，
 * 成员"裸干"交付。此闸把"每个任务都过 ponder 核验"变成机械要求。
 */
export async function checkPonderVerify(fsSvc, projectDir, path, owned) {
  const missing = []
  if (!fsSvc) return missing
  try {
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
          completedMemberTasks.push(String(task.id || ''))
        }
      } catch {}
    }
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
    const unverified = completedMemberTasks.filter((id) => !passed.has(id))
    if (unverified.length > 0) {
      missing.push(`ponder 核验缺失：${unverified.length}/${completedMemberTasks.length} 个成员任务没有 ponder 核验记录（${unverified.slice(0, 5).join('、')}）——成员任务完成后必须用 jarvis_ponder_check(runId=…, dataDir=…, taskId=该任务) 核验 PASS，否则不许收口（scan 教训：成员裸干交付）`)
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
