# luke-jarvis 数字员工公司操作系统 · 改造方案（REFORM-PLAN）

> 版本：v1.5（2026-08-28，v1.5 修订：并入 **B36 前端贾维斯公屏显示入口**（用户实需：用户要看到贾维斯公屏内容）——新增 I10 改进项 + 专章 D（client 插件注册 UI slot 只读展示 .jarvis/board.json，DSH dsh-client-ui-slots 体系实证，P1 起步/P2 增强，渲染数=实存数验收））｜性质：**方案交付**（本单=出方案，不实施）｜依赖证据：T1 现状体检（架构师，全文件:行号引证，质量 t4 逐条复核通过）、T2 现代办公基准（办公体系专家）、T3 差距分析+目标架构（CEO）、T4 质量审视（质量，7 条反面问题）、贾维斯公屏 B1-B36。
> 贾维斯公屏编号以 captain 重编号后的最新号为准：B10-B12=目标架构裁决（CEO）、B13=ponder 接入（接口变更）、B14=质量风险（T4）、B15=分层升级（接口变更）、B16=CEO 贾维斯公屏翻译职责（接口变更）、B17=H2 行为断言修订（架构师+质量对质）、B18=质量对 ponder 三洞质问、B21=质量对分层三问质问。

---

## 〇、需求本质与成功标准

- **为谁**：luke-jarvis「数字员工公司操作系统」维护者/使用者（工作区 /opt/work/first）。
- **解决什么**：用户判断 luke-jarvis"除了财务商务这些，还有很多不足，不符合现代化办公的体系架构"——两大不足面：①领域覆盖单一（财务/商务之外缺企业办公领域）；②体系架构不符合现代化办公（组织/目标/知识/流程/协同/数据/治理/人才 + AI 数字员工特有维度缺失）。
- **怎样算成功（可判定）**：产出一份可执行改造方案：现状体检（真实引证）→ 办公基准 → 差距分析 → 目标架构 → 分阶段路线图 → 验收标准。本条即交付物本体（docs/REFORM-PLAN.md + 过程证据落 .jarvis/）。

---

## 一、现状体检摘要（T1 实据，质量 t4 复核 ✅）

**现状画像**：luke-jarvis v0.1.0 = DSH 的 Cordis 插件 npm 包，领域无关"数字员工公司操作系统"。五层架构：/jarvis 命令（plugin.js:1325-1332）→ skills/jarvis.md（唯一入口，212 行）→ 两层角色（Jarvis 主面板 / CEO 带队）→ 17 个 jarvis_* 工具（plugin.js:242-1307）→ agent_teams 编排 + <项目>/.jarvis/ 记忆库。历史真实战绩：报销审批（财务，发现 3 真实缺陷）、电商测试（商务）、技术基建、UI 主题、量化金融、供应商接入。

**实测基线**（我亲手复核）：单测 61/61 通过；selfcheck 11 项；e2e-flow 通过但为直调 handler 仿真。

### 1.1 硬缺陷（P0/P1）

| 编号 | 级别 | 缺陷 | 证据 |
|---|---|---|---|
| H1 | P0 | **系统级状态零持久化**：全插件无任何 fs 操作（grep 实测 0 命中）；jarvis_store save 只返回路径（:363-370）、jarvis_board 纯函数靠调用方回传整个 JSON（:1240-1305，ID 按数组长度重算、无并发写保护）、jarvis_release 无落盘（:1167-1177）、jarvis_perf history 靠入参（:1014）——"沉淀/贾维斯公屏/版本"是口头契约非系统特性 | plugin.js 全局 0 fs；**贾维斯公屏并发写 ID 冲突已在本次团队运行中实证**：captain 并发写重编号 B13-B15 + 质量连续 4 次追加贾维斯公屏撞 ID（重编号 B22-B26）——现场实证非推演 |
| H2 | P1 | **绩效换人单信号误触发 + 历史记账双失配**（B17 复现实锤，行为断言）：①`action = !okThis && (isTriggered \|\| totalStrikes>=2) ? 换人`（:1051）→ **escalation=0 即首判换人**，其余全优（score=69）也不例外；②`(isTriggered?1:1)` 恒真死代码（:1050）、strikes 未用（:1049）；③场景1：history=[F,F]+本次全优 → score=100 → action=继续，**达标即清零历史**，两次旧败被忽略；④场景2：fail,pass,fail 非连续 → totalStrikes=3 → 换人，**旧账按全量累计非"连续2次"语义**（实测注入复现） | plugin.js:1044-1057；实测直调复现 |
| H3 | P1 | **essence 审计闸可绕过**：board resolve() 关闭条目不检查 essenceChecked（:1277-1280）；needsMeeting 只看阻塞/未决数（:1290-1294），未审计决策仅以提示形式附加（:1302-1303）——"决策必过需求本质审计定稿"是口头闸 | plugin.js:1270-1305 |

### 1.2 软问题（S1-S6）

S1 文档-代码数量漂移成习惯（RELEASE.md:6 写"14 工具"实 17；README.md:42 写 14、:88 写 17 自相矛盾；ARCHITECTURE.md:4 写"62/62、12/12"实 61/11）；S2 "端到端"名不副实（e2e-flow.test.mjs:8 直调 handler 按剧本，不经过真 DSH 会话/agent_teams/.jarvis 文件系统）；S3 client 插件空壳（src/client/plugin.js:7-9 `apply(ctx){}`，preset 宣称"两层架构"却无任何 UI）；S4 死代码/空分支（checkCollabHealth roleCount 分支空体 :46-48、perf 恒真三元+未用变量）；S5 需求分级只按字符长度（:271 len≤5→S、<40→M、否则→L；identifyIndustry 恒返回占位行业 :1313-1322）；S6 防编造硬闸是关键词正则可一句话绕过（:168 查证痕迹=/查证|核实|搜索|检索…/；作者已在 :113-116 声明边界=诚实防御性设计，**非缺陷，方案保留并明写边界**）。

### 1.3 领域覆盖缺口（C1-C8）

已服务：财务/电商/技术基建/UI 主题/量化金融/供应商接入（.agent-teams/ 6 团队 + archive 3）；.jarvis-roles/domains/ 仅 5 域（software-dev/ecommerce/data-science/marketing/product-growth）。缺：C1 目标与绩效管理（OKR）；C2 企业知识库（SSOT，.jarvis/=项目记忆非企业知识）；C3 通用审批流/合规审计（历史只做过"报销"业务域）；C4 数据报表与经营分析（perf 信号全靠 CEO 手工 0-2 分 :1008-1014）；C5 会议纪要/行动项追踪（jarvis_meeting 是模板生成器 :1096-1121）；C6 权限与访问治理（无权限矩阵/最小权限/审计）；C7 人才与组织管理（有换人机制无岗位/编制/胜任力系统）；C8 实体行业（制造/法务/教育/医疗等）空白。

### 1.4 体系架构缺口（D1-D10，对照 T2 八支柱）

D1 组织=无常设组织仅按单建临时团队；D2 目标=无 OKR/目标-任务-产出追溯；D3 知识=无 SSOT 无检索无版本；D4 流程=jarvis_process 只出五要素文本（:434-447）无流程实例状态；D5 审批=无通用审批 jarvis_review 裁决不落盘（:578-609）；D6 文档=无文档系统靠"写入 project.md"提示（skill:167）；D7 数据=无可观测指标源；D8 权限=无权限模型 essenceChecked 可绕过（H3）；D9 会议=无纪要/行动项/会议指标；D10 异步=无异步决策记录机制。

