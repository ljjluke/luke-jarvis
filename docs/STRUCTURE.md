# 项目结构（完全插件）· STRUCTURE

> 目标：**一个 DSH 插件包 = 一条命令装全**——工具、命令、技能、预设、UI 路由、自检全部随包交付，
> 用户不再手工拷 `skills/`、手拼 `cordis.patch.yml`、手改 `bundles`。
>
> 本文是结构说明 + 迁移台账；代码现状与目标结构的差距都写在 §6，不假装已经完成。

---

## 1. 一句话结构

```
包（npm / file: / tgz）
 ├─ src/host/plugin.js     ← DSH 插件本体（tools / commands / guards / routes / systemPrompt）
 ├─ cordis.patch.yml       ← 根挂载：jarvis-core + agent-teams(memberMaxDepth=2)
 ├─ preset/*.yml           ← 预设「单一事实源」（agent-plane 行列表）
 ├─ presets/*.patch.yml    ← 由 preset 生成的可注册行（勿手改）
 ├─ skills/{jarvis,ponder} ← 随包技能
 ├─ office/                ← PixOffice 静态页 + 适配器 + 场景
 └─ bin/luke-jarvis.mjs    ← 安装/自检 CLI（setup / doctor）
```

安装链路（DSH 0.2+ 的三个硬约束 → 本项目的解法）：

| 约束（上游事实） | 症状 | 本项目的解法 |
|---|---|---|
| `dsh plugin add` 只写 `dependencies`，不写 `dsh.profile.bundles` | 装了但插件不挂载 | CLI `setup` 把 `luke-jarvis` 补进 profile `dsh.profile.bundles` |
| 技能发现根只有 `~/.dsh/skills`、`~/.agents/skills`、项目 `.dsh/skills`，**不扫描 node_modules** | 包里的 `skills/` 永远不生效 | CLI `setup` 把 `skills/jarvis`、`skills/ponder` 落位到 `~/.dsh/skills/` |
| 预设必须由 **bundle patch** 用 `@deepseek-ai/dsh-agent-preset` 行声明；`~/.dsh/.agent-presets/` 是 0.2 前的旧机制、已不再读取 | 「装了预设，agent 预设列表里没有 jarvis」 | `presets/*.patch.yml` 由 `preset/*.yml` 生成并同步进本包 `cordis.patch.yml` 的 `presets:auto` 区（`--check` 防漂移） |

---

## 2. 当前目录（实测，0.9.2）

```
luke-jarvis/
├── package.json              # main/exports/bin/engines/dsh.bundle/files
├── cordis.patch.yml          # 根挂载（jarvis-core + agent-teams-patch）
├── bin/luke-jarvis.mjs       # CLI：setup / doctor / presets / status
├── presets/                  # 生成物（来自 preset/*.yml，勿手改）
│   ├── jarvis-org.patch.yml
│   └── jarvis-captain.patch.yml
├── preset/                   # 预设单一事实源
│   ├── agent.cordis.yml      # jarvis-org 行列表（persona + 工具 + 技能 + jarvis-core）
│   ├── preset.yml            # jarvis-org 的 name/description
│   └── jarvis-captain.cordis.yml
├── skills/
│   ├── jarvis.md             # 唯一入口技能
│   └── ponder/               # 十阶段（stages/ engine/ scripts/ resources/）
├── src/host/
│   ├── plugin.js             # 647 行：apply（挂载/路由/systemPrompt/guard 注册）+ inject + /jarvis 命令
│   ├── runtime.js            # 运行时单例：宿主 ctx / 最近 exec / 工作区解析 / fs 服务探测 / 通用 fs 助手
│   ├── core/                 # 领域内核（移植自 dsh-superagent-prototype）：model/ports/reasons/stage/tickets/engine/memory
│   ├── adapters/             # 端口适配：json-tickets（.jarvis/tickets 持久化）
│   ├── tools/                # 31 工具按域拆分：intake / memory / distill / review / org / deliver
│   ├── gates/                # 闸与判定：ownership（归属/状态根）/ store（gates.json/记忆保鲜）/ stage（阶段机）/ flow（流程闸）/ audit（六个机械审计）
│   ├── state/                # 项目级状态落盘：board（公屏）/ company（3D 公司状态）
│   ├── pixoffice/            # relay 协议纯函数：快照帧 / 事件枚举 / 命令白名单 / SSE
│   ├── distill/              # 蒸馏内核：卡校验/深度/引导/领域判定/内容指纹
│   ├── protocol/             # 协议文本：固定注入的工作方式与企业文化
│   └── vendor/               # superagent background.ts（P3 执行器预留，尚未接线）
├── office/                   # PixOffice 静态页（24MB，含 characters/assets）
├── test/                     # plugin 303 用例 + core 14 用例 + e2e + bagua
├── scripts/                  # selfcheck / build-preset-patches / 一致性 / 预演
├── docs/                     # 索引 README.md + 架构/结构/链路/安装/发布（含 archive/）
├── CHANGELOG.md              # 版本记录（0.9.2 及以前）
├── README.md
└── （无状态目录：.jarvis/.agent-teams/历史归档均在仓库外）
```

