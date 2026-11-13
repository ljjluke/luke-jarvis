/** 续接事实（每轮从磁盘重算，直接进 systemPrompt——不靠提示词要求模型"必须先读记忆"）。

 *  为什么这样做：用户明确要求"不要用提示词强调必须执行什么，要流程固化"。
 *  原来压缩后靠一句 prompt「先 jarvis_store(check) 读回 project.md」——那是提示词，压缩/弱模型都会掉精度。
 *  改成：插件每轮自己把"进度/下一步/未决/团队/已过闸"从磁盘读出来，直接放进上下文。
 *  模型不需要记住任何指令，也不需要先去读文件——事实已经在眼前。
 */
import { createRequire } from 'node:module'
import { computeStage } from '../gates/stage.js'

const _require = createRequire(import.meta.url)

const MAX_LINE = 160

/** 从 project.md 里抽「当前进度 / 下一步 / 未决项 / 团队 / 关键决策」这几类行（宽松匹配，取第一条）。 */
function pickProjectLines(text) {
  const out = {}
  const src = String(text || '')
  if (!src) return out
  const pick = (label, re) => {
    const line = src
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*#>\s]+/, '').trim())
      .find((l) => l && re.test(l))
    if (!line) return
    // project.md 里的行通常已带标签（"当前进度：…"），去掉重复前缀再输出
    const body = line.replace(/^(当前进度|进度|下一步|未决项?|遗留(问题)?|团队(清单)?|成员清单|关键决策(与依据)?|决策)\s*[：:]\s*/, '')
    const text = body || line
    out[label] = text.length > MAX_LINE ? text.slice(0, MAX_LINE) + '…' : text
  }
  // 标签锚定：必须行首出现该标签，避免"拍板"之类词被别行抢走
  pick('进度', /^(当前进度|进度)[：:]|^当前进度|进行到哪/i)
  pick('下一步', /^(下一步|接着干|下一个动作|next step)[：:]?/i)
  pick('未决', /^(未决项?|遗留(问题)?|open|待办)[：:]?/i)
  pick('团队', /^(团队(清单)?|成员清单|assignee)[：:]?/i)
  pick('决策', /^(关键决策(与依据)?|决策|拍板|选型|否决)[：:]?/i)
  return out
}

function openTasksOf(projectDir, path) {
  const fs = _require('node:fs')
  const td = path.join(projectDir, '.agent-teams')
  const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'dropped'])
  const ids = []
  let names = []
  try {
    names = fs.readdirSync(td).filter((n) => !/^(archived|_archive|\.)|-archive$/i.test(n))
  } catch {
    return ids
  }
  for (const t of names) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(td, t, 'team.json'), 'utf8'))
      for (const x of d.tasks || []) if (!TERMINAL.has(String(x.status))) ids.push(String(x.id ?? ''))
    } catch {
      /* 坏文件跳过 */
    }
  }
  return ids
}

function boardOpenOf(projectDir, path) {
  const fs = _require('node:fs')
  try {
    const d = JSON.parse(fs.readFileSync(path.join(projectDir, '.jarvis/board.json'), 'utf8'))
    return (d.items || []).filter((i) => String(i.status || 'open') === 'open')
  } catch {
    return []
  }
}

function passedGatesOf(projectDir, path) {
  // 用与阶段段同一份计算（computeStage.done），避免"gates.json 说有、阶段段说没有"的两套口径
  try {
    return (computeStage(projectDir) || {}).done || []
  } catch {
    return []
  }
}

/**
 * 渲染「续接事实」块：全部来自磁盘，无任何"你必须先…"的指令。
 * @returns {string} 空字符串 = 没有任何可报事实（干净工作区）
 */
/** 最新进度流水的时间戳（第 ① 层写入的 .jarvis/progress/*.jsonl）。
 *  用于第 ② 层「新鲜度门」：project.md 是派生产物，流水才是动作真相源。 */
