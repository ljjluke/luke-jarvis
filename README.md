# luke-jarvis · 你的一句话，一家公司在替你干活  `v0.14.0`

> **别再一句一句地"问 AI"了——把需求丢给一家替你干活的数字公司。**
> 你说一句（哪怕模糊的）需求 → 它自动组建一支由**真实大佬思维驱动**的多角色 AI 团队，像真实公司一样澄清、拆解、分工、验证、返工——最后交给你**能逐条验收的成果**。

**它是什么**：一个 **DeepSeek Harness (DSH) 插件**——让 AI 从"你问一句、它答一段"变成"你给需求、它组织团队交付"。

---

## 🎯 它解决什么（三句话看懂价值）

**普通的 AI 工具**：你问 → 它答 → 你验收 → 不满意 → 再问 → 循环。

**luke-jarvis**：你给需求 → **一家微型公司在后台运转** →
- 🏢 一个**懂行的 CEO**（蒸馏自该领域真实大佬）带着团队开工
- 🧠 每个员工**不是通用 AI**，而是带着**某位真实人物的思维方式**在工作（梵高式的画、Deming 式的质量、Torres 式的需求挖掘）
- 🤝 他们开会、争论、互相验证、绩效不行就换人——**像真实公司一样对结果负责**
- 📦 你只在两个时刻出现：**说需求** 和 **验收成果**

> **一句话：它把"让 AI 干活"从"对话"变成"经营公司"——你要的是结果，它负责过程。**

---

## ⚡ 用 AI 的人会遇到什么（对号入座）

| 你直接用 AI 时 | 用 luke-jarvis 后 |
|---|---|
| 需求说得模糊，它瞎猜就开干，做完才发现不是你要的 | 需求**没问清不开工**：先由领域专家主动回来问你"给谁用/怎样算成功"，问清才动手 |
| 它说"做完了"，你没法验证，信不信全凭感觉 | 交付前**逐条自证**：每条需求→方案→测试→结果全链可查，**测试独立验证过才算完**，不是它自己说了算 |
| 一个 AI 从想方案到写代码全包，错了没人发现 | **多角色分工**：方案的活有人审、代码的活有人独立测——自己说自己好不算 |
| 需求中途变一下，前面的可能全废，你得重新说 | 变更走**评审会**，只动该动的，不推倒重来 |
| 这次问完就忘，下次同类需求又从零开始 | **项目记忆沉淀**，下次直接复用，越用越懂你的需求 |

---

## 🔥 三大杀手级亮点

### 1. 🧠 员工不是"助手"，是"带着真实大佬思维的数字员工"
- 每个角色**蒸馏自该领域真实人物**（不是 LLM 编的）——软件需求找软件领域大师、制造需求找制造领域权威
- 蒸馏不是贴名字：**从真实成就反推工作方式**（Hamel 做出 Humanocracy → "先量化官僚成本再动手"），每条能力**标注证据等级**（他亲口说的/他真做过的/推断的——推断不冒充）
- 员工干活**真用这些能力**：交活必须说出"哪步用了哪个能力"，产出**对照指纹逐项验**（有影子才算数）
- **选人闸保证"最强的人"**：任何领域都有厉害人物（PDCA=Deming、情境驱动测试=Bach…），蒸馏前先确认选的是公认强者，不将就

### 2. 🏢 它像真实公司一样"较真"
- **三产物硬闸**：需求规格（每条功能带可判定验收）→ 方案设计（每条需求有实现落点）→ 测试验收单（每条需求有测试项）——**全链可追溯，断链不许交付**
- **有阶段成果就上报（vibe 24h）**：员工 24 小时干活不分昼夜，**每完成一个阶段成果立刻上报** CEO 中途审核（完成能力+需求对齐度）——不符早纠正，不闷头白干到最后
- **测试通过才算完成**：开发说"写完了"不算，测试独立验证通过才算（不许自己说自己好）
- **收口前逐条核对**：每条需求→实现→测试→结果，断链暴露在交付前——**你验收时看到的是"逐条通过"不是"问题不少"**
- **绩效不行就换**：CEO 时刻盯人（像老板巡视工位），产出不对客户要的=立即换人，猎头对标岗位找更厉害的大佬补位（有书面交接不留断层）

