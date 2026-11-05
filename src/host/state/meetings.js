/** 会议判定（不是摆设）：从真实事实算出「现在该不该开会、开哪种会、议题是什么」。

 *  用户问题：团队什么时候该开工会/头脑风暴、什么时候该开冲突会、什么时候该收口——这些怎么判定？
 *  原则：判据全部来自磁盘事实（团队任务、黑板未决项、已有纪要），不靠模型自觉，也不"为开会而开会"：
 *    ① 有活但没开过工工会        → 必开 kickoff（对齐目标/验收/接口/分工）
 *    ② 黑板有未解决阻塞/接口变更 → 必开 cycle（冲突/阻塞会）
 *    ③ 黑板未决项 ≥3            → 必开 cycle（收敛会）
 *    ④ 两个成员在同一主题上并行  → 必开 cycle（分工冲突）
 *    ⑤ 开工后新成员进场          → 必开 cycle（上下文对齐会）
 *    ⑥ 任务全交完但没开收口会    → 必开 close（逐项验收）
 *    ⑦ 以上都不成立              → 明确说「不开会，继续干」（防开会成瘾）
 *  节流：最近一次 cycle 会后黑板没新变化 → 不重复要求（防同一件事反复催开会）。
 */
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

export const MEETING_TYPES = ['kickoff', 'cycle', 'close']
export const MEETING_LABELS = { kickoff: '开工对齐会', cycle: '循环会（冲突/阻塞/接口变更）', close: '收口会' }
const ARCHIVED_TEAM_RE = /^(archived|_archive|\.)|-archive$/i
const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'dropped'])
const COORD_RE = /^【(协调|验收|汇报)】/
const CYCLES_THROTTLE_MS = 2 * 3600 * 1000

/** 读已有会议纪要（.jarvis/meetings/*-minutes.json）。坏文件跳过，不崩。 */
export function readMinutesSync(projectDir, path = _require('node:path')) {
  const fs = _require('node:fs')
  const dir = path.join(String(projectDir || ''), '.jarvis/meetings')
  let names = []
  try {
    names = fs.readdirSync(dir).filter((n) => /-minutes\.json$/i.test(n))
  } catch {
    return []
  }
  const out = []
  for (const n of names) {
    const file = path.join(dir, n)
    try {
      const m = JSON.parse(fs.readFileSync(file, 'utf8'))
      const type = String(m.type || '').toLowerCase()
      out.push({
        id: n.replace(/-minutes\.json$/i, ''),
        type: MEETING_TYPES.includes(type) ? type : String(m.type || ''),
        topic: String(m.topic || ''),
        date: String(m.date || ''),
        attendees: Array.isArray(m.attendees) ? m.attendees : String(m.attendees || '').split(/[,，、\s]+/).filter(Boolean),
        agenda: Array.isArray(m.agenda) ? m.agenda : String(m.agenda || '').split(/\n/).filter(Boolean),
        resolutions: Array.isArray(m.resolutions) ? m.resolutions : String(m.resolutions || '').split(/\n/).filter(Boolean),
        conclusion: String(m.conclusion || ''),
        actions: Array.isArray(m.actions) ? m.actions : [],
        mtimeMs: fs.statSync(file).mtimeMs,
      })
    } catch {
      /* 坏纪要忽略 */
    }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs)
}

/** 读黑板未决项（open）与阻塞/接口变更项。 */
export function readBoardOpenSync(projectDir, path = _require('node:path')) {
  const fs = _require('node:fs')
  const file = path.join(String(projectDir || ''), '.jarvis/board.json')
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const items = Array.isArray(data.items) ? data.items : []
    const open = items.filter((i) => String(i.status || 'open') === 'open')
    const blockers = open.filter((i) => i.type === '阻塞' || i.type === '接口变更')
    return { open, blockers, mtimeMs: fs.statSync(file).mtimeMs }
  } catch {
    return { open: [], blockers: [], mtimeMs: 0 }
  }
}

/** 读团队任务事实（排除归档团队）。 */
export function readTeamFactsSync(projectDir, path = _require('node:path'), opts = {}) {
  const fs = _require('node:fs')
  const td = path.join(String(projectDir || ''), '.agent-teams')
  const tasks = []
  const teams = []
  let names = []
  try {
    names = fs.readdirSync(td).filter((n) => !ARCHIVED_TEAM_RE.test(n))
  } catch {
    return { teams, tasks, openTasks: [], members: [] }
  }
  const allowed = Array.isArray(opts.teams) && opts.teams.length ? new Set(opts.teams.map(String)) : null
  for (const t of names) {
    if (allowed && !allowed.has(String(t))) continue // 只算自家团队（别家的缺口不拦本项目）
    const file = path.join(td, t, 'team.json')
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'))
      const list = Array.isArray(d.tasks) ? d.tasks : []
      teams.push(String(t))
      for (const x of list) {
        tasks.push({
          team: String(t),
          id: String(x.id ?? ''),
          subject: String(x.subject ?? ''),
          assignee: String(x.assignee ?? ''),
          status: String(x.status ?? ''),
        })
      }
    } catch {
      /* 无 team.json / 坏 JSON → 跳过 */
    }
  }
  const openTasks = tasks.filter((x) => !TERMINAL.has(x.status))
  const members = [...new Set(openTasks.map((x) => x.assignee).filter((a) => a && a !== 'captain' && !/^CEO$/i.test(a)))]
  return { teams, tasks, openTasks, members }
}

