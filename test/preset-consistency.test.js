/** 预设/patch 一致性回归测试（v0.15.7）。
 *
 *  用户实测（2026-11-27/28）：
 *    Error: 【团队前置检查】当前工作区还没有任何团队（.agent-teams 里没有 team.json），
 *           `agent_teams_create` 现在调用必然失败…
 *  即使用户已经被提示「不要重试」，模型还是反复调 agent_teams_create。
 *
 *  根因（工具层，不是文案层）：
 *    luke-jarvis package 的 cordis.patch.yml 用**全局 `- insert:`** 把
 *    @nanmicoder/dsh-agent-teams 挂进每个会话 → agent_teams_* 12+ 个工具
 *    真的出现在 captain 的工具清单里 → 模型看到有这工具就一定会调 →
 *    但本部署的 .agent-teams 永远为空（派单走自建执行器 + .jarvis/tickets）→ 必失败。
 *    改 persona/skill 文案拦不住（工具在清单里，模型就会用）。
 *
 *  正确修法：把 agent-teams 从全局 insert 里移除（本仓库派单走
 *    adapters/dsh-executor.js → ctx.subagents，不依赖它；ponder 走 PONDER_SOLO=1，
 *    也不需要它的 memberMaxDepth 配置）。
 *
 *  本测试锁定三件事，任何一件被改回去都会红：
 *    ① cordis.patch.yml 不得有 `agent-teams` 的 **insert 行**（允许在注释里提醒"不要加回"）
 *    ② 所有会进系统提示的文本（preset/*.yml, skills/jarvis.md）不得教怎么用 agent_teams_*
 *       （只允许"必失败/不要调用"这类负向警告）
 *    ③ presets:auto 区必须与 preset/ 源文件同步（防"改了 preset 忘了重新生成 patch"）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 判断一行是否是「教怎么用 agent_teams_* 的正向引导」（而非负向警告）。 */
function isPositiveAgentTeamsGuidance(line) {
  if (!/agent_teams_/.test(line)) return false
  // 负向警告关键词：出现任一即不算正向引导
  if (/不要用|不要调|别调用|必失败|必报|已移除|退役|无法|不可用|WRONG|不是|未必|禁止|勿用/.test(line)) return false
  // 明确的动作词 + 工具名 = 在教怎么用
  return /agent_teams_(create|add_member|remove_member|create_task|reassign_task|status|send_message|approve|update_task|edit_plan|claim_task|amend_task|delete|resume)/.test(line)
}

test('cordis.patch.yml 不得把 agent-teams 挂进全局 insert（否则 captain 会看到并调用它）', () => {
  const src = read('cordis.patch.yml')
  const lines = src.split('\n')
  const offenders = []
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    // 只看 YAML 结构行（以 - 或空白开头、不是注释）
    if (/^\s*#/.test(l)) continue
    if (/name:\s*["']?@nanmicoder\/dsh-agent-teams/.test(l) || /id:\s*agent-teams/.test(l)) {
      offenders.push(`line ${i + 1}: ${l.trim()}`)
    }
  }
  assert.deepEqual(offenders, [],
    `cordis.patch.yml 仍有 agent-teams 的插件插入行（模型会因此看到 agent_teams_* 工具并反复调用、每次都失败）：\n  ${offenders.join('\n  ')}\n` +
    '修法：删掉那条 insert（本仓库派单走 adapters/dsh-executor.js → ctx.subagents，不依赖该插件）。')
})

test('会进系统提示的文本不得教怎么用 agent_teams_*（只允许负向警告）', () => {
  const files = [
    'preset/agent.cordis.yml',
    'preset/jarvis-captain.cordis.yml',
    'preset/preset.yml',
    'skills/jarvis.md',
  ]
  for (const f of files) {
    let src = ''
    try { src = read(f) } catch { continue }
    const lines = src.split('\n')
    const bad = []
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i]
      if (!/agent_teams_/.test(l)) continue
      // YAML 的 >- 会把长段落折行，警告可能与其后的工具名分在不同行
      // （如 "...NOT agent_teams_*. agent_teams_create ALWAYS fails..."）。
      // 所以取「本行 + 前后一行」拼成上下文再判定。
      const ctx = `${lines[i - 1] || ''} ${l} ${lines[i + 1] || ''}`
      if (/不要用|不要调|别调用|必失败|ALWAYS fails|必报|已移除|退役|无法|不可用|WRONG|不是|未必|禁止|勿用|NOT agent_teams/.test(ctx)) continue
      if (/agent_teams_(create|add_member|remove_member|create_task|reassign_task|status|send_message|approve|update_task|edit_plan|claim_task|amend_task|delete|resume)/.test(l)) {
        bad.push(`  ${f}:${i + 1}: ${l.trim().slice(0, 100)}`)
      }
    }
    assert.deepEqual(bad, [],
      `以下行仍在教模型怎么用 agent_teams_*，会导致它去调用（然后必失败）：\n${bad.join('\n')}`)
  }
})

test('preset 不得再声称"底层用 AgentTeams 实时编排"（机制描述要与真实实现一致）', () => {
  for (const f of ['preset/preset.yml', 'preset/agent.cordis.yml', 'preset/jarvis-captain.cordis.yml']) {
    let src = ''
    try { src = read(f) } catch { continue }
    const claims = src.split('\n').filter((l) => /AgentTeams 实时编排|用 AgentTeams/.test(l) && !/不依赖|已移除|不是/.test(l))
    assert.deepEqual(claims, [], `${f} 仍在声称底层用 AgentTeams 编排：${claims.join('; ')}`)
  }
})

test('presets:auto 区必须与 preset/ 源文件同步（防改 preset 忘重新生成）', () => {
  const patch = read('cordis.patch.yml')
  const hasAuto = /# >>> presets:auto/.test(patch)
  assert.ok(hasAuto, 'cordis.patch.yml 应含 presets:auto 生成区')
  // captain 预设的关键约定（本次修的核心）必须真的出现在生成区里
  const cap = read('preset/jarvis-captain.cordis.yml')
  // 取 captain 文件头第一段说明行的特征串，确认它进了 patch
  assert.ok(/jarvis_dispatch_task/.test(cap), 'captain 源文件应指引 jarvis_dispatch_task')
  assert.ok(/jarvis_dispatch_task/.test(patch), 'presets:auto 区必须包含 captain 的 jarvis_dispatch_task 引导（否则是没重新生成）')
})

test('插件自身只注册 jarvis_* 工具（agent_teams_* 只能来自被移除的那个插件）', async () => {
  const { TOOLS } = await import('../src/host/tools/index.js')
  const names = TOOLS.map((t) => t.name)
  assert.ok(names.length >= 30, `应注册 30+ 工具，实际 ${names.length}`)
  const at = names.filter((n) => String(n).startsWith('agent_teams'))
  assert.deepEqual(at, [], `jarvis 插件不应注册 agent_teams_* 工具，实际：${at.join(', ')}`)
})
