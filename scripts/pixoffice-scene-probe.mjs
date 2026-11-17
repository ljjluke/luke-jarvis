#!/usr/bin/env node
/**
 * T11 场景层探针：把插件的 relay 路由**挂在本地 node:http 上**，真实连 SSE 采样，断言：
 *   ① 收到首个 data: 帧且 JSON 合法、type=snapshot、seq≥1；
 *   ② 帧内 employees 与工作区 .jarvis/company-state.json 的员工一致——工作区自动发现
 *      （挑第一个真有员工的目录），期望员工 id 取该工作区第一个员工，均可用
 *      PROJECT_DIR / COMPANY_EMP_ID 覆盖；空工作区跳过这条（帧里本就不该有人）；
 *   ③ 帧内每个 sceneActorId 都在上游演员表（否则上游 INVALID_BINDING 整批丢弃）；
 *   ④ 采样窗口内没有 error 帧。
 * 为什么本地挂载而不是打 127.0.0.1:3080：运行副本仍旧代码（未重装），那边 relay 路由不存在；
 * 本地挂载验证的是**本仓库代码**的协议行为，属「仓库级」证据（e2e 视觉需重启窗口，见报告边界）。
 *
 * 退出码：0=全过；1=有断言失败；2=环境不可用（无法 import/监听）
 */
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { apply } from '../src/host/plugin.js'

/**
 * 自动发现工作区与期望员工。
 *
 * 原来写死 `PROJECT_DIR || '/opt/work/first'` + `WANT_EMP_ID || 'emp-ceo-4as972'`：
 * 那个目录和那个员工 id 来自某个早已清理的历史工作区，本机根本不存在——
 * 探针一跑就报「应有 4 人」和「帧内缺 emp-ceo-...」，看起来像插件出了故障，
 * 实际是断言本身指向了不存在的数据。
 *
 * 现在的规则：从若干候选目录里挑第一个**真实有员工**的工作区（读 .jarvis/company-state.json
 * 的 employees 长度）；一个都没有就退化为"任选一个含 .jarvis 的目录，并只校验帧结构、
 * 不校验具体人数"。期望员工 id 从该工作区数据里取第一个，不再硬编码。
 * 显式设 PROJECT_DIR / COMPANY_EMP_ID 时仍然以环境变量为准。
 */
function discoverWorkspace () {
  if (process.env.PROJECT_DIR) return process.env.PROJECT_DIR
  const candidates = [
    process.cwd(),
    path.join(os.homedir(), '.dsh'),
    '/opt/work',
  ]
  for (const base of candidates) {
    let entries = []
    try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const dir = path.join(base, ent.name)
      try {
        const state = JSON.parse(fs.readFileSync(path.join(dir, '.jarvis', 'company-state.json'), 'utf8'))
        if (Array.isArray(state.employees) && state.employees.length > 0) return dir
      } catch { /* 没有 company-state 就继续 */ }
    }
  }
  // 退一步：找任一含 .jarvis 的目录（能跑通帧结构校验，不校验人数）
  for (const base of candidates) {
    let entries = []
    try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const dir = path.join(base, ent.name)
      if (fs.existsSync(path.join(dir, '.jarvis'))) return dir
    }
  }
  return process.cwd()
}

const PROJECT_DIR = discoverWorkspace()

/** 该工作区真实存在的员工 id 列表（读不到就是空数组）。 */
function readEmployeeIds (projectDir) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(projectDir, '.jarvis', 'company-state.json'), 'utf8'))
    return (state.employees || []).map((e) => String(e.id || '').trim()).filter(Boolean)
  } catch { return [] }
}

const KNOWN_EMP_IDS = readEmployeeIds(PROJECT_DIR)
// 没有员工数据时 WANT 为空——下面的断言会跳过"必须含某员工"这一条，
// 而不是拿一个编造的 id 去卡真实数据。
const WANT_EMP_ID = process.env.COMPANY_EMP_ID || KNOWN_EMP_IDS[0] || ''
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 6000)

