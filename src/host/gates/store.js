/** 状态存储与记忆保鲜：.jarvis/gates.json 读写 + 工作区记忆新鲜度 + 工作区画像缓存。
 *
 *  为什么要缓存：guard 在**每次**工具调用前跑，读盘不能每次全量（2s/3s TTL 内复用同一份事实）。
 *  为什么只有这一份：曾出现「computeStage 与 flowguard 各读一遍 gates.json、口径漂移」——闸门判定统一走这里。
 */
import { createRequire } from 'node:module'
import { looksLikePluginRepo } from './ownership.js'
const _require = createRequire(import.meta.url)

// ── 记忆保鲜闸（①）：project.md 落后于工作进度 → 拒绝关键动作 ──────────
// 教训（scan 实证）：project.md 停在 10-19，会话跑到 10-31 —— 12 天工作全在上下文里，一压缩/换会话就"记忆没了"。
export const MEMORY_MAX_AGE_MS = 6 * 60 * 60 * 1000 // 6 小时
export function _memoryState(cwd) {
  try {
    const fs = _require('node:fs')
    const path = _require('node:path')
    const candidates = ['.jarvis/project.md', '.jarvis/board.json']
    let newest = 0
    for (const rel of candidates) {
      try { newest = Math.max(newest, fs.statSync(path.join(cwd, rel)).mtimeMs) } catch {}
    }
    return { exists: newest > 0, ageMs: newest > 0 ? Date.now() - newest : Number.MAX_SAFE_INTEGER, updatedAt: newest > 0 ? new Date(newest).toISOString() : '' }
  } catch {
    return { exists: false, ageMs: Number.MAX_SAFE_INTEGER, updatedAt: '' }
  }
}
/** 关键动作前要求记忆新鲜（project.md/board.json 在 6 小时内更新过） */
export function checkMemoryFresh(cwd, opts = {}) {
  const st = _flowState(String(cwd))
  if (!st.jarvis) return undefined // 非 jarvis 工作区不拦
  const m = _memoryState(String(cwd))
  if (!m.exists) {
    return opts.force
      ? '【jarvis 记忆闸】本工作区没有 .jarvis/project.md —— 先 jarvis_store(save, itemType="project") 建立项目记忆（续接五件套：当前进度/下一步/未决项/团队清单/关键决策与依据），再继续。'
      : undefined
  }
  if (m.ageMs > MEMORY_MAX_AGE_MS) {
    const hours = Math.round(m.ageMs / 3600000)
    return `【jarvis 记忆闸】工作记忆已 ${hours} 小时未更新（最后 ${m.updatedAt}）——继续之前必须先把当前进度写回 .jarvis/project.md（续接五件套：当前进度/下一步/未决项/团队清单/关键决策与依据），否则换会话或上下文压缩后这段工作就丢了（scan 教训：12 天工作没落盘）。`
  }
  return undefined
}

