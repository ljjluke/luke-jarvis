# luke-jarvis · 贾维斯数字员工公司

> **版本：v0.2.2**（2026-09-01 ｜ 集成 ponder 满血版 + 企业级治理 + 领域无关动态团队）
> 为 DeepSeek Harness 编写的「数字员工公司」操作系统——收到一个模糊需求，组建一支由**真实人物原型驱动的数字员工团队**，像真实公司一样开会、协作、变更评审、绩效换人、版本交付。

---

## ✨ 两个核心亮点

### 亮点一：每个角色 = 独立个体 + 真实人物 + ponder 满血 = 有自己思维的数字员工

- **每个角色都是独立个体**，蒸馏自**该领域真实人物原型**（软件=软件大佬、制造=制造大佬…），不是 LLM 自造、不是套卡完成任务。
- **ponder 满血十阶段已随包集成**——装 jarvis 即自带，无需单独安装。角色用 skill 工具加载 ponder，以自己的人物视角跑完整十阶段推理（interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis），产出**这个人物基于真实情况会做的决定**，不是万能管理者套话。
- **强制不阉割**：每个角色每个关键决策必须跑 ponder 满血（run_id 溯源，无 run_id=未思考=打回重跑）。

### 亮点二：领域无关抽象层 + 按需求动态蒸馏真人大佬

- **不预设任何领域/角色/流程**——抽象层框架（参考 ponder 同为纯抽象层），不绑定软件/金融/制造等任何行业。
- 收到需求 → 按**领域 + 难度（S/M/L）动态分配团队**：软件需求蒸馏软件领域大佬做 CEO/子角色，制造需求蒸馏制造领域大佬——**领域由需求决定，插件无预设**。
- 角色卡/流程/经验**沉淀在项目 `.jarvis/`**（本项目角色做过的经验），下次需求先查记忆复用，跨项目/插件不复制。

---

## 核心机制（像真实公司一样运转）

| 真实公司 | luke-jarvis 对应 |
|---|---|
| CEO 带队 | CEO 角色（现场蒸馏领域带队大佬）带队+派活+盯人 |
| HR/猎头 | 人事角色（现场蒸馏领域 HR 大佬）绩效换人+猎头补位 |
| 绩效 | jarvis_perf 阶段化考核（防 0 产出误判，连续 2 次不达标才换人） |
| 开会 | kickoff 全员会 → 独思 → 贾维斯公屏 → 按需二次会（全员评审） |
| 需求变更 | 全员变更评审会：判断是否影响核心体系→影响=二次评估/不影响=追加任务 |
| 版本合同 | jarvis_release：版本快照/清单/状态/回滚（改错可 undo） |
| 企业治理 | 权限职责分离 / 风险登记册 / 数据分级 / 成本核算 / 书面交接 |

---

## 安装

本仓库发货：

| 组件 | 位置 | 安装到 |
|---|---|---|
| Agent 预设 | `preset/agent.cordis.yml` + `preset/preset.yml` | `~/.dsh/.agent-presets/jarvis-org/` |
| 技能（唯一入口） | `skills/jarvis.md` | `~/.dsh/skills/jarvis/SKILL.md` |
| **ponder 满血技能（随包集成，无需单独装）** | `skills/ponder/` + `skills/ponder-stages/` | `~/.dsh/skills/ponder/` + `~/.dsh/skills/ponder-stages/` |
| 核心插件 | `src/host/plugin.js`、`src/client/plugin.js` | 注册为核心插件（见下） |

### 方式 A：作为预设使用（推荐，无代码变更）

```bash
# 1. 预设
cp -r preset/agent.cordis.yml preset/preset.yml ~/.dsh/.agent-presets/jarvis-org/

# 2. 技能（唯一入口）
mkdir -p ~/.dsh/skills/jarvis
cp skills/jarvis.md ~/.dsh/skills/jarvis/SKILL.md

# 3. ponder 满血技能（随包集成：装 jarvis 即自带）
mkdir -p ~/.dsh/skills/ponder ~/.dsh/skills/ponder-stages
cp -r skills/ponder/* ~/.dsh/skills/ponder/
cp -r skills/ponder-stages/* ~/.dsh/skills/ponder-stages/
```

### 方式 B：真实插件包安装（核心工具 + /jarvis 命令）

本仓库是标准 Cordis 插件 npm 包（`package.json` 声明 `dsh.bundle.patch` → `cordis.patch.yml`，插件为 ESM 模块）。推荐 **npm bundle 持久化安装**（重启不丢）：

```bash
pnpm add luke-jarvis   # 或本地: pnpm add file:../path/to/luke-jarvis
```

---

## 使用

```
/jarvis 我要做一个下沉市场的拼团电商小程序，2 人团 + 24h 成团，怎么设计？
```

- 需求本质回归 → CEO 定领域流程（无预设）→ 查项目沉淀 → 现场蒸馏该领域 CEO/人事/子角色 → 全员 kickoff → 各角色 ponder 独立思考 → 贾维斯公屏协作 → 按需全员评审 → 收口交付。
- 需求模糊时 CEO 专业引导（jarvis_clarify 5 角度），能力不足时蒸馏行业大佬双人协作。

---

## 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| 角色输出"某大师认为" | 违反防冒名 | 只写"借鉴其方法" |
| 角色没跑 ponder | 未强制 | 角色卡第一次分析必须 ponder（run_id 溯源，无则打回） |
| 需求模糊无处下手 | 未澄清 | jarvis_clarify 引导，5 角度候选问题 |
| 用户中途插话 | 需求变更 | 全员变更评审会：影响核心=二次评估 / 不影响=追加任务 |
| 员工能力不行 | 绩效不达标 | jarvis_perf 阶段考核 → 人事猎头补位 |
| /jarvis 无响应 | 动态插件丢失 | 用 bundle 持久化安装 |

---

## 许可与引述

- 本产物提供**领域无关的工作机制**（蒸馏校验/协同/会议/公屏/问题上行/能力补足/需求本质审计/ponder 集成），不携带任何具体人物/行业模板。
- 角色卡借鉴真实人物公开方法论，只写"借鉴其方法"不冒充署名；沉淀在项目 `.jarvis/cards/`。

## 文档

- `docs/ARCHITECTURE.md` — 执行架构（与代码逐条核对）
- `docs/REFORM-PLAN.md` — 数字员工公司改造方案（企业级治理）
- `docs/REFORM-CLARIFY.md` — 需求澄清机制增强方案
- `docs/UPGRADE-20260828.md` — 升级包说明
