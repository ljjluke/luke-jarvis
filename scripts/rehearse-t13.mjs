#!/usr/bin/env node
/**
 * T13 多项目共存预演（只读：复制真实工作区的 .jarvis + .agent-teams 到临时目录再跑，不动真实工作区）
 *
 * 断言（对应 T13 ①②④）：
 *   ① build 闸在真实 7 团队夹具上 **不被别家拦**（ok=true）；
 *   ② missing 里不出现别家团队名（其它项目 / 电商测试 / dsh- 前缀 / tech- 前缀 / 报销审批 / 需求澄清）；
 *   ③ execute 的缺口只允许来自「自家团队」（如自家 claimed 任务），不得含别家；
 *   ④ resolveOwnedTeams 只报自家团队（marker 缺失时按 72h 回退，但不得把别家算进去——回退也只在 72h 内）。
 *
 * 退出码：0=全过；1=有断言失败；2=夹具不可用
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import plugin, { TOOLS, resolveOwnedTeams } from '../src/host/plugin.js'

const SRC = process.env.PROJECT_DIR || '/opt/work/first'
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 't13-rehearse-'))

function copyDir(from, to) {
  if (!fs.existsSync(from)) return false
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (/^(node_modules|archive|old|history)$/i.test(e.name)) continue
    const s = path.join(from, e.name)
    const d = path.join(to, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
  return true
}

const hasJarvis = copyDir(path.join(SRC, '.jarvis'), path.join(WORK, '.jarvis'))
const hasTeams = copyDir(path.join(SRC, '.agent-teams'), path.join(WORK, '.agent-teams'))
if (!hasTeams) { console.error('❌ 夹具不可用：找不到 .agent-teams'); process.exit(2) }
console.log(`ℹ️  只读预演副本：${WORK}（.jarvis=${hasJarvis ? '有' : '无'}，团队=${fs.readdirSync(path.join(WORK, '.agent-teams')).length}）`)

// 真实 fs 适配器（对齐 DSH FileSystem：resolve 对不存在路径抛 ENOENT）
const realFs = () => ({
  async resolve(p) { fs.realpathSync(p); return { path: p } },
  async listDir(t) { return fs.readdirSync(t.path, { withFileTypes: true }).map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file' })) },
  async readText(t) { return fs.readFileSync(t.path, 'utf8') },
  async writeText(t, x) { fs.writeFileSync(t.path, x) },
})
const ctx = { get: (k) => (k === 'fs' ? realFs() : undefined), effect: (fn) => { try { fn() } catch {} }, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, systemPrompt: { section: () => () => {} } }
plugin.apply(ctx)

// 自家团队真实 captainSessionId（预演用真实会话，避免靠猜）
let ownSid = ''
let ownTeam = ''
try {
  const names = fs.readdirSync(path.join(WORK, '.agent-teams'))
  for (const n of names) {
    const f = path.join(WORK, '.agent-teams', n, 'team.json')
    if (!fs.existsSync(f)) continue
    const d = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (/完全体|luke-jarvis/i.test(n)) { ownTeam = n; ownSid = String(d.captainSessionId || '') }
  }
} catch {}
const ownedInfo = resolveOwnedTeams(WORK, ownSid)
console.log(`ℹ️  自家团队=${ownTeam || '(未识别)'}｜captainSessionId=${ownSid || '(空)'}`)
console.log(`ℹ️  ownedTeams=[${ownedInfo.teams.join(', ')}]（source=${ownedInfo.source}）`)

const fg = TOOLS.find((t) => t.name === 'jarvis_flowguard')
const run = (step) => fg.handler({ step, projectDir: WORK }, { agent: { session: { id: ownSid, header: { cwd: WORK } } } })

const OTHER_PAT = /其它项目|电商测试|dsh-neon-theme|dsh-web-hardening|tech-neo-theme|报销审批|需求澄清/
let bad = 0
const res = {}
for (const step of ['build', 'execute']) {
  const r = await run(step)
  res[step] = r
  const miss = (r.missing || []).join('；')
  console.log(`\n【${step}】ok=${r.ok} ownedTeams=[${(r.ownedTeams || []).join(', ')}]`)
  if (r.missing && r.missing.length) console.log(`  missing：${miss.slice(0, 400)}`)
  if (OTHER_PAT.test(miss)) { console.error(`❌ ${step} 的缺口里出现别家团队（跨项目污染未收窄）`); bad += 1 }
}
if (!res.build.ok) { console.error(`❌ build 仍被拦（自家【协调】改否应豁免）：${JSON.stringify(res.build.missing)}`); bad += 1 }
if (!ownedInfo.teams.includes(ownTeam) && ownTeam) { console.error(`❌ ownedTeams 未包含自家团队 ${ownTeam}`); bad += 1 }
if (ownedInfo.teams.some((t) => OTHER_PAT.test(t))) { console.error(`❌ ownedTeams 含别家团队：${ownedInfo.teams.join(',')}`); bad += 1 }

fs.rmSync(WORK, { recursive: true, force: true })
if (bad === 0) {
  console.log('\n✅ 预演通过：build 不被别家拦、缺口不含别家、ownedTeams 只含自家团队')
  process.exit(0)
}
console.log(`\n⛔ 预演失败（${bad} 项）`)
process.exit(1)
