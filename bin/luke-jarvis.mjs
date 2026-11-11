#!/usr/bin/env node
/**
 * luke-jarvis CLI —— 把「完全插件」的安装收尾做成一条命令。
 *
 * 背景（DSH 0.2+ 的真实约束）：
 *   1. 插件包只会被 `dsh plugin add` 写进 profile 的 dependencies；
 *      真正挂载要在 profile 的 `dsh.profile.bundles` 里登记（本 CLI 代做）。
 *   2. 技能发现根只有 ~/.dsh/skills、~/.agents/skills、项目 .dsh/skills，
 *      **不会**扫描 node_modules —— 随包的 skills/ 必须落位（本 CLI 代做）。
 *   3. 预设不再被自动发现，必须在 profile 的 cordis.patch.yml 里显式注册
 *      （presets/*.patch.yml 就是生成好的注册行，本 CLI 代写）。
 *
 * 用法：
 *   luke-jarvis setup [--profile <name>] [--home <dir>] [--dry-run] [--force]
 *   luke-jarvis doctor [--profile <name>] [--home <dir>]
 *   luke-jarvis status
 *   luke-jarvis presets
 *
 * 只依赖 node 内置模块；不联网；写文件前先备份（*.bak-<时间戳>）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'))
const VERSION = PKG.version

const args = process.argv.slice(2)
const cmd = args[0] || 'help'
const opt = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = args[i + 1]
  return v && !v.startsWith('--') ? v : 'true'
}
const has = (name) => args.includes(`--${name}`)

const DSH_HOME = path.resolve(opt('home', process.env.DSH_HOME || path.join(os.homedir(), '.dsh')))
const PROFILES_DIR = path.join(DSH_HOME, 'profiles')
const DRY = has('dry-run')

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
}
const say = (s = '') => console.log(s)
const step = (s) => say(`\n── ${s} ──`)

function backup(file) {
  if (!fs.existsSync(file)) return ''
  const bak = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  fs.copyFileSync(file, bak)
  return bak
}

function copyTree(src, dest) {
  if (!fs.existsSync(src)) return { ok: false, reason: '源不存在' }
  if (DRY) return { ok: true, dry: true }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true, force: true })
  return { ok: true }
}

function resolveProfile() {
  const name = opt('profile', '')
  if (name) {
    const dir = path.join(PROFILES_DIR, name)
    if (!fs.existsSync(dir)) throw new Error(`profile 不存在：${dir}`)
    return { name, dir }
  }
  if (fs.existsSync(path.join(PROFILES_DIR, 'web'))) return { name: 'web', dir: path.join(PROFILES_DIR, 'web') }
  let names = []
  try { names = fs.readdirSync(PROFILES_DIR) } catch { /* no profiles dir */ }
  if (names.length === 1) return { name: names[0], dir: path.join(PROFILES_DIR, names[0]) }
  throw new Error(`无法确定 profile（找到 ${names.length} 个：${names.join(', ') || '无'}）——用 --profile <name> 指定`)
}

/** 把 package.json 的 dsh.profile.bundles 补上 luke-jarvis */
function registerBundle(profile) {
  const pkgPath = path.join(profile.dir, 'package.json')
  if (!fs.existsSync(pkgPath)) return { ok: false, reason: 'profile 没有 package.json' }
  const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  raw.dsh = raw.dsh || {}
  raw.dsh.profile = raw.dsh.profile || {}
  const bundles = Array.isArray(raw.dsh.profile.bundles) ? raw.dsh.profile.bundles : []
  if (bundles.includes('luke-jarvis')) return { ok: true, already: true }
  bundles.push('luke-jarvis')
  raw.dsh.profile.bundles = bundles
  if (!DRY) {
    backup(pkgPath)
    fs.writeFileSync(pkgPath, JSON.stringify(raw, null, 2) + '\n')
  }
  return { ok: true, added: true }
}

/** bundle patch 是否自带预设声明（DSH 规范：预设由 bundle patch 声明，安装即生效）。 */
function bundleDeclaresPresets(patchPath) {
  let text = ''
  try { text = fs.readFileSync(patchPath, 'utf8') } catch { return { ok: false, reason: patchPath + ' 不存在' } }
  const ids = ['preset-jarvis-org', 'preset-jarvis-captain']
  const missing = ids.filter((id) => !text.includes(id))
  return missing.length ? { ok: false, reason: `bundle patch 缺预设行：${missing.join(', ')}` } : { ok: true }
}

