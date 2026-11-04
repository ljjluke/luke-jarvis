/** 统一黑板（公屏）持久化：<workspace>/.jarvis/board.json —— 项目级单一事实源。
 *
 *  事实源约定：写路径与读取（RPC/HTTP/工具）必须完全一致，否则「写了读不到」；
 *  并发用 dsh-fs 的版本 token（replaceIfVersion）做乐观守卫，冲突如实返回不吞。
 *  workspace 取当前会话 header.cwd（由 runtime 解析），process.cwd 仅兜底。
 */
import { resolveWorkspace, getRuntimeContext, getLatestExec } from '../runtime.js'

/** 公屏（统一黑板）持久化路径：<workspace>/.jarvis/board.json（项目级，与 RPC/HTTP 读取同一约定）
 * 工作区优先取当前会话 header.cwd（用户工作区），process.cwd 仅兜底——修复"写到服务目录非项目目录" */
export function boardFilePath() {
  const cwd = resolveWorkspace(getRuntimeContext(), getLatestExec()) || (typeof process !== 'undefined' && process.cwd ? process.cwd() : '')
  return (cwd ? cwd + '/' : '') + '.jarvis/board.json'
}

/** 从磁盘读公屏 items（无文件/坏 JSON → 空数组）。写路径与读取（HTTP/RPC）完全一致，杜绝双源。
 *  返回 { items, version, statInfo }：version 是 dsh-fs 的乐观并发 token（writeText replaceIfVersion 用）。 */
export async function readBoardItems(fsSvc) {
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
