# Changelog

本文件记录 luke-jarvis 每个版本的变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 风格。用户通过版本号 + 本文件判断"能否升级、升了什么"。

## [0.3.5] - 2026-10-12

### 修复

- **captain 执行拦截改为根层挂载 + 生效性诊断**：v0.3.4 的 guard 挂在 preset 作用域，实测覆盖不到 `standard` 会话（captain 仍执行 bash）。现改为在宿主根层 `- insert: jarvis-core` 挂载（plain-context guard = 全局），并加临时诊断日志 `/tmp/jarvis-captain-guard.log` 记录每次 deny-set 工具调用的 sid/cwd/captains，用于验证是否真拦截。

## [0.3.4] - 2026-10-12

### 新增

- **插件级「顶层 captain 不得亲自执行」硬拦截**（`tools.guard`）：对**已存在会话**同样生效（preset 在会话创建时固化、无法追溯修改的兜底）。规则：调用会话 = jarvis 工作区（有 `.jarvis/`）里某团队的 `captainSessionId` 时，拒绝执行类工具 `bash/pwsh/edit/write/subagent/workflow/ralph`；`read/glob/grep` 与 `agent_teams_*`/`jarvis_*` 不受影响；成员会话不受影响；逃生阀 = `.jarvis/allow-captain-exec`。
  - 背景：scan 某 captain 会话（preset=standard）亲手 bash 5.7 万次 + edit 1685 次，把活全干了。

## [0.3.3] - 2026-10-12

### 修复

- **`/jarvis 继续` 续跑意图**：原来"继续/接着上次/resume"会被判成模糊需求、反而反问用户"想做什么"（实测）。现识别为**续跑**：先读现状（jarvis_store check + project.md/board.json/lessons.md + agent_teams_status）→ 判身份（非 captain 无法接管旧团队，须回原会话或授权新建）→ 处理卡死任务（reassign 唤醒成员，顶层不顶替）→ 过 `jarvis_flowguard(execute)` → 派活续跑。续跑不等于新需求：不重新判领域、不重新建队。

## [0.3.2] - 2026-10-10

### 修复

- **自带预设 `preset/agent.cordis.yml` 补挂 luke-jarvis 插件**：原预设只有 Jarvis 人设、没有 jarvis_* 工具（用户实测"agent 预设里没有 jarvis"的根因）——现补 `- id: jarvis-core / name: luke-jarvis`。
- **新增严格预设 `preset/jarvis-captain.cordis.yml`**：顶层只派发——无 `tool-bash`/`tool-pwsh`/`tool-fs`（可写）/`delegation`（子代理），只留只读检索 + agent-teams + jarvis-core；顶层物理上不能自己干活，执行只能由成员完成。
- **README 安装说明修正**：dsh 0.2+ 不自动发现 `~/.dsh/.agent-presets`，必须在 profile 的 `cordis.patch.yml` 用 `- insert:` 显式注册（plugins 内联），否则预设不生效。

## [0.3.1] - 2026-10-10

### 变更

- **/jarvis 严格模式**：用户显式 `/jarvis` 时输出严格模式约束——① 能力自检（缺 jarvis_* 工具=明确告知"jarvis 能力未注册"并停止，不许普通会话硬做）；② 顶层只做接单/派发/盯控/回显，绝不亲自实现测试改文件；③ 执行一律派给团队成员，成员卡住用 reassign 唤醒而非顶层顶替；④ 每步过 jarvis_flowguard。
- `skills/jarvis.md`：新增「🔒 严格模式」协议段。
- `package.json`：version 0.3.0 → **0.3.1**；`README.md`：单测 199→200。

## [0.3.0] - 2026-10-10

### 变更

- **jarvis_flowguard execute 加"卡死任务必须 reassign"硬闸（scan 教训）**：未完成任务里 `claimed` 未交付、或 `attempt≥4` 且产出为空 → BLOCKED，要求 `agent_teams_reassign_task` 唤醒成员或换人，禁止顶层自己顶替。防"成员会话被 end-seed 后任务停在 claimed、没人管，captain 只能自己干"。
- `package.json`：version 0.2.9 → **0.3.0**；`README.md`：单测 196→199。

## [0.2.9] - 2026-10-10

### 变更

