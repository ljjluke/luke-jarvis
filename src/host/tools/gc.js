/** jarvis_gc —— 工作区垃圾回收（用户定义的三段语义）：
 *  ① sweep：按规则认定垃圾 → 移入回收站 .jarvis/trash/（默认 dryRun 只报不动）
 *  ② restore：保留期内"启用"= 按 id 恢复原位；恢复后后续 sweep 仍可再次回收
 *  ③ purge：30 天未恢复 → 彻底删除（sweep/list 每次自动先跑一遍到期清理）
 *
 *  sweep 规则（保守，只认"同物多版本/明确临时"两类，宁漏勿错——错收也有 30 天反悔期）：
 *   R1 迭代版本包：<stem>-v<N>.tar.gz|tgz|zip 按词干分组只留最高版本（如 v28~v45 只留 v45）
 *   R2 多版本文档：<前缀>v<N>[后缀].md 按 <前缀> 分组只留版本最高（如 交付清单v1.0~v1.33 只留 v1.33）
 *   R3 临时目录：.tmp 及根目录 chk/fc 探针目录，mtime 超 7 天
 *  保护名单见 adapters/trash.js isProtected（jarvis 记忆/基线/board 永不收）。
 */
import { collect, listTrash, restore, purgeExpired, RETENTION_DAYS } from '../adapters/trash.js'
import { appendEvent } from '../state/events.js'
import { getRuntimeContext } from '../runtime.js'

const fs = () => _require('node:fs')
const pathMod = () => _require('node:path')
import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

const VERSIONED_FILE = /^(.+)-v(\d+)\.([A-Za-z][A-Za-z0-9]{0,8}(?:\.[A-Za-z0-9]{1,4})?)$/
const VERSIONED_DOC = /^(.+?)v(\d+(?:\.\d+)*)[-_].*\.md$/
const VERSIONED_ROOT_DOC = /^(.+?)[-_]?v(\d+(?:\.\d+)*)[-_].*\.(md|json)$/
const DATED_ITER = /^(.+?)-(\d{8})([a-z])?(?:[-_.].*)?\.(md|json|xlsx|docx|pdf|png)$/
const TEMP_DIR = /^(chk[0-9a-f]{2,}|fc[0-9a-f]{4,}|f8_probe)$/
const LOG_FILE = /^[^/\\]+\.log$/i
const TMP_AGE_DAYS = 7
const LOG_AGE_DAYS = 7

function walkTop(projectDir, depth = 1) {
  const out = []
  const root = String(projectDir)
  const visit = (dir, rel, d) => {
    let names = []
    try { names = fs().readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const n of names) {
      const relPath = rel ? `${rel}/${n.name}` : n.name
      out.push({ rel: relPath, name: n.name, dir: n.isDirectory(), abs: pathMod().join(dir, n.name) })
      if (n.isDirectory() && d < depth) visit(pathMod().join(dir, n.name), relPath, d + 1)
    }
  }
  visit(root, '', 0)
  return out
}

function mtimeDays(abs) {
  try { return (Date.now() - fs().statSync(abs).mtimeMs) / 86400000 } catch { return 0 }
}

