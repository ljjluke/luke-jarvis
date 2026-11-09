window.__ModuleLoader__.load({ id: "luke-jarvis", factory: (require) => {
  const module = { exports: {} };
  (function (module, exports, require) {
/**
 * luke-jarvis 浏览器半边：设置 → 内置插件（Plugins）页上的配置卡片。
 *
 * 为什么需要这个文件：原版 DSH 不会仅根据 host 侧 Config schema 自动生成设置 UI
 * （社区 dsh-advanced-settings 就是补这个空白的第三方插件）。配置卡片是插件
 * 自己的 client 半注册的——没有本文件，host 的 Config 写得再对，设置里也不会
 * 出现任何 Jarvis 配置项（客户实测反馈）。
 *
 * 契约（对齐官方 dsh-plugin-template 的 config-card）：
 *   - package.json 声明 dsh.client.inject = @deepseek-ai/dsh-client-ui-plugin-manager，
 *     exports["./client"] 指向本文件；client 模块由浏览器模块表加载，react 由模块表提供。
 *   - 插槽 plugins.bundle.config 是 keyed 注册，key = 包名 luke-jarvis
 *     （Plugins 页 renderSlot 的 entryKey 是 pkg.name）。
 *   - 页面不传 form：已接受值与写动作来自 ctx.configForms 的 settings scope，
 *     命名空间由 cordis.patch.yml 的行 id 派生（本插件 = jarvis-core）。
 *     兜底再试包名 luke-jarvis，两个命名空间谁 ready 用谁。
 *   - 表单是手写的（不从 schema 自动渲染）；保存走 form.mutate(ops, revision)，
 *     revision 围栏防并发覆盖；改回部署默认值发 unset 而不是重写同值。
 *   - host 侧对应字段带 .volatile()：保存后 ref 实时更新，无需重启。
 *
 * 无构建步骤：纯 ESM + React.createElement（不写 JSX），与仓库零构建纪律一致。
 *
 * @module luke-jarvis/client
 */
const React = require("react");

/** 插槽 key = 包名（Plugins 页 entryKey）。 */
const SLOT_KEY = 'luke-jarvis'
/** settings 命名空间候选：cordis.patch.yml 行 id 优先，包名兜底。 */
const NAMESPACES = ['jarvis-core', 'include:jarvis-core', 'luke-jarvis']
/** 本插件 locale 字典命名空间。 */
const LOCALE_NAMESPACE = 'settings.lukeJarvis'

const h = React.createElement

// ── locale 字典（所有用户可见文字集中在这里，组件经 t 席位读取）──
const zh = {
  'card.title': '路克贾维斯（luke-jarvis）',
  'card.description': '贾维斯数字员工公司：界面、语音与 GitHub 自进化闭环配置。保存后实时生效，无需重启。',
  'card.loading': '正在读取设置…',
  'card.unavailable': '插件未加载或设置服务不可用，暂时无法配置。请确认 luke-jarvis 已安装并重启 dsh web。',
  'card.readOnly': '当前部署的设置是只读的。',
  'card.save': '保存',
  'card.saving': '保存中…',
  'card.saveFailed': '部署未接受这些值，请检查后重试。',
  'card.overridden': '已覆盖',
  'card.reset': '恢复默认',
  'card.invalid': '取值不合法。',
  'section.basic': '基本',
  'section.voice': '语音（TTS）',
  'section.evolution': 'GitHub 自进化闭环',
  'field.name.label': '助手名字',
  'field.name.hint': '界面称呼与语音唤醒词。默认 Jarvis；叫它的名字即可唤醒对话，无需手动开启麦克风。',
  'field.lang.label': '界面语言',
  'field.lang.hint': '增强 UI（Wings）显示语言：zh = 纯中文，en = 纯英文。保存后刷新页面生效。',
  'field.voiceEnabled.label': '语音功能',
  'field.voiceEnabled.hint': '总开关：开启后可用语音唤醒待命与语音播报；关闭后不自动开麦、不播报，一切通过文字交互。保存后刷新页面生效。',
  'field.workspaceMode.label': '实例角色',
  'field.workspaceMode.hint': 'user = 用户实例（上报 + 检测升级）；dev = 研发实例（工作区是源码仓，解锁 issue 巡检与修复链路）。',
  'field.voiceProviders.label': '语音模型（供应商卡片）',
  'field.voiceProviders.hint': '供应商不锁死，按协议接入：browser = 浏览器本地语音；openai = 任意 OpenAI 兼容 /audio/speech（换厂商只改 Base URL）；aliyun = DashScope。点「＋ 添加供应商」加卡片，点卡片上的「设为当前」即切换。API Key 只写不读，空 = 保留原值。',
  'field.voiceProviders.add': '＋ 添加供应商',
  'field.voiceProviders.use': '设为当前',
  'field.voiceProviders.active': '当前 ✓',
  'field.voiceProviders.useHint': '将此供应商设为当前生效（浏览器协议卡片不可设为当前）',
  'field.voiceProviders.useBrowserHint': 'browser 协议即浏览器本地语音，无需设为当前',
  'field.voiceProviders.del': '删除',
  'field.voiceProviders.namePh': '供应商名称（必填，如：我的OpenAI）',
  'field.voiceProviders.protocol': '协议',
  'field.voiceProviders.baseUrl': 'Base URL',
  'field.voiceProviders.apiKey': 'API Key',
  'field.voiceProviders.model': '模型',
  'field.voiceProviders.voice': '音色',
  'field.voiceProviders.speed': '语速',
  'field.githubRepo.label': 'GitHub 仓库',
  'field.githubRepo.hint': 'owner/name，自进化闭环上报与巡检的目标仓库。',
  'field.githubToken.label': 'GitHub Token',
  'field.githubToken.hint': 'PAT（建议只给 repo 权限）。留空时上报/巡检工具会如实提示未配置。',
  'field.reportMode.label': 'issue 上报模式',
  'field.reportMode.hint': 'confirm = 提交前需人确认（默认）；auto = 直接提交（须自担去重责任）。',
  'field.approvalRequired.label': '改源码前必须人工批准',
  'field.approvalRequired.hint': '开启时审批工单一律 pending_approval，批准前不许动源码。',
  'field.releaseChannel.label': '升级渠道',
  'field.releaseChannel.hint': 'stable = 只认正式 release（默认）；latest = 允许 prerelease。升级动作始终需人确认。',
}
const en = {
  'card.title': 'luke-jarvis',
  'card.description': 'Jarvis digital-employee company: UI, voice and GitHub self-evolution settings. Changes apply live, no restart.',
  'card.loading': 'Reading settings…',
  'card.unavailable': 'The plugin is not loaded or settings are unavailable. Install luke-jarvis and restart dsh web.',
  'card.readOnly': 'This deployment stores settings read-only.',
  'card.save': 'Save',
  'card.saving': 'Saving…',
  'card.saveFailed': 'The deployment did not accept these values; please review and retry.',
  'card.overridden': 'Overridden',
  'card.reset': 'Reset to default',
  'card.invalid': 'This value is not valid.',
  'section.basic': 'General',
  'section.voice': 'Voice (TTS)',
  'section.evolution': 'GitHub self-evolution',
  'field.name.label': 'Assistant name',
  'field.name.hint': 'Display name and wake word. Default Jarvis; call the name to start talking, no mic button needed.',
  'field.lang.label': 'UI language',
  'field.lang.hint': 'Wings UI language: zh = Chinese, en = English. Refresh the page after saving.',
  'field.voiceEnabled.label': 'Voice',
  'field.voiceEnabled.hint': 'Master switch: when on, wake-word standby and speech are available; when off, the mic never auto-starts and nothing is spoken — use text instead. Refresh the page after saving.',
  'field.workspaceMode.label': 'Instance role',
  'field.workspaceMode.hint': 'user = report issues + check upgrades; dev = source-checkout instance (issue triage + fix pipeline).',
  'field.voiceProviders.label': 'Voice models (provider cards)',
  'field.voiceProviders.hint': 'Protocol-based, vendor-free: browser = built-in speech; openai = any OpenAI-compatible /audio/speech (switch vendor by Base URL); aliyun = DashScope. Click "Add provider" for a new card, "Set active" on a card to switch. API Keys are write-only; empty keeps the saved value.',
  'field.voiceProviders.add': '+ Add provider',
  'field.voiceProviders.use': 'Set active',
  'field.voiceProviders.active': 'Active ✓',
  'field.voiceProviders.useHint': 'Make this provider active (browser cards cannot be set active)',
  'field.voiceProviders.useBrowserHint': 'browser protocol means local browser speech; no need to activate',
  'field.voiceProviders.del': 'Delete',
  'field.voiceProviders.namePh': 'Provider name (required, e.g. My OpenAI)',
  'field.voiceProviders.protocol': 'Protocol',
  'field.voiceProviders.baseUrl': 'Base URL',
  'field.voiceProviders.apiKey': 'API Key',
  'field.voiceProviders.model': 'Model',
  'field.voiceProviders.voice': 'Voice',
  'field.voiceProviders.speed': 'Speed',
  'field.githubRepo.label': 'GitHub repository',
  'field.githubRepo.hint': 'owner/name used by the self-evolution loop.',
  'field.githubToken.label': 'GitHub token',
  'field.githubToken.hint': 'PAT (repo scope recommended). Tools report honestly when unset.',
  'field.reportMode.label': 'Issue report mode',
  'field.reportMode.hint': 'confirm = human confirmation before submit (default); auto = submit directly.',
  'field.approvalRequired.label': 'Require approval before code changes',
  'field.approvalRequired.hint': 'When on, fix tickets stay pending_approval until a human approves.',
  'field.releaseChannel.label': 'Release channel',
  'field.releaseChannel.hint': 'stable = full releases only (default); latest = allow prereleases. Upgrades always need confirmation.',
}

// ── 表单字段描述器（与 host Config 的 volatile 字段一一对应）──
const FIELDS = [
  // 2026-11-09 精简：默认UI 只有一套（wings）不再可配；工作区由进入的会话决定（切换归 DSH），不做配置项。
  // 2026-11-09 名字可自定义：界面称呼 + 语音唤醒词共用。
  { id: 'name', section: 'basic', path: ['name'], type: 'text', fallback: 'Jarvis', label: 'field.name' },
  // 2026-11-09 界面语言：增强 UI 全量国际化（zh/en）。
  { id: 'lang', section: 'basic', path: ['lang'], type: 'select', options: ['zh', 'en'], fallback: 'zh', label: 'field.lang' },
  // 2026-11-09 语音播报开关：TTS 总开关移入设置（原 UI 内按钮已移除）。
  { id: 'voiceEnabled', section: 'basic', path: ['voiceEnabled'], type: 'checkbox', fallback: true, label: 'field.voiceEnabled' },
  // 2026-11-09 精简：只暴露核心字段；TTS 细节（apiKey/baseUrl/model/voice/speed）
  // 不再出现在设置卡片，已保存的值仍从服务端 accepted 配置读取并生效。
  // 2026-11-09 语音供应商不锁死：按协议接入，多卡片可增删与切换（事实源 voice.json）。
  { id: 'voiceProviders', section: 'voice', path: ['voice'], type: 'providers', label: 'field.voiceProviders' },
]
const SECTIONS = ['basic', 'voice']

// ── 配置模型：settings scope 快照 → 页面快照（组件里没有任何订阅机制）──
const UNSERVED = { status: 'unavailable', writable: false, revision: undefined, value: {}, base: {}, user: {} }

function getAt(obj, path) {
  let cur = obj
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

function project(snapshot) {
  if (!snapshot || snapshot.status !== 'ready') {
    return { ...UNSERVED, status: (snapshot && snapshot.status) || 'unavailable' }
  }
  return {
    status: 'ready',
    writable: snapshot.writable,
    revision: snapshot.revision,
    value: snapshot.value ?? {},
    base: snapshot.base,
    user: snapshot.user,
  }
}

function unchanged(a, b) {
  return a.status === b.status
    && a.writable === b.writable
    && a.revision === b.revision
    && JSON.stringify(a.value) === JSON.stringify(b.value)
    && JSON.stringify(a.base) === JSON.stringify(b.base)
    && JSON.stringify(a.user) === JSON.stringify(b.user)
}

class ConfigFormController {
  constructor(forms) {
    this.forms = forms
    this.snapshot = this.compute()
    this.listeners = new Set()
    this.offs = forms.map((form) => {
      try {
        return form.subscribe(() => {
          const next = this.compute()
          if (unchanged(this.snapshot, next)) return
          this.snapshot = next
          for (const listener of [...this.listeners]) listener()
        })
      } catch { return () => {} }
    })
  }

  /** 命名空间谁 ready 用谁（行 id 优先，包名兜底）；都没 ready 取第一个的状态。 */
  activeForm() {
    for (const form of this.forms) {
      try { if (form.getSnapshot().status === 'ready') return form } catch { /* 继续兜底 */ }
    }
    return this.forms[0]
  }

  compute() {
    const form = this.activeForm()
    if (!form) return { ...UNSERVED }
    try { return project(form.getSnapshot()) } catch { return { ...UNSERVED } }
  }

  getSnapshot() { return this.snapshot }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  inject() {
    return {
      hooks: {
        jarvisConfig: {
          getSnapshot: () => this.getSnapshot(),
          subscribe: (listener) => this.subscribe(listener),
        },
      },
      submit: (ops, expectedRevision) => this.activeForm().mutate(ops, expectedRevision),
    }
  }

  dispose() { for (const off of this.offs) { try { off() } catch { /* 忽略 */ } } }
}

function createConfigForm(ctx) {
  const forms = []
  for (const ns of NAMESPACES) {
    try {
      const form = ctx.configForms.get(ns)
      if (form) forms.push(form)
    } catch { /* 命名空间未服务：继续兜底 */ }
  }
  return new ConfigFormController(forms)
}

// ── 设置左侧导航「路克贾维斯」独立分区（规范：settings.section 每个配置页一个条目）──
// 背景：只注册 plugins.bundle.config 只会在「设置→插件→luke-jarvis 详情」里出现，
// 用户期望的是设置菜单直接有「路克贾维斯」配置项 → 按 settings.section 规范再注册一页。
function registerSettingsSection(ctx) {
  const controller = createConfigForm(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'luke-jarvis: settings section form')
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'luke-jarvis',
      order: 200,
      label: '路克贾维斯（Jarvis）',
      locale: LOCALE_NAMESPACE,
      inject: () => ({ ...controller.inject(), view: 'page' }),
    },
    ConfigCard,
  ))
}

// ── 插槽注册（不做服务门控：Plugins 页靠注册项决定那一节是否渲染）──
// ── Jarvis 主页面（规范：sidebar.panellist 图标 + main 面板一一对应）──
// 用户反馈「设置里找不到 Jarvis、也找不到主页面」：主页面原本只有独立 URL /jarvis-wings，
// 没有接进 DSH 的侧栏/主面板。这里按插槽规范注册一个侧栏图标 + 对应 main 面板（iframe 载入 wings 主页面）。
function JarvisPanelIcon({ size, active }) {
  const s = Number(size) || 20
  return h('svg', {
    width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { color: active ? 'var(--dsw-accent, #70eaff)' : undefined, opacity: active ? 1 : 0.78 },
  },
    h('circle', { cx: 12, cy: 12, r: 8.6 }),
    h('circle', { cx: 12, cy: 12, r: 3.4 }),
    h('path', { d: 'M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2' }),
  )
}

function JarvisMainPage() {
  let src = '/jarvis-wings?embedded=1'
  try {
    const sid = window.__jarvisPanelSession ? '&session=' + encodeURIComponent(window.__jarvisPanelSession) : ''
    src = '/jarvis-wings?embedded=1' + sid
  } catch (e) { /* 忽略 */ }
  return h('iframe', {
    id: 'jarvisFrame',
    src,
    title: '贾维斯主页面',
    style: { width: '100%', height: '100%', border: '0', display: 'block', background: '#02070d' },
  })
}

// ── 增强 UI 入口（用户反馈「没有入口」）：悬浮贾维斯浮动块 + 侧栏按钮 ──
// 点击统一走 ctx.layout.selectPanel('jarvis') → 切到上面的 main 面板（全息 Wings 主页面）。
function openJarvis(ctx) {
  try { ctx.layout.selectPanel('jarvis') } catch (e) {
    try { window.open('/jarvis-wings', '_blank', 'noopener') } catch { /* 最终兜底忽略 */ }
  }
}

function JarvisFloatingBlock({ size, active, onOpen }) {
  const s = Number(size) || 56
  const [hover, setHover] = React.useState(false)
  return h('button', {
    type: 'button',
    title: '打开贾维斯增强 UI（全息 Wings）',
    'aria-label': '打开贾维斯增强 UI',
    onClick: () => onOpen && onOpen(),
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: 'fixed', right: '26px', bottom: '104px', zIndex: 2147483000,
      width: s + 'px', height: s + 'px', borderRadius: '50%', cursor: 'pointer',
      border: '1px solid rgba(112,234,255,.65)',
      background: 'radial-gradient(circle at 35% 30%, rgba(112,234,255,.55), rgba(3,20,32,.92) 62%)',
      boxShadow: hover ? '0 0 38px rgba(112,234,255,.55), 0 0 12px rgba(112,234,255,.4)' : '0 0 22px rgba(0,200,242,.35)',
      color: '#e9feff', font: '600 18px/1 "Microsoft YaHei", sans-serif',
      transform: hover ? 'scale(1.06)' : 'none', transition: 'transform .18s ease, box-shadow .18s ease',
    },
  }, '贾')
}

// ── 会话级入口（关键：主面板是 root 作用域，拿不到当前会话 → 用会话头部按钮把 sessionId 传进去）──
function registerSessionEntry(ctx) {
  const OpenJarvis = (props) => {
    const sid = String((props && props.sessionId) || '')
    return h('button', {
      type: 'button',
      title: '打开贾维斯增强 UI（绑定当前会话的工作区）',
      'aria-label': '打开贾维斯增强 UI',
      onClick: () => {
        try { window.__jarvisPanelSession = sid } catch (e) {}
        try {
          const f = document.getElementById('jarvisFrame')
          if (f && sid) f.src = '/jarvis-wings?embedded=1&session=' + encodeURIComponent(sid)
        } catch (e) {}
        let switched = true
        try { ctx.layout.selectPanel('jarvis') } catch (e) { switched = false }
        if (!switched) { try { window.open('/jarvis-wings?embedded=1&session=' + encodeURIComponent(sid), '_blank', 'noopener') } catch (e) {} }
      },
      style: { display: 'inline-flex', alignItems: 'center', gap: '5px', height: '24px', padding: '0 8px', cursor: 'pointer', border: '1px solid rgba(112,234,255,.22)', borderRadius: '4px', background: 'rgba(5,20,31,.45)', color: '#9fd9ea', font: '9px/1 "Microsoft YaHei", sans-serif' },
    }, h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: '#70eaff', boxShadow: '0 0 6px #70eaff' } }), '贾维斯')
  }
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'jarvis-open', order: 60, label: '贾维斯' },
    OpenJarvis,
  ))
}