function latestProgressAt(projectDir, fs, path) {
  try {
    const dir = path.join(projectDir, '.jarvis', 'progress')
    let newest = 0
    for (const n of fs.readdirSync(dir)) {
      if (!n.endsWith('.jsonl')) continue
      try {
        const st = fs.statSync(path.join(dir, n))
        if (st.mtimeMs > newest) newest = st.mtimeMs
      } catch { /* 单文件跳过 */ }
    }
    return newest
  } catch { return 0 }
}

/** 第 ② 层新鲜度门：project.md 是否落后于机器流水。
 *  判据是单调性（时间戳比较），不依赖模型、不依赖上下文——压缩后依然可靠。
 *  @returns {string} 过期告警文本；空字符串 = 新鲜或无法判定（不误报）
 */
function stalenessNote(projectDir, fs, path) {
  const latest = latestProgressAt(projectDir, fs, path)
  if (!latest) return ''                       // 没有流水 = 无法比较，不误报
  try {
    const st = fs.statSync(path.join(projectDir, '.jarvis/project.md'))
    if (st.mtimeMs >= latest) return ''        // project.md 不落后
    const lagMin = Math.round((latest - st.mtimeMs) / 60000)
    if (lagMin < 5) return ''                  // 5 分钟内差异算同步（避免每轮误报）
    const lagH = lagMin >= 60 ? `约 ${Math.round(lagMin / 60)} 小时` : `${lagMin} 分钟`
    return `⚠️ 以下进度可能已过期（.jarvis/project.md 落后机器流水${lagH}）——动手前先用 jarvis_store(check) 复核磁盘现状，不要直接按上面写的续做。`
  } catch { return '' }                        // project.md 不存在时另由缺口提示覆盖
}

export function renderResumeFacts(projectDir, path = _require('node:path')) {
  const fs = _require('node:fs')
  const base = String(projectDir || '')
  if (!base) return ''
  const lines = []
  let projectText = ''
  try {
    projectText = fs.readFileSync(path.join(base, '.jarvis/project.md'), 'utf8')
  } catch {
    projectText = ''
  }
  const picked = pickProjectLines(projectText)
  const gates = passedGatesOf(base, path)
  const openTasks = openTasksOf(base, path)
  const board = boardOpenOf(base, path)
  for (const k of ['进度', '下一步', '未决', '团队', '决策']) {
    if (picked[k]) lines.push(`${k}：${picked[k]}`)
  }
  // 第 ③ 层：抽取失效告警——project.md 有内容但一条都没抽到，必须显性提示，
  // 不能让续接块静默变空（那样模型和客户都不知道保护失效了）。
  if (projectText && !Object.keys(picked).length) {
    lines.push('⚠️ .jarvis/project.md 有内容但未识别出标准段落（进度/下一步/未决项/团队/决策）——进度格式可能已变，动手前先完整读一遍 .jarvis/project.md。')
  }
  if (!projectText && (gates.length || openTasks.length || board.length)) {
    lines.push('进度：.jarvis/project.md 还没有内容（进度未落盘）')
  }
  if (gates.length) lines.push(`已过闸：${gates.join(' → ')}`)
  if (openTasks.length) lines.push(`未完成任务：${openTasks.slice(0, 6).join('、')}${openTasks.length > 6 ? ` 等 ${openTasks.length} 个` : ''}`)
  if (board.length) {
    const show = board.slice(0, 3).map((i) => `${i.id || '?'}${i.type ? '(' + i.type + ')' : ''}`)
    lines.push(`黑板未决：${board.length} 项（${show.join('、')}${board.length > 3 ? '…' : ''}）`)
  }
  // 第 ② 层：过期告警放在最前面（先看到风险，再看内容）
  const stale = stalenessNote(base, fs, path)
  if (!lines.length && !stale) return ''
  const head = '【续接事实 · 插件每轮从磁盘重算（与对话记忆无关，压缩/换会话/重启后同样）】'
  const body = lines.map((l) => '- ' + l)
  if (stale) body.unshift('- ' + stale)
  return [head, ...body].join('\n')
}