---

## 二、现代化办公基准（T2，判据全部可证伪）

**八大支柱**：①目标管理（OKR，目标-任务-产出可追溯）；②最小自治单元组织（常设组织结构清晰）；③SSOT 知识库（检索命中≥8/10、有版本）；④流程状态可查（审批链≤2 级、状态可查）；⑤异步协同（异步优先、会议是最后手段）；⑥数据看板（指标可观测）；⑦最小权限+审计（决策闸不可绕过）；⑧绩效透明+反加班（绩效=可重放证据链、依据公开、误报不换人）。

**AI 数字员工公司特有 7 维**（含现有雏形离基准的距离判定）：①任务可观测=release 契约已具备（近基准）；②绩效可复核=jarvis_perf 有工具但指标定义/公开未见（中距）；③人机协作边界=缺书面边界文档（远距）；④能力组件复用库=jarvis_capability 三级路径已具备但缺验收记录（近基准）；⑤领域知识沉淀=.jarvis 存在但缺"被检索复用"证据与领域/项目分层（中距）；⑥真实性治理=distill 防冒名闸已超基准；⑦记忆治理=系统级状态无持久化（远距，即 H1）。

---

## 三、差距分析表（T3：18 行，每行有证据链）

满足率统计：18 维达标（近/超基准）仅 4 项，真差距 13 项——T2"满足率<60% 即真差距"判据成立，改造需求确凿。

| # | 支柱/体系维度 | 现代基准（T2） | 现状（T1） | 差距定性 | 证据 | 补法方向 |
|---|---|---|---|---|---|---|
| 1 | 目标管理(OKR) | 目标-任务-产出可追溯、每目标可判定验收 | 无 OKR 工具；仅"需求本质+验收标准"；jarvis_perf 只评数字员工 | 缺失 | T1-C1/D2；skills/jarvis.md:40-45 | 新增 jarvis_okr |
| 2 | 最小自治单元组织 | 常设组织/自治单元、编制可见 | 仅按单建临时团队+换人，无 org 层 | 缺失 | T1-D1；skills 阶段四/六 | 新增 org 载体(.jarvis/org.json)+preset 扩展 |
| 3 | SSOT 知识库 | 单一事实源 Wiki、检索≥8/10、有版本 | .jarvis/=项目记忆；无检索/索引/版本；文档数字自相矛盾(62/61/26) | 缺失（错位：有"记忆"无"知识"） | T1-H1/S1/D3/C2；实测单测 61/61 | 新增 jarvis_wiki+检索 |
| 4 | 流程状态可查 | 流程实例有状态、走到哪步可查 | jarvis_process 只出五要素文本+占位骨架 | 缺失 | T1-D4；plugin.js:434-447 | 改进 process→jarvis_flow(实例状态) |
| 5 | 审批≤2级可查 | 通用审批流、链≤2级、状态可查、裁决落盘 | 无通用审批；review 裁决只返回文本；H3 闸可绕过 | 缺失 | T1-D5/H3；plugin.js:578-609、1277-1280 | 新增 jarvis_approval |
| 6 | 文档沉淀 | 交付物库化、版本化可回看 | 无文档系统；靠"写入 project.md"提示；client 空壳无 UI | 部分 | T1-D6/S3；src/client/plugin.js:7-9 | 新增文档载体+改进 release 落盘 |
| 7 | 数据看板 | 指标采集/报表/看板可观测 | 无指标源；perf 信号全靠 CEO 手工打分 | 缺失 | T1-D7/C4；plugin.js:1008-1014 | 新增 jarvis_metrics |
| 8 | 异步优先+会议纪律 | 异步决策公开可查；会议有纪要/行动项/指标 | meeting 是模板生成器；无纪要/行动项/决策时延指标；全靠实时文本流 | 缺失 | T1-D9/D10/C5 | 新增 jarvis_async+改进 jarvis_meeting |
| 9 | 最小权限+审计 | 权限矩阵、审计日志、决策闸不可绕过 | 无权限模型；成员即全部权限；essenceChecked 可被 resolve 关闭绕过 | 缺失 | T1-D8/C6/H3；plugin.js:1270-1305 | 新增 jarvis_iam |
| 10 | 绩效透明+反加班 | 绩效=可重放证据链且公开、误报不换人 | jarvis_perf 工具在但 H2 单信号误触发换人、指标人工、依据不公开 | 部分（工具在、逻辑错） | T1-H2/C7；plugin.js:1002-1059 | 改进 jarvis_perf 触发逻辑 |
| 11 | 成果可观测性 | 任务有完成定义可判"做完了" | release 契约已具备 | 近基准 | T2-B5；plugin.js:1135+ | 保留+补 e2e 真集成 |
| 12 | 绩效可复核 | 绩效=证据链可重放且公开 | 同 10 缺证据链落盘(perf history 靠入参 :1014) | 部分 | T1-H1/H2 | 改进：证据链随 jarvis_state 落盘 |
| 13 | 人机协作边界 | 书面边界文档（人闸/机器自主） | 无任何书面边界文档 | 远距缺失 | T2-B5-⑤；全库无 boundary 文档 | 新增 docs/BOUNDARIES.md |
| 14 | 能力组件复用库 | 组件有版本/验收/复用记录 | jarvis_capability 三级路径近基准但缺验收记录落盘 | 部分近基准 | T2-B5-③；plugin.js:719+；质量 R5 | 改进 capability 落盘验收记录 |
| 15 | 领域知识沉淀 | 知识被检索复用+领域/项目分层 | .jarvis/ 存在但缺检索复用证据；prototypes/ 仅本次 4 个 HTML | 部分中距 | T2-B5-④；T1-C8 | 改进 jarvis_store 加检索索引 |
| 16 | 真实性治理 | 防编造/防冒名闸有效 | distill 防冒名+source https+黑名单=超基准；S6 正则可绕（作者已声明边界） | 超基准（已知边界） | T2-B5-⑥；T1-S6 | 保留+明写边界 |
| 17 | 记忆治理（持久化） | 系统级状态真实落盘、原子写、并发安全 | 全插件 0 fs；store/board/release/perf 均纯函数靠模型自觉；board ID 按长度重算无并发保护 | 缺失（P0） | T1-H1（grep 0 命中）；plugin.js:1240-1305；**本次并发写 B13-B15 + 质量连撞 4 次 ID（B22-B26）实证** | 新增 jarvis_state 统一持久化层 |
| 18 | 领域覆盖（财务/商务之外） | 现代办公全领域覆盖 | 已服务 6 类、缺 8 类（OKR/知识库/通用审批/报表/会议行动项/权限/人才组织/实体行业） | 缺失 | T1-C1-C8；.jarvis-roles/domains 仅 5 域 | 靠 14 组件化+15 知识沉淀机制扩展（非每次现场蒸馏） |

---

## 四、目标架构：四象限（T3 B10-B12 + 需求变更 B13/B15 并入）

### 保留（6）
17 工具体系语义 / 蒸馏双闸（distill 结构+深度、fidelity 保真）/ 领域无关设计 / 项目沉淀理念（.jarvis/）/ 61 项单测基线 / release 契约（版本-清单-留痕）。

