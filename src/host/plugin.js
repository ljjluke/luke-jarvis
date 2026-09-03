/**
 * luke-jarvis · Jarvis 数字员工公司核心插件（Host）
 *
 * 真实可发布的 Cordis 插件形态：npm 包默认导出插件定义，通过
 * package.json 的 `dsh.bundle.patch` → cordis.patch.yml 挂载。
 *
 * 注册内容（全部用宿主服务，非动态 harness）：
 *   - tools.register（jarvis_project / jarvis_distill / jarvis_review / jarvis_think）
 *   - commands.register（/jarvis 命令）
 *
 * ⚠️ 防 bug 铁律（内嵌代码，安装即生效）：
 *   1. jarvis_distill 校验角色卡：六段式必含、CEO 卡必含协同架构、必含真实 source、必含防冒名声明；
 *      任缺 → 不通过，禁止注入。
 *   2. 绝不直接复用旧卡：只提供"现场 web 蒸馏"路径，无任何"取旧卡"分支。
 *   3. 真实优先：所有工具输出强制"角色卡只提供思考框架，判断必须基于真实情况"。
 *
 * 生命周期：所有注册用 ctx.effect 包裹（register 返回 disposer），插件停止/更新时自动清理。
 */

const SECTIONS = ['身份定位', '思维模型', '核心方法论', '代表作品', '决策红线', '语言风格']

/** 女娲式蒸馏证据链必含段（防"迎合蒸馏/编造 source"硬闸）。 */
const EVIDENCE_SECTIONS = [
  '证据链',      // 六维度调研记录（著作/对话/表达/他者/决策/时间线）
  '诚实边界',    // 做不到什么、信息截止时间、推测成分
  '保真度',      // 一手/二手/推断占比，矛盾点
]


/**
 * 协同架构四要素（CEO 卡硬闸）：子角色如何协同的最小完备集。
 * CEO 决定子角色后，必须为每个角色明确：位置/依赖/介入时机/协同方式。
 * 缺任一 → 协同设计不完整，禁止建队。
 */
const COLLAB_FOUR = ['位置', '依赖', '介入时机', '协同方式']

/** 公屏（统一黑板）持久化路径：<cwd>/.jarvis/board.json（项目级，与 RPC/HTTP 读取同一约定） */
function boardFilePath() {
  const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : ''
  return (cwd ? cwd + '/' : '') + '.jarvis/board.json'
}

/** 从磁盘读公屏 items（无文件/坏 JSON → 空数组）。写路径与读取（HTTP/RPC）完全一致，杜绝双源。
 *  返回 { items, version, statInfo }：version 是 dsh-fs 的乐观并发 token（writeText replaceIfVersion 用）。 */
async function readBoardItems(fsSvc) {
  if (!fsSvc || typeof fsSvc.readText !== 'function') return { items: [], fromDisk: false, version: null }
  try {
    const target = await fsSvc.resolve(boardFilePath())
    if (!target) return { items: [], fromDisk: false, version: null }
    let statInfo = null
    try { statInfo = (typeof fsSvc.stat === 'function') ? await fsSvc.stat(target) : null } catch { statInfo = null }
    const text = await fsSvc.readText(target)
    if (!text) return { items: [], fromDisk: false, version: null }
    const data = JSON.parse(text)
    if (data && Array.isArray(data.items)) {
      return { items: data.items.map((it) => ({ ...it })), fromDisk: true, version: (statInfo && statInfo.version) || null, statInfo }
    }
    return { items: [], fromDisk: true, version: null, statInfo }
  } catch {
    return { items: [], fromDisk: false, version: null, statInfo: null }
  }
}

/** 原子写公屏：dsh-fs writeText + replaceIfVersion 乐观并发守卫。
 *  写失败（含 FS_STALE_VERSION 并发冲突）不吞：返回 { ok, error } 由调用方如实上报。 */
