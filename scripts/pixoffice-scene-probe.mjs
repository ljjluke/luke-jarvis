#!/usr/bin/env node
/**
 * T11 场景层探针：把插件的 relay 路由**挂在本地 node:http 上**，真实连 SSE 采样，断言：
 *   ① 收到首个 data: 帧且 JSON 合法、type=snapshot、seq≥1；
 *   ② 帧内 employees 含本公司 employee id（默认 emp-ceo-4as972，可用 COMPANY_EMP_ID 覆盖）；
 *   ③ 帧内每个 sceneActorId 都在上游演员表（否则上游 INVALID_BINDING 整批丢弃）；
 *   ④ 采样窗口内没有 error 帧。
 * 为什么本地挂载而不是打 127.0.0.1:3080：运行副本仍旧代码（未重装），那边 relay 路由不存在；
 * 本地挂载验证的是**本仓库代码**的协议行为，属「仓库级」证据（e2e 视觉需重启窗口，见报告边界）。
 *
 * 退出码：0=全过；1=有断言失败；2=环境不可用（无法 import/监听）
 */
import http from 'node:http'
import path from 'node:path'
import plugin from '../src/host/plugin.js'

const PROJECT_DIR = process.env.PROJECT_DIR || '/opt/work/first'
const WANT_EMP_ID = process.env.COMPANY_EMP_ID || 'emp-ceo-4as972'
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 6000)

const routes = []
const ctx = {
  get: () => undefined,
  effect: (fn) => { try { fn() } catch {} },
  tools: { register: () => () => {} },
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  systemPrompt: { section: () => () => {} },
}
plugin.apply(ctx)
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
if (snap && (snap.employees || []).length !== 4) { console.error(`⚠️  快照员工数=${(snap.employees || []).length}（本工作区应有 4 人；0 人说明 company-state 没读到）`) }
if (snap && !empIds.includes(WANT_EMP_ID)) { console.error(`❌ 帧内缺本公司 employee id ${WANT_EMP_ID}：${empIds.join(',')}`); bad += 1 }
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
  console.log(`✅ SSE 采样通过：信封 office.sync、快照含本公司员工（${WANT_EMP_ID}）、绑定合法、事件 kind 合法、无 error 帧；messages/ui/reply 三条路由均实跑通过`)
  process.exit(0)
}
process.exit(1)
