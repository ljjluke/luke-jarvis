> **luke-jarvis**：领域无关的「数字员工公司」操作系统——需求本质回归 → CEO 定领域流程 → 现场蒸馏角色卡 → 项目沉淀 → 会议驱动协作 → 收口交付。

# luke-jarvis · 贾维斯数字员工公司

为 DeepSeek Harness 编写的「数字员工公司」插件/预设。收到一个（可能很模糊的）自然语言需求 → 需求本质回归 → **CEO 定领域流程**（插件无领域预设）→ **现场 web 蒸馏该领域真实大佬**做 CEO → CEO 定子角色 → 逐个现场蒸馏+校验 → 设计协同架构 → 开会-独思-黑板-按需再开会 的会议驱动协作 → 收口交付。**角色卡与领域流程沉淀在项目 `.jarvis/` 里（本项目角色做的，经验属于项目），插件不携带任何静态卡/领域模板。**

## ⚠️ 使用前必读（防 bug 铁律，违反即缺陷）

1. **插件无卡、跨项目无卡**：每个角色卡的**唯一**合法来源 = ① 本项目沉淀 `<项目>/.jarvis/cards/`（本项目角色做过，可复用起点：须 `jarvis_distill` 校验 + 按新需求修订）；② 现场 web 蒸馏（新需求/跨项目：搜该领域真实权威，真实存在且公开可查证；搜不到可查证真人 = 不许造卡）。
   - 流程：`jarvis_project` 分级（S/M/L）→ `jarvis_process` 定领域流程（只给设计清单，插件不预设领域）→ `jarvis_store` 看本项目沉淀 → `web_search` 搜真实权威 → 现场写六段式卡（CEO 卡含协同架构段，非 CEO 卡含"我的协同"段）→ `jarvis_distill` 校验通过 → 才作为 `role` 注入。
2. **source 必须真实**：每张卡必须有本次 web 验证的真实出处；无出处不蒸馏。虚构人物/编造方法论 = 一票否决。
3. **真实情况优先于角色卡**：角色卡是"这位大佬如何思考"的框架，不是结论模板。LLM 不得为迎合角色卡而扭曲对真实问题（代码/数据/复现/资源）的判断。
4. **协同架构是 CEO 卡的一部分**：CEO 决定子角色后必须为每个角色定义 ①位置 ②依赖 ③介入时机 ④协同方式；非 CEO 卡必须含"我的协同"段（分工明确硬闸）。
5. **不冒充署名**：任何交付物只写"借鉴其方法"，不写"某大师说/某大师认为"。
6. **项目沉淀**：角色卡/领域流程/组件清单沉淀在 `<项目>/.jarvis/`（`cards/`、`process-*.json`、`components.json`、`board.json`、`lessons.md`），用 `jarvis_store` 管理；后续需求复用**本项目沉淀**（须校验+修订），不跨项目复用。

## 安装

本仓库发货：

| 组件 | 位置 | 安装到 |
|---|---|---|
| Agent 预设 | `preset/agent.cordis.yml` + `preset/preset.yml` | `~/.dsh/.agent-presets/jarvis-org/` |
| 技能（唯一入口） | `skills/jarvis-boss.md`（老板协议：蒸馏方法论+项目记忆库+两层架构+单入口） | `~/.dsh/skills/jarvis-boss/SKILL.md` |
| 核心插件（持久化源码） | `src/host/plugin.js`、`src/client/plugin.js` | 注册为核心插件（见下） |

> 注：本仓库**不含**任何静态角色卡/领域模板目录（`roles/` 已移除）——领域内容全部来自「项目记忆库 `.jarvis/` + 现场蒸馏」。**技能只有 jarvis-boss 一个入口**（蒸馏/沉淀/记忆库/两层架构全部并入），用户只交互 `/jarvis` 一个命令。

### 方式 A：作为预设使用（推荐，无代码变更）

```bash
# 1. 预设
cp -r preset/agent.cordis.yml preset/preset.yml ~/.dsh/.agent-presets/jarvis-org/

# 2. 技能（唯一入口）
mkdir -p ~/.dsh/skills/jarvis-boss
cp skills/jarvis-boss.md ~/.dsh/skills/jarvis-boss/SKILL.md
```