**已知结构性债务**（不在本轮处理，见 §6）：

1. ~~`src/host/plugin.js` 单文件 6011 行——所有工具/闸/路由耦合在一个模块里~~ → **已拆（0.10.2）**：
   `plugin.js` 647 行只留 apply/路由/命令；工具与判定按 `tools/`、`gates/`、`state/`、`pixoffice/` 分层，
   依赖方向单向（tools → gates/state/runtime → plugin 汇总），见 §3 分层表与 [CHAINS.md](CHAINS.md)。
2. 根挂载 vs 预设内挂载的重复风险：`cordis.patch.yml` 根挂 `jarvis-core`/`agent-teams`，而
   `preset/*.yml` 里也有这两行。生成的 `presets/*.patch.yml` 已**去重**（去掉这两行，由根挂载提供）；
   手工预设文件保留完整行，供「根 insert 失效」的 profile 使用。
3. 文档数字漂移（README 标题 `v0.3.4`、RELEASE「22 工具」、ARCHITECTURE「110 测试」等）。

---

## 3. 分层职责（代码边界）

| 层 | 入口/文件 | 职责 | 不该做什么 |
|---|---|---|---|
| 挂载层 | `cordis.patch.yml` | 唯一根挂载：插件 + agent-teams（`memberMaxDepth: 2`） | 不写业务逻辑 |
| 插件层 | `src/host/plugin.js` | `apply`：注册 31 工具（汇总 `tools/*`）、`/jarvis` 命令、4 条 guard、systemPrompt 注入、webServer 路由 | 不写工具实现、不做判定逻辑、不做领域模板 |
| 运行时层 | `src/host/runtime.js` | 进程级单例：宿主 ctx / 最近 exec / 用户工作区解析 / fs 服务探测 / 通用 fs 助手 | 不存业务状态（状态在 `state/`）、不做判定 |
| 工具层 | `src/host/tools/` | 31 个 `jarvis_*` 工具定义与 `execute(args, exec)`，按域分六组（intake/memory/distill/review/org/deliver）；`index.js` 负责 DSH 契约适配（render→ContentBlock[]、schema 断言） | 不自己实现闸/归属判定（一律 import）；不重复实现工具契约 |
| 判定层 | `src/host/gates/` | ownership（归属 + 状态根）、store（gates.json + 记忆保鲜）、stage（阶段机）、flow（流程闸）、audit（六审计） | 不直接改文件系统之外的宿主状态 |
| 状态层 | `src/host/state/` | board（公屏）/ company（3D 公司状态）落盘，唯二写 `.jarvis/` 的应用层入口 | 不写插件仓库自身（`STATE_ROOT_CONFLICT`） |
| 协议层 | `src/host/pixoffice/` + `protocol/` | relay 帧/命令校验（纯函数）；固定注入的工作方式与企业文化 | 不做 IO、不伪造场景绑定 |
| 领域内核层 | `src/host/core/` | 任务单/派单/汇报/阶段/裁决（纯逻辑，端口注入，不碰 DSH） | 不读写文件、不发事件给宿主（由适配层做） |
| 端口适配层 | `src/host/adapters/` | `json-tickets`：`.jarvis/tickets` 持久化；后续 `dsh-executor`：`ctx.jobs/subagents` 执行 | 不含业务判定 |
| 预设层 | `preset/*.yml` → `presets/*.patch.yml` | agent-plane 组合（persona/工具/技能/ponder） | 不重复根挂载的插件行 |
| 技能层 | `skills/jarvis.md`、`skills/ponder/` | 工作方式 + 十阶段思维器（随包） | 不写死流程分支（流程在插件机械闸） |
| UI 层 | `office/` + 路由 | `/jarvis-ui` → 适配页；`/jarvis-office/` 静态；relay SSE | 不伪造「场景已绑定本公司数据」 |
| 交付层 | `bin/luke-jarvis.mjs` | 安装收尾（技能/预设/bundles）+ doctor | 不联网、不静默改 profile（先备份） |

---

## 4. 单一事实源与生成物

