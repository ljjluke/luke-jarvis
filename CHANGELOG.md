# Changelog

本文件记录 luke-jarvis 每个版本的变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 风格。用户通过版本号 + 本文件判断"能否升级、升了什么"。

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

- `docs/ARCHITECTURE.md`：与代码逐条核对的真实执行架构（13 步回执 / 18 工具 / 技能阶段对应 / 铁律）
- `docs/RELEASE.md` / `docs/PUSH.md` / `docs/UPGRADE-20260828.md`

[0.2.1]: https://github.com/ljjluke/luke-jarvis/releases/tag/v0.2.1
[0.2.0]: https://github.com/ljjluke/luke-jarvis/releases/tag/v0.2.0
<!-- [0.1.0]: 初始发布（本仓库第一个带 tag 的发布为 v0.2.0；0.1.0 为无 tag 的历史起点） -->
