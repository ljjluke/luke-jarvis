# 方案E' 推演发现的补丁清单（辩论阶段输入）

> 来源：方案E' 五场景推演（2026-08-24），针对 jarvis_guard 13 项校验的漏洞。

## 补丁1：变更/变卦处理（最高频故障点）

- **问题**：13 项检查全是"一次性建队"视角。指纹绑原计划、no_team_yet 挡再验证、delete 也被 gate → 用户中途变卦即死锁或删队重建。
- **修复**：新增第 14 项 `mutation_revalidation`——变更 = 重跑 guard 于新计划 + 指纹重绑 + 旧任务 cancel/归档。

## 补丁2：guard 误杀与 gaming 空间

- **问题**：role_match 关键词漏检时，CEO 被迫改写需求注入关键词（guard 设计诱发 gaming）或拒单。
- **修复**：deny 语义限定为"deny 建队而非 deny 需求"；S 级直通必须是代码级分支（不是 CEO 可以选择的）。

## 补丁3：绕过路径补全

- **问题**：send_message / update_task 不在拦截清单 = 旁路缺口；guard-pass 记录若不在代码侧存储则指纹失效。
- **修复**：guard-pass 记录落代码侧存储；指纹覆盖全部可变字段（description+acceptance+assignee+deps）。

## 补丁4：维护闭环（长期运营）

- **问题**：guard 冻结 → 关键词库陈旧 + 用户学提示词黑话绕过；acceptanceNote 从未回流校准，calibration 字段 2 个月没动。
- **修复**：acceptanceNote 回流校准集；guard 规则定期迭代；无维护闭环则第 2 月比第 1 月更差。

## 核心结论

> 闸门挡得住 CEO 的恶意，挡不住时间的漂移和变卦的需求；补"变更再验证 + 维护闭环"两块即完整。
