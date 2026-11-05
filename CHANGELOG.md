# Changelog

本文件记录 luke-jarvis 每个版本的变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 风格。用户通过版本号 + 本文件判断"能否升级、升了什么"。

## [0.13.0] - 2026-11-05

### 增强 UI v2：真接 DSH（动态浮动块 + 3D 协作空间 + 语音大模型设置）

用户给了 `webui/jarvis-v2-wings.html` 并提出四点：语音能否接模型、浮动块要动态、员工协作要做成 3D、要真接 DSH。

**1) 语音（原 Web Speech API → 可配语音大模型）**
- 新增 `state/voice.js`：全局配置 `~/.dsh/luke-jarvis/voice.json`（权限 600），`provider: browser|openai`，
  可选 `baseUrl/model/voice/speed`，API Key **只写不读**（GET 返回 `sk-…abcd`）；
- 新增路由 `GET/PUT /api/jarvis/voice`（含音色/模型预设）与 `POST /api/jarvis/tts`（OpenAI 兼容 `/audio/speech` 代理，key 不出服务端）；
- 前端：光球菜单 →「语音设置 · 模型与音色」可配置并试听；已配置模型时走模型音色，失败自动回退浏览器语音。

**2) 主界面浮动块全部动态**
- 快照 `/api/jarvis/state` 每 5s + 事件流每 3s 增量驱动：当前阶段/缺口/流程闸/最新事件/接入通道/下一步/对话三指标；
- 进度页：真实六阶段链、缺口、事件控制台、按事实计算的汇报指标；
- 右下角光球菜单保持静态鼠标菜单（唯一非数据区）；
- 移除全部写死的演示文案（测试会拦"全局服务巡检""5 人在线""09:55"）。

**3) 员工协作空间 → 真 3D（Three.js，MIT，已 vendored，不走 CDN）**
- 环形 6 工位 + 中心全息白板 + 网格平台 + 动态光；角色=胶囊体+球头+状态环+名牌；拖拽旋转/滚轮缩放/点击成员播报；
- 主题色取页面 CSS 变量，与全息 HUD 一致；数据来自 `state.tasks.byAssignee`；
- 换用用户提供的开源 3D 办公室时只替换 `office/v2/scene3d.js`，保持 `createOffice3D(canvas)` + `setMembers()` 接口。

**4) 真接 DSH**
- `/jarvis-ui` 302 指向 `/jarvis-office/v2/index.html`；静态托管走既有 `/jarvis-office` 前缀；
- 页面只依赖 4 个契约端点（state/events/voice/tts），不读 `.jarvis` 文件布局。

新增 `docs/UI-v2.md`（接入说明 + 开源语音模型对照 + 3D 替换约定）。
验证：plugin 320 + core 14 = **334** 全绿；selfcheck / 工具契约 31 / e2e 全过；版本 0.13.0。

## [0.12.0] - 2026-11-05

### 能力规划 + UI 契约 v1（底座仍是 DSH，jarvis 只做"公司层"）

用户要求：底座用 DeepSeek Harness，jarvis 是插件但能力要强，先把能力规划好，后期要接增强 UI。

**1) 新增 `docs/能力规划.md`（规划正文）**
- 边界表：L0 DSH 运行时 / L0.5 agent-teams / L1 流程引擎 / L2 组织协作 / L3 知识资产 / L4 交付验收 / L5 UI 契约；
- 能力矩阵：31 个工具按域归类，逐项标「✅已有 / 🟡半成品 / ⬜未做」+ 优先级 + **可判定验收**；
- 路线图 P0（已完成基线）→ P1（事件流/受控命令/快照差分/回放/换人闭环）→ P2（审计成本/三层团队/记忆检索/报告导出）→ P3；
- 非目标：不重写 agent 循环、不把 UI 渲染塞进插件、不用提示词承担强制、不做跨项目共用记忆。

**2) UI 契约 v1（后期增强 UI 的唯一接口，`state/snapshot.js`）**
- `GET /api/jarvis/state`：全量快照 `{schema:'jarvis.snapshot/1', snapshot:{stage,gates,artifacts,tasks,board,meetings,cards,memory,company,capabilities}}`；
- `GET /api/jarvis/summary`：轻量摘要（轮询/头图）；
- `GET /api/jarvis/capabilities`：工具数/版本/面板 id/阶段定义；
- 原则：UI 只读快照 + 只发命令，不直接改 `.jarvis/`；快照只读无副作用、字段可缺省、带 schema 版本。

**3) 事件流（UI 时间轴数据源，`state/events.js`）**
- `.jarvis/events.jsonl` append-only，自增 `seq`，坏行跳过；`GET /api/jarvis/events?since=&limit=`；
- 已接写入点：闸记录（recordGate）、黑板写入、会议纪要落盘、派活（dispatch）。

验证：plugin 316 + core 14 = **330** 全绿；selfcheck / 工具契约 31 / e2e 全过。

## [0.11.2] - 2026-11-05

### 去提示词化的第二刀：成员须知不再用"必须先跑 ponder"下命令，硬要求改挂可验证的交付物

用户要求：不要用提示词强调必须执行什么，流程要固化，否则压缩后提示词掉精度。

**改法（brief / executionPrompt / 协议刷新广播，三处同口径）**：
- "## 二、思考必 ponder（任何需要思考的动作都要跑）" → "## 二、深度思考（可用资源：ponder 十阶段——不是流程闸，插件不校验）"；
- 明说硬要求只有一条且可验证：交付里要有「反方攻击 / 失效边界 / 置信度」——用产物证明思考，不用调用记录证明；
- 删掉"提交前 verify 必须 PASS 才能上报""任何情况下不许静默跳过""必出 run_id""本单恒为 true"这类无机制支撑的命令；
- `mustRunPonder` 字段从 `true` 改为 `false`（原来谎称"恒为 true"，与实际闸门不一致）。

