/** 阶段汇报 / 绩效评估 / 换人 三机制回归测试（v0.21）。
 *
 *  用户质疑（2026-11-25）：
 *    「工作过程中有阶段汇报吗？ceo 有绩效评估员工吗？如果不合格有通知猎头重新蒸馏吗？」
 *
 *  排查结论：三个机制**代码里全都有**，但存在两个真实断点：
 *    ① 阶段汇报：成员侧有（watchChild 60s×3 提醒 + progress/ready/blocked/failed 四态 +
 *       STATUS.md 三层），但 CEO 侧没有"主动巡检"驱动 → 靠模型自觉
 *    ② 绩效评估：jarvis_perf 实现完整（六维信号 / strikes 累计 / perf-<role>.json 落盘），
 *       但**没有任何闸强制调用** → CEO 可以不评估就收口
 *    ③ 换人：retire / canCreateNewChild / 猎头补位链条齐全，但没人触发评估 → 也就永不换人
 *
 *  本测试锁定：绩效闸存在且判据正确、协议正文拆成可执行动作、换人链路完整。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { checkMemberPerf } from '../src/host/gates/audit.js'

const deliverSrc = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')
const auditSrc = fs.readFileSync(new URL('../src/host/gates/audit.js', import.meta.url), 'utf8')
const protocolSrc = fs.readFileSync(new URL('../src/host/protocol/index.js', import.meta.url), 'utf8')
const execSrc = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')

// ── ① 阶段汇报 ────────────────────────────────────────────────────
test('阶段汇报：成员四态 + 定时提醒 + STATUS.md 三层机制齐全', () => {
  // 四态汇报
  assert.ok(/state=ready（已交付）/ .test(execSrc) || /ready（已交付）/.test(execSrc), '成员简报必须要求 ready 态')
  assert.ok(/progress（进行中|progress（进行中/.test(execSrc), '必须要求 progress 态（阶段汇报的载体）')
  assert.ok(/blocked/.test(execSrc) && /failed/.test(execSrc), '必须有 blocked/failed 态')
  // 定时提醒
  assert.ok(/REMIND_LIMIT/.test(execSrc) && /REMIND_INTERVAL_MS/.test(execSrc), '必须有提醒次数与间隔常量')
  assert.ok(/watchChild/.test(execSrc), '必须有盯控子会话的函数')
  // STATUS.md 三层
  assert.ok(/statusRelPath/.test(execSrc), '必须有 STATUS.md 路径约定')
  assert.ok(/autoWriteStatus/.test(execSrc), '插件必须自动落 STATUS.md 骨架（不依赖模型自觉）')
})

test('阶段汇报：协议正文要求 CEO 主动巡检（不只靠自动提醒）', () => {
  assert.ok(/10a/.test(protocolSrc), '盯控段必须拆成可执行子步骤')
  assert.ok(/阶段汇报巡检/.test(protocolSrc), '必须有明确的巡检动作')
  assert.ok(/每次 jarvis_ticket action=list 都要做/.test(protocolSrc) || /action=list 都要做/.test(protocolSrc),
    '必须写明巡检的触发时机')
  assert.ok(/只有一句"进行中"= 退回重报/.test(protocolSrc), '必须给出"什么算有效汇报"的判据')
})

// ── ② 绩效评估 ────────────────────────────────────────────────────
test('绩效评估：协议要求「每次成员交付后必做」，六维信号写清', () => {
  assert.ok(/10c/.test(protocolSrc), '必须有独立的绩效评估子步骤')
  assert.ok(/绩效评估.*每次成员交付后必做/.test(protocolSrc), '必须写明是必做不是可选')
  for (const dim of ['需求对齐度', '成果质量', '完成度', '问题上行健康度', '角色卡契合度', '蒸馏深度']) {
    assert.ok(protocolSrc.includes(dim), `六维必须齐全，缺：${dim}`)
  }
  assert.ok(/stageStatus=pending/.test(protocolSrc), '必须提醒 pending 不硬判 0 分（防误判）')
})

test('绩效评估：收口闸强制检查（不评估不许收口）', () => {
  assert.ok(/checkMemberPerf/.test(auditSrc), '必须有绩效闸函数')
  assert.ok(/checkMemberPerf\(fsSvc, projectDir, path, ownedSet\)/.test(deliverSrc), 'close 闸必须调用它')
  // 位置：必须在 close 段（ponder 检查之后）
  const closeStart = deliverSrc.indexOf('close: {')
  const perfCall = deliverSrc.indexOf('checkMemberPerf(fsSvc')
  assert.ok(perfCall > closeStart, '绩效闸必须接在 close 段内')
})

test('checkMemberPerf：有成员交付但无评估 → 拦；有评估 → 放行；无成员任务 → 不拦', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-gate-'))
  const fsSvc = {
    list: async (p) => { try { return fs.readdirSync(p) } catch { return [] } },
    readText: async (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } },
    readFileSync: (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } },
  }
  try {
    // 场景 1：没有团队目录 → 不拦
    assert.deepStrictEqual(await checkMemberPerf(fsSvc, dir, path), [], '无团队不应拦')

    // 场景 2：有成员完成任务但无 perf 记录 → 拦
    fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({
      captainSessionId: 'cap',
      tasks: [
        { id: 'x1', status: 'completed', assignee: '架构师' },
        { id: 'x2', status: 'completed', assignee: 'captain' },   // captain 不算
      ],
    }))
    const r1 = await checkMemberPerf(fsSvc, dir, path)
    assert.ok(r1.some((m) => m.includes('绩效评估缺失')), `应拦（实际：${r1.join('|')}`)
    assert.ok(r1.join('').includes('架构师'), '应点名缺评估的角色')

    // 场景 3：补上 perf 记录 → 放行
    fs.mkdirSync(path.join(dir, '.jarvis'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.jarvis/perf-架构师.json'), JSON.stringify({
      role: '架构师', history: [{ ok: true, at: '2026-11-25', action: '继续' }],
    }))
    const r2 = await checkMemberPerf(fsSvc, dir, path)
    assert.deepStrictEqual(r2, [], '有评估记录应放行')

    // 场景 4：只有 captain 完成的任务 → 不拦（调度者不自我评估）
    fs.rmSync(path.join(dir, '.agent-teams'), { recursive: true, force: true })
    fs.mkdirSync(path.join(dir, '.agent-teams/t2'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.agent-teams/t2/team.json'), JSON.stringify({
      captainSessionId: 'cap', tasks: [{ id: 'y1', status: 'completed', assignee: 'captain' }],
    }))
    assert.deepStrictEqual(await checkMemberPerf(fsSvc, dir, path), [], '只有 captain 任务不应拦')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── ③ 换人 ────────────────────────────────────────────────────────
test('换人链路：retire 终止会话 + 标记 retired + 下次派发需重新蒸馏', () => {
  assert.ok(/retireRole/.test(execSrc), '必须有换人函数')
  assert.ok(/retired: true/.test(execSrc), '换人应标记 retired（凭据）')
  assert.ok(/canCreateNewChild/.test(execSrc), '必须有「能否新建会话」的凭据检查')
  // deliver.js 的 retire 动作
  assert.ok(/action === 'retire'/.test(deliverSrc), 'jarvis_ticket 必须有 retire 动作')
  // 协议要求换人后重新蒸馏
  assert.ok(/离任→重蒸馏补位/.test(protocolSrc), '协议必须写明换人后要重新蒸馏角色卡')
  assert.ok(/10d/.test(protocolSrc), '必须有独立的不合格处理子步骤')
})

test('协议：换人是硬要求，不是建议', () => {
  assert.ok(/不换人硬留着.*交付质量失控/.test(protocolSrc), '必须写明不换人的后果')
  assert.ok(/立即.*走离任→重蒸馏补位/.test(protocolSrc), '需求对齐=0 必须立即换人')
  assert.ok(/连续 2 次不达标/.test(protocolSrc), '必须写明连败次数阈值')
  assert.ok(/单次不达标.*补强观察/.test(protocolSrc), '必须写明单次不达标的处理（不是一刀切换人）')
})