### 改进（8 = 原有 6 + B13 ponder 接入 + B15 分层升级；另 I9 B16 翻译职责 + 专章 C B22 可行性闸 = 流程类改进见专章）

| 改进项 | 内容 | 载体 | 验收 |
|---|---|---|---|
| I1 jarvis_perf 触发逻辑（H2） | 删恒真三元+未用 strikes；**先定行为规范（质量 R7，B17 修订版）**：①首次异常（escalation=0 单信号）=评估+补强观察，不换人；②换人触发=连续 2 次不达标；③"连续"语义=最近历史序列中不达标计数，**单次全优不清零旧账**（修复 B17 场景1）；④历史记账按最近窗口（如近 3 次）判定，修 B17 场景2 全量累计；⑤换人动作前 board 留痕评估依据；规范过 jarvis_essence 审计后实施 | plugin.js:1044-1057 重写 + 单测增"escalation=0 单异常不换人/历史不达标不被单次全优清零/非连续不触发换人"用例 | 行为规范先定稿；单测断言 |
| I2 essence 闸硬化（H3） | board resolve 决策类条目前强制要求 essenceChecked 或显式豁免留痕；未审计决策 resolve 需二次确认 | plugin.js:1270-1305 加闸 | 单测：resolve 未审计决策被拦截 |
| I3 全局持久化接入（H1） | jarvis_state 统一服务（原子写/锁/JSON schema）；store/board/release/perf/meeting 改读写真实文件。**B24 最小切面修订（质量试错演练）**：P0 第一步**只接 board 一个工具**（本次 B13-B24 并发写 ID 冲突=实证现场，最小可运行单元）验证后再复制到其余工具——不一步到位；并发写测试形态定义：≥2 并发写同一 board、断言条目零丢失+ID 唯一、动作=两进程各自 add 10 条。**架构师 B32 P0 验收样例（v1.4 引用）**：①ID 策略=持久化 seq 单调计数器（弃用 plugin.js:1270 长度重算——B13-B15/B22-B26 实证撞 ID；首次接入对既有 items 取 max 作初值、旧 ID 不重排）；②原子写=tmp+rename 同目录（writeFileSync→renameSync，失败不留半写文件，JSON.parse 失败保留旧版；前置 read-merge-write 消除旧读覆盖主窗口，跨进程 lockfile 作可选二道）；③写后回读校验=写毕回读断言 seq/items 数，失败返回可上行错误不静默。**B32 v1.1 精化 4 点（全部采纳）**：①并发语义拆分——单进程（串行/Promise.all 伪并发）断言 ID 唯一+seq 严格+1；双进程真并发+无锁断言=文件合法+无半写+至少一写者 10 条完整（弱保证）；双进程+lockfile 才断言 20/20（强保证，可选态）；②回读断言改 seq 单调+JSON 可解析+本写者写入 ID 存在，精确 length 相等只留单进程用例（规避并发窗口误报）；③lockfile 重试按 EEXIST 错误码判定，超时走 escalate 上行；④显式标注 POSIX rename 假设，Windows rename 覆盖需先 unlink 或 fallback（防实现期踩坑）。验收=test/state.test.js 六用例（并发 ID 唯一≥2写者×10条/原子写中断/旧读覆盖/回读失败路径/迁移/seq 单调）+61 单测不回归+selfcheck 加 board 完整性体检+落盘率埋点。**注意质量 R6**：写明"零副作用"指不污染外部环境/不改用户代码，state 层仅写 <项目>/.jarvis/ 自有路径 | 新增 tools + .jarvis/ 既有路径（零迁移） | test/state.test.js 六用例+61 基线不回归；长会话落盘回读测试；并发写不丢条目（≥2 写者×10 条，ID 唯一）；selfcheck board 完整性体检 |
| I4 文档-工具数对账（S1） | selfcheck 加自动对账：README/RELEASE/ARCHITECTURE 工具数 vs TOOLS.length，漂移即失败。**B24 扩展：文档-贾维斯公屏编号同步并入对账**（交付物引用 board 编号须与 board.json 实存 ID 一致，防本次 B23/B25 重编号漂移重演）。**回应质量 R2** | scripts/selfcheck.sh | selfcheck 对账项通过/漂移即红 |
| I5 e2e 真实化（S2） | /jarvis 在真 DSH 会话跑通（命令→建队→取卡→落盘→回读复用）+ 落盘回读断言 | test/e2e-flow.test.mjs 改造 + docs 修正 | 真会话跑通；非 handler 仿真 |
| I6 需求分级与识别（S5） | 分级改"复杂度+风险+领域"多信号；identifyIndustry 实识别 | plugin.js:271-274、1313-1322 | 分级不纯按长度 |
| I7 **ponder 接入角色思维器（B13）** | 见 §五专章 | skills/jarvis.md + preset + plugin.js:809 | 见 §五 |
| I8 **问题升级分层（B15）** | 见 §六专章 | plugin.js:667-716 + skills + docs | 见 §六 |
| I9 **CEO 贾维斯公屏翻译职责（B16，v1.3 按 B26 加机械判据）** | ①CEO 时刻关注贾维斯公屏（除盯员工能力外）；②用户/主面板需求**不原样上贾维斯公屏**——jarvis_board 或流程层设**显式翻译步骤**（先翻译再落条目）：把用户原话转为团队可执行的目标/验收/边界描述；③贾维斯公屏写入规范：条目区分**原始需求来源（用户原话，带引用）**与 **CEO 翻译后条目（目标/验收/边界）**，两者并存可追溯；④员工直接照抄用户原话上贾维斯公屏=**打回**，由 CEO 重译；⑤与需求本质回归（essence）衔接：**翻译即本质回归的执行层动作**，红线：翻译≠篡改；⑥验收判据：无翻译的裸用户条目=不合格。**B26 机械判据三件套（防 H3 同款口头闸）**：a) 原始需求条目与翻译条目并存且 sourceRef 互链（用户原话不删原文，另立条目）；b) 翻译条目必须含 **目标/验收/边界 三要素字段**（缺一=打回）+ 指定 translator=CEO（缺失或非 CEO=打回）；c) **字面相似度机械检查**：翻译条目与用户原话逐字重复率>70% 或译文只是原文改写无新增三要素 = 判"原样照抄"打回。**翻译 schema 四字段**：translator / sourceRef / triple(目标,验收,边界) / addedNote(翻译新增项来源标注：CEO 推断 or 用户确认过——未标注新增=篡改打回)。**翻译≠篡改机械保障**：jarvis_essence 四查应用于翻译动作（防迎合=不得把"简单做个表格"翻成"建设数据中台"；防幻觉=新增要素必须 addedNote 标注来源；真实优先=原话关键约束[金额/期限/范围]在翻译条目保留可追溯，**原话要素 vs 译文案差检查，丢关键约束=曲解原意打回**） | skills/jarvis.md 贾维斯公屏协议段（:95-99）+ plugin.js jarvis_board 加"来源/译者/三要素/addedNote"字段与翻译层校验（现状 :1227-1234 仅 board/add/resolve/audited/role，均为目标态）+ 组织职责（preset）+ essence 四查衔接 | 单测断言：照抄打回（相似度>70%）；丢关键约束打回（差集检查）；翻译条目缺 translator/非 CEO=打回；缺三要素=打回；贾维斯公屏每条用户类条目有对应翻译条目 |
| I10 **前端贾维斯公屏显示入口（B36，v1.5 按用户需求新增）** | 用户需要看到贾维斯公屏内容——提供**前端显示入口**：client 插件注册 UI slot 展示 `.jarvis/board.json`（条目/类型/状态/未决项/阻塞/决策审计标记 essenceChecked），P0/P1 **只读浏览起步**（直接读 board.json），P2 可加刷新/筛选/按角色过滤；与既有 P2"client UI 起步（贾维斯公屏/团队可视化）"合并（S3 从"空壳可扩展"升级为实需）。**质量 B36 两问回应**：①渲染数=board.json 实存条目数（渲染=数据源，刷新不漂移；空壳环境=降级为"贾维斯公屏文件可读"说明文档）；②只读展示不写库不撞 H1 并发写主路径，但**建议依赖 P0 jarvis_state 持久化层之后接入**（读到的必是落盘真相，展示旧数据=bug） | src/client/plugin.js 从空壳改真实 client 插件（参考 DSH `dsh-client-ui-slots`/`dsh-client-ui-conversation`/`dsh-client-connection` 注册模式，~/.dsh/profiles/web/node_modules/@deepseek-ai/ 实存）；package.json exports `./client` 已存在 | web 界面打开贾维斯公屏视图=board.json 全部条目（含类型/状态/ID），渲染数=实存数；无 UI 环境降级说明；P0 后接入则只读展示与落盘一致 |