### 3. 🧠 ponder 满血十阶段随包自带（装 jarvis 就有，不用单独装）
- interview→shensi→divergence→bagua→plans→converge→score→simulate→debate→synthesis——**十阶段一个不少**（[点此看 ponder 十阶段详解 →](skills/ponder/SKILL.md)）
- 每个员工每个关键决策**以自己的人物视角跑完整十阶段**（run_id 溯源，没跑=没思考=打回）
- 深度对抗：前提审视/八卦镜盲点/方案辩证/情景推演/辩论——不是"一个 AI 拍脑袋"

---

## 🗺️ 它是怎么运转的（一张图）

```
你说一句（可能模糊的）需求
    │
    ▼
┌─────────────────────────────────────────────┐
│  🧭 判领域方向（能判自判；判不出就请用户         │
│      说具体想干什么/说详细点→从中判断领域）      │
│   → 🕵️ 猎头就位（人才调度层——蒸馏自领域猎头）    │
│   → 🕵️ 猎头供 CEO（该领域带队大佬）→ 老板确认     │
│   → 👔 CEO 分析需求 → 确定一个领域专家（搭档）    │
│   → 👔🧑 CEO+专家 双人整理需求（各自看法）        │
│   → 💬 双人打磨问用户 → 需求无问题才往下走        │
│   → 👔🧑 定团队规模 + 详细员工需求单              │
│   → 🕵️ 猎头对照需求单逐岗寻访真人 → 👔 逐个确认    │
│   → 🏢 全员 Kickoff → 各带人物思维开工           │
│   → 🤝 开会/公屏协作/测试返工循环/绩效盯人/换人   │
│   → 📦 收口：三产物逐条核对 → 交付验收           │
└─────────────────────────────────────────────┘
    │
    ▼
你验收（对照测试验收单逐条确认）
```

**领域无关**：软件/金融/制造/医疗/教育…任何领域都适用——不预设行业、不预设角色，**领域和角色由你的需求现场决定**。

---

## 🛠️ 能力全景

### 蒸馏出"有影子"的真实人物
| 能力 | 说明 |
|---|---|
| 选人闸 | 蒸馏前先确认是该领域真正厉害的人物（可命名贡献/公认度/排他性） |
| 成就反推 | 从真实成就反推工作方式（他怎么工作才做到的） |
| 证据分级 | 每条能力标 A原文级/B行为级/C推断级——推断不冒充他说的 |
| 产出指纹 | 蒸馏"他做的东西的可辨识特征"，产出对照指纹验影子 |
| 工作台需求 | 人物卡自己反馈要什么环境工具（默认 Linux 不够的领域如实上报） |
| AI 执行平替 | 判断保留人物、执行用 AI 提速（前 AI 的笨重工具方式不照搬） |
| 修正记录 | 产出"不像他"→记"哪不像该改啥"→卡持续进化像他 |
| 职业底线 | 蒸任何角色提炼他"怎么保证真实负责"（报告真相/验证用户实际感受/歧义问清/判失败有证据）——给全员装"用户价值守护"声音 |

### 像公司一样协作治理
| 能力 | 说明 |
|---|---|
| 需求打磨 | 模糊需求 CEO 专业引导（5 角度），能力不足蒸馏大佬双人协作 |
| 三产物闸 | 需求规格/方案设计/测试验收单——全链可追溯；派活前拆《任务编排图》过闸（依赖闭环/验收可判）；收口前 `jarvis_coverage` 自动覆盖核查（每条需求必须有方案落点+测试项+交付证据，漏一条打回） |
| 会议驱动 | kickoff/cycle/close + 反形式主义（讨论必有实质结论） |
| 变更评审 | 用户插话→全员评审会判断影响，不推倒重来 |
| 成果即报 | 员工 24h 干活，**每完成一个阶段成果立刻上报** CEO 中途审核（完成能力+需求对齐度），不符早纠正不白干 |
| 绩效换人 | 阶段化考核（不误判 0 产出）+ 需求对齐度（做偏客户要的=换人） |
| 猎头补位 | 五步法（岗位画像/寻访地图/对标评估/背景验证/够格判据） |
| 问题上行 | 技术绕不开→三件套上报→CEO 一节点内响应（SLA） |
| 资源公屏 | 需要资源先上公屏，未满足不许假装完成（防幻觉） |
| 版本交付 | 任何交付物版本化 + 可回滚（改错 undo 必带原因） |
| 记忆沉淀 | 角色/流程/经验存项目 `.jarvis/`，下次需求直接复用 |
| 任务单内核 | `jarvis_ticket`：需求裁决→开单→派单→汇报→重试/停止 的持久化状态机（`.jarvis/tickets/`），语义移植自 `dsh-superagent-prototype` 的 Ticket/Assignment 领域模型；插件仓库拒写 |

