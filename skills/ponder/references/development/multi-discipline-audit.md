## 多学科接入审计 — 道家·哲学·心理学·记忆科学四维诊断 (Multi-Discipline Audit)

> 2026-07-10 基于全库扫描(grep 23个engine文档+8个prompt+SKILL.md+scripts)的学科接入深度审计。本次审计坐实了四层隔断结构——某些学科的操作码真接入(L3)，但核心方法论被锁在代码层和文档层(L1)，LLM 推理时不可见。

**学术来源**: 本次审计本身是对"框架知道自己用什么学科知识"的元层检察——对标库恩范式转换(审视框架自己的范式前提不盲信) + 弗拉维尔元认知(对框架自身认知结构的认知)。

---

### 审计方法

对四个学科维度(道家思想/哲学思想/心理学思想/思维学记忆科学)的每个核心概念，按三维深度评级：

- **L3(代码真接入)**: 概念名/方法论直接出现在 prompt 模板中，LLM 运行时真读到并执行
- **L2(文档建了但 prompt 没引用)**: 有 engine 文档写了概念和方法，SKILL.md 引了文档名，但没有任何 prompt 结构化引用 engine 文件
- **L1(纯文档/代码层)**: 只在 engine 文档或脚本代码中存在，prompt 和 SKILL.md 都不可见
- **L0(完全缺位)**: 概念在学科中是核心，但框架中完全无对应机制

---

## 一、道家思想

| 概念 | 深度 | 所在位置 | 判定 |
|------|------|---------|------|
| **虚静** | L3 | shensi.json 神思六步法第1步 ("虚静: 放下问题本身") | LLM 每次神思都读到并执行 |
| **无为(顺其自然)** | L3 | divergence.json 发散六视之⑤ ("顺其自然: 如果不干预会怎样") | LLM 每次发散都读到 |
| **无我** | L3 | divergence.json 发散六视之⑥ ("无我视角: 抛开个人立场") | LLM 每次发散都读到 |
| **朝菌/冥灵(庄子时间观)** | L2 | 发散六视③④ "时间压缩/时间扩展" 是庄子《逍遥游》的结构化落地 | prompt 说"时间压缩"不标庄子，LLM 不知此为道家时间观 |
| **八卦/八纲辨证** | L3 | bagua.json 八维度 agent 并行 | 操作码真接入 |
| **为道日损** | L1 | engine/error-pattern.md 完整理论 + evolve.js prune() 代码实现 + weights.js _learning_rate | prompt 0 引用。LLM 推理时不知道自己"该删不该只加" |
| **反者道之动** | L1 | engine/error-pattern.md 饱和反转预警 + evolve.js prune() 权重阈值检查 | prompt 0 引用。LLM 不知道"过度强化该反转校验" |
| **坐忘** | L1 | engine/error-pattern.md "连续失败→弃当前策略栈从零重判" + evolve.js prune() 逃逸阀 | prompt 0 引用。LLM 不知道"卡住时该坐忘而非硬调参" |
| **涤除玄览** | L1 | engine/error-pattern.md "清空当前策略的逃逸阀" 段引 | prompt 0 引用，代码未实现玄览(观察前清偏见的正操作) |

**道家诊断**: 操作码(虚静/无为/无我/八卦)真接入——但这些是**步骤名和视角名**，不是道家核心方法论。道家的核心方法论是**日损(学习不是加法)/反者道之动(物极必反)/坐忘(清空重来)/涤除玄览(观察前清偏见)**——这四者全锁在 L1 层，LLM 推理时不用道家方法论指导自己的思维过程。框架像是一个练了太极拳招式但不知"以柔克刚、后发制人"原理的人。

---

## 二、哲学思想

### 十大家族范式接入矩阵

