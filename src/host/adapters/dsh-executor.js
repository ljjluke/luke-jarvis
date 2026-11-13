/** 自建子任务执行器：把 core 的 Executor 端口接到 DSH 原生 subagents 运行时。
 *
 *  背景（docs/CORE.md 迁移台账 P3-a）：任务单内核（host/core 的 Ticket 状态机）开单时
 *  会调用 executor.start(ticket, assignment)，此前接的是 noopExecutor——单开了没人干。
 *  本模块实现真执行：创建成员子会话执行任务，成员用 jarvis_ticket(report) 回报推进状态机，
 *  从而替代 @nanmicoder/dsh-agent-teams 的派单运行时。
 *
 *  DSH 原生 API（0.1.5-rc 宿主实测形态，与 agent-teams harness-compat 同源）：
 *    · ctx.subagents.getProvider(name)/list()          provider 注册表（如 subagent-spawn）
 *    · ctx.subagents.startActivation/startContinuable/start(start)   创建成员子会话
 *    · ctx.subagents.followup(parent, childId, text)   向成员投递 prompt（唤醒/排队）
 *    · ctx.agents.get(sessionId)                       Agent（status/cancel/whenIdle）
 *  简化决策（第一版）：
 *    · persona/toolFilter 不走宿主注册（兼容分支多），角色宪法全部内联在任务简报文本里；
 *    · 成员防越权（不能开单/裁决/换人）由本模块 guard：isChild() 拦 jarvis_ticket captain 专属动作；
 *    · childId 映射持久化 <project>/.jarvis/tickets/exec-map.json；派单审计走 events.jsonl；
 *    · 成员空闲未汇报 → followup 提醒（每单最多 3 次）。
 */
import { createRequire } from 'node:module'
import { appendEvent } from '../state/events.js'
import { getRuntimeContext, getLatestExec, getFsService } from '../runtime.js'
import { readCompanyState } from '../state/company-io.js'
import { MEMBER_DELIBERATION, STAGE_DELIBERATION, STUCK_MEETING } from '../protocol/deliberation.js'

const _require = createRequire(import.meta.url)
function nodeFs() { return _require('node:fs') }
function nodePath() { return _require('node:path') }

/** STATUS.md 相对路径（工作区内的固定锚点）。模块级：deliver.js 汇报校验也要用。 */
export function statusRelPath(ticket, assignment) {
  const tid = (ticket && ticket.id) || (assignment && assignment.id) || 'unknown'
  return `.jarvis/outputs/${tid}/STATUS.md`
}

/** 交接时校验 STATUS.md 是否新鲜（成员自己有没有维护）。
 *  返回提示文本；空 = 正常。⛔ 不阻塞汇报，只做「如实告知」。
 */
export function checkStatusFreshness(projectDir, ticket, assignment, maxAgeMin = 30) {
  try {
    const fsM = nodeFs()
    const pathM = nodePath()
    const abs = pathM.join(String(projectDir || ''), statusRelPath(ticket, assignment))
    let text = ''
    try { text = fsM.readFileSync(abs, 'utf8') } catch { text = '' }
    if (!text) {
      return '⚠️ 这个任务单没有 STATUS.md——上下文压缩后你将无法恢复进度。请在收尾前补写 ' +
        `${statusRelPath(ticket, assignment)}（现在做到哪 / 下一步 / 卡在哪）。`
    }
    const st = fsM.statSync(abs)
    const ageMin = Math.round((Date.now() - st.mtimeMs) / 60000)
    // 只有插件自动段 = 成员没自己维护过（自动段以 STATUS_MARK 开头）
    const afterMark = text.split('<!-- jarvis:auto-status -->')[1] || ''
    const ownLines = afterMark.split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('<!--') && !l.startsWith('- ') && !l.startsWith('# '))
    if (!ownLines.length) {
      return '⚠️ STATUS.md 目前只有插件自动段，没有你自己的进度记录——请补上「现在做到哪 / 下一步 / 卡在哪」。'
    }
    if (ageMin > maxAgeMin) {
      return `⚠️ STATUS.md 已有 ${ageMin} 分钟没更新（超过 ${maxAgeMin} 分钟）——如果真的完成/卡住了，请更新它再汇报。`
    }
    return ''
  } catch { return '' }
}