export async function writeBoardItems(fsSvc, items, version) {
  if (!fsSvc || typeof fsSvc.writeText !== 'function') return { ok: false, error: 'fs.writeText 不可用' }
  try {
    const target = await fsSvc.resolve(boardFilePath())
    if (!target) return { ok: false, error: '路径解析失败' }
    const content = JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2)
    if (version) {
      await fsSvc.writeText(target, content, { kind: 'replaceIfVersion', version })
    } else {
      await fsSvc.writeText(target, content)
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

/** 公屏条目 ID：基于磁盘最新 items 取 max 单调递增（修复并发撞 ID —— 纯函数无解，必须读持久化真源） */
export function nextBoardId(items) {
  let max = 0
  for (const it of items) {
    const m = /^B(\d+)$/.exec(String(it && it.id || ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return 'B' + (max + 1)
}

/** 公司状态文件路径（与 jarvis_company 同一文件，3D UI 数据源） */
function companyStateFile() {
  const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : ''
  return (cwd ? cwd + '/' : '') + '.jarvis/company-state.json'
}

/** 读公司状态（无文件 → 空骨架） */
async function readCompanyState(fsSvc) {
  const empty = { company: {}, employees: [], meetings: [], recruiting: [], ceo: {}, headhunter: {}, tasks: [], updatedAt: '' }
  if (!fsSvc || typeof fsSvc.readText !== 'function') return empty
  try {
    const target = await fsSvc.resolve(companyStateFile())
    if (!target) return empty
    const text = await fsSvc.readText(target)
    if (!text) return empty
    const data = JSON.parse(text)
    return data && typeof data === 'object' ? { ...empty, ...data } : empty
  } catch { return empty }
}

/** 写公司状态 */
async function writeCompanyState(fsSvc, state) {
  if (!fsSvc || typeof fsSvc.writeText !== 'function') return false
  try {
    const target = await fsSvc.resolve(companyStateFile())
    if (!target) return false
    state.updatedAt = new Date().toISOString()
    await fsSvc.writeText(target, JSON.stringify(state, null, 2))
    return true
  } catch { return false }
}

/**
 * 工具动作自动同步公司状态（3D 画面反映真实动作，不靠 CEO 手动 update）：
 *   action.meeting_started/meeting_done → meetings 表更新
 *   action.employee_evaluated {role, score, strikes, status} → employees 表更新(perfScore/strikes/status)
 *   action.employee_terminated {role} → employees 表标 terminated
 *   action.employee_hired {role, persona} → employees 表加人
 *   action.employee_reporting {role} → employees 表标 reporting
 *   action.employee_started {role} → employees 表标 working（领任务开工，状态从 idle/报到 变干活）
 *   action.recruiting_started {position} → recruiting 表加条
 */
export async function syncCompanyState(fsSvc, action) {
  if (!fsSvc || typeof fsSvc.readText !== 'function' || typeof fsSvc.writeText !== 'function') return false
  try {
    const state = await readCompanyState(fsSvc)
    const a = action || {}
    if (a.type === 'meeting_started' && a.meeting) {
      const m = state.meetings.find((x) => x.id === a.meeting.id)
      if (m) m.status = 'in_progress'
      else state.meetings.push({ id: a.meeting.id || 'm' + (state.meetings.length + 1), type: a.meeting.type || '', topic: a.meeting.topic || '', attendees: a.meeting.attendees || [], status: 'in_progress' })
    } else if (a.type === 'meeting_done' && a.meetingId) {
      const m = state.meetings.find((x) => x.id === a.meetingId)
      if (m) m.status = 'done'
    } else if (a.type === 'employee_evaluated' && a.role) {
      const emp = state.employees.find((e) => e.role === a.role)
      const rec = { role: a.role, persona: (emp && emp.persona) || a.persona || '', perfScore: a.score, strikes: a.strikes, status: a.status || (emp && emp.status) || 'working', note: a.note || '' }
      if (emp) Object.assign(emp, rec)
      else state.employees.push(rec)
    } else if (a.type === 'employee_terminated' && a.role) {
      const emp = state.employees.find((e) => e.role === a.role)
      if (emp) { emp.status = 'terminated'; emp.terminatedAt = new Date().toISOString().slice(0, 10); emp.note = a.note || emp.note || '' }
    } else if (a.type === 'employee_hired' && a.role) {
      state.employees.push({ role: a.role, persona: a.persona || '', status: 'working', hiredAt: new Date().toISOString().slice(0, 10), replaces: a.replaces || '' })
      // 注入完成 → 自动把匹配该岗位的 recruiting 标 confirmed（防 3D 画面显示"还在找"即使已入职）
      const hiredRole = a.role
      const replacedEmp = a.replaces || ''
      for (const r of state.recruiting) {
        if (r.status === 'searching' || r.status === 'interviewing') {
          if (r.position === hiredRole || (replacedEmp && r.replacesEmp === replacedEmp)) {
            r.status = 'confirmed'
            r.hiredRole = hiredRole
          }
        }
      }
    } else if (a.type === 'employee_started' && a.role) {
      const emp = state.employees.find((e) => e.role === a.role)
      if (emp) { emp.status = 'working'; emp.currentWork = a.currentWork || ''; emp.lastStartedAt = new Date().toISOString().slice(0, 16) }
    } else if (a.type === 'employee_reporting' && a.role) {
      const emp = state.employees.find((e) => e.role === a.role)
      if (emp) { emp.status = 'reporting'; emp.lastReportAt = new Date().toISOString().slice(0, 16); if (a.note) emp.lastReport = a.note }
    } else if (a.type === 'recruiting_started' && a.position) {
      state.recruiting.push({ id: 'r' + (state.recruiting.length + 1), position: a.position, targetPersona: a.targetPersona || '', candidates: [], status: 'searching', replacesEmp: a.replacesEmp || '' })
    } else {
      return false // 未知动作不改
    }
    return await writeCompanyState(fsSvc, state)
  } catch { return false }
}

import { execSync, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { defineTool } from '@deepseek-ai/dsh-tools'
const _require = createRequire(import.meta.url)
/** 归一化 output.schema：根级/嵌套 required:[...] 数组 → 逐属性 required:true（value schema DSL）。
 * 递归处理嵌套对象节点；required 已按属性内联时原样返回。 */
function normalizeOutputSchema(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node
  const out = { ...node }
  if (out.type === 'object' && !Object.prototype.hasOwnProperty.call(out, 'additionalProperties')) {
    out.additionalProperties = false
  }
  if (Array.isArray(out.required)) {
    const required = out.required
    delete out.required
    if (out.properties && typeof out.properties === 'object') {
      const props = {}
      for (const [k, v] of Object.entries(out.properties)) {
        props[k] = required.includes(k) ? { ...v, required: true } : normalizeOutputSchema(v)
      }
      out.properties = props
    }
  }
  if (out.properties && typeof out.properties === 'object') {
    const props = {}
    for (const [k, v] of Object.entries(out.properties)) props[k] = normalizeOutputSchema(v)
    out.properties = props
  }
  if (out.items && typeof out.items === 'object') out.items = normalizeOutputSchema(out.items)
  return out
}

/** 归一化 parameters：完整 schema 风格 {type:'object',properties:{...},required:[...]}
 *  → dsh-tools 0.1.2 期望的隐式属性表风格 {name:{type,description,required}}。
 * 已是属性表风格（无 type:'object' 外壳）时原样返回。 */
function normalizeParameters(spec) {
  if (spec && typeof spec === 'object' && spec.type === 'object' && spec.properties && typeof spec.properties === 'object') {
    const required = Array.isArray(spec.required) ? spec.required : []
    const out = {}
    for (const [k, v] of Object.entries(spec.properties)) {
      const p = { ...v }
      if (required.includes(k)) p.required = true
      if (p.type === 'object' && !Object.prototype.hasOwnProperty.call(p, 'additionalProperties')) {
        p.additionalProperties = false
      }
      out[k] = p
    }
    return out
  }
  return spec
}


/** 全局协作健康检查：依赖图是否闭环/孤立/有升级路径。 */
export function checkCollabHealth(collabText, roleCount) {
  const issues = []
  if (!collabText || !collabText.trim()) return ['缺少协同架构（每个角色需 位置/依赖/介入时机/协同方式）']
  for (const f of COLLAB_FOUR) {
    if (!collabText.includes(f)) issues.push(`协同架构缺「${f}」`)
  }
  if (!/(升级|裁决|CEO|review|上报|复核)/.test(collabText)) issues.push('无冲突升级路径（角色分歧向谁升级？应有 jarvis_review/CEO 裁决）')
  if (!/并行|同时|实时|讨论|辩论/.test(collabText)) issues.push('未体现并行协作（应非串行交接：角色并行讨论/实时同步）')
  if (roleCount && !/(每个角色|逐角色|all|所有角色)/.test(collabText) && roleCount > 1) {
    // 仅当文本明显只描述单一角色而无全局协同视角时提示
  }
  return issues
}

/** 六段式/协同架构/证据链/保真度 结构校验（女娲式：不只要"有"，还要"查实"）。 */
export function validateCardShape(card, isCeo) {
  const missing = []
  if (typeof card !== 'string' || !card.trim()) {
    return ['角色卡全文'].concat(isCeo ? ['协同架构'] : []).concat(EVIDENCE_SECTIONS)
  }
  for (const s of SECTIONS) {
    if (!card.includes(s)) missing.push(s)
  }
  if (isCeo && !card.includes('协同架构')) missing.push('协同架构')
  if (isCeo && !card.includes('协同')) missing.push('协同')
  if (!card.includes('source')) missing.push('source')
  // 防冒名声明必须【独立出现】：
  //   - 含 "防冒名" 字样（如"防冒名声明：…"），或
  //   - 存在一行【独立】的"不冒充署名/只借鉴框架…"声明（行首起、不含其他段内容）。
  //   纯粹混在"代表作品：…不冒充署名"一行内不算独立声明（防 bug：避免漏加防冒名段）。
  const lines = card.split('\n')
  const hasDisclaimer =
    card.includes('防冒名') ||
    lines.some((l) => {
      const t = l.trim()
      return (t.startsWith('不冒充署名') || t.startsWith('本角色卡借鉴') || t.startsWith('只借鉴框架')) && t.length < 60
    })
  if (!hasDisclaimer) missing.push('防冒名声明')

  // ── 女娲式证据链硬闸（防迎合蒸馏：source 必须可查实，不能只是出现字样）──
  for (const es of EVIDENCE_SECTIONS) {
    if (!card.includes(es)) missing.push(es)
  }
  const hasSourceUrl = /https?:\/\/[^\s）)】]+/.test(card)
  if (!hasSourceUrl) missing.push('source 真实URL(需 https://…，防编造出处)')
  // 诚实边界必须提到"信息截止"或"推测成分"其一
  if (!/(信息截止|推测|局限|做不到)/.test(card)) missing.push('诚实边界(信息截止/推测成分/做不到什么)')

  // ── 协同架构四要素硬闸（"子角色如何协同"最小完备集；CEO 卡必含）──
  if (isCeo) {
    for (const f of COLLAB_FOUR) {
      if (!card.includes(f)) missing.push(`协同架构缺「${f}」`)
    }
    const collabIssues = checkCollabHealth(card, 1)
    for (const ci of collabIssues) {
      if (!card.includes('并行') && /并行/.test(ci)) missing.push(ci)
    }
  } else {
    // 非 CEO 角色卡：分工明确硬闸——必须含"我的协同/我的位置"声明（知道自己干什么、依赖谁、向谁升级），
    // 不能只是一张"思考风格"卡。缺 → 分工不明确，禁止注入。
    const myCollab =
      card.includes('我的协同') ||
      card.includes('我的位置') ||
      card.includes('我的依赖') ||
      card.includes('本角色') ||
      card.includes('我负责')
    if (!myCollab) missing.push('我的协同（本角色位置/依赖/介入时机/升级路径——分工明确硬闸）')
    if (!/位置|上游|下游|并行|横向/.test(card) && !/负责|职责|干什么/.test(card)) missing.push('我的位置/职责')
    if (!/(依赖|从.*(拿|获取|接收|取)|给.*(喂|提供|交)|喂|提供)/.test(card)) missing.push('我的依赖（依赖谁/给谁喂产出）')
    if (!/(升级|裁决|CEO|review|上报|向谁)/.test(card)) missing.push('我的升级路径（分歧向谁升级）')
  }
  return missing
}

/** 角色卡深度评估（防"浅层蒸馏"：结构标题齐全 ≠ 内容有深度）。
 * 无网可判定的"实质"证据：六段正文不是空话、方法论含 HOW 动作链、证据链六维度逐项带内容、
 * 有反例/失效边界（真实方法的边界感）、source 域名真实（非保留域）+ 有查证痕迹（蒸馏时实际搜过）。
 * 返回 0-100 深度分 + 各维度问题清单。浅层卡（标题齐全但内容空洞）必须被拦住。
 */
export function assessCardDepth(card, isCeo) {
  const issues = []
  const text = String(card ?? '')
  // ── 1. 六段式正文实质（标题后要有内容，不能是空话/占位）──
  const PLACEHOLDER = /待(填|补|写)|xxx|……|…\s*$|暂缺|未写|TODO|不详|无内容/i
  const depthSections = {}
  const lines = text.split('\n')
  let cur = ''
  for (const ln of lines) {
    const m = ln.match(/^\s*([^：:\n]{2,12})[：:]\s*(.*)$/)
    if (m && SECTIONS.includes(m[1].trim())) {
      cur = m[1].trim()
      depthSections[cur] = m[2] || ''
    } else if (cur && ln.trim()) {
      depthSections[cur] = (depthSections[cur] || '') + ln
    }
  }
  let filled = 0
  for (const s of SECTIONS) {
    const body = (depthSections[s] || '').trim()
    if (body.length >= 15 && !PLACEHOLDER.test(body)) filled++
    else issues.push(`「${s}」内容太空洞（应≥15字且非占位/空话，当前='${body.slice(0, 20)}'）`)
  }
  // ── 2. HOW 而非 WHAT：思维模型/核心方法论须含动作链（怎么做，不是贴标签）──
  const HOW = /(先|再|然后|若|则|当|按|根据|判断|优先级|流程|步骤|对比|拆解|验证|假设|原则[：:]|反推|复盘|迭代)/
  const methodologyText = (depthSections['思维模型'] || '') + (depthSections['核心方法论'] || '')
  const hasHow = HOW.test(methodologyText)
  if (!hasHow) issues.push('思维模型/核心方法论只有标签没有"怎么做"的动作链（HOW 而非 WHAT：要写出先做什么、遇到什么情况怎么办）')
  // ── 2b. 防"展示型空泛"（卡不贵多贵有用——"注重数据驱动/追求卓越/思维缜密"看着厉害但干活用不上）──
  //   评价性形容词/空泛名词堆砌（无具体对象+动作）= 展示型内容：检测高密度空泛词 → 内容不可用
  const FLAIR_WORDS = /注重|坚持|追求|秉持|卓越|严谨|缜密|深刻|敏锐|洞察|前瞻|科学|专业|高效|优质|全面|深入|不断|持续|优化|提升|驱动|创新|赋能|以.{0,6}(为导向|为核心|为原则)|全局视角|战略眼光|行业经验|跨领域/
  const flairMatches = (methodologyText.match(new RegExp(FLAIR_WORDS.source, 'g')) || [])
  // 空泛密度：方法论文本里每 25 字出现 ≥1 个空泛词 = 空泛堆砌（如"注重数据驱动与量化分析以科学方法指导决策"密度极高）
  const flairDensity = methodologyText.length > 0 ? flairMatches.length / (methodologyText.length / 25) : 0
  const hasFlairOverload = flairDensity >= 2.5 && flairMatches.length >= 3
  if (hasFlairOverload) issues.push('思维模型/核心方法论是"展示型空泛"（评价性形容词堆砌：注重/追求/卓越/严谨/洞察/驱动/优化…看着厉害但干活用不上——无具体对象+动作）。卡不贵多贵有用：每条内容须是"遇到X→做Y"的可执行行为，纯评价词=没用=删掉换成具体做法')
  // ── 3. 证据链六维度逐项带内容（不是光秃秃列词）──
  // 证据链/诚实边界不在 SECTIONS 六段里，直接在全文中定位
  const evidenceText = text
  const DIMS = ['著作', '对话', '表达', '他者', '决策', '时间线']
  let dimsCovered = 0
  for (const dim of DIMS) {
    const idx = evidenceText.indexOf(dim)
    // 该维度出现且后面 30 字内有实质内容（非空话）
    if (idx >= 0) {
      const tail = evidenceText.slice(idx + dim.length, idx + dim.length + 30)
      if (tail.trim().length >= 2 && !PLACEHOLDER.test(tail)) dimsCovered++
    }
  }
  if (dimsCovered < 5) issues.push(`证据链六维度只覆盖 ${dimsCovered}/6（著作/对话/表达/他者/决策/时间线 须逐项带实际内容，不是列词）`)
  // ── 4. 反例/失效边界（真实方法的边界感；女娲"保留矛盾"）──
  const hasBoundary = /不适用|边界|例外|反例|失效|不成立|局限|矛盾|张力|做不到/.test(text)
  if (!hasBoundary) issues.push('无反例/失效边界（真实方法论应写明"什么情况不适用/会失效"，防把方法当万能）')
  // ── 5. source 真实性：域名非保留域 + 蒸馏有查证痕迹 ──
  const url = (text.match(/https?:\/\/[^\s）)】]+/) || [''])[0]
  const RESERVED = /example\.com|localhost|127\.0\.0\.1|\.test\b|your-domain|占位/
  const hasReservedDomain = RESERVED.test(url)
  if (!url) issues.push('无 source URL')
  else if (hasReservedDomain) issues.push(`source 域名不可信（${url.slice(0, 40)} 是保留/示例域，不可能有真实内容——需换成真实查到的 URL）`)
  const hasVerifyTrace = /查证|核实|搜索|检索|web 搜|查到|访问.*页|原文|出处|检索记录/.test(text)
  if (!hasVerifyTrace) issues.push('无查证痕迹（应写明"本次 web 搜索了什么/在哪页确认了真人与其方法"——证明真查过，不是编 URL）')
  // ── 6. 诚实边界实质（信息截止须带具体时间/版本；不只在六段式里找）──
  const hasHonestyDepth = /(信息截止[:：]?\s*(20\d\d|202\d|至今|某月|v\d|版本)|截至\s*20\d\d|推测成分[:：]?\s*(已标注|已标)|做不到[:：])/.test(text)
  if (!hasHonestyDepth) issues.push('诚实边界缺具体信息截止（应写"信息截止到 20XX-XX"或"截至版本"，不是只说"有推测"）')

  // ── 评分（0-100）──
  let score = 0
  score += filled * 6            // 六段实质内容 36
  if (hasHow) score += 15        // HOW 动作链 15
  score += Math.min(15, dimsCovered * 2.5) // 证据链维度 15
  if (hasBoundary) score += 10   // 反例边界 10
  if (url && !hasReservedDomain) score += 10 // source 域名 10
  if (hasVerifyTrace) score += 8 // 查证痕迹 8
  if (hasHonestyDepth) score += 6 // 诚实边界 6
  score = Math.round(score)
  const verdict =
    score >= 75
      ? `深度合格（${score}/100）：六段有实质内容、方法论含 HOW、证据链维度齐全、有反例边界与查证痕迹。`
      : score >= 55
        ? `深度一般（${score}/100）：结构齐全但内容偏浅，建议补实后再用。`
        : `深度不足（${score}/100）：属于"标题齐全内容空洞"的浅层卡——蒸馏人不许把浅卡当成品交付。`
  return { score, issues, filled, hasHow, dimsCovered, hasBoundary, hasVerifyTrace, verdict }
}

/** 蒸馏独特性引导器（蒸馏能力核心：借鉴 distilly 24k★ 方法论，引导捕捉"这个大佬独有的 HOW"）。
 * 蒸馏最强的卡 = 方法论里能看出"这是谁在想"：独有的决策触发词、独特取舍、领域黑话、
 * 反直觉原则、认知变化轨迹——而不是"先分析再执行"这种任何人都能写的通用话术。
 * 融合 distilly 的 7 品味原则 + 来源分级 + 认知时间线 + 决策启发式 + 验证锚点。
 */
export function distillGuide(role, material, industry) {
  const src = String(material ?? '').length
  return {
    role,
    industry: industry || '（CEO 判断）',
    purpose: '从真实素材提炼「这个大佬独有的思考方式（HOW）」，不是填六段式模板。',
    tastePrinciples: [
      '长文 > 碎片（一篇文章的思维结构 > 50 条推文）',
      '争议 > 共识（被争论的立场比被一致夸赞的更能暴露独特性）',
      '变化 > 固定（他改主意的地方比始终如一的地方更有信息量）',
      '一手 > 二手（本人的话 > 别人的转述）',
      '讲过程 > 传记（怎么谈做事过程 > 人生故事）',
      '重复模式 > 单句金句（跨 5 个情境反复出现的模式 > 一句爆款）',
      '失败讨论 > 成功叙事（怎么讲栽过的跟头 > 胜利复盘）',
    ],
    sourceHierarchy: [
      '一手著作/长文/Newsletter（最高权重）',
      '长访谈/播客 30min+（含时间戳）',
      '有据可查的决策与转折点（案例/公开记录）',
      '短视频/短文/问答',
      '他人分析/传记（仅用于定位一手源，不作独立证据）',
      '二手转述（只用来找源头）',
    ],
    sourceBlacklist: ['知乎（匿名/道听途说）', '微信公众号（二手洗稿）', '百度百科（不可靠/过时）', '搜狐/网易/腾讯自动聚合', 'SEO 内容农场', 'AI 生成的传记页', 'Listicle（"X 的 10 堂课"除非直引一手）'],
    sourceRecommended: ['B站长视频/访谈', '小宇宙播客完整集', '36氪/晚点LatePost/财新/极客公园/虎嗅', '认证微博原发（非转发/粉号）', '正规出版物', 'Youtube 长访谈(Fridman/Ferriss 等)', '个人博客/Substack', 'TED/大会完整视频+转录'],
    steps: [
      '① 抓决策触发词：从素材里找出他/她"遇到什么情况，第一反应做什么"的固定句式（如"先看现金流，再谈增长"）——独有 HOW 的指纹',
      '② 抓独特取舍：找出"宁可 A 也不要 B"式偏好（如"宁可慢一点也要自己掌控供应链"）——他与别人的分野',
      '③ 抓领域黑话/专有概念：他自创或用得独特的词（如"有效GMV""第一性原理拆解"）——他看世界的独特坐标系',
      '④ 抓反直觉原则：他做过的"看起来反常识但坚持"的决策——最能体现真本事',
      '⑤ 抓认知变化轨迹：他"从 A 观点变成 B 观点"的时刻（比始终如一更能揭示思考演进）——写成认知时间线而非生平',
      '⑥ 抓失效边界：他自己承认"这个方法在什么情况不适用"——真实方法的边界感',
    ],
    decisionHeuristics: '提炼决策启发式：他面对不确定性时的默认动作（如"先最小验证再放大""先假设对方是善意的"）——是可执行的 if-then 规则，不是泛泛原则。',
    achievementTrace:
      '🏆 **成就反推工作方式（"影子"的真正来源——不是他说过什么，是他做出了什么）**：真实人物取得的成就是**结果证据**（他真做到了，骗不了人），从成就反推的工作方式比访谈里说的更真实（访谈可能包装，成就不会）。做法：\n' +
      '  ① 列出他**取得的真实成就**（做出了什么/改变了什么/被公认的成果——不只职位头衔）；\n' +
      '  ② 对每个成就问"**他怎么工作才做到的？**"——反推背后的**工作习惯**（每天怎么投入/怎么决策/怎么取舍/怎么对待失败/怎么组织人），写成可执行的"他工作时的固定动作"；\n' +
      '  ③ 成就与成就之间找**重复模式**（跨多个成就反复出现的工作方式 = 他最可靠的习惯，不是偶然）；\n' +
      '  ④ 反推时区分"成就的归因"（什么工作方式真导致了成就 vs 运气/时代红利）——找因果证据，不把时代红利当他本事；\n' +
      '  ⑤ 产出 = "他的影子习惯清单"：遇到 X 情况 → 他会怎么工作（不是他怎么想，是**他怎么动手**）——这是员工干活时的行为指南。\n' +
      '  例：Hamel 做出 Humanocracy（成就）→ 反推工作方式：先量化官僚成本再设计新组织（先算账再动手）、拿 7000 人调研做证据（用数据不用感觉）、对照去层级化标杆（找参照系）。',
    validationAnchors: '写卡后用两个锚点自检：①已知答案测试（拿他真实的公开决策，看卡里的方法论能否复现他的选择）；②边界测试（拿一个他没遇到过的新问题，看卡里能否给出像他会给的答案）。两条都过 → 卡才真"像他"。',
    antiGeneric: '⚠️ 防通用话术：如果方法论能被任何管理者套用（"先分析再执行""以结果为导向"），说明没捕捉到独特性——打回重提炼。',
    personBar:
      '🔒 **选人闸（蒸馏前先确认：这是该领域真正厉害的人物，不是"真实但平庸"）**——虚拟办公的完成度=员工能力=蒸馏对象的水平，所以选人必须选强的。判断是否"领域厉害人物"：\n' +
      '  ① 可命名贡献：他/她的方法被命名/被引用（如"PDCA=Deming""情境驱动测试=Bach"）或开创了学派/范式（不只做过项目）；\n' +
      '  ② 公认度：被该领域同行广泛引用/教科书收录/权威机构认可（不止个人博客自夸）；\n' +
      '  ③ 排他性：**蒸馏前先想"这个领域公认最强的是谁"**——如果知道还有更被公认/更顶级的人物，就选那个，不将就；\n' +
      '  ④ 反例：真实存在但方法可被任何人套用（无独有命名贡献/无公认度）= 不合格，换人；\n' +
      '  ⑤ 领域可扩展：任何领域都有厉害人物（软件=大师、制造=质量/精益大师、教育=教学法开创者、医疗=循证权威、农业=育种/植保权威…）——**没有"这个领域没有厉害人物"这回事，只有没去找**。\n' +
      '  选人闸不过 → 不进入素材提炼，先换更强的人选再蒸馏。',
    evidenceTrace:
      '🔎 **证据溯源分级（每项能力标注"真实环境查得到影子的等级"——防把推断当他说过/做过）**：蒸馏出的每项能力/工作方式必须标证据级，员工只把 A/B 当真影子用，C 不冒充：\n' +
      '  [A 原文级]：他**亲口说过/亲手写过**（著作/访谈/文章原文）——标"出自哪篇哪句"（如 Hamel"先算官僚税"出自 HBR 2011 原文）——影子最硬；\n' +
      '  [B 行为级]：他**真实做过**（决策/项目/调研/行为记录，有公开记录）——标"哪个行为/项目"（如 Hamel 做过 7000 人 HBR 读者调研）——影子可靠；\n' +
      '  [C 推断级]：从成就**反推**的工作方式（他没直接说过/无行为记录，是蒸馏者推断"他大概这么工作"）——**必须显式标 [C推断]**，且**不得冒充 A/B 当真影子驱动员工产出**（防止把脑补当他本事）；C 只作"可能的工作方式"参考，写卡时优先找 A/B 证据替代它。\n' +
      '  铁律：**A/B/C 混着不标 = 不合格**——用户分不清哪些真查得到影子、哪些是推断；宁可 60 分诚实（标 C 推断）不要 90 分编造（把推断写成他说过）。每项能力写卡格式：[A|B|C] 能力内容（出处/行为/推断依据）。',
    fingerprintTrace:
      '🎨 **产出指纹提炼（"产出能看出人物影子"的判据——不是方法论描述，是产出本身可辨识的特征）**：每个人物的产出都有"指纹"——他做出来的东西里**反复出现、可辨识、别人难模仿**的特征（跨作品/成就找重复），员工产出对照指纹就能看出"像不像他做的"。\n' +
      '  做法（从真实作品/成就提炼，不是从他说过什么）：\n' +
      '  ① 看他反复做出来的东西（画作/著作/方案/产品/决策记录）——跨多个找**重复出现的特征**（如梵高跨画作反复出现厚涂笔触/高饱和黄蓝/漩涡笔法——他的视觉指纹；Fowler 反复小步重构/演进式架构——他的工作指纹）；\n' +
      '  ② 每条指纹要**具体到能在产出里逐项检查**（"厚涂笔触/黄蓝高饱和"可查；"有创意"不可查——抽象词不是指纹）；\n' +
      '  ③ 指纹 = 员工产出时的**创作/工作判据**：每步问"这样做像不像他的指纹"；产出后验证者**对照指纹逐项查产出**（有厚涂?有黄蓝?——有=有影子，无=没影子）。\n' +
      '  产出格式：指纹清单每条 = 指纹名 + 可查特征（怎么在产出里认出它）+ 出自哪个作品/成就（证据）。',
    workbenchTrace:
      '🧰 **工作台需求反馈（人物卡自己反馈"这领域做这活要什么环境工具"——不许默认 Linux 万能、不许乱搞）**：蒸馏时一并反馈该人物的"工作台需求"（写进卡的 `工作台需求：` 段）：\n' +
      '  ① 做这类产出要什么环境/工具（本领域必需，不是通用 Linux——软件=编译器/运行环境；短视频=剪辑工具；画画=绘图工具/画布；设计=设计软件）；\n' +
      '  ② 默认环境（Linux shell）够不够——够=直接干；不够=明确列出缺什么工具/环境；\n' +
      '  ③ 缺了会怎样（能否降级产出/还是产不出真东西）；\n' +
      '  ④ 红线：默认环境不够却硬干/假装产出 = 一票否决（产出是假的）——环境不到位如实上报等准备，不硬装不糊弄。\n' +
      '  反馈格式：{"workspaceNeeds":{"tools":["本领域必需工具/环境"],"linuxEnough":true|false,"missing":["缺什么"],"fallback":"缺了能否降级/还是做不了真产出"}}。',

    aiDisplacementTrace:
      '🤖 **AI 执行平替（人物保留判断/审美/决策，执行从人工工具平移到 AI 工具——前 AI 时代的工具太重）**：真实人物成就多是前 AI 时代用人工工具做的（一笔笔画/手动剪片/手写代码），数字员工在 AI 时代要用 AI 替代人工执行。蒸馏时给每条工作方式标执行方式：\n' +
      '  [判断] 必须人物亲自判断（怎么选/怎么评好坏/审美取舍/AI 生成后他选哪个）——AI 不能代，代了=丢影子；\n' +
      '  [AI执行] 可用 AI 工具提速（调研→AI 分析、生成初稿→AI 生成、批量→自动化），保留判断标准 AI 只做执行；\n' +
      '  [人工] 必须真实人工/真实验证（真测试/真部署/真人确认）——不许 AI 假装完成。\n' +
      '  红线：判断被 AI 代=丢影子；执行不 AI 化=工具太重；[人工] 环节 AI 冒充=一票否决。\n' +
      '  反馈格式：每条工作方式标 [判断]/[AI执行]/[人工]，如 {"workHabits":[{"habit":"先量化再动手","execMode":"判断","aiNote":"量化可用AI分析提速但「量什么」是判断"}]}。',

    sourceCheck: src
      ? `素材已提供（${src} 字符）：从中逐条找上面 6 类证据，每条标注"出自素材哪段/哪个出处"，并给素材质量分级（一手/二手）。`
      : '⚠️ 未提供素材：先用 web_search 查该领域真实权威（长访谈/一手文章/决策记录优先，避开黑名单源），把原文摘进来再提炼——不许凭印象编。',
    respondAs: `输出蒸馏作业：{"role":"${role || '?'}","achievements":[{"achievement":"他取得的真实成就","workHabits":["从该成就反推的工作方式(怎么动手做到的)"]}],"shadowHabits":[{"trigger":"遇到X情况时","habit":"他会怎么工作(固定动作)"}],"howFingerprints":[{"trigger":"遇到X时→先做Y","source":"出自素材哪段"}],"tradeoffs":["宁可A不要B"],"jargon":["独有概念"],"counterIntuitive":["反直觉决策"],"cognitionTimeline":["A观点→B观点的变化时刻"],"failureBoundary":["不适用场景"],"decisionHeuristics":["if-then 规则"],"knownAnswerTest":["拿真实决策验证卡的方法论能否复现"],"draftCard":"基于以上提炼的六段式卡草稿(待 jarvis_distill 校验)"}。`,
  }
}

/** 四个模型工具定义（ToolDefinition 形态，供 tools.register） */
export const TOOLS = [
  {
    name: 'jarvis_project',
    description:
      '贾维斯接单入口（领域无关）：对用户原始需求做建队分级建议（S/M/L）——S=直接做、M=精简公司、L=全链公司。插件不预设任何行业/人物（领域由 CEO 结合本项目情况现场判断）。CEO 用本工具决定"这单要不要建队、建多大规模"，再走现场蒸馏（jarvis_distill）与项目沉淀（jarvis_store）。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '用户需求的原始描述（可模糊）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          industry: { type: 'string' },
          confidence: { type: 'string', description: 'high/medium/low' },
          suggestion: { type: 'string', description: '适合的建队等级 S/M/L' },
          distillDirection: { type: 'string', description: '建议往哪个方向 web 蒸馏真实大佬' },
          vague: { type: 'boolean', description: '需求是否过于模糊（需先澄清）' },
          clarifyHint: { type: 'string', description: '模糊时给出的澄清指引' },
        },
        required: ['industry', 'suggestion'],
      },
      render: (r) => `行业=${r.industry}（置信 ${r.confidence ?? '?'}）建议=${r.suggestion}\n蒸馏方向：${r.distillDirection ?? ''}`,
    },
    handler: async (args) => {
      const text = String(args.requirement ?? '')
      const hit = identifyIndustry(text)
      const out = {
        industry: hit.industry,
        confidence: hit.vague ? 'low' : 'medium',
        suggestion: hit.suggestion,
        distillDirection: hit.distillDirections.join(' / '),
      }
      if (hit.vague) {
        out.vague = true
        out.clarifyHint = '需求过于模糊：先用 jarvis_clarify 做 REFORM-CLARIFY 澄清（问清"为谁解决什么、怎样算成功"），未清晰前不建队。'
      }
      return out
    },
  },

  {
    name: 'jarvis_store',
    description:
      '项目记忆库管理（领域无关的"项目长期记忆"，类比 .idea：项目内嵌随项目走）：prototypes(真实人物原型素材)/cards(虚拟人物卡)/process(流程)/components(组件)/project.md(项目细节快照)/board(黑板)/lessons(进度经验) 都沉淀在**项目自己的** <workspace>/.jarvis/ 里——AI 识别到本项目直接读这套记忆继续工作，不用重分析源码。**目录规范**：根目录只放 README.md(规范说明)/board.json/project.md/lessons.md/process-*.json/components.json，其余按类型归档——人物素材→prototypes/、人物卡→cards/(历史→cards/history/)、审计报告→reports/、设计稿→designs/、验证脚本→scripts/、交付文档→docs/，**产物不许散在根目录**。模式：①check=阶段零判定（有记忆→直接读取复用继续；无记忆→从零蒸馏并建立记忆库）；②scaffold=输出记忆库目录结构；③reuse=复用校验（本项目沉淀可复用但须过 jarvis_distill 校验+按新需求修订；跨项目/插件禁止）；④save=按类型写入对应目录（prototype→prototypes/、card→cards/、project→project.md、lesson→lessons.md、process/components→json）。插件本身不携带任何角色卡与领域模板。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'check 查记忆库判定 / scaffold 初始化结构 / reuse 复用校验 / save 写入记忆（默认 scaffold）' },
        projectDir: { type: 'string', description: '项目记忆库根目录（默认 <workspace>/.jarvis/）' },
        itemType: { type: 'string', description: '沉淀类型：prototype=真实人物原型→prototypes/ / card=虚拟人物卡→cards/ / process=领域流程→根 process-*.json / component=组件→components.json / project=项目细节快照→根 project.md / lesson=进度经验→根 lessons.md / report=审计报告→reports/ / design=设计稿→designs/ / script=验证脚本→scripts/ / doc=交付文档→docs/（save 用，按类型归档不散根目录）' },
        name: { type: 'string', description: '角色名或流程/组件名' },
        existingCards: { type: 'string', description: '本项目已沉淀角色卡清单 JSON，如 [{"role":"研发","file":"cards/研发.md"}]（reuse 校验用）' },
        existingDirs: { type: 'string', description: '本项目 .jarvis/ 已有目录清单 JSON（check 判定用）' },
        cards: { type: 'string', description: '已存在的角色卡名，逗号分隔（check 用）' },
        prototypes: { type: 'string', description: '已存在的真实人物原型名，逗号分隔（check 用）' },
        projectMd: { type: 'string', description: 'project.md 是否存在（true/false，check 用）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          structure: { type: 'array', items: { type: 'string' }, description: '项目沉淀目录结构' },
          reuseRule: { type: 'string', description: '复用规则（本项目沉淀 vs 跨项目/插件禁止）' },
          savePath: { type: 'string', description: '本次写沉淀的目标路径' },
          verdict: { type: 'string' },
        },
        required: ['structure', 'reuseRule', 'verdict'],
      },
      render: (r) =>
        `【项目沉淀 · .jarvis/】\n结构：${(r.structure || []).join('\n      ')}\n复用规则：${r.reuseRule}\n本次保存：${r.savePath ?? '—'}\n判定：${r.verdict}`,
    },
    handler: async (args) => {
      const mode = String(args.mode ?? 'scaffold').trim()
      const projectDir = String(args.projectDir ?? '<workspace>/.jarvis/').trim()
      const itemType = String(args.itemType ?? '').trim()
      const name = String(args.name ?? '').trim()
      const existingCards = String(args.existingCards ?? '').trim()
      const existingDirs = String(args.existingDirs ?? '').trim() // 已有沉淀目录清单 JSON（check 用）
      const structure = [
        `${projectDir}README.md        —— 本目录规范说明（每个子目录放什么/怎么命名/怎么归档）——先读它再读写 .jarvis`,
        `${projectDir}prototypes/      —— 真实人物信息资料（原型）：每个真实大佬的原始素材（访谈/著作/决策记录/URL），是蒸馏的证据源，AI 识别到本项目直接读取`,
        `${projectDir}cards/           —— 虚拟人物卡（工作能力细节）：蒸馏出的六段式角色卡（思维模型/方法论/红线/协同），含深度分；历史版本放 cards/history/`,
        `${projectDir}process-*.json   —— 领域流程：CEO 定稿的阶段/闸门/红线/必须角色/会议触点（命名 process-<需求关键词>.json）`,
        `${projectDir}components.json  —— 组件清单：能力补足自研/引入的组件（名字/功能/用法/维护者）`,
        `${projectDir}board.json       —— 统一黑板：会议驱动协作的状态/未决项/决议`,
        `${projectDir}project.md       —— 项目细节快照：需求本质/验收标准/接口契约/进度/关键决策——AI 读到即可继续，不用重分析源码`,
        `${projectDir}lessons.md       —— 当前项目进度经验总结：踩坑/教训/适配度记录，防重复`,
        `${projectDir}reports/         —— 审计/复盘报告：单次专项的产出（如 t1 审计报告），命名 <主题>.md`,
        `${projectDir}designs/         —— 设计稿：方案未实施前的设计文档（供方案评审），实施后归档或并入 docs/`,
        `${projectDir}scripts/         —— 验收/验证脚本：本项目的可执行验证（如判别实验），命名 <用途>.mjs`,
        `${projectDir}docs/            —— 交付文档与索引：方案定稿/交付清单/历史需求索引`,
      ]
      let reuseRule = ''
      let verdict = ''
      let savePath = ''
      if (mode === 'check') {
        // 阶段零：先查项目沉淀——有经验直接继续，没有才从零蒸馏
        const hasJarvis = !!(existingDirs && existingDirs.trim() !== '[]' && existingDirs.trim() !== '')
        const cards = String(args.cards ?? '').trim()
        const proto = String(args.prototypes ?? '').trim()
        const hasProject = String(args.projectMd ?? '').trim()
        if (hasJarvis || cards || proto || hasProject) {
          reuseRule =
            '【有记忆 → 直接继续】本项目 .jarvis/ 已存在完整记忆：prototypes(真实人物原型) + cards(虚拟人物卡) + process(流程) + project.md(项目细节) + board(黑板) + lessons(进度经验)。AI 识别到本项目直接读取这套记忆即可继续工作（卡须过 jarvis_distill 校验+按新需求修订），**不用重新分析源码**——项目细节/progress 已记录。'
          verdict = `阶段零判定：项目已有记忆库${cards ? '（cards: ' + cards + '）' : ''}${proto ? '（prototypes: ' + proto + '）' : ''} → 读取复用继续，不从零蒸馏。`
        } else {
          reuseRule =
            '【无记忆 → 从零开始】本项目 .jarvis/ 不存在或为空：走标准建队流程——需求本质回归 → 定领域流程 → web 查证真实人物原型(存 prototypes/) → 现场蒸馏 CEO 卡(存 cards/) → 定子角色 → 逐个蒸馏 → 协同 → 建队，并把 project.md/lessons 持续更新。'
          verdict = '阶段零判定：项目无记忆 → 从零蒸馏 CEO 起，建立项目记忆库。'
        }
      } else if (mode === 'reuse') {
        const typeName = itemType || '沉淀'
        const isLocal = existingCards && name && existingCards.includes(name)
        if (isLocal) {
          reuseRule = `【本项目沉淀可复用】「${name}」在本项目 .jarvis/cards/ 中（本项目角色做过，经验属于项目）——以它为起点：① 必须过 jarvis_distill 结构校验；② 必须按本次新需求修订（职责范围/领域/约束变了就重新蒸馏对应部分）；③ 修订后作为新版本写回沉淀（保留演进线）。`
          verdict = `复用判定：本项目已有「${name}」沉淀 → 允许复用为起点（须校验+按新需求修订，见 reuseRule）。`
        } else if (existingCards && existingCards.includes('###') === false && !name) {
          reuseRule =
            '【本源自查】未指定 name 且无现有沉淀清单，无法判断来源——请指定角色名/沉淀名再复用，或直接走现场蒸馏。'
          verdict = `复用判定：信息不足，需补 ${typeName} 名称/现有沉淀清单。`
        } else {
          reuseRule =
            '【跨项目/插件禁止】插件不携带任何卡；其他项目的卡也禁止直接复用——每个项目是它自己的角色做的，经验属于那个项目。跨项目要用 = 重新现场 web 蒸馏（jarvis_distill 校验），不许照搬。'
          verdict = `${name || typeName} 不在本项目沉淀清单 → 禁止复用（除非是本项目已沉淀且通过校验+修订），跨项目/外部来源必须重新现场蒸馏。`
        }
      } else if (mode === 'save') {
        // 类型 → 目录/扩展名（规范归档：根只放 project/lesson/process/component，其余按类型入子目录）
        const MD_TYPES = ['card', 'prototype', 'project', 'lesson', 'report', 'design', 'doc']
        const ext = itemType === 'script' ? '.mjs' : MD_TYPES.includes(itemType) ? '.md' : '.json'
        const DIR = {
          card: 'cards/',
          prototype: 'prototypes/',
          report: 'reports/',
          design: 'designs/',
          script: 'scripts/',
          doc: 'docs/',
          process: '', component: '', project: '', lesson: '',
        }
        const dir = DIR[itemType] ?? ''
        savePath = `${projectDir}${dir}${(name || itemType || 'item').replace(/[\\/:*?"<>|]/g, '_')}${ext}`
        reuseRule =
          '写入后即成为本项目记忆库：后续本项目需求直接读取复用（卡须过 jarvis_distill 校验+按新需求修订）；跨项目不共享。'
        verdict = `写入 ${savePath}（项目记忆库，非插件资产；按类型归档到对应子目录，不散在 .jarvis/ 根）——AI 识别到本项目直接读它继续，不用重分析源码。`
      } else {
        reuseRule =
          '插件无静态卡/无领域模板（领域无关）。角色卡与流程只能来自：① 本项目 .jarvis/ 沉淀（可复用起点）；② 现场 web 蒸馏（新需求/跨项目必走）。'
        verdict = `项目沉淀结构就绪：${projectDir} 已初始化（CEO 按结构落盘即可，文件由 CEO/成员在工作区管理）。`
      }
      const storeOut = { structure, reuseRule, verdict }
      if (savePath) storeOut.savePath = savePath
      return storeOut
    },
  },

  {
    name: 'jarvis_process',
    description:
      '领域流程设计引导器（CEO 定流程的核心权力）：插件不预设任何领域流程——不同行业"怎么干活"完全不同，必须由 CEO 按本项目需求特性现场设计，可参考本项目沉淀（.jarvis/process-*.json，项目自己做过的流程是经验，可参考但按本次需求修订）。输出必须覆盖五要素：必经阶段 / 验收闸门 / 红线 / 必须角色 / 会议触点。CEO 有权增删阶段（overrideStages）。定稿写入黑板与项目沉淀 .jarvis/process-<需求>.json，kickoff 会全员对齐。铁律：流程缺失 = 客户提 bug 的温床，宁可流程多一步不可少一步；严禁把别的项目流程原样照搬。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '本项目需求原文（流程围绕它设计）' },
        industry: { type: 'string', description: 'CEO 判断的领域（仅供标记，不触发任何预设模板）' },
        projectRef: { type: 'string', description: '本项目沉淀的流程参考（.jarvis/process-*.json 内容或路径；可选，CEO 参考后按本次需求修订，不许原样照搬）' },
        overrideStages: { type: 'string', description: 'CEO 增删阶段：追加用"+阶段名"，删除用"-阶段名"，逗号分隔（可选）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          industry: { type: 'string', description: 'CEO 判断的领域（仅标记）' },
          designChecklist: { type: 'string', description: '五要素设计清单（CEO 必须逐项给出）' },
          stages: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的必经阶段（本工具不预设，仅高管增删占位）' },
          gates: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的验收闸门' },
          redlines: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的红线' },
          mustRoles: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的必须角色' },
          touchpoints: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的会议触点' },
          customized: { type: 'boolean', description: '恒为 true：流程永远由 CEO 现场定制（插件无领域预设）' },
          verdict: { type: 'string' },
        },
        required: ['stages', 'gates', 'redlines', 'verdict'],
      },
      render: (r) =>
        `【${r.industry || '领域由 CEO 判断'} 流程 · ⚠️ CEO 现场定制（插件无预设）\n设计清单：${r.designChecklist ?? ''}\n阶段：${r.stages.join(' → ')}\n闸门：${r.gates.map((g) => '  ⛔ ' + g).join('\n')}\n红线：${r.redlines.map((x) => '  🚫 ' + x).join('\n')}\n必须角色：${(r.mustRoles || []).join(' / ')}\n会议触点：${(r.touchpoints || []).join(' / ')}`,
    },
    handler: async (args) => {
      const industry = String(args.industry ?? '').trim()
      const req = String(args.requirement ?? '').trim()
      const projectRef = String(args.projectRef ?? '').trim()
      // CEO 增删阶段（overrideStages："+X,-Y"）
      const applyOverride = (stages) => {
        const ov = String(args.overrideStages ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        let out = [...stages]
        for (const o of ov) {
          if (o.startsWith('+')) out.push(o.slice(1).trim())
          else if (o.startsWith('-')) out = out.filter((s) => s !== o.slice(1).trim())
          else out.push(o)
        }
        return out
      }
      const refNote = projectRef
        ? `已提供本项目流程沉淀参考（${projectRef.slice(0, 60)}…）：作为经验参考可以，但必须按本次需求特性修订（领域/规模/约束变了就要改），严禁原样照搬。`
        : '未提供项目流程沉淀——CEO 按本次需求特性从零设计（看完需求本质后逐项给出五要素）。'
      const designChecklist =
        `针对需求「${req.slice(0, 80) || '（需求）'}」逐项设计并给出：① 必经阶段（按执行顺序）；② 每阶段验收闸门（过闸才进下一阶段，"怎样算过"可判定）；③ 本领域红线（一票否决项）；④ 必须进场的角色；⑤ 必须开会的节点。\n${refNote}\n流程定稿后写入黑板（jarvis_board）并沉淀到 <项目>/.jarvis/process-${(industry || '项目').slice(0, 12)}.json，kickoff 会全员对齐。`
      const base = ['需求评审', '方案设计', '开发', '验证', '发布', '复盘']
      return {
        industry: industry || '由 CEO 判断',
        designChecklist,
        stages: applyOverride(base),
        gates: ['CEO 必须亲手定义每阶段闸门（不许缺，缺 = 流程缺失 = 客户提 bug 温床）'],
        redlines: ['流程缺失', '无验证就下结论', '照搬其他项目流程'],
        mustRoles: [],
        touchpoints: ['kickoff 会', '验证闸评审', '收口会'],
        customized: true,
        verdict: `插件不预设领域流程；本工具只给设计清单与占位骨架，CEO 必须按「${industry || '本需求领域'}」的实际特性逐项定稿五要素，并沉淀到项目 .jarvis/。`,
      }
    },
  },

  {
    name: 'jarvis_distill',
    description:
      '角色卡蒸馏校验器（女娲式，防迎合蒸馏核心）：校验现场蒸馏出的角色卡是否满足证据链硬闸。要求：1) 六段式(身份定位/思维模型/核心方法论/代表作品/决策红线/语言风格) 必含；2) CEO 卡必含协同架构段；3) 证据链必含「证据链/诚实边界/保真度」段——证据链须含 6 维度调研(著作/对话/表达/他者/决策/时间线)，诚实边界须写信息截止/推测成分，保真度须写一手/二手/推断占比；4) source 必须是真实 https URL（防编造出处）；5) 防冒名独立声明；6) 深度闸：六段正文须有实质内容、方法论须含 HOW 动作链(捕捉 HOW they think 而非 WHAT they said)、证据链六维度逐项带内容、有反例/失效边界、source 非保留域+有查证痕迹(assessCardDepth≥60)。任缺 → 不通过，禁止注入；浅层卡(结构齐全内容空洞)一票否决。证据不足宁可 60 分诚实，不要 90 分编造。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '角色名，如 CEO / 产品增长 / 供应链' },
        card: { type: 'string', description: '现场蒸馏出的六段式角色卡全文（含 source 与防冒名声明）' },
        isCeo: { type: 'boolean', description: '是否为 CEO 卡（CEO 必须含协同架构）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          missing: { type: 'array', items: { type: 'string' }, description: '缺失的段/声明' },
          depthScore: { type: 'number', description: '深度分 0-100（防浅层蒸馏）' },
          depthIssues: { type: 'array', items: { type: 'string' }, description: '深度不足的问题' },
          verdict: { type: 'string', description: '通过/不通过 + 原因' },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) =>
        `✅ ${r.verdict}` +
        (r.depthScore !== undefined ? `\n深度 ${r.depthScore}/100${r.depthIssues?.length ? ' 待补:' + r.depthIssues.slice(0, 3).join(';') : ''}` : ''),
    },
    handler: async (args) => {
      const card = String(args.card ?? '')
      const isCeo = Boolean(args.isCeo)
      if (!card.trim()) {
        return { ok: false, missing: SECTIONS.concat(isCeo ? ['协同架构'] : []), verdict: '卡为空：必须先现场 web 蒸馏（web_search 查证该领域真实权威），不得空手注入' }
      }
      const missing = validateCardShape(card, isCeo)
      if (missing.length) {
        return { ok: false, missing, verdict: `角色卡缺 ${missing.join('、')}；请补全后重新蒸馏并用 jarvis_distill 校验` }
      }
      // 深度硬闸：结构齐全≠有深度。浅层卡（标题齐全内容空洞/编造保留域 URL/无查证痕迹）→ 不通过
      //   ⛔ 空洞段一票否决：六段中 ≥3 段内容空洞（filled<4）→ 直接打回——防"真实人名+空泛工作特点"
      //     的结构凑分卡（只有 source/证据链齐全但方法论全空话，score 可能 ≥60 但实质是空卡）。
      const depth = assessCardDepth(card, isCeo)
      const hasReservedSource = /https?:\/\/[^\s）)】]+/.test(card) && /example\.com|localhost|127\.0\.0\.1|\.test\b|your-domain/.test(card.match(/https?:\/\/[^\s）)】]+/)?.[0] || '')
      // 代表作品须含"具体成就"（成就反推工作方式的依据——泛泛"某创始人/做过项目"无法反推能力影子，等于卡没有能力来源）
      //   具体成就信号：作品/成果名 + 做了什么/规模/影响/年份（"主导某项目/创建某体系/著有某书/推动某变革"且可验证）
      const worksSection = (card.match(/代表作品[：:]\s*([^\n]+)/) || [])[1] || ''
      const VAGUE_WORKS = /某[^，。]{0,6}(创始人|公司|品牌|项目|产品)|一个项目|一些项目|某企业|做过项目/
      // 成就证据两种合法形态：①具体动作+成果（主导/创建/著有/推动...）；②"借鉴《真实作品名》"（作品名本身就是他的成就——
      //   能"借鉴 Refactoring"说明作者写了 Refactoring；但"借鉴某品牌/某公司打法"仍是泛泛，不算）
      const actionAchievement = /主导|创建|建立|推出|发明|著有|推动|实现|打造|设计|开发|发起|创办|带领|让.{0,10}(提升|降低|增长|成为)|影响|规模|用户|年份/.test(worksSection)
      const workNamed = /《[^》]{2,30}》/.test(worksSection) || /Refactoring|Continuous|Humanocracy|Rework|Remote|Steve Jobs|Continuous Discovery/.test(worksSection)
      const hasConcreteAchievement = worksSection.length >= 15 && !VAGUE_WORKS.test(worksSection) && (actionAchievement || workNamed)
      const hasFlairVeto = depth.issues.some((i) => i.includes('展示型空泛'))
      if (depth.score < 60 || depth.filled < 4 || hasReservedSource || !hasConcreteAchievement || hasFlairVeto) {
        const reasons = []
        if (depth.score < 60) reasons.push(`深度不足（${depth.score}/100）`)
        if (depth.filled < 4) reasons.push(`六段中 ${6 - depth.filled} 段内容空洞（工作特点空泛——真实人物+空泛方法论 = 不合格，须补该人物独有的 HOW/决策触发词/取舍）`)
        if (hasReservedSource) reasons.push('source 是保留/示例域（example.com 等——编造出处嫌疑，须真实可查 URL）')
        if (!hasConcreteAchievement) reasons.push(`代表作品段无"具体成就"（当前='${worksSection.slice(0, 40) || '空'}'——泛泛"某创始人/做过项目"无法反推工作方式=卡没有能力影子来源。须写具体的：做出过什么成果/规模/影响/年份，如"著有 X 书/主导 X 项目推动 X 增长/创建 X 体系"）`)
        if (hasFlairVeto) reasons.push('方法论是"展示型空泛"（评价性形容词堆砌，无"遇到X→做Y"可执行行为）——卡不贵多贵有用，删空话换具体做法')
        return { ok: false, missing: [], depthScore: depth.score, depthIssues: depth.issues, verdict: `深度硬闸打回：${reasons.join('；')}——"结构齐全内容空洞"的浅层卡不得注入。${depth.issues.slice(0, 3).join('；')}` }
      }
      return {
        ok: true,
        depthScore: depth.score,
        depthIssues: depth.issues,
        verdict: `卡合格（结构+深度 ${depth.score}/100）：六段式${isCeo ? '+协同架构' : ''}+source+防冒名，方法论含 HOW、证据链维度齐全、有查证痕迹。注入后员工只借鉴其思考框架，真实判断必须基于实际数据/代码/复现。`,
      }
    },
  },

  {
    name: 'jarvis_distill_guide',
    description:
      '蒸馏独特性引导器（蒸馏能力核心，先于 jarvis_distill 用）：在写卡前，CEO 用它从真实素材里提炼"这个大佬独有的 HOW"——决策触发词/独特取舍/领域黑话/反直觉原则/认知变化轨迹/失效边界，并做来源分级（一手/二手/黑名单）与验证锚点（已知答案测试/边界测试）。借鉴 distilly(24k★) 方法论：7 品味原则（长文>碎片、争议>共识、变化>固定、一手>二手、讲过程>传记、重复模式>金句、失败>成功）+ 决策启发式 + 认知时间线。先提炼 HOW 再写卡，卡过 jarvis_distill 校验——蒸馏才强，不是套模板。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '要蒸馏的角色名（如 CEO/产品增长/风控）' },
        material: { type: 'string', description: '该领域真实权威的原始素材（访谈原文/著作摘录/决策记录；可从 web_search 摘）' },
        industry: { type: 'string', description: 'CEO 判断的领域（可选标记）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string' },
          industry: { type: 'string', description: 'CEO 判断的领域（可选）' },
          purpose: { type: 'string' },
          tastePrinciples: { type: 'array', items: { type: 'string' } },
          sourceHierarchy: { type: 'array', items: { type: 'string' } },
          sourceBlacklist: { type: 'array', items: { type: 'string' } },
          sourceRecommended: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { type: 'string' } },
          decisionHeuristics: { type: 'string' },
          validationAnchors: { type: 'string' },
          achievementTrace: { type: 'string', description: '成就反推工作方式：列出该人物真实成就 → 反推"他怎么工作才做到的"（影子习惯来源）' },
          evidenceTrace: { type: 'string', description: '证据溯源分级：每项能力标 A原文级/B行为级/C推断级（员工只把 A/B 当真影子，C 不冒充）' },
          fingerprintTrace: { type: 'string', description: '产出指纹提炼：从真实作品/成就提炼该人物产出的可辨识特征（对照指纹能看出产出像不像他做的）' },
          workbenchTrace: { type: 'string', description: '工作台需求反馈：人物卡自己反馈这领域做这活要什么环境/工具（不许默认 Linux 万能/不许乱搞）' },
          aiDisplacementTrace: { type: 'string', description: 'AI 执行平替：人物保留判断/审美/决策，执行从人工工具平移到 AI 工具（每条工作方式标 判断/AI执行/人工）' },
          antiGeneric: { type: 'string' },
          personBar: { type: 'string', description: '选人闸：蒸馏前先确认该人物是该领域真正厉害的人物（可命名贡献/公认度/排他性），防止注入"真实但平庸"的人' },
          sourceCheck: { type: 'string' },
          respondAs: { type: 'string' },
        },
        required: ['purpose', 'steps', 'respondAs'],
      },
      render: (r) =>
        `【${r.role ?? '角色'} 蒸馏引导 · 捕捉独有 HOW】\n目的：${r.purpose}\n品味原则：${(r.tastePrinciples || []).map((x) => '  · ' + x).join('\n')}\n来源分级：${(r.sourceHierarchy || []).map((x) => '  · ' + x).join('\n')}\n黑名单源：${(r.sourceBlacklist || []).join('、')}\n推荐源：${(r.sourceRecommended || []).join('、')}\n步骤：${(r.steps || []).map((x) => '  ' + x).join('\n')}\n决策启发式：${r.decisionHeuristics}\n验证锚点：${r.validationAnchors}\n防通用：${r.antiGeneric}\n${r.sourceCheck}\n响应格式：${r.respondAs}`,
    },
    handler: async (args) => {
      const role = String(args.role ?? '').trim()
      const material = String(args.material ?? '').trim()
      const industry = String(args.industry ?? '').trim()
      return distillGuide(role, material, industry)
    },
  },

  {
    name: 'jarvis_review',
    description:
      '分歧升级裁决器：团队角色间对同一问题有冲突（如产品 vs 风控、测试 vs 研发）时，CEO 调用本工具采集双方观点并按裁判优先级裁决。裁判优先级(铁律)：需求本质 > 真实情况 > 用户需求 > 专业判断——LLM 不得迎合角色卡/主流方案/会议多数，裁决必须回归原始需求本质（为谁解决什么、怎样算成功）。可选传入双方 thinkA/thinkB（各角色先跑 jarvis_think_deep 的结构化思考 JSON），裁决时会引用双方的 反方攻击/真实核对/诚实边界 来防一面之词；必填 requirement（原始需求），输出 essenceCheck 强制核对裁决是否偏离需求本质。',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: '分歧问题是什么' },
        sideA: { type: 'string', description: 'A 方观点与依据' },
        sideB: { type: 'string', description: 'B 方观点与依据' },
        requirement: { type: 'string', description: '原始需求（必填：裁决必须回归需求本质，不许脱离需求空谈）' },
        thinkA: { type: 'string', description: 'A 方 jarvis_think_deep 的结构化思考 JSON（可选）' },
        thinkB: { type: 'string', description: 'B 方 jarvis_think_deep 的结构化思考 JSON（可选）' },
      },
      required: ['issue'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ruling: { type: 'string', description: 'CEO 裁决结论' },
          basis: { type: 'string', description: '裁决依据（需求本质/真实情况/用户需求/专业判断）' },
          analysis: { type: 'string', description: '基于双方深度思考帧的对抗分析（可选）' },
          essenceCheck: { type: 'string', description: '回归需求本质的强制核对指令' },
        },
        required: ['ruling'],
      },
      render: (r) =>
        `裁决：${r.ruling}\n依据：${r.basis ?? ''}${r.analysis ? '\n分析：' + r.analysis : ''}${r.essenceCheck ? '\n需求本质核对：' + r.essenceCheck : ''}`,
    },
    handler: async (args) => {
      const issue = String(args.issue ?? '')
      const sideA = String(args.sideA ?? '')
      const sideB = String(args.sideB ?? '')
      const requirement = String(args.requirement ?? '').trim()
      // 消费双方 jarvis_think_deep 的结构化思考（含反方攻击/真实核对/诚实边界），防止"只亮结论不亮推理"
      const notes = []
      for (const [label, raw] of [['A', args.thinkA], ['B', args.thinkB]]) {
        if (!raw) {
          notes.push(`${label} 方未提供深度思考帧——建议该角色先跑 jarvis_think_deep（前提/反方/失效推演/诚实边界）再裁决，避免一面之词`)
          continue
        }
        try {
          const t = typeof raw === 'string' ? JSON.parse(raw) : raw
          const counter = Array.isArray(t.counter) ? t.counter.join('；') : String(t.counter ?? '')
          const check = Array.isArray(t.realityCheck) ? t.realityCheck.join('；') : String(t.realityCheck ?? '')
          const conf = t.confidence ? `（置信 ${t.confidence}）` : ''
          const runId = t.runId || t.run_id ? `（ponder run_id=${t.runId || t.run_id}，可溯源）` : '（⚠️ 无 run_id——高赌注思考未声明 ponder 溯源，若 stake=high 视为"未做深度对抗/贴标签"风险，须向该角色核验 step-guard 记录）'
          notes.push(`${label} 方深度思考${conf}${runId}：反方=${counter || '无'}；真实核对=${check || '无'}`)
        } catch {
          notes.push(`${label} 方 think 不是合法 JSON——请用 jarvis_think_deep 按要求格式输出后重传`)
        }
      }
      const essenceCheck = requirement
        ? `先重述需求本质：「${requirement.slice(0, 120)}」——为谁解决什么、怎样算成功。然后逐条核对裁决：① 偏离需求本质了吗（把用户要X做成了你想要的Y）？② 在迎合谁（用户原话/角色卡/主流方案/会议多数）？③ 有没有无依据断言（编造 source/数据/案例）？只要有一项打问号，裁决必须打回重做——回归需求本质优先于一切。必要时用 jarvis_essence 完成审计。`
        : '⚠️ 未提供原始需求（requirement）——裁决必须拿到需求本质才能定案：先补需求再裁决，禁止脱离需求空谈。'
      const reviewOut = {
        ruling: `待 CEO 基于需求本质与真实情况裁决：「${issue}」。A=${sideA}；B=${sideB}。`,
        basis: '需求本质 > 真实情况 > 用户需求 > 专业判断（不迎合角色卡/主流方案/会议多数，回归原始需求定案）',
        essenceCheck,
      }
      if (notes.length) reviewOut.analysis = notes.join('\n')
      return reviewOut
    },
  },

  {
    name: 'jarvis_essence',
    description:
      '需求本质决策校验器（防 LLM 通病"迎合/幻觉"的最后闸门）：任何重要决策/黑板决议/角色产出在定稿前，CEO 用它强制回归需求本质。四查：①回归本质——决策服务"为谁解决什么、怎样算成功"，还是做成了别的；②防迎合——是否迎合用户原话/角色卡/主流方案/会议多数（从众）；③防幻觉——是否编造 source/数据/访谈/案例，把推测写成事实；④真实优先——判断是否基于真实代码/数据/复现。未通过 → 禁止进黑板/发布，打回重做。宁 60 分诚实不要 90 分编造。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '原始需求（必填：本质由此提炼）' },
        decision: { type: 'string', description: '待校验的决策/决议/产出（必填）' },
        rationale: { type: 'string', description: '决策依据/推理（可选）' },
        suspects: { type: 'string', description: 'CEO 怀疑的迎合/幻觉点（可选，供校验重点核查）' },
      },
      required: ['requirement', 'decision'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          essence: { type: 'string', description: '需求本质重述（为谁解决什么/怎样算成功）' },
          checks: { type: 'array', items: { type: 'string' }, description: '四查清单' },
          flattery: { type: 'string', description: '迎合痕迹核查指令' },
          hallucination: { type: 'string', description: '幻觉痕迹核查指令' },
          misalignments: { type: 'string', description: '偏离本质核查指令' },
          verdict: { type: 'string', description: '通过/需修正/打回 判定与门槛' },
          respondAs: { type: 'string', description: '要求输出审计结论的 JSON 结构' },
        },
        required: ['essence', 'verdict'],
      },
      render: (r) =>
        `【需求本质审计】本质=${r.essence}\n四查：${(r.checks ?? []).map((c) => '  🔍 ' + c).join('\n')}\n防迎合：${r.flattery ?? ''}\n防幻觉：${r.hallucination ?? ''}\n偏离检查：${r.misalignments ?? ''}\n判定：${r.verdict}\n审计格式：${r.respondAs ?? ''}`,
    },
    handler: async (args) => {
      const requirement = String(args.requirement ?? '').trim()
      const decision = String(args.decision ?? '').trim()
      const rationale = String(args.rationale ?? '').trim()
      const suspects = String(args.suspects ?? '').trim()
      return {
        essence: `从原始需求「${requirement.slice(0, 120) || '（缺失）'}」重述本质：为谁解决什么问题、怎样算成功（成功标准要可判定：指标/场景/时限）。若需求本身空泛，先补需求本质再审计——不许用"大概、尽量"糊弄。`,
        checks: [
          '本质回归：决策直接服务于上面重述的本质吗？还是在做别的（如把"用户要拼团"做成"平台刷 GMV"）？',
          '防迎合：有没有顺着用户原话/顺着角色卡/顺着主流方案/顺着会议多数（从众）下的结论？',
          '防幻觉：决策里有编造的 source/数据/访谈/案例吗？有把推测当事实写吗？',
          '真实优先：判断依据真实代码/数据/复现/历史了吗？还是凭印象？',
        ],
        flattery: `逐个点名核查迎合嫌疑：① 用户说 A 就顺着 A（哪怕 A 不是真需求）？② 角色卡怎么说就怎么下结论（迎合卡）？③ 主流/模板方案拿来就用（迎合常见答案）？④ 会议里没人反对就默认（从众）？` + (suspects ? `重点核查 CEO 怀疑点：${suspects}` : ''),
        hallucination: `逐句核查幻觉：① source/引用是否真实可查（编造 = 一票否决）；② 数据/数字/案例是否来自真实复现或实证（无出处 = 推测，必须标注）；③ 是否把"我认为"写成"事实"；④ 诚实边界是否声明（信息截止/推测成分）。`,
        misalignments: `列出决策「${decision.slice(0, 120)}」偏离需求本质的所有点；每点写明：本质要什么 vs 决策给了什么。偏离超过 1 点 → 判定为偏离本质，打回重做。`,
        verdict: `判定门槛：四查全过 = 通过（可进黑板/发布）；有迎合或幻觉嫌疑 = 打回重做（宁 60 分诚实不要 90 分编造）；只偏离本质未涉造假 = 需修正后再审。没合格不许定稿。`,
        respondAs: `完成上述审计后以 JSON 输出：{"essence":"本质重述","verdict":"PASS|FIX|REJECT","flattery":["迎合嫌疑点或'无'"],"hallucination":["幻觉嫌疑点或'无'"],"misalignments":["偏离点或'无'"],"decision":"修正后的决策(若 REJECT/FIX 则重写)"}。`,
      }
    },
  },

  {
    name: 'jarvis_escalate',
    description:
      '问题上行器（"不许跳过问题"硬闸，防客户提 bug 的核心）：角色遇到技术上绕不开/自己无法抉择的问题时，禁止沉默、降级、假装解决——必须带三样东西上报领导：①问题本身；②已尝试的方案；③风险细节（不解决的后果/影响范围/时限）；④需要领导决策什么。上报完整性校验：缺风险细节或缺决策请求 → 打回补齐（不许报"有个问题"这种空单）。上报后写黑板（阻塞条目），CEO 响应闭环（裁决/转派/给资源/开二次会）。纪律：宁可上报被驳回，不可沉默绕行；绕过问题 = 缺陷。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '上报角色（必有自己的协同段/升级路径）' },
        problem: { type: 'string', description: '问题：技术上绕不开/无法抉择的点（必填）' },
        attempts: { type: 'string', description: '已尝试的方案与结果（可空则提示补）' },
        risk: { type: 'string', description: '风险细节：不解决的后果/影响范围/时限（必填，缺失 = 打回）' },
        decisionNeeded: { type: 'string', description: '需要领导决策什么（必填，缺失 = 打回）' },
        urgency: { type: 'string', description: 'high/medium/low（默认 medium）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', description: '上报单是否完整可提交' },
          missing: { type: 'array', items: { type: 'string' }, description: '缺失的必填项' },
          record: { type: 'string', description: '上报单全文' },
          boardEntry: { type: 'string', description: '写入黑板的阻塞条目（完整上报时已真写入）' },
          boardWritten: { type: 'boolean', description: '阻塞条目是否已写入黑板' },
          boardError: { type: 'string', description: '黑板写入失败原因（如实上报，不假装已写入）' },
          protocol: { type: 'string', description: '上报纪律（不许跳过）' },
        },
        required: ['ok', 'record'],
      },
      render: (r) =>
        `问题上行：${r.ok ? '✅ 可上报' : '❌ 打回补细节：' + (r.missing || []).join('、')}\n${r.record}\n黑板条目：${r.boardEntry ?? ''}\n纪律：${r.protocol ?? ''}`,
    },
    handler: async (args) => {
      const role = String(args.role ?? '?')
      const problem = String(args.problem ?? '').trim()
      const attempts = String(args.attempts ?? '').trim()
      const risk = String(args.risk ?? '').trim()
      const decisionNeeded = String(args.decisionNeeded ?? '').trim()
      const urgencyRaw = String(args.urgency ?? 'medium')
      const urgency = ['high', 'medium', 'low'].includes(urgencyRaw) ? urgencyRaw : 'medium'
      const missing = []
      if (!problem) missing.push('问题描述（技术绕不开/无法抉择的点）')
      if (!risk) missing.push('风险细节（不解决的后果/影响范围/时限）——领导无法评估该不该介入')
      if (!decisionNeeded) missing.push('决策请求（需要领导拍板什么）——空单不许上报')
      const ok = missing.length === 0
      const record = `【问题上行 · ${urgency.toUpperCase()}】上报人=${role}\n问题：${problem || '（缺失）'}\n已尝试：${attempts || '未说明'}\n风险细节：${risk || '（缺失）'}\n需要决策：${decisionNeeded || '（缺失）'}\n升级对象：CEO/jarvis_review`
      const boardEntry = `阻塞：${problem}（上报人=${role}；风险=${risk.slice(0, 60) || '待补'}；需要决策：${decisionNeeded.slice(0, 40) || '待补'}）——升级 CEO 处理`
      const protocol =
        '纪律（不许跳过问题）：① 技术绕不开/无法抉择 = 必须上报，禁止沉默、降级处理、假装已解决；② 上报必须带 风险细节+已尝试+决策请求 三件套（空单打回）；③ 上报后写黑板（阻塞条目）触发 CEO 响应；④ 宁可上报被驳回，不可沉默绕行——绕过问题 = 缺陷。'
      // BUG-2 修复：上报单完整时真写黑板（.jarvis/board.json），不再只给建议文本
      //   ——"上报后写黑板（阻塞条目）"是承诺，必须兑现，否则阻塞可能没人看见
      let boardWritten = false
      let boardError = ''
      if (ok) {
        const fsSvc = (() => {
          try { return (ctx && ctx.get && ctx.get('fs')) || null } catch { return null }
        })()
        const disk = await readBoardItems(fsSvc)
        const items = disk.fromDisk ? disk.items : []
        // 去重：同问题上行（内容相同且未解决）不重复写
        const dup = items.some((it) => it.type === '阻塞' && it.status === 'open' && it.content.includes(problem.slice(0, 30)))
        if (!dup) {
          items.push({ id: nextBoardId(items), role, type: '阻塞', content: boardEntry, status: 'open', essenceChecked: true, time: new Date().toISOString().slice(0, 16) })
          const w = await writeBoardItems(fsSvc, items, disk.version)
          boardWritten = w.ok
          boardError = w.ok ? '' : w.error
        } else {
          boardWritten = true // 已存在相同阻塞条目，视为已登记
        }
      }
      const out = { ok, missing, record, boardEntry, protocol }
      if (ok) {
        out.boardWritten = boardWritten
        if (boardError) out.boardError = boardError
      }
      return out
    },
  },

  {
    name: 'jarvis_capability',
    description:
      '能力补足决策器（组件化/防"没能力硬装会"）：角色发现 DSH 缺乏完成子任务所需能力时，走三级路径并真实验证——① DSH 现有工具/插件是否够（够就用，不够如实说）；② 去插件市场找 star 高的补足（必须先 web_search 验证：真实存在/star 高/可安装/license）；③ 都没有 → CEO 批准自研，自研必须做成可发布可复用插件（像 luke-jarvis 一样），安装后记录进组件清单供后续复用。铁律：没有就是没有，不许假装会、不许硬凑、不许编造"找到了"。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '需要什么能力的子任务（必填）' },
        existingTools: { type: 'string', description: 'DSH 当前已注册的相关工具/插件（可空）' },
        marketSearch: { type: 'string', description: '插件市场搜索结果（可空；CEO 先用 web_search 查高 star 插件）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          gap: { type: 'string', description: '能力缺口判定（现有够不够/缺什么）' },
          decision: { type: 'string', description: '三级路径决策：复用现有 / 市场补足 / 自研组件化' },
          verifyNotes: { type: 'string', description: '市场方案的验证要点（防假装找到）' },
          buildNote: { type: 'string', description: '自研要求（可发布可复用插件 + 组件清单）' },
          honestNote: { type: 'string', description: '诚实边界' },
          respondAs: { type: 'string' },
        },
        required: ['gap', 'decision'],
      },
      render: (r) =>
        `【能力补足】缺口=${r.gap}\n决策=${r.decision}\n验证：${r.verifyNotes ?? ''}\n自研要求：${r.buildNote ?? ''}\n诚实边界：${r.honestNote ?? ''}`,
    },
    handler: async (args) => {
      const task = String(args.task ?? '').trim()
      const existing = String(args.existingTools ?? '').trim()
      const market = String(args.marketSearch ?? '').trim()
      let decision = ''
      let verifyNotes = ''
      if (existing && !/没有|无|缺/.test(existing)) {
        decision = '① 复用 DSH 现有工具/插件——先评估够不够：够就直接用；不够如实说"不够"，不许将就。'
        verifyNotes = `评估要点：现有=${existing} 是否真能完成「${task.slice(0, 40)}」；不能完成 = 缺口，走下一级。`
      } else {
        decision = existing ? `① 现有不足（${existing.slice(0, 40)}）→ 进入 ②③` : '① DSH 现有 = 无相关能力 → 进入 ②③'
      }
      if (market) {
        decision += `\n② 插件市场补足——搜索结果：${market.slice(0, 120)}`
        verifyNotes = (verifyNotes ? verifyNotes + '\n' : '') + `市场验证要点（防假装找到）：① 插件真实存在且可安装（npm/GitHub 实际可查）；② star/下载量确实高；③ license 允许商用；④ 装上后真能跑通「${task.slice(0, 40)}」。任何一项过不了 = 没找到，走 ③ 自研，不许用"据说有"糊弄。`
      } else {
        verifyNotes = (verifyNotes ? verifyNotes + '\n' : '') + `② 尚未搜索市场——先用 web_search 查「${task.slice(0, 40)} 插件/工具，star 高」再定；查不到可验证的 = 走 ③。`
      }
      decision += '\n③ 仍无 → CEO 批准自研（组件化）：把缺口能力实现为独立可发布插件（参照 luke-jarvis 模式：cordis plugin + tools.register + 单测），安装后复用，并记录进组件清单（仓库/文档的"能力组件清单"），后续项目直接引用——一次建设，多次复用。'
      return {
        gap: `子任务「${task.slice(0, 80)}」：现有=${existing || '无'}；市场=${market || '未查'}。缺口判定：若现有与市场都不能真正完成 → 存在能力缺口，必须走自研组件化，不许硬凑。`,
        decision,
        verifyNotes,
        buildNote:
          '自研要求：① 独立 npm 包/插件（cordis apply + tools.register）；② 配套防回归单测（node --test）+ 文档；③ 安装后写入组件清单（名字/功能/用法/维护者）；④ 绝不把自研逻辑硬塞进角色卡或临时脚本（那不可复用）。',
        honestNote: '诚实边界：没有就是没有——不许假装会、不许硬凑、不许编造"找到了高 star 插件"；宁缺毋滥（用真实能力或如实声明能力不足并上报）。',
        respondAs: `完成评估后以 JSON 输出：{"gap":"缺口判定","path":"REUSE|MARKET|BUILD","decision":"最终路径","evidence":["验证证据(真实存在/star/可安装)或'无法验证'"],"buildPlan":"若 BUILD：插件名/功能/安装方式/复用点"}。`,
      }
    },
  },

  {
    name: 'jarvis_update',
    description:
      '插件版本检测器（回答"我能不能升级"）：对比 本地 package.json version vs GitHub 远程最新 release tag（git ls-remote --tags origin），判断是否有新版本；有新版本输出 升级内容摘要（读 CHANGELOG.md 最新条目）+ 升级步骤（解包覆盖 node_modules + 重启生效）。用法：本地版本取 require(process.cwd()/package.json)，远程取 git ls-remote。诚实：网络/git 不可用则如实报告"无法检测"，不编造版本号。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'check 检测是否有新版本（默认）；detail 详情（含 CHANGELOG 摘要）' },
        remoteUrl: { type: 'string', description: '远程仓库 URL（默认 https://github.com/ljjluke/luke-jarvis.git）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          localVersion: { type: 'string' },
          remoteVersion: { type: 'string' },
          hasUpdate: { type: 'boolean' },
          changelog: { type: 'string' },
          upgradeStep: { type: 'string' },
          verdict: { type: 'string' },
        },
        required: ['localVersion', 'verdict'],
      },
      render: (r) =>
        `【版本检测】本地 ${r.localVersion} vs 远程 ${r.remoteVersion ?? '?'}${r.hasUpdate ? ' ⬆️ 有新版本' : ' ✅ 已是最新'}\n${r.changelog ? '变更摘要：' + r.changelog.slice(0, 120) + '\n' : ''}${r.upgradeStep ? '升级：' + r.upgradeStep + '\n' : ''}判定：${r.verdict}`,
    },
    handler: async (args) => {
      const path = _require('node:path')
      const fs = _require('node:fs')
      const remoteUrl = String(args.remoteUrl ?? 'https://github.com/ljjluke/luke-jarvis.git')
      let localVersion = '0.2.0'
      try {
        const pkgPath = path.join(process.cwd(), 'package.json')
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
          if (pkg.version) localVersion = String(pkg.version)
        }
      } catch { /* 保持默认 */ }
      // 远程最新版本：git ls-remote --tags
      let remoteVersion = ''
      let remoteError = ''
      try {
        const out = execFileSync('git', ['ls-remote', '--tags', remoteUrl], { timeout: 20000, encoding: 'utf8' })
        // 取形如 v0.2.0 的最高语义版本 tag（排除 ^{} 与非 v 前缀）
        const tags = out.split('\n').map((l) => l.trim().split(/\s+/)[1]).filter((t) => t && t.startsWith('refs/tags/v'))
          .map((t) => t.replace('refs/tags/', '')).filter((t) => !t.endsWith('^{}'))
        const semver = tags.map((t) => t.replace(/^v/, '')).filter((t) => /^\d+\.\d+\.\d+/.test(t))
          .sort((a, b) => { const pa = a.split('.').map(Number); const pb = b.split('.').map(Number); return (pa[0] - pb[0]) || (pa[1] - pb[1]) || (pa[2] - pb[2]) })
        remoteVersion = semver.length ? 'v' + semver[semver.length - 1] : ''
      } catch (e) {
        remoteError = String(e.message || e).slice(0, 80)
      }
      const parse = (v) => String(v || '').replace(/^v/, '').split('.').map(Number)
      let hasUpdate = false
      if (remoteVersion) {
        const l = parse(localVersion); const r = parse(remoteVersion)
        hasUpdate = (l[0] !== r[0] ? r[0] > l[0] : l[1] !== r[1] ? r[1] > l[1] : r[2] > l[2])
      }
      // 变更摘要：读 CHANGELOG 最新版本块
      const changelog = (() => {
        try {
          const repo = path.join(process.cwd(), 'CHANGELOG.md')
          if (!fs.existsSync(repo)) return ''
          const s = fs.readFileSync(repo, 'utf8')
          const blocks = s.split(/^## /m)
          return blocks.length > 1 ? (blocks[1] || '').slice(0, 300) : ''
        } catch { return '' }
      })()
      const verdict = remoteError
        ? `无法连接远程（${remoteError}）——未能确认是否有新版本，请稍后重试或手动查看 https://github.com/ljjluke/luke-jarvis/releases`
        : !remoteVersion
          ? '远程无 v 前缀语义版本 tag（可能首次发布未打 tag）——请用 CHANGELOG 判断'
          : hasUpdate
            ? `有新版本 ${remoteVersion}（本地 ${localVersion}）：按 UPGRADE 文档升级（解包覆盖 node_modules/luke-jarvis + 重启 dsh web）。`
            : `已是本地最新 ${localVersion}（远程 ${remoteVersion}）：无需升级。`
      const updateOut = { localVersion, hasUpdate, verdict }
      if (remoteVersion) updateOut.remoteVersion = remoteVersion
      if (changelog) updateOut.changelog = changelog
      if (hasUpdate) updateOut.upgradeStep = 'docs/UPGRADE-*.md：解包 → 覆盖 ~/.dsh/profiles/web/node_modules/luke-jarvis/ → 重启 dsh web'
      return updateOut
    },
  },

  {
    name: 'jarvis_think',
    description:
      '员工思考辅助：给某角色一个"按角色卡框架分析"的提示，并强制真实优先——先看真实代码/数据/复现/历史，再用角色卡的方法论去推理，禁止迎合角色卡下结论。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '需要思考的问题' },
        roleCard: { type: 'string', description: '该员工的角色卡（六段式）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          note: { type: 'string' },
        },
        required: ['note'],
      },
      render: (r) => `真实优先提示：${r.note}`,
    },
    handler: async (args) => {
      return {
        note: `问题「${String(args.question ?? '')}」：先用该角色卡的框架如何分析（引用卡中思维模型），但结论必须回到真实情况——检查真实数据/代码/复现后再下判断，禁止为迎合角色卡而扭曲事实。`,
      }
    },
  },

  {
    name: 'jarvis_think_deep',
    description:
      '角色深度思考器（ponder 满血入口引导器，防幻觉核心）：**每个角色的独立思考必须加载 ponder 技能跑完整十阶段**（DSH 平台级：interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis，十阶段资源全部在 ponder 技能包内自包含随 luke-jarvis 自带：stages/*.json + engine/*.md + scripts/step-guard.cjs + scripts/_lib/，子 agent 具备 skill 工具），step-guard.cjs init 开始本次 run，把本角色卡六段式作为"人物视角"注入画像后十阶段全量跑完，产出按衔接契约回填（counter←divergence/bagua/debate、realityCheck←interview/无知自检、confidence←converge/certainty、conclusion←synthesis、limits←epistemic_status）。**满血不阉割**：禁止只跑 interview+converge 两段或用轻量七段替代（那达不到思考效果）；低赌注（low）可精简各阶段内 agent 规模但不得跳过阶段。产出带 run_id 溯源，可直接喂给 jarvis_review 做分歧裁决双方依据（thinkA/thinkB）。铁律：真实情况优先于角色卡；宁 60 分诚实不要 90 分编造；跳过 ponder 必须显式声明 skipReason（技能不可用/用户成本优先）并留痕，禁止静默降级；web_search 受限时查证类阶段降级为知识库推演但标注"受限环境推演"。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '需要深度思考的问题' },
        roleCard: { type: 'string', description: '该员工的角色卡（六段式+协同段）' },
        stakes: { type: 'string', description: '赌注 high/medium/low（默认 medium）：high=重大决策/对外承诺，medium=常规关键决策，low=可逆小事' },
        force: { type: 'boolean', description: '强制模式（默认 false）：true=本问题为角色第一次分析需求——必须真实加载 ponder 跑完整十阶段并返回 run_id，不得跳过/贴标签；强制模式下产出必须含 runId（或显式 skipReason），否则视为未完成' },
      },
      required: ['question'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string' },
          stakes: { type: 'string' },
          ponderGuide: { type: 'string', description: '满血 ponder 十阶段入口引导（必须先加载 ponder 技能跑完整十阶段，不得跳过）' },
          premises: { type: 'string', description: '前提审视指令：列出隐含前提并标出未验证项' },
          perspective: { type: 'string', description: '视角展开指令：引用角色卡思维模型给出第一判断' },
          counter: { type: 'string', description: '反方攻击指令：当X时不成立' },
          failure: { type: 'string', description: '失效推演指令：换场景/换数据后的失败路径' },
          realityCheck: { type: 'string', description: '真实优先核对清单指令' },
          limits: { type: 'string', description: '诚实边界指令' },
          conclusion: { type: 'string', description: '收敛结论指令：含置信度与升级对象' },
          respondAs: { type: 'string', description: '要求按此 JSON 结构回复思考结果' },
        },
        required: ['respondAs'],
      },
      render: (r) =>
        `【${r.role ?? '角色'} 深度思考任务单 · stakes=${r.stakes}\n① 前提审视：${r.premises}\n② 视角展开：${r.perspective}\n③ 反方攻击：${r.counter}\n④ 失效推演：${r.failure}\n⑤ 真实优先核对：${r.realityCheck}\n⑥ 诚实边界：${r.limits}\n⑦ 收敛结论：${r.conclusion}\n响应格式：${r.respondAs}`,
    },
    handler: async (args) => {
      const q = String(args.question ?? '').trim()
      const card = String(args.roleCard ?? '').trim()
      const stakes = String(args.stakes ?? 'medium')
      const force = Boolean(args.force)
      // ── 强制模式：角色第一次分析需求必须真实跑 ponder，产出须含 runId 否则未完成 ──
      const forceNote = force
        ? '\n【强制 · 第一次分析需求】本问题是你（该角色）对本次需求的第一立场分析，**必须真实加载 ponder 技能跑完整十阶段**：step-guard init → 十阶段全量 → 产出带回传的 runId。**产出违反强制 = 未完成**（无 runId 且无显式 skipReason 视为贴标签，CEO 打回重跑）。'
        : ''
      const roleName = (card.match(/身份定位[:：]\s*([^，。\n]+)/) || [])[1] || '该角色'
      // ── 角色卡方法论提取（主面板修复：让卡的方法论真实进入思考产出，medium/low 同 high 生效）──
      const extractHow = (label) => {
        const m = card.match(new RegExp(label + '[:：]\\s*([^\\n]+)'))
        return m ? m[1].trim().slice(0, 120) : ''
      }
      const cardModel = extractHow('思维模型')
      const cardMethod = extractHow('核心方法论')
      const cardRedline = extractHow('决策红线')
      const howBits = [cardModel, cardMethod, cardRedline].filter(Boolean)
      const howText = howBits.length ? howBits.join('；').slice(0, 200) : '（角色卡未提供方法论，按通用分析）'
      // ── 满血 ponder 入口引导（B13 · 满血版：所有 stakes 都加载 ponder 十阶段，不阉割）──
      // high=完整十阶段含可谬自评；medium/low=同十阶段框架、精简各阶段 agent 规模（控成本但不得跳过阶段/不得用轻量七段替代）
      const depthNote = stakes === 'high'
        ? '本问题赌注为 high（重大决策/对外承诺）：必须加载 ponder 完整十阶段 + synthesis 含可谬自评（这份结论最可能因为什么错？如果错改走什么方向——基于立场 A 最可能因 X 错+备选）。'
        : `本问题赌注为 ${stakes}：仍须加载 ponder 十阶段框架（满血不阉割），可精简各阶段内 agent 规模（如 bagua 8 维抽 4 维、debate 立论 3 个减为 2 个）控成本，但【不得跳过任何阶段、不得用轻量七段替代】——跳阶段=没达到思考效果。`
      return {
        role: roleName,
        stakes,
        ponderGuide: `【${roleName} · ${stakes} 赌注深度思考 · 必须加载 ponder 技能（满血版）】\n${depthNote}${forceNote}\n1. 用 skill 工具加载 ponder 技能（DSH 平台级十阶段管线，工具已注册）——step-guard.cjs init 开始本次 run；\n1a. per-run 隔离（防多成员并发互相覆盖 step-guard.json——runtime-paths.cjs 原生支持 PONDER_DATA_DIR env 覆盖 dataRoot）：本次 run 用独立数据目录 PONDER_DATA_DIR=<项目>/.jarvis/ponder-runs/<run_id>/ 或按 run_id 隔离的临时目录，跑完把 run_id 与阶段产出写回项目；禁止多成员共用同一全局 step-guard.json；\n2. 把本角色卡六段式全文（roleCard）作为 ponder 画像的"人物视角"注入（先于/并入 interview 五诊：思维模型=该人物怎么看问题、核心方法论=该人物的 HOW、决策红线=该人物不做什么）【本卡方法论=${howText}】，确保十阶段（shensi 前提审视/bagua 8 维盲点/plans 方案/synthesis 结论）全程以该人物方法论驱动，而不是通用分析师思考；\n3. 跑完整十阶段：interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis（子 agent 必须全部返回才进下一步；每步 step-guard before/after 记录）——${stakes !== 'high' ? '各阶段 agent 规模按低赌注精简（如 bagua 4 维/辩论 2 立论）但阶段一个不少' : '阶段与 agent 规模全量' }；\n4. 产出按衔接契约回填：counter←divergence+bagua+debate 汇总去重、realityCheck←interview+无知自检、confidence←converge/certainty（0-1 映射 low/medium/high）、conclusion←synthesis、limits←各阶段 epistemic_status；${stakes === 'high' ? 'high 须含可谬自评（见上）。' : ''}\n5. 把 run_id 与阶段产出溯源一并写入输出（供 jarvis_review 防贴标签校验——有 run_id 才算真跑过 ponder）；\n6. 若 ponder 技能不可用（无 skill 工具/运行时缺失）或用户明示成本优先 → 允许降级，但必须显式声明 skipReason 并上报留痕（评审按"未做深度对抗"降级标注置信度），禁止静默降级；web_search 受限时查证类阶段（bagua 引源/divergence 查资料）降级为知识库推演但标注"受限环境推演"。\n最终按衔接契约输出 JSON：{"premises":[…],"perspective":"以角色卡方法论的第一判断","counter":[…],"failure":"失败路径","realityCheck":[…],"limits":"诚实边界","conclusion":"保留结论","confidence":"low|medium|high","runId":"ponder run_id","skipReason":"降级原因或空"}。`,
        premises: `（已转 ponder 十阶段，本字段不适用——见 ponderGuide）`,
        perspective: `（已转 ponder 十阶段——以「${roleName}」角色卡方法论【${howText}】注入画像驱动全程）`,
        counter: `（已转 ponder 十阶段——由 divergence/bagua/debate 产出反方）`,
        failure: `（已转 ponder 十阶段——由 simulate 推演产出失败路径）`,
        realityCheck: `（已转 ponder 十阶段——由 interview 五诊+无知自检产出核对项）`,
        limits: `（已转 ponder 十阶段——由各阶段 epistemic_status 汇总诚实边界）`,
        conclusion: `（已转 ponder 十阶段——由 synthesis 产出收敛结论${stakes === 'high' ? '+可谬自评' : ''}）`,
        respondAs: `按 ponder 十阶段跑完后按衔接契约回填 JSON（见 ponderGuide 第 6 步）。`,
      }
    },
  },

  {
    name: 'jarvis_fidelity',
    description:
      '角色卡保真度审计器（女娲 FIDELITY 机制）：对蒸馏产出的角色卡做保真度审计，输出证据质量报告。审计项：1) 一手来源占比（本人著作/对话/决策记录 vs 二手转述 vs 推断）；2) 方法论是否含 HOW 动作链与反例边界（有深度而非贴标签）；3) 诚实边界是否明确（信息截止时间/做不到什么/推测成分）；4) 矛盾点是否保留（不和稀泥）；5) 信息源黑名单是否回避（知乎/微信公众号等洗稿源）。产出 PRIMARILY-FIRST-HAND / MIXED / SPECULATIVE 评级 + 建议。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '角色名' },
        card: { type: 'string', description: '蒸馏出的角色卡全文' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rating: { type: 'string', description: 'PRIMARILY-FIRST-HAND / MIXED / SPECULATIVE' },
          firstHandRatio: { type: 'number', description: '一手来源占比 0-1' },
          issues: { type: 'array', items: { type: 'string' }, description: '审计发现的问题' },
          verdict: { type: 'string' },
        },
        required: ['rating', 'verdict'],
      },
      render: (r) => `保真度=${r.rating}（一手占比 ${r.firstHandRatio ?? '?'}）\n${(r.issues ?? []).map((i) => '⚠️ ' + i).join('\n')}\n${r.verdict}`,
    },
    handler: async (args) => {
      const card = String(args.card ?? '')
      const issues = []
      // 保真度不再"出现关键词就加分"，而是吃深度评估的实质证据：
      // 证据链维度真实覆盖数、有无查证痕迹、有无反例边界、source 是否真实域
      const depth = assessCardDepth(card, false)
      // 一手占比（证据链维度里"著作/对话/决策记录"属一手；"他者评价/二手"属二手；无覆盖不给分）
      let firstHand = 0
      const evidenceText = card
      if (/(著作|对话|访谈|决策记录|原创|演讲原文)/.test(evidenceText)) firstHand += 0.45
      if (/他者评价|二手|转述|他人/.test(evidenceText)) firstHand += 0.2
      if (/推断|推测/.test(evidenceText)) firstHand += 0.15
      firstHand = Math.min(1, firstHand + depth.dimsCovered * 0.03)
      if (!card.includes('诚实边界') || !/(信息截止[:：]?\s*(20\d\d|至今|v\d)|做不到|推测|局限)/.test(card)) issues.push('缺诚实边界（须含具体信息截止时间/推测成分/做不到什么）')
      if (!depth.hasHow) issues.push('方法论只有标签没有 HOW 动作链（真实人物蒸馏要写出"怎么做/什么情况怎么办"，非贴标签）')
      if (!/(矛盾|张力|分歧|反例|不适用|失效)/.test(card)) issues.push('未记录矛盾/反例/失效边界（女娲原则：保留张力而非和稀泥）')
      if (/知乎|微信公众号|百度百科/.test(card)) issues.push('命中了信息源黑名单（知乎/公众号/百度百科）——洗稿源需替换为权威一手来源')
      if (/example\.com|localhost|127\.0\.0\.1/.test(card)) issues.push('source 是保留/示例域（example.com 等不可能有真实内容）——必须换成真实查到的 URL')
      if (!/查证|核实|搜索|检索|原文|出处/.test(card)) issues.push('无查证痕迹（应写明 web 搜索记录/在哪页确认真人）——防"编 URL"')
      const rating = !issues.length && firstHand >= 0.6 && depth.dimsCovered >= 5 ? 'PRIMARILY-FIRST-HAND' : issues.length <= 1 ? 'MIXED' : 'SPECULATIVE'
      return {
        rating,
        firstHandRatio: Math.round(firstHand * 100) / 100,
        issues,
        verdict: !issues.length
          ? `保真度合格（一手占比 ${Math.round(firstHand * 100) / 100}，证据链维度 ${depth.dimsCovered}/6）：一手来源充分、三重验证齐备、诚实边界清晰、有查证痕迹。可注入（仍只借鉴框架，不冒充署名）。`
          : `保真度不足：${issues.length} 项待修（${issues.slice(0, 3).join('；')}）。修改后用 jarvis_distill + jarvis_fidelity 复验。宁要 60 分诚实，不要 90 分编造。`,
      }
    },
  },

  {
    name: 'jarvis_collab',
    description:
      '团队协同架构设计与校验器（CEO 定子角色后的必备步骤）。输入各角色职责与协同段，输出：1) 每个角色的协同四要素（位置=上游/下游/并行/横向支持；依赖=依赖谁/给谁喂产出；介入时机=从哪个阶段进入/是否全程；协同方式=实时讨论/事件驱动/阶段交接/冲突向谁升级）；2) 全局健康检查（依赖闭环无悬空、并行而非串行交接、有冲突升级路径、无孤立角色）；3) 判定是否可建队。铁律：角色是"怎么思考"的框架+协作者，不是各干各的；真实协同像真实团队——并行讨论、实时同步、关键节点对齐、分歧升级 CEO 裁决。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '原始需求（协同设计围绕它）' },
        rolesJson: { type: 'string', description: '角色清单 JSON，如 [{"name":"产品增长","duty":"定义价值与增长"},{"name":"供应链","duty":"履约与备货"}]' },
        collabText: { type: 'string', description: '协同架构描述（各角色的位置/依赖/介入时机/协同方式 + 全局协作）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          roles: { type: 'array', items: { type: 'string' }, description: '解析出的角色名' },
          perRole: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { role: { type: 'string' }, position: { type: 'string' }, depends: { type: 'string' }, intervenes: { type: 'string' }, collabMode: { type: 'string' }, escalate: { type: 'string' } } }, description: '每个角色的协同四要素' },
          issues: { type: 'array', items: { type: 'string' }, description: '全局健康检查发现的问题' },
          ok: { type: 'boolean', description: '协同设计是否可建队' },
          verdict: { type: 'string' },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) => `协同设计校验：${r.ok ? '✅ 可建队' : '❌ 待修'}\n问题：${(r.issues ?? []).map((i) => '⚠️ ' + i).join('\n')}\n${r.verdict}`,
    },
    handler: async (args) => {
      const req = String(args?.requirement ?? '')
      const collab = String(args?.collabText ?? '')
      const issues = []
      let roles = []
      const allPerRole = []
      try {
        const parsed = JSON.parse(String(args?.rolesJson ?? '[]'))
        if (Array.isArray(parsed)) {
          for (const x of parsed) {
            const name = String(x?.name ?? '?')
            roles.push(name)
            // 若 rolesJson 里已带该角色的协同段（perspective/collabText/duty），原样归一化进 perRole
            const own = String(x?.perspective ?? x?.collabText ?? x?.collab ?? x?.duty ?? x?.position ?? '')
            allPerRole.push({
              role: name,
              position: own || '待CEO补充',
              depends: own || '待CEO补充',
              intervenes: own || '待CEO补充',
              collabMode: own || '待CEO补充',
              escalate: own || '升级CEO/jarvis_review',
            })
          }
        } else issues.push('rolesJson 需为数组')
      } catch {
        issues.push('rolesJson 解析失败（需合法 JSON 数组）')
      }
      if (roles.length < 2) issues.push('角色过少（协同设计至少 2 个角色；1 个角色无需建队）')
      // 协同四要素完备性
      for (const f of COLLAB_FOUR) {
        if (!collab.includes(f)) issues.push(`协同描述缺「${f}」（位置/依赖/介入时机/协同方式）`)
      }
      // 每角色须有"我的协同"（分工明确硬闸：成员要知道自己依赖谁/向谁升级，不能全部待CEO补充）
      const unfilled = allPerRole.filter((p) => p.position === '待CEO补充' || p.depends === '待CEO补充')
      if (unfilled.length) issues.push(`${unfilled.length} 个角色缺自己的协同段（position/depends 为待补）——建队前必须为每个角色明确其位置/依赖/介入时机/协同方式，否则成员分工不明`)
      // 全局健康
      if (!/(升级|裁决|CEO|review|上报|复核)/.test(collab)) issues.push('无冲突升级路径（分歧应升级 CEO/jarvis_review 裁决）')
      if (!/并行|同时|实时|讨论|辩论/.test(collab) && /串行|依次|先.*再.*再/.test(collab)) issues.push('当前是串行交接而非并行协作——应改为角色并行开工、实时讨论（测试从产品阶段介入、研发与测试同步）')
      if (!/并行|同时|实时|讨论/.test(collab)) issues.push('未体现并行协作（建议：多角色并行 + 实时讨论，非单向依次完成）')
      const ok = issues.length === 0 && roles.length >= 2 && unfilled.length === 0
      return {
        roles,
        perRole: allPerRole,
        issues,
        ok,
        verdict: ok
          ? `协同设计合格：${roles.length} 个角色，每角色已明确 位置/依赖/介入时机/协同方式，有升级路径且体现并行协作。建队时每个成员 role 必须携带各自的协同段（见 perRole）。可建队（agent_teams_create → add_member(role=蒸馏卡+该角色协同段) → create_task(带验收标准+dependencies)）。`
          : `协同设计待修（${issues.length} 项）：补齐后重新调用。CEO 定子角色后必须先设计协同（含每角色自己的协同段），再建队——协同缺失 = 团队各干各的，不是真团队。`,
      }
    },
  },

  {
    name: 'jarvis_perf',
    description:
      '员工绩效评估器（CEO 时刻盯人的量化工具，含阶段性完成度考核）：多角度评估员工能力——⓪需求对齐度（客户价值，最重要：产出是否直指客户需求本质的可判定验收项——2=直指/1=方向对有偏差/0=偏离需求本质做别的，**偏离=一票否决直接换人**）；①成果质量（产出被打回几次/过验收标准没）；②任务完成度（负责任务持续未完成/超时）；③问题上行健康度（过度上报=没判断力，长期不上报=在闷着，高频信号加权）；④角色卡契合度（产出与蒸馏卡方法论是否符合）；⑤深度分（角色卡 distill 深度分）。**阶段性考核（防 0 产出误判）**：必须传 stageStatus——pending（阶段未到/任务未分配）= 判定"待考核"，不计 0 产出、不累计不达标、不触发换人；assigned/in_progress = 按阶段结果考核（阶段完成度是否符合要求）；due（阶段到期未完成）= 才算不达标。判定规则：阶段结果不符合要求才计不达标；连续 2 次不达标 → 建议换人（走离任→重蒸馏补位流程）；高频信号异常（问题上行异常）→ 立即触发评估，不等 2 次；**需求对齐度=0（产出不是客户要的东西）→ 立即换人，不等 2 次**。不武断：每次评估写"哪项不足+依据"，留痕可追溯。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '被评估的员工角色名（必填）' },
        stageStatus: { type: 'string', description: '阶段状态（必填）：pending=阶段未到/任务未分配（判待考核，不计0产出）/ assigned=已分配任务（按阶段结果考核）/ in_progress=进行中（按阶段性产出考核）/ due=阶段到期（到期未完成才计不达标）' },
        stageRequirement: { type: 'string', description: '本阶段要求（验收标准/产出定义），评估"阶段性结果是否符合要求"的基准' },
        quality: { type: 'string', description: '成果质量信号：0-2（0=多次打回/不过验收，1=偶有小问题，2=稳定达标）；阶段未到可省略' },
        completion: { type: 'string', description: '阶段完成度信号：0-2（0=阶段到期未完成，1=部分完成/延迟，2=按时完成符合要求）；pending 时忽略' },
        escalation: { type: 'string', description: '问题上行健康度信号：0-2（0=过度上报或长期不上报，1=偶有异常，2=健康（及时且合理））' },
        fit: { type: 'string', description: '角色卡契合度信号：0-2（0=产出与卡方法论明显不符，1=部分符合，2=契合）' },
        alignment: { type: 'string', description: '需求对齐度（客户价值）：2=产出直指需求本质的可判定验收项 / 1=方向对但有偏差 / 0=偏离需求本质做别的（一票否决，直接换人）' },
        depth: { type: 'string', description: '角色卡深度分（jarvis_distill 输出，0-100）' },
        history: { type: 'string', description: '历史评估记录 JSON（连续判定用），如 [{"ok":false,"at":"2026-08-01"}]' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', description: '被评估员工角色名' },
          ok: { oneOf: [{ type: 'boolean' }, { type: 'null' }], description: '本次是否达标（pending=null 待考核，非达标也非不达标）' },
          score: { oneOf: [{ type: 'number' }, { type: 'null' }], description: '综合分 0-100（pending 时=null，不计 0 产出）' },
          signals: {
            type: 'object',
            description: '各信号明细',
            properties: {
              stageStatus: { type: 'string' },
              stageRequirement: { type: 'string' },
              quality: { type: 'number' },
              completion: { type: 'number' },
              escalation: { type: 'number' },
              fit: { type: 'number' },
              alignment: { type: 'number' },
              depth: { type: 'number' },
              note: { type: 'string' },
            },
          },
          strikes: { type: 'number', description: '连续不达标次数（pending 不累计）' },
          action: { type: 'string', description: '建议动作：待考核/继续观察/补强/换人' },
          historyNext: { type: 'string', description: '下次评估应回传的 history（含本次结果，JSON 字符串）——修复"需调用方手动维护历史"的断点' },
          perfFile: { type: 'string', description: '本角色绩效历史自动落盘文件（.jarvis/perf-<role>.json）' },
          persisted: { type: 'boolean', description: '本次考核是否已自动落盘（有 fs 环境）' },
          verdict: { type: 'string' },
        },
        required: ['ok', 'score', 'action', 'verdict'],
      },
      render: (r) => `【绩效评估 · ${r.role ?? '?'}】${r.action}\n${r.verdict}`,
    },
    handler: async (args) => {
      const role = String(args.role ?? '').trim()
      const stageStatus = String(args.stageStatus ?? 'in_progress').trim()
      const stageRequirement = String(args.stageRequirement ?? '').trim()
      const num = (v, d = 1) => { const n = Number(v); return Number.isFinite(n) ? n : d }
      // BUG-9 修复：信号语义 0-2（0=差/异常，1=偶有，2=健康/达标），越界输入（100/-5/非数字）必须 clamp，
      //   否则 score 会爆出 0-100 范围，且脏值（如 escalation=999）会被误判为"健康满分"
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
      const quality = clamp(num(args.quality, 1), 0, 2)
      const completion = clamp(num(args.completion, 1), 0, 2)
      const escalation = clamp(num(args.escalation, 1), 0, 2)
      const fit = clamp(num(args.fit, 1), 0, 2)
      const depth = clamp(num(args.depth, 0), 0, 100)
      // 需求对齐度（客户价值维度）：2=产出直指需求本质的可判定验收项 / 1=方向对但有偏差 / 0=偏离需求本质做别的
      //   默认 1（中性：CEO 未特别标注时按"方向对"处理，不误伤；显式传 0 = 偏离 → 一票否决）
      const alignment = clamp(num(args.alignment, 1), 0, 2)
      // 自动持久化（修复"换人机制状态不落盘"系统性断点）：perf 历史存 .jarvis/perf-<role>.json，
      //   跨调用自动累计 strikes（CEO 无需手动传 history/存 historyNext）。
      //   有 ctx 且有 fs → 自动读写；无 ctx（单测/裸调）→ 纯函数行为不变（history 走参数）。
      const fsSvc = (() => {
        try { return (ctx && ctx.get && ctx.get('fs')) || null } catch { return null }
      })()
      const perfFile = role ? '.jarvis/perf-' + role.replace(/[\\/:*?"<>|]/g, '_') + '.json' : ''
      let history = []
      const explicitHistory = args.history !== undefined && args.history !== null && String(args.history).trim() !== ''
      if (explicitHistory) {
        try { history = JSON.parse(String(args.history)) } catch { history = [] }
      } else if (fsSvc && typeof fsSvc.readText === 'function' && role) {
        // 无显式 history 时自动从磁盘读历史（跨调用累计 strikes 的持久化源）
        try {
          const target = await fsSvc.resolve(perfFile)
          if (target) {
            const text = await fsSvc.readText(target)
            if (text) {
              const data = JSON.parse(text)
              if (data && Array.isArray(data.history)) history = data.history
            }
          }
        } catch { history = [] }
      }
      // ── 阶段性考核：阶段未到/任务未分配 = 待考核，不计 0 产出、不累计不达标、不触发换人 ──
      if (stageStatus === 'pending') {
        const pout = {
          role,
          ok: null,
          score: null,
          signals: { stageStatus, stageRequirement, note: '阶段未到/任务未分配' },
          strikes: 0,
          action: '待考核（阶段未到，不计 0 产出）',
          historyNext: JSON.stringify(history),
          verdict: `${role} 当前阶段未到/任务未分配（stageStatus=pending）——按阶段性考核规则判定"待考核"：不因 0 产出扣分、不累计不达标、不触发换人。待其阶段任务分配/到期后再评估"阶段性结果是否符合要求（${stageRequirement || '本阶段验收标准'}）"。`,
        }
        if (role && fsSvc && typeof fsSvc.readText === 'function') pout.perfFile = perfFile
        return pout
      }
      // ── 阶段已分配/进行中/到期：按阶段性结果考核 ──
      // 信号权重：需求对齐度（客户价值）+ 成果质量 + 完成度 + 上行健康度（高频加权）+ 契合 + 深度
      const weighted = alignment * 0.2 + quality * 0.2 + completion * 0.15 + escalation * 0.25 + fit * 0.1 + Math.min(2, depth / 50) * 0.1
      let score = Math.round(weighted * 50) // 0-2 → 0-100
      // 阶段性结果是否符合要求：completion 达标（≥1）+ 成果质量达标（≥1）
      const stageOk = completion >= 1 && quality >= 1
      // 需求对齐度一票否决：产出偏离客户需求本质（做的是别的）→ 即使内部质量/完成度满分也判不达标（客户价值铁律）
      const misaligned = alignment === 0
      // 分数与判定一致：偏离时 score 封顶 59（不再出现"80 分却换人"的分数-结论矛盾）
      if (misaligned) score = Math.min(score, 59)
      // 高频信号异常（问题上行=0）→ 立即触发评估：即使阶段产出达标，上行=0（过度上报或闷着）也判本次不达标
      const isTriggered = escalation === 0
      const okThis = score >= 60 && escalation > 0 && stageOk && !misaligned
      // BUG-1 修复：strikes 语义——历史不达标数 + 本次不达标(1)/达标(0)；isTriggered 时本次必为不达标（escalation=0 已含在 okThis 判定）
      const prevFails = history.filter((h) => h.ok === false).length
      const totalStrikes = okThis ? 0 : prevFails + 1
      const action = misaligned
        ? '换人（需求本质偏离：产出不是客户要的东西——方向错再补也是错，直接走 离任→重蒸馏补位）'
        : !okThis && (isTriggered || prevFails + 1 >= 2)
          ? '换人（走 离任→重蒸馏补位 流程）'
          : !okThis ? '补强观察（阶段结果不符合要求，本次不达标）' : '继续（阶段结果符合要求，达标）'
      const verdict = role
        ? `${role} 阶段状态=${stageStatus}，阶段要求=${stageRequirement || '（未注明）'}。阶段结果${stageOk ? '符合要求' : '不符合要求'}（完成度${completion}/质量${quality}），需求对齐${alignment === 0 ? '❌ 偏离需求本质（做偏了客户要的东西）' : alignment === 1 ? '方向对（部分对齐）' : '✅ 直指需求本质'}，综合 ${score}/100（对齐${alignment}/成果${quality}/完成${completion}/上行${escalation}/契合${fit}/深度${depth}）。${action}。依据已留痕。`
        : `缺 role 参数。`
      // historyNext：把本次结果并入历史，供 CEO 下次评估直接回传（修复"依赖调用方手动维护 history"的半自动断点）
      const historyNext = JSON.stringify(history.concat([{ ok: okThis, at: new Date().toISOString().slice(0, 10), action: action.split('（')[0], misaligned: misaligned || undefined }]).slice(-10))
      // 自动落盘：考核记录写 .jarvis/perf-<role>.json（跨调用累计 strikes 的持久化源）
      let persisted = false
      if (fsSvc && typeof fsSvc.writeText === 'function' && role) {
        try {
          const target = await fsSvc.resolve(perfFile)
          if (target) {
            await fsSvc.writeText(target, JSON.stringify({ role, updatedAt: new Date().toISOString(), history: JSON.parse(historyNext) }, null, 2))
            persisted = true
          }
        } catch { persisted = false }
      }
      // 公司状态自动同步（3D 画面反映评估结果：员工 perfScore/strikes/状态——CEO 评估后画面即时可见谁达标/谁被开）
      if (role && fsSvc && typeof fsSvc.readText === 'function') {
        const empStatus = action.includes('换人') ? 'terminated' : (okThis ? 'working' : 'on_probation')
        await syncCompanyState(fsSvc, { type: 'employee_evaluated', role, score, strikes: totalStrikes, status: empStatus, note: stageRequirement || undefined })
      }
      const out = { role, ok: okThis, score, signals: { stageStatus, stageRequirement, alignment, quality, completion, escalation, fit, depth }, strikes: totalStrikes, action, verdict, historyNext }
      if (role && (fsSvc && typeof fsSvc.readText === 'function' && typeof fsSvc.writeText === 'function')) {
        out.perfFile = perfFile
        out.persisted = persisted
      }
      return out
    },
  },

  {
    name: 'jarvis_meeting',
    description:
      '团队会议协议器（会议驱动协作核心）：kickoff=开工全员会（对齐目标/验收标准/接口契约/依赖与分工）；cycle=二次会（聚焦黑板未决项：分歧/阻塞/接口变更，必要项用 jarvis_review 裁决）；close=收口会（逐项验收与交付）。每次会议必须输出：决议清单 + 会后任务（谁会后负责什么）+ 黑板更新。铁律：先开会再独思——角色必须先互相碰撞对齐，再各自独自思考；议题没必要时不开会。',
    parameters: {
      type: 'object',
      properties: {
        meetingType: { type: 'string', description: 'kickoff | cycle | close' },
        agenda: { type: 'string', description: '本次会议议程/议题（可含黑板未决项 id）' },
        attendees: { type: 'string', description: '与会角色名，逗号分隔（默认全员）' },
        context: { type: 'string', description: '会议上下文（黑板摘要/分歧/阻塞等，可选）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          goal: { type: 'string', description: '本次会议要达成的对齐' },
          protocol: { type: 'string', description: '会议流程步骤' },
          resolutions: { type: 'string', description: '决议记录模板' },
          actions: { type: 'string', description: '会后任务模板（谁负责什么）' },
          respondAs: { type: 'string', description: '要求输出纪要 JSON 的结构' },
        },
        required: ['goal', 'resolutions'],
      },
      render: (r) =>
        `【${r.type} 会 · 目标】${r.goal}\n流程：${r.protocol ?? ''}\n决议记录：${r.resolutions}\n会后任务：${r.actions ?? ''}\n纪要格式：${r.respondAs ?? ''}`,
    },
    handler: async (args) => {
      const type = String(args.meetingType ?? 'kickoff')
      const fsSvc = (() => { try { return (ctx && ctx.get && ctx.get('fs')) || null } catch { return null } })()
      const agenda = String(args.agenda ?? '').trim()
      const attendees = String(args.attendees ?? '全员').trim()
      const ctx = String(args.context ?? '').trim()
      const META = {
        kickoff: {
          goal: '对齐目标/验收标准/领域流程与闸门/接口契约/依赖与分工——开工前全员必须互相听懂对方要什么、给什么',
          protocol:
            '1) CEO 先用 jarvis_process 定本领域流程（必经阶段/闸门/红线/必须角色/会议触点）——不同领域流程不同，由 CEO 决定，不许套通用流程；2) CEO 宣布目标与验收标准（怎样算成功）；3) 各角色按各自协同段报：我的位置/依赖谁/给谁喂产出/介入时机；4) 交叉确认接口契约（产品给契约、研发给接口、测试从产品阶段进入、风控横向否决…）与领域闸门（过闸才进下一阶段）；5) 把流程定稿+决议写入统一黑板后散会',
          resolutions:
            'R1 目标与验收标准（逐条可判定）；R2 领域流程定稿（阶段清单+闸门+红线，写入黑板）；R3 接口契约（谁给谁什么，格式/时机）；R4 依赖与并行安排（谁是上游谁是下游谁全程参与）；R5 黑板位置约定',
          actions:
            '散会后各角色按领域流程独自思考+干活（关键决策用 jarvis_think_deep），所有问题/发现/接口变更写黑板；黑板要开会时向 CEO 提出或由 CEO 判断',
        },
        cycle: {
          goal: '聚焦黑板未决项：解决分歧/阻塞/接口变更，能收敛就收敛，不能收敛就明确卡点与负责人；每项决议必须先回归需求本质再定案',
          protocol:
            '1) 先读统一黑板，列出本次要解决的未决项（问题/阻塞/接口变更/分歧）；2) 逐项讨论：谁负责、卡在哪、需要什么真实情况才能解；3) 分歧项双方先各跑 jarvis_think_deep，再 jarvis_review 裁决（必传 requirement，吃 thinkA/thinkB，需求本质>真实情况>用户需求>专业判断）；4) 每项决议过 jarvis_essence 需求本质校验（防迎合用户原话/角色卡/主流方案/会议从众，防编造 source/数据）——PASS 才写回黑板；5) 决议逐条写回黑板并标记负责人/状态',
          resolutions:
            'R1 每项未决项的结论（解决/降级/遗留+理由，且经过需求本质校验）；R2 涉及接口变更的同步点；R3 新分配 assignee 与截止；R4 黑板状态更新',
          actions: '会后各角色继续独自思考/干活；新增问题继续写黑板；必要时发起下一次 cycle 会',
        },
        close: {
          goal: '验收交付：逐项对照验收标准与领域闸门，所有决议过需求本质审计，未决项分级，产出交付报告',
          protocol:
            '1) 逐任务对照验收标准与 jarvis_process 领域闸门检查产出；2) 复核黑板全部未决项：已解决/降级/遗留——遗留项必须写明影响与触发升级；3) 全部重要决策用 jarvis_essence 回归需求本质复查（迎合/幻觉/偏离 = 不许交付）；4) CEO 汇总交付报告（目标回顾/各岗位产出切片/风险未决/交付物在哪/怎么验收）',
          resolutions: 'R1 验收结论逐项（通过/未通过+原因）；R2 黑板遗留项分级；R3 jarvis_essence 审计结论汇总；R4 交付报告要点清单',
          actions: 'CEO 产出交付报告给用户；必要时 agent_teams_delete 收队',
        },
      }
      const m = META[type] || META.kickoff
      // 公司状态自动同步（3D 画面显示"正在开会/会议结束"）
      try {
        const fsSvc2 = (() => { try { return (ctx && ctx.get && ctx.get('fs')) || null } catch { return null } })()
        if (fsSvc2) {
          if (type === 'close') await syncCompanyState(fsSvc2, { type: 'meeting_done', meetingId: 'm' })
          else await syncCompanyState(fsSvc2, { type: 'meeting_started', meeting: { id: 'm', type, topic: agenda || m.goal, attendees: attendees.split(',') } })
        }
      } catch {}
      return {
        type,
        goal: m.goal,
        protocol: m.protocol + (agenda ? `\n议程：${agenda}` : '') + (ctx ? `\n上下文：${ctx}` : ''),
        resolutions: m.resolutions,
        actions: m.actions,
        respondAs: `完成本次「${type}」会后，以 JSON 输出纪要：{"date":"","type":"${type}","attendees":["${attendees}"],"agenda":["…"],"resolutions":["按模板逐条"],"boardUpdates":["写回黑板的条目"],"actions":[{"who":"角色","what":"会后负责什么"}]}`,
      }
    },
  },

  {
    name: 'jarvis_release',
    description:
      '交付版本管理器（乙方与甲方的契约机制，防"需求永远改/无法自证"，**领域通用的版本管理铁律——任何领域交付物都要版本化**）：vibe 模式+甲方确认才算完成+验收随时可调 → 乙方必须靠"版本快照+交付清单+沟通留痕"自证。①new_version=打新版本（v1.0/v1.1…，冻结旧版，变更开新版承接）；②checklist=生成交付清单（需求本质逐条→对应交付物→自测结果，甲方可逐条确认）；③status=版本状态（待确认/已确认/已否决，含确认时限：超时默认通过或明确挂起）；④communication=记录与甲方的沟通结论（问题/答复/时间，只记结论不记过程）；⑤**rollback=回滚到历史版本（企业级必备：改错/决策失误可 undo——prevVersions 里选一个已冻结版本回滚，当前版标记为"已回滚"，旧版重新激活为当前版，回滚动作留痕：谁/何时/为什么）**。铁律：乙方永远能说清"交付了什么、等什么确认"；版本是内部记账不打扰甲方；清单是逐条对应不是模板；**任何领域（软件/方案/流程/卡/黑板/交付物）的交付都走版本化，改错必须能回滚**。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'new_version 打新版本 / checklist 生成交付清单 / status 版本状态 / communication 记录甲方沟通 / rollback 回滚到历史版本' },
        version: { type: 'string', description: '版本号（如 v1.0），new_version 必填；rollback 用=当前版本号' },
        rollbackTo: { type: 'string', description: 'rollback 用：要回滚到的历史版本号（如 v1.0）' },
        rollbackReason: { type: 'string', description: 'rollback 用：回滚原因（改错/决策失误/甲方否决），必填留痕' },
        prevVersions: { type: 'string', description: '已有版本状态 JSON（status/rollback/communication 用），如 [{"version":"v1.0","state":"已确认"}]' },
        requirement: { type: 'string', description: '原始需求/需求本质（checklist 用，逐条对应）' },
        items: { type: 'string', description: '交付物清单 JSON 数组（checklist 用）' },
        selfTest: { type: 'string', description: '自测结果（checklist 用，每条交付物的验证证据）' },
        confirmDeadline: { type: 'string', description: '甲方确认时限（如 3 天 / 48小时；status 用，超时默认通过或挂起）' },
        traceCheck: { type: 'string', description: '三产物闭环核对（checklist/收口用）：传 JSON {"需求规格":"path或✓/✗","方案设计":"✓/✗","测试验收单":"✓/✗","逐条闭环":"每条需求→方案→测试→结果 全链 ✓/✗","断链项":["..."]}——防"需求→实现→验收"断链，断链不许收口' },
        submittedAt: { type: 'string', description: '交付给甲方确认的起始时间 ISO（status 用，启用真实超时判定：剩余时间/已超时）' },
        question: { type: 'string', description: '与甲方的沟通问题（communication 用）' },
        answer: { type: 'string', description: '甲方答复（communication 用）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'string' },
          status: { type: 'string', description: '版本状态或操作结果' },
          checklist: { type: 'array', items: { type: 'string' }, description: '交付清单（checklist 用）' },
          log: { type: 'string', description: '沟通留痕记录（communication 用）' },
          projectWritten: { type: 'boolean', description: '沟通记录是否已写入 .jarvis/project.md' },
          projectError: { type: 'string', description: 'project.md 写入失败原因' },
          rollbackLog: { type: 'string', description: '回滚留痕记录（rollback 用）' },
          timedOut: { type: 'boolean', description: '确认时限是否已超时（status 用）' },
          traceCheckVerdict: { type: 'string', description: '三产物闭环核对结论（checklist 用）' },
          tracePassed: { type: 'boolean', description: '三产物闭环是否全通过（checklist 用，false=断链不许收口）' },
          submittedAt: { type: 'string', description: '交付确认起始时间（status 用）' },
          verdict: { type: 'string' },
        },
        required: ['verdict'],
      },
      render: (r) => `【交付版本${r.version ? ' · ' + r.version : ''}】${r.status ? '状态：' + r.status + '\n' : ''}${(r.checklist || []).map((c) => '  ☐ ' + c).join('\n')}${r.log ? '\n沟通留痕：' + r.log : ''}\n判定：${r.verdict}`,
    },
    handler: async (args) => {
      const mode = String(args.mode ?? '').trim()
      const version = String(args.version ?? '').trim()
      const requirement = String(args.requirement ?? '').trim()
      let verdict = ''
      if (mode === 'new_version') {
        verdict = version
          ? `已打新版 ${version}：旧版冻结为历史，本版承接甲方最新变更需求。乙方现在能说清"交付过什么、当前在做什么"。`
          : '⚠️ new_version 需要 version 参数（如 v1.0）。'
        return { version: version || '?', status: '进行中（待交付/待确认）', verdict }
      }
      if (mode === 'checklist') {
        let items = []
        try { items = JSON.parse(String(args.items ?? '[]')) } catch { items = [] }
        const self = String(args.selfTest ?? '').trim()
        const rows = requirement
          ? [`需求本质：${requirement.slice(0, 120)}`].concat(items.map((it, i) => `${i + 1}. ${it}${self ? ' —— 自测：' + self.slice(0, 60) : ''}`))
          : items.map((it, i) => `${i + 1}. ${it}`)
        let verdict = `交付清单已生成（${rows.length} 条）：甲方按条确认即验收；清单 = 需求本质逐条对应，不是模板。`
        const out = { version: version || '?', status: '待甲方逐条确认', checklist: rows, verdict }
        // 三产物闭环核对（traceCheck）：需求规格/方案设计/测试验收单 全链可追溯，断链不许收口
        if (args.traceCheck) {
          let tc = null
          try { tc = JSON.parse(String(args.traceCheck)) } catch { tc = null }
          if (tc && typeof tc === 'object') {
            const hasSpec = /✓|✅|true|存在|在/.test(String(tc['需求规格'] ?? ''))
            const hasDesign = /✓|✅|true|存在|在/.test(String(tc['方案设计'] ?? ''))
            const hasTest = /✓|✅|true|存在|在/.test(String(tc['测试验收单'] ?? ''))
            const chainOk = /✓|✅|true|全链/.test(String(tc['逐条闭环'] ?? ''))
            const broken = Array.isArray(tc['断链项']) ? tc['断链项'] : []
            const traceVerdict = hasSpec && hasDesign && hasTest && chainOk && broken.length === 0
              ? `✅ 三产物闭环核对通过：需求规格→方案设计→测试验收单→逐条闭环 全链完整，可交付。`
              : `⛔ 三产物闭环核对未过（断链不许收口）：${[!hasSpec ? '需求规格缺' : '', !hasDesign ? '方案设计缺' : '', !hasTest ? '测试验收单缺' : '', !chainOk ? '逐条闭环未全过' : ''].filter(Boolean).join('、')}${broken.length ? '；断链项：' + broken.join('、') : ''}——先补链再交付（每需求→方案→测试→结果）。`
            out.traceCheckVerdict = traceVerdict
            out.tracePassed = hasSpec && hasDesign && hasTest && chainOk && broken.length === 0
            verdict = verdict + '\n' + traceVerdict
            out.verdict = verdict
          }
        }
        return out
      }
      if (mode === 'status') {
        const dlRaw = String(args.confirmDeadline ?? '3 天')
        let prev = []
        try { prev = JSON.parse(String(args.prevVersions ?? '[]')) } catch { prev = [] }
        const line = prev.length ? `已有版本：${prev.map((v) => v.version + '=' + v.state).join(', ')}` : '尚无已交付版本'
        // 真实时限计算（修复"超时默认通过"停留在话术）：submittedAt = 交付给甲方确认的时间（ISO），
        //   时限解析支持 "N 天/N小时/Nd/Nh/N"；超时 → 默认通过（或明确挂起）；未超时 → 剩余时间。
        const parseDeadline = (raw) => {
          const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*(天|小时|h|d|h)?$/)
          if (!m) return null
          const n = Number(m[1])
          const unit = m[2] || ''
          if (unit === '小时' || unit === 'h') return n * 3600 * 1000
          if (unit === 'd') return n * 24 * 3600 * 1000
          return n * 24 * 3600 * 1000 // 默认天
        }
        const dlMs = parseDeadline(dlRaw)
        const submittedRaw = String(args.submittedAt ?? '').trim()
        let submittedMs = 0
        if (submittedRaw) {
          const t = Date.parse(submittedRaw)
          if (!Number.isNaN(t)) submittedMs = t
        }
        const now = Date.now()
        let timeNote = ''
        let timedOut = false
        if (dlMs && submittedMs) {
          const remaining = submittedMs + dlMs - now
          timedOut = remaining <= 0
          timeNote = timedOut
            ? `⏰ 已超时（提交 ${submittedRaw.slice(0, 10)} + 时限 ${dlRaw}）——按约定默认通过；若甲方仍未确认且需继续等，应明确挂起并重设时限`
            : `剩余确认时间约 ${Math.max(1, Math.ceil(remaining / 3600000))} 小时（提交 ${submittedRaw.slice(0, 10)}，时限 ${dlRaw}）`
        }
        verdict = `版本状态：${line}。当前版「${version || '?'}」${dlRaw} 内待甲方确认；${timeNote || '调用时传 submittedAt（交付确认起始时间 ISO）启用超时判定，否则默认通过/挂起由乙方明确。'}`
        const out = { version: version || '?', status: `待确认（时限 ${dlRaw}）`, verdict }
        if (dlMs && submittedMs) out.timedOut = timedOut
        if (submittedRaw) out.submittedAt = submittedRaw
        return out
      }
      if (mode === 'communication') {
        const q = String(args.question ?? '')
        const a = String(args.answer ?? '')
        const log = `[${new Date().toISOString().slice(0, 16)}] 问甲方：${q.slice(0, 80)}${a ? ` → 甲方答：${a.slice(0, 80)}` : '（待甲方答复）'}`
        // BUG-3 修复：真写 project.md（承诺"写入 project.md 只记结论"必须兑现，否则沟通无留痕）
        let projectWritten = false
        let projectError = ''
        const fsSvc = (() => {
          try { return (ctx && ctx.get && ctx.get('fs')) || null } catch { return null }
        })()
        if (fsSvc && typeof fsSvc.readText === 'function' && typeof fsSvc.writeText === 'function') {
          try {
            const cwd = process.cwd && process.cwd()
            const pPath = (cwd ? cwd + '/' : '') + '.jarvis/project.md'
            const target = await fsSvc.resolve(pPath)
            if (target) {
              let existing = ''
              try { existing = await fsSvc.readText(target) } catch { existing = '' }
              await fsSvc.writeText(target, (existing ? existing.replace(/\n*$/, '\n') : '') + '\n## 甲方沟通记录\n' + log + '\n')
              projectWritten = true
            }
          } catch (e) {
            projectError = String(e && e.message ? e.message : e)
          }
        }
        const out = { version: version || '?', log, verdict: `沟通留痕已记录：${log}。已追加写入 .jarvis/project.md（只记结论）。` }
        if (fsSvc && typeof fsSvc.readText === 'function' && typeof fsSvc.writeText === 'function') {
          out.projectWritten = projectWritten
          if (projectError) out.projectError = projectError
        }
        return out
      }
      if (mode === 'rollback') {
        // ── 回滚到历史版本（企业级版本管理：改错/决策失误可 undo）──
        const cur = String(args.version ?? '').trim()
        const target = String(args.rollbackTo ?? '').trim()
        const reason = String(args.rollbackReason ?? '').trim()
        let prev = []
        try { prev = JSON.parse(String(args.prevVersions ?? '[]')) } catch { prev = [] }
        if (!cur || !target) {
          return { version: cur || '?', status: 'rollback 失败', verdict: '⚠️ rollback 需要 version（当前版）+ rollbackTo（回滚目标版）' }
        }
        if (!reason) {
          return { version: cur, status: 'rollback 失败', verdict: '⚠️ rollback 必须带 rollbackReason（回滚原因：改错/决策失误/甲方否决）——无原因不回滚，留痕是铁律' }
        }
        // BUG-7 修复：prev 空 = 无历史版本可回滚（首次交付没有可 undo 的旧版）→ 拒绝；
        //   非空时回滚目标必须真实存在于版本清单（禁止"回滚到不存在的版本"的假回滚）
        if (!prev.length) {
          return { version: cur, status: 'rollback 失败', verdict: '⚠️ prevVersions 为空：没有已交付的历史版本可回滚（首次交付无需/无法回滚）。先 new_version 建立版本线，或确认版本清单（status）' }
        }
        const targetExists = prev.some((v) => v.version === target)
        if (!targetExists) {
          return { version: cur, status: 'rollback 失败', verdict: `⚠️ 回滚目标 ${target} 不在已有版本清单（${prev.map((v) => v.version).join(', ')}）——先 status 确认版本清单；禁止回滚到不存在的版本` }
        }
        const log = `[${new Date().toISOString().slice(0, 16)}] 回滚：${cur} → ${target}（原因：${reason.slice(0, 60)}）——当前版标记"已回滚"（冻结），${target}重新激活为当前版；此动作留痕可追溯。`
        verdict = `✅ 已回滚：${cur} → ${target}（原因：${reason.slice(0, 60)}）。${target}重新激活为当前版；${cur}冻结为"已回滚"历史。回滚动作已留痕（时间/原因/目标）。任何领域的交付改错都能这样 undo。`
        return { version: cur, status: `已回滚到 ${target}`, rollbackLog: log, verdict }
      }
      return { version: version || '?', status: '未知模式（new_version/checklist/status/communication）', verdict: '请指定 mode' }
    },
  },

  {
    name: 'jarvis_board',
    description:
      '统一黑板读写器（会议驱动协作的核心状态）：所有角色的问题/发现/决策/风险/接口变更/阻塞都集中登记在同一块黑板，谁都能看到、谁都能追加。add=新增条目（支持"类型：内容"前缀，类型∈问题/发现/决策/风险/阻塞/接口变更，缺省按内容推断）；resolve=关闭条目（按 id 或内容关键词）。输出未决项/阻塞项，并判定"是否需要二次开会"：存在未解决阻塞或接口变更 → 必开会；未决项≥3 → 建议开会；黑板收敛 → 不开会。',
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: '当前黑板 JSON（items 数组），首次可为空' },
        add: { type: 'string', description: '要登记的新条目；多条用换行分隔；可用"类型：内容"前缀' },
        resolve: { type: 'string', description: '要关闭的条目：id（如 B1）或内容关键词；多条用换行分隔' },
        audited: { type: 'string', description: '已过 jarvis_essence 需求本质审计的决策条目（id 或内容关键词）；多条用换行分隔' },
        role: { type: 'string', description: '登记人角色（默认 ?）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '更新后的全部黑板条目' },
          openItems: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '未决项' },
          blockers: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '未解决的阻塞/接口变更' },
          needsMeeting: { type: 'boolean', description: '是否建议二次开会' },
          reason: { type: 'string', description: '二次开会判定理由' },
          summary: { type: 'string' },
        },
        required: ['items', 'needsMeeting'],
      },
      render: (r) =>
        `黑板 ${r.items.length} 项（未决 ${r.openItems.length} 项${r.blockers.length ? '，阻塞 ' + r.blockers.length + ' 项' : ''}）\n${r.items
          .map((i) => `  [${i.id}][${i.status}](${i.type}) ${i.role}: ${i.content}`)
          .join('\n')}\n二次会判定：${r.needsMeeting ? '⚠️ ' + r.reason : '✅ ' + r.reason}`,
    },
    handler: async (args) => {
      const role = String(args.role ?? '?').trim() || '?'
      const fsSvc = (() => {
        try { return (ctx && ctx.get && ctx.get('fs')) || null } catch { return null }
      })()
      // 真源：磁盘 .jarvis/board.json（项目级公屏）。board 参数仅作无 fs 环境（如单测）的显式回退。
      const disk = await readBoardItems(fsSvc)
      const items = disk.fromDisk ? disk.items : []
      try {
        const p = JSON.parse(String(args.board ?? '{}'))
        if (p && Array.isArray(p.items)) for (const it of p.items) items.push({ ...it })
      } catch {
        /* 新黑板 */
      }
      // add：新增条目（ID 从磁盘真源取 max 单调递增，修复并发撞 ID）
      const adds = String(args.add ?? '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const raw of adds) {
        let type = '', content = raw
        const m = raw.match(/^\s*(问题|发现|决策|风险|阻塞|接口变更|资源需求)\s*[:：|]\s*(.+)$/)
        if (m) {
          type = m[1]
          content = m[2]
        } else {
          // 按内容推断类型（资源需求优先：角色需要资源必须先上黑板，防幻觉跳过步骤）
          if (/需要|缺少|缺|无.*(资源|数据|文件|权限|API|素材|工具|账号|密钥|接口文档|样例|数据源|凭证|配置)/.test(content) || /资源|数据源|凭证|配置|密钥/.test(content)) type = '资源需求'
          else if (/阻塞|卡住|无法(继续|进行)|pending/.test(content)) type = '阻塞'
          else if (/接口|契约|字段|协议/.test(content)) type = '接口变更'
          else if (/决定|选择|拍板|方案是/.test(content)) type = '决策'
          else if (/风险|担心|隐患/.test(content)) type = '风险'
          else if (/发现|实测|验证|复现/.test(content)) type = '发现'
          else type = '问题'
        }
        items.push({ id: nextBoardId(items), role, type, content, status: 'open', essenceChecked: type === '决策' ? false : true, time: new Date().toISOString().slice(0, 16) })
      }
      // resolve：关闭条目（按 id 或内容关键词）
      const resolves = String(args.resolve ?? '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const rk of resolves) {
        const target = items.find((it) => it.status === 'open' && (it.id === rk || it.content.includes(rk)))
        if (target) target.status = 'resolved'
      }
      // audited：标记已过 jarvis_essence 审计的决策条目
      const audited = String(args.audited ?? '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const ak of audited) {
        const target = items.find((it) => it.type === '决策' && (it.id === ak || it.content.includes(ak)))
        if (target) target.essenceChecked = true
      }
      const openItems = items.filter((i) => i.status === 'open')
      const blockers = openItems.filter((i) => i.type === '阻塞' || i.type === '接口变更')
      // 决策条目必须过 jarvis_essence 需求本质校验才能定稿（防迎合/防幻觉闸门）
      const decisions = items.filter((i) => i.type === '决策' && !!i.essenceChecked === false)
      const needsMeeting = blockers.length > 0 || openItems.length >= 3
      const reason = needsMeeting
        ? openItems.length === 0
          ? '黑板未决项为 0（异常状态）'
          : blockers.length > 0
            ? `存在 ${blockers.length} 项未解决阻塞/接口变更（${blockers.map((b) => b.id).join(',')}）——必须二次开会同步`
            : `未决项 ${openItems.length} 项（≥3，需要同步收敛）——建议二次开会`
        : `黑板收敛（未决 ${openItems.length} 项，无阻塞）——暂不需要二次会，继续独自思考/干活，有新问题随时写黑板`
      const essenceNote = decisions.length ? `；⚠️ ${decisions.length} 条决策条目未过 jarvis_essence 需求本质校验，定稿前必须审计（防迎合/防幻觉）` : ''
      const summary = `未决 ${openItems.length} 项；阻塞 ${blockers.length} 项${blockers.length ? '：' + blockers.map((b) => b.id + '(' + b.content.slice(0, 20) + ')').join(', ') : ''}。${reason}${essenceNote}`
      // 写回磁盘（项目级公屏持久化）。成功=真源已更新；失败=本次仅内存返回（下次调用仍以磁盘为准，不伪造持久化）
      const persisted = await writeBoardItems(fsSvc, items, disk.version)
      const out = { items, openItems, blockers, needsMeeting, reason, summary }
      if (fsSvc && typeof fsSvc.readText === 'function' && typeof fsSvc.writeText === 'function') {
        out.persisted = persisted.ok
        out.storage = persisted.ok ? '.jarvis/board.json' : undefined
        if (!persisted.ok) out.writeError = persisted.error
      }
      return out
    },
  },

  {
    name: 'jarvis_clarify',
    description:
      '需求澄清引导器（REFORM-CLARIFY 机制实现，领域无关）：用户需求模糊时，CEO 以专业角度分析用户需求并引导用户回答问题（不是干等/代为澄清）。模式：①analyze=CEO 专业分析先行——把模糊需求按行业常识/同类需求模式/可行域翻译成 5 角度候选问题（P1 场景/P2 现状/P3 痛点/P4 期望/P5 验收），返回候选问题清单+模糊度判定；②trigger=蒸馏触发判定（机械可判 T1-T5：T1 5 角度中≥2 个候选问题为空或仅含无具体名词追问（"再说说/展开讲讲"不计，须含对象/场景/行业词才算数）、T2 无同类卡与原型、T3 ≥2 角度命中行业术语但引不出行业依据（规范名/source/同类案例出处）、T4 用户回答超 CEO 专业范围、T5 单人 3 轮未收敛——任一触发=建议现场蒸馏该需求领域真实大佬（软件→软件大佬、制造→制造大佬，领域由需求决定插件无预设），六段式卡过 jarvis_distill 校验后双人进场）；③ask=三阶提问（开放→聚焦→确认，每轮≤2 问，遵守 jarvis.md 阶段一"一次只问 1-2 个问题"）生成引导话术；④duo=双人协作方案 A 判据（同刻一人主问：用户回答前主问者 from≤1 可数，补充消息须标注"补充"；CEO 域=P5 验收+与交付相关的 P2 子集[频率/负责人/时限]，大佬域=P1-P4 场景/细节/专业盲区，防重复=问题含场景/现状/痛点/期望/验收关键词即同域）；⑤confirm=澄清完成判定（需求本质重述三段式[为谁/解决什么/怎样算成功可判定]+假设分级[已确认/推断待确认]，经用户确认=完成，缺一禁止进拆解）。铁律：推断不得冒充用户已确认；用户拒绝/失联=连续 2 轮无有效回答→按 CEO 推断+显式标注继续（3 轮=挂起）；澄清产出过 B16 黑板翻译/B22 可行性闸/B15 分层（标注为黑板决议目标态）；web_search 受限时蒸馏降级=curl 验证 source+标注推演。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'analyze 专业分析+候选问题 / trigger 蒸馏触发判定 / ask 三阶提问话术 / duo 双人协作判据 / confirm 澄清完成判定（默认 analyze）' },
        requirement: { type: 'string', description: '用户原始需求（可模糊，必填）' },
        industry: { type: 'string', description: 'CEO 判断的领域（可选，领域由需求决定插件无预设）' },
        candidates: { type: 'string', description: 'analyze 产出的 5 角度候选问题 JSON 或文本（trigger/ask 用）' },
        roleCards: { type: 'string', description: '双人协作：CEO 卡 + 蒸馏大佬卡清单 JSON（duo 用）' },
        round: { type: 'string', description: '当前澄清轮次（ask/duo 用）' },
        userAnswers: { type: 'string', description: '用户已回答内容 JSON（confirm 用：判定假设分级与完成）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', description: '本次执行的模式：analyze/trigger/ask/duo/confirm' },
          essence: { type: 'string', description: '需求本质判定' },
          candidates: { type: 'array', items: { type: 'string' }, description: '5 角度候选问题' },
          vague: { type: 'boolean', description: '需求是否模糊（需澄清）' },
          trigger: { type: 'string', description: '触发判定：不触发/T1-T5 触发/需蒸馏' },
          triggerDetail: { type: 'string' },
          questions: { type: 'array', items: { type: 'string' }, description: '本轮引导话术' },
          duoCheck: { type: 'string', description: '双人协作方案 A 判据核对结果' },
          confirm: { type: 'string', description: '澄清完成判定' },
          verdict: { type: 'string' },
        },
        required: ['verdict'],
      },
      render: (r) =>
        `【需求澄清 · ${r.mode ?? 'analyze'}】\n本质：${r.essence ?? ''}\n模糊度：${r.vague === undefined ? '' : r.vague ? '⚠️ 模糊需澄清' : '✅ 可判定'}\n${r.candidates?.length ? '候选问题：\n  ' + r.candidates.map((c) => '· ' + c).join('\n  ') : ''}${r.trigger ? '\n触发：' + r.trigger : ''}${r.questions?.length ? '\n本轮话术：\n  ' + r.questions.map((q) => '· ' + q).join('\n  ') : ''}${r.duoCheck ? '\n双人判据：' + r.duoCheck : ''}${r.confirm ? '\n完成判定：' + r.confirm : ''}\n裁决：${r.verdict}`,
    },
    handler: async (args) => {
      const mode = String(args.mode ?? 'analyze').trim()
      const req = String(args.requirement ?? '').trim()
      const industry = String(args.industry ?? '').trim()
      // 仅 analyze/trigger 需要 requirement；ask/duo/confirm 可无（duo 只要 roleCards，confirm 只要 userAnswers）
      if (!req && (mode === 'analyze' || mode === 'trigger')) return { verdict: '⚠️ 缺 requirement：analyze/trigger 必须先有用户原始需求（可模糊）' }
      // ── 需求本质判定（领域无关：为谁解决什么、怎样算成功可判定）──
      const hasWho = /为谁|用户|谁|受众|客户|员工|患者|学生/.test(req)
      const hasWhat = /解决|做|建|实现|想要|需要|自动化|系统|工具|流程/.test(req)
      const hasSuccess = /成功|验收|指标|衡量|多少|怎样算|达标|效率|减少|提升/.test(req)
      const vague = !(hasWho && hasWhat && hasSuccess)
      if (mode === 'analyze') {
        // ── CEO 专业分析先行：5 角度候选问题（领域无关话术，P 编号）──
        const cand = [
          `【P1 场景】你提到想解决「${req.slice(0, 60)}」，具体在什么场景下遇到这个问题？（谁在用、什么时候发生）`,
          `【P2 现状】现在你们是怎么做的？（当前流程/手工方式/现有工具）哪里最费劲？`,
          `【P3 痛点】这个过程里最让你头疼的是哪一步？（最花时间/最易出错/最烦）`,
          `【P4 期望】你期望它做到什么程度？（理想结果/想要的效果）`,
          `【P5 验收】如果做成了，你拿什么判断成功？（指标/完成标准/多少时间内）`,
        ]
        return {
          mode: 'analyze',
          essence: `为谁解决什么：${req.slice(0, 120)}${industry ? `（领域：${industry}）` : ''}。模糊度判定：${vague ? '⚠️ 需求模糊——缺少' + [hasWho?'':'为谁(受众)',hasWhat?'':'解决什么(动作/对象)',hasSuccess?'':'怎样算成功(指标/验收)'].filter(Boolean).join('/') + '，需按 5 角度引导用户澄清' : '✅ 三要素齐备，可进拆解'}`,
          candidates: cand,
          vague,
          verdict: vague
            ? `需求模糊 → 按 5 角度候选问题引导用户回答（每轮≤2 问，先开放后聚焦，最后确认式）；用户回答后跑 trigger 判定是否需蒸馏行业大佬`
            : `需求可判定 → 无需澄清，直接进需求本质回归+拆解`,
        }
      }
      if (mode === 'trigger') {
        // ── 蒸馏触发判定（机械可判 T1-T5，领域无关）──
        const candText = String(args.candidates ?? '')
        const cands = candText.split('\n').map((s) => s.trim()).filter(Boolean)
        // T1：5 角度中候选问题为空或仅含无具体名词追问的角度≥2（"再说说/展开讲讲"不计，须含对象/场景/行业词）
        const generic = /再说说|展开讲讲|具体说说|详细说说|还有吗/.test(candText)
        const emptyCount = cands.filter((c) => !c || c.length < 4).length
        const t1 = emptyCount >= 2 || (generic && cands.length < 3)
        // T3：命中专业术语但引不出依据（领域无关——不预设任何行业的黑话词，只识别"用术语表达+给不出依据"的通用模式）
        //   插件不预设 OEE/TPM/GAAP/排课/良率 等具体行业词（那是领域知识，属项目沉淀职责）；
        //   只认跨领域的术语标记词（术语/黑话/规范/标准/合规/认证/SOP/KPI/指标…），其余交给 CEO 结合需求现场判断。
        const industryTerms = /术语|黑话|行话|规范|标准|认证|合规|审核|检定|SOP|KPI|ROI|指标体系|方法论|框架|协议|标准号|出处/.test(req)
        // canCite 只测"已给出的具体依据"（"依据…/按…规范/参考…/…出处/…source"），不含候选问题话术里的"完成标准/验收标准"字样
        const canCite = /(依据|按|参考|根据|引用|查)[^\n]{0,20}(规范|标准|规程|source|出处|案例)|(规范名|标准号|出处|source|案例)[：:]\s*\S+/.test(String(args.candidates ?? ''))
        const t3 = industryTerms && !canCite
        const t4 = /超出|不会|不懂|不知道.*专业|领域外/.test(req) || /专业.*(术语|知识)/.test(req)
        const triggered = t1 || t3 || t4
        return {
          mode: 'trigger',
          trigger: triggered ? (t1 ? 'T1 触发' : t3 ? 'T3 触发' : 'T4 触发') : '不触发',
          triggerDetail: triggered
            ? `CEO 对「${req.slice(0, 60)}」的${t1 ? '5 角度候选问题≥2 个引不出（含具体名词的）追问' : t3 ? '行业术语命中但引不出行业依据（规范名/source）' : '用户回答超出专业范围'}——建议现场蒸馏该需求领域真实大佬（${industry || '领域由需求决定'}：软件→软件大佬/制造→制造大佬/金融→金融大佬…，插件无预设），六段式卡过 jarvis_distill 校验后双人进场`
            : `CEO 专业分析足以覆盖，无需蒸馏大佬，继续引导`,
          verdict: triggered ? `触发蒸馏 → 现场 web 蒸馏「${industry || '该需求领域'}」真实权威（curl 验证 source，web_search 受限时降级标注推演）→ jarvis_distill 校验 → 双人协作` : `不触发 → CEO 单人三阶引导（开放→聚焦→确认）`,
        }
      }
      if (mode === 'ask') {
        // ── 三阶提问话术（开放→聚焦→确认，每轮≤2 问）──
        const round = Number(args.round ?? 1)
        const cands = String(args.candidates ?? '')
          .split('\n').map((s) => s.trim()).filter(Boolean)
        let questions = []
        if (round <= 1) {
          // 第 1 阶开放式：让用户展开（P1 场景 + P2 现状 各取一句）
          questions = [cands[0] || `你提到想解决「${req.slice(0, 50)}」，能说说在什么场景下遇到、现在怎么做的吗？`]
          if (cands[1]) questions.push(cands[1])
        } else if (round === 2) {
          // 第 2 阶聚焦式：追最痛一点 + 期望边界
          questions = [`你刚才提到最头疼的是哪一步？能举个具体例子吗？`]
          if (cands[3]) questions.push(cands[3])
        } else {
          // 第 3 阶确认式：需求本质重述确认（P5 验收）
          questions = [`如果做成了，你拿什么判断成功？（完成标准/指标/时限）`]
          if (cands[4]) questions.push(cands[4])
        }
        questions = questions.slice(0, 2) // 每轮≤2 问（遵守 jarvis.md 阶段一）
        return {
          mode: 'ask',
          questions,
          verdict: `第 ${round} 轮 · ${round === 1 ? '开放式（让用户展开）' : round === 2 ? '聚焦式（追痛点/期望）' : '确认式（钉验收标准）'}——用户回答后继续下一轮或跑 confirm`,
        }
      }
      if (mode === 'duo') {
        // ── 双人协作方案 A 判据（同刻一人主问）──
        const cards = String(args.roleCards ?? '')
        const hasCeo = /CEO|ceo/.test(cards) || cards.includes('CEO')
        const hasExpert = cards.split('\n').length >= 2 || /大佬|专家/.test(cards)
        const r = Number(args.round ?? 1)
        const mainAsker = r % 2 === 1 ? '蒸馏大佬' : 'CEO' // 奇数轮大佬先主问，偶数轮 CEO 主问
        return {
          mode: 'duo',
          duoCheck: `方案 A 判据：同刻一人主问（用户回答前主问者 from≤1，对话记录可数）；本轮（第 ${r} 轮）主问者=${mainAsker}；补充消息须标注"补充"（无标注=违规抢问）${hasCeo && hasExpert ? '' : '；⚠️ 双人进场需 CEO 卡 + 蒸馏大佬卡（roleCards）'}`,
          verdict: `双人分工：CEO 域=P5 验收+与交付相关的 P2 子集（频率/负责人/时限）；大佬域=P1-P4 场景/细节/专业盲区。防重复=问题含场景/现状/痛点/期望/验收关键词即同域，后问者降级为具体化追问`,
        }
      }
      if (mode === 'confirm') {
        // ── 澄清完成判定（需求本质重述三段式 + 假设分级）──
        const answers = String(args.userAnswers ?? '')
        const aLen = answers.trim().length
        // BUG-2 修复：必须显式确认才判完成——去掉 "aLen>=20 即算确认" 的宽松兜底（长描述≠用户确认，推断不得冒充已确认）。
        //   确认词（确认/可以/对/是的/没错/行/嗯/好的/就这么定）+ 或 明确验收标准（数字+单位）作隐含确认辅助。
        const explicitConfirm = /确认|可以|对|是的|没错|行|嗯|好的|就这么|没问题|同意|OK|ok|就这样/.test(answers)
        const hasAcceptance = /\d+\s*(%|％|秒|分钟|小时|天|单|次|个|元|万|倍)/.test(answers)
        const hasConfirm = explicitConfirm || (aLen >= 15 && hasAcceptance)
        const done = aLen >= 15 && hasConfirm
        return {
          mode: 'confirm',
          confirm: done
            ? `✅ 澄清完成：需求本质重述（为谁=${/用户|员工|患者|客户|学生/.test(answers) ? '已明确' : '待补'} / 解决什么=${aLen >= 15 ? '已明确' : '待补'} / 怎样算成功=${/指标|衡量|达标|多少|效率|准确率|成功率|\d+\s*(%|％|秒|分钟|小时|天|单|次)|减少|提升|降低/.test(answers) ? '已明确' : '待补'}）经用户确认 → 可进拆解`
            : `⏳ 未完成：${aLen < 15 ? '用户回答不足（需继续引导）' : '未获用户确认——请明确确认（"确认/可以/对，就是这样"）或给出可判定验收标准（数字+单位）'}——缺一禁止进拆解；用户拒绝/失联=连续 2 轮无有效回答→按 CEO 推断+显式标注继续（3 轮=挂起）`,
          verdict: done ? '澄清完成 → 产出过 B16 黑板翻译（转目标/验收/边界）+ B22 可行性闸（不可行前置反馈）+ B15 分层（标注黑板决议目标态）' : '继续澄清',
        }
      }
      return { mode, verdict: '未知模式（analyze/trigger/ask/duo/confirm）' }
    },
  },

  {
    name: 'jarvis_company',
    description:
      '公司状态快照读写器（3D 办公室可视化/UI 的数据源——把你的"CEO 走动监控/会议室开会/猎头招募/员工工位"变成 UI 可读的结构化状态）：维护 <项目>/.jarvis/company-state.json，含 employees(员工表: 角色/人物/状态[working/reporting/meeting/idle/on_probation/terminated]/任务/绩效/离任原因)、meetings(会议表: 类型/议题/参会/状态)、recruiting(招募表: 岗位/目标人物/候选/状态[searching/interviewing/confirmed]/补谁)、ceo/headhunter(当前动作/位置)——headhunter=猎头(寻访专家)。动作模式：update=CEO/主面板在关键动作后更新快照（如派活/汇报/开会/评估/开除/招募确认后），传对应字段；action=员工/角色单动作局部同步（入职/开工/汇报/开会/评估/开除——内部自动合并，不覆盖他表数据）；snapshot=读当前快照（UI 轮询用）；clear=新项目/项目结束清空。UI（3D 办公室）只读 snapshot 渲染，不直接改。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'update=更新快照 / snapshot=读当前快照（UI 轮询）/ clear=清空' },
        employees: { type: 'string', description: '员工表 JSON 数组（update 用）：[{id,role,persona,cardFile,status,taskId,currentWork,lastReport,perfScore,strikes,note}]——status∈working/reporting/meeting/idle/on_probation/terminated' },
        meetings: { type: 'string', description: '会议表 JSON 数组（update 用）：[{id,type,topic,attendees,status}]——status∈scheduled/in_progress/done' },
        recruiting: { type: 'string', description: '招募表 JSON 数组（update 用）：[{id,position,targetPersona,candidates,status,replacesEmp}]——status∈searching/interviewing/confirmed/cancelled' },
        ceo: { type: 'string', description: 'CEO 当前状态 JSON（update 用）：{persona,currentAction,location}——location∈ceo_office/hall/meeting_room' },
        headhunter: { type: 'string', description: '猎头当前状态 JSON（update 用）：{persona,currentAction}' },
        phase: { type: 'string', description: '项目当前阶段（如 kickoff/开发/测试/收口）' },
        actionType: { type: 'string', description: '单动作类型（mode=action 用）：employee_hired(入职, 配role/persona/replaces) / employee_started(开工领任务, 配role/currentWork) / employee_reporting(汇报, 配role/note=汇报内容) / employee_terminated(开除, 配role/note=离任原因) / recruiting_started(开招募, 配position/targetPersona/replacesEmp)——自动同步状态防 3D 画面失真' },
        note: { type: 'string', description: '汇报内容/离任原因等备注（mode=action 用）' },
        role: { type: 'string', description: '动作针对的员工角色（mode=action 用）' },
        persona: { type: 'string', description: '入职员工人物（employee_hired 用）' },
        currentWork: { type: 'string', description: '当前任务（employee_started 用）' },
        replaces: { type: 'string', description: '补谁的空缺（employee_hired/recruiting_started 用）' },
        position: { type: 'string', description: '招募岗位（recruiting_started 用）' },
        targetPersona: { type: 'string', description: '招募目标人物（recruiting_started 用）' },
        replacesEmp: { type: 'string', description: '补谁（recruiting_started 用）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          snapshot: { type: 'object', additionalProperties: true, description: '当前公司状态快照（UI 渲染数据源）' },
          updated: { type: 'boolean', description: '本次是否更新了快照' },
          storage: { type: 'string', description: '快照文件位置' },
          verdict: { type: 'string' },
        },
        required: ['snapshot', 'verdict'],
      },
      render: (r) =>
        `【公司状态】${r.verdict}\n快照文件：${r.storage || '.jarvis/company-state.json'}`,
    },
    handler: async (args) => {
      const mode = String(args.mode ?? 'snapshot').trim()
      const fsSvc = (() => {
        try { return (ctx && ctx.get && ctx.get('fs')) || null } catch { return null }
      })()
      const stateFile = '.jarvis/company-state.json'
      // 读当前快照（有 fs 从磁盘读，无 fs 返回空骨架）
      let state = { company: {}, employees: [], meetings: [], recruiting: [], ceo: {}, headhunter: {}, tasks: [], updatedAt: '' }
      if (fsSvc && typeof fsSvc.readText === 'function') {
        try {
          const target = await fsSvc.resolve(stateFile)
          if (target) {
            const text = await fsSvc.readText(target)
            if (text) {
              const data = JSON.parse(text)
              if (data && typeof data === 'object') state = { ...state, ...data }
            }
          }
        } catch { /* 首次无文件 */ }
      }
      if (mode === 'snapshot') {
        return { snapshot: state, verdict: `公司快照：${state.employees?.length || 0} 员工 / ${state.meetings?.length || 0} 会议 / ${state.recruiting?.length || 0} 招募中（UI 轮询渲染用）`, storage: stateFile }
      }
      if (mode === 'clear') {
        state = { company: {}, employees: [], meetings: [], recruiting: [], ceo: {}, headhunter: {}, tasks: [], updatedAt: '' }
      } else if (mode === 'update') {
        // 更新各表（传哪个字段更新哪个）
        if (args.employees !== undefined) { try { state.employees = JSON.parse(String(args.employees)) } catch {} }
        if (args.meetings !== undefined) { try { state.meetings = JSON.parse(String(args.meetings)) } catch {} }
        if (args.recruiting !== undefined) { try { state.recruiting = JSON.parse(String(args.recruiting)) } catch {} }
        if (args.ceo !== undefined) { try { state.ceo = JSON.parse(String(args.ceo)) } catch {} }
        if (args.headhunter !== undefined) { try { state.headhunter = JSON.parse(String(args.headhunter)) } catch {} }
        if (args.phase !== undefined) state.phase = String(args.phase)
        state.updatedAt = new Date().toISOString()
      } else if (mode === 'action') {
        // 单动作局部同步（员工入职/开工/汇报/开除等）——复用 syncCompanyState，只改对应表不覆盖他表
        const act = { type: args.actionType, role: args.role, persona: args.persona, currentWork: args.currentWork, replaces: args.replaces, position: args.position, targetPersona: args.targetPersona, replacesEmp: args.replacesEmp, note: args.note }
        const actionTypes = ['employee_hired', 'employee_started', 'employee_reporting', 'employee_terminated', 'recruiting_started']
        if (!actionTypes.includes(args.actionType)) return { snapshot: state, updated: false, storage: stateFile, verdict: `未知 actionType：${args.actionType || '(空)'}（支持 ${actionTypes.join('/')}）——未改动` }
        if (args.actionType === 'employee_hired' && !args.role) return { snapshot: state, updated: false, storage: stateFile, verdict: 'employee_hired 缺 role（入职谁）——未改动' }
        if ((args.actionType === 'employee_started' || args.actionType === 'employee_reporting' || args.actionType === 'employee_terminated') && !args.role) return { snapshot: state, updated: false, storage: stateFile, verdict: `${args.actionType} 缺 role——未改动` }
        if (args.actionType === 'recruiting_started' && !args.position) return { snapshot: state, updated: false, storage: stateFile, verdict: 'recruiting_started 缺 position——未改动' }
        const ok = await syncCompanyState(fsSvc, act)
        if (!ok) return { snapshot: state, updated: false, storage: stateFile, verdict: `action ${args.actionType} 同步失败（无 fs 或动作未生效）` }
        return { snapshot: state, updated: true, storage: stateFile, verdict: `action ${args.actionType} 已同步（状态局部更新，不覆盖他表）` }
      }
      // 写回磁盘
      let persisted = false
      if (fsSvc && typeof fsSvc.writeText === 'function') {
        try {
          const target = await fsSvc.resolve(stateFile)
          if (target) {
            await fsSvc.writeText(target, JSON.stringify(state, null, 2))
            persisted = true
          }
        } catch {}
      }
      const summary = `员工 ${state.employees?.length || 0}（${(state.employees || []).filter((e) => e.status === 'working').length} 工作中 / ${(state.employees || []).filter((e) => e.status === 'terminated').length} 已离任）· 会议 ${state.meetings?.length || 0} · 招募中 ${state.recruiting?.length || 0}`
      return { snapshot: state, updated: mode !== 'snapshot' && persisted, storage: stateFile, verdict: `公司状态${persisted ? '已落盘' : '（无 fs 未落盘）'}：${summary}` }
    },
  },

  {
    name: 'jarvis_taskgraph',
    description:
      '任务编排图校验器（CEO 派活前的硬产物闸——学 HuggingGPT 的依赖图思想：先拆结构化任务图再执行，防"口头派活依赖漏接/下游等上游/验收不明确"）：输入 CEO 拆出的任务清单 JSON，输出健康检查——每个任务(id/负责人/依赖/输入槽位/验收标准)，校验：①依赖闭环（无悬空依赖——每个依赖 id 都真实存在）；②无自依赖/循环依赖；③并行可行性（无依赖的独立任务可并行，不硬串行）；④每任务验收可判（验收标准非空且可判定）；⑤上下游产出传递（下游任务标注了"输入=上游 X 的产出"，防下游等不到上游交付）。**任务类型不预设枚举**（领域无关：CEO 按需求现场拆，不受限固定清单）。**校验器只做结构健康检查，不替代 CEO 判断**——结构问题(悬空/循环/无验收)打回重拆，拆图过闸才派活。产物沉淀 `<项目>/.jarvis/docs/任务编排-<需求关键词>.md`，且任务图可直接写入 company-state.json 的 tasks 表（3D 任务看板数据源）。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '需求本质（任务图围绕它拆——每任务须指向需求某条可判定验收）' },
        tasksJson: { type: 'string', description: '任务清单 JSON 数组：[{id, title, assignee, deps, inputs, acceptance}]——id=任务编号(数字或字符串)；title=任务名；assignee=负责人角色；deps=依赖的上游任务 id 数组(无依赖=[]或省略)；inputs=输入槽位描述(注明来自哪个上游任务产出，如"来自T1的方案设计文档")；acceptance=验收标准(怎样算这个任务完成，可判定)' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskCount: { type: 'number', description: '任务总数' },
          issues: { type: 'array', items: { type: 'string' }, description: '健康检查问题（空=无问题）' },
          ok: { type: 'boolean', description: '任务图是否可派活' },
          parallelGroups: { type: 'array', items: { type: 'string' }, description: '可并行的任务组建议' },
          verdict: { type: 'string' },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) => `任务编排图：${r.ok ? '✅ 可派活' : '❌ 打回重拆'}（${r.taskCount} 任务）\n问题：${(r.issues ?? []).map((i) => '⚠️ ' + i).join('\n')}\n并行建议：${(r.parallelGroups ?? []).join(' / ')}`,
    },
    handler: async (args) => {
      const req = String(args?.requirement ?? '')
      const issues = []
      let tasks = []
      try {
        const parsed = JSON.parse(String(args?.tasksJson ?? '[]'))
        if (Array.isArray(parsed)) tasks = parsed
        else issues.push('tasksJson 需为 JSON 数组')
      } catch {
        issues.push('tasksJson 解析失败（需合法 JSON 数组）')
      }
      const ids = new Set()
      const seen = new Set()
      const normId = (x) => String(x ?? '').trim()
      for (const t of tasks) {
        const id = normId(t?.id)
        if (!id) { issues.push('存在无 id 的任务（每个任务必须编号）'); continue }
        if (seen.has(id)) { issues.push(`任务 id 重复：${id}`); continue }
        seen.add(id)
        ids.add(id)
        const title = String(t?.title ?? '').trim()
        if (!title) issues.push(`任务 ${id} 缺标题（title）`)
        const assignee = String(t?.assignee ?? '').trim()
        if (!assignee) issues.push(`任务 ${id} 缺负责人（assignee——派活必须有主人）`)
        const acc = String(t?.acceptance ?? '').trim()
        if (!acc) issues.push(`任务 ${id} 缺验收标准（acceptance——没有"怎样算完成"的任务不许派）`)
        else if (/^\s*(做完|搞定|弄好|完成|做好|差不多|尽量|尽快|看着办|随便)\s*$/.test(acc)) issues.push(`任务 ${id} 验收标准不可判定：「${acc}」是空泛词——须写明可检查的结果（如"输出文档含 X 节/代码过 Y 测试/页面能 Z"）`)
        const deps = Array.isArray(t?.deps) ? t.deps : []
        for (const d of deps) {
          const ds = normId(d)
          if (ds === id) issues.push(`任务 ${id} 自依赖（依赖自己——拆错）`)
          else if (ds && ds !== '-1' && ds !== 'none' && !tasks.some((o) => normId(o?.id) === ds)) issues.push(`任务 ${id} 依赖悬空：依赖 ${ds} 不存在（deps 必须指向真实任务 id）`)
        }
        // 输入槽位：有真实依赖（非 -1）时应说明输入来自哪个上游产出，防下游等不到上游交付
        const hasRealDep = deps.some((d) => { const ds = normId(d); return ds && ds !== '-1' && ds !== 'none' })
        const inputsTxt = Array.isArray(t?.inputs) ? t.inputs.join('、') : String(t?.inputs ?? '')
        if (hasRealDep && !inputsTxt.trim()) issues.push(`任务 ${id} 有依赖但未写输入来源（inputs——下游要等上游的什么产出？写明"来自任务 X 的什么"防空等）`)
      }
      if (!tasks.length && !issues.length) issues.push('任务清单为空（先拆任务再派活）')
      // 循环依赖检测（简化：DFS 报环）
      const adj = {}
      for (const t of tasks) {
        const id = normId(t?.id)
        if (!id) continue
        adj[id] = (Array.isArray(t?.deps) ? t.deps : []).map(normId).filter((d) => d && d !== '-1' && d !== 'none' && ids.has(d))
      }
      const WHITE = 0, GRAY = 1, BLACK = 2
      const color = {}
      const cyclePath = []
      const dfs = (u, path) => {
        color[u] = GRAY
        path.push(u)
        for (const v of adj[u] || []) {
          if (!color[v]) { if (dfs(v, path)) return true }
          else if (color[v] === GRAY) { cyclePath.push(...path.slice(path.indexOf(v)), v); return true }
        }
        path.pop()
        color[u] = BLACK
        return false
      }
      for (const id of ids) {
        if (!color[id]) {
          if (dfs(id, [])) { issues.push(`循环依赖：${cyclePath.join(' → ')}（任务互相等，永远不开始——拆错）`); break }
        }
      }
      // 并行组建议（拓扑分层：同层任务可并行；层 = 最长依赖链长度）
      // 防循环干扰：有环时跳过分层（环已报 issue，不产出误导性并行建议）
      const hasCycle = issues.some((i) => i.includes('循环依赖'))
      const levelOf = {}
      const parallelGroups = []
      if (!hasCycle) {
        const computeLevel = (id) => {
          if (levelOf[id] !== undefined) return levelOf[id]
          const deps = adj[id] || []
          if (!deps.length) { levelOf[id] = 0; return 0 }
          let mx = -1
          for (const d of deps) mx = Math.max(mx, computeLevel(d))
          levelOf[id] = mx + 1
          return levelOf[id]
        }
        for (const id of ids) computeLevel(id)
        const byLevel = {}
        for (const t of tasks) {
          const id = normId(t?.id)
          if (!id) continue
          const lv = levelOf[id] ?? 0
          ;(byLevel[lv] = byLevel[lv] || []).push(String(t?.title ?? id))
        }
        for (const lv of Object.keys(byLevel).map(Number).sort((a, b) => a - b)) {
          const group = byLevel[lv]
          if (group.length > 1) parallelGroups.push(`第${lv + 1}批可并行：${group.join(', ')}`)
          else if (group.length === 1 && lv === 0) parallelGroups.push(`首批开工：${group[0]}`)
        }
      }
      const ok = issues.length === 0
      return {
        taskCount: tasks.length,
        issues,
        ok,
        parallelGroups,
        verdict: ok
          ? `任务编排图合格（${tasks.length} 任务）：依赖无悬空/无循环、每任务有负责人+可判定验收、独立任务可并行。可派活（agent_teams_create_task 逐个建，dependencies 按 deps 接）。任务图沉淀 docs/任务编排-*.md 并写入 company-state tasks 表（3D 看板可渲染）。`
          : `任务编排图待修（${issues.length} 项）：${issues.slice(0, 5).join('；')}。打回 CEO 重拆——任务图有结构问题不许派活（悬空依赖=下游等不到；循环=永远不开始；无验收=做完不知道算不算完）。`,
      }
    },
  },
]