**原则（现在统一执行的）**：注入的 prompt 只放①说明②文化③由磁盘事实生成的现场信息（阶段/缺口/续接事实/会议判定/角色卡）；
凡是"必须做到"的事，一律由代码判定（闸/判定/落盘校验），prompt 不承担强制。

验证：`node --test` plugin 312 + core 14 = **326** 全绿；selfcheck / 真实 ToolRuntime 31 工具 / e2e 全过。

## [0.11.1] - 2026-11-05

### 去提示词化：压缩后不再用 prompt 要求模型"先读记忆"，改成插件直接把磁盘事实放进上下文

用户要求：不要用提示词强调"必须执行什么"，要流程固化，否则压缩后提示词掉精度。

**原来（0.11.0）的问题**：`compact/resume/clear` 时追加一句 prompt「先 jarvis_store(check) 读回 project.md，不要凭记忆补」——
这正是"靠提示词提醒"，压缩/换模型都会掉。

**现在（0.11.1）**：
- 新增 `src/host/state/resume.js`：`renderResumeFacts(cwd)` 从磁盘读出
  `project.md 的 进度/下一步/未决/团队/关键决策`（标签锚定、去重复前缀、不会被"拍板"之类词抢行）
  + `computeStage().done` 已过闸 + 未完成任务 + 黑板未决，渲染成 `【续接事实 · 插件每轮从磁盘重算】` 块；
- 阶段段 `text()` = `renderStage(cwd)` + 续接事实，**每轮重新生成**；agent 创建即挂（`agent/created`）；
- 删掉 `continuationNotice`（那条"必须先读记忆"的提示词）与 `noteAgentStart` 记录；
- 会议行改为陈述机制（"纪要落 …，没有纪要=这场会不算开过，闸会拦"），不再写"用某工具开会"。
- 测试：新增续接事实用例（标签不重复/不被抢行/不含命令词）；`312 + 14 = 326` 全绿。

## [0.11.0] - 2026-11-05

### 抗上下文压缩：阶段段「创建即挂」+ 压缩/恢复提醒（首个请求就生效）

用户担心：装好后用 jarvis，上下文压缩了会不会出问题。

**发现的真缺口**：阶段段原来只在**第一次调用 jarvis_* 工具时**才挂到 agent 上——新会话/压缩后重建的 agent
在首个请求看不到「当前第几步」，只能靠模型记忆（压缩后恰恰最不可靠）。

**修复**：
- 监听 `agent/created`（payload 含 `source: startup|resume|clear|compact`），**创建即挂** `luke-jarvis:stage`；
  首次调用 jarvis 工具时仍保留兜底挂载（宿主不派发事件也能补上）。
- 阶段段文本每轮从 `.jarvis/` 重算；`compact/resume/clear` 来源额外追加提醒：
  「先 jarvis_store(check) 读回 project.md 续接五件套，需求细节从需求规格读，不要凭记忆补」。
- `noteAgentStart` / `continuationNotice` / `ensureAgentStageSection(agent)` 导出（`tools/index.js`）。

**结论（写进 docs/执行流程.md 第九节）**：协议段每请求注入、阶段段创建即挂且每轮重算、三闸每次调用判定、
工具与判定现读磁盘 → 压缩/重启/新会话不影响流程；会丢的只有对话记忆，补救 = `.jarvis/` 落盘 + 首轮读回提醒。

验证：`node --test` plugin 311 + core 14 = **325** 全绿（新增压缩场景用例：agent/created 即挂段、compact 追加提醒、幂等、startup 不提醒）。

## [0.10.9] - 2026-11-05

### 纪要必须有多人发言（一个人自说自话不算开会）

`checkMinutesShape` 新增一条实质判定：`content` 里必须有 **≥2 个不同发言人**的观点（谁说了什么）。
缺了不落盘、不算开过——补上"开会"与"自己写个纪要"的区别。

验证：`node --test` plugin 310 + core 14 = 324 全绿；`node scripts/demo-flow.mjs` 会议两步正常。

## [0.10.8] - 2026-11-05

### 会议从「摆设」变成「由事实判定 + 纪要即证据 + 该拦就拦」

用户问题：团队什么时候该开工会/头脑风暴、什么时候该开冲突会、什么时候收口——怎么判定？别只是摆设。

**1) 新增 `src/host/state/meetings.js`（会议判定单一事实源）**

从磁盘事实算出必开/建议/不必开，不看模型自觉：

| 事实 | 判定 |
|---|---|
| 有团队有任务、无开工纪要 | 必开 开工对齐会（目标/验收/接口/分工/红线） |
| 黑板有未解决「阻塞」或「接口变更」 | 必开 循环会（逐条解法/负责人/时限） |
| 黑板未决项 ≥3 | 必开 收敛会 |
| 同一主题两个成员并行 | 必开 循环会（分工冲突：定谁负责、接口怎么切） |
| 开工后新成员进场 | 必开 上下文对齐会 |
| 任务全交完、无收口纪要 | 必开 收口会 |
| 都不成立 | **不开会**（明确说"黑板收敛，继续干"，防开会成瘾） |

节点纪律：最近一次循环会之后黑板无新变化 → 不重复催；议题/参会人从黑板条目与真实任务 assignee 推出（不是空模板）；
会议归属只算自家团队（别家的缺口不拦本项目）。

**2) 纪要即证据（堵住"只宣布开会、不留纪要"）**

- `jarvis_meeting` 现在**所有模式**都持久化纪要到 `.jarvis/meetings/<id>-minutes.json`（原来只有群聊模式写）；
- 缺 `topic / attendees≥2 / resolutions|conclusion / actions` 任一 → **不落盘**并点名缺什么；
- 不传 `minutes` → 明确返回"这场会不算开过"；返回 `minutesSaved/minutesMissing/nextMeetingRule`（下次该不该开会）。

