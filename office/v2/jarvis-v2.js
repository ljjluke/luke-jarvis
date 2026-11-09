/** JARVIS 全息中枢 v2 —— 真接入 DeepSeek Harness 的 jarvis 插件。

 *  数据来源（全部只读契约，不读 .jarvis 文件布局）：
 *   /api/jarvis/state        全量快照（阶段/闸/任务/黑板/会议/卡/记忆/公司）
 *   /api/jarvis/events       append-only 事件流（增量）
 *   /api/jarvis/voice        语音模型配置（GET/PUT，key 只存本机）
 *   /api/jarvis/tts          语音合成代理（OpenAI 兼容 /v1/audio/speech）
 *  每 5 秒刷新快照，每 3 秒拉事件；主界面浮动块全部由数据驱动，只有右下角光球是鼠标菜单。
 */

const $ = (id) => document.getElementById(id)
const fmtPct = (n) => `${Math.round(n)}%`
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
const clip = (s, n) => {
  const t = String(s ?? '').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

const STATE = {
  snapshot: null,
  lastSeq: 0,
  events: [],
  voiceConfig: null,
  voiceEnabled: false,
  voiceEngine: 'browser',
  lastSpeech: '',
}

// ── 主界面：动态节点 ────────────────────────────────────────────────
function setText(id, text) {
  const el = $(id)
  if (el) el.textContent = text
}

const EVENT_LABEL = { gate: '流程闸', board: '黑板', meeting: '会议', dispatch: '派活' }
function eventLine(e) {
  const d = e.data || {}
  if (e.type === 'gate') return `通过「${d.step}」闸`
  if (e.type === 'board') return `黑板更新 · 未决 ${d.open ?? '?'} 项`
  if (e.type === 'meeting') return `会议纪要落盘 · ${d.type || ''}`
  if (e.type === 'dispatch') return `派活给 ${d.assignee || '成员'}：${clip(d.subject, 24)}`
  return e.type
}

function renderMain(snap) {
  const stage = snap.stage || { index: 0, total: 6, label: '未开始', done: [], missing: [], next: '' }
  const done = stage.done || []
  const missing = stage.missing || []
  const board = snap.board || { open: [], blockers: [] }
  const meetings = snap.meetings || { required: [], suggested: [] }
  const cards = snap.cards || []
  const tasks = snap.tasks || { open: 0, teams: [], byAssignee: [] }
  const memory = snap.memory || {}
  const caps = snap.capabilities || {}
  const pct = stage.total ? (done.length / stage.total) * 100 : 0

  setText('mMissionState', stage.index ? 'RUNNING' : 'IDLE')
  setText('mMissionTitle', stage.index ? stage.label : '等待需求接入')
  setText('mMissionCopy', missing.length ? `缺口 ${missing.length} 项：${clip(missing[0], 34)}` : '本阶段产物齐备，可继续下一步')
  setText('mMissionPct', fmtPct(pct))
  setText('mMissionCount', `已通过 ${done.length} / ${stage.total} 阶段`)
  const bar = $('mMissionBar')
  if (bar) bar.style.width = `${pct}%`
  const orbit = $('orbitActive')
  if (orbit) orbit.style.strokeDashoffset = String(2000 - (2000 * pct) / 100)
  setText('coreStateText', `JARVIS · ${stage.index ? stage.label : '待接入'} · 未完成任务 ${tasks.open}`)

  // 流程闸 / 记忆
  setText('mGateState', memory.stale ? 'STALE' : 'OK')
  setText('mGateTitle', memory.exists ? (memory.stale ? '记忆需要更新' : '记忆新鲜') : '尚无项目记忆')
  setText('mGateCopy', memory.exists
    ? `已过闸 ${Object.keys(snap.gates || {}).length} 项 · 角色卡 ${cards.filter((c) => c.ok).length}/${cards.length} 张`
    : '写下 project.md 后，建队/派活闸才会放行')

  // 最新事件
  const lastEvent = STATE.events[STATE.events.length - 1]
  setText('mEventState', lastEvent ? `#${lastEvent.seq}` : '—')
  setText('mEventTitle', lastEvent ? eventLine(lastEvent) : '暂无事件')
  setText('mEventCopy', lastEvent ? new Date(lastEvent.at).toLocaleTimeString('zh-CN') : '事件流为空')

  // 接入通道
  const teams = tasks.teams || []
  setText('mChanState', `${teams.length} TEAM`)
  setText('mChanTitle', `DSH 工具 ${caps.toolCount || 0} · 团队 ${teams.length}`)
  setText('mChanCopy', `角色卡 ${cards.length} 张 · 未完成任务 ${tasks.open} 个`)
  const dots = $('mChanDots')
  if (dots) {
    dots.innerHTML = (teams.length ? teams : [{ name: '未建队' }]).slice(0, 4)
      .map((t) => `<span><i></i>${esc(clip(t.name, 10))}</span>`).join('')
  }

  // 下一步
  const reqMeeting = (meetings.required || [])[0]
  setText('mNextState', reqMeeting ? 'MEETING' : stage.next ? 'NEXT' : 'IDLE')
  setText('mNextTitle', reqMeeting ? `必开：${reqMeeting.type}` : (stage.next ? clip(stage.next, 26) : '无待办'))
  setText('mNextCopy', reqMeeting ? clip(reqMeeting.why, 46) : (stage.next || '等待新输入'))

  // 对话
  setText('mSay', stage.index
    ? `${stage.label}进行中：已过 ${done.length}/${stage.total} 个阶段。`
    : '先生，接入一个需求，我就按六阶段流程开工。')
  setText('mSub', missing.length ? `当前缺口：${clip(missing.join('；'), 80)}` : (stage.next || '等待下一步指令'))
  setText('mSayA', `未决 ${board.open.length} 项`)
  setText('mSayB', `阻塞 ${board.blockers.length} 项`)
  setText('mSayC', `团队 ${teams.length} · 任务 ${tasks.open}`)
}

// ── 进度页 ────────────────────────────────────────────────────────
function renderProgress(snap) {
  const stage = snap.stage || { index: 0, total: 6, label: '未开始', done: [], missing: [], next: '' }
  const stageDefs = (snap.plugin && snap.plugin.stages) || []
  const done = stage.done || []
  const missing = stage.missing || []
  const pct = stage.total ? (done.length / stage.total) * 100 : 0
  setText('pTitle', stage.index ? stage.label : '未开始')
  setText('pMeta', `MISSION · JARVIS 六阶段流程 · 阶段 ${stage.index}/${stage.total}`)
  setText('pPct', fmtPct(pct))
  setText('pEta', stage.next ? `下一步：${clip(stage.next, 40)}` : '等待下一步')
  setText('pCoreTitle', stage.index ? `Jarvis 在「${stage.label}」阶段` : '等待需求接入')
  setText('pCoreCopy', missing.length ? `还需要：${missing.join('；')}` : (stage.next || '本阶段产物齐备'))
  setText('pChainCount', `${done.length} / ${stage.total}`)
  const chain = $('stageChain')
  if (chain) {
    chain.innerHTML = stageDefs.map((s, i) => {
      const isDone = done.includes(s.id)
      const isCur = stage.stage === s.id
      const cls = isDone ? 'phase done' : isCur ? 'phase active' : 'phase'
      return `<div class="${cls}"><div class="phase-dot">${String(i + 1).padStart(2, '0')}</div><div><div class="phase-name">${esc(s.label)}</div><div class="phase-time">${isDone ? '已通过' : isCur ? '进行中' : '待开始'}</div></div></div>`
    }).join('')
  }
  setText('pCurrent', missing.length ? `${missing.length} 项缺口` : '无缺口')
  setText('pCurrentCopy', missing.length ? missing.join('\n') : (stage.next || '继续下一步'))
  const consoleEl = $('pConsole')
  if (consoleEl) {
    const rows = STATE.events.slice(-8).reverse()
    consoleEl.innerHTML = rows.length
      ? rows.map((e) => `<div><span class="time">${new Date(e.at).toLocaleTimeString('zh-CN')}</span>${esc(eventLine(e))}</div>`).join('')
      : '<div><span class="time">--:--</span>暂无事件（闸/黑板/会议/派活会写事件）</div>'
  }
  const meetings = snap.meetings || { required: [] }
  const lastMeeting = meetings.last
  setText('pReportSay', lastMeeting
    ? `最近一次会议（${lastMeeting.type}）：${lastMeeting.topic || '无主题'} · ${lastMeeting.date || ''}`
    : (snap.memory && snap.memory.exists ? `记忆更新于 ${snap.memory.ageHours} 小时前。` : '还没有项目记忆与会议纪要。'))
  const metrics = $('pReportMetrics')
  if (metrics) {
    const board = snap.board || { open: [], blockers: [] }
    metrics.innerHTML = [
      ['未决项', board.open.length],
      ['阻塞', board.blockers.length],
      ['未完成任务', (snap.tasks || {}).open || 0],
      ['角色卡', (snap.cards || []).length],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')
  }
}

// ── 团队页（含开源 PixOffice 场景）────────────────────────────────
//  场景层 = 开源 PixOffice（github.com/workbzw/pixoffice，MIT）的构建产物，托管在同源 /jarvis-office/；
//  数据经 relay（/api/pixoffice/events，读 .jarvis/company-state.json）喂给它。
//  我们**不自己画场景**，只做两件事：① 主题适配（往 iframe 里注入 CSS：色温/描边/背景）② 与本页数据面板联动。
const SCENE = { ready: false, iframe: null, theme: { grade: 'saturate(0.92) contrast(1.04) brightness(0.98) hue-rotate(-8deg)', bg: '#02070d' } }

/** 统一带上工作区（多会话/多项目时避免改了 A 项目、界面看的却是 B）。
 *  inline=true 用于拼第二个参数（events 的 since/limit 已在 URL 上）。 */
function workspaceQuery(inline) {
  const w = STATE.snapshot && STATE.snapshot.workspace
  if (!w) return ''
  return (inline ? '&workspace=' : '?workspace=') + encodeURIComponent(String(w))
}

function sceneDoc() {
  const f = SCENE.iframe
  try { return f && f.contentDocument ? f.contentDocument : null } catch { return null }
}

/** 主题适配：只改色温/背景/描边，不动 pixoffice 的布局、像素素材与交互。 */
function applySceneTheme() {
  const doc = sceneDoc()
  if (!doc || !doc.head) return false
  try {
    let el = doc.getElementById('jarvis-theme')
    if (!el) {
      el = doc.createElement('style')
      el.id = 'jarvis-theme'
      doc.head.appendChild(el)
    }
    el.textContent = [
      ':root{color-scheme:dark}',
      `html,body{background:${SCENE.theme.bg}!important}`,
      // 画面整体压一点色温到冷青，像素素材与布局一字不动
      `canvas{filter:${SCENE.theme.grade}}`,
      // 上游自带的浅色面板/文字，统一压到暗色主题（只动颜色，不动尺寸与位置）
      'body{color:#bfe3ee}',
      '#root{background:transparent!important}',
    ].join('\n')
    return true
  } catch { return false }
}

function initScene() {
  if (SCENE.iframe) return
  const f = $('teamScene')
  if (!f) return
  SCENE.iframe = f
  const hint = $('teamSceneHint')
  const done = () => {
    SCENE.ready = true
    applySceneTheme()
    // 上游场景启动后会自己挂 canvas；延迟再刷一次主题（避免注入早于渲染）
    setTimeout(applySceneTheme, 800)
    setTimeout(applySceneTheme, 2200)
    if (hint) hint.textContent = 'SOURCE: github.com/workbzw/pixoffice · RELAY: /api/pixoffice'
  }
  if (f.contentDocument && f.contentDocument.readyState === 'complete') done()
  f.addEventListener('load', done)
  // 兜底：3.5s 后若没 load 事件，也尝试注入（同源 iframe 常见）
  setTimeout(() => { if (!SCENE.ready) done() }, 3500)
}

function renderTeam(snap) {
  initScene()
  const tasks = snap.tasks || { byAssignee: [], teams: [] }
  const board = snap.board || { open: [], blockers: [] }
  const meetings = snap.meetings || { required: [] }
  const members = []
  const seen = new Map()
  for (const t of tasks.byAssignee || []) {
    if (!t.assignee) continue
    if (!seen.has(t.assignee)) seen.set(t.assignee, { name: t.assignee, role: t.subject ? '' : '成员', status: t.status || 'idle', task: t.subject })
    else if (seen.get(t.assignee).task && t.status !== 'completed') seen.get(t.assignee).task += ' / ' + t.subject
  }
  for (const m of seen.values()) members.push(m)

  setText('tPresence', members.length ? `${members.length} 名成员 · 未完成任务 ${tasks.open} 项` : '还没有团队')
  setText('tMemberCount', `MEMBERS · ${String(members.length).padStart(2, '0')}`)
  const list = $('tMembers')
  if (list) {
    list.innerHTML = members.length
      ? members.map((m) => {
          const busy = /progress|working/i.test(m.status)
          return `<div class="member"><div class="avatar ${busy ? 'busy' : ''}">${esc(String(m.name).slice(0, 1))}</div><div><div class="member-name">${esc(m.name)}</div><div class="member-role">${esc(m.status || '')}</div></div><div class="member-task">${esc(clip(m.task, 18))}</div></div>`
        }).join('')
      : '<div class="empty-hint">还没有团队数据：建队后这里会出现真实成员与任务。</div>'
  }

  const boardEl = $('tBoard')
  if (boardEl) {
    const items = (board.open || []).slice(0, 6)
    boardEl.innerHTML = items.length
      ? items.map((i) => `<div class="board-item ${i.status === 'resolved' ? 'done' : ''}"><div class="board-top"><span>${esc(clip(i.content, 26))}</span><span>${esc(i.type || '')}</span></div><div class="board-meta">${esc(i.id || '')} · ${esc(i.status || '')}</div><div class="board-bar"><i style="width:${i.status === 'resolved' ? 100 : 42}%"></i></div></div>`).join('')
      : '<div class="empty-hint">黑板为空：成员写黑板后会出现在这里。</div>'
  }

  const req = (meetings.required || [])[0]
  setText('tDecisionCopy', req ? `需要你决策：${req.type}` : '当前没有必开的会')
  setText('tDecisionSub', req ? req.why : '（会议判定由插件按事实计算）')
  const actions = $('tDecisionActions')
  if (actions) {
    actions.innerHTML = req
      ? `<button class="decision-btn primary" data-open-progress>查看缺口</button><button class="decision-btn" data-open-report>看事件</button>`
      : ''
  }
}

// ── 数据轮询 ──────────────────────────────────────────────────────
async function loadState() {
  try {
    const r = await fetch('/api/jarvis/state', { cache: 'no-store' })
    const body = await r.json()
    if (!body.ok || !body.snapshot) {
      setText('sysState', body.reason === 'no workspace' ? '未解析到工作区' : '后端未就绪')
      return
    }
    STATE.snapshot = body.snapshot
    setText('cWorkspace', String(body.snapshot.workspace || '—'))
    setText('sysState', `DSH 已连接 · v${(body.snapshot.capabilities || {}).version || '?'}`)
    renderMain(body.snapshot)
    renderProgress(body.snapshot)
    renderTeam(body.snapshot)
  } catch (e) {
    setText('sysState', '后端连接失败')
  }
}

async function loadEvents() {
  try {
    // since 用服务端回的 nextSeq（本次返回的最后一条），不是 lastSeq（全库最后一条）：
    // 否则当积压事件多于 limit 时，中间事件会被静默跳过。首屏用 tail=1 直接拿最新一批。
    let url = STATE.lastSeq
      ? `/api/jarvis/events?since=${STATE.lastSeq}&limit=200` + workspaceQuery(true)
      : '/api/jarvis/events?tail=1&limit=50' + workspaceQuery(true)
    let changed = false
    for (let page = 0; page < 5; page += 1) {
      const r = await fetch(url, { cache: 'no-store' })
      const body = await r.json()
      if (!body.ok) return
      if (Array.isArray(body.events) && body.events.length) {
        STATE.events.push(...body.events)
        if (STATE.events.length > 300) STATE.events = STATE.events.slice(-300)
        changed = true
      }
      const advanced = Number(body.nextSeq ?? 0)
      if (advanced > STATE.lastSeq) STATE.lastSeq = advanced
      else if (!STATE.lastSeq && body.lastSeq) STATE.lastSeq = Number(body.lastSeq)
      if (!body.hasMore) break
      url = `/api/jarvis/events?since=${STATE.lastSeq}&limit=200` + workspaceQuery(true)
    }
    if (changed && STATE.snapshot) {
      renderMain(STATE.snapshot)
      renderProgress(STATE.snapshot)
    }
  } catch { /* 事件失败不影响快照 */ }
}

// ── 视图切换 ──────────────────────────────────────────────────────
const views = { main: $('mainView'), progress: $('progressView'), team: $('teamView'), console: $('consoleView') }
function activate(name, hash = '') {
  for (const [k, el] of Object.entries(views)) el?.classList.toggle('active', k === name)
  if (hash && location.hash !== hash) history.replaceState(null, '', hash)
  if (name === 'team') initScene()
}
function showMain(announce = true) {
  activate('main', '')
  if (announce && STATE.voiceEnabled) speak(buildMainSpeech())
}
function showProgress(announce = true) {
  activate('progress', '#progress')
  if (announce && STATE.voiceEnabled) speak(buildProgressSpeech())
}
function showTeam(announce = true) {
  activate('team', '#team')
  if (announce && STATE.voiceEnabled) speak('员工协作空间已打开，像素工位会随团队状态实时联动。')
}
function buildMainSpeech() {
  const s = STATE.snapshot?.stage
  if (!s || !s.index) return '先生，还没有接入需求。'
  return `先生，当前在${s.label}阶段，已通过${(s.done || []).length}个阶段，还有${(s.missing || []).length}项缺口。`
}
function buildProgressSpeech() {
  const s = STATE.snapshot?.stage
  const m = STATE.snapshot?.meetings?.required || []
  if (!s || !s.index) return '先生，还没有任务进度。'
  return `当前${s.label}阶段。${m.length ? '有一个必开的会：' + m[0].type + '。' : ''}${(s.missing || []).length ? '缺口是：' + (s.missing || []).slice(0, 2).join('，') : '本阶段产物齐备。'}`
}

document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => showMain()))
document.querySelectorAll('[data-open-progress]').forEach((b) => b.addEventListener('click', () => showProgress()))
document.querySelectorAll('[data-open-report]').forEach((b) => b.addEventListener('click', () => showProgress()))
document.querySelectorAll('[data-open-team]').forEach((b) => b.addEventListener('click', () => showTeam()))
$('openEventsBtn')?.addEventListener('click', () => showProgress())

