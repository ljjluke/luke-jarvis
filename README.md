# luke-jarvis · 贾维斯数字员工公司

> **版本：v0.2.2**（2026-09-01）
> 为 DeepSeek Harness 编写的「数字员工公司」操作系统：收到一个（可能模糊的）自然语言需求，组建一支由**真实人物原型驱动的数字员工团队**，像真实公司一样开会、协作、变更评审、绩效换人、版本交付，最后交出可验收的成果。

---

## 一、项目是什么

luke-jarvis 把"完成一个需求"变成"经营一家微型公司"：

```
用户说一个模糊需求
  → 按领域+难度动态组建数字员工团队（CEO/猎头/各岗位，全部蒸馏自真实人物）
  → 像真实公司一样：澄清→拆解→开会→各自思考→公屏协作→变更评审→绩效换人→交付
  → 交出可验收的成果 + 可复用的项目记忆
```

它是**领域无关的抽象层**——不绑定任何行业（软件/金融/制造/医疗/教育…都适用），也不预设固定角色；**具体领域和角色由需求现场决定**。

---

## 二、核心能力全景（亮点）

### 1. 每个角色 = 独立个体 + 真实人物 + ponder 满血 = 有自己思维的数字员工
- 角色**蒸馏自该领域真实人物原型**（软件需求=软件领域大佬，制造需求=制造领域大佬…），**不是 LLM 自造、不是套卡完成任务**。
- **ponder 满血十阶段已随包集成**（interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis），装 jarvis 即自带，无需单独安装。
- 角色用 skill 工具加载 ponder，以**自己的人物视角**跑完整十阶段推理，产出"这个人物基于真实情况会做的决定"，不是万能管理者套话。
- **强制不阉割**：每个角色每个关键决策必须跑 ponder 满血（run_id 溯源，无 run_id=未思考=打回重跑）。

### 2. 领域无关抽象层 + 按需求动态蒸馏真人大佬
- **不预设任何领域/角色/流程**——抽象层框架，参考 ponder 同为纯抽象层。
- 收到需求 → 按**领域 + 难度（S/M/L）动态分配团队**：软件需求蒸馏软件大佬，制造需求蒸馏制造大佬——**领域由需求决定，插件无预设**。

### 3. 需求澄清引导（不干等，专业引导用户）
- 需求模糊时，CEO **以专业角度分析 + 引导用户**回答（jarvis_clarify 5 角度：场景/现状/痛点/期望/验收）。
- **能力不足自动蒸馏行业大佬双人协作**（CEO 追验收视角、大佬追场景细节盲区），把模糊需求打磨到可判定。

### 4. 会议驱动协作（像真实公司开会）
- **kickoff 全员会**（对齐目标/流程/契约）→ 各自独思/干活 → **贾维斯公屏**（统一状态）→ 按需二次会（全员评审）→ **收口会**。
- **反形式主义铁律**：讨论必须有实质结论，能不开会就不开，整体配合非拼凑。

### 5. 需求变更管理（用户中途插话不失控）
- 用户插话/新需求 → 登记**变更池** → 触发**全员变更评审会**（所有角色共同判断，非单点拍板）。
- **影响核心体系** → 不打断当前 → 开发完 → 二次评估；**不影响（新功能/小功能）** → 直接分析分工追加任务；连续插话 → 暂存合并批量评估。

### 6. 绩效换人 + 猎头补位（像真实公司猎头挖人）
- **jarvis_perf 阶段化考核**：按阶段性产出考核（阶段未到=待考核，不计 0 产出；连续 2 次不达标才换人）。
- 能力不行 → **通知猎头（蒸馏自该领域知名猎头人物）补位**：岗位画像 → 寻访地图 → 对标评估 → 背景验证 → 够格判据 → 选定大佬蒸馏补位；**换人前留书面交接**（无交接不换人）。

### 7. 企业级治理（任何领域通用的版本与合规）
- **版本管理**：任何领域交付物都版本化；`jarvis_release` 支持**回滚**（改错可 undo，必带原因留痕）。
- **权限职责分离**：主面板/CEO/猎头/员工边界清晰；考核者≠被考核者唯一裁决者。
- **风险登记册**（汇总+升级阈值）/ **数据分级**（公开/内部/机密）/ **成本核算**（ponder 满血成本可控+超支预警）。

### 8. 资源上报公屏 + 问题上行（防幻觉、不绕路）
- 角色需要资源（数据/权限/API/凭证）→ **必须先写贾维斯公屏**（type=资源需求），未满足不得假装完成——**禁止幻觉跳过步骤**。
- 技术上绕不开的问题 → `jarvis_escalate` 上报（三件套：问题/已尝试/风险）→ CEO 一工作节点内响应闭环（SLA）。

### 9. 项目记忆库沉淀（经验属于项目）
- 角色卡/流程/黑板/经验沉淀在项目 `.jarvis/`——**下次需求先查记忆复用**，不用重分析源码；跨项目/插件不复制。