**3) 在流程里真用起来**

- `jarvis_flowguard(step=build)` 报「必开开工对齐会」；`step=execute` 报开工/循环会；`step=close` 报收口会；
- 阶段注入每请求一行 `会议：必开 …/不必开会`（`renderStage`）；
- `jarvis_dispatch_task` 派活时把当前必开的会带回 summary；
- `jarvis_board` 的 `needsMeeting` 改走同一判定（不再在黑板工具里手写第二份口径）。

**4) 演示与验证**

- `scripts/demo-flow.mjs` 增加会议两步：建队后出现「必开 开工对齐会」→ 写纪要后清除；任务交完出现「必开 收口会」→ 写纪要后清除。
- `node --test` plugin 310 + core 14 = **324** 全绿（新增 6 个会议判定/纪要用例）。

## [0.10.7] - 2026-11-05

### 成员的「思考」用什么证明：从"查有没有跑 ponder"改成"看产物里有没有思考痕迹"

回答用户提问「团队每个成员下面思考过程用到了 ponder 吗」时查到的事实：
- 成员须知里确实要求「思考必 ponder」并给 bash 免 skill 执行路径（`review.js` 195-200 行），
- 但插件**不校验、不记录**成员是否真的跑了（0.10.5/0.10.6 按要求拆掉了 ponder 通行证与收口要求），
- 这台机器上没有真实团队与 ponder 运行数据，无法给出实测证据。

因此本轮补的是**产物侧证明**（与"流程固化、不考核步骤"一致）：
成员回报格式由「结论/证据/ponder run_id」升级为必填六段——
**结论 / 证据 / 反方攻击 / 失效边界 / 置信度 / 盲点 / 阻塞**，并把 ponder run_id 降为可选溯源。

理由：反方攻击、失效边界、置信度正是 ponder 真正产出的东西；插件不查过程，但交付物里看不出这三样
= 思考没发生。用产物证明思考，不用调用记录证明。

验证：`node --test` 304 + core 14 = 318 全绿（新增交付格式用例）。

## [0.10.6] - 2026-11-05

### 阶段机与收口闸去掉 ponder 要求 + 执行流程文档/可跑演示

- `computeStage`：execute 阶段不再要求 ponder 核验记录；close 阶段 next 文案去掉 ponder 核验；
  注入文本里 `ponder核验=N` 改为 `ponder记录（可选，不作闸）=N`（与"不考核步骤"一致，避免误导）。
- `jarvis_flowguard(step="close")`：去掉 `checkPonderVerify` 缺口（收口判据仍是三产物闭环 + 覆盖矩阵 + 黑板归拢）。
- 新增 `docs/执行流程.md`：六阶段状态机、一次真实任务时序（23 步）、三条子流、闸清单（留什么/不再考核什么）、
  状态目录、观察命令、诚实边界。
- 新增 `scripts/demo-flow.mjs`：真跑一遍阶段机（造真实产物 + 打插件判定），`node scripts/demo-flow.mjs` 可见
  1/6 → 6/6 的推进与越阶段拒绝，作为流程说明的可复现证据。

验证：`node --test` 317/317；`node scripts/demo-flow.mjs` 六阶段推进正常（含越阶段拒绝）。

## [0.10.5] - 2026-11-05

### 把「基本工作流程」固化进插件，而不是考核「有没有用过某个步骤」

用户定调：要的是流程长在插件里，不是插件不停检查"你跑没跑 ponder、抄没抄须知"。本轮按此重构。

**1) 新增 `jarvis_dispatch_task`（流程固化 = 正确的路最省事）**

一次调用内部完成两件事：
① 调 `jarvis_member_brief` 生成「**角色卡全文** + ponder 指引 + 回报格式」的成员须知；
② 调 `agent_teams_create_task` 把须知自动拼进任务描述建任务（保留原描述与验收标准）。
于是「派活要带卡和须知」不再需要闸去查表——插件自己把它做掉了。内部经宿主 `tools.execute`
做嵌套调用；宿主不支持时明确降级为手工两步并给出指令。

**2) 去掉「步骤执法」类硬闸（保留流程产物闸）**

- `agent_teams_update_task(status=completed)` 不再要求 `.jarvis/docs/ponder-verify` PASS 记录：
  ponder 是深度思考方式，不是通行证；验收看产物与证据。
- `agent_teams_create_task` 不再校验描述里有没有「开工须知/角色卡标记」（0.10.4 刚加的那道）。
- `jarvis_flowguard(step="build")` 不再把「任务缺须知/缺卡」列进缺口。
- **保留**流程产物闸：需求规格 → 任务编排 → 方案设计 → 建队 → 收口覆盖矩阵（这才是"流程"本身），
  以及顶层不亲自执行的职责闸、状态根/归档隔离等安全闸。

**3) 文档与提示对齐新口径**

- `JARVIS_SYSTEM_PROTOCOL` 第 9 步改为「jarvis_dispatch_task 一步到位」；第 10 步改为「看产物与证据，
  ponder 可选不是通行证」；第 11 步去掉 ponder 核验。
- 阶段注入在 build 阶段会提示 dispatch 用法；成员须知结尾改为推荐 dispatch。

**4) 验证**

```
node --test test/plugin.test.js test/core.test.js → 317 / 317
bash scripts/selfcheck.sh → 全过（TOOLS-COUNT-OK 31）   node scripts/verify-tool-contract.mjs → 真实 ToolRuntime 31/31
node test/e2e-flow.test.mjs → 31 工具链路闭环
```

## [0.10.4] - 2026-11-05

### 角色卡真注入 + 真机路由 bug 修复（"蒸馏了，但员工真按大佬方式工作吗？"）

