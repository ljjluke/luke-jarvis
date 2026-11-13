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
import { collect, listTrash, restore, restoreMany, purgeExpired, RETENTION_DAYS } from '../adapters/trash.js'
import { appendEvent } from '../state/events.js'
import { getRuntimeContext } from '../runtime.js'
import { findGeneratedGarbage, pruneRegistry } from './generated.js'

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
/** R0 改动前备份：`任意文件. bak_标签_日期` 或 `任意文件.bak`(纯后缀)。
 *  形态：plugin.js.bak_gc_20261110 / jarvis.html.bak / notes.md.bak-20261110
 *  为什么安全：同目录必然存在同名正式文件时才算备份（下面 findGarbage 里校验），否则可能是唯一副本，不收。 */
const BAK_FILE = /^(.+?)(?:\.bak[-_.]?([A-Za-z0-9_-]*))$/
const TMP_AGE_DAYS = 7
const LOG_AGE_DAYS = 7
/** 本地时间戳（gc.js 自己用，不依赖 trash 的私有函数） */
const nowIso = () => new Date().toISOString()
/** 扫描时永不进入的目录（版本库/依赖/回收站自身） */
const SKIP_DIRS = ['.git', 'node_modules', '.jarvis/trash']

function walkTop(projectDir, depth = 1) {
  const out = []
  const root = String(projectDir)
  const skip = (relPath) => SKIP_DIRS.some((s) => relPath === s || relPath.startsWith(s + '/'))
  const visit = (dir, rel, d) => {
    let names = []
    try { names = fs().readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const n of names) {
      const relPath = rel ? `${rel}/${n.name}` : n.name
      if (skip(relPath)) continue
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

/** 规则引擎：返回候选垃圾相对路径清单（含规则标注）。keep=R1 每组保留最近 N 个版本。
 *  scopes: packages(版本文件) / docs(多版本文档+日志) / tmp(临时目录) / backups(.bak 备份) / all(整工作区清扫)
 */
export function findGarbage(projectDir, scopes = ['packages', 'docs', 'tmp', 'backups'], keep = 1) {
  const found = []
  const want = (s) => scopes.includes(s) || scopes.includes('all')
  // all 模式扫描 4 层深（覆盖 webui/src 等子目录）；默认模式 2 层
  const nodes = walkTop(projectDir, scopes.includes('all') ? 4 : 2)
  if (want('backups')) {
    // R0：改动前备份（`xxx.bak_标签_日期`）。
    // 安全前提：同目录必须存在同名正式文件（去掉 .bak 部分后的名字存在），
        // 否则可能是唯一副本，不收——这是「宁漏勿错」的具体落实。
    for (const n of nodes) {
      if (n.dir) continue
      const m = BAK_FILE.exec(n.name)
      if (!m) continue
      const base = m[1]
      const dirRel = pathMod().dirname(n.rel).replace(/\\/g, '/')
      const siblingRel = dirRel === '.' ? base : `${dirRel}/${base}`
      let siblingExists = false
      try { siblingExists = fs().existsSync(pathMod().join(String(projectDir), siblingRel)) } catch { siblingExists = false }
      if (!siblingExists) continue   // 无正式版对照 = 可能是唯一副本，跳过
      found.push({ rel: n.rel, rule: `R0 改动前备份（正式版已在：${siblingRel}）` })
    }
  }
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
        action: { type: 'string', description: 'sweep 认定并移入回收站 / list 回收站清单 / restore 恢复原位 / purge 彻底删除到期条目 / suggest 建议清理清单（只报不动）/ collect 客户确认后收指定文件 /（默认 sweep）' },
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
      if (/(^|[\\/])\.jarvis$/.test(absRoot)) return { action, verdict: '⛔ .jarvis 目录不是工作区，拒绝 GC（STATE_ROOT_CONFLICT）' }
      // 第 3 层：建议清单（只报不动）
      if (action === 'suggest') {
        const sugs = findSuggestions(absRoot)
        const lines = sugs.slice(0, 40).map((x) => `- ${x.rel}（${x.why}，${(x.bytes / 1024).toFixed(1)} KB）`)
        return {
          action, dryRun: true, found: sugs.length, collected: 0, purged: 0, skipped: 0,
          verdict: `建议清理 ${sugs.length} 个文件（**不会自动删除**，客户确认后才收）\n${lines.join('\n') || '（无）'}${sugs.length > 40 ? `\n… 共 ${sugs.length} 条` : ''}\n\n确认清理：jarvis_gc(action=collect, id=<相对路径>)；或忽略即可。`,
        }
      }
      // 第 3 层落实：客户显式确认后收指定文件（id = 相对路径）
      if (action === 'collect') {
        const rel = String(args?.id ?? '').trim()
        if (!rel) return { action, verdict: '⛔ collect 需要 id（要收的相对路径，从 suggest 清单里取）', found: 0, collected: 0, skipped: 0, purged: 0, dryRun: false }
        const r = collect(absRoot, [rel], '客户确认清理')
        return {
          action, dryRun: false, found: 1, collected: r.collected.length, purged: 0, skipped: r.skipped.length,
          verdict: r.collected.length ? `✅ 已收进回收站：${rel}（${RETENTION_DAYS} 天内可用 restore 恢复）` : `⛔ 未收：${(r.skipped[0] && r.skipped[0].why) || '未知原因'}`,
        }
      }
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
        const idArg = String(args?.id ?? '').trim()
        // 批量恢复：id=all 恢复全部在站条目；id=a,b,c 恢复指定几个
        if (idArg === 'all' || idArg.includes(',')) {
          const r = restoreMany(absRoot, idArg === 'all' ? 'all' : idArg.split(',').map((s) => s.trim()).filter(Boolean))
          return {
            action, dryRun: false, found: 0, collected: 0, purged: purged.length, skipped: r.failed.length,
            verdict: `✅ 已恢复 ${r.restored.length} 件${r.failed.length ? `，失败 ${r.failed.length} 件：${r.failed.slice(0, 5).map((f) => `${f.orig}（${f.error}）`).join('、')}` : ''}`,
          }
        }
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
      const scopes = String(args?.scopes ?? 'backups,packages,docs,tmp').split(',').map((s) => s.trim()).filter(Boolean)
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

const AUTO_GC_INTERVAL_MS = 24 * 3600 * 1000   // 每日一次主动回收（Java 式定时 GC）
const GC_FLAG = () => pathMod().join('.jarvis', 'gc.auto.json')
/** 自动 GC 的扫描范围：整工作区（含子目录），但只收「确定性规则」能证明的垃圾。
 *  ⛔ 第 2/3 层（AI 登记 / 客户文件建议）不在自动路径里自动删——见 generated.js 与 gcSummary。
 */
const AUTO_SCOPES = ['all', 'backups', 'packages', 'docs', 'tmp']

/** 磁盘水位守卫：剩余空间低于阈值时暂停回收（回收站文件仍占盘，越收越满）。 */
function diskTooFull(projectDir) {
  try {
    const st = fs().statfsSync ? fs().statfsSync(projectDir) : null
    if (!st || !st.bsize || !st.blocks) return false
    const freeRatio = Number(st.bavail || 0) / Number(st.blocks || 1)
    return freeRatio < 0.10   // 剩余不足 10% → 暂停
  } catch { return false }
}

/** 工作区是否有活（有任务在跑就别动文件，避免和写入打架）。判定不出来按「有活」处理。 */
function projectBusy(projectDir) {
  try {
    const tdir = pathMod().join(String(projectDir), '.jarvis', 'tickets')
    for (const n of fs().readdirSync(tdir)) {
      if (!/^ticket-.*\.json$/.test(n)) continue
      try {
        const t = JSON.parse(fs().readFileSync(pathMod().join(tdir, n), 'utf8'))
        if (t && !t.ended) return true
      } catch { /* 单个坏文件跳过 */ }
    }
  } catch { /* 无 tickets 目录 = 无任务 */ }
  return false
}

/** 自动 GC（每日一次，服务内定时器调用，不依赖界面轮询）。
 *  @param {object} [opts] {force:boolean} force=true 忽略节流立即跑（人工触发用）
 */
export function maybeAutoGc(projectDir, opts = {}) {
  let absRoot = ''
  try { absRoot = pathMod().resolve(String(projectDir || '')) } catch { return null }
  if (!absRoot) return null
  // ⛔ 只排除 .jarvis 自身（状态目录不是工作区），不再排除插件仓库——插件仓库的备份同样需要清理
  if (/(^|[\\/])\.jarvis$/.test(absRoot)) return null
  // 工作区状态目录存在才 GC（非 jarvis 项目不碰）
  try { if (!fs().statSync(pathMod().join(absRoot, '.jarvis')).isDirectory()) return null } catch { return null }
  const flag = pathMod().join(absRoot, GC_FLAG())
  if (!opts.force) {
    try { if (Date.now() - fs().statSync(flag).mtimeMs < AUTO_GC_INTERVAL_MS) return null } catch { /* 首次运行：立即跑一次 */ }
  }
  if (diskTooFull(absRoot)) {
    // 磁盘紧张：只做到期清理，不收新文件（免得回收站把盘撑爆）
    const { purged } = purgeExpired(absRoot)
    return { skippedReason: '磁盘空间不足 10%，暂停回收', found: 0, collected: 0, purged: purged.length, at: nowIso() }
  }
  if (projectBusy(absRoot)) {
    // 有任务在跑：跳过本轮，避免和写入打架
    return { skippedReason: '有任务进行中，跳过本轮', found: 0, collected: 0, purged: 0, at: nowIso() }
  }
  try {
    const found = findGarbage(absRoot, AUTO_SCOPES, 1)
    // 第 2 层：AI 登记为临时产出且超期的文件（有登记记录 = 有事实依据，可自动收）
    const gen = findGeneratedGarbage(absRoot, RETENTION_DAYS)
    const all = found.concat(gen.map((g) => ({ rel: g.rel, rule: `R5 AI 临时产出（登记于 ${g.at.slice(0, 10)}，任务 ${g.task || '—'}）` })))
    let collected = 0, skipped = 0
    if (all.length) {
      const r = collect(absRoot, all.map((f) => f.rel), '自动 GC（每日一次）')
      collected = r.collected.length; skipped = r.skipped.length
      appendEvent(absRoot, 'gc.swept', { auto: true, found: all.length, collected, skipped })
    }
    try { pruneRegistry(absRoot) } catch { /* 登记表清理失败不影响回收 */ }
    const { purged } = purgeExpired(absRoot)
    const summary = { at: nowIso(), found: all.length, collected, skipped, purged: purged.length }
    try { fs().mkdirSync(pathMod().dirname(flag), { recursive: true }); fs().writeFileSync(flag, JSON.stringify(summary, null, 2)) } catch { /* 标记写失败只是下次再跑 */ }
    return summary
  } catch (e) {
    // 不静默吞错：把原因写进事件流，客户与排查都能看到
    try { appendEvent(absRoot, 'gc.auto_failed', { error: String((e && e.message) || e) }) } catch { /* 事件写失败忽略 */ }
    return { error: String((e && e.message) || e), found: 0, collected: 0, purged: 0, at: nowIso() }
  }
}

/** 第 3 层：建议清理清单 —— 只提示、绝不自动删。
 *  范围：客户自己创建的文件 / 未登记的 AI 产出 / 灰色地带。
 *  判据（保守，全部可解释）：
 *    · 超过 90 天没被修改（mtime），且不在保护名单；
 *    · 或文件名带明显的「临时/草稿/副本」语义（copy/副本/草稿/temp/draft/untitled）。
 *  ⛔ 即使命中，也只是「建议」，客户点一下才收（走 jarvis_gc action=collect）。
 */
const DRAFT_HINT = /(?:^|[._\-\s])(copy|副本|草稿|temp|tmp|draft|untitled|未命名)(?:[._\-\s]|$)/i
const SUGGEST_IDLE_DAYS = 90

function mtimeDaysOf(abs) {
  try { return (Date.now() - fs().statSync(abs).mtimeMs) / 86400000 } catch { return 0 }
}

export function findSuggestions(projectDir, opts = {}) {
  const skip = new Set(opts.skipRels || [])
  const nodes = walkTop(projectDir, 4)
  const out = []
  for (const n of nodes) {
    if (n.dir) continue
    // 保护名单与已判定垃圾不重复建议
    if (skip.has(n.rel)) continue
    // .jarvis 内部的记忆/状态一律不建议（那是系统文件）
    if (/^\.jarvis\/(?!pages\/|docs\/)/.test(n.rel)) continue
    const base = n.name
    const draft = DRAFT_HINT.test(base)
    const idle = mtimeDaysOf(n.abs) > SUGGEST_IDLE_DAYS
    if (!draft && !idle) continue
    out.push({
      rel: n.rel,
      why: draft ? '文件名像临时稿/副本' : `${SUGGEST_IDLE_DAYS} 天没改动过`,
      idleDays: Math.floor(mtimeDaysOf(n.abs)),
      bytes: (() => { try { return Number(fs().statSync(n.abs).size) || 0 } catch { return 0 } })(),
    })
  }
  out.sort((a, b) => b.idleDays - a.idleDays)
  return out
}

/** GC 摘要（进快照）：回收站在站件数 + 上次自动 GC 结果 + 最近入站明细 + 建议清理清单。 */
export function gcSummary(projectDir) {
  let absRoot = ''
  try { absRoot = pathMod().resolve(String(projectDir || '')) } catch { return null }
  if (!absRoot) return null
  const out = { inTrash: 0, retentionDays: RETENTION_DAYS, oldestDaysLeft: null, lastSweep: null, recent: [], suggestions: [], suggestionsTotal: 0 }
  try {
    const t = listTrash(absRoot)
    const inTrash = t.items.filter((x) => x.state === 'in-trash')
    out.inTrash = inTrash.length
    out.retentionDays = t.retentionDays || RETENTION_DAYS
    if (inTrash.length) out.oldestDaysLeft = Math.min(...inTrash.map((x) => x.daysLeft ?? RETENTION_DAYS))
    out.recent = inTrash.slice(-8).map((x) => x.orig)
  } catch { /* 无回收站 */ }
  try { out.lastSweep = JSON.parse(fs().readFileSync(pathMod().join(absRoot, GC_FLAG()), 'utf8')) } catch { /* 尚未跑过 */ }
  // 第 3 层：建议清理（只提示，不自动删）。清单本身有成本，只在摘要里带前 12 条，总数单独给。
  try {
    const sugs = findSuggestions(absRoot)
    out.suggestionsTotal = sugs.length
    out.suggestions = sugs.slice(0, 12).map((s) => ({ rel: s.rel, why: s.why, idleDays: s.idleDays, bytes: s.bytes }))
  } catch { /* 建议清单失败不影响摘要 */ }
  return out
}