// ── 语音：模型 TTS + 浏览器兜底 ────────────────────────────────────
let preferredVoice = null
function pickBrowserVoice() {
  if (!('speechSynthesis' in window)) return null
  const voices = speechSynthesis.getVoices()
  preferredVoice = voices.find((v) => /zh-CN/i.test(v.lang) && /xiaoxiao|xiaoyi|xiaohan|xiaomeng|huihui|yaoyao|female|女/i.test(v.name))
    || voices.find((v) => /zh-CN/i.test(v.lang)) || null
  return preferredVoice
}
if ('speechSynthesis' in window) {
  pickBrowserVoice()
  speechSynthesis.addEventListener?.('voiceschanged', pickBrowserVoice)
}

function voiceLabel(text) {
  setText('voiceEngineLabel', text)
}

async function speak(text, force = false) {
  if (!text) return
  if (!STATE.voiceEnabled && !force) return
  STATE.lastSpeech = text
  const cfg = STATE.voiceConfig || {}
  if (cfg.provider === 'openai' && cfg.configured) {
    try {
      voiceLabel('正在请求语音模型…')
      const r = await fetch('/api/jarvis/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voice: cfg.voice, speed: cfg.speed }),
      })
      if (!r.ok) throw new Error(`TTS ${r.status}`)
      const blob = await r.blob()
      const audio = new Audio(URL.createObjectURL(blob))
      audio.onended = () => voiceLabel(`语音模型：${cfg.model || 'tts'} · 音色 ${cfg.voice || '默认'}`)
      await audio.play()
      return
    } catch (e) {
      voiceLabel(`语音模型不可用（${e.message}），已回退浏览器语音`)
    }
  }
  if (!('speechSynthesis' in window)) {
    voiceLabel('当前浏览器不支持语音合成')
    return
  }
  if (!preferredVoice) pickBrowserVoice()
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'zh-CN'
  u.rate = Number(cfg.speed || 0.9)
  u.pitch = 0.9
  if (preferredVoice) u.voice = preferredVoice
  u.onstart = () => voiceLabel(`Jarvis 正在播报 · ${preferredVoice ? preferredVoice.name : '系统语音'}`)
  u.onend = () => voiceLabel(`播报声音：${preferredVoice ? preferredVoice.name : '系统中文语音'}`)
  speechSynthesis.speak(u)
}