用户质疑命中了一个真缺陷：**卡只在写侧被使用（jarvis_distill 校验、jarvis_store 落盘），读侧从来没人读**。
成员开工须知只写「按你的角色卡方法论」，但成员上下文里根本没有卡文本——等于名义蒸馏、实际用模型默认的通用思路干活。

**1) 角色卡真注入（机制，不是提示词）**

- 新增 `src/host/state/cards.js`：`findRoleCard` / `findRoleCardSync`（按角色名在 `.jarvis/cards/` 命中、跳过
  `cards/history/`、读出六段式）+ `cardStructureOk`（缺哪段报哪段）。
- `jarvis_member_brief` 生成须知时**把卡文本嵌进去**（`## 六、你的角色卡` 段 + 卡文件路径 + 用法：把六段式
  当作 ponder 画像的人物视角）；找不到卡 → 须知里显式写「⛔ 先蒸馏再干」，输出 `cardMissing: true`。
- 派活闸 `jarvisFlowGuard`：assignee 已有卡但任务描述没有卡注入段 → 直接拒绝建任务（给出修复指令）。
- 建队闸 `jarvis_flowguard(step="build")`：新增 `auditTeamCards` 审计，未注入卡的任务列出来打回。
- 不注入卡的后果从"没人知道"变成"机械失败"。

**2) ponder 链路复核（原本已有硬闸，这次一并说清）**

- 成员交活 `agent_teams_update_task(status=completed)`：无 `.jarvis/docs/ponder-verify/<taskId>-*.json`（verdict=PASS）
  → 闸直接拒绝（`gates/flow.js`），裸干交付进不了 completed。
- 核验记录只能由 `jarvis_ponder_check` 写，而它校验 step-guard 的**完整性/顺序/子 agent 数/阶段产出文件**，
  自报"我跑了"不算。
- `jarvis_member_brief audit` + `jarvis_flowguard(build)` 双查「任务有没有附开工须知（含 ponder 指引）」。

**3) 真机启动暴露的路由 bug（HTTP 一调就现形）**

- `GET /api/luke-jarvis/company` 返回 `{"ok":false,"error":"relayPath is not defined"}`——`relayPath` 定义在另一个
  try 块作用域，跨块引用；改用本块 `path.basename`。
- `GET /api/luke-jarvis/board` 读 `/.jarvis/board.json`（systemd 下 `process.cwd()='/'`，apply 期预热把 '/' 缓存成
  工作区）——新增 `requestWorkspace()`：`?workspace=` > live 会话 cwd > agents 列表；解析不到就明确报
  `no workspace`，不再拼出一个看起来能用、实际读错的路径。

**4) 验证**

```
node --test test/plugin.test.js test/core.test.js → 317 / 317（新增 5 个卡注入/路由回归用例）
bash scripts/selfcheck.sh → 全过      node scripts/verify-tool-contract.mjs → 真实 ToolRuntime 30/30
node test/e2e-flow.test.mjs → 闭环    真机：/jarvis-office 200、/api/luke-jarvis/* 正常、新会话 30 个 jarvis_* 工具
```

## [0.10.3] - 2026-11-04

### 完全对齐 DSH 插件规范（工具契约 / 导出形式 / display 元数据 / 预设声明）

本轮修的是**会让插件在真实宿主里跑不起来**的合规问题——此前 310 个测试全绿，但测试直接调
`tool.handler(...)`，绕过了宿主的工具注册管线。

**1) 工具契约（致命）**

宿主 `@deepseek-ai/dsh-tools` 0.2.x 的 `ToolDefinition` 契约是 `execute(args, exec)` +
`output.render(args, value) → ContentBlock[]`；本插件用的是旧写法 `handler(...)` + `render` 返回字符串。
真实注册时 `execute` 不存在 → 工具一调就崩；`render` 返回值也不符合内容块协议。

- 30 个工具全部改为 `execute`；`output.render` 统一经 `src/host/tools/index.js` 的适配层包装成
  `[{ type: 'text', text }]`（契约只有一处实现，工具内保留精简写法）。
- 注册前强校验：`assertObjectJsonSchema(parameters)` + `assertSupportedJsonSchema(output.schema)`，
  坏定义在 `apply` 期直接抛错，而不是等模型调用才炸。
- 新增 `scripts/verify-tool-contract.mjs`：把 30 个工具注册进**真实 ToolRuntime**，校验
  `schemas()` 数量/参数根、真实 `execute` 一次、`render` 返回 ContentBlock[]、disposer 注销干净，
  并且**真的跑一遍 `apply(ctx)`** 确认挂载后 30 个工具都在注册表 —— 已接入 selfcheck 第 15 项。
- `apply` 里删掉了二次 `defineTool` 包装与 `normalizeParameters/normalizeOutputSchema` 两个旧适配器：
  TOOLS 本身已是合法 ToolDefinition，重复包装会让「契约」出现两份实现。
- 修死代码：全局 `systemPrompt.section` 的 provider 以为能拿到 `agent`（`AssembleContext` 实际只有
  `{scope, signal}`），导致「当前第几步」**从未注入过**。改为在首次执行 `jarvis_*` 工具时，按 agent
  在其自己的 `agent.ctx` 上注册 `luke-jarvis:stage` section（幂等，provider 每轮重算）；全局 section 只留协议文本。

**2) 插件导出形式**

- 去掉 `export default { inject, apply }` 的混用形式，改为官方命名导出：
  `export const inject` / `export function apply(ctx)` / `export const name`。
  （Loader 的 `unwrapExports` 会优先取 default，混用会让命名导出失效。）
- selfcheck 第 2 项升级为：必须导出命名 `apply` + `inject`，且**不得**再出现 default。

**3) Bundle display 元数据（Plugin Manager 可见性）**

- 新增 `locale/en.json`、`locale/zh.json`（`meta.title` / `meta.description`）与 `icon.svg`；
  `package.json` 增加 `./locale/*.json`、`./icon` 导出，`files` 纳入 `locale` 与 `icon.svg`。
  此前安装后在插件列表里只有裸包名、无图标描述。