### 新增（9 子系统，每项职责/与 17 工具关系/载体）

| 子系统 | 职责 | 与现有工具关系 | 载体 | 验收 |
|---|---|---|---|---|
| jarvis_state（P0 持久化层） | 全部 jarvis_* 状态的统一读写（原子写/锁/schema） | 基础设施；store/board/release/perf/meeting 全部改接 | new tool + .jarvis/ 既有目录 | 写读回环+并发写不丢 |
| jarvis_okr（目标管理） | 企业目标-任务-产出追溯，目标有可判定验收 | 复用 process 五要素思想；产出喂 perf | new tool + .jarvis/okr/ | 目标→任务→产出链可查 |
| jarvis_wiki（SSOT 知识库） | 企业知识与决策记录检索/版本，10 问命中≥8 | 复用 store 记忆库路径约定，扩展检索索引 | new tool + .jarvis/wiki/ + docs | 抽 10 问命中≥8 |
| jarvis_flow（流程实例） | 流程实例状态机（到哪步可查） | 扩展 process（process 定设计、flow 跑实例） | improved tool + .jarvis/flows/ | 流程状态可查证 |
| jarvis_approval（通用审批） | 审批链≤2 级、节点状态可查、裁决落盘 | 接 review 裁决+board 状态 | new tool + .jarvis/approvals/ | 审批链≤2 级可查 |
| jarvis_metrics（数据看板） | 指标采集/报表：决策时延/协作成本/员工自主度/绩效信号自动源 | 消费 board/release/perf 事件 | new tool + .jarvis/metrics/ | 指标可观测非手工 |
| jarvis_iam（权限治理） | 权限矩阵+审计日志，决策闸不可绕过 | agent_teams 成员权限上层模型；硬化 board 闸 | new tool + .jarvis/iam/ | 越权访问被拒+审计可查 |
| jarvis_minutes+jarvis_async（会议异步化） | 纪要落库/行动项追踪/异步决策记录 | 扩展 meeting 输出接 board+release | improved tool + .jarvis/minutes/ | 行动项有负责人有闭环 |
| org 载体+边界文档 | 最小自治单元/岗位编制 + 人机协作边界 | preset/preset.yml 提及 | .jarvis/org.json + docs/BOUNDARIES.md | 组织可见+边界书面 |

### 删除（3 + 质量 R1/R4 处置）
1. 死代码：checkCollabHealth 空体死分支（plugin.js:46-48）、perf 恒真三元（:1050）、未用 strikes（:1049）——**B17/R4 修正：checkCollabHealth 不可整函数删除——plugin.js:91 validateCardShape 有真实调用 + test/plugin.test.js:11 有 ESM import，删整函数会炸单测；可删的仅是 :46-48 空体死分支**。删除顺序=先改测试再删代码，ESM 抛错不可留；
2. 过期注释（:242"四个模型工具"实 17）；
3. 旧 .jarvis-roles/ 静态库——**质量 R1：实测仍残留在工作区根（5 域+12 角色 json+org-tree.md，git dcf6af9 仅删包内 roles/）；处置动作定义=归档冻结**（移到 archive/.jarvis-roles-archived/ 或 tar 打包 + README 标注 deprecated + selfcheck 提示残留），不得只写"归档冻结"四个字无动作。

---

## 六之专章 D：前端贾维斯公屏显示入口（贾维斯公屏 B36，P1/P2 级，用户实需）

### D.1 需求与现状
用户原话："是不是还应该提供一个前端显示入口，用户需要看到贾维斯公屏上的内容"——数字员工公司的**用户侧可视化**：不能只有 Jarvis/CEO/员工能读写贾维斯公屏，用户也要能看到团队在做什么、贾维斯公屏上的条目/决策/阻塞。
现状实证：①`src/client/plugin.js` = 空壳 `apply(ctx){}`（方案 S3 已指出 client 空壳，现升级为实需）；②DSH client 插件体系真实存在（`~/.dsh/profiles/web/node_modules/@deepseek-ai/` 下 `dsh-client-ui-slots`/`dsh-client-ui-conversation`/`dsh-client-connection`，main=lib/index.js 为可引用注册模式）——client 插件可通过 UI slot 注册前端视图；③数据源现成：`<项目>/.jarvis/board.json` 即贾维斯公屏真相（本项目已实存 36 条）。

### D.2 设计（最简可运行单元起步）
- **只读浏览起步**：client 插件注册 UI slot，读 `<项目>/.jarvis/board.json` 渲染贾维斯公屏——每条：ID / 类型(问题/发现/决策/风险/阻塞/接口变更) / 状态(open/resolved) / 内容 / 角色 / 决策审计标记(essenceChecked) / 时间；未决项/阻塞项高亮。
- **P2 增强**：刷新、按类型/角色筛选、决策审计状态视图、与 jarvis_board 工具写路径联动（写后即见）。
- **降级**：无 web UI 的环境（headless/无 slot）→ 不报错，文档说明"贾维斯公屏文件可读"（`read <项目>/.jarvis/board.json`），功能不承诺。
- **与持久化层关系**：只读展示**建议在 P0 jarvis_state 持久化层之后接入**——读到的必是落盘真相；若提前接入，先接"直接读文件"形态（只读不写，不撞 H1 并发写主路径），展示旧数据=bug（质量 B36 问②答案）。

### D.3 载体与验收
- 载体：`src/client/plugin.js` 从空壳改真实 client 插件（参考 `dsh-client-ui-slots` 注册模式）+ `package.json` exports `./client`（已存在）。
- 验收判据（可判定）：①web 界面打开贾维斯公屏视图 = board.json **全部**条目（渲染数=实存数，逐条含类型/状态/ID）；②刷新后与磁盘文件一致不漂移；③无 UI 环境降级说明存在；④P0 后接入则只读展示与落盘一致（不展示旧数据）。
- 四象限：改进（I10，S3 升级为实需）；路线图：P1 起步（与 I3 持久化同批或紧随）/P2 增强（与 client UI 合并）。