### 像真实办公室一样协作（PixOffice，已落地）
- **团队协作子页**即 **PixOffice 像素办公室**（`workbzw/pixoffice` 源码构建产物：人物精灵/动画/工位/会议室），经 `/api/pixoffice/events` relay 绑定本公司 `company-state` 快照——员工入职/派活/开会实时反映到场景，**不是自制静态二维画面**
- 公司状态结构化（employees/meetings/recruiting/tasks 表）+ 任务编排图 + 数据契约 `docs/3D-办公室-数据契约.md`
- ⚠️ 如实标注：PixOffice 是 **PixiJS 2D 像素风**场景（非 Three.js 3D）；artwork 第三方授权文件不完整，对外发布前需补齐授权或替换素材

---

## 🚀 快速开始（完全插件：一条命令装全）

```bash
# 1) 装包（二选一）
dsh plugin --profile web add luke-jarvis            # 发布后
dsh plugin --profile web add file:/path/to/luke-jarvis   # 本地开发（Windows：file:C:/path/to/luke-jarvis）

# 2) 一条命令收尾：技能落位 + bundle 登记（预设由 bundle patch 自带，无需落位）
npx luke-jarvis setup --profile web

# 3) 重启 dsh web，然后自检
npx luke-jarvis doctor --profile web
```

> ⚠️ **Windows 必须用本仓库 v0.14.0+**：上游 ≤0.13 的 `new URL().pathname` 在 Windows 会拼出非法路径（静态托管全 404、版本号读不到），且 `dsh-tools` 是 optional peer 被无条件 import（干净环境装完即崩）——两者均已在本版修复。

`setup` 只做两件事（剩下的由 bundle patch 与宿主自己完成）：

| 步骤 | 为什么必须 | 产物 |
|---|---|---|
| 技能落位 | 技能发现根只有 `~/.dsh/skills`、`~/.agents/skills`、项目 `.dsh/skills`，**不扫描 node_modules** | `~/.dsh/skills/jarvis/SKILL.md`、`~/.dsh/skills/ponder/`（十阶段） |
| bundle 登记 | `dsh plugin add` 只写 dependencies，不写 `dsh.profile.bundles`——不登记就只装不挂 | profile `package.json` 的 `dsh.profile.bundles` += `luke-jarvis` |

预设**不再复制到 `~/.dsh/.agent-presets/`**（DSH 0.2 前的旧机制，已废弃、不再被读取）：本包的
`cordis.patch.yml` 直接用 `@deepseek-ai/dsh-agent-preset` 行声明 `jarvis-org` / `jarvis-captain`，
所以「装上 bundle」= 预设自动出现在 agent 预设列表，不需要额外注册步骤。

> 手工安装（等价于 `setup` 的分步执行，便于排查）：
> ```bash
> mkdir -p ~/.dsh/skills/jarvis && cp skills/jarvis.md ~/.dsh/skills/jarvis/SKILL.md
> rm -rf ~/.dsh/skills/ponder && cp -r skills/ponder ~/.dsh/skills/ponder
> # 预设不用拷：cordis.patch.yml 已声明（jarvis-org / jarvis-captain）
> # 若 profile 没自动登记 bundle，补一行：dsh.profile.bundles += "luke-jarvis"
> ```
>
> 预设说明：`jarvis-org` = 完整公司预设（Jarvis 人设 + jarvis_* 工具 + agent-teams）；
> `jarvis-captain` = 严格预设（顶层只派发，无 bash/edit/write/subagent —— 不能自己干活）。

### 🖥️ 增强界面（Wings UI）：http://<dsh>/jarvis-ui

装好插件并重启 dsh web 后，`/jarvis-ui` 默认进入 **Wings 全息界面**（`/jarvis-wings`）：

