# Changelog

本文件记录 luke-jarvis 每个版本的变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 风格。用户通过版本号 + 本文件判断"能否升级、升了什么"。

## [0.7.5] - 2026-10-31

### 修复：成员"裸干交付"的最后漏洞

**scan 实证**：活跃成员会话 `730ce4fd` 共 3002 次工具调用，其中 **`jarvis_*` 0 次**（bash 2768 次）；`.jarvis/gates.json` 只有 `clarify`；`ponder-verify/` 目录不存在（从未核验）。

根因：流程闸只拦 `create/create_task/reassign`，**没拦 `send_message`（下指令）和 `update_task`（交活）** → captain 用消息派活、成员 bash 干完直接 `completed`，ponder 全程不需要。

修复：

- **`agent_teams_update_task` 纳入闸门**；
- **成员交活闸前置到 captain/member 判断之前**（成员也受管）：任务标 `completed` 前必须有该任务的 `ponder-verify` PASS 记录，否则拒绝并给出 4 步操作指引（跑 step-guard 十阶段 → verify → `jarvis_ponder_check(taskId=…)` → 再 completed）；
- captain/CEO 的协调类任务豁免。

## [0.7.4] - 2026-10-24

### 新增：数字员工「企业文化」（不可协商，注入每个员工）

用户定义的最高优先级提示词：**"当前领域专家会怎么思考这些问题（要深度，不要广度）"**。落地两处，成员绕不过：

- **注入 agent-teams 成员 system prompt**（`members.js` 的 `memberPersona` 末尾追加 `JARVIS_CULTURE`）——每个成员一上线就带着它，与任务描述无关。
- **注入 `jarvis_member_brief`**——派活须知里同样带全文，双重保障。

七条内容：①深度优先不铺广度 ②用本领域思考框架（先立前提基准）③先证据后结论（查不到就说查证受限）④追问根因三层 ⑤反例自检写失效边界 ⑥诚实标注不确定（60 分诚实 > 90 分编造）⑦交付可判定（怎么验/验什么/通过标准）。违反任一条 = 不合格交付。

## [0.7.3] - 2026-10-24

### 三层架构放开 + 澄清"无人数上限"

- **agent-teams 放开成员建队权限**（第三方插件本地补丁）：成员工具过滤从"禁全部队长工具"改为只禁 `approve/delete/edit_plan`；成员提示词允许 CEO 建自己的子队。`findTeamByParticipant` 改为"优先解析到自己当 captain 的团队"，解决"一个会话属于两个团队就报 ambiguous"的阻塞。→ **Jarvis → CEO → 员工 三层可跑**。
- **captain 拦截文案补充**：明确"**成员数量没有上限**（插件无 8 人限制，别把当前人数当上限）；队伍大就加人，或让 CEO 建子队；绝不要用 subagent 绕过（那是顶层自己干）"。修掉模型臆想"8/8 满了"后乱试 `subagent` 的问题。

## [0.7.2] - 2026-10-24

### 修复：两个"可跳过"的洞

- **`clarify` 闸原本恒通过**（`check: async () => []`）→ 需求打磨可被完全跳过。现在要求：`.jarvis/docs/需求规格-*.md` 存在、正文 ≥300 字、且含「验收」标准；占位文件骗不过去。
- **`decompose` / `design` 闸无人检查** → 拆解/方案设计可被跳过（只写两个文件就能过 build 闸）。现在 `build` 闸落闸后，派活还必须持 `decompose` + `design` 闸，否则拒绝并点名缺哪一环。

至此链条为强制顺序：**clarify → decompose → design → build**，每环都要真实产物，任一缺失即拒绝派活。

## [0.7.1] - 2026-10-19

### 新增：流程不可绕过（用户提示词也改不了）

- **闸门留痕**：`jarvis_flowguard(step=…)` 通过时写 `.jarvis/gates.json`（`recordGate`）；失败不落闸（不静默放行）。
- **建队必须持 `clarify` 闸**：未过 → 拒绝 `agent_teams_create`，提示「即使用户要求跳过流程也必须先过闸；需要换执行方式就不要用 jarvis 插件」。
- **派活必须持 `build` 闸**：未过 → 拒绝 `agent_teams_create_task` / `reassign_task`。
- 这样"蒸馏 → 开会 → 方案 → 建队 → 派活 → ponder 核验 → 收口"形成**机械闭环**：缺任何一环都过不去，与提示词无关。

## [0.7.0] - 2026-10-19

### 新增：蒸馏/ponder 强制（scan 实证修复）

