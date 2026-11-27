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
import { deriveJarvisFacts, jarvisTeamShape } from './jarvis-facts.js'
import { gcSummary } from '../tools/gc.js'

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
    // ⚠️ v0.35：**不能提前 return**——.agent-teams 不存在是本部署的常态（JARVIS 链路不写它），
    // 提前 return 会让下面的 jarvis 事实叠加代码永远走不到，前端团队一览永远空。
    names = []
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
    const shortRole = (raw) => {
      const t = String(raw || '').trim()
      if (!t) return ''
      if (t.length <= 30) return t
      const colon = t.search(/[：:]/)
      const firstLine = t.split('\n')[0]
      if (colon >= 0) {
        const after = firstLine.slice(colon + 1).split(/[。；;，,]/)[0].trim()
        if (after) return after.slice(0, 24)
      }
      return firstLine.slice(0, 24)
    }
    const members = (Array.isArray(d.members) ? d.members : []).map((m) => ({
      name: String((m && m.name) || ''),
      role: shortRole((m && m.role) || '') || String((m && m.name) || ''),
      provider: String((m && m.provider) || ''),
      model: String((m && m.model) || ''),
    })).filter((m) => m.name || m.role)
    let mtime = 0
    try { mtime = fs.statSync(path.join(td, name, 'team.json')).mtimeMs } catch {}
    teams.push({
      name: String(name),
      description: String(d.description || ''),
      captainSessionId: d.captainSessionId || '',
      members,
      tasks,
      mtime,
    })
  }
  let activeNames = []
  try {
    const a = readJsonSafe(projectDir, '.jarvis/active-team.json', fs, path)
    if (a && Array.isArray(a.teams)) activeNames = a.teams.map(String)
  } catch {}
  // ── JARVIS 事实叠加（v0.35·用户定调 2026-11-27「团队一览里面的员工干活还是假的」）──
  // 根因：本部署的建队/派活链路（jarvis_distill → jarvis_company → jarvis_dispatch_task
  // → jarvis_ticket）**一个字节都不写 .agent-teams/**，而本函数原来只读 .agent-teams。
  // 结果：新工作区团队一览永远空；老工作区显示 11 月 agent_teams 时代的残留假成员。
  // 修法：把 .jarvis/cards + .jarvis/tickets + STATUS.md + exec-map 推导出的事实
  // 叠加成同形团队（name='jarvis'），前端结构不用改。两源合并（老 .agent-teams 仍可见）。
  try {
    const facts = deriveJarvisFacts(projectDir, fs, path)
    const jt = jarvisTeamShape(facts, path)
    if (jt) {
      // 同一角色若在 .agent-teams 与 jarvis 事实里都出现：保留 jarvis 那条（它才是真在跑的链路）
      const jarvisRoles = new Set(jt.members.map((m) => m.role))
      for (const t of teams) {
        if (t.members.length && t.members.every((m) => jarvisRoles.has(m.role))) {
          // 这个 .agent-teams 团队与 jarvis 事实完全重合 → 标记为陈旧快照，不重复展示
          t.staleDuplicateOfJarvis = true
        }
      }
      teams.push(jt)
      for (const tt of jt.tasks) (TERMINAL.has(tt.status) ? completed++ : open++)
    }
  } catch { /* 推导失败不阻断快照（画面退化为空，比崩好） */ }
  teams.sort((x, y) => (y.mtime || 0) - (x.mtime || 0))
  const shown = teams.filter((t) => !t.staleDuplicateOfJarvis)
  const marked = shown.map((t) => ({ ...t, active: activeNames.includes(t.name) || t.source === 'jarvis-facts' }))
  return { teams: marked, open, completed, activeTeams: activeNames }
}

/** 转录解析缓存：(文件路径|mtime|size) → digest。append-only 转录按此键失效即可。 */
const _DIGEST_CACHE = new Map()

/** 把一条 bash 命令压成人能读的一句话。
 *  子 agent 的「做了什么」主要藏在命令里：`ls`/`grep` 是查、`python3 -c` 是算、
 *  带重定向或 heredoc 的是写。老板不该看命令原文，该看「它在查什么/写什么」。
 *  ⚠️ 只认「像文件路径」的目标（带扩展名或目录分隔符）——
 *     否则会把 `2>&1`、`/dev/null`、`$1` 这类 shell 语法当成文件名。 */