function updateSpeakerUI() {
  const btn = $('speakerToggle')
  if (!btn) return
  btn.classList.toggle('active', STATE.voiceEnabled)
  const span = btn.querySelector('span')
  if (span) span.textContent = STATE.voiceEnabled ? '语音已开启' : '启用语音'
  btn.setAttribute('aria-pressed', String(STATE.voiceEnabled))
}

async function loadVoiceConfig() {
  try {
    const r = await fetch('/api/jarvis/voice', { cache: 'no-store' })
    const body = await r.json()
    if (body.ok && body.config) {
      STATE.voiceConfig = body.config
      STATE.presets = body.presets || {}
      const cfg = body.config
      voiceLabel(cfg.provider === 'openai' && cfg.configured
        ? `语音模型：${cfg.model || 'tts'} · 音色 ${cfg.voice || '默认'}`
        : '未配置语音模型 · 使用浏览器语音')
    }
  } catch { /* 静默 */ }
}

// ── 语音设置面板 ──────────────────────────────────────────────────
const VF = { provider: $('vProvider'), baseUrl: $('vBaseUrl'), apiKey: $('vApiKey'), model: $('vModel'), voice: $('vVoice'), custom: $('vCustomVoice'), speed: $('vSpeed') }
function fillSettings() {
  const c = STATE.voiceConfig || {}
  if (VF.provider) VF.provider.value = c.provider === 'openai' ? 'openai' : 'browser'
  if (VF.baseUrl) VF.baseUrl.value = c.baseUrl || ''
  if (VF.apiKey) VF.apiKey.value = ''
  if (VF.model) VF.model.value = c.model || ''
  if (VF.speed) VF.speed.value = String(c.speed || 0.95)
  const presets = (STATE.presets && STATE.presets.voices) || []
  if (VF.voice) {
    const known = presets.some((p) => p.id === c.voice)
    VF.voice.value = known ? c.voice : (c.voice ? '__custom__' : 'nova')
  }
  if (VF.custom) VF.custom.value = presets.some((p) => p.id === c.voice) ? '' : (c.voice || '')
  if (VF.apiKey) VF.apiKey.placeholder = c.apiKeyMasked ? `已配置 ${c.apiKeyMasked}（留空不改）` : 'sk-…（只存本机，不回显明文）'
  if (VF.provider) {
    const dis = VF.provider.value !== 'openai'
    for (const el of [VF.baseUrl, VF.apiKey, VF.model, VF.voice, VF.custom, VF.speed]) if (el) el.disabled = dis
  }
}
function openSettings() {
  fillSettings()
  $('voiceSettings')?.classList.add('open')
}
function closeSettings() { $('voiceSettings')?.classList.remove('open') }
$('voiceSettingsBtn')?.addEventListener('click', openSettings)
$('vCancel')?.addEventListener('click', closeSettings)
VF.provider?.addEventListener('change', () => {
  const dis = VF.provider.value !== 'openai'
  for (const el of [VF.baseUrl, VF.apiKey, VF.model, VF.voice, VF.custom, VF.speed]) if (el) el.disabled = dis
})
async function saveVoice() {
  const provider = VF.provider?.value === 'openai' ? 'openai' : 'browser'
  const voice = VF.voice?.value === '__custom__' ? String(VF.custom?.value || '').trim() : String(VF.voice?.value || '')
  const payload = {
    provider,
    baseUrl: String(VF.baseUrl?.value || '').trim(),
    apiKey: String(VF.apiKey?.value || '').trim(),
    model: String(VF.model?.value || '').trim(),
    voice,
    speed: Number(VF.speed?.value || 0.95),
  }
  const msg = $('voiceSaveMsg')
  try {
    const r = await fetch('/api/jarvis/voice', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const body = await r.json()
    if (!body.ok) throw new Error(body.error || '保存失败')
    STATE.voiceConfig = body.config
    STATE.presets = body.presets || STATE.presets
    if (msg) msg.textContent = '已保存（只存本机，不回显明文）'
    voiceLabel(body.config.provider === 'openai' && body.config.configured
      ? `语音模型：${body.config.model || 'tts'} · 音色 ${body.config.voice || '默认'}`
      : '未配置语音模型 · 使用浏览器语音')
    setTimeout(closeSettings, 700)
  } catch (e) {
    if (msg) msg.textContent = `保存失败：${e.message}`
  }
}
$('vSave')?.addEventListener('click', saveVoice)
$('vTest')?.addEventListener('click', async () => {
  const before = STATE.voiceConfig
  STATE.voiceConfig = { provider: VF.provider?.value === 'openai' ? 'openai' : 'browser', configured: true, model: VF.model?.value, voice: VF.voice?.value === '__custom__' ? VF.custom?.value : VF.voice?.value, speed: Number(VF.speed?.value || 0.95) }
  STATE.voiceEnabled = true
  await speak('先生，这是当前音色的试听。语音由语音模型合成，可以随时在设置里更换。', true)
  if (before) STATE.voiceConfig = before
})

// ── 麦克风 + 语音识别（浏览器能力）────────────────────────────────
const micCanvas = $('micWaveform')
const micCtx = micCanvas?.getContext('2d')
let micStream = null
let audioCtx = null
let micAnalyser = null
let micRaf = 0
let recognition = null
let micActive = false
function setMicUI(state, detail) {
  const labels = { offline: 'OFFLINE', waiting: 'AUTH', live: 'LISTENING', error: 'ERROR' }
  setText('micState', labels[state] || state.toUpperCase())
  setText('voiceNodeTitle', state === 'live' ? '我在听，先生。' : state === 'waiting' ? '等待麦克风授权' : state === 'error' ? '麦克风连接失败' : '点击连接麦克风')
  if (detail) setText('voiceStatus', detail)
  const btn = $('micToggle')
  btn?.classList.toggle('mic-live', state === 'live')
  const span = btn?.querySelector('span')
  if (span) span.textContent = state === 'live' ? '断开麦克风' : '连接麦克风'
}
function clearMicWave() {
  if (!micCtx) return
  micCtx.clearRect(0, 0, micCanvas.width, micCanvas.height)
}
function drawMicWave() {
  if (!micCtx || !micAnalyser) return
  const data = new Uint8Array(micAnalyser.fftSize)
  function loop() {
    if (!micActive) return
    micAnalyser.getByteTimeDomainData(data)
    micCtx.clearRect(0, 0, micCanvas.width, micCanvas.height)
    micCtx.strokeStyle = '#70eaff'
    micCtx.lineWidth = 1.4
    micCtx.beginPath()
    for (let i = 0; i < data.length; i += 1) {
      const x = (i / data.length) * micCanvas.width
      const y = micCanvas.height / 2 + ((data[i] - 128) / 128) * (micCanvas.height / 2) * 0.9
      if (i === 0) micCtx.moveTo(x, y)
      else micCtx.lineTo(x, y)
    }
    micCtx.stroke()
    micRaf = requestAnimationFrame(loop)
  }
  loop()
}

function handleVoiceCommand(text) {
  const cmd = text.replace(/[，。！？\s]/g, '')
  setText('voiceTranscript', `你：${text}`)
  if (/查看进度|任务进度|执行进度/.test(cmd)) return showProgress()
  if (/员工|协作空间|团队空间|3D/.test(cmd)) return showTeam()
  if (/返回总览|回到主屏|返回主页面/.test(cmd)) return showMain()
  if (/停止播报|静音|关闭声音/.test(cmd)) { STATE.voiceEnabled = false; updateSpeakerUI(); speechSynthesis.cancel(); return voiceLabel('已通过语音指令静音') }
  if (/开启声音|开始播报|恢复播报/.test(cmd)) { STATE.voiceEnabled = true; updateSpeakerUI(); return speak(buildMainSpeech(), true) }
  setText('voiceStatus', '已收到。可以说"查看进度""打开员工空间""返回总览"。')
}

function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { setText('voiceTranscript', '麦克风已连接，但当前浏览器不支持中文语音识别'); return }
  recognition = new SR()
  recognition.lang = 'zh-CN'
  recognition.continuous = true
  recognition.interimResults = true
  recognition.onresult = (e) => {
    let interim = ''
    let final = ''
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const text = e.results[i][0].transcript
      if (e.results[i].isFinal) final += text
      else interim += text
    }
    if (interim) setText('voiceTranscript', `正在聆听：${interim}`)
    if (final) handleVoiceCommand(final)
  }
  recognition.onend = () => {
    if (micActive && recognition) setTimeout(() => { try { recognition.start() } catch { /* 已停 */ } }, 350)
  }
  try { recognition.start() } catch { /* 忽略 */ }
}

