/** DSH 工具契约边界：值级无损归一（sanitize）+ 工具内嵌套调用（invokeNestedTool）。
 *
 *  为什么单独成模块：
 *   · sanitize 是**所有** jarvis_* 工具的返回值边界（38 个工具共用），放进任何单域工具文件都会
 *     变成"只有那个域受保护"；放在 tools/index.js 里会让该文件承担两件事，且不便单测。
 *   · 嵌套调用（jarvis_dispatch_task 内部调 jarvis_member_brief / jarvis_ticket）需要
 *     **正确的 DSH 契约签名**，这个知识只该有一份。
 *
 *  ── 缺陷 1（用户实测 2026-11-27）：`tool "jarvis_ticket" returned invalid output: value is not lossless JSON` ──
 *  DSH 在 dsh-tools/src/pipeline.ts:546 先走 `snapshotToolValue`（= walkJsonValue），
 *  判定口径逐条读到（dsh-util-values/src/index.ts:90-157）：
 *    · `undefined`（任何层级、含对象键值）→ 判失败
 *    · NaN / ±Infinity / -0 → 判失败
 *    · Date / Map / Set / class 实例（非 plain prototype）→ 判失败
 *    · 循环引用 / 数组带额外自有键 → 判失败
 *  `core/tickets.js:61-73` 的 open() 固定产出 `mandate.by` / `mandate.gate` / `meta` / `origin`
 *  四个 undefined 键 → 每次开单都返回值级失败（**开单本身已成功**，只是调用方拿不到结果）。
 *  这是模板级根因：任何按同一风格写的工具都会踩。修在边界，不逐工具改。
 *
 *  ── 缺陷 2（用户实测 2026-11-27）：`Error: Tool batch execution failed` ──
 *  `tools/org.js` 调用 `toolsSvc.execute({ callId, rootCallId, name, arguments, agent, signal })`，
 *  而 DSH 契约为 `execute(ToolBatchInput)`（dsh-tools/src/executor.ts:19-45）：
 *    { calls: ToolCallBlock[], signal, agent?, toolSet?, log?, maxParallelToolCalls? }
 *    ToolCallBlock = { type:'tool-call', id, name, arguments: JSON 字符串 }（dsh-llm/src/types.ts:112-119）
 *  返回 ToolBatchResult { results: [{ callId, result }], additionalContexts, concluded }。
 *  旧签名没有 calls 数组 → batch.ts 的 `input.calls.map` 抛 TypeError → executor.ts:91 包成
 *  `ToolBatchExecutionError('Tool batch execution failed')` —— 这正是日志里那句报错的出处。
 */
/** 归一化的节点预算：防止超大对象把归一化本身变成性能事故（超出即截断并标注）。 */
const MAX_NODES = 200_000
/** 省略哨兵：表示该值不可进 JSON，应当在对象里删键（数组里改 null）。 */
const OMIT = Symbol('jarvis-omit')

/** 是否为「可进 JSON 的普通对象」（Object.prototype 或 null 原型）。 */
function isPlainRecord(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  try {
    const proto = Object.getPrototypeOf(v)
    return proto === Object.prototype || proto === null
  } catch { return false }
}

/** 叶子值归一：返回 JSON 合法值，或 OMIT。 */
function leaf(v) {
  switch (typeof v) {
    case 'undefined':
    case 'function':
    case 'symbol':
      return OMIT                      // DSH 直接拒绝这三类
    case 'bigint':
      return String(v)                 // 降级成字符串，保留信息
    case 'number':
      if (!Number.isFinite(v)) return null          // NaN/±Infinity → JSON 里同样是 null
      if (Object.is(v, -0)) return 0                // -0 是 DSH 明确拒绝的 JSON 不稳定值
      return v
    case 'string':
    case 'boolean':
      return v
    default:
      break
  }
  if (v === null) return null
  // 非 plain 对象：能安全降级的就降级，其余丢弃（不猜语义）
  if (v instanceof Date) { try { return v.toISOString() } catch { return null } }
  if (v instanceof Error) return String(v.message || v.name || 'Error')
  if (v instanceof Map) { try { return toPlain(Object.fromEntries(v)) } catch { return OMIT } }
  if (v instanceof Set) { try { return toPlain([...v]) } catch { return OMIT } }
  if (typeof v.toJSON === 'function') { try { return toPlain(v.toJSON()) } catch { return OMIT } }
  return OMIT
}

