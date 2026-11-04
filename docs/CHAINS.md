# 全链路细节（CHAINS）

> 一张表看清「从安装到生效、从需求到交付、从代码到发布」的每一条链路，以及每条链路
> 的**唯一事实源**、**落点**和**验证命令**。结构总览见 [STRUCTURE.md](STRUCTURE.md)，
> 领域内核见 [CORE.md](CORE.md)。

---

## 0. 目录即链路

```
luke-jarvis/
├── package.json          dsh.bundle.patch + exports + bin
├── cordis.patch.yml      挂载：agent-teams(memberMaxDepth=2) + jarvis-core
├── bin/luke-jarvis.mjs   安装收尾：setup / doctor / presets / status
├── preset/*.yml          预设单一事实源 ──脚本──► presets/*.patch.yml ──setup──► profile patch
├── skills/{jarvis.md,ponder/}   随包技能 ──setup──► ~/.dsh/skills/
├── src/host/
│   ├── plugin.js         647 行：apply(ctx) 注册 30 工具 + /jarvis + 4 guard + 4 路由 + systemPrompt
│   ├── runtime.js        宿主 ctx / exec / 工作区解析 / fs 服务（单例唯一来源）
│   ├── tools/            30 工具按域：intake/memory/distill/review/org/deliver
│   ├── gates/            ownership（归属/状态根）/ store（gates.json+记忆）/ stage（阶段机）/ flow（流程闸）/ audit（六审计）
│   ├── state/            board（公屏）/ company（3D 公司状态）落盘
│   ├── pixoffice/        relay 帧/命令校验（纯函数）
│   ├── core/             任务单领域内核（纯逻辑；不碰 DSH/fs）
│   ├── adapters/         core 端口实现（json-tickets → .jarvis/tickets）
│   ├── distill/          角色卡校验/深度/引导/领域判定（纯逻辑）
│   └── protocol/         固定注入的协议文本（systemPrompt）
├── office/               PixOffice 静态页（jarvis.html / scene）
├── test/                 plugin 296 + core 14 + e2e + bagua
├── scripts/              selfcheck / build-presets / 一致性 / 预演
└── docs/                 架构 / 结构 / 链路 / 安装 / 发布 / 历史
```

---

## 1. 安装链路（一条命令装全）

| 步骤 | 事实源 | 落点 | 验证 |
|---|---|---|---|
| ① 装包 | `package.json`（`dsh.bundle.patch`、`bin`） | profile `package.json` 的 `dependencies` | `dsh plugin --profile web add luke-jarvis` |
| ② 收尾 | `bin/luke-jarvis.mjs` `setup` | 技能：`~/.dsh/skills/{jarvis,ponder}`；预设：`~/.dsh/.agent-presets/{jarvis-org,jarvis-captain}`；bundle：profile `dsh.profile.bundles`；预设注册：profile `cordis.patch.yml` 标记块 | `node bin/luke-jarvis.mjs setup --profile web --dry-run` |
| ③ 重启 | — | `dsh web` 重新加载 bundle | 重启后新会话出现 jarvis 工具/预设 |
| ④ 自检 | `doctor` | 6 项检查（node/技能/预设/bundles/patch/版本一致性） | `npx luke-jarvis doctor --profile web`（0=过，2=FAIL） |

> 三个 DSH 0.2+ 硬约束（不补齐就是「装了不生效」）：bundles 不登记 → 不挂载；
> 技能根不扫描 node_modules → 必须落位；预设不再自动发现 → 必须写进 profile patch。

---

## 2. 挂载链路（bundle → apply）

```
package.json  dsh.bundle.patch = "./cordis.patch.yml"
        │
        ▼
cordis.patch.yml
  - insert: agent-teams-patch  (@nanmicoder/dsh-agent-teams, memberMaxDepth: 2)
  - insert: jarvis-core        (luke-jarvis → package.json main → src/host/plugin.js)
        │
        ▼
plugin.js  export const inject = ['tools','webServer','agents','systemPrompt']   # plugin.js:182
           export async function apply(ctx)                                       # 见文件尾部
        │
        ├─ ctx.tools.register(TOOLS)            → 30 个 jarvis_* 工具
        ├─ commands.register('/jarvis')         → jarvisCommand
        ├─ ctx.systemPrompt.section(...)        → protocol/JARVIS_SYSTEM_PROTOCOL + JARVIS_CULTURE
        └─ ctx.webServer.route(...)             → /jarvis-ui、/jarvis-office/*、/api/luke-jarvis/*、/api/pixoffice/events
```