function setup() {
  say(`luke-jarvis ${VERSION} · setup ${DRY ? C.dim('(dry-run)') : ''}`)
  say(`DSH_HOME = ${DSH_HOME}`)

  step('1) 技能落位（~/.dsh/skills）')
  const skills = [
    { src: path.join(PKG_ROOT, 'skills/jarvis.md'), dest: path.join(DSH_HOME, 'skills/jarvis/SKILL.md'), label: 'jarvis' },
    { src: path.join(PKG_ROOT, 'skills/ponder'), dest: path.join(DSH_HOME, 'skills/ponder'), label: 'ponder（十阶段）' },
  ]
  for (const s of skills) {
    if (fs.existsSync(s.dest) && !has('force') && !DRY) {
      say(`  ${C.warn('skip')} ${s.label}（已存在；加 --force 覆盖）`)
      continue
    }
    const src = s.dest.endsWith('SKILL.md')
      ? { ok: fs.existsSync(s.src), copy: () => { fs.mkdirSync(path.dirname(s.dest), { recursive: true }); fs.copyFileSync(s.src, s.dest) } }
      : { ok: fs.existsSync(s.src), copy: () => fs.cpSync(s.src, s.dest, { recursive: true, force: true }) }
    if (!src.ok) { say(`  ${C.err('missing')} ${s.label} 源文件不在包内`); continue }
    if (DRY) say(`  ${C.dim('would copy')} ${s.label} → ${s.dest}`)
    else { src.copy(); say(`  ${C.ok('ok')} ${s.label} → ${s.dest}`) }
  }

  step('2) 预设（随 bundle patch 声明，无需落位）')
  const patchCheck = bundleDeclaresPresets(path.join(PKG_ROOT, 'cordis.patch.yml'))
  if (patchCheck.ok) say(`  ${C.ok('ok')} cordis.patch.yml 已声明 jarvis-org / jarvis-captain（安装时随 bundle 自动注册）`)
  else say(`  ${C.err('fail')} ${patchCheck.reason}（包不完整，重新下载/构建）`)

  let profile = null
  try { profile = resolveProfile() } catch (e) { say(`\n${C.warn('skip profile 注册')}：${e.message}`) }

  if (profile) {
    step(`3) profile 注册（${profile.name}）`)
    const b = registerBundle(profile)
    if (b.ok) say(`  ${C.ok('ok')} bundles += luke-jarvis${b.already ? '（已存在）' : ''}${DRY ? C.dim(' (dry-run)') : ''}`)
    else say(`  ${C.err('fail')} ${b.reason}`)

  }

  step('4) 下一步')
  say('  1. 重装依赖并重启 dsh（技能/预设/插件都在这一步真正生效）：')
  say(`     cd ${profile ? profile.dir : '<profile>'} && pnpm install --force`)
  say('     # 然后重启 dsh web（会中断在跑成员，等空闲时做）')
  say('  2. 自检：')
  say(`     npx luke-jarvis doctor${profile ? ` --profile ${profile.name}` : ''}`)
  say('  3. 确认：/jarvis-ui 可打开；新会话的 agent 预设里出现 jarvis-org / jarvis-captain。')
  say(DRY ? `\n${C.dim('dry-run：没有写任何文件。')}` : '')
}

