/** 自进化闭环单测：GitHub 适配器 / issue 上报（指纹去重+确认门）/ issue 巡检（角色门+审批工单）/ 稳定版检测。
 *  外呼一律 mock fetch 注入（_setGitHubFetchForTests），不真实访问网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { EVOLUTION_TOOLS, issueFingerprint, compareSemver, localPluginVersion } from '../src/host/tools/evolution.js'
import { createGitHubAdapter, _setGitHubFetchForTests } from '../src/host/adapters/github.js'
import { setSelfEvolutionConfig, getSelfEvolutionConfig, _resetSelfEvolutionConfigForTests } from '../src/host/state/selfconfig.js'
import { rememberExec } from '../src/host/runtime.js'

const tool = (name) => EVOLUTION_TOOLS.find((t) => t.name === name)

function tmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-evo-'))
}

// 共享工作区：runtime 的 rememberExec 是"首调生效"语义，本文件统一用一个 tmpdir，
// 否则 boardFilePath/ledgerPath 会漂到第一个用例的目录（工作区漂移教训的测试版）。
const WORK = tmpWorkspace()
const EXEC = makeExec(WORK)
rememberExec(EXEC)

/** exec 桩：session cwd=临时工作区 + 真实 fs 兜底的 mock fs 服务。 */
function makeExec(dir) {
  const fsSvc = {
    resolve: async (p) => p,
    readText: async (p) => fs.readFileSync(p, 'utf8'),
    writeText: async (p, content) => {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, content, 'utf8')
      return { ok: true }
    },
  }
  return { agent: { session: { header: { cwd: dir } } }, ctx: { fs: fsSvc } }
}

/** mock fetch 工厂：记录调用，按 url 前缀返回预设响应。 */
function mockFetch(router) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const r = router(String(url), init) || {}
    return {
      ok: r.ok !== undefined ? r.ok : true,
      status: r.status !== undefined ? r.status : 200,
      statusText: r.statusText || (r.ok === false ? 'Error' : 'OK'),
      json: async () => (r.json !== undefined ? r.json : {}),
    }
  }
  fn.calls = calls
  return fn
}

test('指纹与版本比较：纯函数语义', () => {
  const a = issueFingerprint('保存按钮点击没反应', '点保存按钮没反应')
  const b = issueFingerprint('保存 按钮  点击没反应！', '点保存按钮没反应')
  assert.equal(a, b, '同症状不同措辞/标点应命中同一指纹')
  assert.notEqual(a, issueFingerprint('导出功能崩溃', '导出就崩'))
  assert.ok(compareSemver('v0.15.0', '0.14.2') > 0)
  assert.ok(compareSemver('0.14.0', 'v0.14.1') < 0)
  assert.equal(compareSemver('v1.2.3', '1.2.3'), 0)
  assert.ok(localPluginVersion().length > 0, '要能读到插件本地版本号')
})

test('github 适配器：listIssues 过滤 PR、createIssue 需 token 且带 Bearer 头', async () => {
  const fetch = mockFetch((url, init) => {
    if (url.includes('/issues?')) {
      return { json: [{ number: 1, title: '真 bug' }, { number: 2, title: 'PR 不算', pull_request: { url: 'x' } }] }
    }
    if (url.endsWith('/issues') && (init.method || '') === 'POST') {
      return { json: { number: 9, html_url: 'https://github.com/o/r/issues/9' } }
    }
    return { ok: false, status: 404 }
  })
  _setGitHubFetchForTests(fetch)
  try {
    const noToken = createGitHubAdapter({ repo: 'o/r', token: '' })
    assert.equal(noToken.hasToken(), false)
    await assert.rejects(() => noToken.createIssue({ title: 'x' }), /未配置 GitHub Token/)

    const withToken = createGitHubAdapter({ repo: 'o/r', token: 'tp-123' })
    const issues = await withToken.listIssues()
    assert.equal(issues.length, 1, 'PR 必须被过滤')
    assert.equal(issues[0].number, 1)
    const created = await withToken.createIssue({ title: '新问题', body: 'b' })
    assert.equal(created.number, 9)
    assert.equal(fetch.calls[1].init.headers.Authorization, 'Bearer tp-123')
  } finally {
    _setGitHubFetchForTests(null)
  }
})

test('github 适配器：latestRelease 404 → null（不是错误）；commentAndClose 先评论后关闭', async () => {
  let patchBody = null
  const fetch = mockFetch((url, init) => {
    if (url.includes('/releases/latest')) return { ok: false, status: 404, json: { message: 'Not Found' } }
    if (url.includes('/issues/7/comments')) return { json: { id: 1 } }
    if (url.includes('/issues/7') && (init.method || '') === 'PATCH') { patchBody = init.body; return { json: {} } }
    return { ok: false, status: 500 }
  })
  _setGitHubFetchForTests(fetch)
  try {
    const a = createGitHubAdapter({ repo: 'o/r', token: 't' })
    assert.equal(await a.latestRelease(), null)
    await a.commentAndClose(7, '误报：无法复现')
    assert.ok(String(patchBody).includes('"state":"closed"'))
  } finally {
    _setGitHubFetchForTests(null)
  }
})

