/** 事件日志（append-only）：UI 时间轴 / 流程回放 / 轮询增量的数据源。

 *  为什么需要：快照只描述"现在"，UI 想要"刚才发生了什么"（谁派了活、哪个闸拦了、会议纪要落了）就要事件流。
 *  设计：
 *   - 落盘 `.jarvis/events.jsonl`（一行一条，append-only，坏了跳过不崩）；
 *   - 每条带自增 `seq`（从文件行数推，不用锁）；
 *   - 写入点必须是"事实发生处"（闸记录、黑板写、会议纪要、派活），不在渲染路径写（渲染无副作用）。
 */
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

export function eventsFile(projectDir, path = _require('node:path')) {
  return path.join(String(projectDir || ''), '.jarvis/events.jsonl')
}

/** GC：事件日志轮转阈值。超过即把 events.jsonl 整体让位为 events.jsonl.old（覆盖上一代），
 *  当前文件重开——防止长期运行 append-only 无限膨胀。
 *  K17：轮转**不重置 seq**（见下）；seq 继续接旧文件最大值编号。 */
const EVENTS_ROTATE_BYTES = 2 * 1024 * 1024

/** 读文件里最大的 seq（只在轮转这一刻整读一次旧文件，不在热路径）。
 *  为什么不用行数：坏行/并发丢行会让行数 < maxSeq，续接值偏小 → 前端 since 之后的事件被重复或漏掉。 */
function maxSeqInFile(file, fs) {
  let max = 0
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (e && Number(e.seq) > max) max = Number(e.seq)
      } catch { /* 坏行跳过 */ }
    }
  } catch { /* 文件不存在 */ }
  return max
}

/** 轮转后的编号基线（`events.jsonl.base`，单行数字）。
 *  K17：旧实现轮转后新文件 seq 从 1 重算，前端拿旧 lastSeq 做 since 永远读不到新事件（时间轴静默停更）。
 *  把旧文件 maxSeq 落成基线文件，重启后也能续接（不能只靠内存或 .old 解析：.old 会被下一代轮转覆盖）。 */
export function rotationBaseSeq(file, fs = _require('node:fs')) {
  try {
    const n = Number(fs.readFileSync(file + '.base', 'utf8').trim())
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch { return 0 }
}

function rotateIfNeeded(file, fs) {
  try {
    const st = fs.statSync(file)
    if (st.size <= EVENTS_ROTATE_BYTES) return
    const max = maxSeqInFile(file, fs)
    if (max > 0) {
      try { fs.writeFileSync(file + '.base', String(max) + '\n') } catch { /* 基线写不了：续接退化为行数（仍好于归零） */ }
    }
    fs.renameSync(file, file + '.old') // rename 覆盖同名 .old
  } catch { /* 文件不存在/被并发轮转：不处理 */ }
}

/** 追加一条事件；返回 { seq, at, type }，失败返回 null（不抛，事件不该阻断主流程）。 */
export function appendEvent(projectDir, type, data = {}, path = _require('node:path')) {
  if (!projectDir) return null
  const fs = _require('node:fs')
  const file = eventsFile(projectDir, path)
  try {
    let seq = 0
    try { rotateIfNeeded(file, fs) } catch { /* 轮转失败：继续写旧文件（最多不轮转） */ }
    // K17：seq = 轮转基线 + 当前文件行数（新文件从 base 之后继续，绝不归零）
    const base = rotationBaseSeq(file, fs)
    try {
      const text = fs.readFileSync(file, 'utf8')
      seq = base + text.split('\n').filter(Boolean).length
    } catch {
      seq = base
    }
    const e = { seq: seq + 1, at: new Date().toISOString(), type: String(type || ''), data: data && typeof data === 'object' ? data : {} }
    const line = JSON.stringify(e) + '\n'
    try {
      fs.appendFileSync(file, line)
    } catch {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, line)
    }
    return { seq: e.seq, at: e.at, type: e.type }
  } catch {
    return null
  }
}

/** 读事件（since 之后，最多 limit 条）；坏行跳过。 */
export function readEvents(projectDir, opts = {}, path = _require('node:path')) {
  const fs = _require('node:fs')
  const since = Number(opts.since || 0)
  const limit = Math.max(1, Math.min(500, Number(opts.limit || 100)))
  let text = ''
  try {
    text = fs.readFileSync(eventsFile(projectDir, path), 'utf8')
  } catch {
    return { events: [], lastSeq: 0, total: 0 }
  }
  const all = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e && Number(e.seq) > 0) all.push(e)
    } catch {
      /* 坏行跳过 */
    }
  }
  const total = all.length
  const lastSeq = total ? Number(all[total - 1].seq) : 0
  // since 之后的增量；`tail:true` = 直接给最新的 limit 条（首屏用，否则拿到的是最旧的一批）
  const picked = opts.tail ? all.slice(-limit) : all.filter((e) => Number(e.seq) > since).slice(0, limit)
  // nextSeq = 本次返回的最后一条 seq（0=无）：UI 必须用它做下一次 since，
  // 不能用 lastSeq —— 否则当 since 之后事件多于 limit 时，中间事件被静默跳过（真 bug）。
  const nextSeq = picked.length ? Number(picked[picked.length - 1].seq) : Number(since || 0)
  const hasMore = picked.length > 0 && nextSeq < lastSeq
  return { events: picked, lastSeq, nextSeq, hasMore, total }
}
