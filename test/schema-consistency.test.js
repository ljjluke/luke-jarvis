/** 工具输出 schema 一致性回归测试（v0.22）。
 *
 *  用户实测（2026-11-25）：
 *    Error: tool "jarvis_member_brief" returned invalid output:
 *           "value.executionPrompt" is not a declared property (additionalProperties: false)
 *
 *  根因：output.schema 声明了 additionalProperties:false，但 execute 实际返回了未声明的字段。
 *  DSH 在工具返回后做 schema 校验 → 整个调用被判失败（副作用可能已发生，最坏的组合）。
 *
 *  这类 bug 的可怕之处：execute 写得完全正确、功能正常，但调用方永远拿不到结果，
 *  而且报错信息看起来像"工具坏了"，排查方向会被带偏。
 *
 *  本测试做**全量扫描**：所有 additionalProperties:false 的工具，实际返回字段必须
 *  全部在 schema 里声明。新加字段忘了声明 → 这里立刻红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = new URL('../src/host/', import.meta.url).pathname

function listJs(dir) {
  const out = []
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    if (fs.statSync(p).isDirectory()) out.push(...listJs(p))
    else if (n.endsWith('.js')) out.push(p)
  }
  return out
}

/** 解析 object 字面量的顶层键（depth==1 处、冒号前的标识符）。 */
function objectKeys(src, openIdx) {
  let d = 0
  const keys = []
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{' || ch === '[' || ch === '(') d += 1
    else if (ch === '}' || ch === ']' || ch === ')') { d -= 1; if (d === 0) return { end: i, keys } }
    else if (d === 1 && ch === ':') {
      let j = i - 1
      while (j >= 0 && /\s/.test(src[j])) j -= 1
      let k = j
      while (k >= 0 && /[A-Za-z0-9_]/.test(src[k])) k -= 1
      const id = src.slice(k + 1, j + 1)
      if (id && !/^\d/.test(id)) keys.push(id)
    }
  }
  return { end: src.length, keys }
}

/** 扫描所有工具块，返回不一致清单。 */
function scanInconsistencies() {
  const findings = []
  for (const file of listJs(ROOT)) {
    const src = fs.readFileSync(file, 'utf8')
    const re = /name:\s*'([A-Za-z_]+)'/g
    const marks = []
    let m
    while ((m = re.exec(src))) marks.push({ name: m[1], at: m.index })
    for (let i = 0; i < marks.length; i += 1) {
      const start = marks[i].at
      const end = i + 1 < marks.length ? marks[i + 1].at : src.length
      const block = src.slice(start, end)
      if (!/additionalProperties:\s*false/.test(block)) continue
      const outI = block.indexOf('output:')
      const exI = block.indexOf('execute:')
      if (outI < 0 || exI < 0 || exI < outI) continue
      const schemaPart = block.slice(outI, exI)
      const pi = schemaPart.indexOf('properties:')
      if (pi < 0) continue
      const brace = schemaPart.indexOf('{', pi)
      if (brace < 0) continue
      const decl = objectKeys(schemaPart, brace).keys
      if (!decl.length) continue
      // execute 体内所有 return { ... } 的顶层键
      const execPart = block.slice(exI)
      const retKeys = []
      const rr = /return\s*\{/g
      let rm
      while ((rm = rr.exec(execPart))) {
        const open = rm.index + rm[0].length - 1
        const res = objectKeys(execPart, open)
        if (res.keys.length >= 2) for (const k of res.keys) if (!retKeys.includes(k)) retKeys.push(k)
      }
      // 过滤噪声：布尔字面量/关键字被误当键（如 `ok: true` 里的 true 不会出现，但 `, true:` 可能）
      const noise = new Set(['true', 'false', 'undefined', 'null'])
      const extra = retKeys.filter((k) => !decl.includes(k) && !noise.has(k))
      if (extra.length) findings.push({ tool: marks[i].name, file: path.relative(ROOT, file), extra })
    }
  }
  return findings
}

test('所有 additionalProperties:false 的工具：返回字段必须全部在 schema 中声明', () => {
  const findings = scanInconsistencies()
  assert.deepStrictEqual(
    findings, [],
    findings.length
      ? `以下工具的 execute 返回了未声明字段（会导致 "is not a declared property"）：\n` +
        findings.map((f) => `  ${f.tool} (${f.file}) → 多出: ${f.extra.join(', ')}`).join('\n')
      : ''
  )
})

test('jarvis_member_brief 必须声明 executionPrompt（用户实测报错的直接原因）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/review.js'), 'utf8')
  const block = src.slice(src.indexOf("name: 'jarvis_member_brief'"))
  const schemaPart = block.slice(0, block.indexOf('execute:'))
  assert.ok(/executionPrompt:\s*\{\s*type:\s*'string'/.test(schemaPart),
    'executionPrompt 必须出现在 output.schema.properties 里（execute 确实会返回它）')
})

test('jarvis_member_brief 必须声明 broadcast/audit 分支的返回字段', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/review.js'), 'utf8')
  const block = src.slice(src.indexOf("name: 'jarvis_member_brief'"))
  const schemaPart = block.slice(0, block.indexOf('execute:'))
  for (const k of ['protocolRefresh', 'members', 'broadcast', 'hint', 'ok', 'total']) {
    assert.ok(new RegExp(`^\\s*${k}:\\s*\\{`, 'm').test(schemaPart),
      `mode=broadcast/audit 会返回 ${k}，必须声明（否则那两种模式一调用就报 invalid output）`)
  }
})