| 事实源 | 生成物 | 再生成 | 漂移检查 |
|---|---|---|---|
| `preset/agent.cordis.yml` + `preset/preset.yml` | `presets/jarvis-org.patch.yml` | `node scripts/build-preset-patches.mjs` | `node scripts/build-preset-patches.mjs --check` |
| `preset/jarvis-captain.cordis.yml` | `presets/jarvis-captain.patch.yml` | 同上 | 同上 |
| `src/host/tools/*.js` 的 31 个工具定义 | `src/host/plugin.js` 的 `TOOLS`（汇总）与文档工具数（README/RELEASE） | 人工 | `scripts/selfcheck.sh` 第 15 项（TOOLS.length = 30）+ `scripts/verify-tool-contract.mjs`（真实 ToolRuntime） |
| `package.json` version | CHANGELOG / tag / npm | 人工 | 发布清单（待补 CI） |

规则：**生成物禁止手改**；改了事实源必须重跑生成器并提交生成物（CI 跑 `--check` 即红）。

---

## 5. 安装 / 自检契约

```bash
# 安装（一条命令）
dsh plugin --profile web add luke-jarvis
npx luke-jarvis setup --profile web        # 技能 + 预设 + bundles（写前备份 *.bak-<ts>）
# 重启 dsh web
npx luke-jarvis doctor --profile web       # 0=通过；2=有 FAIL；WARN 不阻断
```

`doctor` 的检查项（全部可判定）：

1. node >= 22
2. `~/.dsh/skills/jarvis/SKILL.md` 存在
3. `~/.dsh/skills/ponder` 的 `stages/*.json` >= 9，且 `scripts/step-guard.cjs` 存在
4. bundle patch（运行副本优先，回退本包）声明 `preset-jarvis-org` / `preset-jarvis-captain`
5. 每个 profile：`bundles` 含 `luke-jarvis`
6. 运行副本版本 = 本包版本（不一致 → 重装 + 重启，对应 `scripts/check-install-consistency.sh`）

---

## 5.5 记忆文件隔离（状态根守卫）

jarvis 的**记忆文件**只属于用户项目工作区，插件仓库自身永远不是状态根：

| 记忆文件 | 写入方 | 位置 |
|---|---|---|
| `gates.json` | `recordGate` | `<项目>/.jarvis/gates.json` |
| `active-team.json` | `writeActiveTeamMarker` | `<项目>/.jarvis/active-team.json` |
| `board.json` | `jarvis_board` / `jarvis_escalate` | `<项目>/.jarvis/board.json` |
| `company-state.json` | `jarvis_company`、会议/绩效自动同步 | `<项目>/.jarvis/company-state.json` |
| `sessions/*.json` | `jarvis_snapshot` | `<项目>/.jarvis/sessions/` |
| `docs/基线清单-*`、`docs/覆盖矩阵-*`、`docs/ponder-verify/*` | `jarvis_baseline` / `jarvis_coverage persist` / `jarvis_ponder_check` | `<项目>/.jarvis/docs/` |
| `perf-<role>.json` | `jarvis_perf` | `<项目>/.jarvis/` |

守卫实现：导出 `stateRootConflict(dir)`——`package.json` 的 `name` 以 `luke-jarvis` 开头，**或**目录下存在 `src/host/plugin.js`，即判定为插件仓库，写入方拒绝并返回 `STATE_ROOT_CONFLICT`（不建目录、不落盘）。判据：`selfcheck` 第 13 项 + 单测 T13 ⑤/⑥。

> **历史记忆/审计文档已移出仓库**（`gates.json` + 4 份流程文档 + README 原 `.jarvis-archive/`，现保存在仓库外的本机目录，不随仓库分发）；`.gitignore` 仍保留 `.jarvis-archive/` 排除规则作为兜底，防止再次误提交。它不是运行状态根，没有任何代码读写它。

---

## 6. 迁移台账（到「完全插件」还差什么）

### ✅ P0 · 包装落地（本轮，已完成）

- `bin/luke-jarvis.mjs`：setup / doctor / presets / status；写前备份、`--dry-run`、幂等。
- `presets/*.patch.yml`：由 `preset/*.yml` 生成，去掉根已挂载的插件行（防重复挂载）。
- `scripts/build-preset-patches.mjs`：生成 + `--check` 漂移检查。
- `package.json`：`bin`、`exports`（`./preset/*`、`./presets/*`、`./skills/*`、`./office/*`、`./cli`）、
  `engines.node >= 22`、`files` 增 `bin`/`presets`、`scripts.setup/doctor/build:presets/check:presets`。
- README 快速开始改为「一条命令装全」；手工步骤保留为排障路径。

### ⏳ P1 · 发布卫生（待做，0.5–1 天）

1. 版本对齐：README 标题、RELEASE、ARCHITECTURE、e2e 文案统一到 `package.json` 版本。
2. 打 `v0.9.x` tag；`npm publish`（当前 registry 404）。
3. 干净环境测试：`@deepseek-ai/dsh-tools` 只声明 optional peer → 仓库外 `npm test` 直接
   `ERR_MODULE_NOT_FOUND`。二选一：补 devDependency + mock，或 CI 里软链宿主模块并写清口径。