/** 归一化任务主题，用于发现"两人在做同一件事"（分工冲突）。 */
function normSubject(s) {
  return String(s || '')
    .replace(/【[^】]*】/g, '')
    .replace(/[\s\d\-—_()（）\[\]【】:：]/g, '')
    .toLowerCase()
}

/**
 * 会议判定（单一事实源）：返回必开/建议/不必开，以及每个必开会的议题、参会人、判据。
 * @returns {{required:Array<{type:string,why:string,agenda:string[],attendees:string[]}>,suggested:Array<object>,lastMeeting:object|null,noMeetingReason:string}}
 */
export function meetingPolicy(projectDir, path = _require('node:path'), opts = {}) {
  const facts = readTeamFactsSync(projectDir, path, opts)
  // boardItems：调用方手里已有内存版黑板（jarvis_board 当场写入后未落盘的条目）时以它为准
  const diskBoard = readBoardOpenSync(projectDir, path)
  let board = diskBoard
  if (Array.isArray(opts.boardItems)) {
    const open = opts.boardItems.filter((i) => String(i.status || 'open') === 'open')
    board = {
      open,
      blockers: open.filter((i) => i.type === '阻塞' || i.type === '接口变更'),
      mtimeMs: diskBoard.mtimeMs || Date.now(),
    }
  }
  const minutes = readMinutesSync(projectDir, path)
  const kickoffs = minutes.filter((m) => m.type === 'kickoff')
  const cycles = minutes.filter((m) => m.type === 'cycle')
  const closes = minutes.filter((m) => m.type === 'close')
  const lastCycle = cycles[cycles.length - 1]
  const required = []
  const suggested = []

  // ① 开工会：有团队有任务却没开过工工会
  if (facts.teams.length > 0 && facts.tasks.length > 0 && kickoffs.length === 0) {
    required.push({
      type: 'kickoff',
      why: `团队已建、已有 ${facts.tasks.length} 个任务，但没有开工对齐纪要——开工前必须全员对齐目标/验收标准/接口契约/依赖分工，否则各人按自己的理解干`,
      agenda: ['需求本质与会话目标（为谁/解决什么/怎样算成功）', '验收标准逐条确认（可判定）', '接口契约（谁给谁什么、格式、时机）', '依赖与分工（上游/下游/全程参与）', '风险与红线（哪些做法一票否决）'],
      attendees: facts.members,
    })
  } else if (facts.teams.length > 0 && facts.tasks.length === 0) {
    suggested.push({
      type: 'kickoff',
      why: '团队已建但还没派活——先开对齐会再派活，比派完再改省事',
      agenda: ['目标与验收标准', '接口契约', '依赖与分工'],
      attendees: [],
    })
  }

  // ② 冲突/阻塞会：黑板有未解决阻塞或接口变更
  const conflictPairs = []
  const bySubject = new Map()
  for (const t of facts.openTasks) {
    if (COORD_RE.test(t.subject)) continue
    const k = normSubject(t.subject)
    if (!k) continue
    if (!bySubject.has(k)) bySubject.set(k, [])
    bySubject.get(k).push(t)
  }
  for (const [k, list] of bySubject) {
    const owners = [...new Set(list.map((x) => x.assignee))]
    if (owners.length > 1) conflictPairs.push({ key: k, taskIds: list.map((x) => x.id), owners })
  }
  const newMember = kickoffs.length > 0 && facts.members.some((m) => !kickoffs.some((k) => (k.attendees || []).includes(m)))
  const cycleReasons = []
  if (board.blockers.length) {
    cycleReasons.push(`黑板 ${board.blockers.length} 项未解决阻塞/接口变更（${board.blockers.map((b) => b.id).join('、')}）`)
  }
  if (board.open.length >= 3) cycleReasons.push(`黑板未决项 ${board.open.length} 项（≥3）需要收敛`)
  if (conflictPairs.length) {
    cycleReasons.push(`${conflictPairs.length} 处分工冲突（${conflictPairs.map((c) => c.taskIds.join('/') + ' → ' + c.owners.join(' vs ')).join('；')}）`)
  }
  if (newMember) cycleReasons.push(`开工后新成员进场（${facts.members.filter((m) => !kickoffs.some((k) => (k.attendees || []).includes(m))).join('、')}）需要上下文对齐`)
  // 节流：最近一次 cycle 会之后黑板/任务没有新变化 → 不重复要求
  const changedAfterCycle = lastCycle ? board.mtimeMs > lastCycle.mtimeMs : true
  if (cycleReasons.length && (changedAfterCycle || board.blockers.length > 0)) {
    required.push({
      type: 'cycle',
      why: cycleReasons.join('；'),
      agenda: [
        ...board.blockers.map((b) => `${b.id}（${b.type}）${String(b.content || '').slice(0, 60)} → 谁来解、需要什么、何时给`),
        ...board.open.filter((i) => !board.blockers.includes(i)).slice(0, 5).map((i) => `${i.id}（${i.type}）${String(i.content || '').slice(0, 60)}`),
        ...conflictPairs.map((c) => `分工冲突：任务 ${c.taskIds.join('/')} 分属 ${c.owners.join(' vs ')} → 定谁负责、接口怎么切`),
      ],
      attendees: [...new Set([...facts.members, ...board.blockers.map(() => '').filter(Boolean)])],
    })
  }

  // ③ 收口会：任务全交完但没开收口会
  if (facts.tasks.length > 0 && facts.openTasks.length === 0 && closes.length === 0) {
    required.push({
      type: 'close',
      why: `所有任务已交（${facts.tasks.length} 个），但没有收口会纪要——交付前必须逐项对验收标准、给遗留项分级`,
      agenda: ['逐任务对照验收标准（通过/未通过+原因）', '黑板遗留项分级（已解决/降级/遗留+影响）', '交付物清单与验收路径', '是否需要继续/收队'],
      attendees: [...new Set(facts.tasks.map((t) => t.assignee).filter(Boolean))],
    })
  }

  const noMeetingReason = required.length
    ? ''
    : board.open.length === 0 && !lastCycle
      ? '黑板无未决项、无阻塞——不必开会，继续干活'
      : `黑板未决 ${board.open.length} 项（无阻塞）、无分工冲突、最近一次循环会 ${lastCycle ? lastCycle.id : '（无）'} 之后没有新变化——暂不必开会`
  return {
    required,
    suggested,
    lastMeeting: minutes.length ? minutes[minutes.length - 1] : null,
    meetings: { kickoff: kickoffs.length, cycle: cycles.length, close: closes.length },
    noMeetingReason,
  }
}

