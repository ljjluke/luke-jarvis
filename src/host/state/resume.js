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
  if (!projectText && (gates.length || openTasks.length || board.length)) {
    lines.push('进度：.jarvis/project.md 还没有内容（进度未落盘）')
  }
  if (gates.length) lines.push(`已过闸：${gates.join(' → ')}`)
  if (openTasks.length) lines.push(`未完成任务：${openTasks.slice(0, 6).join('、')}${openTasks.length > 6 ? ` 等 ${openTasks.length} 个` : ''}`)
  if (board.length) {
    const show = board.slice(0, 3).map((i) => `${i.id || '?'}${i.type ? '(' + i.type + ')' : ''}`)
    lines.push(`黑板未决：${board.length} 项（${show.join('、')}${board.length > 3 ? '…' : ''}）`)
  }
  if (!lines.length) return ''
  return ['【续接事实 · 插件每轮从磁盘重算（与对话记忆无关，压缩/换会话/重启后同样）】', ...lines.map((l) => '- ' + l)].join('\n')
}