- **中央 3D 全息核心**：倾斜轨道面 + 陀螺仪经线环 + 卫星点环绕（CSS 3D，随鼠标视角联动）；Jarvis 语音播报时光球呈心跳节律浮动
- **左右节点 = jarvis 真实任务点**：来自 `GET /api/jarvis/state` 的 `tasks.byAssignee` 投影（进行中/队列/交付/按负责人聚合/下一步），快照 5s + 事件 3s 轮询，断线自动回退演示内容
- **进度页 / 团队协作页 / 语音设置**全部数据化；团队协作子页 iframe 复用 **PixOffice 像素办公室**场景（源码构建产物 + `/api/pixoffice/events` relay，不是自制静态员工画面）

回退与调试入口：

| 入口 | 说明 |
|---|---|
| `/jarvis-ui` | 默认 302 → `/jarvis-wings`（DSH 设置 `ui=legacy` 时 → v2） |
| `/jarvis-ui?ui=legacy` | 强制进入原 v2 数据适配页（左侧实时数据面板 + PixOffice iframe） |
| `/jarvis-office/v2/index.html` | v2 页面直链 |
| `/jarvis-office/jarvis-scene.html` | 仅看 PixOffice 场景本身 |

**DSH 设置面板**（安装后设置里出现 luke-jarvis 区块，`export const Config`，与官方插件同约定）：

| 配置项 | 作用 | 默认值 |
|---|---|---|
| `ui` | 增强界面：`wings`（默认）/ `legacy` | `wings` |
| `defaultWorkspace` | 解析不到会话工作区时的回退项目目录 | 空（process.cwd） |
| `voice.provider` | 语音来源：`browser` / `openai`（OpenAI 兼容语音模型） | `browser` |
| `voice.baseUrl / model / voice / speed` | 语音模型地址 / 模型名 / 音色 / 语速 | api.openai.com / tts-1 / nova / 0.95 |

> **API Key 有意不进设置面板**：属敏感信息，在 Wings 界面「语音设置」里填写，落盘 `~/.dsh/luke-jarvis/voice.json`（权限 0600）。设置面板的 voice 配置是**默认值层**——页面显式保存过的值优先，未保存字段用设置兜底。

**安全**：`/api/jarvis/command`、语音保存、TTS 三个写端点拒绝跨站 Origin（防任意网页调用本机工具）。

**数据怎么进去**：CEO/成员每做关键动作（派活/汇报/开会/评估/开除/招募确认）调 `jarvis_company(mode=update|action)` → Engine 单写者提交 → 写 `.jarvis/company-state.json` → 页面轮询 API 投影渲染。

**PixOffice relay（T11）**：`/api/pixoffice/{events,messages,ui,reply}` 由插件提供——`events` 是 SSE，首帧即公司快照（`employees[].sceneActorId` 绑定上游演员，`seq` 单调、重启不回退）；`messages` 按上游白名单校验。双副本一致性：`bash scripts/check-office-consistency.sh`。

- ⚠️ **运行副本需重启生效**：DSH profile 以 `file:` 依赖硬链安装，升级后用 `bash scripts/check-install-consistency.sh` 比对仓库与运行副本 sha256，「不一致」= 需重装 profile 并重启 `dsh web`（等全员空闲时做）。

### ⚠️ 团队协作依赖（agent-teams）——干净环境安装必读

jarvis 的**公司团队功能**（建队/派活/成员/会议）依赖 `@nanmicoder/dsh-agent-teams` 插件提供的 `agent_teams_*` 工具：

- **luke-jarvis 已声明依赖**（package.json `dependencies`，`@nanmicoder/dsh-agent-teams ^0.1.28`），但**部分 pnpm 配置（`autoInstallPeers: false`）不会自动装传递依赖**；
- **版本下限别退**：agent-teams `0.1.20` 的 peer 钉在 dsh `0.1.x`，在 dsh 0.2.1 上会被安装器判定不兼容并回滚整次安装（真机复现）；`0.1.28` 起才兼容 0.2.x。
- **干净环境请手动确认**（缺了团队功能不可用）：
  ```bash
  pnpm add @nanmicoder/dsh-agent-teams
  ```
  或检查 `node_modules/@nanmicoder/dsh-agent-teams/` 是否存在；
- **装完后**：luke-jarvis 的 `cordis.patch.yml` 会自动给 agent-teams 配置 `memberMaxDepth: 2`（成员跑 ponder 起子 agent 必需——默认 0 会报 `delegation limit (0) reached` 卡死八卦镜）。
- **自检**：装完说 `/jarvis`，若提示 `agent_teams_*` 工具不可用 → 补装 agent-teams 后重启。

### 各组件装到哪（映射）