---

## 五、专章 A：ponder 技能接入角色思维器（贾维斯公屏 B13，P1/P2 级）

### 5.1 已核实事实
1. ponder 真实存在：/root/.dsh/skills/ponder/（SKILL.md 19KB 十阶段流水线 + scripts/{orchestrate,step-guard,evolve,pipeline-metrics,weights}.js + resources/）。十阶段：interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis（八卦镜 8 维并行 agent、辩论立论 agent、step-guard 守卫 init/after/status）。**子 agent 必须全部返回才能进入下一步**（SKILL.md 硬约束）。
2. jarvis_think_deep 现状（plugin.js:808-870）：七段提示词任务单（前提审视→视角展开→反方攻击→失效推演→真实优先核对→诚实边界→收敛结论），描述自称"ponder 轻量化"但零真实调用 ponder。
3. 可行点：preset/agent.cordis.yml:99-110 已注册 tool-skill + skill-filesystem——数字员工子 agent 真实具备 skill 工具可加载 ponder，接入是现实改造非空想。

### 5.2 定位与触发规则（成本闸：不为流程而流程）

**定位**：jarvis_think_deep 从"七段仿制器"改"ponder 入口引导器"——按 stakes 分流，与 ponder 自身门控"高赌注必做、可逆小事跳过"同构：

| stakes | 动作 | 依据 | 成本 |
|---|---|---|---|
| high（重大决策/对外承诺） | 加载 ponder 完整十阶段（skill 工具 → SKILL.md → orchestrate.js step 序列 → step-guard 守卫） | ponder 门控"高赌注必做"；jarvis.md:103 高赌注全量对抗 | 高（多轮并行 agent），仅重大决策 |
| medium（常规关键） | 轻量七段（现状）或 ponder 裁剪版（interview+converge 两段，可选配置） | 常规关键决策 | 中 |
| low（可逆小事） | 轻量七段或简写（现状 low 分支） | 可逆小事跳过 | 低 |

stakes 由调用方按 jarvis 既有语义传参（think_deep 参数），插件不新增判定。

### 5.3 衔接契约（thinkA/thinkB 仍可被 jarvis_review 消费——质量 t4 质问 1 的答案）

| jarvis_review 消费字段 | ponder 十阶段产出 | 衔接动作 |
|---|---|---|
| counter | divergence 发散 + bagua 八卦镜 8 维反方 + debate 辩论立论 | 汇总去重取 top |
| realityCheck | interview 五诊画像 + 无知自检（socratic-ignorance） | 转"先核对项"清单 |
| confidence | converge 收束 + step-guard after 的 certainty（0-1） | 三级映射 low/medium/high |
| conclusion | synthesis 综合结论（含被淘汰方案） | 直接采用 |
| limits | 各阶段 epistemic_status / knowledge_level | 汇总 |

产出双写：ponder 十阶段产出经 orchestrate.js storeStep/finalize 沉淀 ~/.dsh/data/ponder/（平台级知识）；关键裁决结论按现有 board + release 路径落项目 .jarvis/（项目级决策）。**回应质量 t4"产出如何复核"：十阶段 step-guard status 可查（✅/❌ 每步执行记录），产出映射表可机械核对（字段级），非贴标签。**

### 5.4 接入载体（三处）
1. skills/jarvis.md 角色思考协议段（:101-107）新增："stakes=high 时须加载 ponder 技能（DSH 平台级十阶段管线，skill 工具已注册）跑完整流程，产出按衔接契约喂 jarvis_review；low/medium 保留轻量七段控成本"；
2. preset/agent.cordis.yml persona 或注释段注明"子 agent 具备 tool-skill 可加载 ponder，重大决策启用"；
3. plugin.js:809-812 jarvis_think_deep 描述改"ponder 入口引导器"+ 分流规则说明。

### 5.5 验收标准（可判定）
- 命令级：stakes=high 时 jarvis_think_deep 产出含"加载 ponder"引导与衔接映射说明（单测断言描述/输出字段）；
- 集成级：真 dsh 会话让一子角色对高赌注问题走一遍 → ponder step-guard status 全绿 + 产出能喂 jarvis_review 出裁决（喂 thinkA/thinkB 能裁决）；走不通=未验收；
- **三洞修补（B18/B24 质量质问的答案）**：①并发覆盖→**per-run guard 文件隔离**（B24⑤ 实锤：step-guard.js:25 GUARD_FILE 为全局单文件、无 per-run 隔离、tmp+rename 仅防半写——多成员并发跑确实互相覆盖；改造=按 run_id 生成独立 guard 文件，项目内以 .jarvis/ponder-runs/<run_id>/ 映射）；②复核溯源→衔接映射表要求附**阶段产出全文摘录**（B24⑥ 实锤：knowledge.js:189 storeStepOutput 只存摘要≤300 字符不存全文，'机械核对'只能核 completed 状态不能核文本；改造=run 目录存阶段产出全文，使 thinkA 的 premise/counter 可溯源到具体阶段文本，不满足=打回）；③防"贴标签 JSON"→ 衔接层校验：counter 条数、realityCheck 是否含具体核对项、confidence 是否映射自 certainty——**字段级校验 + run_id 溯源双闸**，纯标签 JSON 过不了；
- 回归级：medium/low 路径输出与改造前一致（61 基线 + 新用例不破坏）；
- 成本闸验证：high 之外不触发十阶段（触发规则单测）。

### 5.6 已知边界与跳过机制（诚实标注）
十阶段含并行 agent、耗时显著高于七段——仅 high 启用，且按 ponder 硬约束等待全部子 agent 返回；本设计稿为方案级推演（本单=出方案）；ponder 在 web_search 受限环境的真实可用性须集成验收实测（agent-reach 不可用时走 WebSearch/WebFetch 兜底），不预先断言已通。
**跳过规则（B18 Q2 的答案，防"高赌注必走 ponder"变口头闸）**：高赌注允许跳过的条件=①ponder 技能不可用（成员无 skill 工具/运行时缺失，须 jarvis_escalate 上报留痕）；②用户明示成本优先。**跳过必须显式声明+可审核**（think_deep 输出含 skipReason 字段 + 贾维斯公屏留痕），**评审/裁决时按"未做深度对抗"降级标注置信度**；任何静默降级（贴"已 ponder"标签但没跑）视为 H3 同款违规，质量闸打回。谁判定跳过得当=CEO 复核（对照 B16 翻译职责与 B15 分层升级链路）。

---

## 六、专章 B：问题升级分层规则（贾维斯公屏 B15，P1 级）

### 6.1 已核实事实
jarvis_escalate（plugin.js:667-716）：完整性校验已有（缺问题/风险/决策请求→打回 :700-705）；升级对象写死"CEO/jarvis_review"（:710）；无"内部消化优先"显式步骤、无层级字段、无"内部已尝试消化"记录。

### 6.2 三层模型（对齐真实企业风险上报）

```
员工（子角色）
  │ ① 先内部消化：自裁决（think/think_deep）或问 CEO（send_message 直连）
  │ ② 消化不了 → jarvis_escalate 上行（带"内部已尝试消化"记录）
  ▼
CEO（团队内角色，独立决策主体）
  │ ③ 裁决/转派/二次会（jarvis_review + meeting cycle）——多数问题内部消化
  │ ④ 消化不了 → 汇总整理后上行
  ▼
贾维斯主面板（对客户唯一接口）
  │ ⑤ 提炼（去重/归类/转用户可答问题）
  ▼
用户（最终决策者）← 唯一 ask_user_question 终点
```

