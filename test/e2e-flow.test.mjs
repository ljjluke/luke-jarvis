/**
 * luke-jarvis 完整流程端到端实测
 * 模拟用户输入「/jarvis 做一个下沉市场的拼团电商系统」后，CEO 沿完整链路执行：
 *   jarvis_project(识别行业) → 女娲式蒸馏 CEO 卡 → jarvis_distill(证据链硬闸)
 *   → jarvis_fidelity(保真度审计) → 定子角色 → jarvis_collab(协同四要素+全局健康) → 判定可建队
 * 同时验证"防迎合"：一张编造的卡必须被拦下。
 */
import { TOOLS, validateCardShape, jarvisCommand, identifyIndustry } from '../src/host/plugin.js'

const step = (title, fn) => {
  console.log(`\n━━━ ${title} ━━━`)
  return fn()
}
const jd = (n) => TOOLS.find((t) => t.name === n)

const ok = (label, cond) => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}`)
  return cond
}

let allOk = true

// ── 0. 入口：/jarvis 命令回执 ─────────────────────────────
step('0. /jarvis 入口（命令回执含完整 CEO 协议）', async () => {
  const r = jarvisCommand('做一个下沉市场的拼团电商系统，2人团24h成团')
  allOk = ok('命令回执无行业预设（领域无关）', !r.content.includes('行业识别：电商')) && allOk
  allOk = ok('回执包含证据链+保真度+协同+沉淀指令', r.content.includes('证据链') && r.content.includes('保真度') && r.content.includes('协同') && r.content.includes('jarvis_process') && r.content.includes('.jarvis/')) && allOk
  allOk = ok('回执包含女娲式铁律', r.content.includes('宁 60 分诚实')) && allOk
})

// ── 1. jarvis_project 需求分级 + jarvis_process 定流程（无领域预设）+ jarvis_store 沉淀 ──
step('1. jarvis_project 分级 + jarvis_process CEO 定制流程 + jarvis_store 项目沉淀', async () => {
  const r = await jd('jarvis_project').handler({ requirement: '做一个下沉市场的拼团电商系统，2人团24h成团' })
  console.log(`  分级=${r.suggestion}`)
  allOk = ok('分级建议而非行业预设', r.suggestion.includes('L')) && allOk
  allOk = ok('不返回具体行业（领域由 CEO 判断）', !/^电商$|^金融$/.test(r.industry)) && allOk
  // CEO 用 jarvis_process 定流程：插件无领域预设 → 给设计清单，CEO 逐项定
  const p = await jd('jarvis_process').handler({ industry: '电商', requirement: '下沉市场拼团电商系统' })
  allOk = ok('jarvis_process 不返回预设领域模板（customized 恒 true）', p.customized === true && p.designChecklist.includes('CEO')) && allOk
  // 项目沉淀：cards/ 结构、复用规则（本项目沉淀可复用 + 跨项目禁止）
  const st = await jd('jarvis_store').handler({ mode: 'scaffold' })
  allOk = ok('jarvis_store 项目沉淀结构（cards/ 角色卡沉淀在项目里）', st.structure.some((s) => s.includes('cards/'))) && allOk
  allOk = ok('复用规则：插件无静态卡', st.reuseRule.includes('插件无静态卡')) && allOk
})

// ── 2. 女娲式蒸馏 CEO 卡（完整证据链） ─────────────────────
const GOOD_CEO = [
  '身份定位：电商 CEO，负责下沉市场拼团电商的战略与团队。',
  '思维模型：第一性原理+供应链效率（跨域复现：在商品/渠道/获客均出现；生成力：可推断新品类打法；排他性：独特）。',
  '核心方法论：1) 有效GMV优先；2) 供应链效率是本质；3) 让利真实用户不被套利。',
  '代表作品：参考拼购模式与供应链整合的公开打法——只借鉴框架，不冒充署名。',
  '决策红线：虚假规模/刷单/套利冲量一票否决；绕过资金风控底线一票否决。',
  '语言风格：数据驱动、结论先行、直指本质。',
  '协同架构：位置=与风控/供应链并行、产品增长上游；依赖=产品需求与契约、供应链成本；介入时机=从立项全程参与；协同方式=用 send_message 实时讨论，冲突升级 jarvis_review/CEO 裁决（并行非串行）。',
  '证据链：著作(内部方法论) + 对话(2段访谈) + 表达(社媒) + 他者评价 + 决策记录(拼购案例) + 时间线——6维度达标。',
  '保真度：一手占比约0.7；矛盾点1处已保留（对规模与利润的立场存在张力，未和稀泥）。',
  '诚实边界：信息截止2026-08；无法预判全新问题；含推测成分已标注。',
  'source：https://example.com/ecommerce/interview',
  '防冒名声明：本角色卡借鉴其公开方法论，非其本人观点。',
].join('\n')

// ── 3. jarvis_distill 校验（合格卡应过） ──────────────────
step('3. jarvis_distill 证据链硬闸（合格卡）', async () => {
  const missing = validateCardShape(GOOD_CEO, true)
  const r = await jd('jarvis_distill').handler({ role: 'CEO', card: GOOD_CEO, isCeo: true })
  console.log(`  缺失=[] → verdict: ${r.verdict}`)
  allOk = ok('合格 CEO 卡通过（缺项为空）', r.ok === true && missing.length === 0) && allOk
})

// ── 3b. 编造的卡必须被拦（防迎合） ─────────────────────────
step('3b. 防迎合：编造的卡（假 source/无证据链）被拦', async () => {
  const FAKE = [
    '身份定位：虚拟大佬 CEO。','思维模型：自创玄学（无跨域复现）。','核心方法论：拍脑袋。',
    '代表作品：某未公开理论。','决策红线：无。','语言风格：空泛。',
    '协同架构：位置=并行；依赖=无；介入时机=现在；协同方式=各自完成。',
    'source：据内部消息，非URL',
  ].join('\n')
  const r = await jd('jarvis_distill').handler({ role: 'CEO', card: FAKE, isCeo: true })
  console.log(`  verdict: ${r.verdict}`)
  allOk = ok('编造卡被拦（不通过）', r.ok === false) && allOk
})

// ── 4. jarvis_fidelity 保真度审计 ─────────────────────────
step('4. jarvis_fidelity 保真度审计（合格卡）', async () => {
  const r = await jd('jarvis_fidelity').handler({ role: 'CEO', card: GOOD_CEO })
  console.log(`  评级=${r.rating} 一手占比=${r.firstHandRatio} 问题=${r.issues.length}个`)
  allOk = ok('评级 PRIMARILY-FIRST-HAND', r.rating === 'PRIMARILY-FIRST-HAND') && allOk
})

// ── 5. 定子角色 + jarvis_collab 协同设计（合格） ──────────
step('5. jarvis_collab 团队协同设计（合格：4角色/四要素/并行/升级）', async () => {
  const r = await jd('jarvis_collab').handler({
    requirement: '下沉市场拼团电商',
    rolesJson: JSON.stringify([
      { name: '产品增长', duty: '定义价值与增长' },
      { name: '供应链', duty: '备货与履约' },
      { name: '研发', duty: '实现交易与拼团' },
      { name: '风控', duty: '资金安全' },
    ]),
    collabText: '位置=产品增长上游、研发与测试并行、风控横向否决；依赖=产品给契约、研发给接口、供应链给成本；介入时机=风控与测试从立项全程；协同方式=并行实时 send_message 讨论，冲突升级 jarvis_review/CEO 裁决',
  })
  console.log(`  角色=${r.roles.join('/')} 问题=${r.issues.length}个 ok=${r.ok}`)
  allOk = ok('合格协同可建队', r.ok === true) && allOk
})

// ── 5b. 串行交接必须被拦 ─────────────────────────────────
step('5b. 防呆：串行交接被拦（应改并行）', async () => {
  const r = await jd('jarvis_collab').handler({
    requirement: '电商',
    rolesJson: JSON.stringify([{ name: '产品' }, { name: '研发' }, { name: '测试' }]),
    collabText: '位置=依次先后；依赖=前者完成后给后者；介入时机=依次；协同方式=先产品再研发最后测试（串行）',
  })
  console.log(`  问题=${r.issues.join(' | ')}`)
  allOk = ok('串行交接被拦', r.ok === false) && allOk
})

// ── 6. 深度思考 + 分歧裁决闭环（角色卡×ponder 轻量七段 → review 消费） ──
const roleCard = [
  '身份定位：风控负责人。',
  '思维模型：黑产对抗思维（先想最坏）。',
  '核心方法论：1) 最坏情况先于体验；2) 规则可解释。',
  '代表作品：参考公开风控框架——只借鉴框架。',
  '决策红线：资金安全一票否决。',
  '语言风格：先结论后风险。',
  '我的协同：我负责资金安全；从交易系统拿订单数据；给产品反馈拦截率；升级=分歧交 CEO/jarvis_review。',
  '证据链：著作+对话+表达+他者+决策+时间线。',
  '保真度：一手0.6；矛盾保留。',
  '诚实边界：信息截止；推测已标。',
  'source：https://example.com/risk/interview',
  '防冒名声明：只借鉴框架，不冒充署名。',
].join('\n')

step('6. jarvis_think_deep 深度思考（防幻觉多阶段）→ jarvis_review 裁决闭环', async () => {
  const t = await jd('jarvis_think_deep').handler({ question: '拼团是否支持虚拟拼单凑单？', roleCard, stakes: 'high' })
  allOk = ok('深度思考任务单七段齐全（前提/视角/反方/失效/真实核对/边界/收敛）',
    t.premises && t.counter.includes('当X时不成立') && t.respondAs.includes('JSON')) && allOk
  // 该角色"完成"思考并按格式产出结构化帧（模拟 LLM 按任务单思考后的结果）
  const thinkFrame = {
    premises: ['凑单能拉成团率：未验证', '虚拟身份可被拦截：待核对'],
    perspective: '最坏情况先于体验——虚拟拼单引入欺诈面',
    counter: ['当风控无法识别虚拟身份时不成立', '当用户真实参团率本就不足时不成立', '当拦截规则可被绕过时不成立'],
    failure: '若允许：黑产批量占库存，真实用户买不到',
    realityCheck: ['核对历史参团率', '核对黑产样本特征'],
    limits: '无法预判未来代收方式；推测已标',
    conclusion: '禁止虚拟拼单，除非真实核对通过且风控可拦截',
    confidence: 'high',
    escalateTo: 'CEO/jarvis_review',
  }
  const r = await jd('jarvis_review').handler({
    issue: '拼团是否支持虚拟拼单凑单？',
    sideA: '允许（增长视角，拉成团率）',
    sideB: '禁止（风控视角，资金安全）',
    thinkA: JSON.stringify({ counter: ['当真实用户不足时成团率不升反降'], realityCheck: ['核对真实参团率'], confidence: 'medium', conclusion: '允许但限频' }),
    thinkB: JSON.stringify(thinkFrame),
  })
  console.log(`  分析:\n${r.analysis}`)
  allOk = ok('裁决引用双方反方攻击', r.analysis.includes('当风控无法识别虚拟身份时不成立')) && allOk
  allOk = ok('裁决引用真实核对项', r.analysis.includes('黑产样本') || r.analysis.includes('参团率')) && allOk
  allOk = ok('裁判优先级铁律保留', r.basis.includes('真实情况 > 用户需求 > 专业判断')) && allOk
})

// ── 7. 问题上行 + 能力补足 + 黑板闭环（不许跳过/组件化）──
step('7. 问题上行→黑板阻塞→二次会闭环；能力补足组件化', async () => {
  // 研发遇到技术绕不开的问题 → jarvis_escalate 上报（带风险细节）
  const esc = await jd('jarvis_escalate').handler({
    role: '研发',
    problem: '秒杀扣库存与支付回调无法做到强一致，技术上绕不开',
    attempts: '已试本地消息表与事务消息，均不满足',
    risk: '不解决则库存超卖/支付回调丢失，资损与客诉，影响上线',
    decisionNeeded: '是否引入分布式事务中间件，或接受最终一致降级',
    urgency: 'high',
  })
  allOk = ok('完整上报单可上报（含风险细节+决策请求）', esc.ok && esc.boardEntry.startsWith('阻塞：')) && allOk
  // 上报写黑板 → 触发二次会
  const board = await jd('jarvis_board').handler({ role: '研发', add: esc.boardEntry })
  allOk = ok('黑板出现阻塞 → 必须二次开会', board.needsMeeting && board.blockers.length === 1) && allOk
  const cycle = await jd('jarvis_meeting').handler({ meetingType: 'cycle', agenda: '解决支付一致性阻塞', context: board.summary })
  allOk = ok('二次会（cycle）聚焦黑板未决项', cycle.goal.includes('黑板未决项') && cycle.protocol.includes('jarvis_essence')) && allOk
  // 能力不足 → jarvis_capability 三级路径（无市场 → 自研组件化）
  const cap = await jd('jarvis_capability').handler({ task: '分布式事务最终一致补偿', existingTools: '无', marketSearch: '' })
  console.log(`  能力补足决策: ${cap.decision.split('\n')[0]}...`)
  allOk = ok('缺能力 → 自研组件化路径 + 诚实边界', cap.decision.includes('自研') && cap.honestNote.includes('没有就是没有')) && allOk
})

// ── 汇总 ─────────────────────────────────────────────────
step('汇总', () => {
  console.log(allOk ? '\n🎉 端到端全流程通过：入口→识别→蒸馏(防迎合)→保真度→协同(防串行)→深度思考→裁决→问题上行→能力补足→黑板闭环→可建队' : '\n❌ 存在未通过项，见上方 ❌')
  console.log('流程完整性：13 个工具 + /jarvis 命令，各环节均有硬闸，链路闭环。')
  process.exit(allOk ? 0 : 1)
})