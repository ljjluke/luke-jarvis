#!/usr/bin/env node
/** 自进化闭环 · 端到端验证（真实工具代码路径，不真实发写请求）。
 *
 *  用法：node scripts/verify-evolution-loop.mjs            # 跑全部三幕
 *
 *  第一幕（真网络·只读）：GitHub 公开 API 实测 listIssues/latestRelease——验证适配器对真实 GitHub 的路径/解析正确。
 *  第二幕（用户环境）：jarvis_report_issue 确认门 → 提交 → 指纹去重（同症状不重复提交）。
 *  第三幕（研发环境）：jarvis_issue_sync fetch/ticket/close（审批门 pending_approval、approvalRequired 语义）+ jarvis_release_check（stable 过滤 prerelease）。
 *
 *  "GitHub"用进程内 mock（_setGitHubFetchForTests 注入），状态经 JSON 文件在两个环境间传递——
 *  与真实架构一致：两个环境互相独立，GitHub 是唯一同步枢纽。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = path.dirname(fileURLToPath(import.meta.url))
const phase = process.argv[2] || ''

// ══════════════ mock GitHub（进程内状态机，两个环境经 JSON 文件共享） ══════════════
function loadGh(root) { return JSON.parse(fs.readFileSync(path.join(root, 'gh-state.json'), 'utf8')) }
function saveGh(root, s) { fs.writeFileSync(path.join(root, 'gh-state.json'), JSON.stringify(s, null, 2)) }

function makeGhFetch(root) {
  const REPO_RE = /\/repos\/[^/]+\/[^/]+/
  return async (url, init = {}) => {
    const s = loadGh(root)
    const u = String(url)
    const json = (j, status = 200) => ({ ok: status < 400, status, statusText: status < 400 ? 'OK' : 'Error', json: async () => j })
    const body = init.body ? JSON.parse(init.body) : {}
    if ((init.method || 'GET') === 'POST' && REPO_RE.test(u) && u.endsWith('/issues')) {
      const n = ++s.nextIssue
      s.issues.push({ number: n, title: body.title, body: body.body, state: 'open', labels: body.labels || [], comments: [] })
      saveGh(root, s)
      return json({ number: n, html_url: `https://github.com/demo/repo/issues/${n}` })
    }
    if (REPO_RE.test(u) && /\/issues\?state=open/.test(u)) {
      return json(s.issues.filter((i) => i.state === 'open'))
    }
    const m = u.match(/\/issues\/(\d+)$/)
    if (m && (init.method || '') === 'PATCH') {
      const it = s.issues.find((i) => i.number === Number(m[1]))
      if (it) it.state = body.state || it.state
      saveGh(root, s)
      return json({})
    }
    const c = u.match(/\/issues\/(\d+)\/comments/)
    if (c && (init.method || '') === 'POST') {
      const it = s.issues.find((i) => i.number === Number(c[1]))
      if (it) it.comments.push(body.body)
      saveGh(root, s)
      return json({ id: 1 })
    }
    if (REPO_RE.test(u) && u.includes('/releases/latest')) {
      return s.latestRelease ? json(s.latestRelease) : json({ message: 'Not Found' }, 404)
    }
    if (REPO_RE.test(u) && u.includes('/releases?')) {
      return json(s.latestRelease ? [s.latestRelease] : [])
    }
    return json({ message: 'Not Found' }, 404)
  }
}

// ══════════════ 子进程入口（每幕独立进程：工作区互不污染，模拟真实双环境） ══════════════
async function runPhaseUser(root) {
  const { _setGitHubFetchForTests } = await import('../src/host/adapters/github.js')
  const { EVOLUTION_TOOLS } = await import('../src/host/tools/evolution.js')
  const { setSelfEvolutionConfig } = await import('../src/host/state/selfconfig.js')
  const { rememberExec } = await import('../src/host/runtime.js')
  const tool = (n) => EVOLUTION_TOOLS.find((t) => t.name === n)
  _setGitHubFetchForTests(makeGhFetch(root))
  setSelfEvolutionConfig({ githubToken: 'demo-token', githubRepo: 'demo/repo' })
  const workA = path.join(root, 'user-env')
  const fsSvc = { resolve: async (p) => p, readText: async (p) => fs.readFileSync(p, 'utf8'), writeText: async (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8'); return { ok: true } } }
  const exec = { agent: { session: { header: { cwd: workA } } }, ctx: { fs: fsSvc } }
  rememberExec(exec)

  const out = {}
  // 1) 确认门：默认不出网
  const draft = await tool('jarvis_report_issue').execute({ title: '导出报表时崩溃', symptoms: '点导出按钮后界面白屏，控制台报 TypeError', context: 'Wings UI，插件 0.14.0' }, exec)
  out.confirmGate = draft.confirmGate === true && draft.submitted === false
  // 2) 确认后真提交
  const done = await tool('jarvis_report_issue').execute({ title: '导出报表时崩溃', symptoms: '点导出按钮后界面白屏，控制台报 TypeError', confirm: 'true' }, exec)
  out.submitted = done.submitted === true && Number.isInteger(done.issueNumber) && done.issueNumber > 100
  // 3) 指纹去重：同症状仅标点/空白/大小写不同 → 命中已上报（语义相近但实词不同=新问题，不算重复）
  const dup = await tool('jarvis_report_issue').execute({ title: '导出 报表时崩溃!!', symptoms: '点导出按钮后界面白屏，控制台报 TypeError。', confirm: 'true' }, exec)
  out.dedupe = dup.duplicate === true && dup.issueNumber === done.issueNumber
  const s1 = loadGh(root)
  s1.userReported = done.issueNumber
  saveGh(root, s1)
  // 4) 未配 token 的另一实例（用户忘配）→ 如实报错
  const { setSelfEvolutionConfig: reset } = await import('../src/host/state/selfconfig.js')
  reset({ githubToken: '' })
  const noTok = await tool('jarvis_report_issue').execute({ title: '另一个问题', symptoms: '描述' }, exec)
  out.honestNoToken = noTok.submitted === false && /未配置 GitHub Token/.test(noTok.verdict)
  console.log(JSON.stringify(out))
}

async function runPhaseDev(root) {
  const { _setGitHubFetchForTests } = await import('../src/host/adapters/github.js')
  const { EVOLUTION_TOOLS } = await import('../src/host/tools/evolution.js')
  const { setSelfEvolutionConfig } = await import('../src/host/state/selfconfig.js')
  const { rememberExec } = await import('../src/host/runtime.js')
  const tool = (n) => EVOLUTION_TOOLS.find((t) => t.name === n)
  _setGitHubFetchForTests(makeGhFetch(root))
  const workB = path.join(root, 'dev-env')
  const fsSvc = { resolve: async (p) => p, readText: async (p) => fs.readFileSync(p, 'utf8'), writeText: async (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8'); return { ok: true } } }
  const exec = { agent: { session: { header: { cwd: workB } } }, ctx: { fs: fsSvc } }
  rememberExec(exec)

  const out = {}
  // 0) 角色门：用户实例不能碰修复链路
  setSelfEvolutionConfig({ workspaceMode: 'user', githubToken: 't', githubRepo: 'demo/repo' })
  const denied = await tool('jarvis_issue_sync').execute({ mode: 'fetch' }, exec)
  out.roleGate = denied.ok === false && /用户环境/.test(denied.verdict)
  setSelfEvolutionConfig({ workspaceMode: 'dev', githubToken: 't', approvalRequired: true, githubRepo: 'demo/repo' })
  // 1) fetch：拉到用户环境上报的 issue（连同预置误报一起，跨环境经 GitHub 中转）
  const userNum = loadGh(root).userReported
  const list = await tool('jarvis_issue_sync').execute({ mode: 'fetch' }, exec)
  out.fetched = list.ok === true && list.count >= 1 && list.issues.some((s) => s.includes('#' + userNum))
  // 2) ticket：写审批工单；approvalRequired=true 时 approve=true 也必须被忽略（闸门语义）
  const t1 = await tool('jarvis_issue_sync').execute({ mode: 'ticket', issuesJson: JSON.stringify([{ number: userNum, title: '导出报表时崩溃', severity: 'major', rootCause: '初判：导出回调未捕获异常' }]), approve: 'true' }, exec)
  const board = JSON.parse(fs.readFileSync(path.join(workB, '.jarvis/board.json'), 'utf8'))
  const ticket = board.items.find((i) => i.type === '审批工单')
  out.ticketPending = t1.ok === true && ticket && ticket.status === 'pending_approval' && ticket.issueNumber === String(userNum)
  // 3) close：误报必须带说明，静默关闭被拒绝
  const badClose = await tool('jarvis_issue_sync').execute({ mode: 'close', issueNumber: '102' }, exec)
  const goodClose = await tool('jarvis_issue_sync').execute({ mode: 'close', issueNumber: '102', comment: '无法复现：附完整日志后请重开' }, exec)
  const gh = loadGh(root)
  const i102 = gh.issues.find((i) => i.number === 102)
  out.closeFlow = badClose.ok === false && goodClose.ok === true && i102 && i102.state === 'closed' && i102.comments.length === 1
  // 4) release_check：stable 有新版 → 提示人工确认（不自动升级）；prerelease → stable 拒升
  gh.latestRelease = { tag_name: 'v0.15.0', name: 'v0.15.0', prerelease: false, draft: false, html_url: 'u', body: '修复 #101 导出崩溃' }
  saveGh(root, gh)
  const rel = await tool('jarvis_release_check').execute({}, exec)
  out.releaseStable = rel.hasUpdate === true && /人工确认/.test(rel.verdict) && rel.latestVersion === 'v0.15.0'
  gh.latestRelease = { tag_name: 'v0.16.0-rc1', prerelease: true, draft: false, html_url: 'u', body: '' }
  saveGh(root, gh)
  const pre = await tool('jarvis_release_check').execute({}, exec)
  out.prereleaseBlocked = pre.hasUpdate === false && /prerelease/.test(pre.verdict)
  console.log(JSON.stringify(out))
}

// ══════════════ 第一幕：真实 GitHub 只读 ══════════════
async function runPhaseReal() {
  const { createGitHubAdapter } = await import('../src/host/adapters/github.js')
  const out = { reachable: false }
  try {
    const a = createGitHubAdapter({ repo: 'ljjluke/luke-jarvis', token: '' })
    const rel = await a.latestRelease()
    const issues = await a.listIssues({ perPage: 5 })
    out.reachable = true
    out.latestRelease = rel ? rel.tagName : '（仓库尚无 release）'
    out.openIssues = issues.length
    out.note = '真实 GitHub 匿名只读 OK（无 token，限流 60/h）——适配器对真实 API 的路径与解析正确'
  } catch (e) {
    out.error = String(e.message || e).slice(0, 120)
    out.note = '网络不可达/限流——第一幕 SKIP（不影响判定，二/三幕已覆盖逻辑）'
  }
  return out
}

// ══════════════ 主流程 ══════════════
if (phase === 'user' || phase === 'dev') {
  const root = process.argv[3]
  const fn = phase === 'user' ? runPhaseUser : runPhaseDev
  await fn(root)
  process.exit(0)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-loop-'))
fs.writeFileSync(path.join(root, 'gh-state.json'), JSON.stringify({ issues: [], nextIssue: 100, latestRelease: null }))
// 预置一条误报 issue（#102）给 close 流程
{
  const s = loadGh(root)
  s.issues.push({ number: 102, title: '疑似：按钮变色', body: 'x', state: 'open', labels: [], comments: [] })
  s.nextIssue = 102
  saveGh(root, s)
}

const run = (p) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), p, root], { encoding: 'utf8' }).trim().split('\n').pop())

const real = await runPhaseReal()
const user = run('user')
const dev = run('dev')

const checks = [
  ['第一幕 真实GitHub只读（网络可达即计入）', real.reachable ? 'PASS' : 'SKIP', real.note + (real.latestRelease ? `｜release=${real.latestRelease}｜open issues=${real.openIssues}` : '')],
  ['确认门：默认出草稿不出网', user.confirmGate, 'reportMode=confirm 语义'],
  ['确认后提交 → GitHub #101', user.submitted, '用户环境零沙盒，只整理疑点'],
  ['指纹去重：换措辞再报同一条被拦', user.dedupe, '防多实例刷屏'],
  ['未配 token 如实报错（不静默）', user.honestNoToken, '诚实原则'],
  ['角色门：用户实例禁入修复链路', dev.roleGate, 'workspaceMode=dev 才解锁'],
  ['研发 fetch 拉到 #101（跨环境中转）', dev.fetched, 'GitHub 是唯一同步枢纽'],
  ['审批工单 pending_approval（approve 被忽略）', dev.ticketPending, '人工批准前不动源码'],
  ['误报关闭：静默拒绝 + 带说明成功', dev.closeFlow, '不许不吭声关 issue'],
  ['stable 有新版 → 只提示人工确认', dev.releaseStable, '升级必留人审'],
  ['prerelease 被 stable 渠道拦截', dev.prereleaseBlocked, '不升测试版'],
]
let fail = 0
console.log('\n════════ 自进化闭环 · 端到端验证 ════════')
for (const [name, r, note] of checks) {
  const ok = r === true || r === 'PASS'
  if (!ok && r !== 'SKIP') fail++
  console.log(`${ok ? '✅' : r === 'SKIP' ? '⏭️ ' : '❌'} ${name}${r === true ? '' : `（${r}）`}  —— ${note}`)
}
console.log(fail === 0 ? '\n🎉 闭环逻辑验证通过：思路成立，闸门语义全部生效' : `\n💥 ${fail} 项未过——见上表`)
process.exit(fail === 0 ? 0 : 1)