async function startMic() {
  if (!navigator.mediaDevices?.getUserMedia) { setMicUI('error', '当前浏览器不支持麦克风'); return }
  setMicUI('waiting', '请在浏览器提示中允许使用麦克风')
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const source = audioCtx.createMediaStreamSource(micStream)
    micAnalyser = audioCtx.createAnalyser()
    micAnalyser.fftSize = 256
    source.connect(micAnalyser)
    micActive = true
    setMicUI('live', '麦克风已连接。说出指令，我会用语音回应。')
    drawMicWave()
    startRecognition()
    if (!STATE.voiceEnabled) { STATE.voiceEnabled = true; updateSpeakerUI() }
    speak('麦克风已连接。我在听，先生。', true)
  } catch (e) {
    micActive = false
    setMicUI('error', e?.name === 'NotAllowedError' ? '麦克风权限被拒绝' : '未检测到可用麦克风')
    clearMicWave()
  }
}
function stopMic(announce = true) {
  micActive = false
  if (recognition) { const r = recognition; recognition = null; try { r.stop() } catch { /* 已停 */ } }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null }
  micAnalyser = null
  cancelAnimationFrame(micRaf)
  clearMicWave()
  setMicUI('offline', '麦克风已断开')
  if (announce && STATE.voiceEnabled) speak('麦克风已断开。', true)
}
function toggleMic() { if (micActive) stopMic(); else startMic() }
$('micToggle')?.addEventListener('click', toggleMic)
$('voiceNode')?.addEventListener('click', toggleMic)
$('voiceNode')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMic() } })
$('speakerToggle')?.addEventListener('click', () => {
  STATE.voiceEnabled = !STATE.voiceEnabled
  updateSpeakerUI()
  if (STATE.voiceEnabled) speak(buildMainSpeech(), true)
  else { if ('speechSynthesis' in window) speechSynthesis.cancel(); voiceLabel('语音播报已静音') }
})
addEventListener('pagehide', () => { stopMic(false); if ('speechSynthesis' in window) speechSynthesis.cancel() })