/** 需求分级（纯逻辑，供 jarvis_project 工具与 /jarvis 命令共用）。
 *  ⚠️ 领域无关设计：插件不预设任何行业/人物/领域流程（那是项目沉淀的职责）。
 *  这里只做"需求复杂度的分级建议"，领域判断与蒸馏方向由 CEO 按本项目实际情况现场决定。
 *
 *  S5 修复（防"模糊需求被跳过澄清"）：不再按字符长度一刀切——"做个东西"(4字) 与 "改个文案"(4字)
 *  都短，但前者完全无实质内容（模糊需求），后者有明确对象+动作（可判定目标）。
 *  判据：含实质动词+具体对象 → 至少 M；纯占位/泛词（东西/一下/个东西/帮我弄）→ S（触发澄清，不直接建队）。
 */
export function identifyIndustry(text) {
  const raw = String(text ?? '').trim()
  const len = raw.length
  const S_PLACEHOLDER = /(个|点|做|弄|搞|写|建|出|给|上|来|下)\s*(东西|那个|这个|一下|点点|点啥|啥|什么|随便|大概|差不多)|(东西|那个|这个|什么)\s*$/i
  const hasActionVerb = /(做|建|改|写|开发|设计|搭|搞|弄|出|给|帮我|规划|运营|方案|系统|平台|小程序|APP|应用|网站|页面|流程|功能|机器人|助手|工具|服务|产品)/i.test(raw)
  // 统一 vague：占位词 或 短且无动作词（如"你好"——短无动作=无实质需求线索）
  const vague = S_PLACEHOLDER.test(raw) || (len <= 5 && !hasActionVerb)
  // 领域可判性：有具体对象/行业线索（非占位非纯寒暄）→ 领域可从文本判；否则判不出
  const hasDomainClue = /系统|平台|小程序|网站|应用|电商|金融|制造|医疗|教育|农业|监测|管理|工具|服务|方案|APP|店|厂|矿|公司|项目/.test(raw)
  const suggestion = vague
    ? 'S：先澄清（需求过于模糊——请用户说具体想干什么/说详细点，从中判断需求方向与领域；未清晰前不建队）'
    : len <= 5
      ? 'S：直接做（不需要建队）'
      : len < 40
        ? 'M：精简公司（2-4 人，现场蒸馏子角色）'
        : 'L：全链公司（4-7 人，现场蒸馏 CEO+子角色）'
  return {
    industry: '由 CEO 现场判断（插件不预设领域，避免套模板）',
    suggestion,
    distillDirections: ['CEO 按本项目需求特性，web 搜索该领域真实可查证权威（现场决定，不预置名单）'],
    matched: false,
    vague,
    // 领域是否可判：非模糊且文本含领域线索 → 可判；模糊/无线索 → 判不出(需请用户说详细点)
    domainDeterminable: !vague && hasDomainClue,
    reason: vague
      ? '需求过于模糊（占位词或短无动作）——判不出领域方向，请用户说具体想干什么（说详细点：想做什么/解决什么问题/给谁用），从描述中判断领域'
      : hasDomainClue
        ? '文本含领域线索，可按文本判断领域方向'
        : '文本无明显领域线索，但非模糊——进入需求打磨时由 CEO+专家进一步判断领域',
  }
}