| 范式 | 深度 | Prompt引用位置 | engine文档 | 判定 |
|------|------|-------------|-----------|------|
| **溯因可谬(皮尔斯)** | L3 | simulate.json abduction字段 + synthesis.json fallibilism字段 | (内联在prompt中) | 真接入，皮尔斯溯因+可谬论双落地 |
| **辩证运动(黑格尔)** | L3 | plans.json 正题→反题→合题 + converge/debate/synthesis 立场演化 | working-stance.md | 真接入，贯穿方案/收敛/辩论/综合四步 |
| **目的论(亚里士多德)** | L3 | plans.json 终态画像反向链 | teleology.md | 真接入 |
| **他者性(列维纳斯)** | L3 | synthesis.json otherness字段 | otherness.md | 真接入 |
| **语言放假(维特根斯坦)** | L3 | shensi.json 问题消解段 + dissolve-frame.md | dissolve-frame.md | 真接入 |
| **先验自检(胡塞尔悬搁)** | L3 | simulate.json 先验自检段 + transcendental-audit.md | transcendental-audit.md | 真接入 |
| **工作立场(皮尔斯+米德+杜威)** | L3 | converge.json/debate.json/synthesis.json stance字段 | working-stance.md | 真接入 |
| **苏格拉底无知** | L2 | SKILL.md 有引用 "方法见 engine/socratic-ignorance.md" + shensi.json 读 {{domainDimensions}} | socratic-ignorance.md | L3 偏 L2——无知自检的**执行指令**在 SKILL.md 不在 prompt，LLM 靠主线程读到但 prompt 没内联 |
| **杜威探究逻辑** | L2 | working-stance.md 引了杜威，prompt 不标"杜威"标签 | working-stance.md | 半接入——学术底座存在但 LLM 不知道自己用的是杜威 |
| **卢曼二阶观察** | L3 | synthesis.json otherness字段实质=二阶观察(观察观察者的视角) | otherness.md | 真接入 |
| **胡塞尔悬搁** | L3 | simulate.json 先验自检=悬搁评分工具 | transcendental-audit.md | 真接入 |

### 哲学非家族概念

| 概念 | 深度 | 位置 | 判定 |
|------|------|------|------|
| **波普尔可证伪** | L3 | simulate.json "须具体可被证伪" + synthesis.json "须具体可证伪" + error-pattern.md 学习信号价值分级 | 真接入，硬约束 |
| **库恩范式转换** | L2→L1 | dissolve-frame.md 问题消解实质=范式转换，但 prompt 0 引用库恩/paradigm | 理论底座在文档，LLM 不知道 |
| **米德主我客我** | L1 | working-stance.md 引了米德 "self 作为过程"，prompt 0 引用 | 停在文档层 |
| **福柯问题化** | L2 | dissolve-frame.md 引用福柯，prompt 不标福柯标签 | LLM 不知道用的是福柯 |

**哲学诊断**: 十大家族范式中 8/11 达到 L3，苏格拉底无知、杜威探究逻辑、库恩范式转换停在 L2。哲学是四个维度中接入最深最扎实的——但存在"LLM 不知道自己用的是什么哲学"的能知缺失(用了皮尔斯溯因但以为自己在"归因")。

---

## 三、心理学思想

| 概念 | 深度 | 位置 | 判定 |
|------|------|------|------|
| **前景理论(卡尼曼)** | L3 | shensi.json 损失态度自检 (v1.18.42补) | 真接入 |
| **偏好结构(时间贴现+调节聚焦)** | L3 | synthesis.json preference字段 (v1.18.42补) | 真接入 |
| **反事实思维(卡尼曼+罗斯)** | L2 | counterfactual-thinking.md 完整理论 + SKILL.md 说辩论反向思维段升级→但 debate.json **prompt 0 引用** counterfactual-thinking.md | 有文档有升级声明但 prompt 漏引 |
| **认知偏误(卡尼曼+特沃斯基)** | L3 | shensi.json 前提审视段列6种偏误(沉没成本/确认偏误/锚定/框架效应/可得性/幸存者) | 真接入 |
| **贝特森学习层级** | L1 | engine/error-pattern.md 完整理论 + evolve.js classifyErrorPattern() 用了 L2 概念 | prompt 0 引用。LLM 不知道自己处于 L0→L2 升级 |
| **弗拉维尔元认知** | L1 | engine/error-pattern.md 完整理论 + evolve.js 学习信号价值分级 | prompt 0 引用。LLM 不知道"自评−实测差"怎么算 |
| **邓宁-克鲁格效应** | L1 | engine/error-pattern.md + evolve.js "自评高却错=高价值学习样本" | prompt 0 引用 |
| **库伯学习循环** | L1 | engine/error-pattern.md 补反思观察段 | prompt 0 引用 |
| **维果茨基ZPD** | L1 | engine/error-pattern.md "远超能力越界失败不学" | prompt 0 引用 |

