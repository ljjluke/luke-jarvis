# 运维 Q&A（防 bug 检查记录）

本文件记录 luke-jarvis 开发/部署中发现的**真实问题与修复**，供后续维护者防复发。

## 2026-08 · 问题清单

### P1：持久化 bundle 与动态插件「两条代码路径漂移」
- **症状**：GUI 里 `/jarvis` 跑的是旧版能力（无 jarvis_fidelity / jarvis_collab / 证据链硬闸），而持久化源码（`src/host/plugin.js`）已是完整版（6 工具 + 全部硬闸）。用户以为在满血版上，实际跑的是旧版。
- **根因**：luke-jarvis 有两套加载方式——
  - **持久化 bundle**（`dsh plugin add file:…`，重启不丢）：插件经 `package.json main → src/host/plugin.js`，用 `ctx.get('tools') / ctx.get('commands')` 注册；
  - **动态插件**（`cordis_define/run`，免重启但进程内）：用 `globalThis.harness.defineTool`（字段 `execute`、JSON Schema 不支持 `required`、命令 handler 返回 `CommandResult`）。
  两条代码路径容易漂移：升级了持久化源码，动态版没人同步。
- **修复**：把 GUI 运行的动态插件升级为与持久化源码一致的完整版（v8）；**每次改 `src/host/plugin.js` 后，必须同步重新定义动态插件**（复制校验逻辑 → 转 harness 形态）。
- **防复发规则**：任何能力改动，两条路径都要验证；动态版必须逐项核对 6 工具 + 硬闸清单。

### P2：动态 harness 与持久化 tools.register 的契约差异（踩坑记录）
| 点 | 持久化（tools.register） | 动态（harness.defineTool） |
|---|---|---|
| 业务函数字段 | `handler` | `execute` |
| output.schema | 可用 `required` | **不支持 `required`**（DSL） |
| 命令返回 | `CommandResult` | 同左（`{kind:'success',text}` / `{kind:'error',text}`） |
| 命令 handler 字段 | `handler` | `handler`（注意：不是 execute）|
| 服务 | `ctx.get('tools')` | `globalThis.harness` |

### P3：动态插件随进程丢失（架构事实）
- 动态插件只活在当前 web 进程；重启/headless 新进程即无。生产用**持久化 bundle**（重启不丢）。
- 但持久化 bundle **在裸进程/headless 也挂不到 tools/commands**（这两服务只在 web GUI 联动上下文注入）。所以：GUI 会话内→动态或持久化均可；headless→都不行（当前不支持，属插件的已知边界）。

### P4：女娲式蒸馏「防迎合」硬闸（防编造 source）
- 需求：杜绝"蒸馏只是形式主义"（编假大佬+假 source 轻易放行）。
- 修复：`jarvis_distill` 证据链硬闸 + `jarvis_fidelity` 保真度审计——
  - source 必须是 `https://…`（非纯文本）；
  - 必含「证据链（6 维度）/诚实边界/保真度」段；
  - 心智模型须三重验证（跨域复现/生成力/排他性 ≥2）；
  - 保真度评级 PRIMARY/MIXED/SPECULATIVE + 黑名单源（知乎/公众号/百度百科）拦截。

### P5：团队协同硬闸（子角色如何协同）
- 需求：CEO 定子角色后必须设计协同（否则团队成员各干各的，不是真团队）。
- 修复：`jarvis_collab` + 校验器强制——每个角色协同四要素（位置/依赖/介入时机/协同方式），全局健康（≥2 角色、并行非串行、有升级路径）。

## 回归基线（每次改动后跑）
```bash
node --test test/plugin.test.js   # 26/26
./scripts/selfcheck.sh            # 六项全过
npm pack --dry-run                # 可打包
```
动态版核对：`cordis_inspect_self` 应见 6 工具（jarvis_project/distill/review/think/fidelity/collab）全部 running、无诊断错误。