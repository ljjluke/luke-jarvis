#!/usr/bin/env node
/**
 * build-preset-patches.mjs — 把 preset/*.yml（agent-plane 行列表）生成为
 * DSH 可注册的 `@deepseek-ai/dsh-agent-preset` patch 文件（presets/*.patch.yml）。
 *
 * 为什么需要：DSH 0.2+ 不再自动发现 ~/.dsh/.agent-presets，预设必须在 profile 的
 * cordis.patch.yml 里用 `- insert:` + dsh-agent-preset 行显式注册；把这一步做成
 * 可生成、可校验的文件，安装时就不需要用户手工拼 YAML。
 *
 * 单一事实源 = preset/agent.cordis.yml / preset/jarvis-captain.cordis.yml。
 * 生成物 = presets/jarvis-org.patch.yml / presets/jarvis-captain.patch.yml。
 * 用法：node scripts/build-preset-patches.mjs [--check]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

const SPECS = [
  {
    src: 'preset/agent.cordis.yml',
    meta: 'preset/preset.yml',
    out: 'presets/jarvis-org.patch.yml',
    id: 'jarvis-org',
    name: '贾维斯数字员工公司',
    order: 20,
    fallbackDescription: '完整公司预设：Jarvis 人设 + jarvis_* 工具 + agent-teams + 技能/ponder。',
  },
  {
    src: 'preset/jarvis-captain.cordis.yml',
    meta: '',
    out: 'presets/jarvis-captain.patch.yml',
    id: 'jarvis-captain',
    name: '贾维斯 Captain（严格·顶层只派发）',
    order: 21,
    fallbackDescription: '严格顶层预设：无 bash / edit / write / subagent，顶层只能建队派活。',
  },
]

const INDENT = ' '.repeat(10)

function readPresetMeta(file) {
  if (!file) return {}
  try {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const pick = (key) => {
      const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
      return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
    }
    return { name: pick('name'), description: pick('description') }
  } catch {
    return {}
  }
}

/**
 * 把 agent-plane 行列表拆成「行块」，并丢掉三类由**根 patch**（cordis.patch.yml）
 * 已经挂载的行——否则「根挂载 + 预设挂载」会把同一个插件挂两次：
 *   - luke-jarvis（根 patch 的 jarvis-core）
 *   - @nanmicoder/dsh-agent-teams（根 patch 的 agent-teams-patch，含 memberMaxDepth: 2）
 * 需要「预设内自挂」的部署（profile 忽略根 insert 的已知边界）请用手工预设文件
 * preset/*.yml（它们保留完整行），不要用本生成物。
 */
const ROOT_MOUNTED = new Set(['luke-jarvis', '@nanmicoder/dsh-agent-teams'])

function splitRowBlocks(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let current = null
  let pendingComments = []
  for (const line of lines) {
    if (/^- id:/.test(line)) {
      if (current) blocks.push(current)
      current = { lines: [...pendingComments, line] }
      pendingComments = []
    } else if (current) {
      current.lines.push(line)
    } else {
      pendingComments.push(line)
    }
  }
  if (current) blocks.push(current)
  return { blocks, trailing: pendingComments }
}

function rowName(block) {
  const m = block.lines.join('\n').match(/^\s+name:\s*['"]?([^'"\n]+)['"]?\s*$/m)
  return m ? m[1].trim() : ''
}

function presetRows(text) {
  const { blocks, trailing } = splitRowBlocks(text)
  const kept = []
  for (const block of blocks) {
    const name = rowName(block)
    if (name && ROOT_MOUNTED.has(name)) {
      // 该行块由根 patch 挂载：丢弃它，并把紧邻其上的注释/空行一并清掉（避免留下
      // "必须挂 luke-jarvis" 却看不到该行的悬空注释）。
      const prev = kept[kept.length - 1]
      if (prev) {
        while (prev.lines.length) {
          const last = prev.lines[prev.lines.length - 1].trim()
          if (last === '' || last.startsWith('#')) prev.lines.pop()
          else break
        }
      }
      continue
    }
    kept.push(block)
  }
  return kept.map((b) => b.lines.join('\n')).join('\n') + (trailing.length ? '\n' + trailing.join('\n') : '')
}

function yamlBlockScalarBody(text, indent) {
  return String(text).split(/\r?\n/).map((l) => (l ? `${indent}${l}` : '')).join('\n')
}

function build(spec) {
  const srcPath = path.join(ROOT, spec.src)
  const rawRows = presetRows(fs.readFileSync(srcPath, 'utf8'))
  const rows = rawRows.split('\n')
  const meta = readPresetMeta(spec.meta)
  const name = meta.name || spec.name
  const description = meta.description || spec.fallbackDescription
  const indented = rows.map((line) => (line ? INDENT + line : '')).join('\n').replace(/\n+$/, '')
  return [
    '# AUTO-GENERATED — do not edit by hand.',
    `# Source: ${spec.src}${spec.meta ? ` + ${spec.meta}` : ''}`,
    '# Regenerate: node scripts/build-preset-patches.mjs',
    '#',
    '# 用途：把随包分发的 agent 预设声明成 DSH 可注册的行（DSH 0.2+ 不再自动发现',
    '# ~/.dsh/.agent-presets，必须在 profile 的 cordis.patch.yml 里显式注册）。',
    '# 去重：luke-jarvis / @nanmicoder/dsh-agent-teams 由根 patch（cordis.patch.yml）挂载，',
    '#       本文件不再重复挂载（否则同一插件挂两次）。需要「预设内自挂」请用手工预设文件。',
    '# 用法：①npx luke-jarvis setup --profile <name>（自动写入 profile patch）；',
    '#       ②手工把下面的 - insert: 条目追加到 profile 的 cordis.patch.yml。',
    '- insert:',
    `    - id: preset-${spec.id}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${spec.id}`,
    `        name: ${JSON.stringify(name)}`,
    '        description: >-',
    yamlBlockScalarBody(description, '          '),
    `        order: ${spec.order}`,
    '        plugins:',
    indented,
    '',
  ].join('\n')
}

let failed = false
for (const spec of SPECS) {
  const outPath = path.join(ROOT, spec.out)
  const content = build(spec)
  if (CHECK) {
    let current = ''
    try { current = fs.readFileSync(outPath, 'utf8') } catch { /* missing counts as drift */ }
    if (current !== content) {
      console.error(`DRIFT: ${spec.out} 与 ${spec.src} 不一致——运行 node scripts/build-preset-patches.mjs 重新生成`)
      failed = true
    } else {
      console.log(`OK: ${spec.out}`)
    }
  } else {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, content)
    console.log(`written: ${spec.out} (${content.split('\n').length - 1} lines)`)
  }
}
process.exit(failed ? 1 : 0)
