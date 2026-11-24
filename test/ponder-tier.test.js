/** ponder 三档分级 + 收口核验 回归测试（v0.16）。
 *
 *  用户定调（2026-11-19）：「保证 jarvis 中途工作、开始工作等情况都正常流程，
 *  并且每个员工必须思考的时候用 ponder」。
 *
 *  旧口径（提交 a924bb7 起）是「固化流程但不考核步骤」，把 ponder 从所有闸里撤下。
 *  后果：执行器 adapters/dsh-executor.js 的 memberBrief 只注入轻量四步、一个字都没提
 *  ponder，成员事实上全员裸干（scan 实证 6/6 会话 jarvis_ponder_check 从未调用）。
 *
 *  本测试锁定反转后的三条不变量：
 *    ① 档位由任务单决定（不是成员自评），缺省 = standard（宁可多要一次深度思考）
 *    ② easy-direct 档豁免 ponder，但必须给「自检三条」替代
 *    ③ standard/complex 档的成员简报必须含可执行 ponder 路径（PONDER_SOLO/step-guard/verify）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  PONDER_TIER, ponderTierOf, tierRequiresPonder, tierGuidance, TIER_MARK,
} from '../src/host/protocol/deliberation.js'
import { checkPonderVerify } from '../src/host/gates/audit.js'

// ── 档位判定 ────────────────────────────────────────────────────────
test('ponderTierOf：档位由任务单决定，缺省 standard（不让成员自评降档）', () => {
  assert.equal(ponderTierOf({ meta: { route: 'easy-direct' } }), PONDER_TIER.EASY)
  assert.equal(ponderTierOf({ meta: { route: 'easy' } }), PONDER_TIER.EASY)
  assert.equal(ponderTierOf({ meta: { route: 'standard' } }), PONDER_TIER.STANDARD)
  assert.equal(ponderTierOf({ meta: { route: 'complex' } }), PONDER_TIER.COMPLEX)
  // 缺省：宁可多要一次深度思考，也不要"应该思考时没思考"
  assert.equal(ponderTierOf({}), PONDER_TIER.STANDARD, '没有档位字段 = standard，不是 easy')
  assert.equal(ponderTierOf(null), PONDER_TIER.STANDARD, 'null 也要安全降级为 standard')
  // stakes=low 仍要跑（阶段可精简但不可少）
  assert.equal(ponderTierOf({ meta: { stakes: 'low' } }), PONDER_TIER.STANDARD, '低赌注 ≠ 免跑')
  assert.equal(ponderTierOf({ meta: { stakes: 'high' } }), PONDER_TIER.COMPLEX)
  // 兼容老字段名
  assert.equal(ponderTierOf({ meta: { difficulty: 'easy' } }), PONDER_TIER.EASY)
})

test('tierRequiresPonder：只有 easy-direct 不要求真跑', () => {
  assert.equal(tierRequiresPonder(PONDER_TIER.EASY), false)
  assert.equal(tierRequiresPonder(PONDER_TIER.STANDARD), true)
  assert.equal(tierRequiresPonder(PONDER_TIER.COMPLEX), true)
  assert.equal(tierRequiresPonder(''), true, '未知档位按"要跑"处理（保守）')
  assert.equal(tierRequiresPonder(undefined), true)
})

// ── 分档文案 ────────────────────────────────────────────────────────
test('tierGuidance：三档文本各自可执行，easy 档给自检三条替代', () => {
  const easy = tierGuidance(PONDER_TIER.EASY)
  assert.ok(/easy-direct/.test(easy), '要标明档位')
  assert.ok(/自检三条/.test(easy), 'easy 档必须给替代动作（否则等于没要求）')
  assert.ok(/升级路径/.test(easy), '必须给出"干着发现不对就升级"的出口')
  assert.ok(!/PONDER_SOLO/.test(easy), 'easy 档不该让成员去跑 ponder')

  const std = tierGuidance(PONDER_TIER.STANDARD)
  assert.ok(/PONDER_SOLO/.test(std), '成员是 depth-1 子 agent，必须给 SOLO 模式提示')
  assert.ok(/PONDER_DATA_DIR/.test(std), '必须给 per-run 数据目录（防多成员互相覆盖）')
  assert.ok(/step-guard/.test(std), '必须给核验命令')
  assert.ok(/十阶段|interview/.test(std), '必须列出十阶段')
  assert.ok(/interview.*shensi.*divergence.*bagua.*plans.*converge.*score.*simulate.*debate.*synthesis/s.test(std),
    '十阶段必须按固定顺序列出（顺序错了整条管线就废了）')

  const cx = tierGuidance(PONDER_TIER.COMPLEX)
  assert.ok(/可谬自评/.test(cx), 'complex 档必须额外要可谬自评')
  assert.ok(cx.length > std.length, 'complex 文案应比 standard 更严格（至少不更短）')
})

test('tierGuidance：所有档位都带「降级必须留痕」的出口（禁止静默跳过）', () => {
  for (const t of [PONDER_TIER.STANDARD, PONDER_TIER.COMPLEX]) {
    const g = tierGuidance(t)
    assert.ok(/skipReason|blocked/.test(g), `${t} 档必须写明降级留痕方式`)
    assert.ok(/禁止静默/.test(g) || /不许/.test(g), `${t} 档必须禁止静默降级`)
  }
})

test('TIER_MARK：能识别成员简报里有没有带思考要求', () => {
  assert.ok(TIER_MARK.test(tierGuidance(PONDER_TIER.EASY)), 'easy 文案应被识别')
  assert.ok(TIER_MARK.test(tierGuidance(PONDER_TIER.STANDARD)), 'standard 文案应被识别')
  assert.ok(!TIER_MARK.test('随便写点什么'), '无关文本不应被识别')
})

// ── 收口核验：easy 档豁免 ───────────────────────────────────────────
test('checkPonderVerify：easy-direct 档凭任务单豁免；standard 档仍拦', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponder-tier-'))
  try {
    fs.mkdirSync(path.join(dir, '.agent-teams/t1'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.jarvis/tickets'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.agent-teams/t1/team.json'), JSON.stringify({
      captainSessionId: 'cap',
      tasks: [
        { id: 'easy-1', status: 'completed', assignee: '架构师' },
        { id: 'std-1', status: 'completed', assignee: '测试员' },
      ],
    }))
    // easy-1 的任务单标了免跑档
    fs.writeFileSync(path.join(dir, '.jarvis/tickets/ticket-easy-1.json'), JSON.stringify({
      id: 'easy-1', meta: { route: 'easy-direct' },
    }))
    // std-1 没有任务单（= 缺省 standard）
    const fsSvc = {
      list: async (p) => { try { return fs.readdirSync(p) } catch { return [] } },
      readText: async (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } },
      readFileSync: (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } },
    }
    const r1 = await checkPonderVerify(fsSvc, dir, path)
    const joined = r1.join('\n')
    assert.ok(!joined.includes('easy-1'), `easy 档不该被拦（实际：${joined}）`)
    assert.ok(joined.includes('std-1'), `standard 档（任务单缺失=缺省 standard）必须被拦（实际：${joined}）`)

    // 补上 std-1 的 PASS 记录 → 放行
    fs.mkdirSync(path.join(dir, '.jarvis/docs/ponder-verify'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.jarvis/docs/ponder-verify/std-1-run_x.json'),
      JSON.stringify({ taskId: 'std-1', runId: 'run_x', verdict: 'PASS' }))
    const fsSvc2 = {
      list: async (p) => { try { return fs.readdirSync(p) } catch { return [] } },
      readText: async (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } },
      readFileSync: (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } },
    }
    const r2 = await checkPonderVerify(fsSvc2, dir, path)
    assert.deepStrictEqual(r2, [], 'PASS 记录补齐后应放行')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── 派活侧：成员简报必须带档位 ─────────────────────────────────────
test('memberBrief 导入分档：执行器必须调用 tierGuidance 而不是固定注入四步', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/ponderTierOf|tierGuidance/.test(src), '执行器必须按任务单档位生成简报')
  assert.ok(/tierGuidance\(tier\)/.test(src), '必须实际调用 tierGuidance')
  // 档位要进续接线索：压缩后成员不能连"我该跑 ponder"都忘了
  const resumeBlock = src.slice(src.indexOf('function memberResumeHint'), src.indexOf('function memberResumeHint') + 2500)
  assert.ok(/思考档位/.test(resumeBlock), '续接线索必须带档位')
  assert.ok(/run_id/.test(resumeBlock), '续接线索必须提示 run_id 记在哪')
  // 自动 STATUS.md 也要带档位
  const statusBlock = src.slice(src.indexOf('function autoWriteStatus'), src.indexOf('function autoWriteStatus') + 2500)
  assert.ok(/思考档位/.test(statusBlock), '自动 STATUS.md 必须带档位（成员失忆后唯一的锚点）')
})

test('deliver.js：open 接受 route/stakes 并写进 meta', () => {
  const src = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')
  assert.ok(/route: \{ type: 'string'/.test(src), 'jarvis_ticket 必须接受 route 参数')
  assert.ok(/stakes: \{ type: 'string'/.test(src), 'jarvis_ticket 必须接受 stakes 参数')
  assert.ok(/input\.meta\.route = routeArg/.test(src), 'route 必须写进任务单 meta')
  assert.ok(/input\.meta\.stakes = stakesArg/.test(src), 'stakes 必须写进任务单 meta')
})
