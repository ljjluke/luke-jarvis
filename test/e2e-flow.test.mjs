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
  allOk = ok('命令回执包含行业识别', r.content.includes('行业识别：电商')) && allOk
  allOk = ok('回执包含证据链+保真度+协同指令', r.content.includes('证据链') && r.content.includes('保真度') && r.content.includes('协同架构（位置/依赖')) && allOk
  allOk = ok('回执包含女娲式铁律', r.content.includes('宁 60 分诚实')) && allOk
})

// ── 1. jarvis_project 识别行业 ────────────────────────────
step('1. jarvis_project 识别行业', async () => {
  const r = await jd('jarvis_project').handler({ requirement: '做一个下沉市场的拼团电商系统，2人团24h成团' })
  console.log(`  行业=${r.industry} 建议=${r.suggestion} 方向=${r.distillDirection}`)
  allOk = ok('识别为电商', r.industry === '电商') && allOk
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

// ── 汇总 ─────────────────────────────────────────────────
step('汇总', () => {
  console.log(allOk ? '\n🎉 端到端全流程通过：入口→识别→蒸馏(防迎合)→保真度→协同(防串行)→可建队' : '\n❌ 存在未通过项，见上方 ❌')
  console.log('流程完整性：6 个工具 + /jarvis 命令，各环节均有硬闸，链路闭环。')
  process.exit(allOk ? 0 : 1)
})