test('report_issue：未配 token 如实报错；缺字段拒绝', async () => {
  _resetSelfEvolutionConfigForTests()
  
  
  
  const r1 = await tool('jarvis_report_issue').execute({ title: 'x', symptoms: 'y' }, EXEC)
  assert.equal(r1.submitted, false)
  assert.match(r1.verdict, /未配置 GitHub Token/)
  setSelfEvolutionConfig({ githubToken: 't', githubRepo: 'o/r' })
  const r2 = await tool('jarvis_report_issue').execute({ title: 'x', symptoms: '' }, EXEC)
  assert.equal(r2.submitted, false)
  assert.match(r2.verdict, /缺 title 或 symptoms/)
})

test('report_issue：确认门出草稿不提交；confirm=true 才真提交并记账', async () => {
  _resetSelfEvolutionConfigForTests()
  setSelfEvolutionConfig({ githubToken: 't', githubRepo: 'o/r' })
  
  
  
  const fetch = mockFetch((url, init) => {
    if (url.endsWith('/issues') && (init.method || '') === 'POST') return { json: { number: 12, html_url: 'u/12' } }
    return { ok: false, status: 404 }
  })
  _setGitHubFetchForTests(fetch)
  try {
    const draft = await tool('jarvis_report_issue').execute({ title: '保存失效', symptoms: '点保存无响应' }, EXEC)
    assert.equal(draft.submitted, false)
    assert.equal(draft.confirmGate, true, 'reportMode=confirm 默认必须过确认门')
    assert.ok(fetch.calls.length === 0, '确认门阶段不得外呼')
    assert.match(draft.verdict, /确认门/)

    const done = await tool('jarvis_report_issue').execute({ title: '保存失效', symptoms: '点保存无响应', confirm: 'true' }, EXEC)
    assert.equal(done.submitted, true)
    assert.equal(done.issueNumber, 12)
    const ledger = JSON.parse(fs.readFileSync(path.join(WORK, '.jarvis/reported-issues.json'), 'utf8'))
    assert.equal(ledger.entries.length, 1)
    assert.equal(ledger.entries[0].number, 12)

    const dup = await tool('jarvis_report_issue').execute({ title: '保存 失效!', symptoms: '点保存无响应。', confirm: 'true' }, EXEC)
    assert.equal(dup.duplicate, true, '同症状不同措辞要命中指纹')
    assert.equal(dup.issueNumber, 12)
    assert.ok(fetch.calls.length === 1, '去重命中后不得再次外呼')
  } finally {
    _setGitHubFetchForTests(null)
  }
})

test('issue_sync：用户实例如实拒绝；ticket 写审批工单 pending_approval；approvalRequired=false 才允许跳过', async () => {
  _resetSelfEvolutionConfigForTests()
  
  
  

  const denied = await tool('jarvis_issue_sync').execute({ mode: 'fetch' }, EXEC)
  assert.equal(denied.ok, false)
  assert.match(denied.verdict, /用户环境/)

  setSelfEvolutionConfig({ workspaceMode: 'dev', githubToken: 't', githubRepo: 'o/r' })
  const fetch = mockFetch((url) => {
    if (url.includes('/issues?')) return { json: [{ number: 3, title: '导出崩溃', labels: ['bug'] }, { number: 4, title: 'PR', pull_request: {} }] }
    return { ok: false, status: 404 }
  })
  _setGitHubFetchForTests(fetch)
  try {
    const list = await tool('jarvis_issue_sync').execute({ mode: 'fetch' }, EXEC)
    assert.equal(list.ok, true)
    assert.equal(list.count, 1, 'PR 过滤后只算 issue')
    assert.ok(list.issues[0].includes('#3'))

    const ticket = await tool('jarvis_issue_sync').execute({
      mode: 'ticket',
      issuesJson: JSON.stringify([{ number: 3, title: '导出崩溃', severity: 'major', rootCause: '未判空' }]),
      approve: 'true',
    }, EXEC)
    assert.equal(ticket.ok, true)
    const board = JSON.parse(fs.readFileSync(path.join(WORK, '.jarvis/board.json'), 'utf8'))
    const t = board.items.find((i) => i.type === '审批工单')
    assert.ok(t, '审批工单要写入看板')
    assert.equal(t.status, 'pending_approval', 'approvalRequired=true（默认）时 approve 被忽略，必须人工批准')
    assert.equal(t.issueNumber, '3')

    setSelfEvolutionConfig({ workspaceMode: 'dev', githubToken: 't', approvalRequired: false })
    const ticket2 = await tool('jarvis_issue_sync').execute({
      mode: 'ticket',
      issuesJson: JSON.stringify([{ number: 5, title: '另一问题' }]),
      approve: 'true',
    }, EXEC)
    assert.equal(ticket2.ok, true)
    const board2 = JSON.parse(fs.readFileSync(path.join(WORK, '.jarvis/board.json'), 'utf8'))
    const t2 = board2.items.filter((i) => i.type === '审批工单').pop()
    assert.equal(t2.status, 'open', '显式关闭审批 + approve=true 才直接 open')

    const empty = await tool('jarvis_issue_sync').execute({ mode: 'ticket', issuesJson: '[]' }, EXEC)
    assert.equal(empty.ok, false)
    assert.match(empty.verdict, /issuesJson/)
  } finally {
    _setGitHubFetchForTests(null)
  }
})