function registerMainPanel(ctx) {
  // 2026-11-09 单入口化：移除侧栏面板图标（sidebar.panellist）与悬浮浮动块（shell.overlay）。
  // 只保留会话头部按钮（conversation.session.header.actions）作为唯一入口；
  // main 面板保留，供会话按钮 selectPanel('jarvis') 后作为 iframe 容器显示。
  ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: 'jarvis' },
    JarvisMainPage,
  ))
}

function registerConfigCard(ctx) {
  try {
    const mirror = ctx.configForms && ctx.configForms.describe && ctx.configForms.describe()
    const snap = mirror && mirror.getSnapshot && mirror.getSnapshot()
    const served = (snap && snap.view && snap.view.namespaces || []).map((v) => v && v.ns).filter(Boolean)
    console.info('[luke-jarvis] settings namespaces served by host:', served.join(', ') || '(none)')
  } catch (e) { console.info('[luke-jarvis] settings namespace probe failed:', e && e.message) }
  const controller = createConfigForm(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'luke-jarvis: config form')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
    {
      name: 'plugins.bundle.config',
      key: SLOT_KEY,
      locale: LOCALE_NAMESPACE,
      inject: () => controller.inject(),
    },
    ConfigCard,
  ))
}

// ── 草稿读写 ──
/** voice 配置 → 草稿（apiKey 只写不读：草稿里恒空，保存时空 = 按 name 保留原值）。 */
function normProvidersDraft(v) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  const list = Array.isArray(o.providers) ? o.providers : []
  return {
    active: typeof o.active === 'string' ? o.active : '',
    providers: list.map((p) => ({
      name: String((p && p.name) || '').trim(),
      protocol: ['browser', 'openai', 'aliyun'].includes(String(p && p.protocol)) ? String(p.protocol) : 'openai',
      baseUrl: String((p && p.baseUrl) || '').trim(),
      apiKey: '',
      model: String((p && p.model) || '').trim(),
      voice: String((p && p.voice) || '').trim(),
      speed: Math.max(0.5, Math.min(1.5, Number(p && p.speed) || 0.95)),
    })),
  }
}