- **jarvis_flowguard execute 加"顶层不得自领执行任务"硬闸（scan 教训）**：`captain` 名下未完成的执行类任务 → BLOCKED，要求 `agent_teams_reassign_task` 派给团队成员（唤醒成员会话）；纯协调/验收/汇报类任务在 subject 标注【协调】豁免。防"成员会话死后 captain 自己 claim 任务干完 → 全是上层在干活"。
- `package.json`：version 0.2.8 → **0.2.9**；`README.md`：单测 193→196。

## [0.2.8] - 2026-10-09

### 修复

- **jarvis_flowguard build 步骤校验"需求规格"是否存在**（原只把"需求规格"列进 pre 但从不校验，导致 build 永远误报缺失）——存在则放行、不存在才 BLOCKED，与 decompose 一致。

## [0.2.7] - 2026-10-09

### 修复

- **jarvis_flowguard `recorded` 未完成时不返回**（schema 只声明 string，运行时若返回 null 会校验失败）——handler 在 recorded 为 null 时省略该字段，done=true 时才返回留痕路径。

## [0.2.6] - 2026-10-09

### 修复

- **jarvis_flowguard 输出 schema 补 `step`/`recorded` 字段**（运行时 additionalProperties:false 校验失败 → 工具实际不可用的 bug）——handler 返回了这两个字段但 schema 未声明，导致调用即报"invalid output"。现在正常返回 verdict/ok/step/missing/recorded/next。

## [0.2.5] - 2026-10-09

### 变更

- **jarvis_flowguard build 加"建队人才层前置硬闸"（glm-test 教训）**：建队派活前必须存在 猎头卡 + 带队/CEO卡；若已有团队，每个成员岗位必须存在对应角色卡（`.jarvis/cards/`）。缺任一 → BLOCKED，提示"先蒸馏猎头→CEO→各岗位角色卡再建队"。防"跳过蒸馏、直接建普通角色队"再次发生。无 fs 环境放行（不误拦）。
- `package.json`：version 0.2.4 → **0.2.5**。
- `README.md`：版本徽标 v0.2.5、单测 189→193。

## [0.2.4] - 2026-10-08

### 新增

- **jarvis_lesson（第 23 个工具）**：进度经验结构化器（ws8634 八类问题归档借鉴——防"自由文本教训不可检索/不可归因/不可复用"）：每条教训统一为 分类/主责/现场标记/修向/状态/复现脚本 六字段，机械校验缺项并输出可直接写入 .jarvis/lessons.md 的规范条目。模式：schema=字段规范 / validate=校验教训文本是否结构化（状态必须 open/fixed/verified，禁模糊状态）/ entry=从字段渲染规范条目。任何教训沉淀前先过本工具，防止"记了就以为解决了/同类问题反复踩"。

### 变更

- **jarvis_review 加可证伪预期门禁（ws8634 Evolution adopt 借鉴）**：裁决若构成"采纳方案/对外承诺/宣称改进"，必须带 expected_effect（如果有效应观察到什么：指标/场景+阈值+时限）；缺预期或预期空泛 → falsifiableGate=false 打回补预期，防"采纳了但没用/宣称改进实则没变"。
- **jarvis_store save lesson 提示须过 jarvis_lesson 结构化**：写入 lessons.md 前强制走结构化工具。
- `package.json`：version 0.2.3 → **0.2.4**。
- `README.md`：版本徽标 v0.2.4、单测 116→189。

## [0.2.3] - 2026-09-03

### 新增

- **jarvis_coverage（第 22 个工具）**：覆盖核查器（收口前自动硬闸——防"漏细节"）：输入源清单（如需求规格条目）+ 目标清单（方案落点/测试用例/交付状态，每条 refs 声明覆盖谁+status+evidence）→ 自动报 未覆盖（哪条需求无落点）/悬空引用/未收口（in_progress 当完成）/终态无证据（自报式通过）。**领域无关**：只查"清单对清单的引用闭合+状态收敛+终态有据"，清单类型由 CEO 现场定义，零领域预设（制造业需求清单/软件需求清单同样适用）。
- **jarvis_taskgraph（第 21 个工具）**：任务编排图校验器（CEO 派活前的硬产物闸——学 HuggingGPT 依赖图思想）：校验任务清单的 依赖闭环（无悬空）/无自依赖/无循环依赖/每任务验收可判定/有依赖须写输入来源/拓扑分层并行建议。**任务类型不预设枚举**（领域无关，CEO 按需求现场拆）；只做结构健康检查不替代 CEO 判断。产物沉淀 docs/任务编排-*.md 且可写入 company-state tasks 表（3D 任务看板数据源）。M/L 级派活前必经闸，S 级简版。