/** 小工具：递归归一（供 Map/Set/toJSON 的降级结果使用；这些结果不可能是外层路径上的环）。 */
function toPlain(v) {
  const dropped = []
  return normalizeValue(v, dropped)
}

/** 是否容器（数组或 plain record）——非 plain 对象不深入，交给 leaf 降级。 */
function isContainer(v) {
  return Array.isArray(v) || isPlainRecord(v)
}

/** 容器 → 空壳（与源同类型）。 */
function makeShell(v) {
  return Array.isArray(v) ? [] : {}
}

/** 容器的键序列（数组用索引，稀疏空洞也会列出以便补 null）。 */
function keysOf(v) {
  if (Array.isArray(v)) {
    const out = []
    for (let i = 0; i < v.length; i += 1) out.push(i)
    return out
  }
  return Object.keys(v)
}

/**
 * 核心归一：迭代遍历（不递归，避免深对象爆栈），基于「祖先集」检测环。
 * 同一对象在不同分支重复出现（菱形引用）不算环——只有回到当前路径上的祖先才算。
 * @param {unknown} root
 * @param {string[]} dropped 收集被删/降级的路径（供留痕）
 * @returns {unknown} 纯 JSON 值；若整体不可保留返回 OMIT
 */
function normalizeValue(root, dropped) {
  if (!isContainer(root)) return leaf(root)
  let nodes = 0
  const ancestors = new Set()
  const rootOut = makeShell(root)
  ancestors.add(root)
  const frames = [{ src: root, dst: rootOut, keys: keysOf(root), i: 0, isArr: Array.isArray(root) }]
  while (frames.length) {
    const f = frames[frames.length - 1]
    if (f.i >= f.keys.length) {
      ancestors.delete(f.src)
      frames.pop()
      continue
    }
    nodes += 1
    if (nodes > MAX_NODES) {
      f.dst.__truncated = true
      f.i = f.keys.length
      continue
    }
    const k = f.keys[f.i]
    f.i += 1
    const v = f.src[k]
    if (!isContainer(v)) {
      const lv = leaf(v)
      if (lv === OMIT) {
        if (f.isArr) f.dst[k] = null
        else dropped.push(String(k))
        continue
      }
      f.dst[k] = lv
      continue
    }
    if (ancestors.has(v)) {
      f.dst[k] = '[Circular]'
      dropped.push(String(k) + '（循环引用）')
      continue
    }
    const shell = makeShell(v)
    f.dst[k] = shell
    ancestors.add(v)
    frames.push({ src: v, dst: shell, keys: keysOf(v), i: 0, isArr: Array.isArray(v) })
  }
  return rootOut
}

/**
 * 工具返回值归一 + 失败留痕。永不抛。
 * @param {unknown} value 工具 execute 的原始返回值
 * @param {string} toolName 用于留痕文案
 * @returns {unknown} 可进 lossless JSON 的值
 */
export function sanitizeToolValue(value, toolName) {
  const dropped = []
  let out
  try {
    out = normalizeValue(value, dropped)
  } catch (e) {
    // 归一本身崩了（极端 getter/Proxy）：给明确失败占位，而不是让整次调用炸
    return { ok: false, verdict: `⚠️ 结果无法序列化（工具 ${toolName}）：${String((e && e.message) || e)}——请报告此问题；工具执行本身可能已成功。` }
  }
  // 整体被丢弃（execute 返回 undefined/函数等）→ 给最小合法对象，保住 ok/verdict 语义
  if (out === OMIT || out === undefined) {
    return { ok: false, verdict: `⚠️ 工具 ${toolName} 未返回任何值（execute 返回 undefined 或不可序列化值）——下游拿不到结果，请检查该工具实现。` }
  }
  // 留痕：被删/降级的字段（只记前 8 个，避免把返回体撑大）
  if (dropped.length) {
    const note = `已剥离 ${dropped.length} 个不可序列化字段或循环引用（${dropped.slice(0, 8).join('、')}${dropped.length > 8 ? '…' : ''}）——DSH 要求工具返回值必须是 lossless JSON，否则整次调用被判失败`
    if (isPlainRecord(out) && !Object.prototype.hasOwnProperty.call(out, 'sanitized')) out.sanitized = note
  }
  return out
}

