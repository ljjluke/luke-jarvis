/** 插件状态的**单一快照**（UI 契约 v1 的实现：任何增强 UI 只依赖这一个形状）。

 *  背景：用户要后期给 jarvis 接增强 UI。UI 不该去猜文件布局，也不该为每个面板各调一个接口——
 *  插件对外只暴露三样东西：① 快照（本文件）② 事件 ③ 受控命令（工具）。
 *  快照原则：
 *   - 只读聚合（从磁盘事实算，不写盘、不带副作用）；
 *   - 带 `schema` 版本（`jarvis.snapshot/1`）：UI 只认版本，插件内部结构随便改；
 *   - 全部字段可缺省（UI 按字段存在与否渲染，不假设一定有数据）；
 *   - 每个面板都有稳定的 id（stage/tasks/board/meetings/company/cards/memory/gates/artifacts）。
 */
import { createRequire } from 'node:module'
import { computeStage, JARVIS_STAGES, STAGE_LABELS } from '../gates/stage.js'
import { meetingPolicy } from './meetings.js'
import { CARD_SECTIONS } from './cards.js'

const _require = createRequire(import.meta.url)

export const SNAPSHOT_SCHEMA = 'jarvis.snapshot/1'

function readJsonSafe(dir, rel, fs, path) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'))
  } catch {
    return null
  }
}

function listCards(projectDir, fs, path) {
  const out = []
  const dir = path.join(projectDir, '.jarvis/cards')
  let names = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.md'))
  } catch {
    return out
  }
  for (const n of names) {
    let ok = false
    let missing = CARD_SECTIONS.slice()
    try {
      const text = fs.readFileSync(path.join(dir, n), 'utf8')
      missing = CARD_SECTIONS.filter((s) => !text.includes(s))
      ok = missing.length === 0
    } catch {
      /* 读不到就当结构不全 */
    }
    out.push({ role: n.replace(/\.md$/, ''), path: '.jarvis/cards/' + n, ok, missing })
  }
  return out
}

function listTeams(projectDir, fs, path) {
  const td = path.join(projectDir, '.agent-teams')
  const teams = []
  let names = []
  try {
    names = fs.readdirSync(td).filter((n) => !/^(archived?|_archive|\.)|-archive$/i.test(n))
  } catch {
    return { teams, open: 0, completed: 0 }
  }
  const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'dropped'])
  let open = 0
  let completed = 0
  for (const name of names) {
    const d = readJsonSafe(td, path.join(name, 'team.json'), fs, path)
    if (!d) continue
    const tasks = (d.tasks || []).map((t) => ({
      id: String(t.id ?? ''),
      subject: String(t.subject ?? ''),
      status: String(t.status ?? ''),
      assignee: String(t.assignee ?? ''),
      attempt: Number(t.attempt || 0),
    }))
    for (const t of tasks) (TERMINAL.has(t.status) ? completed++ : open++)
    teams.push({ name: String(name), captainSessionId: d.captainSessionId || '', tasks })
  }
  return { teams, open, completed }
}

function boardSummary(projectDir, fs, path) {
  const d = readJsonSafe(projectDir, '.jarvis/board.json', fs, path)
  const items = (d && Array.isArray(d.items) ? d.items : []).map((i) => ({
    id: String(i.id ?? ''),
    type: String(i.type ?? ''),
    content: String(i.content ?? ''),
    status: String(i.status ?? 'open'),
    answerNeeded: i.answerNeeded || undefined,
    essenceChecked: Boolean(i.essenceChecked),
  }))
  const open = items.filter((i) => i.status === 'open')
  return {
    total: items.length,
    open,
    resolved: items.filter((i) => i.status === 'resolved'),
    blockers: open.filter((i) => i.type === '阻塞' || i.type === '接口变更'),
    needsUser: items.filter((i) => i.answerNeeded === 'needs_user'),
  }
}

function memorySummary(projectDir, fs, path) {
  const file = path.join(projectDir, '.jarvis/project.md')
  try {
    const st = fs.statSync(file)
    return { exists: true, updatedAt: new Date(st.mtimeMs).toISOString(), ageHours: Math.round((Date.now() - st.mtimeMs) / 36e5 * 10) / 10, stale: Date.now() - st.mtimeMs > 6 * 3600 * 1000 }
  } catch {
    return { exists: false, stale: true }
  }
}

