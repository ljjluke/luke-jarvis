/** 工作区回收站（GC 的"进站/恢复/彻底删除"三段语义，用户定义）：
 *
 *  · collect：认为是垃圾的文件/目录 → 移入 <workspace>/.jarvis/trash/items/<id>/ 并登记 manifest（原位置/时间/原因）
 *  · restore：保留期内（默认 30 天）"启用"= 按 id 恢复到**原来的位置**；恢复后 GC 后续 sweep 仍可再次回收（同一套规则自然重收）
 *  · purge：超过保留期仍未恢复 → 彻底删除（rm -rf），manifest 记 purgedAt
 *
 *  设计要点：
 *   - manifest.jsonl append-only：每个 id 的最新一行决定状态（collected → restored? / purged?），坏行跳过；
 *   - 路径安全：只收工作区**内部**的相对路径；保护名单（project.md/lessons.md/board.json/基线清单/trash 自身等）拒收；
 *   - 审计：collect/restore/purge 都打 events.jsonl（gc.collected / gc.restored / gc.purged），UI 时间轴可见。
 */
import { createRequire } from 'node:module'
import { appendEvent } from '../state/events.js'

const _require = createRequire(import.meta.url)
const fs = () => _require('node:fs')
const pathMod = () => _require('node:path')

export const RETENTION_DAYS = 30

/** 保护名单（相对路径或文件名前缀）：命中即拒收——GC 不碰 jarvis 的记忆与基线。 */
const PROTECT_NAMES = ['project.md', 'lessons.md', 'board.json', 'gates.json', 'company-state.json', 'README.md', 'trash', 'events.jsonl']
const PROTECT_PREFIX = ['基线清单', '.git/', 'node_modules/']

function trashRoot(projectDir) {
  return pathMod().join(String(projectDir || ''), '.jarvis', 'trash')
}

function nowIso() { return new Date().toISOString() }

function isProtected(rel) {
  const r = String(rel || '').replace(/\\/g, '/')
  const base = r.split('/').pop()
  if (PROTECT_NAMES.includes(base)) return true
  if (r.startsWith('.jarvis/trash')) return true
  return PROTECT_PREFIX.some((p) => r.startsWith(p) || r.includes('/' + p))
}

/** 读 manifest：返回 {entries: [{id, orig, reason, movedAt, restoredAt?, purgedAt?}], badLines} */
function readManifest(projectDir) {
  const file = pathMod().join(trashRoot(projectDir), 'manifest.jsonl')
  const map = new Map()
  let bad = 0
  try {
    const text = fs().readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (e && e.id) {
          const prev = map.get(e.id) || {}
          map.set(e.id, { ...prev, ...e })
        }
      } catch { bad++ }
    }
  } catch { /* 无 manifest = 空回收站 */ }
  return { entries: [...map.values()], bad }
}

function appendManifest(projectDir, entry) {
  const dir = trashRoot(projectDir)
  fs().mkdirSync(dir, { recursive: true })
  fs().appendFileSync(pathMod().join(dir, 'manifest.jsonl'), JSON.stringify(entry) + '\n')
}