### 10. 前端贾维斯公屏显示入口
- client 插件提供 web 界面**显示贾维斯公屏**（条目/类型/状态/未决项/阻塞），用户实时看到团队状态。

---

## 三、技术细节（工具能力）

luke-jarvis 提供 **19 个 jarvis_* 工具**：

| 工具 | 能力 |
|---|---|
| jarvis_project | 需求分级（S/M/L） |
| jarvis_clarify | 需求澄清引导（5 角度/蒸馏触发/双人协作） |
| jarvis_process | 领域流程设计（无预设，CEO 定制） |
| jarvis_distill / distill_guide / fidelity | 真人大佬蒸馏（六段式+证据链+保真度，双闸校验） |
| jarvis_think / think_deep | ponder 满血十阶段独立思考（人物视角驱动） |
| jarvis_review / essence | 分歧裁决 / 需求本质四查审计 |
| jarvis_board | 贾维斯公屏（统一协作状态） |
| jarvis_perf | 绩效阶段化考核 |
| jarvis_escalate | 问题上行（三件套+闭环） |
| jarvis_capability | 能力补足（复用→市场→自研） |
| jarvis_collab / meeting | 协同设计 / 会议（kickoff/cycle/close） |
| jarvis_store | 项目记忆库（check/scaffold/save/reuse） |
| jarvis_release | 版本交付（快照/清单/状态/回滚） |
| jarvis_update | 版本检测 |

---

## 四、安装

| 组件 | 位置 | 安装到 |
|---|---|---|
| Agent 预设 | `preset/agent.cordis.yml` + `preset/preset.yml` | `~/.dsh/.agent-presets/jarvis-org/` |
| 技能（唯一入口） | `skills/jarvis.md` | `~/.dsh/skills/jarvis/SKILL.md` |
| **ponder 满血（随包集成）** | `skills/ponder/`（自包含：SKILL.md + `stages/` 十阶段 + `engine/` 方法 + `resources/` + `scripts/` 含依赖） | `~/.dsh/skills/ponder/`（整个目录） |
| 核心插件 | `src/host/plugin.js`、`src/client/plugin.js` | 注册为核心插件（见下） |

### 方式 A：预设使用（推荐）

```bash
# 1. 预设
cp -r preset/agent.cordis.yml preset/preset.yml ~/.dsh/.agent-presets/jarvis-org/

# 2. 技能（唯一入口）
mkdir -p ~/.dsh/skills/jarvis
cp skills/jarvis.md ~/.dsh/skills/jarvis/SKILL.md

# 3. ponder 满血（随包集成：装 jarvis 即自带，技能自包含单目录）
#    复制整个 skills/ponder/ 目录（含 stages/engine/resources/scripts）即可全部可用
rm -rf ~/.dsh/skills/ponder && mkdir -p ~/.dsh/skills/ponder
cp -r skills/ponder/* ~/.dsh/skills/ponder/
#    （旧版若装过独立 ~/.dsh/skills/ponder-stages/ 目录可删除——十阶段已并入 ponder/stages/）
```

### 方式 B：插件包安装（核心工具 + /jarvis 命令）

```bash
pnpm add luke-jarvis   # 或本地: pnpm add file:../path/to/luke-jarvis
```

---

## 五、使用

```
/jarvis 我要做一个下沉市场的拼团电商小程序，2 人团 + 24h 成团，怎么设计？
```

完整流程：需求本质回归 → CEO 定领域流程 → 查项目沉淀 → 现场蒸馏该领域 CEO/猎头/子角色 → 全员 kickoff → 各角色 ponder 独立思考 → 贾维斯公屏协作 → 按需全员评审 → 收口交付 → 项目复盘沉淀。

---

## 六、故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| 角色输出"某大师认为" | 违反防冒名 | 只写"借鉴其方法" |
| 角色没跑 ponder | 未强制 | 第一次分析必须 ponder（run_id 溯源，无则打回） |
| 需求模糊无处下手 | 未澄清 | jarvis_clarify 5 角度引导用户 |
| 用户中途插话 | 需求变更 | 全员变更评审会分级处理 |
| 员工能力不行 | 绩效不达标 | jarvis_perf 阶段考核 → 猎头补位 |
| /jarvis 无响应 | 动态插件丢失 | 用 bundle 持久化安装 |

---

## 许可与引述

- 领域无关的工作机制（蒸馏/协同/会议/公屏/问题上行/能力补足/本质审计/ponder 集成），不携带任何具体人物/行业模板。
- 角色卡借鉴真实人物公开方法论，只写"借鉴其方法"不冒充署名；沉淀在项目 `.jarvis/cards/`。

## 文档

- `docs/ARCHITECTURE.md` — 执行架构（与代码逐条核对）
- `docs/REFORM-PLAN.md` — 数字员工公司改造方案（企业级治理）
- `docs/REFORM-CLARIFY.md` — 需求澄清机制增强方案
- `docs/UPGRADE-20260828.md` — 升级包说明