**验证**：`node -e "import('./src/host/plugin.js').then(m=>console.log(m.TOOLS.length))"` → 30；
`grep -n "inject =" src/host/plugin.js` → 见 plugin.js:182。

---

## 3. 预设链路（单一事实源 → 生成物 → profile 注册）

```
preset/agent.cordis.yml ──┐
preset/preset.yml       ──┼─► node scripts/build-preset-patches.mjs ─► presets/jarvis-org.patch.yml
preset/jarvis-captain.cordis.yml ────────────────────────────────────► presets/jarvis-captain.patch.yml
                                                                          │
                                              npx luke-jarvis setup ──────┘ 写进 profile cordis.patch.yml
                                              标记块： # >>> luke-jarvis presets ... >>>
```

- 生成器会**去掉**根 patch 已挂载的 `luke-jarvis` / `@nanmicoder/dsh-agent-teams` 行，防重复挂载。
- 漂移检查：`node scripts/build-preset-patches.mjs --check`（CI 红）。
- 预设内容：`jarvis-org` = 完整公司预设；`jarvis-captain` = 顶层只派发（无 bash/edit/write/subagent）。

---

## 4. 技能链路

```
skills/jarvis.md       → ~/.dsh/skills/jarvis/SKILL.md      （唯一入口：老板协议/蒸馏方法论/记忆库/两层架构）
skills/ponder/         → ~/.dsh/skills/ponder/              （十阶段：stages/ engine/ scripts/ resources/）
```

发现根只有 `~/.dsh/skills`、`~/.agents/skills`、项目 `.dsh/skills`——**不扫描 node_modules**，所以必须由 setup 落位。
**验证**：`doctor` 第 2/3 项（ponder 的 `stages/*.json` >= 9 且 `scripts/step-guard.cjs` 存在）。

---

## 5. 工具链路（model → tool → gate → state）

```
模型（systemPrompt 注入的 11 步流水线）
   │  调用 jarvis_* 工具
   ▼
TOOLS（tools/*.js 内 defineTool：parameters/output.schema/render/handler；plugin.js 汇总）
   │  handler(exec) → 解析 cwd/projectDir → 业务逻辑
   ├─ 闸：jarvisStageGate / jarvisFlowGuard / captainExecutionGuard / checkMemoryFresh / checkPonderVerify
   ├─ 领域：jarvis_project/distill/review/think/board/company/coverage/…（29 个）
   └─ 任务单：jarvis_ticket → core/Engine → adapters/JsonTicketRepositories → .jarvis/tickets
```

- 闸的拒绝形式：返回字符串（模型可见的拒绝原因）或 `{ ok:false, error:'STATE_ROOT_CONFLICT' }`。
- 任务单语义见 [CORE.md](CORE.md)：`adjudicate→open→report→retry/stop→ended`。

---

## 6. 闸与阶段链路

| 环节 | 实现 | 落点 |
|---|---|---|
| 协议注入 | `src/host/protocol/index.js`（每请求注入，不受压缩影响） | systemPrompt section |
| 阶段机 | `computeStage` / `renderStage`（`gates/stage.js`）读 `.jarvis/docs` 产物 + `gates.json` | 注入「当前第几步/缺什么/下一步」 |
| 阶段闸 | `jarvisStageGate`：`STAGE_GATE` 要求持对应闸；`STAGE_DENY` 拦越阶工具 | 模型越阶即拒 |
| 链路闸 | `jarvisFlowGuard`：缺产物/缺闸/链路顺序 → 拒 | 派活/收口前 |
| 队长闸 | `captainExecutionGuard`：captain 不得自己干活（禁 bash/edit/write/subagent） | 顶层会话 |
| 记忆闸 | `checkMemoryFresh`：`.jarvis/project.md` 超 6h → 提醒/拒 | 收口前 |
| 实证闸 | `checkPonderVerify` / `checkCoverageGate` / `auditTeamBriefs` / `checkTalentPreconditions` | 交付/派活前 |

