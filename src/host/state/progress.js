/** 机器进度流水（第 ① 层 · 压缩保活的地基）。
 *
 *  为什么需要：对话历史会被上下文压缩，而"已经发生过什么"是不可重建的事实。
 *  只靠模型自觉写 project.md（6 小时提醒一次）在最长会话里最容易失效——
 *  恰恰是最需要保护的场景。所以这里由插件**自己**记，不问模型。
 *
 *  设计约束（来自推演与辩论）：
 *   · append-only：冲突最小，压缩丢了也能重放；
 *   · 按 ticket/会话分段：超长会话不会堆成一个读不完的大文件；
 *   · 异步 + 失败不阻塞：NFS/慢盘不允许拖慢主循环；
 *   · 只记结构化短字段：不存长文本，避免膨胀。
 *
 *  输出：<workspace>/.jarvis/progress/<分段>.jsonl
 *    每行 {at:"ISO", tool:"jarvis_xxx", action:"...", target:"ticket-123", ok:true|false}
 */
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)
const fs = () => _require('node:fs')
const pathMod = () => _require('node:path')

const PROGRESS_DIR = () => pathMod().join('.jarvis', 'progress')
/** 单文件超过这个行数就换段（防止超长会话写成一个读不完的大文件） */
const SEG_LINES = 1500
const KEEP_CHARS = 180

function dirOf(projectDir) { return pathMod().join(String(projectDir || ''), PROGRESS_DIR()) }

/** 从工具名/参数里抽一个短「动作 + 对象」，只保留结构化字段。 */
function summarize(tool, args) {
  const toolName = String(tool || '').replace(/^jarvis_/, '')
  const a = args && typeof args === 'object' ? args : {}
  const action = String(a.action || a.mode || '').slice(0, 24)
  const target = String(a.ticketId || a.id || a.proposalId || a.projectDir || '').slice(0, 48)
  return { tool: toolName, action, target }
}

/** 当前应该写到哪个分段文件。
 *  规则：有 ticketId 的按 ticket 分段（同单的来龙去脉在一处）；
 *        没有的按天分段（避免所有杂项挤在同一个文件）。 */
function segNameOf(target) {
  const t = String(target || '')
  if (/^ticket-/.test(t)) return t.replace(/[^\w.-]/g, '_')
  return 'day-' + new Date().toISOString().slice(0, 10)
}

function countLines(file) {
  try { return fs().readFileSync(file, 'utf8').split('\n').filter(Boolean).length } catch { return 0 }
}

/** 滚动分段：当前段满 SEG_LINES 行就换到 <name>.<n>.jsonl */
function pickFile(dir, name) {
  let idx = 0
  for (;;) {
    const file = idx === 0 ? pathMod().join(dir, name + '.jsonl') : pathMod().join(dir, `${name}.${idx}.jsonl`)
    if (!fs().existsSync(file)) return file
    if (countLines(file) < SEG_LINES) return file
    idx++
    if (idx > 99) return file   // 极端兜底：不无限滚动
  }
}

/**
 * 记一条进度。**永不抛错、永不阻塞调用方**（写失败只是少一条记录）。
 * @param {string} projectDir 工作区根
 * @param {string} tool 工具名（jarvis_xxx）
 * @param {object} args 工具入参（只读取结构化字段）
 * @param {object} [opts] {ok:boolean, note:string}
 */
export function recordProgress(projectDir, tool, args, opts = {}) {
  try {
    const root = String(projectDir || '')
    if (!root) return false
    const { tool: t, action, target } = summarize(tool, args)
    const dir = dirOf(root)
    fs().mkdirSync(dir, { recursive: true })
    const file = pickFile(dir, segNameOf(target))
    const rec = {
      at: new Date().toISOString(),
      tool: t,
      action,
      target,
      ok: opts.ok === false ? false : true,
    }
    if (opts.note) rec.note = String(opts.note).slice(0, KEEP_CHARS)
    // 异步写：不让磁盘拖慢主循环（NFS/慢盘场景的关键约束）
    const line = JSON.stringify(rec) + '\n'
    const doWrite = () => { try { fs().appendFileSync(file, line) } catch { /* 写失败静默：少一条记录不影响主流程 */ } }
    if (typeof setImmediate === 'function') setImmediate(doWrite)
    else doWrite()
    return true
  } catch { return false }
}

/** 读最近 N 条流水（排查与自检用；不参与续接注入，避免每轮读大文件）。 */
export function readRecentProgress(projectDir, limit = 20) {
  try {
    const dir = dirOf(projectDir)
    const files = fs().readdirSync(dir).filter((n) => n.endsWith('.jsonl'))
      .map((n) => ({ n, m: fs().statSync(pathMod().join(dir, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    const out = []
    for (const f of files) {
      if (out.length >= limit) break
      try {
        const lines = fs().readFileSync(pathMod().join(dir, f.n), 'utf8').split('\n').filter(Boolean)
        for (const l of lines.slice(-limit)) {
          try { out.push(JSON.parse(l)) } catch { /* 坏行跳过 */ }
        }
      } catch { /* 单文件跳过 */ }
    }
    return out.slice(-limit)
  } catch { return [] }
}

/** 进度流水目录是否存在且非空（供测试与自检判断第 ① 层是否在工作）。 */
export function hasProgress(projectDir) {
  try {
    const dir = dirOf(projectDir)
    return fs().readdirSync(dir).some((n) => n.endsWith('.jsonl') && countLines(pathMod().join(dir, n)) > 0)
  } catch { return false }
}