**4) 预设声明（安装链路的规范路径）**

- 预设不再复制到 `~/.dsh/.agent-presets/`（DSH 0.2 前的目录发现机制，现已不再读取）：
  `presets/*.patch.yml` 由 `scripts/build-preset-patches.mjs` 同步进本包 `cordis.patch.yml`
  的 `presets:auto` 区，**装上 bundle 即注册预设**；`--check` 同时校验两处，防漂移。
- `bin/luke-jarvis.mjs`：`setup` 去掉「预设落位」与「profile patch 写预设行」两步（只保留技能落位
  + bundle 登记），`doctor`/`status` 改为检查 bundle patch 是否声明两个预设；避免安装后重复注册。

**5) 版本线与依赖兼容（真机装出来的问题）**

- `dsh.engines.dsh` 由 `>=0.1.1-rc.1` 提升到 `>=0.2.1-rc.1`；peer `@deepseek-ai/dsh-tools` 同步
  （旧线没有 `execute/render` 契约，声明旧版本等于允许装出坏插件）。
- `@nanmicoder/dsh-agent-teams` 依赖由 `0.1.20` 提到 `^0.1.28`：0.1.20 的 peer 精确钉在
  `dsh 0.1.x`，在 dsh 0.2.1-rc.5 上会被安装器直接判定「incompatible」并回滚整次安装——
  真机 `dsh plugin add` 实测复现。0.1.28 的 peer 是 `*`、`engines.dsh >= 0.1.2-alpha.2`，
  且 `compatibility.json` 覆盖 0.2.1-rc.1~rc.3、仍保留 `memberMaxDepth` 配置键。
- 版本 0.10.3。

**6) 真机安装验证（临时 profile，不动 web）**

```
dsh plugin --profile ljtest add file:/opt/work/luke-jarvis   # 装成功：dependency + bundles 登记
dsh --profile ljtest --dump-config                            # 组合出 4 行：
  agent-teams-patch(memberMaxDepth:2) / jarvis-core(luke-jarvis) /
  preset-jarvis-org / preset-jarvis-captain
dsh --profile ljtest --port 0 --no-open                       # 真实启动 45s：无插件挂载错误
```
验证后已删除临时 profile（`~/.dsh/profiles/ljtest`）。

**验证（实跑）**

```
node --test test/plugin.test.js test/core.test.js → 312 / 312（新增 2 个契约用例）
node scripts/verify-tool-contract.mjs             → TOOL-CONTRACT-OK（真实 ToolRuntime）
bash scripts/selfcheck.sh                         → 15 / 15
node test/e2e-flow.test.mjs                       → 30 工具，链路闭环
node scripts/build-preset-patches.mjs --check     → 3 处无漂移
```

**仍未做**：`apply` 的 4 条路由仍在 `plugin.js`（约 300 行）；`tools/*.js` 的 import 面偏宽；
`vendor/superagent-background.ts` 仍未接线（P3 执行器）。

## [0.10.2] - 2026-11-04

### 结构整理（续）：分层收敛 / plugin.js 从 5,764 行降到 647 行

**问题**（0.10.1 遗留）：`plugin.js` 仍有 5,764 行——30 个工具、阶段机、流程闸、六审计、状态落盘、relay 协议全在一个文件里；改一段要读五千行，判定口径还各写一份。

**代码：按依赖方向单向分层（每步一个提交、每步 317 全绿）**

| 新模块 | 内容 | 依赖 |
|---|---|---|
| `src/host/runtime.js` | 宿主 ctx / 最近 exec / 工作区解析 / fs 服务探测 / fs 助手 / jarvis 会话登记 | 零 |
| `src/host/gates/ownership.js` | 归属判定 `resolveOwnedTeams`、状态根守卫、active-team 标记读写、协调/终态常量 | 零（node:fs） |
| `src/host/state/` | `board.js`（公屏 + 版本乐观并发）、`company.js`（3D 公司状态 + fs 兜底原子写） | runtime + ownership |
| `src/host/pixoffice/` | relay 帧/事件枚举/命令白名单/SSE（纯函数，无 IO） | office-bridge |
| `src/host/gates/store.js` | `.jarvis/gates.json` 读写（人工 note 幂等归档）、记忆保鲜、工作区画像缓存 | ownership |
| `src/host/gates/stage.js` | 阶段机 `computeStage`/`renderStage`/`jarvisStageGate` + `captainExecutionGuard` | store + ownership |
| `src/host/gates/flow.js` | 流程闸 `jarvisFlowGuard`（需求/角色卡/闸门/链条/ponder） | store + audit + stage |
| `src/host/gates/audit.js` | 六个机械审计（开工须知/人才层/自领/卡死/ponder/覆盖矩阵） | runtime + ownership |
| `src/host/tools/` | 30 工具按域拆 6 组（intake/memory/distill/review/org/deliver）+ `index.js` 汇总 | 上述各层 |

- `plugin.js` **5,764 → 647 行**：只剩 `apply`（挂载/4 路由/4 guard/systemPrompt/命令）+ `inject` + `/jarvis` 命令分词。
- 公开导入面**一个没改**（`test/plugin.test.js` 的 100+ 具名 import 全兼容，插件仍从 `plugin.js` re-export）。
- 依赖方向禁止反向：`plugin → tools → gates/state/pixoffice → runtime/core`；无环（`_flowState`/`_readGates` 下沉到 `store` 才断开）。
- 共享可变状态收敛：`moduleCtx`/`latestExec`/`_resolvedWorkspace`/`_jarvisSessions` 只在 `runtime.js` 有一份，其余模块走 `setRuntimeContext`/`markJarvisSession` 等访问器。

**工具与自检**

