# 任务编排 - 指纹采集 P0

> 由 CEO 拆解，经 jarvis_taskgraph 结构闸校验通过（依赖闭环 / 验收可判 / 并行可行）。
> 需求事实源：`需求规格-指纹采集P0.md`；实现方案：`方案设计-指纹采集P0.md`。

## 任务清单

| id | 任务 | 负责人 | 依赖 | 输入槽位 | 验收标准 |
|---|---|---|---|---|---|
| FP1 | 指纹P0·DDL与种子：5表建表 + fp_profile三档 + 5条规则(enabled=0) | 研发5 | 无 | 需求规格 F1/F10/F11；完整方案 S05 数据模型；缺口修复 G05 列名 / G08 三档 / G09-G13 规则语义 | 两处 update.sql 内容一致且幂等（连跑两次不报错）；5表字段严格按 S05 全量；fp_profile=3 条；`select count(*) from fp_rule where enabled=1` 必须 = 0 |
| FP2 | FpParseService 解析层：既有文本 → 结构化(exact/family) + evidence.raw | 研发6 | 无 | 方案设计第 11 节接口契约；探测逻辑 P02 骨架；缺口修复 G01 PHP 双来源 | 单测 U1 `Version:` → exact/3.2.3；U2 CPE 拆 vendor/product/version 三件；U3 `X-Powered-By: Express` → family 且 version=null；不命中也要写 fp_evidence.raw |
| FP3 | FpMatcher + FpInfer + FpResolver：规则匹配 / implies 推断 / 去重消解 + 硬断言 | 研发9 | FP2 | FP2 产出的 ParsedItem 结构；探测逻辑 P03-P05；缺口修复 G05 / G09-G13 | 单测 U4 family+version 非空被 Resolver 拒绝写入；U5 implies 防环不死循环；U6 推断产物不带版本号；V1 = 0 |
| FP4 | 三处入库接线 + fp.enabled/fp.strength 开关 + 扫描中闸 + 异常不冒泡 | 研发7 | FP3 | FP3 的 FpOrchestrator；实施交接书 H03/H04；探测逻辑 P07/P08/P09 | RpcImpl 三处 save 点后均接线且包 `if(fp.enabled)` + try/catch；人为构造异常主流程入库仍成功；enabled=0 时 Orchestrator 第一行 return；扫描中 `fp_scan_stat(req_count=0, skipped_reason='scan_in_progress')` |
| FP5 | 指纹展示：DeviceController 返回指纹列表 + detail.jsp 端口表下指纹区块 + 新版 SPA 适配可看效果 | 研发8 | FP1 | 方案设计第 12 节 F8/F9；实施交接书 H05；现有 detail.jsp 端口表结构 | 已扫资产详情页对应端口下可见 服务名/服务版本/Web服务器/PHP版本；点开可见证据原文如 `X-Powered-By: PHP/7.4.3`；新版 SPA（iframe 承载）同样可见且分层可下钻 |
| FP6 | 验收 V1-V7 + 单测 U1-U6 + 回归 + 从最新源码重编译出包 + 真机装机验证 | 测试2 | FP4, FP5 | 测试验收单-fp-p0.md；FP1-FP5 全部产物 | V1-V4 四条 SQL 全部 0 行/0 值；V5 真机详情页目视可见且证据可展开；V6 扫描中 req_count=0；V7 一行熔断后行为恢复；既有端口表/资产详情页无回归；升级包从最新源码编译且装机 UPGRADE-OK |

## 排期与并行

- **第 1 批（可并行）**：FP1（DDL与种子）、FP2（解析层）
- **第 2 批（可并行）**：FP3（匹配/推断/消解，依赖 FP2）、FP5（展示，依赖 FP1）
- **第 3 批**：FP4（接线，依赖 FP3）
- **第 4 批**：FP6（验收+出包+装机，依赖 FP4、FP5）

单人最大负载 1 任务：研发5:1、研发6:1、研发9:1、研发7:1、研发8:1、测试2:1

## 结构闸校验结论

- 依赖闭环：✅ 无悬空依赖、无自依赖、无循环
- 并行可行性：✅ 第 1 批 2 个任务互不依赖可并行；第 2 批 2 个任务可并行
- 验收可判：✅ 每任务验收标准均为可机械判定或可目视判定
- 上下游产出传递：✅ 下游任务均注明"输入=上游 X 的产出"

## 与需求规格的对应

| 需求 id | 承接任务 |
|---|---|
| F1 5 张指纹表 | FP1 |
| F2 解析层 | FP2 |
| F3 规则匹配 | FP3 |
| F4 传递推断 | FP3 |
| F5 去重消解 + 硬断言 | FP3 |
| F6 三处入库接线 | FP4 |
| F7 fp.enabled / fp.strength | FP4 |
| F8 后端接口 + detail.jsp | FP5 |
| F9 新版 SPA 适配 | FP5 |
| F10 fp_profile | FP1 |
| F11 出厂规则 5 条 | FP1 |
| V1-V7 验收 + 出包 | FP6 |