/** 收纳：把相对路径（相对工作区根）移入回收站。返回 {collected:[], skipped:[{rel, why}]} */
export function collect(projectDir, relPaths, reason = '') {
  const collected = []
  const skipped = []
  for (const raw of relPaths || []) {
    const rel = String(raw || '').trim().replace(/^\/+/, '')
    if (!rel) continue
    const abs = pathMod().resolve(String(projectDir), rel)
    // 越界守卫：必须在项目根内
    if (!abs.startsWith(pathMod().resolve(String(projectDir)) + pathMod().sep)) {
      skipped.push({ rel, why: '越出工作区范围' }); continue
    }
    if (isProtected(rel)) { skipped.push({ rel, why: '保护名单' }); continue }
    if (!fs().existsSync(abs)) { skipped.push({ rel, why: '不存在' }); continue }
    const id = `gc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const destDir = pathMod().join(trashRoot(projectDir), 'items', id)
    fs().mkdirSync(destDir, { recursive: true })
    const dest = pathMod().join(destDir, pathMod().basename(abs))
    try {
      fs().renameSync(abs, dest)
      const entry = { id, orig: rel, reason: String(reason || ''), movedAt: nowIso() }
      appendManifest(projectDir, entry)
      appendEvent(projectDir, 'gc.collected', { id, orig: rel, reason: entry.reason })
      collected.push(entry)
    } catch (e) {
      skipped.push({ rel, why: `移入失败：${(e && e.message) || e}` })
    }
  }
  return { collected, skipped }
}

/** 回收站清单：附保留期剩余天数。 */
export function listTrash(projectDir) {
  const { entries, bad } = readManifest(projectDir)
  const now = Date.now()
  const items = entries.map((e) => ({
    ...e,
    state: e.purgedAt ? 'purged' : e.restoredAt ? 'restored' : 'in-trash',
    daysLeft: e.restoredAt || e.purgedAt || !e.movedAt ? null
      : Math.max(0, RETENTION_DAYS - Math.floor((now - Date.parse(e.movedAt)) / 86400000)),
  }))
  return { items, retentionDays: RETENTION_DAYS, badLines: bad }
}

/** 恢复：按 id 移回原位置（原位置已存在则拒收，避免覆盖）。 */
export function restore(projectDir, id) {
  const { entries } = readManifest(projectDir)
  const e = entries.find((x) => x.id === String(id || '').trim())
  if (!e) return { ok: false, error: `回收站没有这个 id：${id}` }
  if (e.restoredAt) return { ok: false, error: `该条目已于 ${e.restoredAt} 恢复过` }
  if (e.purgedAt) return { ok: false, error: '该条目已超过保留期被彻底删除，无法恢复' }
  const itemDir = pathMod().join(trashRoot(projectDir), 'items', e.id)
  const src = pathMod().join(itemDir, pathMod().basename(e.orig))
  const dest = pathMod().resolve(String(projectDir), e.orig)
  if (!fs().existsSync(src)) return { ok: false, error: '回收站物品文件缺失（可能已被外部移动）' }
  if (fs().existsSync(dest)) return { ok: false, error: `原位置已存在同名文件：${e.orig}（先处理原位置再恢复）` }
  try {
    fs().mkdirSync(pathMod().dirname(dest), { recursive: true })
    fs().renameSync(src, dest)
    try { fs().rmdirSync(itemDir) } catch { /* 非空/已删忽略 */ }
    appendManifest(projectDir, { id: e.id, restoredAt: nowIso() })
    appendEvent(projectDir, 'gc.restored', { id: e.id, orig: e.orig })
    return { ok: true, restored: e.orig }
  } catch (err) {
    return { ok: false, error: `恢复失败：${(err && err.message) || err}` }
  }
}

/** 彻底删除：超过保留期（默认 30 天）仍未恢复的条目 rm -rf。force=true 时无视期限全删。 */
export function purgeExpired(projectDir, { retentionDays = RETENTION_DAYS, force = false } = {}) {
  const { entries } = readManifest(projectDir)
  const now = Date.now()
  const purged = []
  for (const e of entries) {
    if (e.restoredAt || e.purgedAt) continue
    const ageDays = e.movedAt ? (now - Date.parse(e.movedAt)) / 86400000 : 0
    if (!force && ageDays < retentionDays) continue
    const itemDir = pathMod().join(trashRoot(projectDir), 'items', e.id)
    try {
      fs().rmSync(itemDir, { recursive: true, force: true })
      appendManifest(projectDir, { id: e.id, purgedAt: nowIso() })
      appendEvent(projectDir, 'gc.purged', { id: e.id, orig: e.orig, ageDays: Math.round(ageDays) })
      purged.push({ id: e.id, orig: e.orig })
    } catch { /* 单条失败不阻断 */ }
  }
  return { purged }
}