---

## 7. 状态链路（`.jarvis/` 唯一状态根）

| 文件 | 写入方 | 读取方 |
|---|---|---|
| `.jarvis/project.md` | CEO/模型（记忆库） | `computeStage`、`checkMemoryFresh`、IA/再入场 |
| `.jarvis/gates.json` | `recordGate` | `computeStage`、`jarvisStageGate`、flowguard |
| `.jarvis/board.json` | `writeBoardItems`（board/escalate） | HTTP `/api/luke-jarvis/board`、公屏工具 |
| `.jarvis/company-state.json` | `jarvis_company` + 会议/绩效自动同步 | 3D 办公室 `/api/luke-jarvis/company` |
| `.jarvis/active-team.json` | `writeActiveTeamMarker`（7 天 TTL） | `resolveOwnedTeams`（审计作用域） |
| `.jarvis/docs/*` | baseline / coverage / ponder-verify | `computeStage`、收口闸 |
| `.jarvis/tickets/*.json`、`decisions/*.json` | `jarvis_ticket` → JSON 仓储 | `jarvis_ticket list/get` |

**守卫**：插件仓库（`name` 以 `luke-jarvis` 开头或存在 `src/host/plugin.js`）一律拒写 →
`STATE_ROOT_CONFLICT`，且不建目录（见 `stateRootConflict`，gates/ownership.js:80）。

---

## 8. UI 链路（PixOffice）

```
GET /jarvis-ui ──302──► /jarvis-office/jarvis.html ──iframe──► jarvis-scene.html
                                                        │
              /api/luke-jarvis/company ──读 .jarvis/company-state.json──┘
              /api/luke-jarvis/board   ──读 .jarvis/board.json
              /api/pixoffice/events    ──SSE relay（首帧快照 + 增量 + 心跳 + error 帧）
```

路由注册顺序：relay 的 exact 路由必须注册在静态 prefix 之前（否则被 prefix 吞掉）。

---

## 9. 测试与自检链路

| 命令 | 覆盖 |
|---|---|
| `node --test test/plugin.test.js` | 296：工具/闸/阶段/relay/状态根/格式 |
| `node --test test/core.test.js` | 14：任务单生命周期/裁决/阶段/仓储/工具/守卫 |
| `node test/e2e-flow.test.mjs` | 端到端链路（打印 `TOOLS.length`） |
| `bash scripts/selfcheck.sh` | 15 项：铁律/预设/CLI/状态根/归档核心 |
| `bash scripts/update-readme-count.sh --check` | README 用例数标记与实测一致 |
| `node scripts/build-preset-patches.mjs --check` | 预设生成物无漂移 |

---

## 10. 发布链路

```
package.json version ─► CHANGELOG.md ─► git tag vX.Y.Z ─► npm publish
        │
        └─ files 白名单：src / bin / presets / preset / skills / docs / test / scripts / office / cordis.patch.yml
           npm pack --dry-run 校验（约 23MB，office 静态资源为主）
```

**发布前必跑**：`selfcheck` + 两套 `node --test` + `e2e` + `build-preset-patches --check` + `npm pack --dry-run`。

---

## 11. 已知结构性债务（诚实清单）

1. `src/host/plugin.js` 仍 ~5,700 行：30 个工具定义 + 闸/阶段/路由/app 混在一起。已拆出
   `core/`、`adapters/`、`distill/`、`protocol/`；剩余 `tools/`、`gates/`、`state/`、`ui/` 待拆。
2. `scripts/` 是平铺的（selfcheck/build/check/rehearse 混放），未按用途分组。
3. `docs/` 文档数量多，缺索引（本次补 [README.md](README.md)）。
4. `src/host/vendor/superagent-background.ts` 仍未接线（P3 执行器）。