function describeCmd(cmd) {
  const raw = String(cmd || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  const looksLikeFile = (p) => /[A-Za-z0-9_.-]+\.(md|json|mjs|sh|ts|js|txt|log|csv|ya?ml|html|py)$/.test(String(p || ''))
  // 拆成指令段：`a; b && c | d` → [a, b, c, d]。每段只看「第一个词」，
  // 避免 A 段的参数被 B 段的正则误当成动作（之前 `cat 证据/host-*.json` 被当成 `ls` 就是这种误判）。
  const segs = raw.split(/[;]|&&|\|\||\|/).map((x) => x.trim()).filter(Boolean)
  // 段内再剥掉 `cd X &&` 这类前缀：真正动作在 cd 之后
  const pick = (seg) => {
    const s = seg.trim()
    if (/^cd\s+/.test(s)) return null                     // 切目录不算「做了什么」
    const m = s.match(/^(\w+)\s*([^\s]*)/)
    if (!m) return null
    const verb = m[1]
    const rest = s.slice(verb.length).trim()
    // 剥掉选项（-x / --long）
    const args = rest.split(/\s+/).filter((a) => a && !/^-/.test(a))
    const firstArg = (args[0] || '').replace(/["']/g, '')
    // 写文件
    const wm = s.match(/(?:>>?|tee\s+)\s*["']?([^\s"'|;&]+)/)
    if (wm && looksLikeFile(wm[1])) return '写入 ' + (wm[1].split('/').pop() || '')
    if (/^(cat|zstdcat|head|tail|less|more)$/.test(verb)) {
      if (looksLikeFile(firstArg)) return '翻阅 ' + (firstArg.split('/').pop() || '')
      return null
    }
    // sed/awk 在这里基本只做「按行取一段看看」——语义上是翻阅，不是计算。
    if (/^(sed|awk)$/.test(verb)) {
      const file = args.find((a) => looksLikeFile(a))
      return file ? '翻阅 ' + (String(file).split('/').pop() || '') : null
    }
    if (/^(ls|find|tree|du)$/.test(verb)) {
      if (!firstArg || /^[-&$]/.test(firstArg)) return null
      // 多个路径时取第一个（`ls a/ b/`）；通配符/文件名不算
      const dirs = args.filter((a) => {
        const t = a.replace(/["']/g, '')
        return !/[*?]/.test(t) && !looksLikeFile(t)
          && !/^(null|undefined|\/dev\/null|NUL|CON)$/.test(t)
          && !/[&$<>|()]/.test(t) && !/^\d+$/.test(t)       // 排除 2>&1 / $1 / 重定向残留
      })
      const d = (dirs[0] || '').replace(/["']/g, '')
      const seg = d.split('/').filter(Boolean).pop()
      return seg && /[A-Za-z0-9_\-一-鿿]/.test(seg) ? '清点 ' + seg : null
    }
    if (/^(grep|rg|ag|egrep)$/.test(verb)) {
      const pat = firstArg.replace(/[|]"'/g, '')
      if (!pat || /[\^\\\[\]{}()*+?$|]/.test(pat)) return null
      return '检索 ' + pat.slice(0, 20)
    }
    if (/^(python3?|perl|jq)$/.test(verb)) return '计算/核对数据'
    if (/^(git|svn)$/.test(verb)) return '查版本库'
    if (/^(npm|pnpm|yarn|npx)$/.test(verb)) return /\btest\b/.test(rest) ? '跑测试' : '跑命令'
    // node 要分「跑测试脚本」和「用 node 算东西」——`node --test` 是测试，`node -e` 是计算。
    if (/^(node|bash|sh|zsh)$/.test(verb)) {
      if (/\btest\b/.test(rest)) return '跑测试'
      if (looksLikeFile(firstArg)) return '执行 ' + (firstArg.split('/').pop() || '')
      return '计算/核对数据'
    }
    if (/^(mkdir|touch|cp|mv|rm)$/.test(verb)) {
      const tag = verb === 'rm' ? '清理' : verb === 'cp' || verb === 'mv' ? '整理' : '新建'
      const t = args.filter((a) => !looksLikeFile(a))[0] || firstArg
      return t ? tag + ' ' + (String(t).split('/').filter(Boolean).pop() || '') : tag
    }
    return null
  }
  const out = []
  for (const seg of segs) {
    const r = pick(seg)
    if (r && !out.includes(r)) out.push(r)
    if (out.length >= 2) break                             // 一句话里最多说两件事
  }
  return out.join('，')
}

/** write/edit/read 等工具的参数 → 一句话（只取文件名，路径太长没意义）。 */
function describeArg(name, data) {
  try {
    const a = JSON.parse(String((data || {}).arguments || '{}'))
    const p = String(a.file_path || a.path || a.filePath || '')
    const base = p.split(/[/\\]/).pop() || ''
    if (!base) return ''
    if (/write|create|save|edit|patch|replace/i.test(name)) return '改 ' + base
    if (/read|view|cat/i.test(name)) return '读 ' + base
    if (/search|grep|find|glob/i.test(name)) return '查 ' + (String(a.pattern || a.query || '').slice(0, 30) || base)
    return base
  } catch { return '' }
}

/**
 * 从一段解压后的会话转录（JSONL 文本）里提取「它在做什么」。
 *
 * 逐行扫描，只保留需要的少量信息，避免把整份转录留在内存：
 *   · 第一行            → meta（cwd/parentSession/origin/createdAt）
 *   · subagent/descriptor → label（任务标题）、agentModel
 *   · assistant/message   → 最后一条非空文本，截断 240 字
 *   · tool/call           → 最近一次工具名
 *   · step/end            → 计数（近似"做了多少步"）
 *   · 任意事件带 time     → 最后一次活动时间
 *
 * 任何一行解析失败都跳过该行，绝不抛出：快照是 UI 的命脉，
 * 一条坏数据不该让整个面板空白。
 */
function sessionDigest(text) {
  const out = { meta: null, label: '', model: '', lastText: '', lastTool: '', steps: 0, lastAt: 0, outputs: [], toolCounts: {}, firstText: '', brief: '', texts: [], dirs: [], reads: [], trail: [] }
  const lines = String(text || '').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    if (!raw) continue
    let e = null
    try { e = JSON.parse(raw) } catch { continue }
    if (!e || typeof e !== 'object') continue
    const type = String(e.type || '')
    const at = Number(e.time || 0)
    if (at > out.lastAt) out.lastAt = at
    if (type === 'session' && !out.meta) { out.meta = e; continue }
    // 派活原文：真正的任务书在 agent/inbox/spliced 的 next-turn 里。
    // 这是「这个角色被交代了什么」最准确的证据——比开场白可靠，
    // 老板看详情时先看需求、再看产出，才判断得出做没做对。
    if (type === 'agent/inbox/spliced' && !out.brief) {
      const d = e.data || {}
      if (String(d.target || '') === 'next-turn') {
        const ins = Array.isArray(d.inserted) ? d.inserted : []
        const body = ins.map((m) => (Array.isArray(m && m.content) ? m.content : [])
          .map((c) => String((c && c.text) || '')).join(' ')).join('\n').trim()
        if (body) out.brief = body.slice(0, 600)
      }
      continue
    }
    // 工作目录变更：会话建在 A，实际活干在 B（CEO 常这样切到审计工作区）。
    if (type === 'working-directory/change') {
      const cwd = String((e.data || {}).cwd || '')
      if (cwd && !out.dirs.includes(cwd)) out.dirs.push(cwd)
      continue
    }
    if (type === 'subagent/descriptor') {
      const d = e.data || {}
      if (!out.label && d.label) out.label = String(d.label)
      if (!out.model && d.agentModel) out.model = String(d.agentModel)
      continue
    }
    if (type === 'assistant/message') {
      const parts = ((e.data || {}).message || {}).content || []
      const body = Array.isArray(parts)
        ? parts.filter((p) => p && p.type === 'text').map((p) => String(p.text || '')).join(' ').trim()
        : ''
      if (body) {
        // 挑「最像收尾汇报」的那句：完成/交付/产物/总结/## 标题这类信号，
        // 并且长度够（碎话不算）。取分最高的，不是取最后一条——
        // 最后一条常是"让我再看看"这种过渡语，而真正的交付说明通常在中间。
        const sig = [
          /完成|已交付|全部|收尾|汇报|总结|结论|交付物|产物|通过/
          , /finished|done|delivered|complete|summary|report/
          , /##|####|✅|\\|\\s*-\\s*/
        ].reduce((acc, re) => acc + (re.test(body) ? 1 : 0), 0)
        const score = sig * 100 + Math.min(body.length, 500)
        if (!out.firstText) out.firstText = body.slice(0, 240)
        const cur = (out._best && out._best.score) || -1
        if (score > cur) out._best = { score, text: body.slice(0, 500) }
        if (!out.lastText) out.lastText = body.slice(0, 240)
        // 保留一条「有信息量的叙述轨」：详情页要能看清它分几步做了什么，
        // 而不是只留一句开场白。丢掉两类噪音：
        //   ① 开场套话（"I'll start by reading…"「让我先看看」）——老板看不出做了什么；
        //   ② 极短碎话（<60 字，通常是过渡语）。
        // 英文的过程叙述也丢：这个面板是给中文老板看的，混排英文反而难读。
        const isChatter = /^(I'?ll|I'?m|Let me|Now I'?ll|Now let|Next,|让我|我先|我这就|接下来)/.test(body)
        const isEnglish = !/[一-鿿]/.test(body)
        if (body.length >= 60 && !isChatter && !isEnglish) {
          if (out.texts.length >= 6) out.texts.shift()
          out.texts.push(body.slice(0, 400))
        }
      }
      continue
    }
    if (type === 'tool/call') {
      const name = String((e.data || {}).name || '')
      if (name) {
        out.lastTool = name
        out.toolCounts[name] = (out.toolCounts[name] || 0) + 1
        // 行动轨迹：每条工具调用压成一句话（最多留 40 条）。
        // 这是「到底干了什么」最可靠的证据——子 agent 的文本常是英文开场白，
        // 但命令/文件操作是它们真实做过的事，跟语言无关。
        let argRead = ''
        try { argRead = describeArg(name, e.data) } catch { argRead = '' }
        let argBash = ''
        if (/bash|shell|exec/.test(name)) {
          try { argBash = describeCmd(String(JSON.parse(String((e.data || {}).arguments || '{}')).command || '')) } catch { argBash = '' }
        }
        const trailArg = argBash || argRead
        if (trailArg) {
          if (out.trail.length >= 40) out.trail.shift()
          out.trail.push({ tool: name, arg: trailArg })
        }
        // 从写类工具的参数里挖出产物路径——这是"我做出了什么"最硬的证据。
        // 注意：这些子 agent 多数用 bash（heredoc/重定向）写文件，而不是 write 工具，
        // 所以 bash 的 command 里也要扫（只认形如 /xx/yy 的绝对路径，且带常见产物后缀）。
        if (out.outputs.length < 8) {
          try {
            const a = JSON.parse(String((e.data || {}).arguments || '{}'))
            const direct = String(a.file_path || a.path || a.filePath || '')
            if (direct && !out.outputs.includes(direct)) out.outputs.push(direct)
          } catch { /* 非法 JSON 跳过 */ }
          // 读过的文件也是证据：能说明它核对了哪些材料（不是凭空写的）。
          try {
            const a = JSON.parse(String((e.data || {}).arguments || '{}'))
            const readPath = String(a.file_path || a.path || a.filePath || '')
            if (readPath && /read|view|cat/i.test(name) && out.reads.length < 12
                && !out.reads.includes(readPath)) out.reads.push(readPath)
          } catch { /* 非法 JSON 跳过 */ }
          if (/bash|shell|exec/.test(name)) {
            let cmd = ''
            try { cmd = String(JSON.parse(String((e.data || {}).arguments || '{}')).command || '') } catch { cmd = '' }
            // 只取「看起来是交付物」的路径：报告/清单/文档/脚本
            const hit = cmd.match(/(?:\/|~)[^\s"'`;|&<>()]*(?:报告|清单|审计|设计|文档|规格|剧本|\.md|\.json|\.mjs|\.sh|\.ts)/g)
            if (hit) {
              for (const p of hit.slice(0, 3)) {
                const clean = p.replace(/[，,。；;]+$/, '')
                if (clean && !out.outputs.includes(clean) && out.outputs.length < 8) out.outputs.push(clean)
              }
            }
          }
        }
      }
      continue
    }
    if (type === 'step/end') out.steps += 1
  }
  delete out._bestScore
  if (out._best) { out.lastText = out._best.text; delete out._best }
  return out
}

/** DSH 原生子会话扫描（UI 可见性兜底）。
 *
 *  问题（2026-11-16 实证）：用户在 DSH 会话里直接用原生 subagent 工具开子 agent，
 *  完全绕过 jarvis 任务单系统（无 ticket / 无 .agent-teams / 无 events），
 *  增强 UI 查 snap.tickets/tasks/events 全是空 → 显示空白，而实际有活在跑。
 *
 *  这里做的：扫 DSH 的会话目录，找出 origin=subagent 的会话，
 *  标注「是否已纳入 jarvis 任务单」，让 UI 至少能说清「有什么在跑、哪些绕过了流程」。
 *  只读 .zstd 的第一行（会话头，含 cwd/parentSession/origin），不读全文（省 IO）。
 */
function dshSubagents(dir, fs, path) {
  const out = { total: 0, tracked: 0, untracked: 0, items: [] }
  try {
    const home = String(process.env.HOME || process.env.USERPROFILE || '/root')
    const sroot = path.join(home, '.dsh', 'sessions')
    if (!fs.existsSync(sroot)) return out
    // DSH 会话目录按 cwd 命名：把路径里的 / 换成 -，前后加 --（如 --opt-work-luke-jarvis--）。
    // 注意：路径本身可能含横线（luke-jarvis），所以只能正向比对「路径→横线形式」，
    // 不能反向把横线还原成斜杠（会得到 opt/work/luke/jarvis，永远匹配不上）。
    const norm = (s) => String(s || '').replace(/[\\/]+/g, '-').replace(/^[-]+|[-]+$/g, '').toLowerCase()
    const targetNorm = norm(dir)
    const candidates = []
    try {
      for (const d of fs.readdirSync(sroot)) {
        if (d.startsWith('--') && d.endsWith('--') && norm(d.slice(2, -2)) === targetNorm) {
          candidates.push(path.join(sroot, d))
        }
      }
    } catch { /* 读不到会话根 */ }
    for (const cdir of candidates) {
      let names = []
      try { names = fs.readdirSync(cdir) } catch { continue }
      for (const n of names) {
        if (/^session-/.test(n)) continue            // 主会话不算
        const f = path.join(cdir, n, 'session.v4.jsonl.zstd')
        if (!fs.existsSync(f)) continue
        // ⚠️ 必须用 zstdcat 而不是 zlib.zstdDecompressSync：
        //    DSH 转录是**多帧 zstd 追加写**（实测单文件 282 个帧魔数），
        //    zstdDecompressSync 只解第一帧 → 只拿到 2 行会话头，
        //    后面的 descriptor/assistant/tool 全部读不到（这就是 UI 只知道
        //    「有几个会话在跑」却不知道「它们在做什么」的根因）。
        //    zstdcat 解全部帧（671 行），14 个会话合计约 13ms，成本可接受。
        // 结果按 (文件, mtime, size) 缓存——转录 append-only，没变就不重复解压。
        let meta = null
        let digest = null
        try {
          let st = null
          try { st = fs.statSync(f) } catch { st = null }
          const cacheKey = st ? `${f}|${st.mtimeMs}|${st.size}` : ''
          const hit = cacheKey && _DIGEST_CACHE.get(cacheKey)
          if (hit) { digest = hit }
          else {
            const cp = _require('node:child_process')
            const txt = cp.execSync(`zstdcat "${f}"`, {
              encoding: 'utf8', timeout: 8000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
            })
            digest = sessionDigest(txt)
            if (cacheKey) {
              if (_DIGEST_CACHE.size >= 200) _DIGEST_CACHE.clear()
              _DIGEST_CACHE.set(cacheKey, digest)
            }
          }
          meta = digest.meta
        } catch { continue }
        if (!meta || String(meta.origin || '') !== 'subagent') continue
        const sid = n
        out.total++
        // 是否已纳入 jarvis 任务单：exec-map 里登记过 = 是
        let tracked = false
        try {
          const mapFile = path.join(dir, '.jarvis', 'tickets', 'exec-map.json')
          if (fs.existsSync(mapFile)) {
            const mp = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
            tracked = Object.values(mp || {}).some((slot) => Object.values(slot || {}).some((info) => String(info && info.childId || '') === sid))
          }
        } catch { tracked = false }
        if (tracked) out.tracked++; else out.untracked++
        out.items.push({
          id: sid,
          cwd: String((digest.dirs && digest.dirs.length ? digest.dirs[digest.dirs.length - 1] : '') || meta.cwd || ''),
          parent: String(meta.parentSession || ''),
          createdAt: meta.createdAt ? new Date(Number(meta.createdAt)).toISOString() : '',
          tracked,
          // ── 真实工作内容（让 UI 显示「它在干什么」，而不是只有一个数量）──
          label: String(digest.label || ''),           // subagent/descriptor.label：任务标题
          model: String(digest.model || ''),           // agentModel
          lastText: String(digest.lastText || ''),     // 最后一条 assistant 文本（摘要 240 字）
          lastTool: String(digest.lastTool || ''),     // 最近一次 tool/call 的工具名
          steps: Number(digest.steps || 0),            // step/end 次数 ≈ 完成的推理步数
          lastActivityAt: digest.lastAt ? new Date(Number(digest.lastAt)).toISOString() : '',
          // ── 更多可展示的细节（详情页用；主屏只用 title/lastText）──
          outputs: Array.isArray(digest.outputs) ? digest.outputs : [],   // 写出的产物路径（"做出了什么"的硬证据）
          toolCounts: digest.toolCounts || {},                            // 工具构成，如 {bash:94, write:11, read:9}
          firstText: String(digest.firstText || ''),                      // 开场白（可看它怎么理解任务）
          // ── 详情页素材（用户要「看得懂到底干了什么」）──
          brief: String(digest.brief || ''),                              // 派活原文：它接到的任务书
          texts: Array.isArray(digest.texts) ? digest.texts : [],         // 过程中的叙述（分步做了什么）
          reads: Array.isArray(digest.reads) ? digest.reads : [],         // 读过哪些材料
          dirs: Array.isArray(digest.dirs) ? digest.dirs : [],            // 实际干活的工作目录（可能切换过）
          trail: Array.isArray(digest.trail) ? digest.trail : [],         // 行动轨迹：每步做了什么（工具+对象）
        })
      }
    }
    // 最新的在前，最多 20 条（UI 不需要几千条）
    out.items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    out.items = out.items.slice(0, 20)
  } catch { /* 扫描失败不影响主快照 */ }
  return out
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

/** 票据体系摘要（wings 主屏数据源——待办#6：从 team.json 切 tickets）：.jarvis/tickets/ticket-*.json + proposals.jsonl（成员自主找活提案）。只读。 */
/** E：验收状态归一。
 *  老板只关心「能不能验收」。原始数据里 ended.outcome 是无枚举的字符串、
 *  reportState 是 progress/waiting/ready/blocked/failed —— 两处都能推出部分信息。
 *  原则：判得出来才说，判不出来就 unknown（不猜、不美化）。
 *  返回：pending（待验收）/ passed（已验收）/ rejected（被打回）/ abandoned（已放弃）/ unknown
 */
function deriveAcceptance(ticket, asg) {
  const ended = ticket && ticket.ended
  const reportState = String((asg && asg.report && asg.report.state) || '').toLowerCase()
  const outcome = String((ended && ended.outcome) || '').toLowerCase()
  // ① 已结束：看 outcome 语义（无枚举，按关键词宽匹配）
  if (ended) {
    if (/fail|reject|abandon|drop|cancel|error/.test(outcome)) return 'abandoned'
    if (/ready|pass|accept|done|complete|success|ok/.test(outcome)) return 'passed'
    return 'unknown'                       // 结束了但看不出算不算通过
  }
  // ② 未结束：看最近汇报
  if (reportState === 'ready') return 'pending'   // 成员说做完了 → 待验收
  if (reportState === 'blocked' || reportState === 'failed') return 'blocked'
  if (reportState === 'progress' || reportState === 'waiting') return 'in_progress'
  return 'unknown'
}

/** A：交付物聚合层——把工作单按「项目/需求」聚合成老板能看懂的单位。
 *
 *  为什么需要：老板问「交了什么」，系统只答得出「T1 完成了、T2 完成了」= 苦劳清单。
 *  交付物 = 一个需求/一个项目，带完成率 + 验收状态 + 是否卡住。
 *
 *  聚合键：ticket.project（已验证字段存在）；为空则退回「本工作区」单一分组，
 *  仍能给出总完成率（不会退化成平铺列表）。
 */
function buildDeliverables(projectDir, tickets, path) {
  const all = (tickets && tickets.open || []).concat(tickets && tickets.done || [])
  if (!all.length) return []
  const groups = new Map()
  for (const t of all) {
    // 归属键：project 可以是需求名，也可以是路径（旧数据）。两者都要能聚合。
    const raw = String(t.project || '').trim()
    const key = raw || String(projectDir)
    if (!groups.has(key)) {
      // 显示名：像路径就用末段（/opt/work/xxx → xxx），否则原样（「拼团电商」直接用）
      const looksLikePath = /^[A-Za-z]:[\\/]|[\\/]/.test(raw)
      const name = raw
        ? (looksLikePath ? (path.basename(raw) || raw) : raw)
        : path.basename(String(projectDir))
      groups.set(key, { key, name, items: [] })
    }
    groups.get(key).items.push(t)
  }
  const out = []
  for (const g of groups.values()) {
    const items = g.items
    // 只算「真的完成」的：accepted = passed 或 pending（成员说做完了）都算交付到位？
    // 老板视角：passed 才算交付；pending 是「做了待你验收」；其余都不算。
    const passed = items.filter((x) => x.acceptance === 'passed').length
    const pending = items.filter((x) => x.acceptance === 'pending').length
    const blocked = items.filter((x) => x.acceptance === 'blocked' || x.ended === null && /fail/.test(String(x.state || ''))).length
    const abandoned = items.filter((x) => x.acceptance === 'abandoned').length
    const total = items.length
    const doneCount = passed + pending                    // 交付到位的（含待验收）
    const pct = total ? Math.round((doneCount / total) * 100) : 0
    // 是否全部收口：全部 passed 且无 open
    const allClosed = total > 0 && passed === total
    out.push({
      key: g.key,
      name: g.name,
      total,
      pct,
      passed,
      pending,
      blocked,
      abandoned,
      allClosed,
      // 老板要看的是「能不能交」——一句话结论
      verdict: allClosed ? 'delivered'
        : blocked > 0 ? 'blocked'
          : total === 0 ? 'empty'
            : 'in_progress',
      updatedAt: items.reduce((m, x) => (String(x.updatedAt || '') > m ? String(x.updatedAt) : m), ''),
      items: items.map((x) => ({ id: x.id, title: x.title, role: x.role, acceptance: x.acceptance, summary: x.summary })).slice(0, 30),
    })
  }
  // 有卡住的排前面（老板先看风险），然后按完成率低的排前
  out.sort((a, b) => {
    const rank = (x) => (x.verdict === 'blocked' ? 0 : x.allClosed ? 2 : 1)
    return rank(a) - rank(b) || a.pct - b.pct
  })
  return out
}

/** C：空白语义化——把「页面为什么空」变成机器可判的事实。
 *
 *  三种空白对老板意义完全不同，必须区分（否则他分不清「没事」和「出事」）：
 *    normal    还没派活 —— 正常，等需求
 *    misplaced 有活但在别的工作区 —— 异常，应提示切换
 *    offbook   活在别处跑（绕过任务单的原生子会话）—— 异常，应提示纳入
 *    noWorkspace 根本没解析到工作区 —— 异常，配置问题
 */
function deriveEmptyReason(dir, snapshotParts) {
  const { tickets, deliverables, dshSubagents, active } = snapshotParts
  const hasTickets = (tickets.open || []).length > 0 || (tickets.done || []).length > 0
  const hasDeliv = (deliverables || []).length > 0
  if (hasTickets || hasDeliv) return { kind: 'none', text: '' }
  if (!dir) return { kind: 'noWorkspace', text: '没有解析到工作区' }
  const offbook = Number((dshSubagents && dshSubagents.untracked) || 0)
  if (offbook > 0) {
    return {
      kind: 'offbook',
      text: `这个工作区没有任务单，但检测到 ${offbook} 个原生子会话在工作区里跑——它们绕过了任务单，所以没有进度和验收。`,
      count: offbook,
    }
  }
  if (!active) return { kind: 'normal', text: '还没有开始工作。给一个需求，我就安排团队开工。' }
  return { kind: 'normal', text: '当前没有进行中的任务。给一个需求，我就安排团队开工。' }
}

/** D：日报/周报聚合——按天把「做完的 / 卡住的 / 下一步」聚成一段人话。
 *
 *  为什么按天而不是按任务：老板问的是「今天干了什么」，不是「T3 的第三阶段做到哪了」。
 *  数据来源（聚合 + 提炼兜底）：
 *    ① 有 ticket 汇报 → 直接聚合 summary（最准）
 *    ② 没汇报 → 从事件流提炼（只取 完成/验收/阻塞 三类，翻译成业务语言）
 *  只保留最近 7 天（周报粒度），每天最多 8 条，避免变成流水账。
 */
function buildDailyReports(projectDir, tickets, fs, path) {
  const all = (tickets.open || []).concat(tickets.done || [])
  const days = new Map()                      // YYYY-MM-DD → {done:[],stuck:[],next:[]}
  const dayOf = (iso) => String(iso || '').slice(0, 10)
  for (const t of all) {
    const at = t.updatedAt || t.createdAt || ''
    const d = dayOf(at)
    if (!d) continue
    if (!days.has(d)) days.set(d, { date: d, done: [], stuck: [], next: [], total: 0 })
    const day = days.get(d)
    day.total++
    const brief = String(t.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (t.acceptance === 'passed' || t.acceptance === 'pending') {
      day.done.push({ title: String(t.title || '').slice(0, 80), note: brief, role: String(t.role || '') })
    } else if (t.acceptance === 'blocked' || t.acceptance === 'abandoned') {
      day.stuck.push({ title: String(t.title || '').slice(0, 80), note: brief })
    } else {
      day.next.push({ title: String(t.title || '').slice(0, 80), note: brief })
    }
  }
  // 提炼兜底：当天没有 ticket 汇报时，从事件流取 完成/阻塞 类
  let events = []
  try {
    const evFile = path.join(projectDir, '.jarvis', 'events.jsonl')
    if (fs.existsSync(evFile)) {
      events = fs.readFileSync(evFile, 'utf8').split('\n').filter(Boolean).slice(-200).map((l) => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean)
    }
  } catch { events = [] }
  for (const e of events) {
    const ty = String((e && e.type) || '')
    if (!/task\.completed|gate|board|gc\.collected|assignment\./.test(ty)) continue   // 只取有业务含义的
    const d = String((e && e.at) || '').slice(0, 10)
    if (!d) continue
    if (!days.has(d)) days.set(d, { date: d, done: [], stuck: [], next: [], total: 0 })
    const day = days.get(d)
    // 只在当天没有 ticket 数据时补（避免重复）
    if (day.total > 0) continue
    if (/task\.completed/.test(ty)) day.done.push({ title: '完成了一项任务', note: String((e.data && e.data.subject) || '').slice(0, 80), role: '' })
    else if (/board/.test(ty)) day.next.push({ title: '有待处理事项', note: '', role: '' })
  }
  const out = [...days.values()]
    .filter((d) => d.done.length || d.stuck.length || d.next.length)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7)
    .map((d) => ({
      date: d.date,
      doneCount: d.done.length,
      stuckCount: d.stuck.length,
      // 一句话总结（老板只看这句）
      headline: d.stuck.length
        ? `${d.done.length} 项完成，${d.stuck.length} 项卡住`
        : d.done.length ? `${d.done.length} 项完成` : '无进展',
      done: d.done.slice(0, 8),
      stuck: d.stuck.slice(0, 5),
      next: d.next.slice(0, 5),
    }))
  return out
}

function ticketsSummary(projectDir, fs, path) {
  const dir = path.join(projectDir, '.jarvis', 'tickets')
  const tickets = []
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^ticket-.*\.json$/.test(name)) continue
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
        if (!t || !t.id) continue
        const asg = (t.assignments || []).slice(-1)[0] || {}
        const mandateText = (() => {
          const m = t.mandate
          if (!m) return ''
          if (typeof m === 'string') return m.slice(0, 400)
          return [m.by ? '来自 ' + m.by : '', m.basis || '', m.gate ? '依据 ' + m.gate : ''].filter(Boolean).join('；').slice(0, 400)
        })()
        tickets.push({
          id: String(t.id),
          title: String(t.title || ''),
          stage: String(t.stage || 'build'),
          // 交付物聚合层（方案 A）用：这张单属于哪个项目/需求。
          // 原投影丢了 project（原始 JSON 有），导致无法聚合 → 只能平铺任务点。
          project: String(t.project || '').slice(0, 200),
          createdAt: t.createdAt || '',
          updatedAt: t.updatedAt || '',
          ended: t.ended || null,
          // 验收状态归一（方案 E）：老板只关心「能不能验收」。
          // 由 ended.outcome（取值无枚举）+ 最近汇报状态推导；判不出就是 unknown（不猜）。
          acceptance: deriveAcceptance(t, asg),
          mandate: mandateText,
          origin: t.origin ? (typeof t.origin === 'string' ? t.origin : String(t.origin.type || t.origin.source || t.origin.kind || '')).slice(0, 80) : '',
          attempts: (t.assignments || []).length,
          startedAt: asg.startedAt || '',
          endedAt: asg.endedAt || '',
          endedReason: asg.endedReason ? String(asg.endedReason).slice(0, 120) : '',
          role: String(asg.role || ''),
          state: String(asg.state || ''),
          reportState: asg.report && asg.report.state ? String(asg.report.state) : '',
          reportAt: asg.report && asg.report.at ? String(asg.report.at) : '',
          summary: asg.report && asg.report.summary ? String(asg.report.summary).slice(0, 400) : '',
        })
      } catch {}
    }
  } catch {}
  tickets.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
  const open = tickets.filter((t) => !t.ended)
  const done = tickets.filter((t) => t.ended).slice(0, 20)
  const proposals = []
  try {
    const raw = fs.readFileSync(path.join(dir, 'proposals.jsonl'), 'utf8')
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const p = JSON.parse(line)
        if (p && p.status === 'pending') proposals.push({ id: String(p.id), title: String(p.title || ''), proposer: String(p.proposer || ''), why: String(p.why || '').slice(0, 300), basis: String(p.basis || '').slice(0, 300), at: p.at || '' })
      } catch {}
    }
  } catch {}
  return { open, done, proposals }
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
  const tickets = ticketsSummary(dir, fs, path)
  // A/C 共用：只算一次（每个快照都算，避免重复扫盘/重复解压 zstd）
  const deliverables = buildDeliverables(dir, tickets, path)
  const subagents = dshSubagents(dir, fs, path)
  const memory = memorySummary(dir, fs, path)
  let gc = null
  try { gc = gcSummary(dir) } catch { gc = null }
  const gates = readJsonSafe(dir, '.jarvis/gates.json', fs, path) || {}
  const company = readJsonSafe(dir, '.jarvis/company-state.json', fs, path)
  const active = Boolean(
    (stage && stage.index > 1) || teams.teams.length || board.total || cards.length || memory.exists || Object.keys(gates).length || tickets.open.length || tickets.done.length || tickets.proposals.length,
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
      activeTeams: teams.activeTeams || [],
      teams: teams.teams,
      byAssignee: teams.teams.flatMap((t) => t.tasks.map((x) => ({ ...x, team: t.name }))),
    },
    board,
    tickets,
    // 方案 A：老板视角的交付物聚合（主屏只渲染这个）
    deliverables,
    // 方案 C：空白语义化——页面空的时候必须说清是哪种空
    emptyReason: deriveEmptyReason(dir, { tickets, deliverables, dshSubagents: subagents, active }),
    // 方案 D：日报/周报（历史页用，按天聚合 + 事件流提炼兜底）
    dailyReports: buildDailyReports(dir, tickets, fs, path),
    gc,
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
    dshSubagents: subagents,
    company: company || (teams.teams.length
      ? {
          company: { name: path.basename(dir) },
          employees: teams.teams.flatMap((t) =>
            (t.members || []).map((m) => {
              const cur = t.tasks.find((x) => x.assignee === (m.role || m.name) && !['completed', 'cancelled', 'failed', 'dropped'].includes(x.status))
              // v0.35：status 以成员事实为准（m.status 来自 jarvis-facts，含 working/stalled/idle）。
              // 旧实现 cur?'working':'idle' —— 有未结束任务就显示"在干活"，不管会话死活 → 3D 画面假活跃。
              const st = String(m.status || (cur ? 'working' : 'idle'))
              return {
                id: m.name || m.role,
                role: m.role || m.name,
                persona: (m.name && m.role && m.name !== m.role) ? m.name : '',
                status: st,
                taskId: cur ? cur.id : '',
                currentWork: cur ? cur.subject : '',
                // 成员自写进度（STATUS.md 首行）——没有就空，前端如实显示"未记录进度"
                statusLine: String(m.statusLine || ''),
                lastActivityAt: String(m.lastActivityAt || ''),
                team: t.name,
              }
            }),
          ),
        }
      : null),
    capabilities: {
      toolCount: Number(meta.tools || 0),
      version: String(meta.version || ''),
      panels: ['stage', 'tasks', 'board', 'meetings', 'cards', 'memory', 'company', 'console', 'events', 'voice', 'chat'],
      // 能力台契约：工具清单/参数 schema 由 /api/jarvis/tools 提供，执行入口 /api/jarvis/command
      chatEndpoint: '/api/jarvis/chat',
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
