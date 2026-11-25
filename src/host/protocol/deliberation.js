// 开工推演协议（D-deliberation）——用户定调：每个员工做事前都要像人脑一样先推演，
// 想多方案、最后找出最好方案，再动手。
//
// 为什么做成共享模块：开工推演要求要同时接进三条派单路径——
//   ① 新执行器（adapters/dsh-executor.js，jarvis_ticket 开单即派的成员简报）；
//   ② agent-teams 路径（tools/review.js 的 jarvis_member_brief 成员须知）；
//   ③ 协议正文（protocol/index.js，captain 盯控口径）。
// 三处引用同一份文本 = 单一事实源，改一处全生效。
//
// 设计边界（v0.16 反转·用户定调 2026-11-19）：
//   • 旧口径「不要求调用 ponder，满血十阶段留给 complex」已被证伪——执行器从未
//     接过高赌注那条路，结果所有成员一律走轻量四步，ponder 事实上全公司没人跑。
//   • 新口径是三档分级（见 PONDER_TIER / ponderTierOf）：档位在**派活时**由任务单
//     定死，成员不能自评降档（模型一定会把自己归为"简单"，这是分级失效的根因）。
//       - easy-direct：免 ponder，用本推演四步 + 30 秒自检替代（成本优先，且可核验）
//       - standard  ：必跑 ponder 十阶段（各阶段 agent 数可精简，但阶段一个不能少）
//       - complex   ：必跑 ponder 满血十阶段 + synthesis 含可谬自评
//     轻量四步（MEMBER_DELIBERATION）**不分档位人人必做**；ponder 是在此之上的深度层。
//   • 可机械核验：回报里必须能看到「方案对比 + 择优理由」；standard/complex 另需
//     .jarvis/docs/ponder-verify/<taskId>-*.json 且 verdict=PASS（见 gates/audit.js
//     的 checkPonderVerify，已接回 close 收口闸）。easy 档凭任务单 route 字段豁免。
//   • 审计标记 DELIBERATION_MARK 供 jarvis_member_brief audit 模式复用。

export const MEMBER_DELIBERATION = [
  '⚡ 开工推演（动手前必做，像人脑：先想后做）——',
  '写代码/出文档之前，先在脑内走完四步，并把推演结果写进第一份回报（或 .jarvis/ponder-runs/<run_id>/deliberation.md）：',
  '1) 审题（1-2 句）：这件事真正要什么？验收标准怎么判"做对了"？',
  '2) 多方案：列至少 3 个可行做法（含一个最省事的、一个最稳的），各写关键取舍（成本/风险/依赖）。',
  '3) 择优推演：逐案想"做了之后会发生什么"（对验收、对下游依赖、对现有基线的影响），选出最优——写清为什么选它，落选的各给一句话死因。',
  '4) 复盘：按选定方案干，干完对照"当初推演的预期"复盘一句（预期 vs 实际，偏差原因）。',
  '判据：回报里看不到「方案对比+择优理由」= 没推演 = 打回重想。复杂/高赌注再上满血 ponder 十阶段；本推演是脑内动作，不需要任何工具。',
].join('\n')

/** 审计标记：任务描述/回报里出现任一特征 = 该单带了开工推演要求。 */
export const DELIBERATION_MARK = /开工推演|方案对比|择优|deliberation|多方案/

// ── 阶段思考闸（D2-stage-gate）——用户定调：不是只开工前想一次，每个阶段都要思考后再往下走。
// 类比软件工程：业务理解 → 架构选型 → 设计模式 → 数据结构 → 具体实现 → 自查，
// 每一步动手前都有该阶段的思考点；其他领域同理（领域阶段由 jarvis_process 定，思考闸跟着阶段走）。
export const STAGE_DELIBERATION = [
  '🧭 阶段思考闸（每个阶段开始前必过，不是只开工想一次）——',
  '任务不会一步做完：每进入一个新阶段（理解需求→方案设计→搭建骨架→具体实现→自查交付…），动手前先过本阶段三问，并把思考结果一句话写进该阶段的回报：',
  '1) 本阶段业务目标：上游给我什么、我要给下游什么？这一步在整个业务里解决什么问题（结合业务场景，不孤立看）？',
  '2) 本阶段选型：这一步有哪些可选做法？像开发选架构/设计模式/数据结构一样——先想清楚"用什么"，再想"怎么用"。',
  '3) 过闸标准：做到什么样才算本阶段过关、可以进下一阶段？过关才往下走，不过关回上一问。',
  '软工示例（其他领域按各自流程类比）：写代码前先想业务用什么开发架构；架构定了想设计模式；做具体功能前想数据结构——每个阶段都是"先思考，后动手"。',
  '判据：回报里看得到每个阶段的「选型+理由」才算过了闸；跳阶段直接干 = 打回。',
].join('\n')