// ── 闸门留痕（.jarvis/gates.json）：flowguard 通过才写，其他动作必须持闸 ──────────
// 目的：让流程"不可被提示词绕过"——用户即使要求"跳过蒸馏/直接干"，机械闸也会拒绝。
const _gateCache = { at: 0, cwd: '', gates: {} }
export function _readGates(cwd) {
  const now = Date.now()
  if (_gateCache.cwd === cwd && now - _gateCache.at < 2000) return _gateCache.gates
  let gates = {}
  try {
    const fs = _require('node:fs')
    const path = _require('node:path')
    gates = JSON.parse(fs.readFileSync(path.join(cwd, '.jarvis/gates.json'), 'utf8')) || {}
  } catch { gates = {} }
  _gateCache.at = now
  _gateCache.cwd = cwd
  _gateCache.gates = gates
  return gates
}
/** flowguard 通过时落闸（step → {ok, at}）；失败不落闸（旧闸保留，避免抖动静默放行） */
export function recordGate(cwd, step, ok) {
  if (!cwd || !step || !ok) return false
  // T13 ⑤ 纵深防御：插件仓库自身不是 jarvis 状态根 → 一律拒写（防止任何调用方（含测试/旧会话）
  // 把第二个 .jarvis 写出来造成假 PASS）
  if (looksLikePluginRepo(cwd)) {
    // 插件仓库自身只有在「真的存在 .agent-teams/<团队>/team.json」时才可能承载 jarvis 状态（例如本地联调），
    // 否则一律拒写——注意不能只看 `.agent-teams` 目录是否存在（mkdir 也会造出空目录）。
    const fs0 = _require('node:fs')
    const path0 = _require('node:path')
    let hasTeam = false
    try {
      const td = path0.join(String(cwd), '.agent-teams')
      hasTeam = fs0.readdirSync(td).some((n) => { try { return fs0.statSync(path0.join(td, String(n), 'team.json')).isFile() } catch { return false } })
    } catch { hasTeam = false }
    if (!hasTeam) return false
  }
  try {
    const fs = _require('node:fs')
    const path = _require('node:path')
    const dir = path.join(cwd, '.jarvis')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'gates.json')
    let gates = {}
    try { gates = JSON.parse(fs.readFileSync(file, 'utf8')) || {} } catch { gates = {} }
    // T11（captain 追加）：**不许静默覆盖人工 note**。原 gates.json 里人工补写的 note/by/manual 字段
    // 是审计痕迹（真实工作区曾有 4 条「fail-open 误报，已人工复核」的 note），覆盖前归档到 noteHistory，
    // 并保留 note 原文 + stamped 标记（stamped=true 表示该条目由机械闸写入，not 人工）。
    const now = new Date().toISOString()
    const prev = gates[step] && typeof gates[step] === 'object' ? gates[step] : null
    const manualNote = prev && (typeof prev.note === 'string' ? prev.note : '')
    const entry = { ok: true, at: now, stamped: true }
    if (manualNote) {
      const history = Array.isArray(prev.noteHistory) ? [...prev.noteHistory] : []
      // 幂等归档：同一条 note 只归档一次（旧实现每次机械写都再追加一条 → noteHistory 无界膨胀、审计痕迹失真）
      const already = history.some((h) => h && h.note === manualNote)
      if (!already) {
        history.push({ note: manualNote, at: prev.at || null, archivedAt: now, archivedBy: 'recordGate', reason: '机械闸写入前归档人工 note（不许静默覆盖）' })
      }
      entry.note = manualNote
      entry.noteHistory = history
      if (prev.by) entry.by = prev.by // 人工署名不丢
      if (prev.manual) entry.manual = prev.manual
    }
    gates[step] = entry
    fs.writeFileSync(file, JSON.stringify(gates, null, 2))
    _gateCache.at = 0
    return true
  } catch { return false }
}

// ── 流程闸：jarvis 团队会话在「未过 clarify/project 闸」前不得直接开工 ──────────────
// 背景（scan 实证）：会话跑 1166 轮、31 次压缩后，jarvis 技能正文被压缩丢弃，
// agent 只看到工具名 → 用 1472 次 send_message + 1195 次抓包直接当包工头，
// 蒸馏/开会/flowguard/CEO 绩效 全部 0 次。文字协议拦不住，必须让它**机械失败**。
//
// 规则（领域无关、只对「jarvis 工作区 + 团队 captain」生效）：
//   1) 首次用 agent_teams_create/create_task/reassign_task 前，必须已过 jarvis_flowguard(clarify)
//      —— 即工作区 .jarvis/ 下已有需求规格或基线清单（flowguard 产出）。
//   2) 建队/派活前必须已蒸馏角色卡：.jarvis/cards/ 至少 2 张（带队 + 岗位），否则拒绝建队。
//   3) 开工（执行类工具）前必须已过 design 闸：.jarvis/docs/方案设计-*.md 存在。
// 全部只读判断（读 .jarvis 目录），失败返回明确指引，不静默。
const _flowCache = { at: 0, cwd: '', state: null }
export function _flowState(cwd) {
  const now = Date.now()
  if (_flowCache.cwd === cwd && now - _flowCache.at < 3000) return _flowCache.state
  const st = { jarvis: false, hasReq: false, hasDesign: false, cards: 0, baseline: 0 }
  try {
    const fs = _require('node:fs')
    const path = _require('node:path')
    if (fs.existsSync(path.join(cwd, '.jarvis'))) {
      st.jarvis = true
      const docs = path.join(cwd, '.jarvis/docs')
      const list = (d) => { try { return fs.readdirSync(d) } catch { return [] } }
      const docsList = list(docs)
      st.hasReq = docsList.some((n) => /^需求规格/.test(n))
      st.hasDesign = docsList.some((n) => /^方案设计/.test(n))
      st.baseline = docsList.filter((n) => /^基线清单[-_]/.test(n)).length
      st.cards = list(path.join(cwd, '.jarvis/cards')).filter((n) => /\.md$/i.test(n)).length
    }
  } catch {}
  _flowCache.at = now
  _flowCache.cwd = cwd
  _flowCache.state = st
  return st
}