function readDraft(accepted) {
  const draft = {}
  for (const f of FIELDS) {
    const v = getAt(accepted, f.path)
    if (f.type === 'checkbox') draft[f.id] = v === true
    else if (f.type === 'select') draft[f.id] = typeof v === 'string' && v ? v : f.fallback
    else if (f.type === 'number') draft[f.id] = typeof v === 'number' ? String(v) : ''
    else if (f.type === 'providers') draft[f.id] = normProvidersDraft(v)
    else draft[f.id] = typeof v === 'string' ? v : ''
  }
  return draft
}

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function isOverridden(user, path) {
  let cur = user
  for (const key of path) {
    if (!cur || typeof cur !== 'object' || !(key in cur)) return false
    cur = cur[key]
  }
  return true
}

/** 草稿值 → 写入值；空文本/空数字 = undefined（清除覆盖，回落部署默认）。 */
function draftValue(f, draft) {
  const raw = draft[f.id]
  if (f.type === 'checkbox' || f.type === 'select' || f.type === 'providers') return raw
  if (raw === '') return undefined
  if (f.type === 'number') return Number(raw)
  return raw
}

function validField(f, draft) {
  if (f.type === 'providers') {
    const v = draft[f.id] || { active: '', providers: [] }
    const names = (v.providers || []).map((p) => String(p.name || '').trim())
    if (names.some((n) => !n)) return false
    if (new Set(names).size !== names.length) return false
    if (v.active && !names.includes(v.active)) return false
    return true
  }
  if (f.type !== 'number') return true
  const raw = draft[f.id]
  if (raw === '') return true
  const n = Number(raw)
  return Number.isFinite(n) && n >= f.min && n <= f.max
}

