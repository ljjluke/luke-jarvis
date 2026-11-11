import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as m from '../src/host/state/memstore.js'

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-')) }
function mkdoc(dir, text) {
  const d = path.join(dir, '.jarvis', 'docs'); fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'a.md'), text)
}

test('两字中文可召回 + 标题命中', () => {
  const d = tmp()
  const e = m.addEntry(d, { kind: 'fact', title: '需求澄清机制', body: '澄清要问尽真疑问，不设数量上限' })
  const r = m.recall(d, '澄清')
  assert.ok(r.some((x) => x.id === e.id), '澄清应命中')
  const r2 = m.recall(d, '需求澄清')
  assert.ok(r2.some((x) => x.id === e.id), '三字查询应命中')
})

test('同 key 正文变化 → 冲突双条 + disputed', () => {
  const d = tmp()
  const a = m.addEntry(d, { kind: 'fact', title: '方案结论', body: 'A 方案可行' })
  const b = m.addEntry(d, { kind: 'fact', title: '方案结论', body: 'A 方案不可行' })
  const r = m.recall(d, '方案结论')
  assert.ok(r.some((x) => x.id === a.id))
  assert.ok(r.some((x) => x.id === b.id && x.disputed === true))
})

test('批量 ingest 幂等', () => {
  const d = tmp()
  mkdoc(d, '# 记忆设计\n内容A')
  const r1 = m.ingestSources(d)
  const r2 = m.ingestSources(d)
  assert.ok(r1.added >= 1)
  assert.equal(r2.added, 0, '重复 ingest 不应重复写')
})

test('promote 共享层 + 跨工作区召回', () => {
  const a = tmp(), b = tmp()
  const e = m.addEntry(a, { kind: 'knowledge', title: '方法论X', body: '可迁移的方法：先证据后结论' })
  const p = m.promoteToShared(a, e.id, '已在任务 T1 与本工作区两次实测有效，结论可迁移到其他领域复用')
  assert.ok(p.ok)
  const r = m.recall(b, '方法论')
  assert.ok(r.some((x) => x.lane === 'shared'), '另一工作区应召回 shared')
})

test('resolve 冲突后旧条失效', () => {
  const d = tmp()
  m.addEntry(d, { kind: 'fact', title: '结论Y', body: '可行' })
  const b = m.addEntry(d, { kind: 'fact', title: '结论Y', body: '不可行' })
  const res = m.resolveConflict(d, b.id, '以不可行为准：实测失败回滚')
  assert.ok(res.ok)
  const r = m.recall(d, '结论Y')
  assert.ok(r.some((x) => String(x.title).includes('裁决')), '应有裁决条目')
})
