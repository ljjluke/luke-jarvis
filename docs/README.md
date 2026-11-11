# 文档索引（docs/）

> 按「先看什么」排列。代码结构见 [STRUCTURE.md](STRUCTURE.md)，全链路见 [CHAINS.md](CHAINS.md)。

## 入门 / 总览

| 文档 | 讲什么 |
|---|---|
| [STRUCTURE.md](STRUCTURE.md) | 目标结构树、分层职责、单一事实源、安装模型、迁移台账 |
| [CHAINS.md](CHAINS.md) | 全链路细节：安装/挂载/预设/技能/工具/闸/状态/UI/测试/发布 |
| [CORE.md](CORE.md) | 领域内核：任务单/派单/汇报/阶段/裁决（移植自 dsh-superagent-prototype） |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 执行架构：流程序列与每层的真实行为 |
| [流程图-jarvis全流程-详细版.html](流程图-jarvis全流程-详细版.html) | 全流程可视化（浏览器打开） |

## 安装 / 运维

| 文档 | 讲什么 |
|---|---|
| [安装-半插件.md](安装-半插件.md) | 半插件安装路径与状态根说明（历史版本，正文有 T13 说明） |
| [OPS-QA.md](OPS-QA.md) | 运维与 QA 检查清单 |
| [UPGRADE-20260828.md](UPGRADE-20260828.md) | 一次升级的记录（历史） |
| [PUSH.md](PUSH.md) | 推送/发布操作说明 |

## 设计与方案

| 文档 | 讲什么 |
|---|---|
| [设计-质量自循环深挖机制.md](设计-质量自循环深挖机制.md) | 质量自循环（深挖/审计）机制设计 |
| [REFORM-PLAN.md](REFORM-PLAN.md) | 改革计划（子系统清单与优先级） |
| [REFORM-CLARIFY.md](REFORM-CLARIFY.md) | 需求澄清机制（五角度/双人协作） |
| [3D-办公室-数据契约.md](3D-办公室-数据契约.md) | PixOffice 数据契约（数据源/面板/坑） |

## 发布 / 社区

| 文档 | 讲什么 |
|---|---|
| [RELEASE.md](RELEASE.md) | 发布清单与自检步骤 |
| [MARKET-PR.md](MARKET-PR.md) | 市场/PR 文案 |
| [dsh-web-community.diff](dsh-web-community.diff)、[dsh-web-community.new.json](dsh-web-community.new.json)、[community-entry.example.json](community-entry.example.json) | 社区入口补丁与样例 |

## 历史归档（不在仓库内）

`.jarvis-archive/`（gates + 4 份流程文档）已移出仓库、本机保留；`.gitignore` 保留排除规则兜底。
[archive/](archive/) 内是已入库的历史文档（MARKET-LAUNCH、旧版流程图）。
