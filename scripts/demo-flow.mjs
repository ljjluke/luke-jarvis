#!/usr/bin/env node
/** 流程演示：真跑一遍阶段机（不调模型、不建真团队），看插件怎么"从一句话走到收口"。
 *
 *  跑法：node scripts/demo-flow.mjs
 *  它只做两件事：① 造真实产物文件 ② 调 computeStage/jarvisFlowGuard 打印插件判定。
 *  用途：给用户/新成员解释"插件执行流程长什么样"，并可作为回归证据（每步输出都应出现）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeStage, renderStage } from '../src/host/gates/stage.js'
import { jarvisFlowGuard } from '../src/host/gates/flow.js'
import { recordGate } from '../src/host/gates/store.js'

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-flow-demo-'))
const docs = path.join(proj, '.jarvis/docs')
fs.mkdirSync(docs, { recursive: true })
fs.mkdirSync(path.join(proj, '.jarvis/cards'), { recursive: true })

const line = (t) => console.log(`\n${t}`)
const show = (title) => {
  line(`───── ${title} ─────`)
  console.log(renderStage(proj, { sessionId: 'demo-captain' }))
}
const guard = (name, args, session = 'demo-captain') => {
  const r = jarvisFlowGuard({ name, arguments: args, agent: { session: { id: session, header: { cwd: proj } } } })
  console.log(r ? `  ⛔ ${r.slice(0, 160)}…` : '  ✅ 放行')
  return r
}

fs.writeFileSync(path.join(proj, '.jarvis/project.md'), '# 项目记忆\n当前进度：演示\n下一步：打磨需求\n未决项：无\n团队清单：无\n关键决策：无')
console.log(`演示工作区：${proj}`)
show('0. 空白工作区（插件算出的当前阶段）')

// 1) 越阶段：clarify 还没过就想建队 → 阶段闸/流程闸拒绝
line('1. 越阶段尝试：需求还没打磨就想建队')
guard('agent_teams_create', { description: '建队' })

// 2) 需求规格 → 过 clarify 闸
fs.writeFileSync(
  path.join(docs, '需求规格-会员复购.md'),
  '# 需求：会员复购增长\n\n为谁：沉睡会员。解决什么：复购率低。怎样算成功：30 天复购率提升 5%，可判定。\n验收：\n- 方案给出三档策略并附成本/预期/风险\n- 每档有可执行动作与责任角色\n' + '背景与约束说明。\n'.repeat(40),
)
recordGate(proj, 'clarify', true)
show('2. 产出需求规格 + flowguard(clarify) 之后')

// 3) 任务编排
fs.writeFileSync(path.join(docs, '任务编排-会员复购.md'), '# 任务编排\nT1 用户分层 → T2 策略设计 → T3 方案评审\n验收：每任务可判定')
recordGate(proj, 'decompose', true)
show('3. 任务编排之后')

// 4) 方案设计
fs.writeFileSync(path.join(docs, '方案设计-会员复购.md'), '# 方案设计\n需求 R1 → 落点 D1（分层模型）\n需求 R2 → 落点 D2（触达策略）')
recordGate(proj, 'design', true)
show('4. 方案设计之后')

// 5) 角色卡 + 建队
for (const f of ['CEO-带队.md', '猎头.md', '产品增长-张一鸣.md']) {
  fs.writeFileSync(path.join(proj, '.jarvis/cards', f), '# 卡\n## 身份定位\nx\n## 核心方法论\n先做最小可分发单元\n')
}
fs.mkdirSync(path.join(proj, '.agent-teams/t1'), { recursive: true })
fs.writeFileSync(path.join(proj, '.agent-teams/t1/team.json'), JSON.stringify({ name: 't1', captainSessionId: 'demo-captain', tasks: [{ id: 'T1', assignee: '产品增长', status: 'in_progress', subject: '分层模型' }] }))
recordGate(proj, 'build', true)
show('5. 蒸馏出角色卡 + 建队之后（注意「会议：必开 开工对齐会」）')

// 5b) 开工会：写纪要 → 会议判定清除
fs.mkdirSync(path.join(proj, '.jarvis/meetings'), { recursive: true })
fs.writeFileSync(path.join(proj, '.jarvis/meetings/m0-minutes.json'), JSON.stringify({
  type: 'kickoff', topic: '开工对齐：会员复购增长', date: '2026-11-05', attendees: ['CEO', '产品增长', '猎头'],
  agenda: ['目标与验收', '接口契约', '依赖与分工'],
  resolutions: ['R1 目标：30 天复购率 +5%，可判定', 'R2 接口：产品给分层规则，数据给口径，增长给触达方案'],
  actions: [{ who: '产品增长', what: '出分层模型' }],
}, null, 2))
show('5b. 写完开工对齐会纪要之后（必开会已消除）')

// 6) 任务交完 → build 闸；close 闸
const teamFile = path.join(proj, '.agent-teams/t1/team.json')
const t = JSON.parse(fs.readFileSync(teamFile, 'utf8'))
t.tasks[0].status = 'completed'
fs.writeFileSync(teamFile, JSON.stringify(t))
fs.writeFileSync(path.join(proj, '.jarvis/board.json'), JSON.stringify({ items: [{ id: 'B1', type: '决策', content: '采用三档策略', status: 'resolved' }] }))
show('6a. 任务全交完、还没开收口会（注意「会议：必开 收口会」）')
fs.writeFileSync(path.join(proj, '.jarvis/meetings/m1-minutes.json'), JSON.stringify({
  type: 'close', topic: '收口验收', date: '2026-11-05', attendees: ['CEO', '产品增长'],
  resolutions: ['R1 验收：三档策略+成本/预期/风险齐备，通过', 'R2 遗留：触达渠道细化 → 下轮'],
  actions: [{ who: 'CEO', what: '交付方案给用户' }],
}, null, 2))
recordGate(proj, 'close', true)
show('6b. 收口会纪要 + flowguard(close) 之后（全 6/6）')

line('阶段机结论（插件视角）')
const st = computeStage(proj, { sessionId: 'demo-captain' })
console.log(JSON.stringify({ stage: st.stage, index: st.index, total: st.total, done: st.done, artifacts: st.artifacts }, null, 2))
console.log(`\n清理演示目录：rm -rf ${proj}`)