async function doctor() {
  let bad = 0
  const fail = (s) => { bad++; say(`  ${C.err('FAIL')} ${s}`) }
  const warn = (s) => say(`  ${C.warn('WARN')} ${s}`)
  const ok = (s) => say(`  ${C.ok('ok')}   ${s}`)

  say(`luke-jarvis ${VERSION} · doctor`)
  say(`DSH_HOME = ${DSH_HOME}\n`)

  step('运行时')
  const major = Number(process.versions.node.split('.')[0])
  major >= 22 ? ok(`node ${process.versions.node}`) : fail(`node ${process.versions.node}（需要 >= 22）`)

  step('技能')
  const jarvisSkill = path.join(DSH_HOME, 'skills/jarvis/SKILL.md')
  fs.existsSync(jarvisSkill) ? ok('skills/jarvis/SKILL.md') : fail('skills/jarvis/SKILL.md 不存在 —— 运行 npx luke-jarvis setup')
  const ponderDir = path.join(DSH_HOME, 'skills/ponder')
  if (fs.existsSync(ponderDir)) {
    let stages = 0
    try { stages = fs.readdirSync(path.join(ponderDir, 'stages')).filter((f) => f.endsWith('.json')).length } catch { /* missing */ }
    stages >= 9 ? ok(`skills/ponder（stages=${stages}）`) : fail(`skills/ponder stages=${stages}（期望 >= 9，可能没拷全）`)
    fs.existsSync(path.join(ponderDir, 'scripts/step-guard.cjs'))
      ? ok('ponder scripts/step-guard.cjs')
      : fail('ponder scripts/step-guard.cjs 缺失（成员交活闸会卡死）')
  } else fail('skills/ponder 不存在 —— 运行 npx luke-jarvis setup')

  step('预设')
  const installedPatch = path.join(PROFILES_DIR, 'web', 'node_modules/luke-jarvis/cordis.patch.yml')
  const presetPatch = fs.existsSync(installedPatch) ? installedPatch : path.join(PKG_ROOT, 'cordis.patch.yml')
  const pc = bundleDeclaresPresets(presetPatch)
  pc.ok ? ok(`bundle patch 声明 jarvis-org / jarvis-captain（${path.relative(DSH_HOME, presetPatch) || presetPatch}）`) : fail(pc.reason)

  step('profile')
  let profiles = []
  try { profiles = fs.readdirSync(PROFILES_DIR) } catch { /* none */ }
  if (!profiles.length) fail(`没有 profile（${PROFILES_DIR}）`)
  for (const name of profiles) {
    const dir = path.join(PROFILES_DIR, name)
    let pkg = {}
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch { /* ignore */ }
    const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
    if (!fs.existsSync(path.join(dir, 'package.json'))) { warn(`${name}: 无 package.json（跳过）`); continue }
    bundles.includes('luke-jarvis')
      ? ok(`${name}: bundles 含 luke-jarvis`)
      : warn(`${name}: bundles 未含 luke-jarvis —— 运行 npx luke-jarvis setup --profile ${name}`)
    if (bundles.includes('luke-jarvis')) {
      const runtime = path.join(dir, 'node_modules/luke-jarvis/package.json')
      if (fs.existsSync(runtime)) {
        const v = JSON.parse(fs.readFileSync(runtime, 'utf8')).version
        v === VERSION ? ok(`${name}: 运行副本 ${v}`) : warn(`${name}: 运行副本 ${v} ≠ 本包 ${VERSION}（重装 + 重启后生效）`)
      } else warn(`${name}: 运行副本不存在（先 pnpm install）`)
    }
  }

  // ── 设置面板诊断（客户实测反馈"升级后 DSH 设置里没有路克贾维斯"）──
  // 真实路径：设置 → 内置插件 → luke-jarvis → 配置卡片。
  // 卡片 = client 半（src/client/index.js）注册 plugins.bundle.config 插槽；
  // 数据源 = host Config 的 volatile 字段派生的 settings 命名空间（jarvis-core）。
  // 原版 DSH 不会仅凭 host Config 自动生成设置 UI——两件套缺一不可。
  step('设置面板（内置插件 → 配置卡片）')
  for (const name of profiles) {
    const entry = path.join(PROFILES_DIR, name, 'node_modules/luke-jarvis/src/host/plugin.js')
    if (!fs.existsSync(entry)) continue
    try {
      const m = await import(pathToFileURL(entry).href)
      if (typeof m.Config !== 'function') {
        fail(`${name}: 运行副本无 Config 导出——配置卡片无数据源（副本损坏/偏旧，重装）`)
        continue
      }
      const defaults = m.Config({})
      const keys = Object.keys(defaults || {})
      const need = ['ui', 'voice', 'workspaceMode', 'selfEvolution']
      const missing = need.filter((k) => !keys.includes(k))
      if (missing.length) {
        warn(`${name}: Config 缺区块 ${missing.join('/')}（副本偏旧——重装 + 重启 dsh web 后卡片才有新配置项）`)
        continue
      }
      // volatile 是 settings 命名空间的派生条件：没有它卡片会显示"不可用"
      const volatileOk = keys.every((k) => defaults[k] && typeof defaults[k].get === 'function')
      if (!volatileOk) {
        warn(`${name}: Config 字段未 volatile 化（副本偏旧——配置卡片无法读取实时值，重装 + 重启）`)
        continue
      }
      // client 半：配置卡片的实际来源（没有它设置里什么都不会显示）
      const clientEntry = path.join(PROFILES_DIR, name, 'node_modules/luke-jarvis/src/client/index.js')
      if (!fs.existsSync(clientEntry)) {
        fail(`${name}: 运行副本缺 client 半（src/client/index.js）——设置里不会出现配置卡片，需升级到含 client 半的版本 + 重启 dsh web`)
        continue
      }
      const pkgRaw = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, name, 'node_modules/luke-jarvis/package.json'), 'utf8'))
      if (!pkgRaw.dsh || !pkgRaw.dsh.client || !pkgRaw.exports || !pkgRaw.exports['./client']) {
        fail(`${name}: package.json 缺 dsh.client/exports./client 声明——client 模块无法被发现（副本偏旧，重装）`)
        continue
      }
      ok(`${name}: 配置卡片两件套完整（volatile Config + client 半）——设置 → 内置插件 → luke-jarvis 应可见`)
    } catch (e) {
      fail(`${name}: Config schema 加载失败（${String(e.message || e).slice(0, 100)}）——配置卡片无法显示`)
    }
  }
  // DSH 版本（设置面板要求 dsh >= 0.2.1-rc.1；client 模块与 Config 都是启动期加载——升级后必须重启 dsh web）
  const webNM = path.join(PROFILES_DIR, 'web', 'node_modules', '@deepseek-ai')
  try {
    const pkgs = fs.existsSync(webNM) ? fs.readdirSync(webNM).filter((d) => /^dsh/.test(d)) : []
    for (const d of pkgs) {
      try {
        const v = JSON.parse(fs.readFileSync(path.join(webNM, d, 'package.json'), 'utf8')).version
        ok(`DSH 组件 @deepseek-ai/${d} = ${v}${/rc\.0|0\.1\./.test(v) ? '（⚠️ 设置面板需 dsh >= 0.2.1-rc.1，过旧则不渲染插件配置卡片）' : ''}`)
      } catch { /* 忽略个别坏包 */ }
    }
  } catch { /* 无 web profile：上面 profile 步已报 */ }
  warn('提醒：插件 host/client 都是 dsh web 启动期加载的——升级插件后必须重启 dsh web，再到 设置 → 内置插件 → luke-jarvis 看配置卡片')

  say(bad ? `\n${C.err(`doctor: ${bad} 项失败`)}` : `\n${C.ok('doctor: 全部通过')}`)
  say(bad ? C.dim('按上面 FAIL/WARN 处置后重跑；改完 profile 需重启 dsh web 才生效。') : C.dim('改动 profile 后需重启 dsh web 才生效。'))
  process.exit(bad ? 2 : 0)
}

