/** 需求视角（老板/用户关心）：从 .jarvis/docs/需求规格-*.md 解析需求清单，
 *  用团队任务完成度做启发式状态（done/doing/pending），输出「总数/完成比例/正在做第几个」。
 *  纯 Node、跨平台；解析失败返回空（页面自动不显示需求卡，保持待命）。
 */
import fs from 'node:fs'
import path from 'node:path'

function read(p) { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }

export function requirementsDigest(projectDir) {
  const base = path.join(String(projectDir || ''), '.jarvis')
  const docs = path.join(base, 'docs')
  let docFile = ''
  try {
    const cands = fs.readdirSync(docs).filter((n) => /^需求规格.*\.md$/i.test(n))
    docFile = cands.sort((a, b) => fs.statSync(path.join(docs, a)).mtimeMs - fs.statSync(path.join(docs, b)).mtimeMs).pop() || ''
  } catch { return { total: 0, done: 0, doing: 0, current: null, items: [] } }
  if (!docFile) return { total: 0, done: 0, doing: 0, current: null, items: [] }
  const text = read(path.join(docs, docFile))
  const items = []
  // 解析「### R1 ...」或「- **R1 ...**」形式的条目
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // ① Markdown 表格：| F1 | 标题 | 验收 | ；② ### R1 标题；③ - **R1 标题**
    const tm = line.match(/^\|\s*((?:F|R|T|P)\d+)\s*\|\s*([^|]{2,120})\|/)
    const hm = line.match(/^(?:#{2,4}\s*)((?:F|R|T|P)\d+)[\.、:：]?\s*(.+)$/)
    const bm = line.match(/^(?:- )?\*\*((?:F|R|T|P)\d+)[\.、:：]?\s*(.{2,80}?)\*\*/)
    const m = tm || hm || bm
    if (!m) continue
    const id = m[1]
    const title = String(m[2] || '').replace(/[，。；:：|]+$/, '').trim()
    // 该条目后续的验收文字（到下一个条目/标题为止）
    let body = ''
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      if (/^(#{2,4}\s*)?(?:- )?\*\*R\d+/.test(lines[j]) || /^##\s/.test(lines[j])) break
      body += lines[j] + '\n'
    }
    items.push({ id, title: title.slice(0, 60), body: body.slice(0, 500) })
  }
  // 状态：用团队任务（agent-teams）匹配标题关键词
  const tasks = []
  try {
    const td = path.join(String(projectDir || ''), '.agent-teams')
    for (const name of fs.readdirSync(td).slice(0, 60)) {
      try {
        const tj = JSON.parse(read(path.join(td, name, 'team.json')))
        for (const t of (tj.tasks || [])) tasks.push({ subject: String(t.subject || ''), status: String(t.status || '') })
      } catch {}
    }
  } catch {}
  const TERM = new Set(['completed'])
  const score = (req, subj) => {
    const a = new Set(req.title.replace(/\s/g, '').match(/[\u4e00-\u9fff]{2,4}/g) || [])
    const b = subj.replace(/\s/g, '')
    let hit = 0
    for (const w of a) if (b.includes(w)) hit++
    return hit
  }
  const seen = []
  for (const it of items) {
    let best = null, bestN = 0
    for (const t of tasks) {
      const n = score(it, t.subject)
      if (n > bestN) { bestN = n; best = t }
    }
    it.status = best && bestN >= 1 ? (TERM.has(best.status) ? 'done' : (['in_progress', 'claimed', 'working'].includes(best.status) ? 'doing' : 'pending')) : 'pending'
    it.risk = Boolean(best && ['failed', 'blocked', 'cancelled'].includes(best.status))
    it.task = best ? best.subject.slice(0, 50) : ''
    seen.push(it)
  }
  // 人工/工具维护的状态覆盖（.jarvis/requirements-status.json）：比关键词启发式精确
  try {
    const stf = JSON.parse(read(path.join(base, 'requirements-status.json')))
    const st = (stf && stf.items) || {}
    for (const it of seen) {
      const o = st[it.id]
      if (o && ['done', 'doing', 'pending'].includes(String(o.status))) {
        it.status = String(o.status)
        it.note = String(o.note || '')
        it.source = 'status'
      }
    }
  } catch { /* 无状态文件 */ }
  const done = seen.filter((x) => x.status === 'done').length
  const doing = seen.filter((x) => x.status === 'doing').length
  const current = seen.findIndex((x) => x.status !== 'done')
  // 最近活动时间：需求文档 / 黑板 / 事件流 / 记忆 / 项目记忆 / 团队任务 的最大 mtime（真实"有没有在动"）
  let updatedAt = 0
  const touch = (f) => { try { updatedAt = Math.max(updatedAt, fs.statSync(f).mtimeMs) } catch {} }
  touch(path.join(base, 'docs', docFile))
  touch(path.join(base, 'events.jsonl'))
  touch(path.join(base, 'board.json'))
  touch(path.join(base, 'project.md'))
  touch(path.join(base, 'memory', 'entries.jsonl'))
  try {
    const td2 = path.join(String(projectDir || ''), '.agent-teams')
    for (const name of fs.readdirSync(td2).slice(0, 60)) touch(path.join(td2, name, 'team.json'))
  } catch {}
  try { const dd = path.join(base, 'docs'); for (const n of fs.readdirSync(dd).slice(0, 80)) touch(path.join(dd, n)) } catch {}
  const activeTasks = tasks.filter((t) => ['in_progress', 'claimed', 'working'].includes(t.status)).length
  const risks = seen.filter((x) => x.risk && x.status !== 'done').length
  return { doc: docFile, total: seen.length, done, doing, risks, current: current >= 0 ? current + 1 : null, activeTasks, updatedAt, items: seen.slice(0, 20) }
}