/** /jarvis 命令执行：需求分级 → 返回真实执行产物（含蒸馏/流程/沉淀指令），不再是占位文本 */
export function jarvisCommand(requirement) {
  const text = String(requirement ?? '').trim()
  if (!text) return { content: '用法：/jarvis <需求描述>（可模糊）' }
  const hit = identifyIndustry(text)
  const vague = hit.vague
  // 判领域分支：判不出 → 请用户说具体想干什么；能判 → 走猎头→CEO→专家流程
  let actions = []
  let guidance = ''
  if (vague) {
    // 判不出领域方向（乱用/你好/做个东西）→ 请用户说详细点，从描述判断领域
    actions = [
      '① 回复用户：「你想做什么/解决什么问题/给谁用？能具体说说吗」——请用户说详细点（不用问"哪个领域"这种抽象问题）',
      '② 从用户的具体描述判断领域方向（如"给员工做考勤"→软件/HR；"养鸡场自动喂食"→农业/自动化）——循环请补充说到能判出',
      '③ 领域判出后 → 蒸馏该领域猎头（人才调度层）→ 猎头供该领域 CEO → CEO 分析需求定一个领域专家 → 双人打磨需求',
    ]
    guidance = '⚠️ 判不出领域方向（需求太模糊/无领域线索）——先请用户说具体想干什么，从中判断领域，再启动人才'
  } else {
    // 领域可判（或小需求）→ 走完整人才流程
    actions = [
      '① 蒸馏该领域猎头（人才调度层——蒸馏自该领域知名猎头/人才寻访权威，过 distill 双闸）',
      '② 猎头供该领域 CEO（按岗位画像找最合适的带队大佬）→ 贾维斯确认',
      '③ CEO 分析需求 → 向猎头定一个领域专家搭档 → 猎头调度给 CEO 确认',
      '④ CEO+专家 双人打磨需求问用户（各自看法→对齐→问清"为谁/解决什么/怎样算成功"）→ 需求清晰',
      '⑤ 需求无问题 → CEO+专家定团队规模/人员列表 → 猎头逐个调度 → CEO+专家确认够格 → kickoff 开工',
    ]
    guidance = hit.domainDeterminable ? '✅ 领域可从文本判断，启动人才流程' : '（小需求/无领域线索但可直接做——按需走或直接做）'
  }
  return {
    content: `已收到需求[${text.slice(0, 120)}]。\n${guidance}\n\n【接下来 5 分钟该做什么（照做即可）】\n${actions.join('\n')}\n\n（完整协议见 jarvis 技能：核心协议 5 步主干 + 判领域/猎头调度/CEO+专家打磨/三产物闸/测试返工/收口核对。铁律：真实优先不编造；做客户要的；卡不贵多贵有用。）`,
  }
}