/** 审计标记：阶段闸特征。 */
export const STAGE_MARK = /阶段思考|过闸|选型|架构|设计模式|数据结构|stage.?gate/i

// ── 卡点开会协议（D3-escalation）——用户定调：有疑问点自己无法通过时，拉上涉及的人员开会，
// 生成会议纪要，这才叫谨慎。会议机制用现成的 jarvis_meeting（纪要落盘 .jarvis/meetings/）。
export const STUCK_MEETING = [
  '🤝 卡点开会（疑问自决不了时必须做，不许硬猜）——',
  '出现以下任一情况，就是"自决不了"：同一个卡点两种办法都走不通 / 需要别人的产出或确认才能继续 / 你的改动会影响别人接口或上游需求 / 同一问题尝试两次仍失败 / 发现需求本身有矛盾。',
  '此时禁止：硬猜着继续干、无脑重试空转、闷头造一个结论交差。',
  '必须做：用 jarvis_meeting（meetingType=cycle，groupchat=true）拉上涉及的成员和 captain 开会——议题写清卡在哪、试过什么、需要谁给什么；会上逐人给观点、互相评价；散会必须产出纪要（落盘 .jarvis/meetings/，含结论+会后行动项：谁负责什么）。',
  '会议结论和行动项写进下一份回报；按会上定的方案继续干活。开会是谨慎，不是失败——硬猜出活才算失败。',
].join('\n')

/** 审计标记：卡点开会特征。 */
export const STUCK_MARK = /卡点开会|开会|jarvis_meeting|会议纪要|minutes|cycle/i

// ── ponder 三档分级（v0.16）——用户定调：每个员工思考时必须用 ponder。
//
// 为什么必须分档而不是一刀切：
//   十阶段管线对「改一行文案」是灾难（十几个子 agent、几分钟、几万 token），
//   而且会诱导成员跑空管线应付差事——形式主义比不跑更糟。
//   所以：成本优先的单免跑，其余必跑，高赌注加码。
//
// 为什么档位由任务单决定而不是成员自评：
//   模型看自己的任务一定觉得"这个很简单"——这是分级失效的根因（旧口径翻车的实证）。
//   档位在派活时写进 ticket.meta.route（或 ticket.stakes），成员只能按给定档执行。
export const PONDER_TIER = {
  EASY: 'easy-direct',      // 免 ponder，轻量四步 + 自检三条
  STANDARD: 'standard',     // 必跑十阶段，阶段数不可减
  COMPLEX: 'complex',       // 满血十阶段 + 可谬自评
}

// ── 外部检索纪律（v0.19）——用户定调 2026-11-25：
//   「jarvis 一定要少用模型内的资料，需要去互联网上查资料得结论」
//   「不要固定死用哪些工具，万一后面有更好的呢？」
//
// 这两条合起来的意思是：**要求是"必须外部查证"，但不许绑定具体工具名**。
// 因为工具会变（DSH 可能换搜索 provider、团队可能装别的检索插件、将来可能有更好的），
// 写死 "必须调用 web_search" 会在工具换代后变成一句永远满足不了的空话。
//
// 所以这里只写「能力判据 + 降级纪律」：
//   ① 先探测：当前环境有哪些能访问外网的手段（不预设名字）
//   ② 有就用，用时在回报里写清"用了什么、查到什么、来源在哪"
//   ③ 没有 → 明确标注「受限环境推演」，禁止把模型记忆当查证结果
//
// 为什么这条必须存在：模型默认倾向用训练数据里的记忆作答，而且说得头头是道。
// 对一个数字员工公司来说这是致命的——客户要的是"查过的事实"，不是"模型觉得"。
// ⚠️ 必须在 tierGuidance 之前定义（后者引用它，const 有 TDZ 约束）。
export const EXTERNAL_RESEARCH = [
  '🔎 外部查证纪律（硬要求，不是建议）——',
  '本公司的结论必须建立在**外部可核实的事实**上，不能只靠模型记忆。下面的规则对所有档位生效：',
  '',
  'A. 先探测能力，再决定手段（**不要预设工具名**）：',
  '   环境里可能提供不止一种联网方式——可能是某个检索工具，可能是抓取工具，',
  '   也可能只是命令行里的 curl/wget。工具会变，所以要按**能力**找，不要按名字找。',
  '   探测顺序建议：① 列出当前会话可用的工具，看有没有访问外网的检索/抓取能力；',
  '   ② 没有的话，用命令行直接访问公开网页/接口（存在 curl/wget 即可）；',
  '   ③ 两者都没有，才进入降级（见 D）。',
  '   ⚠️ 注意区分：**本地文件搜索**（在工作区/代码库里找东西）不算外部查证，那是内部检索，不能用来证明外部事实。',
  '',
  'B. 查到什么，就报什么（可核验）：',
  '   回报里必须写清三样：用的是什么手段、查到的事实是什么、来源在哪（URL/文档名/版本号）。',
  '   只写结论不写来源 = 视为没查（派活方会按"未外部查证"打回）。',
  '',
  'C. 冲突时以外部为准：',
  '   模型记忆与查到的资料冲突时，**以查到的为准**，并在结论里更正自己的旧认知。',
  '   （模型记忆有过时风险：价格、版本、接口、政策这类尤其容易过时。）',
  '',
  'D. 查不了必须说出来（禁止编造）：',
  '   如果环境确实无法访问外网：在回报里明确标注「受限环境推演 · 未外部查证」，',
  '   并说明哪些结论属于**推演**而非**核实**。',
  '   ⛔ 绝对禁止：把模型记忆包装成"我查过了"；用模糊表述蒙混（"据资料显示"却不给来源）。',
  '   降级不丢人，编造才丢人——客户按"是否标了受限"来判断可信度，标了就还能用。',
].join('\n')