| 组件 | 位置 | 安装到（`luke-jarvis setup` 自动完成） |
|---|---|---|
| Agent 预设（完整） | `preset/agent.cordis.yml` + `preset/preset.yml` | `cordis.patch.yml` 里的 `preset-jarvis-org` 行（随 bundle 自动注册，无需落位） |
| Agent 预设（严格·顶层只派发） | `preset/jarvis-captain.cordis.yml` | `cordis.patch.yml` 里的 `preset-jarvis-captain` 行（同上） |
| 技能（唯一入口） | `skills/jarvis.md` | `~/.dsh/skills/jarvis/SKILL.md` |
| ponder 满血（随包自带） | `skills/ponder/`（自包含单目录） | `~/.dsh/skills/ponder/`（整个目录） |
| 核心插件 | `src/host/plugin.js`（bundle patch `cordis.patch.yml`） | profile `dsh.profile.bundles` += `luke-jarvis` |
| 安装/自检 CLI | `bin/luke-jarvis.mjs` | `npx luke-jarvis setup / doctor / status` |

然后对你的 AI 说：

```
/jarvis 我要做一个下沉市场的拼团电商小程序，2 人团 + 24h 成团，怎么设计？
```

**接下来发生的**：CEO 蒸馏 → 猎头招募 → 团队开工 → 测试通过 → 交付验收。你只需要在"说需求"和"验收成果"两个时刻出现。

---

## 🚧 阶段网关（P2 · 完全体）

插件不再只"注入提示词"，而是在**工具调用前机械放行/拒绝**：`computeStage(cwd)` 每次实时按 `.jarvis` 产物 + `gates.json` 算出当前阶段，`jarvisStageGate` 据此把越阶段的流程类工具（`jarvis_*` / `agent_teams_*`）直接拒掉。

- **六阶段 deny-list**（`clarify → decompose → design → build → execute → close`）：如 clarify/decompose/design 拒建队/派活/交活（`create`/`add_member`/`create_task`/`reassign`/`update_task`/`delete`/`resume` 等）；execute 拒 `jarvis_baseline`/`jarvis_taskgraph`/`jarvis_release`；close 拒再派活/加人。**未知工具默认放行**（deny-list 取舍：避免误伤 read/glob/bash 等只读/执行工具）。
- **拒绝文案固定三要素**：`阶段 N/6 + 名称`｜`当前缺口`｜`下一步`——模型被拒后知道该补什么，而不是原地重试。
- **链式校验**：派活（`create_task`/`reassign_task`）必须持 `clarify → decompose → design → build` 完整链，缺哪环点名哪环（与 `jarvis_flowguard` 同一份 `gates` 口径，且先于 deny 判定，所以不依赖 guard 注册顺序）。
- **归属判据**：`.jarvis/active-team.json`（`jarvis_flowguard(step="build")` 通过时写入）标记"本项目团队"，`computeStage` 只统计标记内团队的未完成任务；无标记才回退 72h mtime 启发式（老工作区兼容）。
- **收口可判定**：`close.ok` 读 `gateOk('close')`——跑过 `jarvis_flowguard(step="close")` 后 `done` 才含 close，不再永远停在「收口未完成」。
- ⚠️ **运行副本需重启生效**：DSH profile 以 `file:` 依赖硬链安装，仓库里 `plugin.js` 被重写会让硬链断裂留下旧副本（版本号看到新版、代码还是旧的）。升级后用 `bash scripts/check-install-consistency.sh` 比对仓库与运行副本的 sha256，输出「不一致」= 需重装 profile 并重启 `dsh web`（重启会中断在跑成员，须等全员空闲时做）。
- **已知边界**（诚实标注，不计缺陷）：手写 `gates.json` + 空壳产物可伪造阶段（威胁模型只防「无意识跳步」）；deny 补集未穷举（完整闭合靠运行时工具面 parity）；缓存 2s/3s 滞后；成员/无 `.jarvis` 工作区按 fail-open 放行。

---

## 🧬 核心架构（v0.14.0：移植 dsh-superagent-prototype）

