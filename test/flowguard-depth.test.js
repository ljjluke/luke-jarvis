/** 缺陷 a：flowguard 的 hasGlob 只列一层，读不到 .agent-teams/<team>/team.json。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { hasGlob } from '../src/host/gates/audit.js'

/** 用真实 fs 造一个 fsSvc（兼容 resolve + listDir 形态） */
function mkFsSvc(root) {
  return {
    resolve: async (p) => {
      const abs = path.isAbsolute(p) ? p : path.join(root, p)
      return fs.existsSync(abs) ? abs : null
    },
    listDir: async (target) => {
      const st = fs.statSync(target)
      if (!st.isDirectory()) return []
      return fs.readdirSync(target, { withFileTypes: true }).map((d) => ({ name: d.name, isDirectory: d.isDirectory() }))
    },
  }
}

function mkWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glob-test-'))
  fs.mkdirSync(path.join(dir, '.agent-teams'), { recursive: true })
  return dir
}
function rmWs(d) { fs.rmSync(d, { recursive: true, force: true }) }

test('缺陷a：标准结构 .agent-teams/<team>/team.json —— 默认 depth 找不到（暴露原缺陷）', async () => {
  const ws = mkWs()
  try {
    fs.mkdirSync(path.join(ws, '.agent-teams/jarvis-team'), { recursive: true })
    fs.writeFileSync(path.join(ws, '.agent-teams/jarvis-team/team.json'), '{"tasks":[]}')
    const svc = mkFsSvc(ws)
    const oneLayer = await hasGlob(svc, path.join(ws, '.agent-teams'), 'team.json')
    assert.equal(oneLayer, false, '默认只列一层 → 读不到子目录里的 team.json（这正是原缺陷）')
  } finally { rmWs(ws) }
})

test('缺陷a 修复：depth:3 能递归找到子目录 team.json', async () => {
  const ws = mkWs()
  try {
    fs.mkdirSync(path.join(ws, '.agent-teams/jarvis-team'), { recursive: true })
    fs.writeFileSync(path.join(ws, '.agent-teams/jarvis-team/team.json'), '{"tasks":[]}')
    const svc = mkFsSvc(ws)
    const deep = await hasGlob(svc, path.join(ws, '.agent-teams'), 'team.json', { depth: 3 })
    assert.equal(deep, true, 'depth:3 必须能找到 .agent-teams/<team>/team.json')
  } finally { rmWs(ws) }
})

test('缺陷a 修复：多层嵌套也能找到', async () => {
  const ws = mkWs()
  try {
    fs.mkdirSync(path.join(ws, '.agent-teams/a/b/c'), { recursive: true })
    fs.writeFileSync(path.join(ws, '.agent-teams/a/b/c/team.json'), '{}')
    const svc = mkFsSvc(ws)
    assert.equal(await hasGlob(svc, path.join(ws, '.agent-teams'), 'team.json', { depth: 4 }), true, '深度 4 能到 c')
    assert.equal(await hasGlob(svc, path.join(ws, '.agent-teams'), 'team.json', { depth: 1 }), false, '深度 1 到不了 c（边界正确）')
  } finally { rmWs(ws) }
})

test('缺陷a 修复：真的没有 team.json 仍然返回 false（不能变成无条件放行）', async () => {
  const ws = mkWs()
  try {
    fs.mkdirSync(path.join(ws, '.agent-teams/empty-team'), { recursive: true })
    fs.writeFileSync(path.join(ws, '.agent-teams/empty-team/other.json'), '{}')
    const svc = mkFsSvc(ws)
    assert.equal(await hasGlob(svc, path.join(ws, '.agent-teams'), 'team.json', { depth: 3 }), false,
      '没有 team.json 就必须 false——否则状态根守卫形同虚设')
  } finally { rmWs(ws) }
})

test('缺陷a 修复：.agent-teams 目录不存在 → false（流程闸必须拦）', async () => {
  const ws = mkWs()
  try {
    fs.rmSync(path.join(ws, '.agent-teams'), { recursive: true, force: true })
    const svc = mkFsSvc(ws)
    assert.equal(await hasGlob(svc, path.join(ws, '.agent-teams'), 'team.json', { depth: 3 }), false)
  } finally { rmWs(ws) }
})

test('缺陷a 修复：无 fs 能力时仍 fail-open（不把查不了当拦截）', async () => {
  assert.equal(await hasGlob(null, '/any', 'team.json', { depth: 3 }), true, '无 fs 服务 → 放行')
  assert.equal(await hasGlob({}, '/any', 'team.json', { depth: 3 }), true, '无列举能力 → 放行')
})

test('接线：deliver.js 的 team.json 判定必须带 depth', () => {
  const src = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')
  assert.ok(/hasGlob\(getFsService\(exec\), path\.join\(projectDir, '\.agent-teams'\), 'team\.json', \{ depth: 3 \}\)/.test(src),
    'team.json 判定必须传 depth:3，否则标准结构读不到')
  // 其他调用保持单层语义（docs 目录都是扁平文件名）
  assert.ok(!/hasGlob[^;]*需求规格[^;]*depth/.test(src), 'docs 类调用不应被顺带改成递归（保持原语义）')
})