- selfcheck 第 15 项升级：分层文件清单（runtime/tools/gates/state/pixoffice/core/adapters/distill/protocol）+ **`TOOLS.length === 30` 且 handler 齐全**硬对账。
- 说明：工具名现在在 `src/host/tools/*.js`，selfcheck 的铁律/distill 检查改为递归 `src/host`（否则「拆完就红」）。

**验证（实跑）**

```
node --test test/plugin.test.js test/core.test.js → 312 / 312（新增 2 个契约用例）
bash scripts/selfcheck.sh                        → 15 / 15（含 TOOLS-COUNT-OK）
node test/e2e-flow.test.mjs                      → 30 工具，链路闭环
node scripts/build-preset-patches.mjs --check    → OK
```

**仍未做**（诚实债务，非遗漏）：`scripts/` 仍平铺；`vendor/superagent-background.ts` 未接线（P3 执行器）；`plugin.js` 里 apply 的 4 条路由仍在（约 300 行，可再拆 `ui/`，但收益低于风险，留作下一步）；`tools/*.js` 的 import 面偏宽（每文件带齐各层依赖，未做按需收敛——不影响运行，只影响可读性）。

## [0.10.1] - 2026-11-04

### 结构整理：模块化 + 全链路文档

**问题**：`plugin.js` 6,170 行把工具/闸/阶段/路由/协议全塞在一起；文档散落无索引；链路细节只存在于负责人脑内。

- **拆出 `src/host/distill/`**：`SECTIONS`/`EVIDENCE_SECTIONS`/`COLLAB_FOUR` + `checkCollabHealth`/`validateCardShape`/`assessCardDepth`/`distillGuide`/`identifyIndustry`/`checkContentFingerprint`（纯逻辑，`createRequire` 自带）。
- **拆出 `src/host/protocol/`**：`JARVIS_SYSTEM_PROTOCOL`/`JARVIS_CULTURE`（固定注入文本）。
- `plugin.js` 通过 import + re-export 保持导入面不变（`test/plugin.test.js` 的具名 import 不受影响）；6,170 → **5,764 行**。
- **新增 [docs/CHAINS.md](docs/CHAINS.md)**：11 条链路的唯一事实源/落点/验证命令（安装/挂载/预设/技能/工具/闸/状态/UI/测试/发布 + 债务清单）。
- **新增 [docs/README.md](docs/README.md)**：文档索引（入门/运维/设计/发布/归档）。
- selfcheck 第 15 项扩展为「领域内核与模块化」：core/index/adapters/distill/protocol 齐全。
- 测试：296 + 14 = **317 全绿**；selfcheck 15 项。

**仍未做**：`tools/`、`gates/`、`state/`、`ui/` 从 `plugin.js` 拆出（P2 待续）；`scripts/` 平铺未分组；`vendor/` 未接线（P3）。

## [0.10.0] - 2026-11-04

### 领域内核：把 dsh-superagent-prototype 的核心架构搬进 luke-jarvis

**背景**：此前「任务」只是模型自述 + 工具字符串，没有领域对象、没有生命周期、无法持久化与单测。本版引入 prototype 的分层：`core`（纯领域 + 端口）→ `adapters`（持久化/执行）→ 工具入口，`plugin.js` 不再包办一切。

- **新增 `src/host/core/`**（移植自 prototype `core/`）：
  - `model.js`：Ticket / Assignment / Report / Mandate / Stage / Outcome + 纯函数（liveTicket/latestAssignment/latestReport/waitsForPerson）
  - `ports.js`：`Repositories` / `Executor` / `Clock` / `Policy` / `Outbox` 端口 + 默认实现（noopExecutor/systemClock/allowAllPolicy）
  - `reasons.js`：结构化 reason 码 + 中文模板 + `reasonText()`
  - `stage.js`：`ticketStage()`（ended / person(review|blocked|failed) / working(queued) / idle）+ `canRetry()` + 中文描述
  - `tickets.js`：开单/派单/汇报/重试/停止/结束 + `TicketError(code)`，事务走 `repo.atomic`
  - `engine.js`：唯一入口 `adjudicate()`（过闸→记 decision→开单）+ report/retry/stop/get/list/view + 事件回调
  - `memory.js`：内存仓储（测试/预演，快照回滚）
- **新增 `src/host/adapters/json-tickets.js`**：`Repositories` 的 JSON 实现，原子写（tmp+rename）到 `<项目>/.jarvis/tickets/*.json` 与 `decisions/*.json`。
- **新增工具 `jarvis_ticket`**（第 30 个工具）：`adjudicate / open / list / get / report / retry / stop`；汇报语义对齐 prototype（ready→completed、dropped→dropped、blocked/failed→等人工且可 retry、stop→stopped）；插件仓库拒写（`STATE_ROOT_CONFLICT`，不建 `.jarvis/`）。
- **测试**：新增 `test/core.test.js` **14 用例**（原子回滚/开单/汇报结束/阻塞可重试/重试换派单/停止/非法汇报/阶段判定/裁决过闸与拦截/JSON 仓储跨实例/工具全流程/插件仓库拒写/reasonText）→ 主套 **296** + core **14** = **310** 全绿。
- **selfcheck** 第 15 项：core 布局齐全 + `jarvis_ticket` 已注册 + core 用例通过 → **15 项**。
- `package.json`：新增 `exports["./core"]`、`exports["./adapters/*"]`，`test` 脚本纳入 core 用例；版本 0.10.0。
- 文档：新增 [docs/CORE.md](docs/CORE.md)（分层对照/状态机/端口/台账）；STRUCTURE 与 README 同步（30 工具）。

**仍未做**：`adapters/dsh-executor.js`（`ctx.jobs`/`ctx.subagents` 真执行）与自动推进（P3）、`plugin.js` 其余纯逻辑拆分（P2 待续）。

## [0.9.2] - 2026-11-03

