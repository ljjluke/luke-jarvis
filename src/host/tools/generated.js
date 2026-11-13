/** AI 产出登记表 —— GC 第 2 层的事实依据。
 *
 *  为什么需要（这是整个 GC 设计的根因修复）：
 *    没有这份记录时，「这个文件是 AI 写的还是客户写的」只能靠模型猜；
 *    模型猜错就会删客户文件。有了登记表，判定从「猜」变成「查」。
 *
 *  何时写入：
 *    · jarvis 用工具写文件（write/edit → .jarvis 内部文件、页面、报告）时登记；
 *    · 生成类工具（jarvis_snapshot/essence/distill 等落盘）自己登记；
 *    · 登记失败不影响主流程（GC 只是少一条依据，不会因此误删）。
 *
 *  结构：<workspace>/.jarvis/generated.json
 *    { "<相对路径>": { by:"ai", task:"ticket-id", at:"ISO", keep:"permanent|temporary" } }
 *    keep=temporary 的才可能被 GC 自动回收；permanent 永不自动收。
 */
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)
const fs = () => _require('node:fs')
const pathMod = () => _require('node:path')

const REG_FILE = () => pathMod().join('.jarvis', 'generated.json')

function regPath(projectDir) { return pathMod().join(String(projectDir || ''), REG_FILE()) }

/** 读登记表（坏文件按空处理）。 */
export function readRegistry(projectDir) {
  try {
    const raw = fs().readFileSync(regPath(projectDir), 'utf8')
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : {}
  } catch { return {} }
}

function writeRegistry(projectDir, obj) {
  try {
    const file = regPath(projectDir)
    fs().mkdirSync(pathMod().dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    fs().writeFileSync(tmp, JSON.stringify(obj, null, 1))
    fs().renameSync(tmp, file)
    return true
  } catch { return false }
}

/** 登记一个 AI 产出的文件。
 *  @param {string} rel 相对工作区根的路径（如 `.jarvis/pages/sales.html`）
 *  @param {object} meta {task, keep:'temporary'|'permanent'}
 */
export function markGenerated(projectDir, rel, meta = {}) {
  const r = String(rel || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '')
  if (!r) return false
  // 只登记工作区内部的相对路径（防越界写）
  const abs = pathMod().resolve(String(projectDir), r)
  if (!abs.startsWith(pathMod().resolve(String(projectDir)) + pathMod().sep)) return false
  const reg = readRegistry(projectDir)
  reg[r] = {
    by: 'ai',
    task: String(meta.task || ''),
    at: new Date().toISOString(),
    keep: meta.keep === 'permanent' ? 'permanent' : 'temporary',
  }
  return writeRegistry(projectDir, reg)
}

/** 批量登记（GC 之外的生成流程用）。 */
export function markGeneratedBatch(projectDir, rels, meta = {}) {
  let ok = 0
  for (const rel of rels || []) { if (markGenerated(projectDir, rel, meta)) ok++ }
  return ok
}

/** 取消登记（文件被客户认领为「我要留着」时调用，防止再被 GC 盯上）。 */
export function unmarkGenerated(projectDir, rel) {
  const r = String(rel || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '')
  const reg = readRegistry(projectDir)
  if (!reg[r]) return false
  delete reg[r]
  return writeRegistry(projectDir, reg)
}

/** 文件是否被登记为「AI 产出的临时文件」（第 2 层自动回收的资格条件）。 */
export function isGeneratedTemporary(projectDir, rel, maxAgeDays = 30) {
  const r = String(rel || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '')
  const reg = readRegistry(projectDir)
  const e = reg[r]
  if (!e || e.by !== 'ai' || e.keep !== 'temporary') return false
  const at = Date.parse(String(e.at || ''))
  if (!Number.isFinite(at)) return false
  return (Date.now() - at) / 86400000 >= maxAgeDays
}

/** 第 2 层候选：登记为临时 AI 产出、且超过保留期、且文件仍在工作区内的路径清单。 */
export function findGeneratedGarbage(projectDir, maxAgeDays = 30) {
  const reg = readRegistry(projectDir)
  const out = []
  for (const [rel, e] of Object.entries(reg)) {
    if (!e || e.by !== 'ai' || e.keep !== 'temporary') continue
    const at = Date.parse(String(e.at || ''))
    if (!Number.isFinite(at) || (Date.now() - at) / 86400000 < maxAgeDays) continue
    try {
      const abs = pathMod().join(String(projectDir), rel)
      if (!fs().existsSync(abs)) continue
      out.push({ rel, at: e.at, task: String(e.task || ''), daysOld: Math.floor((Date.now() - at) / 86400000) })
    } catch { /* 单条失败跳过 */ }
  }
  return out
}

/** 清理登记表中已不存在的条目（避免无限增长）。 */
export function pruneRegistry(projectDir) {
  const reg = readRegistry(projectDir)
  let removed = 0
  for (const rel of Object.keys(reg)) {
    try {
      if (!fs().existsSync(pathMod().join(String(projectDir), rel))) { delete reg[rel]; removed++ }
    } catch { /* 单条失败跳过 */ }
  }
  if (removed) writeRegistry(projectDir, reg)
  return removed
}