### 移除

- **web 黑板面板按钮+浮层（Client 半边）**：`src/client/plugin.js` 整文件删除（0.2.2 引入的"📋 黑板"会话头部按钮 + 15s 轮询浮层）——只读弹窗无操作能力、与对话流重复，实际价值低。**host 侧数据/API 全保留**（`.jarvis/board.json` + `/api/luke-jarvis/board` + `jarvis/board` RPC），3D 办公室阶段重新设计呈现（如公司大厅可视化嵌公司状态快照，黑板未决项并入）。

### 变更

- `package.json`：version 0.2.2 → **0.2.3**；移除 `dsh.client` 声明与 `exports["./client"]`；`src/` 仅剩 `host/`。
- `README.md`：版本徽标 v0.2.3、单测 104→110、verify 40→43、3D 节补 tasks 表。
- `docs/ARCHITECTURE.md`：**重写对齐 v0.2.3 现状**（旧版停在 13 步/18 工具/62 测试的早期架构）。

## [0.2.2] - 2026-08-28

### 新增

- **web 黑板面板（Client 半边）**：会话头部"📋 黑板"按钮 + 浮层展示 `.jarvis/board.json` 的未决项/阻塞/决策（15s 自动刷新，Host RPC `jarvis/board` 读取）。**仅当前会话工作区存在 .jarvis/（用了 /jarvis）才显示**——不入侵其他会话/插件。
- `dsh.client` 声明：bundle 的 client 半边接入 web clientModules 扫描（此前 client 半边为空，web 无渲染）。

## [0.2.1] - 2026-08-28


### 新增

- **jarvis_update（第 19 个工具）**：插件版本检测器——对比本地 package.json version vs GitHub 远程最新 release tag（git ls-remote），判断是否有新版本；有新版本输出 CHANGELOG 摘要 + 升级步骤（解包覆盖 node_modules + 重启 dsh web）。网络/git 不可用时如实报告"无法检测"，不编造版本号。
- **员工卡强化协议**：每个员工卡必须拥有"这位真实大佬自己的思维"——以人物视角独立思考（不迎合用户/角色卡/会议从众），关键决策以人物视角跑 ponder 满血十阶段；`jarvis_essence` 检出迎合即打回。
- **空闲积累业务深度**：员工未分配任务/等待时不空转——读 `.jarvis/project.md`+board+lessons 吃透业务，多跑 ponder 对职责相关未决问题预演，产出"我的业务理解"写黑板；发现依赖未明主动对齐。

## [0.2.0] - 2026-08-28


### 新增

- **jarvis_clarify（第 18 个工具）**：需求澄清引导器——需求模糊时 CEO 专业分析先行（5 角度候选问题）+ 蒸馏触发 T1-T5 机械可判 + 三阶提问（开放→聚焦→确认，每轮≤2 问）+ 双人协作方案 + 澄清完成判定。阶段一协议升级为"引导用户"而非"干等/代为澄清"。
- **jarvis_release rollback 回滚**：任何领域交付物改错可 undo，必带原因留痕。
- **jarvis_perf 阶段性完成度考核**：`stageStatus` 参数（pending=阶段未到→待考核不计 0 产出 / assigned+in_progress=按阶段结果 / due=到期未完成才不达标）+ `stageRequirement` 阶段要求基准；连续 2 次不达标才换人，防"任务未分配误判 0 产出"。
- **满血 ponder 必用**：`jarvis_think_deep` 全 stakes（high/medium/low）加载 ponder 完整十阶段，禁止轻量七段替代；低赌注精简 agent 规模但阶段一个不少；run_id 溯源。
- **猎头模式 + 阶段产出闭环**：员工领任务后规定阶段性产出（里程碑/要求/到期）；员工可主动发起猎头（能力缺口→CEO 批准→现场蒸馏补强顾问）。
- **人事角色接入猎头补位**：CEO 考核不合格→通知人事（领域 HR 角色）猎头补位；人事非固化卡，建队时与 CEO 一起现场蒸馏领域 HR 大佬。
- **企业级治理**：
  - 版本管理机制（铁律）：任何领域交付物版本化
  - 权限职责分离矩阵：主面板/CEO/人事/员工边界 + 职责分离原则（考核者≠被考核者唯一裁决者）
  - 风险登记册：汇总 + 升级阈值（高风险/连续未缓解→升级）
  - 数据分级：公开/内部/机密三级，机密脱敏保护
  - 成本核算：ponder 满血成本可控 + 超支预警