**心理学诊断**: 这个维度有最严重的**隔断**——框架的"自我纠错层"(evolve.js)在用贝特森/弗拉维尔/邓宁克鲁格/库伯的理论，但 LLM 推理时(prompt)完全感知不到。框架像一个有潜意识(后台学心理学)但不自知(前台推理不用心理学)的人。v1.18.42 补的前景理论+偏好结构修复了用户端的心理感知，但没修复框架的自知心理——框架仍然不知道"我该怎么学"。

---

## 四、思维学/记忆科学

| 概念 | 深度 | 位置 | 判定 |
|------|------|------|------|
| **贝特森学习层级(也属心理学)** | L1 | error-pattern.md 文档 + evolve.js 代码 | prompt 0 引用 |
| **库伯学习循环(也属心理学)** | L1 | error-pattern.md 文档 | prompt 0 引用 |
| **记忆巩固(睡眠依赖)** | L1 | error-pattern.md "离线巩固阶段" | 文档写了"跑完一批 run 后触发"，**代码未实现**，prompt 0 引用 |
| **再巩固(reconsolidation)** | L1 | error-pattern.md 再巩固段 | 同上，只文档无代码无 prompt |
| **测试效应(testing effect)** | L0 | error-pattern.md 提了一句"提取动作本身才巩固"，但当前召回是自动注入的，**LLM 不做提取练习** | 关键记忆科学发现，机制缺位 |
| **间隔效应(spacing effect)** | L0 | 框架完全无此概念 | Ebbinghaus 遗忘曲线基础发现，完全缺位 |
| **生成效应(generation effect)** | L0 | 框架完全无此概念 | 自己生成比被动接收记得好——当前 LLM 是被动收历史 |

**记忆科学诊断**: 四个维度中最薄弱的。error-pattern.md 写了理论骨架但**代码未落地**(离线巩固 cron 未建/再巩固无实现/测试效应无机制/间隔效应无概念)。error-pattern.md 文档里写了"不做的事:不新建离线巩固的 cron 任务(需真实数据量积累)"——这是诚实的，但说明记忆科学在当前框架中处于胚胎状态。

---

## 五、四层隔断结构（根因诊断）

```
L3 操作码层（道家操作码+哲学家族范式）
  道家: 虚静/无为/无我/朝菌冥灵/八卦 (5个)
  哲学: 溯因可谬/辩证/目的论/他者性/语言放假/先验自检/工作立场/二阶观察/悬搁/可证伪 (10个)
  心理学: 前景理论/偏好结构/认知偏误 (3个)
  记忆科学: 无
  → LLM每次推理都读到，是框架的"有意识思维"
    ↑ 
    ║ 隔断1: "苏格拉底无知/杜威/库恩"有文档但prompt漏引
    ║
L2 半接入层（有文档有SKILL.md引用但prompt漏引engine文件）
  苏格拉底无知、杜威探究逻辑、库恩范式转换、反事实思维、mcts-simulate、td-learner
  → LLM通过SKILL.md知道概念名但读不到完整方法论
    ↑
    ║ 隔断2: "心理学/道家方法论"在代码层干活但不告诉LLM
    ║
L1 文档代码层（只在文档或脚本中存在，prompt和SKILL.md都不可见）
  道家: 为道日损/反者道之动/坐忘/涤除玄览 (4个)
  心理学: 贝特森学习层级/弗拉维尔元认知/邓宁克鲁格/库伯学习循环/维果茨基ZPD (5个)
  记忆科学: 记忆巩固/再巩固/测试效应/间隔效应/生成效应 (5个)
  → evolve.js在后台用这些理论，但LLM不知情。框架的"自知"被锁在代码层
    ↑
    ║ 隔断3: "记忆科学"只有文档胚胎无代码实现
    ║
L0 缺位层（学科核心概念但框架无对应机制）
  测试效应(LLM不做提取练习)/间隔效应(无间隔重复)/生成效应(被动收历史)
  → 记忆科学三大基础发现完全缺位
```