/**
 * 工具内嵌套调用（一次一个子调用）。永不抛。
 *
 * 支持的宿主形态：
 *  ① 真实 DSH：toolsSvc.execute({ calls:[{type:'tool-call', id, name, arguments}], signal, agent }) → ToolBatchResult
 *  ② 简易桩：存在 executeTool(name, args, ctx) → 单结果
 *  ③ 旧形态兜底：execute 直接吃单调用 { callId, name, arguments, agent, signal } → 单结果（同步返回时）
 *
 * @param {object} toolsSvc 宿主工具服务
 * @param {{ name:string, args?:object, agent?:any, signal?:AbortSignal, callId?:string }} req
 * @returns {Promise<{isError:boolean, value:any, error:string, content:any[]}>}
 */
export async function invokeNestedTool(toolsSvc, req) {
  const name = String((req && req.name) || '')
  const args = (req && req.args && typeof req.args === 'object') ? req.args : {}
  const signal = (req && req.signal) || new AbortController().signal
  const callId = String((req && req.callId) || `jarvis-nested-${name}-${Date.now().toString(36)}`)
  const agent = req && req.agent
  if (!name) return nestedFail('嵌套调用缺少工具名')
  if (!toolsSvc || (typeof toolsSvc.execute !== 'function' && typeof toolsSvc.executeTool !== 'function')) {
    return nestedFail('宿主没有 tools.execute，工具内嵌套调用不可用')
  }
  // 形态②：显式单工具入口（测试桩常用）
  if (typeof toolsSvc.execute !== 'function' && typeof toolsSvc.executeTool === 'function') {
    try {
      return coerceResult(await toolsSvc.executeTool(name, args, { agent, signal }))
    } catch (e) {
      return nestedFail(errText(e))
    }
  }
  // 形态①：DSH batch 契约（真实宿主）
  // 说明：同时附带 name/arguments（**契约外的冗余字段**）——真实 DSH 只读 calls，
  // 忽略多余字段；而"只认单调用形态"的测试桩/旧宿主能直接读到 name/arguments。
  // 这样既不违反契约、又不必为了兼容去发两次调用（双发会导致 jarvis_ticket 开两张单）。
  try {
    const batch = await toolsSvc.execute({
      calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
      signal,
      name,
      arguments: args,
      ...(agent !== undefined ? { agent } : {}),
    })
    // execute 直接返回单结果（兼容桩）：没有 results 数组但本身就是 {isError,...}
    if (batch && !Array.isArray(batch.results) && ('isError' in batch || 'content' in batch || 'value' in batch)) {
      return coerceResult(batch)
    }
    const first = batch && Array.isArray(batch.results) ? batch.results[0] : undefined
    if (!first) return nestedFail('嵌套调用没有返回结果（batch.results 为空）')
    return coerceResult(first.result)
  } catch (e) {
    return nestedFail(errText(e), e)
  }
}

/** 统一宿主结果形态 → {isError, value, error, content}。 */
function coerceResult(r) {
  if (!r || typeof r !== 'object') return { isError: false, value: r, error: '', content: [] }
  const isError = Boolean(r.isError)
  const content = Array.isArray(r.content) ? r.content : []
  const error = isError
    ? String((r.error && (r.error.message || r.error.code)) || (typeof r.error === 'string' ? r.error : '') || textOf(content) || '工具执行失败')
    : ''
  return { isError, value: r.value, error, content }
}

function nestedFail(msg, cause) {
  const chain = []
  let c = cause
  for (let i = 0; c && i < 4; i += 1) { chain.push(String((c && c.message) || c)); c = c && c.cause }
  return { isError: true, value: undefined, error: chain.length ? `${msg} ← ${chain.join(' ← ')}` : msg, content: [] }
}

function textOf(content) {
  try {
    return (content || []).map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n').slice(0, 4000)
  } catch { return '' }
}

function errText(e) {
  const parts = []
  let c = e
  for (let i = 0; c && i < 4; i += 1) { parts.push(String((c && c.message) || c)); c = c && c.cause }
  return parts.join(' ← ') || '未知错误'
}
