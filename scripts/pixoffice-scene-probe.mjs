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
  server.close()
}

const snap = frames.find((f) => f && f.type === 'snapshot')
const errFrames = frames.filter((f) => f && f.type === 'error')
const parseErrs = frames.filter((f) => f && f.__parse_error)
const empIds = (snap && Array.isArray(snap.employees) ? snap.employees : []).map((e) => String(e.id))
const actorOk = (snap && Array.isArray(snap.employees) ? snap.employees : []).every((e) => ['office-lead', 'review-agent', 'data-agent', 'file-agent', 'app-agent', 'code-agent'].includes(String(e.sceneActorId)))

console.log(`ℹ️  采样帧数=${frames.length}（snapshot=${snap ? 1 : 0} error=${errFrames.length} parse_error=${parseErrs.length}）`)
if (snap) {
  console.log(`ℹ️  快照片段：seq=${snap.seq} workspace=${snap.workspace && snap.workspace.id} employees=${empIds.length} [${empIds.slice(0, 4).join(', ')}]`)
  console.log(`ℹ️  sceneActorId 绑定：${(snap.employees || []).map((e) => e.sceneActorId).join(', ')}`)
  console.log('ℹ️  原始帧片段：' + JSON.stringify(snap).slice(0, 320) + ' …')
}
let bad = 0
if (!snap) { console.error('❌ 未收到合法 snapshot 帧'); bad += 1 }
if (snap && !empIds.includes(WANT_EMP_ID)) { console.error(`❌ 帧内缺本公司 employee id ${WANT_EMP_ID}：${empIds.join(',')}`); bad += 1 }
if (snap && !actorOk) { console.error('❌ 存在 sceneActorId 不在上游演员表（会被 INVALID_BINDING 丢弃）'); bad += 1 }
if (errFrames.length) { console.error(`❌ 收到 error 帧：${JSON.stringify(errFrames[0]).slice(0, 200)}`); bad += 1 }
if (parseErrs.length) { console.error('❌ 存在不可解析的数据帧'); bad += 1 }
if (bad === 0) {
  console.log(`✅ SSE 采样通过：快照含本公司员工（${WANT_EMP_ID}）、绑定合法、无 error 帧`)
  process.exit(0)
}
process.exit(1)