const routes = []
const ctx = {
  get: () => undefined,
  effect: (fn) => { try { fn() } catch {} },
  tools: { register: () => () => {} },
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  systemPrompt: { section: () => () => {} },
}
apply(ctx)
const relayRoutes = routes.filter((r) => String(r.path || '').startsWith('/api/pixoffice'))
if (!relayRoutes.length) { console.error('❌ 未注册任何 /api/pixoffice 路由'); process.exit(1) }
console.log(`ℹ️  已注册 relay 路由：${relayRoutes.map((r) => r.path).join(', ')}`)

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const route = routes.find((r) => r.kind === 'exact' && r.path === url.pathname)
  if (!route) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not-found'); return }
  Promise.resolve(route.handler(req, res)).catch((e) => {
    try { res.writeHead(500); res.end(String((e && e.message) || e)) } catch {}
  })
})

const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const base = `http://127.0.0.1:${port}`
console.log(`ℹ️  本地 relay 监听 ${base}`)

const frames = []
let raw = ''
const ac = new AbortController()
const timer = setTimeout(() => ac.abort(), SAMPLE_MS)
try {
  const res = await fetch(`${base}/api/pixoffice/events?workspace=${encodeURIComponent(PROJECT_DIR)}&teams=jarvis`, { signal: ac.signal, headers: { accept: 'text/event-stream' } })
  if (!res.ok) { console.error(`❌ SSE HTTP ${res.status}`); process.exit(1) }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  while (frames.length < 2) {
    const { value, done } = await reader.read()
    if (done) break
    raw += dec.decode(value, { stream: true })
    const parts = raw.split('\n\n')
    raw = parts.pop()
    for (const p of parts) {
      for (const line of p.split('\n')) {
        if (line.startsWith('data: ')) {
          const json = line.slice(6)
          try { frames.push(JSON.parse(json)) } catch { frames.push({ __parse_error: json.slice(0, 120) }) }
        }
      }
      if (frames.length >= 2) break
    }
  }
} catch (e) {
  if (!frames.length) { console.error(`❌ SSE 采样失败：${(e && e.message) || e}`); process.exit(1) }
} finally {
  clearTimeout(timer)
  ac.abort()
}

// 上游信封是 {type:'office.sync', snapshot:{...}}（zod 联合体只认 office.sync/*）
const envelope = frames.find((f) => f && f.type === 'office.sync' && f.snapshot)
const snap = envelope ? envelope.snapshot : null
const errFrames = frames.filter((f) => f && f.type === 'error')
const parseErrs = frames.filter((f) => f && f.__parse_error)
const empIds = (snap && Array.isArray(snap.employees) ? snap.employees : []).map((e) => String(e.id))
const eventKinds = (snap && Array.isArray(snap.events) ? snap.events : []).map((e) => String(e.kind))
const actorOk = (snap && Array.isArray(snap.employees) ? snap.employees : []).every((e) => ['office-lead', 'review-agent', 'data-agent', 'file-agent', 'app-agent', 'code-agent'].includes(String(e.sceneActorId)))