/** 从任务单推断档位。缺省 standard（宁可多跑一次深度思考，也不要"应该思考时没思考"）。
 *  兼容存量单：没有 route/stakes 字段时按 standard 处理，不因缺字段卡死。 */
export function ponderTierOf(ticket) {
  const t = ticket || {}
  const meta = t.meta || {}
  const route = String(meta.route || meta.difficulty || '').trim().toLowerCase()
  if (route === PONDER_TIER.EASY || route === 'easy') return PONDER_TIER.EASY
  if (route === PONDER_TIER.COMPLEX || route === 'complex') return PONDER_TIER.COMPLEX
  if (route === PONDER_TIER.STANDARD || route === 'standard') return PONDER_TIER.STANDARD
  const stakes = String(meta.stakes || t.stakes || '').trim().toLowerCase()
  if (stakes === 'high') return PONDER_TIER.COMPLEX
  if (stakes === 'low') return PONDER_TIER.STANDARD   // 低赌注也跑标准档：阶段可精简但不可少
  return PONDER_TIER.STANDARD
}

/** 该档位是否要求真跑 ponder（免跑档返回 false → 收口闸凭此豁免）。 */
export function tierRequiresPonder(tier) {
  return String(tier || '') !== PONDER_TIER.EASY
}

/** 按档位生成「思考要求」正文，注入成员简报与续接线索。
 *  三档文本各自完整可执行——成员不需要知道别的档位存在。
 *  外部查证纪律（EXTERNAL_RESEARCH）对所有档位都追加——查证不分赌注高低。 */