**四层隔断的根因**: 框架的学科知识是按照"加新 engine 文档 → 写入方法论 → 决定是否接入 prompt"的路径走的。那些决定"不接入 prompt"的文档（因为要等数据积累/怕过载/遵循 feature-validation-rule）自然掉到了 L2/L1。这不是设计缺陷，是诚实的生长过程——但积累到 23 个 engine 文档时，隔断总量已经大到值得一次系统性修整。

---

## 六、修复计划

按"修复隔断量 vs 改动风险"排优先级：

### Phase A: L2→L3 补齐（低风险，5个文档各加一行引用即可）

| 文档 | 应在哪个prompt引用 | 改动量 |
|------|------------------|--------|
| counterfactual-thinking.md | debate.json prompt 反向思维段加 "方法见 engine/counterfactual-thinking.md" | 1行 |
| socratic-ignorance.md | shensi.json prompt 或 SKILL.md 神思段加 engine 引用 | 内联已有 {{domainDimensions}}，只需在 prompt 加 engine 文件引用 |
| mcts-simulate.md | 推演段当前无 prompt 文件，不改 | 不适用 |
| td-learner.md | 当前只被内部代码引用，不改 | 不适用 |

### Phase B: L1→L3 道家核心方法论（中等风险，需小心措辞避免过载）

将道家核心方法论以**内部自检指令**形式嵌入神思/综合 prompt，不占步骤不增新字段：
- **为道日损**: 神思前提审视段加一句 "内部自检:当前判断中是否有应舍弃的旧假设/旧偏好被误当约束保留？（为道日损——真正重要的不是加更多分析而是删掉多余的前提）"
- **反者道之动**: 综合结论自反段加一句 "内部自检:当前倾向是否在不断强化中接近过拟合？若已是第三次以类似理由倾向同一方向则触发反向校验"
- **坐忘**: converge 淘汰段加一句 "内部自检:连续淘汰理由高度相似时，考虑完全放弃当前策略方向重判而非继续在相同逻辑上淘汰——有时候最好的判断是承认自己需要重新开始"

### Phase C: L1→L3 心理学自知（低风险，加在 converge 工作立场段）

在 converge 工作立场段后加一句元认知自检：
"内部自检(元认知):我对本步淘汰判断的置信度有多高？依据是什么？若依据弱而置信高=危险的元认知偏差(邓宁克鲁格)——此时应降低置信度并标注依据薄弱点。"

### Phase D: L0 内存科学 暂缓

遵循 error-pattern.md 自身的不做列表——"不新建离线巩固的 cron 任务（需真实数据量积累）"。记忆科学机制当前保持胚胎状态，等数据量上去再说。

### 不做的事（为道日损）

- **不改 mcts-simulate.md 和 td-learner.md**：前者是推演子agent读的内部文件不对外，后者是MCTS引擎核心代码不面向用户
- **不新建引擎文档**：审计已经23个了，不再加，用现有文档的补引用修隔断
- **不加新步骤/新字段**：所有修复都是现有prompt段内加一句内部自检，不改变管线的结构和产出schema
- **不改 evolve.js**：代码层的心理学已经实现(classifyErrorPattern + prune)，这次只修"LLM不知道"的隔断

### 验证锚点

修复后，道家核心方法论在 prompt 中的引用从 0 升到 ≥3（神思1+综合1+收敛1），心理学理论从 0 升到 ≥2（error-pattern引用+元认知自检），L2 文档 0 引用修复 ≥2 个。总改动不超过 15 行 prompt。

---

## 七、一句话总结

**框架的哲学操作码真接入(10个L3)，道家操作码真接入(5个L3)，但道家方法论(4个L1)、心理学自知(5个L1)、记忆科学核心(5个L0)被隔断在LLM的认知边界之外——框架是一个哲学功底扎实、道家招式到位、但不知道自己怎么学习的人。这次修复让框架开始有"自知"。**