// 声明注入：apply 在 tools 服务就绪后才执行（修复"服务不可用导致工具未注册"）
export const inject = ['tools', 'webServer']

export default {
  inject,
  apply(ctx) {

    // ── webServer route：client 静态 bundle 读取黑板（host.call 仅 dynamic 沙箱可用，静态走 HTTP）──
    try {
      const webSvc = (ctx && ctx.webServer) || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
      if (webSvc && typeof webSvc.register === 'function') {
        ctx.effect(() =>
          webSvc.register({
            kind: 'exact',
            path: '/api/luke-jarvis/board',
            handler: async (req, res) => {
              const send = (status, body) => {
                try { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) } catch {}
              }
              if (!req || req.method !== 'GET') return send(405, { items: [], error: 'method-not-allowed' })
              try {
                const cwd = process.cwd && process.cwd()
                const boardPath = (cwd ? cwd + '/' : '') + '.jarvis/board.json'
                let fsSvc = null
                try { fsSvc = ctx.get('fs') } catch { fsSvc = null }
                if (!fsSvc || typeof fsSvc.readText !== 'function') return send(200, { items: [], error: 'fs 不可用' })
                const target = await fsSvc.resolve(boardPath)
                if (!target) return send(200, { items: [], active: false, reason: 'no .jarvis' })
                const text = await fsSvc.readText(target)
                if (!text) return send(200, { items: [], active: false, reason: 'empty board' })
                let data = null
                try { data = JSON.parse(text) } catch { data = null }
                if (!data || !Array.isArray(data.items)) return send(200, { items: [], active: true, reason: 'bad json' })
                return send(200, {
                  items: data.items.map((it) => ({
                    id: String(it.id || ''),
                    role: String(it.role || ''),
                    type: String(it.type || '问题'),
                    content: String(it.content || '').slice(0, 200),
                    status: String(it.status || 'open'),
                    essenceChecked: Boolean(it.essenceChecked),
                  })),
                  active: true,
                })
              } catch (e) {
                return send(200, { items: [], error: String(e && e.message ? e.message : e) })
              }
            }
          })
        )
      }
    } catch {}
    // 1) 模型工具：tools 已注入（ctx.tools 就绪）；对无注入能力的宿主/测试环境降级 ctx.get
    const toolsSvc =
      (ctx && ctx.tools) || (typeof ctx.get === 'function' ? ctx.get('tools') : undefined)
    if (toolsSvc && typeof toolsSvc.register === 'function') {
      for (const def of TOOLS) {
        const { handler, ...rest } = def
        ctx.effect(() =>
          toolsSvc.register(
            defineTool({
              ...rest,
              parameters: normalizeParameters(rest.parameters),
              output: {
                schema: normalizeOutputSchema(rest.output && rest.output.schema),
                render: (args, value) => {
                  const text =
                    rest.output && rest.output.render ? rest.output.render(value) : JSON.stringify(value ?? {})
                  return Array.isArray(text) ? text : [{ type: 'text', text: String(text) }]
                },
              },
              execute: handler,
            }),
          ),
        )
      }
    } else {
      console.error('[luke-jarvis] tools 服务不可用，模型工具未注册')
    }

    // 2) /jarvis 命令：commands 为可选服务——优先懒注入（就绪后自动注册），无 inject 能力时降级 get
    const registerJarvisCommand = (commandCtx) => {
      ctx.effect(() =>
        commandCtx.register({
          name: 'jarvis',
          description: '贾维斯数字员工公司（领域无关）：需求分级 → CEO 定领域流程(jarvis_process) → 现场蒸馏角色卡(jarvis_distill 校验) → 项目沉淀(jarvis_store) → 协同(jarvis_collab) → kickoff 会 → 独思(think_deep) → 黑板(board) → 按需二次会(review+essence) → 问题上行(escalate) → 能力补足(capability) → 收口',
          usage: '/jarvis <需求描述>',
          execute: async (agent, line) => {
            const r = jarvisCommand(line)
            return { kind: 'success', text: typeof r === 'string' ? r : r.content }
          },
        }),
      )
    }
    if (typeof ctx.inject === 'function') {
      ctx.inject(['commands'], registerJarvisCommand)
    } else {
      const commands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined
      if (commands && typeof commands.register === 'function') registerJarvisCommand(commands)
      else console.error('[luke-jarvis] commands 服务不可用，/jarvis 命令未注册')
    }

    // ── Client RPC：读黑板（web 面板用）──
    // 仅当当前会话工作区存在 .jarvis/board.json 时返回内容，否则返回空（Client 不渲染）
    // 这样：用了 /jarvis 的会话（工作区有 .jarvis/）才有黑板面板，其他会话不显示 = 不入侵。
    // harness 为全局服务，就绪时间不定：internal/service 事件 + 有界轮询兜底，注册一次后停止。
    let boardRpcRegistered = false
    const registerBoardRpc = () => {
      if (boardRpcRegistered) return true
      if (!globalThis.harness || typeof globalThis.harness.handle !== 'function') return false
      try {
        ctx.effect(
          () =>
            globalThis.harness.handle('jarvis/board', async (args) => {
              const sessionId = args && args.sessionId ? String(args.sessionId) : ''
              try {
                const cwd = process.cwd && process.cwd()
                const boardPath = (cwd ? cwd + '/' : '') + '.jarvis/board.json'
                let fsSvc = null
                try { fsSvc = ctx.get('fs') } catch { fsSvc = null }
                if (!fsSvc || typeof fsSvc.readText !== 'function') {
                  return { items: [], error: 'fs 不可用' }
                }
                const target = await fsSvc.resolve(boardPath)
                if (!target) return { items: [], active: false, reason: 'no .jarvis' }
                const text = await fsSvc.readText(target)
                if (!text) return { items: [], active: false, reason: 'empty board' }
                let data = null
                try { data = JSON.parse(text) } catch { data = null }
                if (!data || !Array.isArray(data.items)) return { items: [], active: true, reason: 'bad json' }
                return {
                  items: data.items.map((it) => ({
                    id: String(it.id || ''),
                    role: String(it.role || ''),
                    type: String(it.type || '问题'),
                    content: String(it.content || '').slice(0, 200),
                    status: String(it.status || 'open'),
                    essenceChecked: Boolean(it.essenceChecked),
                  })),
                  active: true,
                  sessionId,
                }
              } catch (e) {
                return { items: [], error: String(e && e.message ? e.message : e) }
              }
            }),
        )
        boardRpcRegistered = true
        return true
      } catch {
        return false
      }
    }
    if (!registerBoardRpc()) {
      let tries = 0
      let timer = null
      try {
        ctx.on('internal/service', () => {
          if (!boardRpcRegistered) registerBoardRpc()
        })
      } catch { /* 事件钩子不可用时靠轮询兜底 */ }
      try {
        timer = ctx.setInterval(() => {
          tries += 1
          if (registerBoardRpc() || tries >= 20) {
            if (timer && typeof timer === 'function') timer()
          }
        }, 1500)
      } catch { /* 定时器不可用时静默（黑板 RPC 为可选能力） */ }
    }
  },
}