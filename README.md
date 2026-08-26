> **luke-jarvis**：领域识别 → 蒸馏 CEO 人物卡与员工人物卡 → 协同完成任务。

# luke-jarvis · 贾维斯数字员工公司

为 DeepSeek Harness 编写的「数字员工公司」插件/预设。收到一个（可能很模糊的）自然语言需求 → 识别行业 → **现场 web 蒸馏该领域真实大佬**做 CEO → CEO 定子角色 → 逐个现场蒸馏+校验 → 设计协同架构 → 用 AgentTeams 建队并行协作 → 收口交付。

## ⚠️ 使用前必读（防 bug 铁律，违反即缺陷）

1. **每次建队，每个角色卡（含 CEO 卡）必须现场新蒸馏**，绝不直接复用任何已存在/预置的卡（包括本仓库 `roles/`、`skills/` 里的示例——那些只是"往哪找真人/该覆盖哪些职责"的参考方向）。
   - 流程：`jarvis_project` 识别行业 → `web_search` 搜索该行业真实权威（真实存在、公开可查证；搜不到可查证真人 = 不许造卡）→ 现场写六段式卡（CEO 卡含协同架构段）→ `jarvis_distill` 校验通过 → 才作为 `agent_teams_add_member` 的 `role` 注入。
2. **source 必须真实**：每张卡必须有本次 web 验证的真实出处；无出处不蒸馏。虚构人物/编造方法论 = 一票否决。
3. **真实情况优先于角色卡**：角色卡是"这位大佬如何思考"的框架，不是结论模板。LLM 不得为迎合角色卡而扭曲对真实问题（代码/数据/复现/资源）的判断。
4. **协同架构是 CEO 卡的一部分**：CEO 决定子角色后必须为每个角色定义 ①位置 ②依赖 ③介入时机 ④协同方式。
5. **不冒充署名**：任何交付物只写"借鉴其方法"，不写"某大师说/某大师认为"。

## 安装

本仓库发货三件套：

| 组件 | 位置 | 安装到 |
|---|---|---|
| Agent 预设 | `preset/agent.cordis.yml` + `preset/preset.yml` | `~/.dsh/.agent-presets/jarvis-org/` |
| 技能 | `skills/jarvis-boss.md`、`skills/jarvis-roles.md` | `~/.dsh/skills/jarvis-boss/SKILL.md`、`~/.dsh/skills/jarvis-roles/SKILL.md` |
| 核心插件（持久化源码） | `src/host/plugin.js`、`src/client/plugin.js` | 注册为核心插件（见下） |
| 角色参考库 | `roles/`（`ceo-protocol.md`、`roles.schema.md`、`domains/*.json`、角色卡示例） | 工作区 `.jarvis-roles/`（参考用途） |

### 方式 A：作为预设使用（推荐，无代码变更）

```bash
# 1. 预设
cp -r preset/agent.cordis.yml preset/preset.yml ~/.dsh/.agent-presets/jarvis-org/

# 2. 技能
mkdir -p ~/.dsh/skills/jarvis-boss ~/.dsh/skills/jarvis-roles
cp skills/jarvis-boss.md ~/.dsh/skills/jarvis-boss/SKILL.md
cp skills/jarvis-roles.md ~/.dsh/skills/jarvis-roles/SKILL.md

# 3. 角色参考库（可选，仅供参考方向）
cp -r roles ~/.dsh/.jarvis-roles/ 2>/dev/null || mkdir -p ~/.dsh/.jarvis-roles && cp -r roles/* ~/.dsh/.jarvis-roles/
```

预设确保每次会话注入 Jarvis 老板 persona（含全部铁律）+ 工具行（bash/fs/skill/goal/subagent/web 等）。

### 方式 B：启用核心工具（jarvis_project/distill/review/think + /jarvis 命令）—— 真实插件包安装

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

- 期望行为：识别行业=电商 → 现场 web 蒸馏 CEO（黄峥系或贴合本需求的实际人选）→ CEO 定子角色（产品增长/供应链/研发/风控/测试…）→ 逐个现场蒸馏+校验 → 设计协同架构 → AgentTeams 建队 → 每个任务带验收标准 → 盯控 → 收口交付报告。
- 也可直接调用 `jarvis_project` → `jarvis_distill` → `jarvis_review` → `jarvis_think` 手工编排。

## 故障排查（防 bug 清单）

| 症状 | 原因 | 处理 |
|---|---|---|
| 员工 role 无效/表现怪异 | 角色卡未过 `jarvis_distill` 校验 / 复用了旧卡 | 现场重新 web 蒸馏；校验通过再注入 |
| 角色输出"某大师认为" | 违反防冒名 | 只写"借鉴其方法"；role 卡内必须含防冒名声明 |
| 需求模糊无处下手 | 未先识别行业 | `jarvis_project` 先立项；必要时 `ask_user_question` 一次 1-2 个关键问题 |
| /jarvis 无响应 / 工具不存在 | 动态插件重启丢失 | 用 bundle 持久化安装（见安装方式 B） |
| 团队角色间互相打架 | 缺协同架构 / 冲突未升级 | 每个 role 含协同架构段；分歧用 `jarvis_review` 升级，裁判优先级=真实情况>用户需求>专业判断 |
| 员工不按真实情况判断 | 迎合角色卡 | 铁律 3：真实情况优先；`jarvis_think` 强制先看真实数据/代码/复现 |

## 许可与引述

- 本产物借鉴以下公开方法论框架（非本人观点）：Frederick Brooks-ish 工程管理、Agile/XP(TDD) 公开实践、探索式测试、安全"是过程"、丰田精益生产、增长黑客/PMF、价值投资/风险平价等——全部以"参考其框架"标注，不冒充署名。
- 角色卡必须经由 `jarvis_distill` 校验且含 `source` + 防冒名声明后才可使用。