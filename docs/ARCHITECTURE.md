# Luke-Jarvis 执行架构（与代码逐条核对的真实流程）

> 本文档描述 luke-jarvis 数字员工公司**实际执行**的流程。每一层都从 `src/host/plugin.js`、`skills/jarvis.md`、`preset/agent.cordis.yml` 核实过，不是设计稿。
> 验证：单测 62/62、e2e 全链路、selfcheck 12/12。

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│ 用户（唯一交互面）                                              │
│   只敲一个命令：/jarvis <需求描述>                               │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ ① 命令层  /jarvis                                              │
│    commands.register(name='jarvis') → execute()                 │
│    → jarvisCommand(需求) → 返回 13 步流程回执                    │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ ② 技能层  skills/jarvis.md（唯一技能入口）                       │
│    安装：cp skills/jarvis.md → ~/.dsh/skills/jarvis/SKILL.md    │
│    skill-filesystem 本地发现（preset 不硬编码技能名）            │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ ③ 两层角色架构                                                    │
│   Jarvis（主面板 / 本 agent / captain）──对客户唯一接口          │
│    └─ 蒸馏注入 → CEO（agent_teams 成员角色，带六段式角色卡）      │
│        └─ 管理 → 员工（产品/研发/测试/风控…也是蒸馏卡成员）       │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ ④ 工具层（17 个工具，tools.register 循环注册，ctx.effect 包裹）   │
│    jarvis_project     接单分级（S/M/L）                          │
│    jarvis_store       项目记忆库（check/scaffold/save/reuse）    │
│    jarvis_process     流程设计（五要素，无领域预设）              │
│    jarvis_distill_guide  蒸馏引导（提炼独有 HOW）                │
│    jarvis_distill     蒸馏校验（结构+深度双闸≥60）               │
│    jarvis_fidelity    保真度审计                                 │
│    jarvis_think / jarvis_think_deep  思考（七段对抗）            │
│    jarvis_review / jarvis_essence    裁决 + 本质四查             │
│    jarvis_collab      协同设计（四要素）                         │
│    jarvis_meeting     会议（kickoff/cycle/close）                │
│    jarvis_board       统一黑板                                   │
│    jarvis_perf        绩效评估（5维 + 连续2次换人）               │
│    jarvis_escalate    问题上行（风险三件套）                     │
│    jarvis_capability  能力补足（市场→自研复用）                  │
│    jarvis_release     交付契约（版本快照/清单/留痕/状态）        │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ ⑤ 团队编排层  agent_teams_*（平台服务）                          │
│    create → add_member(注入卡) → create_task(DAG) → status(盯控) │
│    → remove_member(换人) → send_message(会议/讨论)               │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ ⑥ 项目记忆库  <项目>/.jarvis/（持久化，跨会话）                  │
│    prototypes/ 真实人物原型    cards/ 虚拟人物卡                 │
│    process-*.json 流程         components.json 组件             │
│    board.json 黑板             project.md 项目细节+沟通留痕      │
│    lessons.md 经验教训                                          │
└─────────────────────────────────────────────────────────────────┘
```

## 二、一次 /jarvis 的真实执行流（13 步，来自 jarvisCommand 实际输出）

| # | 动作 | 工具/服务 | 产物 |
|---|---|---|---|
| 0 | 先查项目记忆库：有 `.jarvis/`（prototypes/cards/project.md…）直接读取继续，不用重分析源码；没有才从零 | `jarvis_store` check | 复用判定 |
| 1 | 需求本质回归：为谁解决什么、怎样算成功（可判定），未清晰不开工 | — | 需求本质 |
| 2 | 定领域流程：阶段/闸门/红线/必须角色/会议触点（无预设，可参考本项目沉淀） | `jarvis_process` | 流程五要素 |
| 3 | 蒸馏 CEO 角色卡（CEO 是团队内角色非主面板）：web 查证真实大佬 → 存 prototypes/ → distill_guide 提炼独有 HOW → 写六段式卡 → distill+保真度双验 → 注入 | `jarvis_distill_guide`+`jarvis_distill`+`jarvis_fidelity` | CEO 卡 |
| 4 | 定子角色 → 逐个同样蒸馏+双验+协同设计（四要素+每角色协同段） | `jarvis_collab` | 子角色卡+协同 |
| 5 | kickoff 全员会：对齐目标/验收+流程闸门+接口契约 → 决议写黑板 | `jarvis_meeting`(kickoff)+`jarvis_board` | 决议/契约 |
| 6 | 各角色独思/干活（关键决策 think_deep）→ 问题/发现/阻塞写黑板 | `jarvis_think_deep`+`jarvis_board` | 黑板条目 |
| 7 | 黑板未决阻塞/分歧/接口变更 → 二次会对齐+`jarvis_review` 裁决（吃 thinkA/thinkB+requirement）→ 循环到收敛 | `jarvis_meeting`(cycle)+`jarvis_review`+`jarvis_essence` | 裁决 |
| 8 | CEO 时刻盯人：`jarvis_perf` 5 维评估（成果/完成度/上行健康度[高频异常立即触发]/契合度/深度分），连续 2 次不达标 → 换人（离任→归档→重蒸馏→补位） | `jarvis_perf`+agent_teams `remove_member` | 换人决策 |
| 9 | 问题上行：技术绕不开/无法抉择 → 禁止跳过 → `jarvis_escalate`（风险细节+已尝试+决策请求）→ 写黑板 → CEO 闭环 | `jarvis_escalate` | 上报记录 |
| 10 | 交付版本管理：new_version 打快照（冻结旧版/变更开新版）→ checklist 交付清单（需求本质逐条→交付物→自测，甲方逐条确认）→ status（待确认/已确认/已否决+时限）→ communication 沟通留痕入 project.md | `jarvis_release` | 版本/清单/留痕 |
| 11 | 收口会：对照领域闸门逐项验收 + 交付清单 → 交付报告（Jarvis 向客户汇报，客户确认即完成） | `jarvis_meeting`(close) | 交付报告 |
| 12 | 沉淀到项目：角色卡/原型/流程/组件/项目细节/沟通记录/经验 → 下次需求先查记忆直接复用 | `jarvis_store` save | 记忆库更新 |

## 三、技能阶段（skills/jarvis.md，指导协议）与命令回执的对应

| 技能阶段 | 对应回执步骤 | 说明 |
|---|---|---|
| 阶段零 · 先查项目记忆库 | 步骤 0 | 有经验直接继续，无则从零 |
| 阶段一 · 澄清 | 步骤 1 | 需求本质回归（模糊时 ask_user_question） |
| 阶段二 · 拆解 | 步骤 2（前置） | 决定岗位、任务 DAG |
| 阶段三 · CEO 定领域流程 | 步骤 2 | jarvis_process 五要素 |
| 阶段四 · 建队与派活 | 步骤 3-4 | 蒸馏卡 + add_member + create_task |
| 阶段五 · 会议驱动协作循环 | 步骤 5-7 | kickoff → 独思 → 黑板 → 二次会 |
| 阶段六 · 盯控与接管 | 步骤 8 | jarvis_perf 评估 + 换人 |
| 阶段七 · 版本化交付与收口 | 步骤 10-12 | jarvis_release + close + 沉淀 |

## 四、防 bug 铁律（内嵌代码，安装即生效）

1. `jarvis_distill` 校验：六段式必含、CEO 卡必含协同架构、必含真实 source、必含防冒名声明；任缺 → 不通过。
2. 深度硬闸：assessCardDepth 评分 <60 → 浅层卡一票否决（结构齐全内容空洞不得注入）。
3. 绝不直接复用旧卡：只提供"现场 web 蒸馏"路径，无"取旧卡"分支。
4. 真实优先：所有工具输出强制"角色卡只提供思考框架，判断必须基于真实情况"。
5. 插件无静态卡/无领域模板（领域无关）：角色卡只来自「本项目 .jarvis/ 沉淀（复用起点）」或「现场 web 蒸馏」。
6. 流程缺失 = 客户提 bug 的温床：宁可多一道闸，不可少一道。
7. 禁止跳过问题：无法抉择必须 `jarvis_escalate` 上报（风险细节+已尝试+决策请求）。