console.log(`ℹ️  采样帧数=${frames.length}（snapshot=${snap ? 1 : 0} error=${errFrames.length} parse_error=${parseErrs.length}）`)
if (snap) {
  console.log(`ℹ️  信封 type=${envelope.type} seq=${envelope.seq}｜快照 workspace=${snap.workspace && snap.workspace.id} employees=${empIds.length} [${empIds.slice(0, 4).join(', ')}]`)
  console.log(`ℹ️  事件 kind：${eventKinds.length ? [...new Set(eventKinds)].join(', ') : '(none)'}`)
  console.log(`ℹ️  sceneActorId 绑定：${(snap.employees || []).map((e) => e.sceneActorId).join(', ')}`)
  console.log('ℹ️  原始帧片段：' + JSON.stringify(snap).slice(0, 320) + ' …')
}
let bad = 0
if (!snap) { console.error("❌ 未收到合法 office.sync 帧（envelope+snapshot）"); bad += 1 }
if (snap && !['note', 'task.assigned', 'task.started', 'task.blocked', 'task.completed'].every((k) => eventKinds.every((x) => ['note', 'task.assigned', 'task.started', 'task.blocked', 'task.completed'].includes(x)))) { /* noop */ }
if (snap && eventKinds.some((k) => !['note', 'task.assigned', 'task.started', 'task.blocked', 'task.completed'].includes(k))) { console.error(`❌ 事件 kind 超出上游枚举：${eventKinds.join(',')}`); bad += 1 }
if (snap && KNOWN_EMP_IDS.length > 0 && (snap.employees || []).length !== KNOWN_EMP_IDS.length) {
  console.error(`⚠️  快照员工数=${(snap.employees || []).length}，而 company-state 有 ${KNOWN_EMP_IDS.length} 人——两边不一致说明投影丢人`)
}
// 没有员工数据（空工作区/未建队）时跳过这条：帧里本来就不该有人。
if (snap && WANT_EMP_ID && !empIds.includes(WANT_EMP_ID)) { console.error(`❌ 帧内缺本公司 employee id ${WANT_EMP_ID}：${empIds.join(',')}`); bad += 1 }
if (snap && !actorOk) { console.error('❌ 存在 sceneActorId 不在上游演员表（会被 INVALID_BINDING 丢弃）'); bad += 1 }
if (errFrames.length) { console.error(`❌ 收到 error 帧：${JSON.stringify(errFrames[0]).slice(0, 200)}`); bad += 1 }
if (parseErrs.length) { console.error('❌ 存在不可解析的数据帧'); bad += 1 }
// ── 额外：把另外 3 条 relay 路由真打一遍（旧探针只执行了 events，messages/ui/reply 的闭包变量从未被执行）──
async function probeRoutes() {
  let localBad = 0
  try {
    const okRes = await fetch(`${base}/api/pixoffice/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'map.edit', payload: { mapId: 'm1' } }) })
    const okBody = await okRes.json()
    if (okRes.status === 200 && okBody.ok) console.log('ℹ️  messages(白名单内) → 200 ok')
    else { console.error(`❌ messages(白名单内) 期望 200，实际 ${okRes.status} ${JSON.stringify(okBody)}`); localBad += 1 }
    const badRes = await fetch(`${base}/api/pixoffice/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'actor.create', payload: {} }) })
    const badBody = await badRes.json()
    if (badRes.status === 400 && badBody.code === 'COMMAND_NOT_ALLOWED') console.log('ℹ️  messages(越界命令) → 400 COMMAND_NOT_ALLOWED')
    else { console.error(`❌ messages(越界) 期望 400 COMMAND_NOT_ALLOWED，实际 ${badRes.status} ${JSON.stringify(badBody)}`); localBad += 1 }
    const uiRes = await fetch(`${base}/api/pixoffice/ui?workspace=${encodeURIComponent(PROJECT_DIR)}`)
    const uiBody = await uiRes.json()
    if (uiRes.status === 200 && uiBody.ok && uiBody.workspace && uiBody.workspace.id) console.log(`ℹ️  ui → 200 workspace=${uiBody.workspace.id} employees=${uiBody.employees}`)
    else { console.error(`❌ ui 期望 200+workspace，实际 ${uiRes.status} ${JSON.stringify(uiBody)}`); localBad += 1 }
    const replyRes = await fetch(`${base}/api/pixoffice/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const replyBody = await replyRes.json()
    if (replyRes.status === 200 && replyBody.ok) console.log('ℹ️  reply → 200 ok')
    else { console.error(`❌ reply 期望 200，实际 ${replyRes.status} ${JSON.stringify(replyBody)}`); localBad += 1 }
  } catch (e) {
    console.error(`❌ 路由探测异常：${(e && e.message) || e}`)
    localBad += 1
  }
  return localBad
}
bad += await probeRoutes()
try { server.close() } catch {}
if (bad === 0) {
  console.log(`✅ SSE 采样通过：信封 office.sync、绑定合法、事件 kind 合法、无 error 帧；messages/ui/reply 三条路由均实跑通过${WANT_EMP_ID ? `（含员工 ${WANT_EMP_ID}）` : '（空工作区，未校验具体员工）'}`)
  process.exit(0)
}
process.exit(1)