### 变更

- **两层架构落地**：CEO 全程接管团队运营（建队后派活/盯控/换人由 CEO 设计、主面板代执行并署名 CEO）；员工只认 CEO 不认"队长"（平台 member 无 create_task 权限的现实约束）。
- **人事定位修正**：不是固化卡，是建队时与 CEO 一起现场蒸馏的领域 HR 大佬。

### 修复

- 防 0 产出误判：jarvis_perf 对"阶段未到/任务未分配"的员工不计不达标、不累计、不触发换人。

## [0.1.0] - 2026-08-27（初始发布）

### 新增

- **17 个 jarvis_\* 工具 + /jarvis 单命令入口**：
  - 接单分级 `jarvis_project`、项目记忆库 `jarvis_store`（check/scaffold/save/reuse）、流程设计 `jarvis_process`（无领域预设）
  - 蒸馏三件套 `jarvis_distill_guide`（提炼独有 HOW）/ `jarvis_distill`（结构+深度双闸≥60）/ `jarvis_fidelity`（保真度）
  - 思考与裁决 `jarvis_think` / `jarvis_think_deep`（七段对抗）/ `jarvis_review`（裁决）/ `jarvis_essence`（本质四查）
  - 协同与会议 `jarvis_collab`（四要素）/ `jarvis_meeting`（kickoff/cycle/close）/ `jarvis_board`（黑板）
  - 盯人与换人 `jarvis_perf`（5 维评估）/ 问题上行 `jarvis_escalate`（风险三件套）/ 能力补足 `jarvis_capability`
  - 交付契约 `jarvis_release`（版本快照/清单/留痕/状态）
- **两层架构**：Jarvis=主面板（对客户唯一接口），CEO=团队内角色（蒸馏出的真实大佬卡，带队+盯人+换人）。
- **蒸馏方法论**：借鉴 distilly(24k★)——7 品味原则（长文>碎片/争议>共识/变化>固定/一手>二手/讲过程>传记/重复模式>金句/失败>成功）+ 来源分级 + 黑名单源 + 6 类 HOW 指纹 + 验证锚点 + 防通用话术。
- **项目记忆库 `.jarvis/`**：prototypes（真实人物原型）/ cards（虚拟人物卡）/ process / components / board / project.md（项目细节+沟通留痕）/ lessons（经验）。AI 识别到项目直接读记忆继续，不用重分析源码。
- **版本化交付**：jarvis_release 快照/清单/状态/沟通留痕——乙方永远能说清"交付了什么、等什么确认"。
- **防 bug 铁律**：蒸馏深度硬闸（空洞卡一票否决）、问题上行不许跳过、能力补足三级路径、流程缺失=客户提 bug 温床。

### 文档

- `docs/ARCHITECTURE.md`：与代码逐条核对的真实执行架构（13 步回执 / 18 工具 / 技能阶段对应 / 铁律——**0.2.3 已重写**：判领域分支执行流 / 21 工具 / 产物闸体系 / 公司状态数据源）
- `docs/RELEASE.md` / `docs/PUSH.md` / `docs/UPGRADE-20260828.md`

[0.2.3]: https://github.com/ljjluke/luke-jarvis/releases/tag/v0.2.3
[0.2.2]: https://github.com/ljjluke/luke-jarvis/releases/tag/v0.2.2
[0.2.1]: https://github.com/ljjluke/luke-jarvis/releases/tag/v0.2.1
[0.2.0]: https://github.com/ljjluke/luke-jarvis/releases/tag/v0.2.0
<!-- [0.1.0]: 初始发布（本仓库第一个带 tag 的发布为 v0.2.0；0.1.0 为无 tag 的历史起点） -->