/** 一行注入文本（给 systemPrompt 阶段块用）。 */
export function renderMeetingStatus(projectDir, path = _require('node:path'), opts = {}) {
  const p = meetingPolicy(projectDir, path, opts)
  if (p.required.length) {
    return `会议：必开 ${p.required.map((r) => `${MEETING_LABELS[r.type] || r.type}（${r.why}）`).join('；')} → 用 jarvis_meeting(meetingType=…) 开会并把纪要写进 .jarvis/meetings/`
  }
  if (p.suggested.length) return `会议：建议 ${p.suggested.map((s) => `${MEETING_LABELS[s.type] || s.type}（${s.why}）`).join('；')}`
  return `会议：${p.noMeetingReason || '暂不需要开会'}`
}

/**
 * 会议缺口（给 jarvis_flowguard 各阶段用）：必开但没开的会 → missing 文案。
 * 阶段归属：build 看 kickoff；execute 看 cycle；close 看 close；其它阶段不查。
 */
export function meetingGaps(projectDir, stage, path = _require('node:path'), opts = {}) {
  const want = { build: ['kickoff'], execute: ['kickoff', 'cycle'], close: ['close'] }[String(stage || '')]
  if (!want) return []
  const p = meetingPolicy(projectDir, path, opts)
  return p.required
    .filter((r) => want.includes(r.type))
    .map((r) => `必开「${MEETING_LABELS[r.type]}」但还没开：${r.why}（开会后纪要落 .jarvis/meetings/<id>-minutes.json）`)
}

/** 纪要必填要素（缺什么报什么，不许"开了但没结论"混过去）。 */
export function checkMinutesShape(m) {
  const missing = []
  if (!m || typeof m !== 'object') return ['纪要必须是 JSON 对象']
  const type = String(m.type || '').toLowerCase()
  if (!MEETING_TYPES.includes(type)) missing.push(`type 必须是 ${MEETING_TYPES.join('|')}`)
  if (!String(m.topic || '').trim()) missing.push('topic（沟通主题）')
  const attendees = Array.isArray(m.attendees) ? m.attendees : String(m.attendees || '').split(/[,，、\s]+/).filter(Boolean)
  if (attendees.length < 2) missing.push('attendees（至少 2 个角色，一个人不算开会）')
  const resolutions = Array.isArray(m.resolutions) ? m.resolutions : String(m.resolutions || '').split(/\n/).filter(Boolean)
  if (!resolutions.length && !String(m.conclusion || '').trim()) missing.push('resolutions/conclusion（会议结论——开了会没结论等于没开）')
  const actions = Array.isArray(m.actions) ? m.actions : []
  if (!actions.length) missing.push('actions（会后谁负责什么）')
  return missing
}
