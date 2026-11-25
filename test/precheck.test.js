import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { jarvisPrecheck } from '../src/host/gates/precheck.js'

function ws(withTeam) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-pre-'))
  if (withTeam) {
    fs.mkdirSync(path.join(d, '.agent-teams', 'demo'), { recursive: true })
    fs.writeFileSync(path.join(d, '.agent-teams', 'demo', 'team.json'), JSON.stringify({ name: 'demo', tasks: [] }))
  }
  return d
}
const exec = (cwd, name, args = {}) => ({ name, arguments: args, agent: { session: { header: { cwd } } } })

test('无团队时拦 agent_teams_* 并给中文指引', () => {
  const cwd = ws(false)
  const out = jarvisPrecheck(exec(cwd, 'agent_teams_status'))
  assert.ok(out && out.includes('还没有任何团队') && out.includes('jarvis_clarify'))
})

test('有团队时放行 agent_teams_*', () => {
  const cwd = ws(true)
  assert.equal(jarvisPrecheck(exec(cwd, 'agent_teams_status')), undefined)
})

test('glob 扫 /root/.dsh 被拦并给替代方案', () => {
  const cwd = ws(false)
  const out = jarvisPrecheck(exec(cwd, 'glob', { path: '/root/.dsh', pattern: '**/*.js' }))
  assert.ok(out && out.includes('超大目录') && out.includes('.jarvis/docs'))
})

test('正常 glob 放行', () => {
  const cwd = ws(false)
  assert.equal(jarvisPrecheck(exec(cwd, 'glob', { path: path.join(cwd, '.jarvis'), pattern: '*.md' })), undefined)
})

test('无 cwd 一律放行（headless 不误拦）', () => {
  assert.equal(jarvisPrecheck({ name: 'agent_teams_status', arguments: {}, agent: null }), undefined)
})