/** 规则引擎：返回候选垃圾相对路径清单（含规则标注）。keep=R1 每组保留最近 N 个版本。 */
export function findGarbage(projectDir, scopes = ['packages', 'docs', 'tmp'], keep = 1) {
  const found = []
  const want = (s) => scopes.includes(s)
  const nodes = walkTop(projectDir, 2)
  if (want('packages')) {
    // R1：迭代版本文件（任意扩展名：压缩包/脚本/配置），按词干分组只留最近 N 个版本
    const groups = new Map()
    for (const n of nodes) {
      const m = VERSIONED_FILE.exec(n.name)
      if (m && !n.dir) {
        const stem = `${pathMod().dirname(n.rel)}/${m[1]}`.replace(/^\.\//, '')
        if (!groups.has(stem)) groups.set(stem, [])
        groups.get(stem).push({ rel: n.rel, v: Number(m[2]) })
      }
    }
    for (const [stem, arr] of groups) {
      if (arr.length < 2) continue
      arr.sort((a, b) => a.v - b.v)
      for (const it of arr.slice(0, -Math.min(keep, arr.length))) found.push({ rel: it.rel, rule: `R1 迭代文件（${stem} 只留最近 ${Math.min(keep, arr.length)} 版）` })
    }
  }
  if (want('docs')) {
    // R2：多版本文档——.jarvis/docs 与工作区根目录，按前缀分组只留版本最高
    const docsDir = pathMod().join(String(projectDir), '.jarvis', 'docs')
    const groups = new Map()
    try {
      for (const n of fs().readdirSync(docsDir, { withFileTypes: true })) {
        if (n.isDirectory()) continue
        const m = VERSIONED_DOC.exec(n.name)
        if (!m) continue
        const stem = m[1]
        if (!groups.has(stem)) groups.set(stem, [])
        groups.get(stem).push({ rel: `.jarvis/docs/${n.name}`, v: m[2].split('.').map(Number), mt: mtimeDays(pathMod().join(docsDir, n.name)) })
      }
    } catch { /* 无 docs 目录 */ }
    // R2b：根目录多版本文档/数据（交付清单v1.3-xxx.md、t103-v44-xxx.md 等）
    for (const n of nodes) {
      if (n.dir || n.rel.includes('/')) continue
      const m = VERSIONED_ROOT_DOC.exec(n.name)
      if (!m) continue
      const stem = `${m[1]}（${m[3]}）`
      if (!groups.has(stem)) groups.set(stem, [])
      groups.get(stem).push({ rel: n.rel, v: m[2].split('.').map(Number), mt: mtimeDays(n.abs) })
    }
    // v 相同并列时按 mtime 决胜（同版本号保留最新文件；mtimeDays 是年龄，越大越旧）
    const cmp = (a, b) => { const [x, y] = [a.v, b.v]; for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return (b.mt || 0) - (a.mt || 0) }
    for (const [stem, arr] of groups) {
      if (arr.length < 2) continue
      arr.sort(cmp)
      for (const it of arr.slice(0, -1)) found.push({ rel: it.rel, rule: `R2 多版本文档（${stem} 只留终版）` })
    }
    // R2c：日期+字母迭代（改动冻结清单定版-up-20261016b/c/d…按词干分组只留最新一期）
    const dated = new Map()
    for (const n of nodes) {
      if (n.dir || n.rel.includes('/')) continue
      const m = DATED_ITER.exec(n.name)
      if (!m) continue
      const stem = `${m[1]}（${m[4]}）`
      if (!dated.has(stem)) dated.set(stem, [])
      dated.get(stem).push({ rel: n.rel, seq: Number(m[2]) * 100 + (m[3] ? m[3].charCodeAt(0) - 96 : 0) })
    }
    for (const [stem, arr] of dated) {
      if (arr.length < 2) continue
      arr.sort((a, b) => a.seq - b.seq)
      for (const it of arr.slice(0, -1)) found.push({ rel: it.rel, rule: `R2c 日期迭代文档（${stem} 只留最新一期）` })
    }
    // R4：根目录过期日志（> 7 天未动的 *.log）
    for (const n of nodes) {
      if (n.dir || !LOG_FILE.test(n.name) || n.rel.includes('/')) continue
      if (mtimeDays(n.abs) > LOG_AGE_DAYS) found.push({ rel: n.rel, rule: `R4 过期日志（> ${LOG_AGE_DAYS} 天未动）` })
    }
  }
  if (want('tmp')) {
    // R3：过期临时目录（.tmp 与根目录探针目录）
    for (const n of nodes) {
      if (!n.dir) continue
      const isTmp = n.rel === '.tmp' || (TEMP_DIR.test(n.name) && !n.rel.includes('/'))
      if (isTmp && mtimeDays(n.abs) > TMP_AGE_DAYS) found.push({ rel: n.rel, rule: `R3 过期临时目录（> ${TMP_AGE_DAYS} 天未动）` })
    }
  }
  return found
}

export const GC_TOOLS = [
  {
    name: 'jarvis_gc',
    description:
      '工作区垃圾回收（GC 三段语义）：①sweep=按规则认定垃圾移入回收站 <workspace>/.jarvis/trash/（默认 dryRun 只报不动，dryRun=false 才真收）；②list=回收站清单（含保留期剩余天数）；③restore=保留期内启用=按 id 恢复到原位置（恢复后 GC 后续仍可再次回收）；④purge=彻底删除超 30 天未恢复的条目（sweep/list 每次自动先清到期项）。另有自动保洁：工作区每 6h 自动 sweep 一次（借界面轮询节流，结果见快照 gc 字段与 .jarvis/gc.auto.json）。规则：R1 迭代版本文件只留最高版本（任意扩展名，v28~v45 只留 v45）/ R2 多版本文档只留终版（.jarvis/docs 与工作区根目录，交付清单 v1.0~v1.33 只留 v1.33）/ R2c 日期迭代文档（xxx-20261016b/c/d 只留最新一期）/ R3 过期临时目录（.tmp 等超 7 天）/ R4 过期日志（根目录 *.log 超 7 天）。保护名单永不收：project.md/lessons.md/board.json/gates.json/基线清单*/.git/node_modules。所有动作进 events.jsonl 审计（gc.swept/gc.collected/gc.purged）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'sweep 认定并移入回收站 / list 回收站清单 / restore 恢复原位 / purge 彻底删除到期条目（默认 sweep）' },
        projectDir: { type: 'string', description: '工作区根目录（默认当前会话 cwd）' },
        dryRun: { type: 'string', description: 'sweep 只报不收（true/false，默认 true——先看清单再真收）' },
        scopes: { type: 'string', description: 'sweep 规则范围，逗号分隔：packages/docs/tmp（默认全开）' },
        id: { type: 'string', description: 'restore 用的条目 id（list 里取）' },
        keep: { type: 'string', description: 'R1 每组保留最近 N 个版本（默认 1）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string' },
          verdict: { type: 'string' },
          dryRun: { type: 'boolean' },
          found: { type: 'number' },
          collected: { type: 'number' },
          purged: { type: 'number' },
          skipped: { type: 'number' },
        },
      },
      render: (r) =>
        `【工作区 GC · ${r.action}】\n${r.verdict}`,
    },
    execute: async (args, exec) => {
      const path = _require('node:path')
      let projectDir = String(args?.projectDir ?? '').trim()
      if (!projectDir) {
        try { projectDir = (exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd) || '' } catch { }
      }
      if (!projectDir) {
        try { const ctx = getRuntimeContext(); projectDir = (ctx && ctx.workspaces && ctx.workspaces.current) || '' } catch { }
      }
      const action = String(args?.action ?? 'sweep').trim()
      if (!projectDir) return { action, verdict: '⛔ 未定位到工作区（传 projectDir 或在有活动会话时调用）' }
      const absRoot = path.resolve(projectDir)
      if (/(^|\/)\.jarvis$|luke-jarvis/.test(absRoot)) return { action, verdict: '⛔ 插件仓库/.jarvis 目录不是工作区，拒绝 GC（STATE_ROOT_CONFLICT）' }
      // 到期清理每次先跑（保留期语义的自动执行点）
      const { purged } = purgeExpired(absRoot)
      if (action === 'list') {
        const t = listTrash(absRoot)
        const lines = t.items.filter((x) => x.state === 'in-trash').map((x) => `- ${x.id}  ${x.orig}（剩 ${x.daysLeft} 天，原因：${x.reason || '—'}）`)
        return {
          action, purged: purged.length, found: 0, collected: 0, skipped: 0, dryRun: false,
          verdict: `回收站 ${t.items.filter((x) => x.state === 'in-trash').length} 件在站（保留期 ${t.retentionDays} 天）${purged.length ? `；本次到期彻底删除 ${purged.length} 件` : ''}\n${lines.slice(0, 30).join('\n') || '（空）'}${lines.length > 30 ? `\n… 共 ${lines.length} 条` : ''}`,
        }
      }
      if (action === 'restore') {
        const r = restore(absRoot, args?.id)
        return { action, verdict: r.ok ? `✅ 已恢复到原位置：${r.restored}（后续 sweep 仍可能再次回收）` : `⛔ ${r.error}`, dryRun: false, found: 0, collected: 0, purged: purged.length, skipped: 0 }
      }
      if (action === 'purge') {
        const force = String(args?.dryRun ?? '') === 'force' // force=立即全删（含未到期，仅人工明确要求）
        const { purged: all } = purgeExpired(absRoot, force ? { force: true } : {})
        return { action, verdict: `✅ 已彻底删除 ${all.length} 件${force ? '' : '到期'}条目${all.length ? '：' + all.slice(0, 10).map((x) => x.orig).join('、') : ''}`, dryRun: false, found: 0, collected: 0, purged: all.length, skipped: 0 }
      }
      // sweep
      const dryRun = String(args?.dryRun ?? 'true') !== 'false'
      const scopes = String(args?.scopes ?? 'packages,docs,tmp').split(',').map((s) => s.trim()).filter(Boolean)
      const keep = Math.max(1, Number(args?.keep ?? 1))
      const found = findGarbage(absRoot, scopes, keep)
      if (dryRun) {
        const lines = found.slice(0, 40).map((f) => `- ${f.rel}（${f.rule}）`)
        return {
          action, dryRun: true, found: found.length, collected: 0, purged: purged.length, skipped: 0,
          verdict: `发现 ${found.length} 个候选垃圾（dryRun 未动）${purged.length ? `；已自动清到期 ${purged.length} 件` : ''}\n${lines.join('\n') || '（无）'}${found.length > 40 ? `\n… 共 ${found.length} 条，dryRun=false 收纳入站` : ''}`,
        }
      }
      const { collected, skipped } = collect(absRoot, found.map((f) => f.rel), 'sweep 自动认定')
      appendEvent(absRoot, 'gc.swept', { found: found.length, collected: collected.length, skipped: skipped.length })
      const lines = collected.slice(0, 30).map((c) => `- ${c.orig} → ${c.id}`)
      return {
        action, dryRun: false, found: found.length, collected: collected.length, purged: purged.length, skipped: skipped.length,
        verdict: `✅ 已收纳 ${collected.length}/${found.length} 件（保留期 ${RETENTION_DAYS} 天，期内 restore 可原位恢复）${purged.length ? `；到期已清 ${purged.length} 件` : ''}${skipped.length ? `；拒收 ${skipped.length} 件` : ''}\n${lines.join('\n') || '（无收纳）'}${skipped.length ? `\n拒收明细：${skipped.slice(0, 10).map((s) => `${s.rel}（${s.why}）`).join('、')}` : ''}`,
      }
    },
  },
]

