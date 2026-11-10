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

const VERSIONED_FILE = /^(.+)-v(\d+)\.(tar\.gz|tgz|zip)$/
const VERSIONED_DOC = /^(.+?)v(\d+(?:\.\d+)*)[-_].*\.md$/
const TEMP_DIR = /^(chk[0-9a-f]{2,}|fc[0-9a-f]{4,}|f8_probe)$/
const TMP_AGE_DAYS = 7

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
    // R1：迭代版本包，按词干分组只留最近 N 个版本
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
      arr.sort((a, b) => a.v - b.v)
      for (const it of arr.slice(0, -Math.min(keep, arr.length))) found.push({ rel: it.rel, rule: `R1 迭代包（${stem} 只留最近 ${Math.min(keep, arr.length)} 版）` })
    }
  }
  if (want('docs')) {
    // R2：多版本文档（.jarvis/docs 内），按前缀分组只留版本最高
    const docsDir = pathMod().join(String(projectDir), '.jarvis', 'docs')
    const groups = new Map()
    try {
      for (const n of fs().readdirSync(docsDir, { withFileTypes: true })) {
        if (n.isDirectory()) continue
        const m = VERSIONED_DOC.exec(n.name)
        if (!m) continue
        const stem = m[1]
        if (!groups.has(stem)) groups.set(stem, [])
        groups.get(stem).push({ rel: `.jarvis/docs/${n.name}`, v: m[2].split('.').map(Number) })
      }
    } catch { /* 无 docs 目录 */ }
    const cmp = (a, b) => { const [x, y] = [a.v, b.v]; for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0 }
    for (const [stem, arr] of groups) {
      arr.sort(cmp)
      for (const it of arr.slice(0, -1)) found.push({ rel: it.rel, rule: `R2 多版本文档（${stem} 只留终版）` })
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
      '工作区垃圾回收（GC 三段语义）：①sweep=按规则认定垃圾移入回收站 <workspace>/.jarvis/trash/（默认 dryRun 只报不动，execute=true 才真收）；②list=回收站清单（含保留期剩余天数）；③restore=保留期内启用=按 id 恢复到原位置（恢复后 GC 后续仍可再次回收）；④purge=彻底删除超 30 天未恢复的条目（sweep/list 每次自动先清到期项）。规则：R1 迭代版本包只留最高版本（v28~v45 只留 v45）/ R2 多版本文档只留终版（交付清单 v1.0~v1.33 只留 v1.33）/ R3 过期临时目录（.tmp 等超 7 天）。保护名单永不收：project.md/lessons.md/board.json/gates.json/基线清单*/.git/node_modules。所有动作进 events.jsonl 审计（gc.collected/gc.restored/gc.purged）。',
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
          verdict: `发现 ${found.length} 个候选垃圾（dryRun 未动）${purged.length ? `；已自动清到期 ${purged.length} 件` : ''}\n${lines.join('\n') || '（无）'}${found.length > 40 ? `\n… 共 ${found.length} 条，execute=true 收纳入站` : ''}`,
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