const QUEUE_PROMPT = Symbol.for('dsh.subagent.queuePrompt')
const DELIVER_PROMPT = Symbol.for('dsh.subagent.deliverPrompt')

const CHILDREN_BY_ROOT = new Map() // projectDir -> Set<childId>（进程内，防递归守卫用）
const REMIND_LIMIT = 3
const REMIND_INTERVAL_MS = 60_000

function loadExecMap(root) {
  const fs = nodeFs(); const path = nodePath()
  if (!fs || !path || !root) return {}
  try { return JSON.parse(fs.readFileSync(path.join(root, '.jarvis', 'tickets', 'exec-map.json'), 'utf8')) || {} } catch { return {} }
}
function saveExecMap(root, map) {
  const fs = nodeFs(); const path = nodePath()
  if (!fs || !path || !root) return
  try {
    const file = path.join(root, '.jarvis', 'tickets', 'exec-map.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2))
    fs.renameSync(tmp, file)
  } catch { /* 持久化失败不阻断派单 */ }
}

function captainAgent() {
  const exec = getLatestExec()
  if (exec && exec.agent && exec.agent.id) return exec.agent
  if (exec && exec.session && exec.session.id) return { id: exec.session.id, session: exec.session }
  return null
}

function pickProvider(runtime) {
  try {
    if (typeof runtime.getProvider === 'function' && runtime.getProvider('subagent-spawn')) return 'subagent-spawn'
  } catch { /* 继续探测 */ }
  try {
    const names = typeof runtime.list === 'function' ? runtime.list() : []
    return Array.isArray(names) && names.length ? String(names[0]) : null
  } catch { return null }
}

function memberBrief(ticket, assignment, employee, projectDir) {
  const mandate = ticket.mandate || {}
  const name = employee && employee.name ? String(employee.name) : `成员（${assignment.role}）`
  const lines = [
    `你是数字公司的成员「${name}」，承接角色：${assignment.role}。`,
    ``,
    `任务单 ${ticket.id}（${ticket.stage} 阶段）：${ticket.title}`,
    mandate.basis ? `授权依据：${mandate.basis}` : '',
    `工作区：${projectDir}`,
    ``,
    `工作要求：`,
    `1. ${MEMBER_DELIBERATION.split('\n')[0]}`,
    ...MEMBER_DELIBERATION.split('\n').slice(1).map((l) => `   ${l}`),
    `2. ${STAGE_DELIBERATION.split('\n')[0]}`,
    ...STAGE_DELIBERATION.split('\n').slice(1).map((l) => `   ${l}`),
    `3. ${STUCK_MEETING.split('\n')[0]}`,
    ...STUCK_MEETING.split('\n').slice(1).map((l) => `   ${l}`),
    ...(ticket.meta && ticket.meta.brief
      ? [`4. 角色卡与协同须知（蒸馏卡全文，必须遵守）：`, ...String(ticket.meta.brief).split('\n').map((l) => `   ${l}`)]
      : []),
    `5. 独立完成本任务单；产出文件写进工作区（建议 .jarvis/outputs/ 下按 ticketId 建目录），关键结论写清楚。`,
    `5b. 【进度自保 · 重要】随时把当前进度写进 .jarvis/outputs/${ticket.id}/STATUS.md（一行「现在做到哪 / 下一步 / 卡在哪」即可）。`,
    `    为什么：你的对话上下文可能被压缩，压缩后那份 brief 会消失；STATUS.md 是你唯一的恢复锚点——`,
    `    中断后先读它，就知道自己做到哪了。这也让主会话能随时查看你的真实进度。`,
    `6. 完成或阶段性进展必须汇报——调用工具 jarvis_ticket：`,
    `   action=report, ticketId=${ticket.id}, assignmentId=${assignment.id},`,
    `   state=ready（已交付）/ progress（进行中，说明做到哪）/ blocked（缺依赖或等确认）/ failed（失败及原因），`,
    `   summary=一句话结果与产出位置。ready/blocked/failed 后本单交回 captain。`,
    `7. 禁止调用 jarvis_ticket 的 open/adjudicate/retry/stop/dismiss（那是 captain 专属）。可以用你环境里的原生子代理（subagent）自主开子任务干细分工作——Super-agent 式自主：深度最多 1 层（子任务的子任务不得再开）；子任务不另开任务单，产出与结论必须并进你对本单的汇报。`,
    `8. 汇报后、收尾前，做一次「空闲找活」（自主性，用户定调）：花一分钟看工作区——黑板未决项、.jarvis/docs/教训、需求规格/待办里有没有明确的下一个活？有就用 jarvis_ticket 提案：action=propose, title=一句话, why=业务理由（出处）, deliberation=推演摘要（方案对比+择优理由）, basis=依据出处。提案≠开工，captain 裁决后才开单；没找到明确的活就直接收尾，不许为提案而提案。`,
    `9. 若收到「提醒」prompt，按提醒要求立即汇报。`,
  ].filter((l) => l !== '')
  return lines.join('\n')
}

async function readEmployee(projectDir, role) {
  try {
    const fsSvc = getFsService()
    const state = await readCompanyState(fsSvc, projectDir)
    return (state && Array.isArray(state.employees) ? state.employees : []).find((e) => e && e.role === role) || null
  } catch { return null }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function createDshExecutor({ projectDir, getEngine, labelPrefix = 'jarvis-ticket' }) {
  const root = String(projectDir || '')
  if (!CHILDREN_BY_ROOT.has(root)) CHILDREN_BY_ROOT.set(root, new Set())
  const children = CHILDREN_BY_ROOT.get(root)
  const execMap = loadExecMap(root)

  function record(ticketId, assignmentId, patch) {
    const slot = (execMap[ticketId] = execMap[ticketId] || {})
    slot[assignmentId] = { ...(slot[assignmentId] || {}), ...patch }
    saveExecMap(root, execMap)
  }

  /* ── 按角色复用子会话 ────────────────────────────────────────────────
     问题（用户实测）：每派一单就新开一个子会话，子会话数随任务线性叠加；
     同一角色（如「前端」）做了 10 单就开了 10 个子会话，且新会话没有角色记忆。
     正确做法：一个角色在整个项目里只开一个子会话，后续任务用 followup 投递进去。

     实现：exec-map.json 里已有 childId 记录（跨进程存活），按 role 反查。
     复用条件（全部满足才复用）：
       ① 该角色确有 childId；
       ② 该子会话仍活着（agent 存在且非已终结）；
       ③ 它当前不在「正在执行另一单」的状态（避免两单交错写入）。
     否则新建——宁可多开一个，也不能把任务投进一个可能已死的会话。 */
  function findReusableChild(runtime, role) {
    const wanted = String(role || '').trim()
    if (!wanted) return null
    let ctx = null
    try { ctx = getRuntimeContext() } catch { return null }
    const agents = (() => { try { return ctx && ctx.agents && ctx.agents.list ? ctx.agents.list() : [] } catch { return [] } })()
    const liveIds = new Map()
    for (const a of Array.isArray(agents) ? agents : []) {
      try {
        const sid = String((a && a.session && a.session.id) || '')
        if (sid) liveIds.set(sid, a)
      } catch { /* 单个坏条目跳过 */ }
    }
    // 反查：这个角色最近一次派发用的 childId（retired 的跳过——已换人）
    let best = null
    for (const [, slot] of Object.entries(execMap)) {
      for (const [, info] of Object.entries(slot || {})) {
        if (String(info && info.role || '') !== wanted) continue
        if (info && info.retired) continue
        const childId = String(info && info.childId || '')
        if (!childId) continue
        const at = String(info.startedAt || '')
        if (!best || at > best.at) best = { childId, at }
      }
    }
    if (!best) return null
    const agent = liveIds.get(best.childId)
    if (!agent) return null                       // 会话已不存在：不复用
    let status = ''
    try { status = String(agent.status || '') } catch { status = '' }
    if (status === 'ended' || status === 'closed' || status === 'terminated') return null
    // 正在跑另一单：不复用（避免交错）
    if (status === 'running' || status === 'working') {
      try {
        const engine = getEngine && getEngine()
        const agentTicket = engine && typeof engine.viewByChild === 'function' ? engine.viewByChild(best.childId) : null
        if (agentTicket && !agentTicket.ticket.ended) return null
      } catch { /* 查不到归属就不复用（保守） */ }
      return null
    }
    console.debug(`[luke-jarvis] 复用角色「${wanted}」的子会话 ${best.childId}`)
    return best.childId
  }

  async function deliverPrompt(runtime, parent, childId, content) {
    if (typeof runtime.followup === 'function' && parent) {
      return runtime.followup.call(runtime, parent, childId, content, {})
    }
    const deliver = runtime[DELIVER_PROMPT]
    if (typeof deliver === 'function' && parent) {
      return deliver.call(runtime, parent, childId, content, undefined, undefined, 'queue')
    }
    const queue = runtime[QUEUE_PROMPT]
    if (typeof queue === 'function' && parent) {
      return queue.call(runtime, parent, childId, content, undefined, undefined)
    }
    throw new Error('无可用 prompt 投递通道')
  }

  /** 成员会话续接线索：上下文压缩后成员会忘掉 brief，提醒时重新给最小可抓线索。
   *  （长会话保活第 ④ 层：成员是独立会话，压缩同样致命，而它没有主会话那套续接注入） */
  function memberResumeHint(ticket, assignment, projectDir) {
    const statusPath = statusRelPath(ticket, assignment)
    return [
      '【续接线索 · 上下文若已被压缩，以下是你该记住的最小事实】',
      `- 任务单：${ticket && ticket.id || '?'}（${ticket && ticket.stage || '?'} 阶段）：${ticket && ticket.title || '?'}`,
      `- 你的角色：${assignment && assignment.role || '?'}；assignmentId=${assignment && assignment.id || '?'}`,
      `- 工作区：${projectDir}`,
      `- 你的进度应写在：${statusPath}（若中断过，先读这个文件恢复上下文）`,
      `- 交付物目录：.jarvis/outputs/${ticket && ticket.id || '?'}/`,
    ].join('\n')
  }

  /** 插件自动写 STATUS.md —— 不依赖模型自觉。
   *  为什么需要这一层：brief 里只是"要求"成员自己写，而压缩后它可能连这个要求都忘了。
   *  插件用 ticket 的真实状态（谁、哪单、什么阶段、什么状态）落盘一份，
   *  即使成员完全失忆，STATUS.md 里也有可恢复的事实骨架。
   *  成员自己写的详细内容不会被覆盖（只在文件不存在或插件标记段缺失时补写）。
   */
  const STATUS_MARK = '<!-- jarvis:auto-status -->'
  function autoWriteStatus(projectDir, ticket, assignment) {
    try {
      const fsM = _require('node:fs')
      const pathM = _require('node:path')
      const rel = statusRelPath(ticket, assignment)
      const abs = pathM.join(String(projectDir || ''), rel)
      const stage = String((ticket && ticket.stage) || '?')
      const title = String((ticket && ticket.title) || '')
      const role = String((assignment && assignment.role) || '')
      const aid = String((assignment && assignment.id) || '')
      const block = [
        STATUS_MARK,
        `# 任务进度（插件自动维护，请不要删除本段）`,
        `- 任务单：${(ticket && ticket.id) || '?'}（${stage} 阶段）：${title}`,
        `- 我的角色：${role}；assignmentId=${aid}`,
        `- 更新时间：${new Date().toISOString()}`,
        `- 交付物目录：.jarvis/outputs/${(ticket && ticket.id) || '?'}/`,
        '',
        '<!-- 以下由你（成员）自己维护：现在做到哪 / 下一步 / 卡在哪 -->',
      ].join('\n')
      let existing = ''
      try { existing = fsM.readFileSync(abs, 'utf8') } catch { existing = '' }
      if (!existing) {
        fsM.mkdirSync(pathM.dirname(abs), { recursive: true })
        fsM.writeFileSync(abs, block + '\n')
        return { written: true, created: true }
      }
      // 已有文件：只在缺少插件标记段时补在最前（不覆盖成员写的内容）
      if (!existing.includes(STATUS_MARK)) {
        fsM.writeFileSync(abs, block + '\n\n' + existing)
        return { written: true, created: false }
      }
      return { written: false, created: false }
    } catch { return { written: false, created: false } }
  }

  /** 成员空闲未汇报 → 提醒（限次）；票结束即停。 */
  function watchChild(ticketId, assignmentId, childId, parent) {
    void (async () => {
      for (let i = 0; i < REMIND_LIMIT; i++) {
        await sleep(REMIND_INTERVAL_MS)
        try {
          const ctx = getRuntimeContext()
          const runtime = ctx && ctx.subagents
          if (!runtime) return
          const engine = getEngine && getEngine()
          const view = engine && typeof engine.view === 'function' ? engine.view(ticketId) : null
          if (!view || view.ticket.ended) return
          const asg = (view.ticket.assignments || []).find((a) => a.id === assignmentId)
          if (!asg || asg.state !== 'running') return
          let agent = null
          try { agent = ctx.agents && ctx.agents.get(childId) } catch { }
          if (agent && agent.status && agent.status !== 'idle') continue
          // 提醒前先刷新插件自动段（成员若一直没写，至少骨架是最新的）
          try { autoWriteStatus(root, view.ticket, asg) } catch { /* 写失败不影响提醒 */ }
          await deliverPrompt(
            runtime,
            parent,
            childId,
            // 提醒里带上续接线索：成员上下文可能已被压缩，brief 已丢失，这里重新给最小事实
            `${memberResumeHint(view.ticket, asg, root)}\n\n提醒：任务单 ${ticketId} 尚未收到你的汇报。请立即调用工具 jarvis_ticket（action=report, ticketId=${ticketId}, assignmentId=${assignmentId}, state=ready|progress|blocked|failed, summary=结果摘要）。`,
          )
          appendEvent(root, 'assignment.remind', { ticketId, assignmentId, childId, round: i + 1 })
        } catch { /* 提醒失败不影响主流程 */ }
      }
    })()
  }

  async function dispatch(ticket, assignment) {
    const ctx = getRuntimeContext()
    const runtime = ctx && ctx.subagents
    if (!runtime || typeof runtime !== 'object') throw new Error('DSH subagents 服务不可用')
    const provider = pickProvider(runtime)
    if (!provider) throw new Error('无可用 subagent provider（检查组合里是否挂了 subagent-spawn）')
    const parent = captainAgent()
    const employee = await readEmployee(root, assignment.role)
    const brief = memberBrief(ticket, assignment, employee, root)
    // 第 ④ 层：派发时插件自动落一份 STATUS.md 事实骨架（成员失忆也能从这里恢复）
    try { autoWriteStatus(root, ticket, assignment) } catch { /* 写失败不影响派发 */ }

    // ── 按角色复用：同一角色只开一个子会话（用户实测要求）──────────────
    // 先看这个角色是否已有活着的子会话，有就用 followup 把新任务投进去，不新建。
    const reuseId = findReusableChild(runtime, assignment.role)
    if (reuseId) {
      try {
        const content = [
          memberResumeHint(ticket, assignment, root),
          '',
          brief,
        ].join('\n')
        await deliverPrompt(runtime, parent, reuseId, content)
        children.add(reuseId)
        record(ticket.id, assignment.id, { childId: reuseId, provider, role: assignment.role, reused: true, startedAt: new Date().toISOString() })
        appendEvent(root, 'assignment.reused', { ticketId: ticket.id, assignmentId: assignment.id, role: assignment.role, childId: reuseId })
        watchChild(ticket.id, assignment.id, reuseId, parent)
        return reuseId
      } catch (e) {
        // 复用投递失败（如会话刚死）：退回新建，不让任务卡住
        try { appendEvent(root, 'assignment.reuse.failed', { role: assignment.role, childId: reuseId, error: String((e && e.message) || e) }) } catch { /* 审计失败忽略 */ }
      }
    }

    const label = `${labelPrefix}:${ticket.id}:${assignment.role}`
    const spec = {
      provider,
      label,
      request: {
        prompt: [{ type: 'text', text: brief }],
        ...(parent ? { parent } : {}),
      },
    }
    let started
    if (typeof runtime.startActivation === 'function') {
      started = await runtime.startActivation.call(runtime, { provider, label, request: { ...spec.request }, signal: undefined, delivery: 'parent' })
    } else if (typeof runtime.startContinuable === 'function') {
      started = await runtime.startContinuable.call(runtime, spec)
    } else if (typeof runtime.start === 'function') {
      started = await runtime.start.call(runtime, provider, spec)
    } else {
      throw new Error('宿主缺成员创建 API（startActivation/startContinuable/start 均不可用）')
    }
    const childId = started && String(started.childId || started.id || started.sessionId || '')
    if (!childId) throw new Error('成员会话已创建但未返回 childId')
    children.add(childId)
    record(ticket.id, assignment.id, { childId, provider, role: assignment.role, startedAt: new Date().toISOString() })
    appendEvent(root, 'assignment.dispatched', { ticketId: ticket.id, assignmentId: assignment.id, role: assignment.role, childId, provider })
    watchChild(ticket.id, assignment.id, childId, parent)
    return childId
  }

  return {
    /** core 端口：开单/重试时同步回调；异步执行，失败只记事件不炸事务。 */
    start(ticket, assignment) {
      dispatch(ticket, assignment).catch((error) => {
        try {
          appendEvent(root, 'assignment.dispatch.failed', { ticketId: ticket.id, assignmentId: assignment.id, error: String((error && error.message) || error) })
        } catch { /* 审计失败忽略 */ }
      })
    },
    /** core 端口：人工停止/重试换人时取消成员会话。 */
    stop(ticket, assignment, reason) {
      const slot = execMap[ticket.id] || {}
      const rec = slot[assignment.id]
      try {
        const ctx = getRuntimeContext()
        const agent = rec && rec.childId && ctx && ctx.agents && ctx.agents.get(rec.childId)
        if (agent) agent.cancel({ kind: 'user' }, {})
      } catch { /* 取消失败忽略 */ }
      if (rec) record(ticket.id, assignment.id, { stoppedAt: new Date().toISOString(), stopReason: String(reason || '') })
    },
    /** 该会话是否本执行器派出的成员（jarvis_ticket 用它拦成员越权动作）。 */
    isChild(agentId) { return children.has(String(agentId)) },
    childOf(ticketId, assignmentId) {
      const slot = execMap[ticketId] || {}
      return slot[assignmentId] ? slot[assignmentId].childId : null
    },
    /** 换人（CEO 认为该角色绩效不行时才调）：终止该角色现有子会话，
     *  并在 exec-map 里标记 retired——下次派发不会复用它，而是新建一个。
     *  正常流程不该调用：默认按角色复用同一子会话，只有绩效问题才换。 */
    retireRole(role, reason) {
      const wanted = String(role || '').trim()
      if (!wanted) return { retired: 0 }
      let retired = 0
      const ctx = (() => { try { return getRuntimeContext() } catch { return null } })()
      for (const [tid, slot] of Object.entries(execMap)) {
        for (const [aid, info] of Object.entries(slot || {})) {
          if (String(info && info.role || '') !== wanted) continue
          const childId = String(info && info.childId || '')
          if (!childId) continue
          try {
            const agent = ctx && ctx.agents && ctx.agents.get(childId)
            if (agent && typeof agent.cancel === 'function') agent.cancel({ kind: 'user' }, {})
          } catch { /* 取消失败不阻断标记 */ }
          slot[aid] = { ...info, retired: true, retiredAt: new Date().toISOString(), retireReason: String(reason || '') }
          retired++
        }
      }
      if (retired) saveExecMap(root, execMap)
      try { appendEvent(root, 'assignment.role.retired', { role: wanted, retired, reason: String(reason || '') }) } catch { /* 审计失败忽略 */ }
      return { retired }
    },

    /** 列出孤儿子会话（CEO 批准后可清理；不需要客户介入）。
     *  孤儿判据（全部机器可判，不靠模型猜）：
     *   ① 在 exec-map 里登记过 childId（说明是 jarvis 派出的）
     *   ② 会话仍活着
     *   ③ 该任务单已结束（ended）—— 任务做完会话还挂着，就是孤儿
     *   ④ 或：被标记 retired 但会话还没真正终止
     *   ⑤ 排掉：当前 CEO/captain 会话本身、正在跑活跃任务单的会话、以及当前会话
     */
    findOrphans(callerSessionId) {
      const orphans = []
      const ctx = (() => { try { return getRuntimeContext() } catch { return null } })()
      const liveIds = (() => {
        try { return new Set((ctx && ctx.agents && ctx.agents.list ? ctx.agents.list() : []).map((a) => String((a && a.session && a.session.id) || '')).filter(Boolean)) } catch { return new Set() }
      })()
      const engine = (() => { try { return getEngine && getEngine() } catch { return null } })()
      const captainIds = (() => { try { const m = _require('./gates/stage.js'); return m._captainIds(String(root)) } catch { return new Set() } })()
      const selfId = String(callerSessionId || '')
      // 收集所有登记过的 childId（取每个角色最新一条，避免同角色多条重复列出）
      const seen = new Map()
      for (const [tid, slot] of Object.entries(execMap)) {
        for (const [aid, info] of Object.entries(slot || {})) {
          const childId = String(info && info.childId || '')
          if (!childId) continue
          const at = String(info.startedAt || '')
          if (!seen.has(childId) || at > (seen.get(childId).at || '')) {
            seen.set(childId, { ticketId: tid, assignmentId: aid, role: String(info.role || ''), at, retired: !!info.retired, reused: !!info.reused })
          }
        }
      }
      for (const [childId, meta] of seen) {
        if (childId === selfId) continue                    // 不列当前会话
        if (captainIds.has(childId)) continue               // 不列 CEO 自己
        if (liveIds.has(childId) === false) {
          // 会话已经不在了：只在 exec-map 里留了记录，也要清理记录
          if (meta.retired) continue                        // 已换人的旧记录，无需再处理
          orphans.push({ childId, ...meta, reason: '会话已不存在（记录未清理）', action: 'clean_record' })
          continue
        }
        // 会话还活着：判断它对应的任务单是否已结束
        let ended = false
        try {
          const view = engine && typeof engine.view === 'function' ? engine.view(meta.ticketId) : null
          ended = !!(view && view.ticket && view.ticket.ended)
        } catch { ended = false }
        if (meta.retired) { orphans.push({ childId, ...meta, reason: '已换人但会话未终止', action: 'stop' }); continue }
        if (ended) { orphans.push({ childId, ...meta, reason: '任务已结束但会话仍挂着', action: 'stop' }); continue }
      }
      return orphans
    },

    /** 清理孤儿子会话（⚠️ 只应由 CEO/captain 调用；客户不需要介入）。
     *  @param {string[]} childIds 要清理的 childId（从 findOrphans 取；不传=全部）
     *  @param {string} reason 清理原因（写入审计）
     */
    cleanupOrphans(childIds, reason) {
      const ctx = (() => { try { return getRuntimeContext() } catch { return null } })()
      const want = Array.isArray(childIds) && childIds.length ? new Set(childIds.map(String)) : null
      const list = this.findOrphans('')
      const targets = list.filter((o) => !want || want.has(o.childId))
      let stopped = 0, recordsCleaned = 0
      for (const o of targets) {
        if (o.action === 'stop') {
          try {
            const agent = ctx && ctx.agents && ctx.agents.get(o.childId)
            if (agent && typeof agent.cancel === 'function') agent.cancel({ kind: 'user' }, {})
            stopped++
          } catch { /* 取消失败继续清记录 */ }
        }
        // 清 exec-map 里的记录（无论会话在不在，记录都该清，否则复用索引会一直翻旧账）
        for (const [tid, slot] of Object.entries(execMap)) {
          for (const [aid, info] of Object.entries(slot || {})) {
            if (String(info && info.childId || '') !== o.childId) continue
            delete slot[aid]
            recordsCleaned++
          }
          if (!Object.keys(slot || {}).length) delete execMap[tid]
        }
      }
      if (recordsCleaned) saveExecMap(root, execMap)
      try { appendEvent(root, 'assignment.orphans.cleaned', { stopped, recordsCleaned, reason: String(reason || '') }) } catch { /* 审计失败忽略 */ }
      return { stopped, recordsCleaned, total: targets.length }
    },
  }
}

/** 进程级缓存：每工作区一个 executor（children 集合与提醒循环跨工具调用保持）。 */
const _executors = new Map()
export function dshExecutorFor(projectDir, getEngine) {
  const root = String(projectDir || '')
  let exec = _executors.get(root)
  if (!exec) {
    exec = createDshExecutor({ projectDir: root, getEngine })
    _executors.set(root, exec)
  }
  return exec
}

export { createDshExecutor }
