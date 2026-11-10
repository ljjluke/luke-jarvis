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

/** 追加一条事件；返回 { seq, at, type }，失败返回 null（不抛，事件不该阻断主流程）。 */
export function appendEvent(projectDir, type, data = {}, path = _require('node:path')) {
  if (!projectDir) return null
  const fs = _require('node:fs')
  const file = eventsFile(projectDir, path)
  try {
    let seq = 0
    try {
      const text = fs.readFileSync(file, 'utf8')
      seq = text.split('\n').filter(Boolean).length
    } catch {
      seq = 0
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
  const events = all.filter((e) => Number(e.seq) > since).slice(0, limit)
  return { events, lastSeq, total }
}