原则：**普通员工不得因单个问题透传用户侧**（协调税不上移）；**宁可上报被驳回，不可沉默绕行**（不变量保留）。唯一透传条件=①需用户个人偏好/业务事实/拍板承诺（角色卡范围办不到）+②已走内部消化且有留痕。

### 6.3 jarvis_escalate 改造（plugin.js:667-716）
- 参数新增：`fromLevel`(employee/ceo/jarvis)、`internalAttempts`(内部已尝试消化记录，employee 必填)、`toUser`(false 默认)、`owner`(ceo/jarvis/user)、`sourceRef`（B16 来源字段：本条上行的用户原始需求编号，CEO 翻译后并存）；
- 校验：employee 缺 internalAttempts → 打回"先走内部消化再上报"；employee 且 toUser=true → 打回"员工不得直接透传用户侧"；owner=user 且 fromLevel=employee → 打回/降级 ceo；
- output 新增 `path`（员工→CEO→Jarvis→用户链上当前节点）；
- boardEntry 阻塞条目追加"内部尝试：<摘要>；期望层：<owner>"——CEO 闭环可评判已消化程度；
- **B21 Q1 的答案（防口头闸）**：透传判定不做文本约定——escalate 记录含 `toUser` 标记 + 调用链 `path` + 贾维斯公屏 sourceRef，单测强制"员工 toUser=true 无 internalAttempts=打回"，集成层留痕可查；任何绕过（模型直接 ask_user_question 用户）依靠 B16 贾维斯公屏翻译职责（CEO 时刻盯贾维斯公屏，发现员工直问用户即登记违规留痕，perf 评估采信）；
- compat：老调用默认 fromLevel=employee + internalAttempts 缺省 → 打回提示补记录（行为变更，**改前先核对 test/plugin.test.js 中 escalate 相关用例并同步更新，防回归，呼应质量 R4 同款风险与质量 B14③**）。

### 6.4 ponder 采访/无知自检阶段约束（并入专章 A）
- 员工跑 ponder 的 interview 追问/无知自检 ask_user_question **指向 CEO 或内部裁决**，不得直达用户；
- jarvis_think_deep（ponder 入口引导 high 分支）任务单显式写明"问询对象=CEO（send_message）或 jarvis_review；禁止 ask_user_question 直达用户"；
- CEO 层才允许把**整理后**问题问用户（去重/归类/附内部尝试/给选项）；
- **回应质量 t4 质问"改问 CEO 会不会丢失用户真实信息"**：监察=用户仍是最终决策者，CEO 只做"汇总提炼+预先内部作答"，用户回答直接回填决策链；丢失风险=CEO 过滤掉"未达透传标准但有助于画像"的细节 → 缓解：ponder 单次采访的"待用户确认项"全部登记（board owner=user 条目），CEO 不删只整理归组；不透传标准=could-be-answered-internally（可内部作答）则内部作答并留痕，非删信息。

### 6.5 验收判据（可判定）
- 单测：`(role=员工,toUser=true,internalAttempts='')`→打回且提示"先内部消化"；`(fromLevel=employee,owner=user)`→打回/降级；补全后 ok 且 path 含 CEO 节点；
- **B21 Q2 的答案（消化有效性=双签名防静默压下）**：CEO"消化有效"的判定=①贾维斯公屏该阻塞条目 **resolved**；②有 `jarvis_review` 或二次会 **裁决记录**（写入 board 决策条目）；两者缺一 = 消化未闭环，按 B16 职责 CEO 必须补齐——消化不是口头承诺，是可复核的双签名事件；H3 修复（I2 essence 闸）同步保证 resolve 不绕过审计；
- **B21 Q3 的答案（透传与回灌接口）**：员工跑 ponder 采访/无知自检时不得 ask_user_question 直达用户——先问 CEO/内部裁决；CEO 判定"角色卡办不到需用户事实"→ 汇总提炼（B16 翻译）后由主面板问用户（带选项）；**用户回答按 ponder run_id 回灌**：写入 .jarvis/ponder-runs/<run_id>/user-input.json，ponder 侧通过 orchestrate/storeStep 供 interview 画像与后续阶段读取——接口在 t5 明确，不做静默转述；谁判定透传=CEO 复核（员工自判视为待确认，须 CEO 确认后才透传）；
- 集成（e2e 真会话）：员工遇"需用户偏好"问题 → 先见 CEO 消化动作、无即问即透传；CEO 消化不了 → 汇总后 Jarvis 问用户；回答按 run_id 回灌后闭环；
- 回归：61 基线+新增 escalate 用例全绿；
- **回应质量 t4"别变成口头闸"**：判定机制=上行记录字段（internalAttempts/path/owner/toUser）机械校验（单测级强制）+ 贾维斯公屏留痕（boardEntry 含内部尝试 + 双签名 closed 事件），双闸可复核，非纯协议纸面。

---

## 六之专章 C：可行性闸门（贾维斯公屏 B22，P1 级治理改进）

> 需求本质：用户可能不懂"领域技术"、提出不可能实现的要求——必须在进入实际开发之前反馈出来不予接受（对齐真实企业需求评审）。

### C.1 闸的位置（流程节）
**阶段一"需求本质回归"之后、阶段二"拆解建任务 DAG"之前**——CEO/架构师先过闸，不可行项不进入任务链。与 I9 翻译职责衔接：用户原话先经 CEO 翻译（B16）→ 翻译后条目过可行性闸 → 过闸项才进 DAG。

### C.2 闸的判据（可判定的"不可行"）
① **依赖不存在/无法验证的能力**：jarvis_capability 三级路径（复用→市场→自研）走完仍无，禁止硬造（缺少组件=上报能力缺口，走 jarvis_escalate 而非硬凑）；
② **违反平台/物理/法律/资源边界**：如"让插件直接在 headless 进程跑 tools/commands"——OPS-QA P3 已证不可行（headless 挂不到 tools/commands）；"web_search 不可用时要求实时联网调研"——B3 网络限制实证；
③ **量级不可能**：时限/规模超出可交付范围（如"一天内重构全部 17 工具"无替换计划）；
④ **与"真实情况优先"冲突的需求表述**：要求以不存在的事实/数据为交付前提。

**判据分级（B30 Q1：硬边界 vs 软困难，防软困难被误判为不可行）**：
- **硬边界**（物理/法律/平台/不存在的能力）→ 必须引实证（文件:行号/实测复现/capability 三级路径结果）才可判"不可行"，evidence 缺=打回；
- **软困难**（时间/成本/资源：太贵/来不及/人手不够）→ **不得直接判不可行**，必须附拆分/分期替代方案给用户选择；用户对拆分/分期仍拒绝，才允许记否决——软困难永远有"换路径"选项，不构成否决理由本身。

**闸记录 schema 七字段（B30 Q1，防口头闸）**：
`{item, verdict(可行/不可行/待澄清), evidence[文件:行号|实测复现|capability 三级路径结果], alternative(替代方向), rejectReason, reviewedBy(CEO), techCheckedBy(架构师)}`
——verdict=不可行 且缺 evidence 或缺 alternative → **校验打回（单测级强制）**；可行/待澄清 须有对应依据字段。

