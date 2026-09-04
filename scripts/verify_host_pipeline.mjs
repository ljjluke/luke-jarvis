// luke-jarvis 宿主完整管道回归验证（防回归，勿删）
// 用法：cd /opt/work/first/luke-jarvis && node scripts/verify_host_pipeline.mjs
// 复刻宿主 createSuccessResult 完整链：
//   defineTool(parameters normalize) → handler(真实参数) → validateJsonSchemaValue(output.schema, value)
//   → render(args,value) → contentHasImage（dsh-llm tool-result content 必须数组）
// 全绿 = 34 用例 0 VIOLATION 0 CRASH，可安全部署。
import { defineTool, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { TOOLS } from '../src/host/plugin.js'

function normalizeOutputSchema(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node
  const out = { ...node }
  if (out.type === 'object' && !Object.prototype.hasOwnProperty.call(out, 'additionalProperties')) out.additionalProperties = false
  if (Array.isArray(out.required)) {
    const required = out.required; delete out.required
    if (out.properties && typeof out.properties === 'object') {
      const props = {}
      for (const [k, v] of Object.entries(out.properties)) props[k] = required.includes(k) ? { ...v, required: true } : normalizeOutputSchema(v)
      out.properties = props
    }
  }
  if (out.properties && typeof out.properties === 'object') {
    const props = {}
    for (const [k, v] of Object.entries(out.properties)) props[k] = normalizeOutputSchema(v)
    out.properties = props
  }
  if (out.items && typeof out.items === 'object') out.items = normalizeOutputSchema(out.items)
  return out
}
function normalizeParameters(spec) {
  if (spec && typeof spec === 'object' && spec.type === 'object' && spec.properties && typeof spec.properties === 'object') {
    const required = Array.isArray(spec.required) ? spec.required : []
    const out = {}
    for (const [k, v] of Object.entries(spec.properties)) {
      const p = { ...v }
      if (required.includes(k)) p.required = true
      if (p.type === 'object' && !Object.prototype.hasOwnProperty.call(p, 'additionalProperties')) p.additionalProperties = false
      out[k] = p
    }
    return out
  }
  return spec
}
// 与 apply 注册块一致的 render 包装：签名 (args,value) + 返回数组 content
const wrapRender = (r) => (args, value) => {
  const text = r ? r(value) : JSON.stringify(value ?? {})
  return Array.isArray(text) ? text : [{ type: 'text', text: String(text) }]
}
function contentHasImage(content) {
  return content.some((block) => block.type === "image" || block.type === "tool-result" && contentHasImage(block.content))
}

const CARD = [
  '身份定位：数字供应链领域战略决策者，擅长库存周转与供应商管理',
  '思维模型：先看现金流再谈增长；遇到抉择先最小验证再放大；按库存周转率定补货优先级',
  '核心方法论：先盘点现状数据，再按 ABC 分类定策略，然后逐月复盘修正；供应商先小范围试点验证再放量，遇到异常先查数据再下结论',
  '代表作品：主导过某企业供应链数字化项目（公开访谈可查），推动库存周转提升 30%',
  '决策红线：不做无验证的批量采购；不为了规模牺牲毛利；不承诺做不到的时效；不适用时尚快消（时效品类）',
  '语言风格：数据优先，先给数字再讲结论；讲清楚边界与失效场景',
  '协同架构：位置=上游战略；依赖=运营数据；介入时机=立项即参与；协同方式=实时同步+事件驱动，分歧升级 CEO',
  '证据链：著作：本人公开长文；对话：60 分钟长访谈；表达：行业演讲实录；他者：同行评价；决策：公开决策记录；时间线：2019-2023 三次关键转向（查证：web 搜索逐条确认原文）',
  '诚实边界：信息截止 2023-08；推测成分已标注；做不到实时库存精度 100%',
  '保真度：一手占比 70%，二手 20%，推断 10%',
  '防冒名声明：本角色卡只借鉴该人物思考框架，不冒充其署名',
  'source：https://www.cnbc.com/2023/08/supply-chain-interview.html（查证：web 搜索确认原文存在）',
].join('\n')

const CASES = {
  jarvis_project: [
    { requirement: '帮我们做一个供应链管理平台，要能跟踪库存、管理供应商、生成报表，还要支持多仓库' },
    { requirement: '做个东西' }, // S5：模糊需求 → vague=true + clarifyHint，不直接建队
  ],
  jarvis_store: [
    { mode: 'check', cards: '研发', prototypes: '刘强东', projectMd: 'true', existingDirs: '["cards"]' },
    { mode: 'save', itemType: 'card', name: '研发' },
    { mode: 'scaffold', projectDir: '<workspace>/.jarvis/' },
  ],
  jarvis_process: [{ requirement: '供应链管理平台', industry: '供应链', projectRef: '参考历史流程', overrideStages: '+风控闸,-复盘' }],
  jarvis_distill: [
    { role: 'CEO', isCeo: true, card: CARD },
    { role: 'CEO', isCeo: true, card: '空卡' },
  ],
  jarvis_distill_guide: [{ role: 'CEO', material: '这是一段真实的访谈记录，共三千字，讲他如何管理供应链与库存，包含决策细节与放弃的做法', industry: '供应链' }],
  jarvis_review: [{
    issue: '测试坚持要全量回归，研发认为只测改动模块', sideA: '测试：改动的模块有隐藏耦合，需全量回归',
    sideB: '研发：时间不够，只测改动模块', requirement: '做一个库存同步模块，保证数据准确',
    thinkA: '{"counter":["全量回归太慢"],"realityCheck":["确实有耦合"],"confidence":"high","runId":"r1"}',
    thinkB: '{"counter":["隐藏耦合风险"],"realityCheck":["时间确实紧"],"confidence":"medium"}',
  }],
  jarvis_essence: [{ requirement: '做一个库存同步模块', decision: '只测改动模块', rationale: '时间不够', suspects: '迎合研发' }],
  jarvis_escalate: [{ role: '研发', problem: '第三方 API 无法连通', attempts: '重试过 5 次', risk: '影响今天上线', decisionNeeded: '是否降级方案', urgency: 'high' }],
  jarvis_capability: [{ task: '做 OCR 识别', existingTools: '无', marketSearch: 'github 上有 tesseract，star 高' }],
  jarvis_update: [{ mode: 'check', remoteUrl: 'https://127.0.0.1:1/nonexist.git' }],
  jarvis_think: [{ question: '库存模块怎么设计', roleCard: CARD }],
  jarvis_think_deep: [{ question: '该不该全量回归', roleCard: CARD, stakes: 'high', force: true }],
  jarvis_fidelity: [{ role: 'CEO', card: CARD }],
  jarvis_collab: [{
    requirement: '库存同步模块', rolesJson: '[{"name":"产品","duty":"定义需求"},{"name":"研发","duty":"实现"}]',
    collabText: '产品在上游依赖用户调研，研发在下游并行，位置=并行，介入时机=需求明确后，协同方式=实时讨论+阶段交接，分歧升级 CEO',
  }],
  jarvis_perf: [
    { role: '研发', stageStatus: 'due', stageRequirement: '完成登录模块', quality: '2', completion: '0', escalation: '2', fit: '1', depth: '80', history: '[{"ok":true}]' },
    { role: '研发', stageStatus: 'pending', stageRequirement: '登录模块' },
    { role: '研发', stageStatus: 'in_progress', quality: '1', completion: '1', escalation: '0', fit: '1', depth: '70', history: '[{"ok":false}]' },
    { role: '研发', stageStatus: 'due', stageRequirement: '登录模块', quality: '0', completion: '0', escalation: '1', fit: '1', depth: '80' }, // BUG-1: 无 history 也返回 historyNext
    { role: '研发', stageStatus: 'due', stageRequirement: '发票OCR准确率95%', quality: '2', completion: '2', escalation: '2', fit: '2', depth: '90', alignment: '0' }, // 需求对齐度: 偏离=一票否决换人
  ],
  jarvis_meeting: [{ meetingType: 'kickoff', agenda: '对齐目标与接口契约', attendees: 'CEO,研发,测试', context: '黑板有 2 条未决' }],
  jarvis_release: [
    { mode: 'rollback', version: 'v1.1', rollbackTo: 'v1.0', rollbackReason: '决策失误', prevVersions: '[{"version":"v1.0","state":"已确认"},{"version":"v1.1","state":"待确认"}]' },
    { mode: 'rollback', version: 'v1.1', rollbackTo: 'v1.0' },
    { mode: 'rollback', version: 'v1.0', rollbackTo: 'v0.9', rollbackReason: '决策失误', prevVersions: '[]' }, // BUG-7: 空历史拒绝假回滚
    { mode: 'checklist', version: 'v1.0', requirement: '库存同步', items: '["模块A","模块B"]', selfTest: '通过' },
    { mode: 'communication', question: '是否接受延迟一周', answer: '接受' },
    { mode: 'new_version', version: 'v1.1' },
    { mode: 'status', version: 'v1.1', prevVersions: '[{"version":"v1.0","state":"已确认"}]' },
  ],
  jarvis_board: [
    { board: '{"items":[{"id":"B1","type":"阻塞","content":"接口文档缺失","status":"open"}]}', add: '阻塞: 供应商 API 连不上\n风险: 可能延期', resolve: 'B1', audited: 'B2', role: '研发' },
    { board: '', add: '决策: 采用双仓方案', role: 'CEO' },
  ],
  jarvis_company: [
    { mode: 'snapshot' },
    { mode: 'update', employees: '[{"id":"e1","role":"研发","persona":"Martin Fowler","status":"working"}]', meetings: '[{"id":"m1","type":"kickoff","status":"in_progress"}]', phase: '开发' },
    { mode: 'action', actionType: 'employee_terminated', role: '研发', note: '不达标' }, // 自动触发补位
    { mode: 'action', actionType: 'recruiting_interviewing', position: '测试' }, // searching→interviewing
    { mode: 'action', actionType: 'meeting_started', meeting: '{"id":"m2","type":"cycle","topic":"对齐","attendees":["研发","测试"]}' }, // 参会员工联动
  ],
  jarvis_coverage: [
    {
      label: '收口核查',
      source: JSON.stringify([{ id: 'R1', title: '需求一' }, { id: 'R2', title: '需求二' }]),
      targets: JSON.stringify({ '方案': [{ id: 'D1', refs: ['R1'], status: 'completed', evidence: '有' }, { id: 'D2', refs: ['R2'], status: 'completed', evidence: '有' }] }),
    },
    {
      source: JSON.stringify([{ id: 'R1', title: '需求一' }, { id: 'R2', title: '需求二' }]),
      targets: JSON.stringify({ '方案': [{ id: 'D1', refs: ['R1'], status: 'completed', evidence: '有' }] }), // R2 漏覆盖 → 打回
    },
  ],
  jarvis_taskgraph: [
    {
      requirement: '库存同步模块',
      tasksJson: JSON.stringify([
        { id: 'T1', title: '方案设计', assignee: '架构', acceptance: '输出方案文档含接口契约', deps: [] },
        { id: 'T2', title: '后端实现', assignee: '研发', deps: ['T1'], inputs: ['来自T1接口契约'], acceptance: '接口过集成测试' },
        { id: 'T3', title: '测试验收', assignee: '测试', deps: ['T2'], inputs: ['T2产物'], acceptance: '按测试单逐条通过' },
      ]),
    },
    { tasksJson: '[{"id":"T1","title":"A","assignee":"甲","deps":["T2"],"acceptance":"产出A"},{"id":"T2","title":"B","assignee":"乙","deps":["T1"],"acceptance":"产出B"}]' }, // 循环依赖打回
    { tasksJson: '[{"id":"T1","title":"方案","assignee":"甲","acceptance":"出方案"},{"id":"T2","title":"实现","assignee":"乙","deps":["T1"],"inputs":["来自T9的接口"],"acceptance":"过测"}]' }, // 输入来源悬空打回
  ],
  jarvis_clarify: [
    { mode: 'analyze', requirement: '做一个库存管理系统', industry: '供应链' },
    { mode: 'trigger', requirement: '需要符合 OEE 规范的生产排程系统', candidates: '候选人是什么场景\n现在怎么做' },
    { mode: 'ask', requirement: '库存系统', candidates: '场景1\n现状2\n痛点3\n期望4\n验收5', round: '2' },
    { mode: 'duo', roleCards: 'CEO 卡\n供应链大佬卡', round: '1' },
    { mode: 'confirm', userAnswers: '用户确认：给采购部门用，解决库存不准的问题，以盘点误差低于1%为成功' },
  ],
}

let totalCases = 0, violations = 0, crashes = 0, errors = 0
for (const def of TOOLS) {
  const { handler, ...rest } = def
  const tool = defineTool({
    ...rest,
    parameters: normalizeParameters(rest.parameters),
    output: { schema: normalizeOutputSchema(rest.output && rest.output.schema), render: wrapRender(rest.output && rest.output.render) },
    execute: handler,
  })
  const cases = CASES[rest.name] || [{}]
  for (let ci = 0; ci < cases.length; ci++) {
    totalCases++
    try {
      const value = await handler(cases[ci])
      const v = validateJsonSchemaValue(tool.output.schema, value, 'value')
      if (v.length) {
        violations++
        console.log('VIOLATION |', rest.name, '| 用例', ci, '|', v.join(' ; '))
        continue
      }
      const rendered = tool.output.render(cases[ci], value)
      const content = [{ type: 'tool-result', toolCallId: 'x', content: rendered, isError: false }]
      try { contentHasImage(content) } catch (e) {
        crashes++; console.log('CRASH |', rest.name, '| 用例', ci, '|', String(e.message || e).slice(0, 50)); continue
      }
    } catch (e) {
      errors++
      console.log('ERR  |', rest.name, '| 用例', ci, '|', String(e.message || e).slice(0, 80))
    }
  }
}
console.log(`\n=== ${totalCases} 用例 | VIOLATION=${violations} CRASH=${crashes} ERR=${errors} ===`)
if (violations + crashes + errors > 0) {
  console.log('✗ 存在宿主必拒问题——不要部署，先修复')
  process.exit(1)
}
console.log('✓ 全绿，可安全部署')