function buildOps(accepted, base, draft) {
  const ops = []
  for (const f of FIELDS) {
    const next = draftValue(f, draft)
    if (sameValue(next, getAt(accepted, f.path))) continue
    if (next === undefined || sameValue(next, getAt(base, f.path))) {
      ops.push({ op: 'unset', path: [...f.path] })
    } else {
      ops.push({ op: 'set', path: [...f.path], value: next })
    }
  }
  return ops
}

// ── 组件 ──
function ConfigCard(props) {
  const { t, view } = props
  const snapshot = props.useJarvisConfig((state) => state)
  if (view === 'summary') return h('p', { className: 'lkj-summary' }, t('card.description'))
  if (snapshot.status === 'loading') return h('p', { className: 'lkj-note' }, t('card.loading'))
  if (snapshot.status !== 'ready') return h('p', { className: 'lkj-note' }, t('card.unavailable'))
  return h(SettingsForm, { ...props, snapshot })
}

function SettingsForm({ t, submit, snapshot }) {
  const accepted = snapshot.value
  const [draft, setDraft] = React.useState(() => readDraft(accepted))
  const [seeding, setSeeding] = React.useState(() => readDraft(accepted))
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const dirty = !sameValue(draft, seeding)
  const valid = FIELDS.every((f) => validField(f, draft))
  const editable = snapshot.writable && !saving

  // 宿主接受了新值：只在用户没有待保存编辑时重读草稿，免得抹掉正在编辑的内容。
  React.useEffect(() => {
    const next = readDraft(accepted)
    if (sameValue(next, seeding) || !sameValue(draft, seeding)) return
    setSeeding(next)
    setDraft(next)
  }, [accepted, seeding, draft])

  async function save() {
    if (!valid || !dirty) return
    setSaving(true)
    setFailed(false)
    try {
      const ops = buildOps(accepted, snapshot.base, draft)
      if (ops.length === 0) return
      const written = await submit(ops, snapshot.revision)
      if (written) setSeeding({ ...draft })
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const children = [h('h3', { key: 'title', className: 'lkj-form-title' }, t('card.title'))]
  for (const section of SECTIONS) {
    children.push(h('h4', { key: `sec-${section}`, className: 'lkj-section' }, t(`section.${section}`)))
    for (const f of FIELDS.filter((field) => field.section === section)) {
      children.push(renderField({ f, t, draft, setDraft, snapshot, editable, key: f.id }))
    }
  }
  if (!snapshot.writable) children.push(h('p', { key: 'ro', className: 'lkj-note' }, t('card.readOnly')))
  if (failed) children.push(h('p', { key: 'fail', className: 'lkj-invalid', role: 'alert' }, t('card.saveFailed')))
  children.push(h('div', { key: 'actions', className: 'lkj-form-actions' }, [
    h('button', {
      key: 'reset',
      type: 'button',
      disabled: !snapshot.writable,
      onClick: () => {
        const next = readDraft(accepted)
        setSeeding(next)
        setDraft(next)
      },
    }, t('card.reset')),
    h('button', { key: 'save', type: 'submit', disabled: !editable || !dirty || !valid }, saving ? t('card.saving') : t('card.save')),
  ]))

  return h('form', {
    className: 'lkj-form',
    onSubmit: (event) => {
      event.preventDefault()
      void save()
    },
  }, children)
}

function renderField({ f, t, draft, setDraft, snapshot, editable, key }) {
  const id = `lkj-${f.id}`
  const label = t(`${f.label}.label`)
  const hint = t(`${f.label}.hint`)
  const badge = isOverridden(snapshot.user, f.path)
    ? h('em', { className: 'lkj-badge' }, t('card.overridden'))
    : null
  const set = (value) => { setDraft({ ...draft, [f.id]: value }) }

  if (f.type === 'checkbox') {
    return h('div', { key, className: 'lkj-field lkj-field-inline' }, [
      h('input', {
        key: 'input',
        id,
        type: 'checkbox',
        checked: draft[f.id] === true,
        disabled: !editable,
        'aria-describedby': `${id}-hint`,
        onChange: (event) => { set(event.currentTarget.checked) },
      }),
      h('div', { key: 'text' }, [
        h('label', { key: 'label', htmlFor: id }, label, badge),
        h('span', { key: 'hint', className: 'lkj-field-hint', id: `${id}-hint` }, hint),
      ]),
    ])
  }

  if (f.type === 'providers') {
    const val = draft[f.id] || { active: '', providers: [] }
    const upd = (next) => set({ ...val, ...next })
    const updCard = (idx, patch) => upd({ providers: val.providers.map((x, i) => (i === idx ? { ...x, ...patch } : x)) })
    const isBrowser = (p) => p.protocol === 'browser'
    const cards = val.providers.map((p, idx) => h('div', { key: `card-${idx}`, className: 'lkj-prov-card' }, [
      h('div', { key: 'head', className: 'lkj-prov-head' }, [
        h('input', { key: 'name', className: 'lkj-prov-name', type: 'text', value: p.name, placeholder: t('field.voiceProviders.namePh'), disabled: !editable, onChange: (e) => updCard(idx, { name: e.currentTarget.value }) }),
        h('button', { key: 'use', type: 'button', className: `lkj-prov-use${val.active === p.name ? ' on' : ''}`, disabled: !editable || isBrowser(p), title: isBrowser(p) ? t('field.voiceProviders.useBrowserHint') : t('field.voiceProviders.useHint'), onClick: () => upd({ active: val.active === p.name ? '' : p.name }) }, val.active === p.name ? t('field.voiceProviders.active') : t('field.voiceProviders.use')),
        h('button', { key: 'del', type: 'button', className: 'lkj-prov-del', disabled: !editable, onClick: () => upd({ providers: val.providers.filter((_, i) => i !== idx), active: val.active === p.name ? '' : val.active }) }, t('field.voiceProviders.del')),
      ]),
      h('div', { key: 'grid', className: 'lkj-prov-grid' }, [
        h('label', { key: 'lp' }, t('field.voiceProviders.protocol'),
          h('select', { value: p.protocol, disabled: !editable, onChange: (e) => updCard(idx, { protocol: e.currentTarget.value }) },
            ['browser', 'openai', 'aliyun'].map((op) => h('option', { key: op, value: op }, op)))),
        h('label', { key: 'lu' }, t('field.voiceProviders.baseUrl'),
          h('input', { type: 'text', value: p.baseUrl, placeholder: 'https://api.openai.com/v1', disabled: !editable || isBrowser(p), onChange: (e) => updCard(idx, { baseUrl: e.currentTarget.value }) })),
        h('label', { key: 'lk' }, t('field.voiceProviders.apiKey'),
          h('input', { type: 'password', value: p.apiKey, placeholder: isBrowser(p) ? '' : 'sk-…（空 = 保留原值）', disabled: !editable || isBrowser(p), autoComplete: 'off', onChange: (e) => updCard(idx, { apiKey: e.currentTarget.value }) })),
        h('label', { key: 'lm' }, t('field.voiceProviders.model'),
          h('input', { type: 'text', value: p.model, placeholder: isBrowser(p) ? '' : 'gpt-4o-mini-tts / cosyvoice-v2 / …', disabled: !editable || isBrowser(p), onChange: (e) => updCard(idx, { model: e.currentTarget.value }) })),
        h('label', { key: 'lv' }, t('field.voiceProviders.voice'),
          h('input', { type: 'text', value: p.voice, placeholder: 'nova', disabled: !editable || isBrowser(p), onChange: (e) => updCard(idx, { voice: e.currentTarget.value }) })),
        h('label', { key: 'ls' }, t('field.voiceProviders.speed'),
          h('input', { type: 'number', min: 0.5, max: 1.5, step: 0.05, value: p.speed, disabled: !editable || isBrowser(p), onChange: (e) => updCard(idx, { speed: Number(e.currentTarget.value) || 0.95 }) })),
      ]),
    ]))
    return h('div', { key, className: 'lkj-field' }, [
      h('div', { key: 'label', className: 'lkj-field-label' }, [h('label', { key: 'l' }, label), badge]),
      h('span', { key: 'hint', className: 'lkj-field-hint', id: `${id}-hint` }, hint),
      h('div', { key: 'list', className: 'lkj-prov-list' }, cards),
      h('button', { key: 'add', type: 'button', className: 'lkj-prov-add', disabled: !editable, onClick: () => upd({ providers: [...val.providers, { name: '', protocol: 'openai', baseUrl: '', apiKey: '', model: '', voice: 'nova', speed: 0.95 }] }) }, t('field.voiceProviders.add')),
      !validField(f, draft) ? h('span', { key: 'invalid', className: 'lkj-invalid' }, t('card.invalid')) : null,
    ])
  }

  let input
  if (f.type === 'select') {
    input = h('select', {
      id,
      value: draft[f.id],
      disabled: !editable,
      'aria-describedby': `${id}-hint`,
      onChange: (event) => { set(event.currentTarget.value) },
    }, f.options.map((opt) => h('option', { key: opt, value: opt }, opt)))
  } else {
    const invalid = !validField(f, draft)
    input = h('input', {
      id,
      type: f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text',
      value: draft[f.id],
      disabled: !editable,
      min: f.min,
      max: f.max,
      step: f.step,
      'aria-invalid': invalid || undefined,
      'aria-describedby': `${id}-hint`,
      autoComplete: f.type === 'password' ? 'off' : undefined,
      onChange: (event) => { set(event.currentTarget.value) },
    })
  }

  return h('div', { key, className: 'lkj-field' }, [
    h('div', { key: 'label', className: 'lkj-field-label' }, [
      h('label', { key: 'l', htmlFor: id }, label),
      badge,
    ]),
    h('span', { key: 'hint', className: 'lkj-field-hint', id: `${id}-hint` }, hint),
    input,
    !validField(f, draft) ? h('span', { key: 'invalid', className: 'lkj-invalid' }, t('card.invalid')) : null,
  ])
}

// ── 样式：主题令牌 + 全局唯一 lkj- 前缀 ──
// 主题策略：DSH 通过 body[data-ds-dark-theme] 属性切换深浅色；这里定义本地令牌层
// --lkj-*（DSH 原生 dsw-alias 令牌优先，字面色兜底），属性切换时浏览器即时重算，
// 无需任何 JS 监听。color-scheme 让原生 <select> 弹出层（option 列表）也跟随主题。
const CSS = `
.lkj-form {
  display: flex; flex-direction: column; gap: 12px; font-size: 13px; line-height: 1.6;
  --lkj-text: var(--dsw-alias-label-primary, #1f2328);
  --lkj-text-dim: var(--dsw-alias-label-tertiary, rgba(31,35,40,0.65));
  --lkj-bg: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #ffffff));
  --lkj-border: var(--dsw-alias-border-l2, rgba(31,35,40,0.28));
  --lkj-hover: var(--dsw-alias-bg-layer-2, rgba(31,35,40,0.06));
  --lkj-danger: var(--dsw-alias-state-error-primary, #d64545);
  color-scheme: light;
}
body[data-ds-dark-theme] .lkj-form {
  --lkj-text: var(--dsw-alias-label-primary, #f9fafb);
  --lkj-text-dim: var(--dsw-alias-label-tertiary, rgba(249,250,251,0.62));
  --lkj-bg: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #2b2f36));
  --lkj-border: var(--dsw-alias-border-l2, rgba(249,250,251,0.26));
  --lkj-hover: var(--dsw-alias-bg-layer-2, rgba(249,250,251,0.10));
  --lkj-danger: var(--dsw-alias-state-error-primary, #ff8080);
  color-scheme: dark;
}
.lkj-form-title { margin: 0; font-size: 16px; line-height: 1.4; }
.lkj-section { margin: 8px 0 0; font-size: 13px; line-height: 1.4; opacity: 0.7; }
.lkj-summary, .lkj-note { margin: 0; opacity: 0.75; font-size: 13px; line-height: 1.6; }
.lkj-field { display: flex; flex-direction: column; gap: 4px; }
.lkj-field-label { display: flex; align-items: center; gap: 8px; }
.lkj-field-hint { font-size: 12px; line-height: 1.5; opacity: 0.65; }
.lkj-field-inline { flex-direction: row; align-items: flex-start; gap: 8px; }
.lkj-field input[type="text"], .lkj-field input[type="password"], .lkj-field input[type="number"], .lkj-field select {
  padding: 6px 10px; font-size: 13px; line-height: 1.5;
  color: var(--lkj-text);
  background: var(--lkj-bg);
  border: 0.5px solid var(--lkj-border);
  border-radius: var(--dsw-radius-md, 6px);
}
.lkj-field input:disabled, .lkj-field select:disabled { opacity: 0.45; }
.lkj-badge { font-size: 12px; font-style: normal; opacity: 0.65; }
.lkj-invalid { color: var(--lkj-danger); font-size: 12px; line-height: 1.5; }
.lkj-form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.lkj-form-actions button {
  padding: 6px 16px; font-size: 13px; line-height: 1.5; cursor: pointer;
  color: var(--lkj-text);
  background: var(--lkj-hover);
  border: 0.5px solid var(--lkj-border);
  border-radius: var(--dsw-radius-md, 6px);
}
.lkj-form-actions button:hover:not(:disabled) { background: var(--lkj-bg); }
.lkj-form-actions button:disabled { opacity: 0.4; cursor: default; }
.lkj-prov-list { display: flex; flex-direction: column; gap: 8px; }
.lkj-prov-card { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 0.5px solid var(--lkj-border); border-radius: var(--dsw-radius-md, 6px); }
.lkj-prov-head { display: flex; align-items: center; gap: 6px; }
.lkj-prov-name { flex: 1; padding: 4px 8px; font-size: 13px; color: var(--lkj-text); background: var(--lkj-bg); border: 0.5px solid var(--lkj-border); border-radius: var(--dsw-radius-md, 6px); }
.lkj-prov-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; }
.lkj-prov-grid label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; opacity: 0.85; }
.lkj-prov-grid input, .lkj-prov-grid select { padding: 4px 8px; font-size: 12px; color: var(--lkj-text); background: var(--lkj-bg); border: 0.5px solid var(--lkj-border); border-radius: var(--dsw-radius-md, 6px); }
.lkj-prov-use, .lkj-prov-del, .lkj-prov-add { padding: 4px 10px; font-size: 12px; cursor: pointer; border-radius: var(--dsw-radius-md, 6px); border: 0.5px solid var(--lkj-border); background: var(--lkj-hover); color: var(--lkj-text); }
.lkj-prov-use.on { background: var(--lkj-bg); font-weight: 600; outline: 1px solid var(--lkj-border); }
.lkj-prov-add { align-self: flex-start; }
.lkj-prov button:disabled { opacity: 0.4; cursor: default; }
`

function injectStyles() {
  const el = document.createElement('style')
  el.id = 'lkj-settings-styles'
  el.textContent = CSS
  document.head.appendChild(el)
  return () => { el.remove() }
}

/** 依赖的服务：slots / locale / configForms 就绪后本插件才加载。 */
exports.inject = ['slots', 'locale', 'configForms', 'layout']

/** 挂载浏览器半边：注册字典、样式与 Plugins 页配置卡片。 */
exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), 'luke-jarvis: dictionaries')
  ctx.effect(() => injectStyles())
  registerConfigCard(ctx)
  registerSettingsSection(ctx)
  registerMainPanel(ctx)
  registerSessionEntry(ctx)
}

  })(module, module.exports, require);
  return module.exports;
}});