**判不清=不判不可行**：走需求澄清问用户（B15 分层链路：员工→CEO→主面板→用户），防止用"不可行"搪塞真需求。

### C.3 反馈与处置
- 不可行项向用户反馈=**依据**（为什么不可行，引事实/文档：OPS-QA/plugin 边界/能力清单）+ **可替代方向**（降级/换路径/拆分）；
- 反馈留痕入贾维斯公屏（type=决策，owner=user 待确认）——**不静默接受也不静默丢弃**；闸记录与翻译条目 **sourceRef 互链**（原话可回溯，B30 Q2① 升级 B26 schema）；
- 用户确认接受替代 = 改写需求（CEO 翻译，B16）再进 DAG；
- **"待澄清"强制优先于"不可行"（B30 Q2②）**：evidence 不足/判据未实证/需求有第二种合理解读 → verdict 必须=待澄清走用户确认；**无澄清记录直接判不可行=打回**；
- 用户坚持原意 = 记录"**明确否决项**"进贾维斯公屏，**含三件套（B30 Q2③）**：`用户坚持原话 + CEO 依据 + 替代方向`（owner=user，status=否决），不静默丢弃；**用户有权走 B15 分层 escalate 到主面板复核**（否决后可申诉，CEO 对申诉不得以"已记录"打发，须响应闭环）；
- **软困难处置（B30 Q2④）**：成本/时间类困难不得以"不可行"名义拒——先给拆分/分期替代，用户仍拒绝才记否决。

### C.4 执行者与质量审视
- CEO 主裁（对齐 B16 翻译职责：不可行判定由 CEO 按需求本质裁决）+ 架构师提供技术事实（引 OPS-QA/plugin 行号）；
- 质量可审视"不可行判定是否也是口头闸"——会不会把真需求误杀：**判据必须可复核**（依据=真实文档/能力清单引用，无引用=打回），且"判不清不判不可行"强制澄清路径，防误杀。

### C.5 验收判据（可判定）
1. 进入开发的需求项均有**可行性闸记录**（过闸时间/裁决人/依据）；
2. 方案含不可行项示例（headless 不支持 tools/commands、web_search 不可用时要求实时联网）——示例已写入 C.2；
3. 无"静默接受不可行项"路径：不可行项必有反馈留痕（依据+替代方向）；
4. 无"静默丢弃被拒项"路径：用户坚持原意项=贾维斯公屏"明确否决项"记录（三件套完整）；
5. **不可行缺 evidence 或缺 alternative → 自动打回（单测断言，B30 新增）**；
6. **"资源类困难误判不可行"反例测试（B30 新增）**：注入"成本高/时间紧"型需求 → 断言 verdict≠不可行（须=待澄清或可行+拆分分期替代），直接判不可行=用例失败。

### C.6 四象限与路线图
四象限=**改进**（流程闸，复用 jarvis_capability/escalate/board，不新增工具）；路线图=P1 治理改进（与 I8/I9 同批，共用 sourceRef 来源字段与分层链路）。

---

## 七、质量 7 条反面问题（T4-R1~R7）逐条回答

| # | 反面问题 | 方案回答（含动作定义） |
|---|---|---|
| R1 | 旧 .jarvis-roles/ 静态库残留怎么处置 | 归档冻结有动作：移动/打包到 archive/.jarvis-roles-archived/ + README 标注 deprecated + selfcheck 提示残留存在；"领域无关"承诺与磁盘事实对齐（见删除 3） |
| R2 | 双路径漂移（bundle vs 动态插件）怎么根治 | selfcheck 加自动对账项（工具数 README/RELEASE/ARCHITECTURE vs TOOLS.length），任一漂移即红；动态插件核对清单纳入 selfcheck（回应 S1；根治=文档即测试，漂移不可过闸） |
| R3 | 61 单测/e2e/selfcheck 怎么跟着改 | 每个改造项必须携带测试变更（新增/修改用例）作为验收闸的一部分——测试随改是硬性交付物，不在"方案正文"里单独承诺；e2e 改真集成后基线更新为"61+新增+真e2e" |
| R4 | 删除 checkCollabHealth 会炸单测 | 已核：plugin.test.js:11 仍 import 它（ESM 抛错）+ plugin.js:91 validateCardShape 有真实调用——**B17 修正：不可整函数删除，只删 :46-48 空体死分支**；删除顺序=先改测试再删代码；其它删除同理（I2/I3 改 handler 前先核对既有用例） |
| R5 | capability"组件化"只是文本不是机制 | jarvis_capability 增加组件注册表落盘（.jarvis/components.json 真实写入：名字/功能/用法/维护者/验收记录），复用走查表而非提示语；C8 领域扩展=注册表+知识库沉淀双机制（机械化路径，非每次现场蒸馏） |
| R6 | state 层写文件与"零副作用/领域无关"自检冲突 | 明确语义：零副作用=不污染外部环境/不改用户代码；state 层仅写 <项目>/.jarvis/ 自有路径（项目记忆库本就允许写）；selfcheck 加"仅写 .jarvis/ 内"白名单断言 |
| R7 | 修 H2 要先定义行为规范 | 行为规范先定稿（BEFORE 代码，B17 修订版）：①首次异常（escalation=0）=评估+补强观察不换人；②连续 2 次不达标才换人；③"连续"=最近历史序列不被单次全优清零（修 B17 场景1）；④历史记账按最近窗口（近 3 次）非全量累计（修 B17 场景2）；⑤换人前 board 留痕评估依据；规范过 jarvis_essence 审计后实施 |

---

## 八、分阶段路线图（改造按"诊断→解耦→赋能→迭代"，最简自治单元起步，无指标不上线）

### P0 · 打地基（先砍官僚税再上系统）
目标：修 H1 持久化 + 清理（死代码/旧库）——让"沉淀/贾维斯公屏/版本"从口头契约变系统特性。
任务：**I3 最小切面先行——只接 board 一个工具**（本次 B13-B24 并发写 ID 冲突=实证现场，最小可运行单元；**验收样例=架构师 B32 v1.1 精化版：seq 单调 ID+tmp/rename 原子写+回读校验+test/state.test.js 六用例**），验证后再复制到 store/release/perf；删除项（R4 顺序先测后删）；R1 旧库归档；I4 文档对账（含贾维斯公屏编号同步）。
验收闸门：单测全绿（61+新增）；长会话落盘回读测试通过；**并发写测试形态定义**（≥2 写者×各 10 条，断言条目零丢失+ID 唯一）；selfcheck 对账项过。
**可观察指标（B24① 载体定义，防"无指标不上线"违规）**：沉淀落盘率 = 落盘成功写次数 / 贾维斯公屏写入动作总次数（埋点=jarvis_board 每个写入动作计数器，P0 起即埋，不必等 P2 metrics）；贾维斯公屏并发写冲突数→0（并发测试断言计数）。