预设确保每次会话注入 Jarvis 老板 persona（含全部铁律）+ 工具行（bash/fs/skill/goal/subagent/web 等）。

### 方式 B：启用核心工具（14 工具 + /jarvis 命令）—— 真实插件包安装

本仓库是**标准 Cordis 插件 npm 包**：`package.json` 声明 `dsh.bundle.patch` → `cordis.patch.yml`，插件实现为 ESM 模块（`src/host/plugin.js` 导出默认插件，用 `ctx.get('tools')`/`ctx.get('commands')` 注册，未用运行时动态 harness）。两种安装路径：

1. **npm bundle（推荐，持久化）**
   ```bash
   # 在 dsh web profile 目录（如 ~/.dsh/profiles/web）:
   pnpm add luke-jarvis   # 或从本仓库本地安装: pnpm add file:../path/to/luke-jarvis
   # 插件即通过 cordis.patch.yml 挂载，重启不丢失。
   ```
2. **preset 内插件行**：在预设/当前会话的 `agent.cordis.yml` 增加一行：
   ```yaml
   - id: jarvis-core
     name: luke-jarvis
   ```

> 旧建议"cordis_define 动态加载"不再推荐（动态插件在 dsh web 重启后丢失，是客户最容易踩的坑）；本仓库以**持久化 bundle** 为主路径。发布/生产一律用 bundle。

## 使用

```
/jarvis 我要做一个下沉市场的拼团电商小程序，2 人团 + 24h 成团，怎么设计？
```

- 期望行为：需求本质回归 → CEO 用 `jarvis_process` 按本需求定流程（电商场景 CEO 会定义风控/资金闸，但那是 CEO 现场定的，不是插件预设）→ `jarvis_store` 查本项目沉淀 → 现场 web 蒸馏 CEO + 子角色（产品增长/供应链/研发/风控/测试…）→ 逐个校验 + 沉淀 → 设计协同架构 → kickoff 会 → 独思/黑板/按需二次会 → 收口交付报告。
- 也可直接调用 `jarvis_project` → `jarvis_process` → `jarvis_store` → `jarvis_distill` → `jarvis_review` → `jarvis_think_deep` 手工编排。

## 故障排查（防 bug 清单）

| 症状 | 原因 | 处理 |
|---|---|---|
| 员工 role 无效/表现怪异 | 角色卡未过 `jarvis_distill` 校验 / 复用了跨项目或插件示例卡 | 现场重新 web 蒸馏；校验通过再注入 |
| 角色输出"某大师认为" | 违反防冒名 | 只写"借鉴其方法"；role 卡内必须含防冒名声明 |
| 需求模糊无处下手 | 未先回归需求本质 | `ask_user_question` 一次 1-2 个关键问题，先定"为谁解决什么、怎样算成功" |
| /jarvis 无响应 / 工具不存在 | 动态插件重启丢失 | 用 bundle 持久化安装（见安装方式 B） |
| 团队角色间互相打架 | 缺协同架构 / 冲突未升级 | 每个 role 含协同段；分歧用 `jarvis_review`（吃 thinkA/thinkB + requirement），优先级=需求本质>真实情况>用户需求>专业判断 |
| 员工不按真实情况判断 | 迎合角色卡 | 铁律 3：真实情况优先；`jarvis_think_deep` 强制七段对抗 + `jarvis_essence` 需求本质审计 |
| 角色遇到绕不开的问题不吭声 | 缺问题上行 | `jarvis_escalate`（带风险细节+已尝试+决策请求）→ 写黑板 → CEO 闭环 |
| DSH 缺能力硬凑 | 缺能力补足 | `jarvis_capability` 三级路径：复用现有 → 市场高 star → 自研组件化 |

## 许可与引述

- 本产物只提供**领域无关的工作机制**（蒸馏校验/协同/会议/黑板/问题上行/能力补足/需求本质审计），不携带任何具体人物/行业模板。具体领域知识由 CEO 现场蒸馏并按项目沉淀。
- 角色卡必须经由 `jarvis_distill` 校验且含 `source` + 防冒名声明后才可使用；沉淀在项目 `.jarvis/cards/`。