export function tierGuidance(tier) {
  const t = String(tier || PONDER_TIER.STANDARD)
  if (t === PONDER_TIER.EASY) {
    return [
      '🎚 本单档位：easy-direct（免跑 ponder，成本优先）——',
      '本单是模式化/可逆/有现成做法的活，不值得十阶段深思考。直接按角色卡方法论与任务描述执行。',
      '但仍必须做「30 秒自检三条」并写进回报：① 前提有没有没验证的？② 最可能错在哪？③ 谁会受影响？',
      '⚠️ 升级路径：动手后发现新颖/不可逆/多方耦合/牵一发动全身 → 立即停下，用 jarvis_ticket action=report state=blocked 上报「本单需要升级为 standard 档，理由：…」，等 captain 重派。',
      '  **升级不算返工，硬撑着不升级才是返工。**',
      '',
      EXTERNAL_RESEARCH,
    ].join('\n')
  }
  const full = t === PONDER_TIER.COMPLEX
  return [
    `🎚 本单档位：${t}（必须真跑 ponder 十阶段，留可核验记录）——`,
    '这是必须做的硬要求，不是建议：本单完成前必须在 .jarvis/docs/ponder-verify/ 留下 PASS 核验记录，收口时会逐单核查。',
    '执行方式（成员是 depth-1 子 agent，起不了孙 agent，必须走 SOLO 自模拟）：',
    '  1) export PONDER_DATA_DIR="<工作区>/.jarvis/ponder-runs/<你的 run_id>/"   （per-run 隔离，禁止多人共用一份 step-guard.json）',
    '  2) export PONDER_SOLO=1                                                    （成员会话必加；否则 8 维/5 方案起不来）',
    '  3) node <ponder技能>/scripts/step-guard.cjs init "<本次问题>"',
    '  4) 十阶段顺序执行，每阶段 before/after 记录：',
    '     interview → shensi → divergence → bagua → plans → converge → score → simulate → debate → synthesis',
    '     （严格按序，不得乱序、不得合并、一个阶段都不能少；SOLO 模式下按 stages/<阶段>.json 逐维度自模拟成文）',
    '  5) node <ponder技能>/scripts/step-guard.cjs verify <run_id> --evidence "$PONDER_DATA_DIR"',
    '     只有 verdict=PASS 才允许上报「ponder 已完成」；FAIL 先补齐再交。',
    full ? '  6) complex 档额外要求：synthesis 必须含可谬自评（本结论最可能因为什么错？若错改走什么方向？）' : '',
    '回报时必须带回三样：run_id、PONDER_DATA_DIR（数据目录绝对路径）、阶段产出目录——',
    ' captain 会用 jarvis_ponder_check(runId=…, dataDir=…, taskId=本单) 核验；核验 PASS 才落 ponder-verify 记录。',
    '⚠️ 降级唯一合法路径：ponder 技能确实不可用 → 在回报里写 skipReason 并标 blocked，由 captain 裁定；禁止静默跳过。',
    // 外部查证纪律：ponder 的 bagua/divergence 等阶段本来就要"查资料"，
    // 这条说明"用什么查、查不到怎么办"，避免成员在受限环境里凭空造结论。
    '',
    EXTERNAL_RESEARCH,
  ].filter(Boolean).join('\n')
}

/** 审计标记：所有档位文本里都出现的共同特征（用来判断成员简报是否带了思考要求）。 */
export const TIER_MARK = /本单档位|easy-direct|standard 档|ponder 十阶段|PONDER_SOLO|ponder-verify/

// ── 外部检索纪律（v0.19）——用户定调 2026-11-25：
//   「jarvis 一定要少用模型内的资料，需要去互联网上查资料得结论」
//   「不要固定死用哪些工具，万一后面有更好的呢？」
//
// 这两条合起来的意思是：**要求是"必须外部查证"，但不许绑定具体工具名**。
// 因为工具会变（DSH 可能换搜索 provider、团队可能装别的检索插件、将来可能有更好的），
// 写死 "必须调用 web_search" 会在工具换代后变成一句永远满足不了的空话。
//
// 所以这里只写「能力判据 + 降级纪律」：
//   ① 先探测：当前环境有哪些能访问外网的手段（不预设名字）
//   ② 有就用，用时在回报里写清"用了什么、查到什么、来源在哪"
//   ③ 没有 → 明确标注「受限环境推演」，禁止把模型记忆当查证结果
//
// 为什么这条必须存在：模型默认倾向用训练数据里的记忆作答，而且说得头头是道。
// 对一个数字员工公司来说这是致命的——客户要的是"查过的事实"，不是"模型觉得"。
export const EXTERNAL_RESEARCH_MARK = /外部查证|外部检索|受限环境推演|不要预设工具名|来源在哪/

/** 能力判据：判断某次工具调用是否属于「外部查证」。
 *  关键——用**能力特征**而非工具名：工具改名/换代后这套判据依然成立。
 *  覆盖三类：
 *    · 检索类：名字或描述含 search/检索/查询 且面向外网
 *    · 抓取类：名字或描述含 fetch/抓取/访问/ur 且是 http(s)
 *    · 命令行联网：bash/shell 里出现 curl/wget/http 请求
 *  明确排除本地文件搜索（那是内部检索）。 */
export function isExternalResearchCall(toolName, argsText) {
  const name = String(toolName || '').toLowerCase()
  const args = String(argsText || '').toLowerCase()
  // 本地搜索不算外部查证（用户明确区分过）
  if (/fs[-_]?search|glob|grep/.test(name) && !/https?:\/\//.test(args)) return false
  // 检索类
  if (/web[-_]?search|search[-_]?web|^search$|search_knowledge|检索|联网搜索/.test(name)) return true
  // 抓取类
  if (/web[-_]?fetch|fetch[-_]?web|^fetch$|crawl|browse|抓取/.test(name)) return true
  // 命令行联网：命令里出现对 http(s) 的访问
  if (/bash|shell|exec|terminal|pwsh/.test(name) && /curl|wget|https?:\/\//.test(args)) return true
  return false
}
