# 核心架构（对齐 dsh-superagent-prototype）

luke-jarvis 的核心架构已按 [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（`src/core` + `src/app` 的 Engine/Ports/Effects 分层）重构。本文说明结构与概念映射。

## 分层与依赖方向

```
src/core/    纯核心：领域规则、Engine、Effects、UserError —— 不 import 任何宿主模块、不做 IO
src/host/    宿主适配：把既有 state/gates 模块包装成 core 的 Ports（组合根 host/engine.js）
glue         tools/index.js、state/command.js、HTTP 路由：只做翻译（参数校验/规整/找会话），写状态一律走 Engine
```

依赖规则与 superagent 一致：**host → core 单向**；core 不 import host；一类状态只有一个写者。

## 模块对照

| superagent | luke-jarvis | 说明 |
| --- | --- | --- |
| `src/core/engine.ts`（Engine，唯一写者） | `src/core/engine.js` | 公司状态迁移与 command 审计的唯一写者 |
| `src/core/part.ts`（EnginePart） | 命令内联于 engine.js（规模尚小，未拆 Part 文件） | 后续按 Intake/Evals/Tickets 拆分 |
| `src/core/model.ts`（领域类型/谓词） | `src/core/model.js` | `applyCompanyActionTo` 纯状态机；`waitingForPerson`/`settled` 谓词 |
| `src/core/errors.ts`（UserError） | `src/core/errors.js` | 固定拒绝码表 USER_ERRORS |
| `src/app/effects.ts`（提交后副作用队列） | `src/core/effects.js` | 同 kind+key 合并、指数退避、`Later` 不计失败、健康态、可持久化重放 |
| `src/app/runtime.ts`（组合根） | `src/host/engine.js` | 组装 Ports（company IO / events / guards），注册 Effects handler |
| SQLite Store | `<workspace>/.jarvis/*.json` + `.agent-teams/*/team.json` | 文件即库；读路径见 state/snapshot.js |
| Sources（GitHub/Feishu） | 工具动作 + UI 命令（Trigger 的两个来源） | luke-jarvis 不监听外部平台 |
| Ticket / Assignment / Report | agent-teams 任务点 / 成员执行 / 成员回报 | 概念同构，数据落 team.json |
| Outbox | `state/events.js`（events.jsonl） | 领域事件经 Effects 的 `event` kind 落盘 |

## 概念映射（superagent → luke-jarvis）

| superagent 概念 | luke-jarvis 对应 |
| --- | --- |
| Trigger | 工具动作（company action）/ UI 命令（command） |
| Eval / Decision | 阶段闸裁决（gates/stage.js，事实驱动，非模型自述） |
| Mandate | 过闸记录（gates.json） |
| Ticket | 任务点（team.json 的 task） |
| Assignment | 成员对任务的一次执行（employee status 为其投影） |
| Report | 成员回报（employee_reporting / board 未决） |
| Effects（assessment/launch/delivery/relay/notice/reply） | 目前仅 `event`（领域事件落盘）；后续可扩展 |

## 写路径（重构后）

- **公司状态**：工具 → `syncCompanyState`（门面）→ `host/engine.js` 组装 Ports → `core/engine.js#applyCompanyAction`
  （读 → `model.applyCompanyActionTo` 纯迁移 → 一次写提交 → Effects 落 `company` 事件）。
- **UI 命令**：HTTP → `state/command.js`（校验/规整/找会话，glue）→ `core/engine.js#runCommand`
  （执行 → 结果整形 → Effects 落 `command` 事件；Engine 是 command 事件的唯一写者）。
- **黑板（公屏）**：工具 → `state/board.js#writeBoardItems`（门面）→ `core/engine.js#commitBoard`
  （守卫 → board 端口唯一写 → Effects 落 `board` 事件）。原始原子写由 board.js 经
  `host/engine.js#registerRawIo('board', …)` 注册（避免循环 import）。
- **机械闸**：flowguard → `gates/store.js#recordGate`（门面，同步）→ `core/engine.js#recordGateSync`
  （守卫 → gates 端口唯一写）。同步契约刻意保留：落闸后紧接的 `_readGates` 必须立即读到。
- **文档（.jarvis/docs/*.md）**：属**工件（artifact）而非 Engine 状态**——与 superagent 中
  产物文件不进 Engine 状态库一致，仍由工具直接写，不收编。

## 与 superagent 的已知差距（如实）

- Engine 命令面已覆盖：公司状态、UI 命令、黑板、机械闸四条写路径；gates.json 的 note 归档等
  领域细节仍在原始 IO（store.js），Engine 负责守卫与唯一写入口。
- 无 SQLite/事务；「一次写」由单写者纪律 + 原子写（tmp+rename）保证。
- 无 Source 插件注册表（registry）；Trigger 来源是进程内调用。
