/**
 * 角色卡发现与注入（把「按蒸馏大佬的方式思考」从口号变成可判定的机制）。
 *
 * 真实缺陷（用户质疑触发）：卡只在写侧被使用（jarvis_distill 校验、jarvis_store 落盘），
 * 读侧从来没人读——成员开工须知只说「按你的角色卡方法论」，但成员的上下文里根本没有卡文本。
 * 结果：成员用的是模型默认的通用分析师思路，等于「蒸馏了但没人按它工作」。
 *
 * 本模块负责：按角色名在 <项目>/.jarvis/cards/ 里找到该角色的卡（排除 history/）、
 * 读出六段式文本、判定结构是否完整，供 jarvis_member_brief 注入 + 派活闸审计。
 */
import fsx from 'node:fs'
import pathx from 'node:path'
import { listNames, readTextSafe } from '../runtime.js'

/** 卡注入段的固定标记（派活闸按它判定「卡真的附进任务了」）。 */
export const CARD_SECTION_MARK = '## 六、你的角色卡'

/** 六段式（与 jarvis_distill 的校验口径一致）。 */
export const CARD_SECTIONS = ['身份定位', '思维模型', '核心方法论', '代表作品', '决策红线', '语言风格']

const HISTORY_RE = /(^|[\\/])history([\\/]|$)/

function matchScore(fileBase, role) {
  const base = String(fileBase || '')
  const r = String(role || '').trim()
  if (!base || !r) return 0
  if (base.includes(r)) return 3
  if (r.includes(base)) return 2
  const parts = base.split(/[-_·—\s]+/).filter((p) => p && p.length >= 2)
  return parts.some((p) => r.includes(p)) ? 1 : 0
}

/**
 * 找到某角色的卡。
 * @param fsSvc 会话文件服务（可空——空则退回 node:fs 直读，便于单测/无 fs 服务环境）
 * @param projectDir 项目工作区
 * @param role 角色名（成员职位）
 * @param path node:path（调用方已持有的模块，避免重复解析）
 * @returns {Promise<{relPath:string,text:string,score:number}|null>}
 */
export async function findRoleCard(fsSvc, projectDir, role, path = pathx) {
  if (!projectDir || !role) return null
  const dir = path.join(projectDir, '.jarvis/cards')
  let names = null
  try {
    names = await listNames(fsSvc, dir)
  } catch {
    names = null
  }
  if (names === null) {
    // 无 fs 服务：直接读盘（真实部署里 .jarvis 就在工作区磁盘上）
    try {
      names = fsx.readdirSync(dir)
    } catch {
      return null
    }
  }
  const candidates = (Array.isArray(names) ? names : [])
    .filter((n) => /\.md$/i.test(n) && !HISTORY_RE.test(n))
    .map((n) => ({ n, score: matchScore(n.replace(/\.md$/i, ''), role) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  if (candidates.length === 0) return null
  const relPath = path.join('.jarvis/cards', candidates[0].n)
  const absPath = path.join(projectDir, relPath)
  let text = ''
  try {
    text = (await readTextSafe(fsSvc, absPath)) || ''
  } catch {
    text = ''
  }
  if (!text) {
    try {
      text = fsx.readFileSync(absPath, 'utf8')
    } catch {
      return null
    }
  }
  return { relPath, text, score: candidates[0].score }
}

/**
 * 六段式结构校验（缺哪段就报哪段；不足 6 段的卡不能当作「按大佬方式思考」的依据）。
 */
export function cardStructureOk(text) {
  const body = String(text || '')
  const missing = CARD_SECTIONS.filter((s) => !body.includes(s))
  return { ok: missing.length === 0, missing }
}

/**
 * 同步版：给同步闸（tools.guard 的返回值式拦截）用——卡就在工作区磁盘上，直接读盘即可。
 * @returns {{relPath:string,text:string,score:number}|null}
 */
export function findRoleCardSync(projectDir, role, path = pathx) {
  if (!projectDir || !role) return null
  const dir = path.join(projectDir, '.jarvis/cards')
  let names = []
  try {
    names = fsx.readdirSync(dir)
  } catch {
    return null
  }
  const candidates = names
    .filter((n) => /\.md$/i.test(n) && !HISTORY_RE.test(n))
    .map((n) => ({ n, score: matchScore(n.replace(/\.md$/i, ''), role) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  if (candidates.length === 0) return null
  const relPath = path.join('.jarvis/cards', candidates[0].n)
  try {
    const text = fsx.readFileSync(path.join(projectDir, relPath), 'utf8')
    if (!text) return null
    return { relPath, text, score: candidates[0].score }
  } catch {
    return null
  }
}