4. 最小 CI：`node --test test/plugin.test.js` + `selfcheck` + `build-preset-patches --check` + `npm pack --dry-run`。
5. `jarvis_update` 修包根路径 + semver tag 过滤（现在会把 `localVersion` 兜底成 `0.2.0`）。

### ✅ P2 · 代码结构（已完成 0.10.2：plugin.js 拆分 + 分层收敛）

**已完成（0.10.0）**：`src/host/core/` 领域内核 + `src/host/adapters/json-tickets.js` + `jarvis_ticket` 工具（见 [CORE.md](CORE.md)）——任务单/派单/汇报/阶段/裁决已是独立、可测、带端口的模块。

**已完成（0.10.2）**：6011 行 `plugin.js` 拆完，落成单向依赖的分层：

```
src/host/
├── plugin.js       # 647 行：apply / inject / 命令 / 路由 / 31 工具汇总（兼容 barrel）
├── runtime.js      # 宿主 ctx / exec / 工作区解析 / fs 服务 / fs 助手（单例唯一来源）
├── tools/          # 31 工具按域：intake / memory / distill / review / org / deliver
├── gates/          # ownership / store / stage / flow / audit
├── state/          # board / company（唯二写 .jarvis/ 的应用层入口）
├── pixoffice/      # relay 帧与命令校验（纯函数）
├── core/           # ✅ 领域内核（任务单/派单/汇报/阶段/裁决）
├── adapters/       # ✅ json-tickets；待落 dsh-executor
├── distill/        # ✅ 卡校验 / 深度 / 引导 / 领域判定 / 指纹
├── protocol/       # ✅ systemPrompt 协议 + 企业文化
└── vendor/         # ⏳ P3 执行器预留
```

依赖方向（禁止反向）：`plugin → tools → gates/state/pixoffice → runtime/core → 无依赖`。

验收口径（每一步都实跑）：`node --test` **317 全绿** + `bash scripts/selfcheck.sh` **15 项** + `node test/e2e-flow.test.mjs` 闭环；
公开导出集合不变（`test/plugin.test.js` 的具名 import 一个没改）。

### ⏳ P3 · 执行器 / 自动推进（R4，待做）

- 接线 `src/host/vendor/superagent-background.ts`（`ctx.jobs`/`ctx.subagents` 存活 + 完成唤醒）。
- `computeStage` 之后加阶段驱动（幂等、可观测、可回滚）。
- 这是「建完队自动跑完」的分水岭，工作量 1–2 周（见缺口分析）。

---

## 7. 验收清单（给改动者/CI 用）

```bash
node scripts/build-preset-patches.mjs --check     # 预设生成物无漂移
node bin/luke-jarvis.mjs help                     # CLI 可用
node --test test/plugin.test.js                   # 303 pass（需宿主 dsh-tools 在场）
node --test test/core.test.js                     # 14 pass（领域内核：任务单/派单/汇报/裁决/仓储）
bash scripts/selfcheck.sh                         # 15 项全过
npm pack --dry-run                                # 包内含 bin/ presets/ skills/ office/
```

安装侧（临时 HOME 可复现）：

```bash
mkdir -p /tmp/lj-home/profiles/web && printf '{"dsh":{"profile":{"bundles":[]}}}' > /tmp/lj-home/profiles/web/package.json
printf -- '- id: web\n  name: "@deepseek-ai/dsh-web"\n' > /tmp/lj-home/profiles/web/cordis.patch.yml
node bin/luke-jarvis.mjs setup --home /tmp/lj-home --profile web
node bin/luke-jarvis.mjs doctor --home /tmp/lj-home --profile web   # 期望 exit 0
```

---

## 8. 诚实边界

- 本轮**没有**拆 `plugin.js`，也**没有**改挂载语义；根挂载与预设挂载的重复风险靠「生成物去重」规避，
  但手工预设文件仍是完整行（供 profile 忽略根 insert 的已知边界使用）。
- `office/` 24MB 让包体到 23.4MB；是否拆成独立资源包/压缩，等发布策略定了再动。
- `presets/*.patch.yml` 里的 `!!js` 表达式由 DSH loader 求值；用普通 YAML 解析器校验会告警（预期）。
- 所有「生效」判断以重启 `dsh web` 后的 `doctor` + 新会话预设列表为准，不以文件存在为准。
- 状态根守卫覆盖的是「写入方显式拿到项目目录」的路径；`jarvis_perf` 等以相对路径走宿主 fs 服务的写入，仍依赖会话 cwd 正确（运行在项目工作区）——这是设计前提，不是漏洞。