### 完全插件包装：一条命令装全（CLI + 预设生成物 + 结构文档）

**背景**：DSH 0.2+ 有三个硬约束，导致「装上了」≠「生效了」——`dsh plugin add` 只写 dependencies 不写 `bundles`；技能发现根不扫描 `node_modules`；预设不再自动发现 `~/.dsh/.agent-presets`。本版把这三步收尾做成一条命令。

- **新增 `bin/luke-jarvis.mjs`**（`package.json` `bin` / `exports["./cli"]`）：
  - `setup [--profile <name>] [--home <dir>] [--dry-run] [--force]`：技能落位（`~/.dsh/skills/jarvis`、`~/.dsh/skills/ponder`）+ 预设落位（`~/.dsh/.agent-presets/{jarvis-org,jarvis-captain}`）+ profile 注册（`dsh.profile.bundles += luke-jarvis`、`cordis.patch.yml` 幂等标记块写入预设注册行）；写前备份 `*.bak-<时间戳>`。
  - `doctor`：node 版本 / 技能完整（ponder `stages/*.json` >= 9 + `step-guard.cjs`）/ 预设落位 / profile bundles 与 patch 标记 / 运行副本版本一致性；`0`=通过，`2`=有 FAIL。
  - `presets` / `status` / `help`。
- **新增 `presets/*.patch.yml`（生成物）**：`preset/agent.cordis.yml`、`preset/jarvis-captain.cordis.yml` → `@deepseek-ai/dsh-agent-preset` 注册行；自动**去重**根 patch 已挂载的 `luke-jarvis` 与 `@nanmicoder/dsh-agent-teams` 行（防同一插件被根挂载 + 预设挂载两次）；手工预设文件保留完整行供「根 insert 失效」的 profile 使用。
- **新增 `scripts/build-preset-patches.mjs`**：生成器 + `--check` 漂移检查；`npm run build:presets` / `check:presets`。
- **`package.json`**：`bin`、`exports` 增 `./cli` / `./preset/*` / `./presets/*` / `./skills/*` / `./office/*`、`engines.node >= 22`、`files` 增 `bin`/`presets`。
- **`docs/STRUCTURE.md`**：目标结构树、分层职责、单一事实源、安装契约、迁移台账（P0 已完成 / P1 发布卫生 / P2 拆 plugin.js / P3 执行器）。
- **README 快速开始**改为「一条命令装全」，手工步骤保留为排障路径；组件映射表更新。
- **状态根守卫泛化（记忆文件零污染）**：新增导出 `stateRootConflict(dir)`，把「插件仓库自身不是 jarvis 状态根」从只拦闸记录/团队标记，扩展到**所有 `.jarvis` 写入方**——会话快照、基线清单、覆盖矩阵、ponder 核验记录、公司状态（含会议/绩效自动同步）、公屏 board、问题上行登记：在插件仓库内一律拒绝（返回 `STATE_ROOT_CONFLICT` / 明确 verdict），不再生成 `.jarvis/`。`.gitignore` 增补 `artifacts/`、`.dsh/`、`*.bak-*`；`selfcheck` 第 13 项实测「仓库根无 `.jarvis`/`.agent-teams`/`artifacts` + 忽略规则生效 + 守卫函数可用」。
- **本地归档移出仓库**：历史审计/记忆文档（原 `.jarvis-archive/`：`gates.json` + 4 份流程文档 + README）整体**移出仓库**（本机保留在仓库外目录，不随包分发、不参与提交）；`.gitignore` 保留 `.jarvis-archive/`、`.jarvis/`、`.agent-teams/` 排除规则兜底；README / `docs/安装-半插件.md` / `docs/STRUCTURE.md` 同步说明；`selfcheck` 第 14 项实测「仓库内无归档目录 + 排除规则生效 + 未被跟踪」。
- **测试**：新增「T13 ⑥ 状态根守卫泛化」用例（插件仓库拒写快照/基线/公司状态，普通项目放行）→ **303/303**。
- **文档对账**：README 标题 `v0.3.4 → v0.9.2`；RELEASE「22 工具 → 29 工具（以 `TOOLS` 为准）」；ARCHITECTURE 补当前基线；e2e 汇总文案改为 `TOOLS.length`（不再写死 19）；根目录过期 `MARKET-LAUNCH.md` 归档到 `docs/archive/`。
- **selfcheck 第 12/13/14 项**：CLI 可用 / 预设生成物无漂移 / 结构文档存在 / 包导出完整；状态根隔离；本地归档隔离 → 11 项 → **14 项**。
- 回归：`node --test test/plugin.test.js` **303/303 通过**；`bash scripts/selfcheck.sh` 14 项全过；`npx luke-jarvis setup/doctor` 在临时 HOME 实测通过（幂等、可 --dry-run）。

**回滚**：`git revert <本提交>` 即可（不改 `src/host/plugin.js` 逻辑，工具/闸行为与 0.9.1 完全一致）。

## [0.9.1] - 2026-11-03

### 完全体 P2：阶段网关（工具调用前按阶段机械放行/拒绝）+ 真实缺陷修复 D5-D8

**P2 阶段网关（commit e372161）**：新增 `jarvisStageGate(exec)`，按 `computeStage(cwd)` 当前阶段用 deny-list 拒绝越阶段流程类工具（`jarvis_*`/`agent_teams_*`），拒绝文案固定三要素「阶段 N/6+名称｜当前缺口｜下一步」；链式校验内嵌（复用 `computeStage` 返回的 gates，派活缺 clarify→decompose→design→build 任一环点名缺哪环，先于 deny 判定故与 guard 注册顺序无关）；`apply()` 按 captain→stage→flowguard 顺序注册；`hasGlob` 兼容 DSH FileSystem（`list` 优先 → `resolve+listDir` 取 `entry.name`，能力缺失/异常 fail-open）。测试 228→252。

