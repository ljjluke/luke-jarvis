# core：从 dsh-superagent-prototype 移植的核心架构

> 目标：把 prototype 的**领域分层**搬进 luke-jarvis，让「任务」从"模型自述 + 工具字符串"变成
> **带生命周期、可持久化、可测试、有端口边界**的领域对象；插件仓库自身仍不是状态根。

---

## 1. 搬了什么（架构，不是业务）

| prototype | luke-jarvis（本项目） | 说明 |
|---|---|---|
| `core/model.ts` | `src/host/core/model.js` | 领域形状：Ticket / Assignment / Report / Mandate / Stage / Outcome；纯函数 `liveTicket`、`latestAssignment`、`latestReport`、`waitsForPerson` |
| `core/ports.ts` | `src/host/core/ports.js` | 端口：`Repositories`（持久化）、`Executor`（执行器）、`Clock`、`Policy`（闸/授权）、`Outbox`（出站）；默认实现 `noopExecutor` / `systemClock` / `allowAllPolicy` |
| `core/reasons.ts` | `src/host/core/reasons.js` | 结构化 reason 码 + 中文模板 + `reasonText()` |
| `core/stage.ts` | `src/host/core/stage.js` | `ticketStage()`（ended / person / working / idle）+ `canRetry()` + 中文描述 |
| `core/tickets.ts` | `src/host/core/tickets.js` | 生命周期：开单 / 派单 / 汇报 / 重试 / 停止 / 结束；`TicketError` 带 code |
| `core/engine.ts` | `src/host/core/engine.js` | 唯一入口：`adjudicate()`（裁决→开单）+ `report/retry/stop/get/list/view`；事件回调 |
| `core/memory.ts` | `src/host/core/memory.js` | 内存仓储（测试/预演，`atomic` 快照回滚） |
| `app/store.ts` 的一角 | `src/host/adapters/json-tickets.js` | JSON 仓储适配器：`<项目>/.jarvis/tickets/*.json` + `decisions/*.json`，原子写 |
| `executor/*.ts` | **未搬**（见 §5） | DSH 执行器接线（ctx.jobs/ctx.subagents）是下一步 P3 |

**没有搬**：sources（GitHub/Feishu 触发）、evals（语义裁决队列）、replies/outbox 的投递实现、
client（React 面板）。这些属于 prototype 的"主动 agent"形态，luke-jarvis 的入口是工具调用，
不是外部事件源。

---

## 2. 任务单状态机

```
adjudicate(过闸) ──► open ──► assignment(running) ──┬─ report(progress/waiting) ──► 保持开启
                                                     ├─ report(ready) ──► ended(completed, by executor)
                                                     ├─ report(dropped) ──► ended(dropped, by executor)
                                                     └─ report(blocked|failed) ──► 等人工（可 retry）
                                                                                     │
                                                     retry ──► 结束旧派单(reason=retried) + 新派单(running)
                                                     stop  ──► ended(stopped, by human)
```

阶段判定（`ticketStage`，按序命中）：`ended` → `person(review|blocked|failed)` →
`working(queued)` → `idle`（waiting / 派单已结束但单未结束）→ `working`。

## 3. 端口与适配

```
core/（不依赖 DSH、不碰 fs）
  ├─ 依赖注入：repo / executor / policy / clock / outbox
  └─ 只做领域判定与状态迁移

adapters/json-tickets.js   ← Repositories 落 .jarvis/tickets
plugin.js jarvis_ticket    ← 工具入口：解析 projectDir、stateRootConflict 守卫、构造 Engine
（待做）adapters/dsh-executor.js ← Executor：ctx.get('jobs')/ctx.get('subagents') 真执行
```

**守卫**：`jarvis_ticket` 走 `stateRootConflict(projectDir)`，插件仓库返回
`STATE_ROOT_CONFLICT` 且不建 `.jarvis/`（与 T13 一致）。

## 4. 用法

```js
jarvis_ticket({ action: 'adjudicate', title: '接支付', stage: 'build', role: '研发',
                mandate: '{"strength":"explicit","basis":"user:explicit"}' })
jarvis_ticket({ action: 'list' })
jarvis_ticket({ action: 'report', ticketId: 'ticket-xxx', state: 'blocked', summary: '缺接口契约' })
jarvis_ticket({ action: 'retry', ticketId: 'ticket-xxx' })
jarvis_ticket({ action: 'stop', ticketId: 'ticket-xxx', reason: '方向错了' })
```

## 5. 迁移台账

| 阶段 | 状态 |
|---|---|
| core 领域模型 + 端口 + 内存仓储 + 任务单生命周期 + 引擎 | ✅ 已落（14 个 core 用例） |
| `jarvis_ticket` 工具 + JSON 持久化 + 状态根守卫 | ✅ 已落 |
| `adapters/dsh-executor.js`：`ctx.jobs`/`ctx.subagents` 真执行、完成唤醒 | ⏳ P3-a |
| 自动推进：`computeStage` 驱动任务单阶段流转 | ⏳ P3-b |
| 把 plugin.js 里的阶段机/闸判定迁入 core（`core/project-stage.js`） | ⏳ P2 后续 |
| outbox 投递（通知/回复） | ⏳ 按需 |

## 6. 验收

```bash
node --test test/core.test.js     # 14 用例：生命周期/阶段/裁决/仓储/工具/守卫
node --test test/plugin.test.js   # 296 用例不回归（30 工具）
bash scripts/selfcheck.sh         # 15 项（新增 core 分层检查）
```
