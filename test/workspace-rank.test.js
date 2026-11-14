/** 缺陷 b：阶段判据固化 session.header.cwd，working-directory 改变后仍按旧 cwd。
 *  修复：多候选 + 按「有活」排序（未结束 ticket > .agent-teams 非空 > .jarvis 非空）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

function mkWs(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsrank-'))
  if (opts.jarvis) fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
  if (opts.tickets) {
    fs.mkdirSync(path.join(dir, '.jarvis/tickets'), { recursive: true })
    for (const t of opts.tickets) fs.writeFileSync(path.join(dir, '.jarvis/tickets', `ticket-${t.id}.json`), JSON.stringify({ id: `ticket-${t.id}`, ended: t.ended || null }))
  }
  if (opts.teams) {
    fs.mkdirSync(path.join(dir, '.agent-teams'), { recursive: true })
    for (const n of opts.teams) fs.mkdirSync(path.join(dir, '.agent-teams', n), { recursive: true })
  }
  return dir
}

/** 从 plugin.js 抽 rankByActivity 做单元验证（桩掉 _require） */
function loadRanker() {
  const src = fs.readFileSync(new URL('../src/host/plugin.js', import.meta.url), 'utf8')
  const start = src.indexOf('const _wsRankCache')
  const end = src.indexOf('/** 读请求体')
  const code = src.slice(start, end)
  // ESM 下没有 require：用已导入的 createRequire 构造真实的 _require
  const _req = createRequire(new URL('../src/host/plugin.js', import.meta.url))
  return new Function('_require', `
    ${code}
    return rankByActivity;
  `)(_req)
}

test('缺陷b：多候选时，有未结束 ticket 的工作区排在前面', () => {
  const idle = mkWs({ jarvis: true })                       // 只有空 .jarvis
  const busy = mkWs({ jarvis: true, tickets: [{ id: 'x' }] })  // 有未结束 ticket
  try {
    const rank = loadRanker()
    const r = rank([idle, busy])
    assert.equal(r[0], busy, '有活的工作区必须排第一（否则页面读到空的那个）')
  } finally { fs.rmSync(idle, { recursive: true, force: true }); fs.rmSync(busy, { recursive: true, force: true }) }
})

test('缺陷b：已结束的 ticket 不算「有活」（避免旧工作区抢占）', () => {
  const old = mkWs({ jarvis: true, tickets: [{ id: 'e', ended: { outcome: 'completed' } }] })
  const live = mkWs({ jarvis: true, tickets: [{ id: 'n' }] })
  try {
    const rank = loadRanker()
    const r = rank([old, live])
    assert.equal(r[0], live, '只有未结束的才算有活')
  } finally { fs.rmSync(old, { recursive: true, force: true }); fs.rmSync(live, { recursive: true, force: true }) }
})

test('缺陷b：.agent-teams 非空也加权（建队但还没开单）', () => {
  const plain = mkWs({ jarvis: true })
  const team = mkWs({ jarvis: true, teams: ['t1'] })
  try {
    const rank = loadRanker()
    const r = rank([plain, team])
    assert.equal(r[0], team, '有团队的工作区应优先')
  } finally { fs.rmSync(plain, { recursive: true, force: true }); fs.rmSync(team, { recursive: true, force: true }) }
})

test('缺陷b：同分时保持原序（header.cwd 优先，不改变既有行为）', () => {
  const a = mkWs({ jarvis: true })
  const b = mkWs({ jarvis: true })
  try {
    const rank = loadRanker()
    const r = rank([a, b])
    assert.equal(r[0], a, '同分保持传入顺序')
    assert.equal(r[1], b)
  } finally { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }) }
})

test('缺陷b：不存在/无 .jarvis 的目录得 0 分，排最后', () => {
  const good = mkWs({ jarvis: true, tickets: [{ id: 'x' }] })
  try {
    const rank = loadRanker()
    const r = rank([path.join(os.tmpdir(), 'no-such-ws-xyz'), good])
    assert.equal(r[0], good)
  } finally { fs.rmSync(good, { recursive: true, force: true }) }
})

test('缺陷b：firstSessionCwd 会收集多个候选（不只 header.cwd）', () => {
  const src = fs.readFileSync(new URL('../src/host/plugin.js', import.meta.url), 'utf8')
  assert.ok(/push\(s && s\.cwd\)/.test(src), 'session.cwd 也要作为候选')
  assert.ok(/push\(a && a\.cwd\)/.test(src), 'agent.cwd 也要作为候选')
  assert.ok(/typeof a\.workingDirectory === 'function'/.test(src), '若宿主暴露 workingDirectory 要用上')
  assert.ok(/rankByActivity\(cands\)/.test(src), '多候选必须按活跃度排序')
})