**D5 阶段可达性**：`computeStage` 的 openTasks 改为只统计「活跃团队」——归档目录（`archive`/`old`/`history`）不计，`team.json` mtime 超 72h 的历史团队不计其未完成任务；`teams` 只计含 `team.json` 的非归档目录。误判方向=宁可多算不可少算（防假收口）。修「本项目被其它项目/历史团队的未完成任务钉死在 execute、`jarvis_release` 被拒」的缺陷。

**D6 deny 补集**：`agent_teams_amend_task`/`agent_teams_claim_task`/`agent_teams_remove_member` 并入 clarify/decompose/design 的 STAGE_DENY；build 阶段拒 `amend_task`/`claim_task`（换人 add/remove 仍允许）；execute 阶段放行 `claim_task`/`update_task`/`amend_task`。**边界诚实标注**：这只是显式补几项，完整闭合（未表态即测试红）按 project.md D6 裁决排进 P3 的 meta 穷举。

**D7 ponder 落盘**：`jarvis_ponder_check` 的 PASS 记录落盘改为 `ponderVerifyProjectDir(args, exec)`：`args.projectDir` > 执行会话 `cwd` > 进程兜底（原实现用进程级单例 `resolveWorkspace(moduleCtx)`，实证漂移到 profile 目录导致交活闸读不到记录）；输出新增 `recordPath`/`recordProjectDir`，handler 改接 `exec`。

**D8 打包/依赖**：`package.json` 补 `peerDependencies: {"@deepseek-ai/dsh-tools": ">=0.2.0-rc.1"}` + `peerDependenciesMeta` optional（宿主提供）；`files` 增加 `CHANGELOG.md`/`LICENSE`/`office`；新增 `LICENSE`（BSD-3-Clause，与 `license` 字段一致）；`test/bagua-gate.test.cjs` 去掉硬编码 `/tmp/bagua4.json`，改为 node:test 用例 + 临时夹具（缺 `node:test` 时显式 skip 而非 fail）。版本 0.9.0 → 0.9.1。

**回滚**：每个缺陷一个 commit —— D5 `d2e00ff`、D6 `1092f6e`、D7 `5c47173`、D8（本条）`git revert <sha>` 即可单独回退；P2 阶段网关 `git revert e372161`。

## [0.9.0] - 2026-11-02

### 架构补充 P1：阶段状态机（阶段由插件计算，不是模型自述）

借鉴 `dsh-superagent-prototype` 的 `core/stage.ts`（MIT，已 vendor 到 `src/host/vendor/`）。**不替换 agent-teams**，只补它缺的"编排层"。

- **`computeStage(cwd)`**：纯读文件推导 6 阶段（clarify→decompose→design→build→execute→close），每阶段以"产物 + 闸门"双重判定，输出 `{stage,index,total,missing,next,done,artifacts}`。
- **`renderStage(cwd)`**：渲染成注入文本，含「阶段 N/6 · 已通过 · 当前缺口 · 下一步 · 事实快照（需求规格/任务编排/方案设计/角色卡/团队/未完成任务/ponder核验）」。
- **`luke-jarvis:protocol` 注入段升级为动态**：每次请求按该 agent 的 `session.header.cwd` 现算阶段并追加——**模型不需要"记得"流程，插件每一步都告诉它现在在哪、缺什么、下一步做什么**。
- 实测 scan 工作区：正确算出「阶段 2/6 拆解，缺口 flowguard(decompose)」，事实快照 `需求规格=有 任务编排=有 方案设计=有 角色卡=7 团队=10 未完成任务=42 ponder核验=0`。

## [0.8.1] - 2026-10-31

### 修复：工作记忆不再丢失（扫描实证 12 天工作未落盘）

**实证**：scan 主会话 `session-25f8aa57` 跑到 10-31，但 `.jarvis/project.md` 停在 **10-19**、`board.json` 停在 **10-15** → **12 天工作只在上下文里**，换会话/压缩即"记忆没了"。同期该会话新建 148 个任务、只写 2 个文件、jarvis_* 仅 23 次。

- **① 记忆保鲜闸 `checkMemoryFresh`**：建队/派活/交活前检查 `.jarvis/project.md`/`board.json` 新鲜度，**超过 6 小时未更新直接拒绝**，要求先写回续接五件套；无 project.md 时（建队场景）强制先 `jarvis_store(save, itemType="project")`。
- **③ 会话快照 `jarvis_snapshot`**：把公司状态 + 团队未完成任务 + 记忆新鲜度写入 `.jarvis/sessions/<会话id>-<时间>.json`，长会话/阶段完成/收口前可随时留档，并回报"记忆已 N 小时未更新"。
- **② 抢救补录**：从 142MB 会话日志解析 86,300 行，生成 `.jarvis/docs/记忆补录-20261019至1031.md`（148 个任务、未决/风险项、关键决策、写入文件、jarvis 调用统计）——待用户确认后合并进 project.md。

## [0.8.0] - 2026-10-31

### 架构修复：jarvis 工作方式从「skill 灌入」升级为「system prompt 每请求固定注入」

**用户指出的结构性问题**：jarvis 协议靠 skill 一次性灌入上下文，长会话压缩后失效（scan 实证：1166 轮后蒸馏/会议/flowguard 全为 0）；插件形态应当**每一步都表达全量流程信息**。

- 新增 `ctx.systemPrompt.section({name:'luke-jarvis:protocol', order:118})`：把 **11 步完整流水线**（查记忆→判级→打磨→clarify闸→蒸馏→拆解→方案→build闸→建队→派活→盯控→收口）+ 4 条铁律**每次请求注入**，与 skill 无关、不受压缩影响。
- `inject` 增加 `systemPrompt` 服务。
- 与既有机械闸（gates.json / ponder-verify / captain 执行拦截）形成双保险：**提示词层每步可见 + 运行时层每步可拦**。

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
