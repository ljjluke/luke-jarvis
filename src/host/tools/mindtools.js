/** 知识库工具面（记忆流水线 ②巩固门 / ⑤检索 / ①候选池）。
 *
 *  jarvis_recall —— 思考时按需检索（用户要求：「需要获取信息，思考的时候提取知识」）
 *  jarvis_mind   —— 巩固门：任务收尾时强制沉淀；也用于查看/标记/统计
 *
 *  与 jarvis_store 的区别：
 *   · jarvis_store = 项目陈述性记忆（project.md/lessons.md 等文件），随项目走；
 *   · jarvis_mind  = 结构化知识库（.jarvis/mind/*.jsonl），带去重/强度/领域标签/衰减，
 *                    是「越用越聪明」的载体。
 */
import { createRequire } from 'node:module'
import { remember, recall, markUsed, mindStats, mindAudit, domainDigest, compactMind } from '../state/mind.js'

const _require = createRequire(import.meta.url)

const KINDS = ['lesson', 'preference', 'domain', 'fact']

export const MIND_TOOLS = [
  {
    name: 'jarvis_recall',
    description:
      '【思考时提取知识】从本项目知识库（.jarvis/mind/）按当前领域检索历史经验。' +
      '这是「越用越聪明」的读取端：做过同类项目的教训、客户偏好、领域经验都在这里。' +
      '用法：start 一个需求/一个方案前调用一次，拿到 top-N 条相关经验再动手——' +
      '不查就动手 = 丢掉项目积累的全部经验。返回的 id 可用于 jarvis_mind(action=used) 记录引用（强度随之上升）。',
    parameters: {
      type: 'object',
      properties: {
        domains: { type: 'string', description: '当前需求所属领域，逗号分隔（如 电商,通用）。不传则只按强度检索' },
        query: { type: 'string', description: '当前要解决的问题（用于辅助排序，可空）' },
        limit: { type: 'string', description: '返回条数（默认 8）' },
        projectDir: { type: 'string', description: '工作区根目录（默认当前会话 cwd）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { count: { type: 'number' }, items: { type: 'string' }, verdict: { type: 'string' } },
      },
      render: (r) => `【知识库检索 · ${r.count} 条】\n${r.items || '（无相关经验）'}\n${r.verdict}`,
    },
    execute: async (args, exec) => {
      const cwd = resolveCwd(args, exec)
      if (!cwd) return { count: 0, items: '', verdict: '⛔ 未定位到工作区' }
      const domains = String(args?.domains ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      const limit = Math.max(1, Math.min(20, Number(args?.limit ?? 8) || 8))
      const list = recall(cwd, { domains, limit })
      const items = list.map((e, i) =>
        `${i + 1}. [${e.kind}${e.pinned ? '·红线' : ''}·强度${e.strength}] ${e.text}${e.evidence ? `（依据：${e.evidence}）` : ''} 〔id=${e.id}〕`
      ).join('\n')
      return {
        count: list.length,
        items,
        verdict: list.length
          ? `检索到 ${list.length} 条相关经验（领域：${domains.join('/') || '全部'}）。用到后请调 jarvis_mind(action=used, ids=...) 记录引用。`
          : '知识库暂无相关经验——这是新领域，本次任务结束后请务必沉淀（jarvis_mind action=consolidate）。',
      }
    },
  },
  {
    name: 'jarvis_mind',
    description:
      '【知识库管理】项目结构化知识库（.jarvis/mind/*.jsonl）：带去重指纹/领域多标签/强度衰减/红线保护。' +
      'action：' +
      'consolidate=巩固门（**任务收尾必须调用**）：把本单学到的教训/客户偏好/领域经验写进库（同内容自动强化而非新增）；' +
      'used=记录某条经验被使用（强度上升，供后续优先检索）；' +
      'pin=标为红线（合规/致命坑，衰减速度降为 1/10，永不淡出）；' +
      'stats=查看库规模与淡出情况；compact=合并压缩文件。' +
      '规则：① 教训必须能被下次复用（写成「当X时，要Y，因为Z」）；② 重复内容会被合并强化，不要换个说法再写一遍；③ 客户偏好用 kind=preference。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'consolidate 巩固沉淀 / used 记录引用 / pin 标红线 / stats 统计 / audit 体检（判断记忆系统是否真在用起来）/ compact 压缩（默认 stats）' },
        text: { type: 'string', description: 'consolidate：要沉淀的内容（一句话，可复用）' },
        kind: { type: 'string', description: 'consolidate：类型 lesson(教训)/preference(客户偏好)/domain(领域经验)/fact(事实)' },
        domains: { type: 'string', description: 'consolidate：所属领域，逗号分隔（可多个，如 电商,通用）' },
        evidence: { type: 'string', description: 'consolidate：依据（哪次任务/什么现象）' },
        pinned: { type: 'string', description: 'consolidate：是否红线（true/false）' },
        ids: { type: 'string', description: 'used/pin：条目 id，逗号分隔' },
        projectDir: { type: 'string', description: '工作区根目录（默认当前会话 cwd）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { action: { type: 'string' }, verdict: { type: 'string' }, stats: { type: 'string' } },
      },
      render: (r) => `【知识库 · ${r.action}】\n${r.verdict}${r.stats ? '\n' + r.stats : ''}`,
    },
    execute: async (args, exec) => {
      const cwd = resolveCwd(args, exec)
      if (!cwd) return { action: 'error', verdict: '⛔ 未定位到工作区' }
      const action = String(args?.action ?? 'stats').trim()
      if (action === 'consolidate') {
        const text = String(args?.text ?? '').trim()
        if (!text) return { action, verdict: '⛔ consolidate 需要 text（一句话、可复用、写成「当X时，要Y，因为Z」）' }
        const kind = KINDS.includes(args?.kind) ? args.kind : 'lesson'
        const domains = String(args?.domains ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        const r = remember(cwd, { text, kind, domains, evidence: args?.evidence, pinned: String(args?.pinned) === 'true' })
        const s = mindStats(cwd)
        const verb = r.action === 'reinforced' ? '已强化（库中已有同内容，未新增条目）' : '已入库'
        return {
          action, stats: `库内共 ${s.total} 条（红线 ${s.pinned}，淡出 ${s.faded}）`,
          verdict: `✅ ${verb}：${text.slice(0, 120)} 〔id=${r.id}〕${r.action === 'reinforced' ? '\n（这是「不积压」机制：同一教训重复出现只会变强，不会变成两条）' : ''}`,
        }
      }
      if (action === 'used') {
        const ids = String(args?.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        if (!ids.length) return { action, verdict: '⛔ used 需要 ids（从 jarvis_recall 返回的 id 取）' }
        const n = markUsed(cwd, ids)
        return { action, verdict: `✅ 已记录 ${n} 条被使用（强度上升，下次优先检索）` }
      }
      if (action === 'pin') {
        const ids = String(args?.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        if (!ids.length) return { action, verdict: '⛔ pin 需要 ids' }
        const n = markUsed(cwd, ids)   // 借用其写回路径；pinned 由 consolidate 时指定
        return { action, verdict: `已将 ${n} 条标记为高频引用（如需红线请在 consolidate 时传 pinned=true）` }
      }
      if (action === 'compact') {
        const r = compactMind(cwd)
        return { action, verdict: `✅ 已压缩 ${r.compacted} 个领域文件` }
      }
      if (action === 'audit') {
        // 体检：用真实数据回答「记忆系统是否在用起来」，
        // 而不是在没有数据时就去优化检索算法。
        const a = mindAudit(cwd)
        const lines = [
          `规模：${a.total} 条（红线 ${a.pinned}，淡出 ${a.faded}）`,
          `使用率：${Math.round((a.usageRatio || 0) * 100)}%（${a.neverUsed || 0} 条从未被引用）`,
          `近义重复：${a.nearDupCount || 0} 对${a.nearDuplicates && a.nearDuplicates.length ? '（最像的：' + a.nearDuplicates.slice(0, 2).map((x) => `${x.ratio} ${x.a}／${x.b}`).join('；') + '）' : ''}`,
          a.total ? `类型分布：${JSON.stringify(a.kinds)}` : '',
          a.total ? `领域分布：${JSON.stringify(a.domains)}` : '',
          '',
          `判断：${a.verdict}`,
        ].filter(Boolean).join('\n')
        return { action, verdict: lines }
      }
      const s = mindStats(cwd)
      return {
        action: 'stats',
        verdict: `知识库：共 ${s.total} 条；红线 ${s.pinned} 条；淡出区 ${s.faded} 条（检索排序靠后，不会被删）`,
        stats: s.faded > s.total * 0.5 ? '⚠️ 淡出条目过半——知识库在失效，考虑补充新经验或 compact' : '',
      }
    },
  },
]

function resolveCwd(args, exec) {
  try {
    const p = String((args && args.projectDir) || '').trim()
    if (p) return p
    return (exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd) || ''
  } catch { return '' }
}

/** 供 systemPrompt 使用的领域摘要（极短，常驻成本低）。 */
export function mindDigestFor(cwd, domains) {
  try { return domainDigest(cwd, { domains, max: 3 }) } catch { return '' }
}