// ── 协作会话（本地 + 语音）────────────────────────────────────────
function addChat(who, text) {
  const log = $('teamChatLog')
  if (!log) return
  const div = document.createElement('div')
  div.className = 'chat-message' + (who === 'Jarvis' ? ' jarvis' : '')
  div.innerHTML = `<div class="chat-author">${esc(who)}<time>${new Date().toLocaleTimeString('zh-CN')}</time></div><p>${esc(text)}</p>`
  log.appendChild(div)
  log.scrollTop = log.scrollHeight
}
// 指令面（0.15 起）：POST /api/jarvis/chat 真投递给 DSH 会话；仍不伪造回答（回答由模型下一轮产出）。
$('teamChatForm')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = $('teamChatInput')
  const text = input?.value.trim()
  if (!text) return
  const btn = e.target.querySelector('button')
  if (btn) btn.disabled = true
  addChat('你', text)
  input.value = ''
  try {
    const r = await fetch('/api/jarvis/chat' + workspaceQuery(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, agent: $('cSession')?.value || undefined }),
    })
    const body = await r.json()
    if (body.ok) {
      addChat('Jarvis', `已投递到会话 ${body.sessionId || '(未知)'} 的输入队列（${body.chars} 字）。模型下一轮会看到这句话——这里不替它编回答。`)
      if (STATE.voiceEnabled) speak('消息已投递到会话队列。')
    } else {
      addChat('Jarvis', `没有投递成功：${body.error || '未知原因'}`)
      if (STATE.voiceEnabled) speak('消息没有投递成功。')
    }
  } catch (err) {
    addChat('Jarvis', `没有投递成功：${err && err.message ? err.message : '网络错误'}`)
  } finally {
    if (btn) btn.disabled = false
  }
})
setText('tChatTime', new Date().toLocaleTimeString('zh-CN'))