写路径不再由 31 个工具各自直写文件，而是统一走 **Engine 单写者**（架构移植自 [`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype)，领域模型保留 jarvis 虚拟公司）：

```
工具/UI 命令
    │
    ▼
src/host/engine.js（组合根：Ports 适配 + Effects 落盘注册）
    │
    ▼
src/core/（纯核心，零 IO）
  ├─ engine.js   Engine 单写者：applyCompanyAction / commitBoard /
  │              recordGateSync / runCommand——读 → 纯规则迁移 → 一次写提交 → 副作用
  ├─ model.js    公司动作状态机（纯函数）+ settled 谓词
  ├─ effects.js  副作用队列：同 kind+key 合并、指数退避、持久化重启重放
  └─ errors.js   UserError + 固定拒绝码表
```

- **概念映射**：工具动作/命令=Trigger、阶段闸=Eval/Decision、任务点=Ticket、成员执行=Assignment、events.jsonl=Outbox（详见 [docs/CORE-ARCHITECTURE.md](docs/CORE-ARCHITECTURE.md)）
- **已收编写路径**：公司状态、UI 命令、公屏（board）、阶段闸（gates）；`.jarvis/docs/*.md` 判定为工件不收编（与上游原型一致）
- **如实差距**：无 SQLite/事务（靠单写者纪律 + 原子写 tmp+rename 保证）；无 Trigger 来源注册表（进程内调用）

---

## 📚 文档导航（先看这三份）

| 文档 | 用途 |
|---|---|
| [docs/STRUCTURE.md](docs/STRUCTURE.md) | **结构**：目录树、分层职责、单一事实源、安装模型、迁移台账 |
| [docs/CHAINS.md](docs/CHAINS.md) | **链路**：安装/挂载/预设/技能/工具/闸/状态/UI/测试/发布 11 条链路的唯一事实源与验证命令 |
| [docs/CORE.md](docs/CORE.md) | **内核**：任务单/派单/汇报/阶段/裁决（`jarvis_ticket`） |
| [docs/CORE-ARCHITECTURE.md](docs/CORE-ARCHITECTURE.md) | **核心架构**：Engine 单写者/Effects/与 superagent 的概念映射 |

其余文档见 [docs/README.md](docs/README.md)（索引：入门/运维/设计/发布/归档）。

---

## 🧪 质量保证

- 单测：**362/362 全过**（`node --test test/plugin.test.js test/core.test.js test/core-engine.test.js`；含 13 项核心架构专项：单写者/状态机/UserError/Effects 合并退避重放/门面兼容）｜标记 `<!-- test-count:362 -->`
- verify_host_pipeline **48 用例 0 VIOLATION**
- selfcheck **15 项发布前自检**（含 core 分层、状态根隔离、归档隔离）——当前结论「可发布/可安装」
- 临时 DSH Home 实测 `setup + doctor` 通过；`npm pack --dry-run` 核对发布物（webui/core/架构文档齐全）

---

## 🏷️ 版本与回退

```text
upstream-baseline-v0.14.0 (tag → 2635c22)   干净上游基线（重构前锚点，已推送 GitHub）
        │
0b4b307 refactor(core)                       全部重构（当前 main HEAD）
```

重构出问题时：

```bash
git stash                                    # 暂存本地未提交改动（可选）
git checkout upstream-baseline-v0.14.0       # 临时回基线
git revert 0b4b307                           # 反做重构提交（保留历史，推荐）
git reset --hard upstream-baseline-v0.14.0   # 彻底硬回退（丢弃重构，慎用）
```

**v0.14.0 主要变更**：核心架构移植（Engine 单写者/Effects/UserError）；Wings UI 并入插件并成为 `/jarvis-ui` 默认入口；DSH 设置面板 Config schema；CORS 收紧（command/voice/tts 拒跨站）；dsh-tools 移入 dependencies（干净环境可装）；修复 9 处 Windows 路径 bug（`fileURLToPath`）；snapshot 归档正则补 `archive/`；PixOffice seq 重启不回退。

---

## 📌 核心原则

- **真实优先**：不迎合、不编造——产出必须真实可验证（编造 source/数据/成果=一票否决）
- **卡不贵多贵有用**：每条卡内容须是"遇到X→做Y"的可执行行为，纯形容词堆砌=打回
- **领域无关**：不预设行业/角色/流程，由需求现场决定
- **推断不冒充**：蒸馏的推断（C 级）显式标注，不当他说过的用
- **要不要问用户=看信息够不够**：不是谁拍板，查现有信息决定

---

> 💡 **luke-jarvis 不是一个工具，是一种"把 AI 当公司经营"的范式。** 你给它一句话，它给你一家带着真实大佬思维运转的数字公司——和可验收的成果。