/**
 * 构建界面快照（只读；不存在的模块就是空，不编造）。
 * @param {string} projectDir
 * @param {{version?:string, tools?:number}} meta 插件自身信息（版本/工具数由调用方给，避免读 package.json）
 */
export function buildSnapshot(projectDir, meta = {}) {
  const fs = _require('node:fs')
  const path = _require('node:path')
  const dir = String(projectDir || '')
  const empty = {
    schema: SNAPSHOT_SCHEMA,
    generatedAt: new Date().toISOString(),
    workspace: { id: dir ? 'jarvis-' + path.basename(dir) : '', cwd: dir, name: '' },
    plugin: { version: String(meta.version || ''), tools: Number(meta.tools || 0), stages: JARVIS_STAGES.map((s) => ({ id: s, label: STAGE_LABELS[s] })) },
    active: false,
  }
  if (!dir) return empty
  let stage = null
  try {
    stage = computeStage(dir)
  } catch {
    stage = null
  }
  let meetings = null
  try {
    meetings = meetingPolicy(dir)
  } catch {
    meetings = null
  }
  const board = boardSummary(dir, fs, path)
  const teams = listTeams(dir, fs, path)
  const cards = listCards(dir, fs, path)
  const memory = memorySummary(dir, fs, path)
  const gates = readJsonSafe(dir, '.jarvis/gates.json', fs, path) || {}
  const company = readJsonSafe(dir, '.jarvis/company-state.json', fs, path)
  const active = Boolean(
    (stage && stage.index > 1) || teams.teams.length || board.total || cards.length || memory.exists || Object.keys(gates).length,
  )
  return {
    ...empty,
    active,
    workspace: { ...empty.workspace, name: (company && company.company && company.company.name) || path.basename(dir) },
    stage: stage
      ? {
          index: stage.index,
          total: stage.total,
          stage: stage.stage,
          label: stage.label,
          done: stage.done || [],
          missing: stage.missing || [],
          next: stage.next || '',
        }
      : null,
    gates,
    artifacts: (stage && stage.artifacts) || {},
    tasks: {
      open: teams.open,
      completed: teams.completed,
      teams: teams.teams,
      byAssignee: teams.teams.flatMap((t) => t.tasks.map((x) => ({ ...x, team: t.name }))),
    },
    board,
    meetings: meetings
      ? {
          required: meetings.required,
          suggested: meetings.suggested,
          counts: meetings.meetings,
          last: meetings.lastMeeting ? { id: meetings.lastMeeting.id, type: meetings.lastMeeting.type, topic: meetings.lastMeeting.topic, date: meetings.lastMeeting.date } : null,
          noMeetingReason: meetings.noMeetingReason,
        }
      : null,
    cards,
    memory,
    company: company || null,
    capabilities: {
      toolCount: Number(meta.tools || 0),
      version: String(meta.version || ''),
      panels: ['stage', 'tasks', 'board', 'meetings', 'cards', 'memory', 'company', 'console', 'events', 'voice'],
      // 能力台契约：工具清单/参数 schema 由 /api/jarvis/tools 提供，执行入口 /api/jarvis/command
      console: { toolsEndpoint: '/api/jarvis/tools', commandEndpoint: '/api/jarvis/command', sessionsEndpoint: '/api/jarvis/sessions' },
    },
  }
}

/** 供路由使用：把快照压成简洁摘要（列表页/头图用，不必拉全量任务）。 */
export function snapshotSummary(snap) {
  if (!snap || !snap.stage) return { active: false }
  return {
    schema: snap.schema,
    active: snap.active,
    stage: `${snap.stage.index}/${snap.stage.total} ${snap.stage.label}`,
    stageId: snap.stage.stage,
    missing: snap.stage.missing.length,
    openTasks: snap.tasks.open,
    blockers: snap.board.blockers.length,
    openBoard: snap.board.open.length,
    meetingsRequired: snap.meetings ? snap.meetings.required.length : 0,
    memoryStale: snap.memory.stale,
  }
}