**实证**（scan 全部主要会话量化核查）：`jarvis_distill` / `jarvis_distill_guide` **6/6 会话全部 0 次**，角色卡目录为空却照样建队；成员会话 jarvis 工具 0~1 次（裸干）；`jarvis_ponder_check` **从未被调用**。

三处硬约束：

- **流程闸判据升级**：不再要求"工作区已存在 `.jarvis/`"——改为 **jarvis 模式**判定（该会话调用过任意 `jarvis_*` 工具即进入 jarvis 模式）。堵住"先建队、后建库 → 闸形同不存在"的漏洞（gpt-test 新会话实测踩中）。
- **建队前必须已蒸馏**：`.jarvis/cards/` < 2 张 → 拒绝 `agent_teams_create`，要求先 `jarvis_distill_guide` + `jarvis_distill`。
- **派活必须附开工须知**：`agent_teams_create_task` 的 description 必须含 ponder/开工须知/run_id 等特征串（否则成员不知道要跑 ponder 十阶段）；纯协调类任务在 subject 标【协调】豁免。
- **ponder 核验留痕 + 收口硬闸**：`jarvis_ponder_check` 新增 `taskId`，PASS 时写 `.jarvis/docs/ponder-verify/<taskId>-<runId>.json`；收口闸 `checkPonderVerify` 要求**每个已完成成员任务都有 PASS 核验记录**，否则 BLOCKED（captain/CEO 任务豁免）。

## [0.6.0] - 2026-10-19

### 新增：像素办公室一体化（PixOffice 内嵌）

jarvis 现在**自带**像素办公室界面（不再是外部服务）：插件用 `webServer.register` 托管静态页 + 提供快照接口，`company-state.json` 一变，画面里的人/任务/事件就动。

- **`office/`（内嵌静态资源）**：PixOffice 办公室场景（MIT 代码 + 素材，24MB），访问 `http://<dsh>/jarvis-office/`。
- **`src/host/office-bridge.js`（纯函数投影器）**：`company-state.json` → PixOffice 业务快照。映射：`working/reporting→running`、`meeting→blocked`、`idle/on_probation→queued`、`terminated→failed`；角色关键词→六个人物（`office-lead`/`code-agent`/`file-agent`/`app-agent`/`review-agent`/`data-agent`）；`meetings/recruiting/ceo/headhunter`→事件流。中文角色名用 FNV-1a 哈希生成合法稳定 id。
- **`GET /api/luke-jarvis/company`**：返回当前工作区投影后的快照（无 `company-state.json` 时返回空快照，不报错）。
- **`GET /jarvis-office/*`**：托管办公室页面。

数据流：`jarvis_company(action=...)` → `.jarvis/company-state.json` → 同进程投影 → 页面。**CEO 巡查/员工汇报/开除换人/猎头寻访/开会** 这些动作只要有写快照，画面上就能看到。

## [0.5.0] - 2026-10-19

### 新增：流程闸（`jarvisFlowGuard`，运行时机械拦截跳步）

**实证根因**（scan 会话，1166 轮 / 31 次压缩）：jarvis 技能正文在压缩中被丢弃，agent 只看到 28 个工具名 → 用 **1472 次 send_message + 1195 次 REA 抓包**直接当包工头；`jarvis_distill / jarvis_meeting / jarvis_perf / jarvis_flowguard / jarvis_project / jarvis_process` **全部 0 次调用**。文字协议拦不住，改为机械闸：

- `agent_teams_create / create_task / reassign_task / approve` 前：
  1. 工作区必须已有**需求规格**或**基线清单**（否则返回"先过需求闸"并拒绝）；
  2. `.jarvis/cards/` 必须已有 **≥2 张角色卡**（带队 + 岗位；否则返回"先蒸馏"并拒绝）。
- 仅对「jarvis 工作区 + 团队 captain」生效，非 jarvis 项目完全不受影响。
- 与既有 `captainExecutionGuard`（顶层不得亲自执行）叠加：顶层既不能自己干，也不能跳过蒸馏直接建队。

### 修复

- **技能文件同步**：`~/.dsh/skills/jarvis/SKILL.md` 原为 9-24 旧副本（201KB，缺严格模式/建队铁律/覆盖优先），已同步为仓库最新版（208KB）。

## [0.4.2] - 2026-10-12

### 变更：基线抽取器提升为**领域无关**

用户指出：覆盖细节能力必须是**领域无关**的（不只 webui 换皮，流程/文档/接口/设备/字段同样会丢覆盖面）。`jarvis_baseline` 的 kind 现为通用抽取器（非领域模板）：