// ── 背景粒子 + 核心波形 ──────────────────────────────────────────
const pcanvas = $('particles')
if (pcanvas) {
  const ctx = pcanvas.getContext('2d')
  let dots = []
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    pcanvas.width = innerWidth * dpr
    pcanvas.height = innerHeight * dpr
    pcanvas.style.width = `${innerWidth}px`
    pcanvas.style.height = `${innerHeight}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const count = Math.min(110, Math.floor(innerWidth / 14))
    dots = Array.from({ length: count }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, vx: (Math.random() - 0.5) * 0.1, vy: (Math.random() - 0.5) * 0.1, r: Math.random() * 1.1 + 0.2, a: Math.random() * 0.45 + 0.06 }))
  }
  const draw = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight)
    for (const p of dots) {
      p.x += p.vx; p.y += p.vy
      if (p.x < 0) p.x = innerWidth
      if (p.x > innerWidth) p.x = 0
      if (p.y < 0) p.y = innerHeight
      if (p.y > innerHeight) p.y = 0
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(112,234,255,${p.a})`; ctx.fill()
    }
    requestAnimationFrame(draw)
  }
  resize()
  addEventListener('resize', resize)
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) draw()
  else draw()
}

const coreWave = $('coreWave')
if (coreWave) {
  const c = coreWave.getContext('2d')
  let t = 0
  const loop = () => {
    t += 0.02
    c.clearRect(0, 0, coreWave.width, coreWave.height)
    c.strokeStyle = 'rgba(112,234,255,.35)'
    c.lineWidth = 1
    c.beginPath()
    for (let x = 0; x < coreWave.width; x += 3) {
      const y = coreWave.height / 2 + Math.sin(x * 0.035 + t) * Math.sin(t * 0.6) * 22
      if (x === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    }
    c.stroke()
    requestAnimationFrame(loop)
  }
  loop()
}


// ── 能力台：31 个 jarvis 工具（UI 真实执行通道）────────────────────
const CONSOLE = { tools: [], sessions: [], current: null, jsonMode: false, history: [] }

async function loadTools() {
  try {
    const r = await fetch('/api/jarvis/tools', { cache: 'no-store' })
    const body = await r.json()
    if (body.ok && Array.isArray(body.tools)) {
      CONSOLE.tools = body.tools
      renderToolList('')
    } else {
      $('cToolList').innerHTML = `<div class="empty-hint">读取工具清单失败：${esc(body.error || '未知错误')}</div>`
    }
  } catch (e) {
    $('cToolList').innerHTML = `<div class="empty-hint">读取工具清单失败：${esc(e.message)}</div>`
  }
}

function renderToolList(filter) {
  const list = $('cToolList')
  if (!list) return
  const kw = String(filter || '').trim().toLowerCase()
  const match = (t) => !kw || t.name.includes(kw) || t.description.toLowerCase().includes(kw)
  const groups = new Map()
  for (const t of CONSOLE.tools) {
    if (!match(t)) continue
    const g = t.group || 'other'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(t)
  }
  if (!groups.size) { list.innerHTML = '<div class="empty-hint">没有匹配的工具。</div>'; return }
  const cls = (t) => (CONSOLE.current && CONSOLE.current.name === t.name ? 'tool-item active' : 'tool-item')
  list.innerHTML = [...groups.entries()].map(([g, items]) => `<div class="tool-group-title">${esc(g)} · ${items.length}</div>` + items.map((t) => {
    const one = t.description.replace(/\s+/g, ' ').slice(0, 34)
    return `<button class="${cls(t)}" data-tool="${esc(t.name)}">${esc(t.name)}<small>${esc(one)}</small></button>`
  }).join('')).join('')
  for (const btn of list.querySelectorAll('[data-tool]')) {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool))
  }
}