test('issue_sync close：缺说明拒绝；成功走评论+关闭', async () => {
  _resetSelfEvolutionConfigForTests()
  setSelfEvolutionConfig({ workspaceMode: 'dev', githubToken: 't', githubRepo: 'o/r' })
  
  
  const fetch = mockFetch((url) => (url.includes('/issues/8') ? { json: {} } : { ok: false, status: 404 }))
  _setGitHubFetchForTests(fetch)
  try {
    const bad = await tool('jarvis_issue_sync').execute({ mode: 'close', issueNumber: '8' }, EXEC)
    assert.equal(bad.ok, false)
    assert.match(bad.verdict, /comment/)
    const ok = await tool('jarvis_issue_sync').execute({ mode: 'close', issueNumber: '8', comment: '无法复现：附日志后重开' }, EXEC)
    assert.equal(ok.ok, true)
    assert.equal(fetch.calls.length, 2, '一次评论 + 一次 PATCH 关闭')
  } finally {
    _setGitHubFetchForTests(null)
  }
})

test('release_check：stable 过滤 prerelease；有新版给升级步骤；API 失败如实报错', async () => {
  _resetSelfEvolutionConfigForTests()
  setSelfEvolutionConfig({ githubToken: 't', githubRepo: 'o/r' })
  
  
  const fetch = mockFetch((url) => {
    if (url.includes('/releases/latest')) {
      return { json: { tag_name: 'v99.0.0', name: 'v99', prerelease: false, draft: false, html_url: 'u', body: '修复若干' } }
    }
    return { ok: false, status: 404 }
  })
  _setGitHubFetchForTests(fetch)
  try {
    const r = await tool('jarvis_release_check').execute({}, EXEC)
    assert.equal(r.hasUpdate, true)
    assert.equal(r.channel, 'stable')
    assert.match(r.verdict, /人工确认/)
    assert.match(r.verdict, /备份/)
  } finally {
    _setGitHubFetchForTests(null)
  }

  const fetchPre = mockFetch((url) => {
    if (url.includes('/releases/latest')) return { json: { tag_name: 'v99.0.0-rc1', prerelease: true, html_url: 'u' } }
    if (url.includes('/releases?')) return { json: [{ tag_name: 'v99.0.0-rc1', prerelease: true, html_url: 'u' }] }
    return { ok: false, status: 404 }
  })
  _setGitHubFetchForTests(fetchPre)
  try {
    const r2 = await tool('jarvis_release_check').execute({}, EXEC)
    assert.equal(r2.hasUpdate, false)
    assert.match(r2.verdict, /prerelease/)
    const r3 = await tool('jarvis_release_check').execute({ channel: 'latest' }, EXEC)
    assert.equal(r3.hasUpdate, true, 'latest 渠道允许 prerelease')
  } finally {
    _setGitHubFetchForTests(null)
  }

  _setGitHubFetchForTests(async () => { throw new Error('网络断开') })
  try {
    const r4 = await tool('jarvis_release_check').execute({}, EXEC)
    assert.match(r4.verdict, /无法检测/)
    assert.ok(!r4.hasUpdate)
  } finally {
    _setGitHubFetchForTests(null)
  }
})

test('TOOLS 注册：3 个自进化工具进 TOOLS 且通过 DSH 契约校验（数量 35，含 GC）', async () => {
  const { TOOLS } = await import('../src/host/tools/index.js')
  for (const n of ['jarvis_report_issue', 'jarvis_issue_sync', 'jarvis_release_check']) {
    assert.ok(TOOLS.some((t) => t.name === n), `${n} 必须注册进 TOOLS`)
  }
  assert.ok(TOOLS.some((t) => t.name === 'jarvis_gc'), 'jarvis_gc 必须注册进 TOOLS')
  assert.equal(TOOLS.length, 35)
  const { TOOL_GROUPS, toolSpecs } = await import('../src/host/state/command.js')
  const grouped = new Set(Object.values(TOOL_GROUPS).flat())
  for (const n of ['jarvis_report_issue', 'jarvis_issue_sync', 'jarvis_release_check', 'jarvis_gc']) {
    assert.ok(grouped.has(n), `${n} 必须在界面分组里（能力台覆盖）`)
  }
  assert.equal(toolSpecs().length, TOOLS.length)
})