### P1 · 治理与思维器（优先级最高，成本最低）
目标：修 H2/H3 两个"错误逻辑+口头闸"；接 ponder（B13）+ 分层升级（B15）+ CEO 贾维斯公屏翻译职责（B16）；目标/知识先行。
任务：R7 行为规范定稿（B17 修订版）+ I1 perf 修复；I2 essence 闸硬化；I7 ponder 接入（skills+preset+tool 描述+衔接契约+三洞修补 B18+**per-run guard 文件实锤落地 B24⑤⑥**）；I8 分层升级（escalate 字段+校验+单测+双签名 B21）；I9 CEO 贾维斯公屏翻译职责（B16/B26：机械判据三件套+翻译 schema 四字段）；**专章 C 可行性闸门（B22）**；N jarvis_okr + jarvis_wiki（最小可行版）；I5 e2e 真实化（P1 尾）。
验收闸门：单测断言（H2 场景不误换人/未审计决策被拦截/员工直问用户打回/员工照抄用户原话上贾维斯公屏=打回）；真会话跑通 ponder 十阶段且喂 review 可裁决（run_id 溯源+字段级校验）；OKR/Wiki 最小版可用（目标链可查/10 问命中≥8）；贾维斯公屏条目含来源字段且每条用户类条目有 CEO 翻译条目（无翻译裸条目=不合格）。
可观察指标：误换人率→0；未审计决策绕过数→0；员工直达用户提问数→0；贾维斯公屏原始需求-翻译并存可追溯率；目标追溯深度；知识检索命中率。

### P2 · 全体系铺开（赋能）
目标：补齐新增子系统（flow/approval/metrics/iam/minutes+async/org/边界文档）+ 组件注册表（R5）+ client UI 起步（S3 贾维斯公屏/团队可视化）。
任务：jarvis_flow、jarvis_approval、jarvis_metrics、jarvis_iam、jarvis_minutes+jarvis_async、org.json+BOUNDARIES.md、capability 注册表、client UI v0.1。
验收闸门：每子系统有可判定验收（见 §四表）；组件注册表真实落盘有验收记录；UI 可看贾维斯公屏/团队。
可观察指标：决策时延（escalate→闭环）、协作成本（会议/消息数）、员工自主度（无需上报即决策占比）。

### P3 · 迭代与领域扩展
目标：领域覆盖扩展到实体行业（制造/法务/教育等）+ 全链路真 e2e + 指标驱动持续迭代。
任务：用组件注册表+知识沉淀机制接入新领域（非每次现场蒸馏）；真 e2e 全链路自动化；按 metrics 数据迭代治理。
验收闸门：新领域接入走注册表机械路径跑通 ≥1 例；真 e2e 进 CI；绩效/决策时延指标回看。
可观察指标：新领域接入耗时、授权员工自主决策占比、客户确认时长。

**每阶段原则**（CEO 方法论）：最简可运行自治单元起步（P0 就是最小单元=持久化），验证后再复制；每个体系有可观察指标；无指标不宣称现代化。

---

## 九、需求本质审计（jarvis_essence 四查）

- 回归本质：本方案=把 luke-jarvis 改造成现代化办公体系（用户明示主轴 D1）。是，未跑偏为"堆工具"——每项新增都有对应差距行与验收。
- 防迎合：用户预判"还有很多不足"——本方案不足逐条有 T1 文件:行号证据（质量 t4 独立复核通过），非顺着用户话头乱找毛病；保留项（16 真实性治理超基准、11 成果可观测近基准）如实承认现状优点，不为了"显得不足"贬低现状。I9 翻译职责红线并列此处：翻译=本质回归执行层（为谁解决什么/怎样算成功），**翻译≠篡改——不得在翻译层曲解用户原意**，防"翻译"变成"迎合自己想要的架构"的通道。
- 防幻觉：全文证据=真实代码行号/实测数字/贾维斯公屏记录；B13/B15 事实=我亲手核实（ponder 目录、preset 注册、escalate 代码）；推测均标注（H1 并发写推演已在本次实证；ponder 真实可用性待测）。
- 真实优先：硬缺陷我亲手 grep/读码复验；文档数字以实测为准（61/11）；"我想要的架构"全部落在四象限建议区，未冒充现状缺陷。

---

## 十、诚实边界与风险

1. 本单=出方案，未实施任何代码改动；所有"改造后"描述为目标态；方案级推演均已标注（ponder 可用性、并发写推演）。
2. B13/B15 属需求变更纳入（P1/P2 级），与 T1-T3 在途产出合并；其设计稿版本 v1 存 .jarvis/ponder-integration-design.md、.jarvis/escalate-layered-design.md。
3. 模型侧无法 100% 机械拦截"员工直问用户"——是流程闸+留痕闸（单测强制+board 留痕），非运行时硬闸（除非 P2 加工具级强制，已标注）。
4. S6 防编造正则闸是作者已声明的防御性设计边界，方案保留并明写其可绕过性。
5. 测试基线数字以实测为准（61/11），文档同步修正列入 I4。

---

## 附：交付物索引

- 本方案：docs/REFORM-PLAN.md（本文件）
- 差距分析/四象限裁决：贾维斯公屏 B10-B12
- ponder 接入设计稿：.jarvis/ponder-integration-design.md
- 分层升级设计稿：.jarvis/escalate-layered-design.md
- 过程证据：.jarvis/board.json（B1-B21）、project.md、process-luke-jarvis-reform.json
- 现状体检原始报告：架构师 t1 完成回复（inbox 留痕）
- 质量审视：t4 完成回复（7 条反面问题）+ 贾维斯公屏 B14/B18/B21
- 需求变更设计稿：.jarvis/ponder-integration-design.md（B13）、.jarvis/escalate-layered-design.md（B15）
- v1.1 修订记录：B16（CEO 贾维斯公屏翻译职责 → I9）、B17（H2 行为断言修订 + R4 修正）、B18（ponder 三洞 → §5.5/5.6）、B21（分层三问 → §6.3/6.5）
- v1.2 修订记录：B16 I9 细化（jarvis_board 显式翻译步骤/员工照抄=打回/essence 衔接"翻译=本质回归执行层，翻译≠篡改"/无翻译裸用户条目=不合格）
- v1.3 修订记录：B22 可行性闸门（→ 专章 C）；B24 质量试错演练（P0 最小切面=先接 board、并发写测试形态、落盘率埋点载体、文档-贾维斯公屏编号对账并入 I4、ponder per-run guard 实锤）；B26（I9 机械判据三件套+翻译 schema 四字段+essence 应用于翻译）
- v1.3 定稿同步：版本头贾维斯公屏引用 B1-B21→B1-B28（实存）；H1 证据行补"质量连撞 4 次 ID（B22-B26）实证"
- v1.4 修订记录：质量 B30 对专章 C 最终质问——Q1 闸记录 schema 七字段（item/verdict/evidence/alternative/rejectReason/reviewedBy/techCheckedBy）+硬边界（必引实证）vs 软困难（不得判不可行须给拆分/分期）分级；Q2 误杀防护（sourceRef 互链升级 B26 schema、"待澄清"强制优先于"不可行"、明确否决项三件套+用户可走 B15 申诉到主面板、软困难处置）；C.5 新增"不可行缺 evidence/alternative 自动打回"与"资源类困难误判反例测试"两条验收。
- v1.4 补：B32 架构师 I3 P0 验收样例并入 I3 行与 P0 任务（seq 单调 ID/tmp+rename 原子写/回读校验/test.state.js 六用例/并发语义拆分：单进程强断言、双进程无锁弱保证、双进程 lockfile 20/20 可选强保证/lockfile EEXIST 判定/POSIX rename 假设标注）；质量 B33 有条件通过已登记。