const TEXTAREA_KEYS = new Set(['content', 'text', 'requirement', 'decision', 'card', 'rationale', 'material', 'source', 'minutes', 'tasksJson', 'items', 'rolesJson', 'collabText', 'description', 'board', 'lesson', 'args', 'suspects', 'agenda', 'context', 'verify', 'inScope', 'acceptance', 'objective', 'problem', 'risk', 'attempts', 'decisionNeeded'])

function fieldFor(key, schema, required) {
  const type = String((schema && schema.type) || 'string')
  const desc = String((schema && schema.description) || '')
  const label = `<label>${esc(key)}${required ? ' <b>*</b>' : ''}${desc ? `<div class="cf-hint">${esc(desc.slice(0, 90))}</div>` : ''}</label>`
  const id = `cf_${key}`
  if (Array.isArray(schema.enum)) {
    return `<div class="cf">${label}<select id="${id}" data-key="${esc(key)}" data-type="string">${schema.enum.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></div>`
  }
  if (type === 'boolean') return `<div class="cf">${label}<label style="padding-top:6px"><input id="${id}" data-key="${esc(key)}" data-type="boolean" type="checkbox" style="width:auto"> 是</label></div>`
  if (type === 'number' || type === 'integer') return `<div class="cf">${label}<input id="${id}" data-key="${esc(key)}" data-type="${type}" type="number" step="${type === 'integer' ? '1' : 'any'}"></div>`
  if (type === 'array') {
    const itemType = String((schema.items && schema.items.type) || '')
    const hint = Array.isArray(schema.items && schema.items.enum) ? schema.items.enum.join(' / ') : ''
    return `<div class="cf">${label}<textarea id="${id}" data-key="${esc(key)}" data-type="array" placeholder="一行一个${itemType ? ' · ' + itemType : ''}${hint ? '（' + hint + '）' : ''}"></textarea></div>`
  }
  if (type === 'object') return `<div class="cf">${label}<textarea id="${id}" data-key="${esc(key)}" data-type="object" placeholder='{"...":"..."}'></textarea></div>`
  const long = desc.length > 60 || TEXTAREA_KEYS.has(key) || /JSON|文本|全文|内容/.test(desc)
  return long
    ? `<div class="cf">${label}<textarea id="${id}" data-key="${esc(key)}" data-type="string"></textarea></div>`
    : `<div class="cf">${label}<input id="${id}" data-key="${esc(key)}" data-type="string" type="text"></div>`
}

function selectTool(name) {
  const t = CONSOLE.tools.find((x) => x.name === name)
  if (!t) return
  CONSOLE.current = t
  setText('cTitle', t.name)
  setText('cDesc', t.description.replace(/\s+/g, ' ').slice(0, 300))
  const props = (t.parameters && t.parameters.properties) || {}
  const required = new Set(t.required || [])
  const form = $('cForm')
  form.innerHTML = Object.keys(props).length
    ? Object.keys(props).map((k) => fieldFor(k, props[k], required.has(k))).join('')
    : '<div class="empty-hint">这个工具没有参数，直接执行即可。</div>'
  $('cJsonWrap').style.display = CONSOLE.jsonMode ? 'block' : 'none'
  $('cArgsJson').value = JSON.stringify(defaultArgs(t), null, 2)
  $('cRun').disabled = false
  $('cResult').className = ''
  $('cResult').textContent = `已选择 ${t.name}，填好参数后点「执行」。`
  $('cResultJson').textContent = ''
  renderToolList($('cSearch').value)
}

function defaultArgs(t) {
  const args = {}
  const props = (t.parameters && t.parameters.properties) || {}
  for (const k of t.required || []) {
    if (props[k] && Array.isArray(props[k].enum)) args[k] = props[k].enum[0]
  }
  return args
}