test('jarvis_meeting 必须声明群聊分支返回字段', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/org.js'), 'utf8')
  const block = src.slice(src.indexOf("name: 'jarvis_meeting'"), src.indexOf("name: 'jarvis_company'"))
  const schemaPart = block.slice(0, block.indexOf('execute:'))
  for (const k of ['verdict', 'ok', 'thread', 'meetingStatus', 'mustEvaluate', 'convergeRule']) {
    assert.ok(new RegExp(`^\\s*${k}:\\s*\\{`, 'm').test(schemaPart), `群聊会议返回 ${k}，必须声明`)
  }
})

test('jarvis_gc / jarvis_company 的边界字段已声明', () => {
  const gcSrc = fs.readFileSync(path.join(ROOT, 'tools/gc.js'), 'utf8')
  const gcSchema = gcSrc.slice(gcSrc.indexOf("name: 'jarvis_gc'"))
  const gcSchemaPart = gcSchema.slice(0, gcSchema.indexOf('execute:'))
  for (const k of ['skippedReason', 'at', 'error']) {
    assert.ok(new RegExp(`^\\s*${k}:\\s*\\{`, 'm').test(gcSchemaPart), `jarvis_gc 返回 ${k}，必须声明`)
  }
  const orgSrc = fs.readFileSync(path.join(ROOT, 'tools/org.js'), 'utf8')
  const coBlock = orgSrc.slice(orgSrc.indexOf("name: 'jarvis_company'"), orgSrc.indexOf("name: 'jarvis_dispatch_task'"))
  const coSchema = coBlock.slice(0, coBlock.indexOf('execute:'))
  assert.ok(/node:\s*\{\s*type:\s*'object'/.test(coSchema), 'jarvis_company 返回 node，必须声明')
})

// ── 运行时验证（比静态扫描可靠）：直接调用，检查真实返回值 ──────────
// 静态扫描靠正则解析源码，会被三元表达式/条件展开误判（如 `runId: claimed ?? undefined`
// 曾被读成字段名 "undefined"）。运行时验证直接看真实对象，没有解析歧义。
test('运行时：jarvis_ponder_check 各分支返回值无未声明字段、无 undefined 值', async () => {
  const { TOOLS } = await import('../src/host/plugin.js')
  const t = TOOLS.find((x) => x.name === 'jarvis_ponder_check')
  assert.ok(t, 'jarvis_ponder_check 必须存在')
  const declared = Object.keys(t.output.schema.properties || {})

  // 三个分支：不传 runId / 传 runId / 指向不存在的数据目录
  const cases = [
    { label: '不传 runId', args: { dataDir: '/tmp/definitely-no-run-here' } },
    { label: '传 runId', args: { runId: 'claimed-run-id', dataDir: '/tmp/definitely-no-run-here' } },
  ]
  for (const c of cases) {
    const out = await t.execute(c.args)
    const actual = Object.keys(out || {})
    const extra = actual.filter((k) => !declared.includes(k))
    const undefVals = Object.entries(out || {}).filter(([, v]) => v === undefined).map(([k]) => k)
    assert.deepStrictEqual(extra, [], `${c.label}：返回了未声明字段 ${extra.join(', ')}（会触发 invalid output）`)
    assert.deepStrictEqual(undefVals, [], `${c.label}：字段值为 undefined ${undefVals.join(', ')}（契约应为空串/false/null）`)
    // runId 声明是 string，就必须永远是 string
    assert.equal(typeof out.runId, 'string', `${c.label}：runId 必须是 string，实际 ${typeof out.runId}`)
    // runIdMatch 声明是 boolean，就必须永远是 boolean
    assert.equal(typeof out.runIdMatch, 'boolean', `${c.label}：runIdMatch 必须是 boolean，实际 ${typeof out.runIdMatch}`)
  }
})

test('运行时：未声称 runId 时，action 必须说明 runIdMatch=false 是"无法比对"而非"不匹配"', async () => {
  const { TOOLS } = await import('../src/host/plugin.js')
  const t = TOOLS.find((x) => x.name === 'jarvis_ponder_check')
  const out = await t.execute({ dataDir: '/tmp/definitely-no-run-here' })
  if (out.runIdMatch === false) {
    assert.ok(/未传 runId/.test(String(out.action)), '未传 runId 时 action 必须说明这一点，避免调用方误读成核验失败')
  }
})
