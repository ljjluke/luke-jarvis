#!/usr/bin/env node
/** 工具契约 + 挂载集成验证：在**真实** @deepseek-ai/dsh-tools 的 ToolRuntime 上跑两件事。
 *
 *  ① 直接注册 TOOLS：用宿主自己的 `tools.register`（会校验 output.render / schema）与
 *     `tools.schemas()`（模型真正看到的工具表），抓「定义形状不对、注册期就炸」。
 *  ② 走真实 `apply(ctx)`：只把宿主服务换成最小桩，验证插件挂载后工具确实进注册表
 *     （这一步能抓「apply 里拿工具的方式/时机不对」）。
 *
 *  背景：单测直接调 `tool.execute(...)`，绕过了宿主注册管线，不能证明「装进 DSH 能用」。
 *
 *  运行：node scripts/verify-tool-contract.mjs
 *  依赖：仓库把 @deepseek-ai/dsh-tools 软链到本机 dsh 安装（本地开发环境）；
 *       找不到时打印 SKIP 并退出 0（干净环境/CI 不因缺宿主而红）。
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

function resolveHost() {
  try {
    const toolsEntry = require.resolve('@deepseek-ai/dsh-tools')
    const pkgDir = dirname(dirname(toolsEntry))
    const nodeModules = dirname(dirname(pkgDir))
    return { cordis: join(nodeModules, '@deepseek-ai/cordis/lib/index.js'), tools: toolsEntry }
  } catch {
    return null
  }
}

const host = resolveHost()
if (!host) {
  console.log('SKIP: 未解析到 @deepseek-ai/dsh-tools（干净环境），跳过宿主契约验证')
  process.exit(0)
}

const { Context, Service } = await import('file://' + host.cordis)
const { default: ToolRuntime } = await import('file://' + host.tools)
const { TOOLS, apply } = await import('../src/host/plugin.js')

/** 最小 systemPrompt 服务：ToolRuntime 只用它的 tools()/section() 挂钩。 */
class SystemPromptStub extends Service {
  constructor(ctx) { super(ctx, 'systemPrompt', true) }
  section() { return () => {} }
  tools(cb) { try { cb({ scope: undefined }) } catch { /* 桩：不渲染提示词 */ } return () => {} }
}
class WebServerStub extends Service {
  constructor(ctx) { super(ctx, 'webServer', true) }
  register() { return () => {} }
}
class AgentsStub extends Service {
  constructor(ctx) { super(ctx, 'agents', true) }
  list() { return [] }
  get() { return undefined }
}
class CommandsStub extends Service {
  constructor(ctx) { super(ctx, 'commands', true) }
  register() { return () => {} }
}

const problems = []

// ── ① 直接注册 + 真实执行 ─────────────────────────────────────────────────
const ctx1 = new Context()
new SystemPromptStub(ctx1)
const runtime = new ToolRuntime(ctx1, {})
const disposers = []
for (const tool of TOOLS) {
  try {
    disposers.push(runtime.register(tool))
  } catch (e) {
    problems.push(`register 失败 ${tool.name}: ${e.message}`)
  }
}

const schemas = runtime.schemas()
if (schemas.length !== TOOLS.length) problems.push(`schemas 数量 ${schemas.length} ≠ 工具数 ${TOOLS.length}`)
for (const s of schemas) {
  if (!s.name || !s.description) problems.push(`schema 缺 name/description: ${JSON.stringify(s.name)}`)
  if (!s.parameters || s.parameters.type !== 'object') problems.push(`schema 参数根不是 object: ${s.name}`)
}

const probe = TOOLS.find((t) => t.name === 'jarvis_project')
if (!probe) {
  problems.push('找不到 jarvis_project（工具表被改坏？）')
} else {
  const exec = { callId: 'contract-probe', name: probe.name, arguments: {}, signal: new AbortController().signal }
  const value = await probe.execute({ requirement: '帮一家电商做私域复购工具' }, exec)
  const blocks = probe.output.render({}, value)
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks[0].type !== 'text') problems.push('render 未返回 ContentBlock[]')
  if (!value || !value.suggestion) problems.push('jarvis_project 未返回 suggestion（execute 契约异常）')
}
disposers.forEach((d) => d())
if (runtime.schemas().length !== 0) problems.push('disposer 未注销工具')

// ── ② 真实 apply(ctx) 挂载 ───────────────────────────────────────────────
const ctx2 = new Context()
new SystemPromptStub(ctx2)
new CommandsStub(ctx2)
new AgentsStub(ctx2)
new WebServerStub(ctx2)
const runtime2 = new ToolRuntime(ctx2, {})
try {
  apply(ctx2)
  await new Promise((r) => setTimeout(r, 120))
  const mounted = runtime2.schemas()
  if (mounted.length !== TOOLS.length) problems.push(`apply(ctx) 后注册工具数 ${mounted.length} ≠ ${TOOLS.length}`)
} catch (e) {
  problems.push(`apply(ctx) 抛错: ${e.message}`)
}

if (problems.length > 0) {
  console.error('TOOL-CONTRACT-FAIL')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(
  `TOOL-CONTRACT-OK（真实 ToolRuntime：直接注册 ${TOOLS.length} / apply 挂载 ${runtime2.schemas().length} / execute+render 通过）`,
)
process.exit(0)