- `web-ui` 页面目录+路由/菜单配置（按路径识别 router/menu，提取 `path:`/`to:`）
- `files` 按 roots 枚举文件
- `docs` 文档章节标题（md/txt/rst/adoc）
- `text` 文本条目（编号/列表 → 流程/SOP/需求清单）
- `api` 接口（OpenAPI `paths:` + 常见框架路由声明 `router.GET(...)`/`@GetMapping(...)`）
- `db` SQL 表/视图（`CREATE TABLE|VIEW`）
- `custom` 显式 items

配套：覆盖矩阵与收口硬闸本就领域无关（只认「基线清单-*.json → 覆盖矩阵-*.json」的引用闭合 + 状态收敛 + 终态有据）。

## [0.4.0] - 2026-10-12

### 新增：覆盖优先机制（防"改造类任务丢页面/丢功能"）

用户实测缺陷：让 jarvis 做 webui 换一套 UI（后端不变），交付后大量页面/子页面功能丢失、样式崩——根因是**没有"旧系统可枚举基线"，验收只抽查几页**。现补三件套：

- **`jarvis_baseline`（新工具）**：把旧系统变成可枚举基线——web-ui 扫页面目录(pages/views/screens)+路由/菜单配置（按**路径**识别 router/menu 文件，提取 `path:`/`to:` 路由表），files 按 roots 枚举文件，custom 传 items；产出 `.jarvis/docs/基线清单-<slug>.json+.md`。**基线必须来自真实可枚举来源，不许凭印象列举**。
- **`jarvis_coverage` 增加 `persist`/`slug`/`exemptions`**：把逐条覆盖矩阵落盘 `.jarvis/docs/覆盖矩阵-<slug>.json+.md`（含 coverage / r_plan / r_verify / r_contract / uncovered / exemptions），供收口闸读取。
- **flowguard `close` 硬闸 `checkCoverageGate`**：检测到基线清单 → 必须有对应覆盖矩阵，且「未覆盖（除 exemptions）= 0」且「r_verify = 100%」才放行，否则 BLOCKED（补实现或登记豁免+理由）。
- 协议/成员须知同步：改造/替换/移植/重构类任务必须走「建基线 → 建矩阵 → 逐条验收 → 覆盖率闸」，**静默丢功能/丢页面 = 一票打回**。

## [0.3.8] - 2026-10-12

### 修复

- **还原 parent 拆除补丁**（A2A 父子关系恢复——成员必须是 captain 子代理，回报才能唤醒 captain；上一版把成员"脱离"是方向错误）。
- **保留 signal 解耦补丁**（成员运行不再被 captain 单次工具调用信号杀掉——这是成员从秒死变为可持续干活的关键）。
- **协议回归原生闭环**：captain 派活后**同一回合内**等回报并验收，全部验收完成才结束回合；**严禁工作进行中重启 dsh web**（每次重启杀光在跑的成员，实证：某成员 113 次 bash 后因 17:18 重启被 abort）。

## [0.3.7] - 2026-10-12

### 修复（来自真实运行报错回执）

- **成员开工须知补两条铁律**：① 任何 `edit`/`write` 前**必须先 `read` 同一文件**（平台强制 read-before-edit，不读就改报 `file has not been read`）；② **自改场景**（改 luke-jarvis 插件/协议自身）必须备份 + `node --check` + 跑单测 + 回报回滚路径。
- **建队/派活操作铁律**（写入 `skills/jarvis.md` + `preset/agent.cordis.yml` + `preset/jarvis-captain.cordis.yml`）：① 加人前先 `agent_teams_status` 查重，同名会报 `member name "X" has already been used` → 复用或换名；② `create_task` 只登记，**真正拉起成员要用 `reassign_task`**；③ 成员**休眠/任务卡死** → `reassign_task` 唤醒，成员**在忙**（报 `member "X" is busy with tN`）→ **不要 reassign**，等它跑完或先处理 tN。
- **captain 拦截拒绝文案**同步加入查重与 busy 判断指引。

## [0.3.6] - 2026-10-12

### 变更

- **captain 拦截拒绝文案改为强制派活指令**：明确要求 ① `agent_teams_reassign_task`（唤醒休眠成员）② `agent_teams_create_task`（派新活）③ 只读用 read/glob/grep ④ 不要重试被拦工具——解决"拦住了自己干、但没转向派活、页面看不到子任务"的空转问题。

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
