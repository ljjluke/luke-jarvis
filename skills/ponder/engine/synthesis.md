## Step 3.6: Blindspot Audit + 言意 Gap

### Cultural Sub-Lens Coverage

1. Extract blindspots from diverge phase's sub-lenses
2. Check each against ranked solutions → covered/missed
3. 3+ missed → WARNING → return to converge | 1-2 → annotate in report

### 言意 (Word-Meaning) Gap Detection

**⛔ Scan for 3 specific mismatches between user statements and our interpretations:**

① **Literal vs Metaphorical**: User said X literally, but we interpreted as metaphor? Or vice versa?
   - "Make it fast" → faster delivery timeline? Or "don't make people wait"?
   - "Must be robust" → zero failure tolerance? Or "shouldn't break easily"?

② **Same words, different intent**: User and we use the same term but mean different things.
   - "Simple" → minimal steps? Easy to explain? Quick to implement?
   - "Secure" → protected? Verified? Documented?

③ **Unstated expectations**: User didn't say it, but we assumed it (or missed it).
   - Did we assume a specific methodology or toolset without confirmation?
   - Did we ignore an implicit "it should work like [familiar process]"?

**Resolution rules:**
- Same yi different yan → merge solutions (false diversity)
- Same yan different yi → keep both (fundamental disagreement, need user clarification)
- Gap affects ranking → re-simulate → mark for user confirmation

Code: yan-yi-check --statements '<JSON>' --interpretations '<JSON>'

### Blindspot Audit Framework

1. List perspectives of all solutions
2. Compare with Eight-Facet + Sub-Lens coverage → find missing dimensions
3. For each blindspot: need supplement? (based on importance / direct vs indirect impact)
4. Decision: all covered → pass | 1st place biased → supplement | 1st covers well → annotate

---

## Re-simulate Mode

---

## 结论自反 — Meta-Questioning of the Conclusion

**学术来源**: 黑格尔辩证法「正题→反题→合题→再否定」+ 胡塞尔现象学「悬置」

**为什么要这一步**: 综合阶段能找出"哪个方案最强"，但找不出"所有方案共享了哪个未被质疑的前提"。在共享前提出错时，再强的方案也是错前提下的最优解。结论自反把最终结论当成新前提再质疑一次，闭合辩证循环。

### 门控 — 先判断要不要自反

```
① 复用神思的赌注判断: 这个问题是可逆小事（取名/调参/晚饭），还是高赌注（重大决策/方向选择/不可逆决策）?
② 可逆小事 → 跳过结论自反，直接出结论。
③ 高赌注问题 → 进结论自反。
```

### 质疑账本收敛 — 汇总本管线4处质疑

```
① 收集4处质疑产出:
   - 神思前提审视: 标为 rejected/doubted 的伪前提
   - 八卦镜: 8维盲点中的 key_finding
   - 辩论: 各方案被攻击的薄弱点
   - 推演: 方案失效的条件
② 收敛到 top 3 最关键质疑（不全量罗列，避免冗长拖垮综合）。
   ⛔ 但不准凑数: 真实case里若只有1-2条会推翻结论的真质疑,就只写那1-2条,
   不要为凑满3条而塞"不影响推荐"的软质疑。配额是"最多3条",不是"必须3条"。
③ 选择标准: 一旦成立就会推翻结论的质疑优先。
```

### 结论自反 — 两问

```
① 这3个最关键质疑如何影响了最终结论?
   - 必须逐条回应，不能跳过。
   - ⛔ 须含具体修正或具体可忽略理由,不接受"已纳入考量""已通过配套解决"这类走过场话。
     判据:要么写出"该质疑把结论从X修正为Y"(具体修正),要么写出"该质疑未影响结论,因为Z具体条件"(具体可忽略理由)。
   - 若某质疑未影响结论 → 说明为什么可忽略。

② 所有幸存方案是否共享了某个未被质疑的前提?
   - ⛔ 强制产出: 必须给出至少一个共享前提，不允许回答"没有"。
   - 即使是"都假设用户会按计划执行"这种看似无害的前提也要写出。
   - 对每个共享前提说明: 为什么在当前决策中可接受 / 不可接受。
   - ⛔ reason须具体,不接受"在当前决策中可接受"一句话带过。判据:要么写"可接受,因为X具体条件",要么写"不可接受但不可避开,因为Y制度/现实约束"。
```

**兜底**: 即便自反流于形式，强制"必须给至少一个共享前提"的硬约束也保证了它不会完全空转——至少暴露一个隐性假设供用户审视。

**⛔ 不引入哲学术语**（辩证法/悬置/正题反题）。对外输出用自然语言：说"所有方案都默认了X"，不说"共享了未经悬置的前设"。

---

## 可谬标注 — Fallibilism of the Conclusion

**学术来源**: 皮尔士可谬论（任何结论都是目前最可信的解释，随时可被推翻）+ 溯因推理（从结果反推最可能原因）

**为什么要这一步**: 结论自反质疑的是"所有方案共享的前提"（横向前提层），但没碰"这个结论本身最可能错在哪"（纵向结论层）。一个结论可以前提没问题、推理也自洽，却整体是错的——因为某个关键的归因判断可能站不住。可谬标注把结论当成"目前最可信但可被推翻的判断"，强制写出它的失效点和备选，给结论留一个自我更新的出口。

### 门控 — 复用结论自反的赌注门控

```
① 复用神思赌注判断: 可逆小事 → 跳过可谬标注。
② 高赌注问题 → 必须做可谬标注（和结论自反同进同出）。
```

### 两问

```
① 本结论最可能错在哪?
   - ⛔ 必须给出一个具体的、可证伪的错点。
   - ❌ 不接受"可能不够全面""存在一定风险"这类万能废话——等于没写。
   - 找结论依赖的那个最关键判断,直接标出它: 如"本结论依赖'用户能持续投入6个月'这一判断,若该判断不成立,结论就站不住"。

② 若该错点真的发生,该改用什么?
   - 必须给一个备选方案或备选方向,不能只标错不给路。
   - 备选要具体到"转用X方案"或"转向Y方向",不是"重新评估"。
```

**与结论自反的分工**: 结论自反管"共享前提"（所有方案都默认了什么），可谬标注管"结论自身的失效点"（这个推荐最可能在哪翻车）。两者层级不同，不重复。

**⛔ 互斥约束（防与结论自反重复登记同一对象）**: 真实高赌注case里，"共享前提最弱那条"和"结论最可能错点"会自然收敛到同一个核心不确定性（如某关键假设既被所有方案默认、又是推荐方案依赖的判断）。分两段重写同一个对象是纯冗余。规则：
- 可谬标注的"最可能错点"**不得**与结论自反里"共享前提最弱那条"为同一对象。
- 若发现两者是同一对象：可谬标注只标注该前提的"未实测状态"（一句话即可），然后**必须另找一个不同对象的失效点**作为最可能错点——优先从方案执行层找（推荐方案在执行中哪个具体判断可能错），而非再从前提层找（前提层已被结论自反覆盖）。
- 这样保证两段各有信息增量：结论自反管"前提层最弱"，可谬标注管"执行层/结论层另一个可能错点"。

**与方案辩证运动的分工**: 方案辩证运动的反题是"方案在什么条件下失效"（方案层），可谬标注是"最终结论在什么判断上可能错"（结论层）。一个管方案，一个管结论。

**⛔ 不引入哲学术语**（可谬论/溯因/归因）。对外输出用自然语言：说"这个推荐最可能在X上翻车，要是X发生，改走Y"，不说"本结论存在可谬性，溯因失效时启用fallback"。