function collectArgs() {
  if (CONSOLE.jsonMode) {
    const raw = $('cArgsJson').value.trim()
    if (!raw) return {}
    return JSON.parse(raw)
  }
  const args = {}
  for (const el of document.querySelectorAll('#cForm [data-key]')) {
    const key = el.dataset.key
    const type = el.dataset.type
    if (el.type === 'checkbox') { args[key] = el.checked; continue }
    const v = el.value.trim()
    if (v === '') continue
    if (type === 'number' || type === 'integer') args[key] = Number(v)
    else if (type === 'array') args[key] = v.split('\n').map((x) => x.trim()).filter(Boolean)
    else if (type === 'object') args[key] = JSON.parse(v)
    else args[key] = v
  }
  return args
}

async function runTool() {
  if (!CONSOLE.current) return
  const resultEl = $('cResult')
  const jsonEl = $('cResultJson')
  const btn = $('cRun')
  let args = {}
  try { args = collectArgs() } catch (e) {
    resultEl.className = 'err'
    resultEl.textContent = `参数不是合法 JSON：${e.message}`
    return
  }
  btn.disabled = true
  resultEl.className = ''
  resultEl.textContent = `正在执行 ${CONSOLE.current.name}…（会走真实工具与闸）`
  jsonEl.textContent = ''
  const started = Date.now()
  try {
    const r = await fetch('/api/jarvis/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: CONSOLE.current.name, args, agent: $('cSession').value || undefined }),
    })
    const body = await r.json()
    const ms = body.elapsedMs ?? (Date.now() - started)
    if (body.ok) {
      resultEl.className = 'ok'
      resultEl.textContent = String(body.result || '（无文本输出）')
      if (STATE.voiceEnabled) speak(`${CONSOLE.current.name} 执行完成`)
    } else {
      resultEl.className = 'err'
      resultEl.textContent = `⛔ ${body.error || '执行失败'}${body.denied ? '\n\n（被闸拦住：这是插件的硬流程，不是页面故障——按提示先补齐前置步骤）' : ''}`
    }
    jsonEl.textContent = body.value ? JSON.stringify(body.value, null, 2) : ''
    CONSOLE.history.unshift({ tool: CONSOLE.current.name, ok: body.ok, ms, at: Date.now() })
    CONSOLE.history = CONSOLE.history.slice(0, 8)
    renderConsoleHistory()
    loadState()
    loadEvents()
  } catch (e) {
    resultEl.className = 'err'
    resultEl.textContent = `请求失败：${e.message}`
  } finally {
    btn.disabled = false
  }
}

function renderConsoleHistory() {
  const el = $('cHistory')
  if (!el) return
  el.innerHTML = CONSOLE.history.length
    ? '<div style="color:#4b6b7e">最近执行</div>' + CONSOLE.history.map((h) => `<div>${h.ok ? '✅' : '⛔'} <b>${esc(h.tool)}</b> · ${h.ms}ms · ${new Date(h.at).toLocaleTimeString('zh-CN')}</div>`).join('')
    : ''
}

async function loadSessions() {
  try {
    const r = await fetch('/api/jarvis/sessions', { cache: 'no-store' })
    const body = await r.json()
    if (body.ok && Array.isArray(body.sessions)) {
      CONSOLE.sessions = body.sessions
      const sel = $('cSession')
      if (sel) {
        const cur = sel.value
        sel.innerHTML = '<option value="">自动（按工作区匹配）</option>' + body.sessions.map((s) => `<option value="${esc(s.id)}">${esc(s.cwd || '(无 cwd)')} · ${esc(s.status)}</option>`).join('')
        if (cur) sel.value = cur
      }
    }
  } catch { /* 会话列表失败不阻塞 */ }
}

function showConsole(announce = true) {
  activate('console', '#console')
  loadTools()
  loadSessions()
  if (announce && STATE.voiceEnabled) speak('能力台已打开。三十一个工具都可以在这里执行，被闸拦住会显示原因。')
}

$('cSearch')?.addEventListener('input', (e) => renderToolList(e.target.value))
$('cRun')?.addEventListener('click', runTool)
$('cJsonToggle')?.addEventListener('click', () => {
  CONSOLE.jsonMode = !CONSOLE.jsonMode
  $('cJsonWrap').style.display = CONSOLE.jsonMode ? 'block' : 'none'
  $('cForm').style.display = CONSOLE.jsonMode ? 'none' : 'block'
  $('cJsonToggle').textContent = CONSOLE.jsonMode ? '表单模式' : 'JSON 模式'
  if (CONSOLE.current) $('cArgsJson').value = JSON.stringify(CONSOLE.jsonMode ? defaultArgs(CONSOLE.current) : defaultArgs(CONSOLE.current), null, 2)
})
document.querySelectorAll('[data-open-console]').forEach((b) => b.addEventListener('click', () => showConsole()))

// ── 时钟 + 启动 ──────────────────────────────────────────────────
function tickClock() {
  const now = new Date()
  setText('clock', `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()]
  setText('dateLine', `${now.getMonth() + 1}月${now.getDate()}日 ${week}`)
}
tickClock()
setInterval(tickClock, 20000)

await loadVoiceConfig()
await loadState()
await loadEvents()
setInterval(loadState, 5000)
setInterval(loadEvents, 3000)

// 供机械校验/调试：暴露真实数据入口
window.__JARVIS_UI__ = {
  version: 'jarvis-ui-v2',
  api: { state: '/api/jarvis/state', events: '/api/jarvis/events', voice: '/api/jarvis/voice', tts: '/api/jarvis/tts', tools: '/api/jarvis/tools', command: '/api/jarvis/command', sessions: '/api/jarvis/sessions' },
  get snapshot() { return STATE.snapshot },
  showMain, showProgress, showTeam, showConsole, speak,
  get consoleTools() { return CONSOLE.tools },
  get scene() { return { ready: SCENE.ready, source: 'github.com/workbzw/pixoffice', themeApplied: Boolean(sceneDoc() && sceneDoc().getElementById('jarvis-theme')) } },
}
