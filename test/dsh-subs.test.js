/** 「只认 jarvis 任务单」的可见性兜底：DSH 原生子会话未纳入任务单时，UI 必须说清真相。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { buildSnapshot } from '../src/host/state/snapshot.js'

function mkSession({ root, cwd, origin, parent, sid, createdAt }) {
  const dirName = '--' + cwd.replace(/^\/+|\/+$/g, '').replace(/[\/]+/g, '-') + '--'
  const sd = path.join(root, '.dsh', 'sessions', dirName, sid)
  fs.mkdirSync(sd, { recursive: true })
  const head = JSON.stringify({ type: 'session', version: 4, id: sid, createdAt: createdAt || Date.now(), cwd, origin, parentSession: parent, isSeeded: false })
  const body = head + '\n{"type":"message"}\n'
  fs.writeFileSync(path.join(sd, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(body, 'utf8')))
}

test('DSH 子会话扫描：能识别未纳入任务单的原生子会话', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshsub-'))
  const ws = path.join(home, 'proj')
  fs.mkdirSync(path.join(ws, '.jarvis'), { recursive: true })
  const oldHome = process.env.HOME
  process.env.HOME = home
  try {
    mkSession({ root: home, cwd: ws, origin: 'subagent', parent: 'session-main', sid: 'aaaaaaaa-1111-2222-3333-444444444444' })
    mkSession({ root: home, cwd: ws, origin: 'user', parent: '', sid: 'session-main' })
    const snap = buildSnapshot(ws, { version: '0.15.3' })
    const d = snap.dshSubagents
    assert.ok(d, '快照必须带 dshSubagents 字段（否则 UI 无法提示）')
    assert.equal(d.total, 1, '只算 origin=subagent 的（主会话不算）')
    assert.equal(d.untracked, 1, '没登记进 exec-map 的算未纳管')
    assert.equal(d.tracked, 0)
    assert.equal(d.items[0].id, 'aaaaaaaa-1111-2222-3333-444444444444')
  } finally { process.env.HOME = oldHome; fs.rmSync(home, { recursive: true, force: true }) }
})

test('DSH 子会话扫描：exec-map 里登记过的算「已纳入」', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshsub2-'))
  const ws = path.join(home, 'proj')
  fs.mkdirSync(path.join(ws, '.jarvis', 'tickets'), { recursive: true })
  const sid = 'bbbbbbbb-1111-2222-3333-444444444444'
  fs.writeFileSync(path.join(ws, '.jarvis/tickets/exec-map.json'), JSON.stringify({ 'ticket-x': { 'as-1': { childId: sid, role: '前端' } } }))
  const oldHome = process.env.HOME
  process.env.HOME = home
  try {
    mkSession({ root: home, cwd: ws, origin: 'subagent', parent: 'session-main', sid })
    const snap = buildSnapshot(ws, { version: '0.15.3' })
    assert.equal(snap.dshSubagents.tracked, 1, 'exec-map 里有的必须算已纳入')
    assert.equal(snap.dshSubagents.untracked, 0)
  } finally { process.env.HOME = oldHome; fs.rmSync(home, { recursive: true, force: true }) }
})

test('DSH 子会话扫描：其他工作区的会话不混进来', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshsub3-'))
  const ws = path.join(home, 'proj')
  const other = path.join(home, 'other')
  fs.mkdirSync(path.join(ws, '.jarvis'), { recursive: true })
  fs.mkdirSync(other, { recursive: true })
  const oldHome = process.env.HOME
  process.env.HOME = home
  try {
    mkSession({ root: home, cwd: other, origin: 'subagent', parent: 'session-o', sid: 'cccccccc-1111-2222-3333-444444444444' })
    const snap = buildSnapshot(ws, { version: '0.15.3' })
    assert.equal(snap.dshSubagents.total, 0, '只扫当前工作区的会话目录')
  } finally { process.env.HOME = oldHome; fs.rmSync(home, { recursive: true, force: true }) }
})

test('DSH 子会话扫描：读不到/坏文件时不影响主快照（fail-open）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshsub4-'))
  const ws = path.join(home, 'proj')
  fs.mkdirSync(path.join(ws, '.jarvis'), { recursive: true })
  const oldHome = process.env.HOME
  process.env.HOME = home
  try {
    // 造一个坏 zstd
    const dirName = '--' + ws.replace(/^\/+|\/+$/g, '').replace(/[\/]+/g, '-') + '--'
    const sd = path.join(home, '.dsh', 'sessions', dirName, 'dddddddd-1111-2222-3333-444444444444')
    fs.mkdirSync(sd, { recursive: true })
    fs.writeFileSync(path.join(sd, 'session.v4.jsonl.zstd'), 'not a zstd file')
    const snap = buildSnapshot(ws, { version: '0.15.3' })
    assert.ok(snap, '快照必须能生成（坏文件跳过，不能整个失败）')
    assert.equal(snap.dshSubagents.total, 0, '坏文件不计数')
  } finally { process.env.HOME = oldHome; fs.rmSync(home, { recursive: true, force: true }) }
})

test('前端：有未纳管子会话时必须展示提示卡，而不是显示空白', () => {
  const html = fs.readFileSync(new URL('../webui/jarvis-v2-wings.html', import.meta.url), 'utf8')
  assert.ok(/function cardDshSubagents/.test(html), '应有 DSH 子会话提示卡')
  assert.ok(/const d=snap\.dshSubagents;/.test(html), '卡片必须读快照的 dshSubagents')
  assert.ok(/if\(!d\|\|!Number\(d\.untracked\|\|0\)\)return null;/.test(html), '没有未纳管的就不显示（不占位）')
  assert.ok(/cardDshSubagents,/.test(html), '必须接入渲染顺序')
  assert.ok(/dsh\.sub\.title/.test(html), '文案走 i18n')
  // 必须说清「这些活没经我登记」这个事实，而不只是显示数字。
  // 文案已从内部术语（「没走任务单」「未纳管」）改为指挥官口径（「没登记到我这儿」）——
  // 断言检查的是「有没有说明这个事实」，不是某个具体措辞。
  assert.ok(/没走任务单|未纳管|没登记/.test(html), '文案要说明「这些活没经我登记」')
})