const AUTO_GC_INTERVAL_MS = 6 * 3600 * 1000
const GC_FLAG = () => pathMod().join('.jarvis', 'gc.auto.json')

/** 自动 GC：每个工作区至多每 6h 跑一次（节流标记 .jarvis/gc.auto.json 的 mtime）。只做保守 sweep（execute 收入回收站，30 天保留）+ 到期 purge。无 .jarvis 的工作区直接跳过。 */
export function maybeAutoGc(projectDir) {
  let absRoot = ''
  try { absRoot = pathMod().resolve(String(projectDir || '')) } catch { return null }
  if (!absRoot || /(^|\/)\.jarvis$|luke-jarvis/.test(absRoot)) return null
  try { if (!fs().statSync(pathMod().join(absRoot, '.jarvis')).isDirectory()) return null } catch { return null }
  const flag = pathMod().join(absRoot, GC_FLAG())
  try { if (Date.now() - fs().statSync(flag).mtimeMs < AUTO_GC_INTERVAL_MS) return null } catch { /* 首次运行 */ }
  try {
    const found = findGarbage(absRoot, ['packages', 'docs', 'tmp'], 1)
    let collected = 0, skipped = 0
    if (found.length) {
      const r = collect(absRoot, found.map((f) => f.rel), '自动 GC（6h 节流）')
      collected = r.collected.length; skipped = r.skipped.length
      appendEvent(absRoot, 'gc.swept', { auto: true, found: found.length, collected, skipped })
    }
    const { purged } = purgeExpired(absRoot)
    const summary = { at: new Date().toISOString(), found: found.length, collected, skipped, purged: purged.length }
    try { fs().mkdirSync(pathMod().dirname(flag), { recursive: true }); fs().writeFileSync(flag, JSON.stringify(summary, null, 2)) } catch { /* 标记写失败只是下次再跑 */ }
    return summary
  } catch { return null }
}

/** GC 摘要（进快照）：回收站在站件数 + 上次自动 GC 结果 + 最近入站明细（轻量，只读小文件）。 */
export function gcSummary(projectDir) {
  let absRoot = ''
  try { absRoot = pathMod().resolve(String(projectDir || '')) } catch { return null }
  if (!absRoot) return null
  const out = { inTrash: 0, retentionDays: RETENTION_DAYS, oldestDaysLeft: null, lastSweep: null, recent: [] }
  try {
    const t = listTrash(absRoot)
    const inTrash = t.items.filter((x) => x.state === 'in-trash')
    out.inTrash = inTrash.length
    out.retentionDays = t.retentionDays || RETENTION_DAYS
    if (inTrash.length) out.oldestDaysLeft = Math.min(...inTrash.map((x) => x.daysLeft ?? RETENTION_DAYS))
    out.recent = inTrash.slice(-8).map((x) => x.orig)
  } catch { /* 无回收站 */ }
  try { out.lastSweep = JSON.parse(fs().readFileSync(pathMod().join(absRoot, GC_FLAG()), 'utf8')) } catch { /* 尚未跑过 */ }
  return out
}