function status() {
  say(`luke-jarvis ${VERSION}`)
  say(`package: ${PKG_ROOT}`)
  say(`DSH_HOME: ${DSH_HOME}`)
  const skills = ['skills/jarvis/SKILL.md', 'skills/ponder']
    .map((p) => `${p}=${fs.existsSync(path.join(DSH_HOME, p)) ? 'ok' : 'missing'}`)
  say(`skills: ${skills.join(' ')}`)
  const pc = bundleDeclaresPresets(path.join(PKG_ROOT, 'cordis.patch.yml'))
  say(`presets: bundle patch ${pc.ok ? 'ok（jarvis-org / jarvis-captain）' : 'missing'}`)
}

function presetsCmd() {
  say('随包预设（presets/*.patch.yml 为可注册行）：')
  say('  jarvis-org      完整公司预设（Jarvis 人设 + jarvis_* 工具 + agent-teams + 技能）')
  say('  jarvis-captain  严格顶层预设（无 bash/edit/write/subagent，只派发）')
  say('\n注册：npx luke-jarvis setup --profile <name>')
}

function help() {
  say(`luke-jarvis ${VERSION} — DSH 数字员工公司插件

用法：
  luke-jarvis setup   [--profile <name>] [--home <dir>] [--dry-run] [--force]
        技能落位 + profile bundle 注册（预设由 bundle patch 自带，无需落位）
  luke-jarvis doctor  [--profile <name>] [--home <dir>]
        安装自检（node 版本 / 技能完整 / 预设 / profile 注册 / 运行副本版本）
  luke-jarvis presets 列出随包预设
  luke-jarvis status  显示版本与本机落位状态

说明：
  • 预设不需要复制到 ~/.dsh/.agent-presets（那是 DSH 0.2 前的旧机制，已废弃）：
    本包的 cordis.patch.yml 已用 dsh-agent-preset 行声明预设，装上插件即注册。
  • DSH 不扫描 node_modules 里的 skills，所以技能要落到 $DSH_HOME/skills——本 CLI 收尾这一步。
  • 改 profile 前会备份（*.bak-<时间戳>）；--dry-run 只打印不写。
  • 改完需重启 dsh web 才真正加载。`)
}

try {
  if (cmd === 'setup') setup()
  else if (cmd === 'doctor') await doctor()
  else if (cmd === 'presets') presetsCmd()
  else if (cmd === 'status') status()
  else if (cmd === 'version' || cmd === '--version' || cmd === '-v') say(VERSION)
  else if (cmd === 'help' || cmd === '--help' || cmd === '-h') help()
  else { help(); process.exit(1) }
} catch (e) {
  console.error(C.err(`error: ${e.message}`))
  process.exit(1)
}
