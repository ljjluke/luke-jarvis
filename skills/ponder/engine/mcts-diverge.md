---
name: mcts-diverge
description: Ponder Step 1 — 逍遥游 Free Wandering Diverge Engine. Zhuangzi-inspired multi-perspective divergence + Eight-Facet Mirror × 诸子百家 sub-lenses → Cluster/Complete/Cull/Crystallize.
---

# Phase 1: Diverge Engine — 逍遥游 (Free Wandering) × 齐物 (Equalizing) × 庖丁解牛

> **Path note**: Commands use node $P/scripts/mcts.js (relative). When executing, use node <plugin>/scripts/mcts.js <args> — <plugin> = path from SessionStart [Ponder] Plugin:.

> **🔒 COMPRESSION-SAFE RULES:**
> 1. OUTPUT in user language | 2. Phase order: 心斋→逍遥游→八卦镜→齐物→庖丁解牛→Info Gap→方案收敛
> 3. NO SKIP / NO COLLAPSE | 4. Every perspective shift MUST be visible | 5. Domain-agnostic
> 6. ANTI-SINGLE: decomposition-guard before claiming "only one solution"
> 7. DIVERSITY: if <3 solutions → diversity-challenge

---

## 🌐 Translation — Say It in Their Language

**Internal:** Chinese philosophical names (心斋, 逍遥游, 齐物, etc.) describe thinking methods. Use them to think.

**Output:** Whatever language and domain the user is speaking — speak that. No translation table needed. The user's own words tell you what domain they're in.

⛔ Forbidden:
- Output raw Chinese concept names as if they're English words
- Add technical footnotes or parenthetical explanations |

---

## Why Conventional Brainstorming Fails

Conventional brainstorming generates ideas **within the same cognitive framework**. You can list 100 options without a single genuine frame-break.

Zhuangzi (369-286 BCE) offers a fundamentally different model in 逍遥游 (Free Wandering):

> "In the Northern Ocean there is a fish called Kun. It is so huge no one knows how many thousand li across. It transforms into a bird called Peng. Its back is so vast no one knows how many thousand li wide. When it rouses and flies, its wings are like clouds hanging from the sky."

Kun — deep-sea giant fish — transforms into Peng — a bird soaring 90,000 li high. Complete form-transformation, scale-shift, perspective revolution.

**Core insight**: A frog at the bottom of a well cannot imagine the ocean. A summer insect cannot conceive of ice. Not because they lack effort — because **they never changed their observation position**.

### Academic Foundation

| Paper | Core Finding |
|-------|-------------|
| **Lai (2021)** "Freedom and Agency in the Zhuangzi" — *BJHP* | Freedom = working with constraints via cognitive flexibility, not escaping them |
| **Liu Xiaogan (2015)** "Zhuangzi's Philosophy" — *Springer* | 齐物 + 不知 = cognitive tools to ascend from mundane to spiritual freedom |
| **Malaie et al. (2024)** "Divergent and Convergent Creativity Are Different Kinds of Foraging" — *Psych Science* | Divergent thinking = dispersed spatial exploration — more dispersion = more creativity |
| **Dietrich (2024)** "Where in the Brain is Creativity?" — *Frontiers* | Creativity is distributed, not monolithic — frame-breaking = switching exploration modes |
| **Deckert & Scherer (2017)** "The Dao of Innovation" — *Kindai* | Creativity cannot be forced — mind must "wander and spontaneously discover" |

---

## Phase 0: 心斋 (Fasting of the Mind)

**⛔ Most critical step. Skip it = all subsequent divergence stays within old framework. 心斋-less divergence is fake divergence.**

Zhuangzi's "Fasting of the Mind":
> "Make your will one. Don't listen with your ears, listen with your mind. Don't listen with your mind, listen with your qi. The ear stops at hearing. The mind stops at matching. But qi is empty and waits for things. The Way gathers in emptiness alone. Emptiness is the fasting of the mind."

Translated into cognitive operations:


【心斋 · Expose Assumptions】

Output each item — MUST be visible to user:

① What do I take for granted about this task?
   → List at least 3 unchecked assumptions
   → E.g. "I assume X is the standard solution" / "I assume budget is limited"

② Where do these assumptions come from?
   → Past experience? Industry convention? Analogous cases?
   → Are these sources still valid for THIS scenario?

③ What if ALL my assumptions are wrong?
   → What if the opposite is true? What if cost doesn't matter?
   → At least 3 counter-hypotheses

④ 坐忘 (Sitting-forget): Temporarily suspend all known solutions and "best practices"
   → Declare: "I don't know the answer yet. I'm a blank slate."
   → This isn't ignorance — it's 不知 (epistemic humility)


**After output, user sees your assumption list. User can correct: "No, budget isn't the issue — time is."**

---

## Phase 0.5: Attention Gate — Selective Focus (Thalamic Gating)

**Core insight from neuroscience (Halassa et al., 2024 Nature Neuroscience):** The prefrontal cortex relies on the thalamus (not sensory cortices) to modulate selective attention. The thalamic reticular nucleus (TRN) suppresses ~99% of incoming information — the brain does NOT process everything equally. It gates, selects, and prioritizes.

**Apply here:** After exposing assumptions but BEFORE diverging into 6 perspectives, calculate which dimensions will yield the highest INFORMATION GAIN.


【Attention Gate · Selective Focus】

① List all dimensions from constraints (五诊: 天/地/人/法/物) + any domain-specific facets.
   → For each: current score (0-10, lower = less known) + criticality (0-1, how important)

② Compute attention priority:
   node $P/scripts/mcts.js compute attention-gate --dimensions '<JSON>'
   → Returns ranked dimensions by priority = uncertainty × criticality + entropy_bonus

③ Select TOP 2-3 dimensions to focus on (highest priority).
   → These get full depth during 逍遥游 divergence.
   → Remaining dimensions get 1 insight minimum, not full depth.

④ Output:
   ┌─ Focus: [dimension A] (priority: X) — high uncertainty, high criticality
   ├─ Focus: [dimension B] (priority: Y) — moderate uncertainty, high criticality
   └─ Background: [dimension C, D...] — well understood, low priority

⛔ This is NOT "skip the easy ones." This is "allocate cognitive resources
   where they yield the most new information."


---



## Phase 0.7: 神思 — 先虚静, 后天游

**学术来源**: 《文心雕龙·神思》刘勰 + 《庄子·逍遥游》

### 核心框架

```
虚静(清空) → 神凝(凝聚) → 神游(漫游) → 意象(浮现) → 言意(带回)
```

这不是"想几个疯狂点子"。这是让精神先进入特定状态, 再让东西自然浮出来。

---

### 第一步: 虚静 — The Fasting of the Mind

**⛔ 不先虚静, 后面的所有发散都在旧框架内。跳过=假发散。**

刘勰: "陶钧文思, 贵在虚静, 疏瀹五藏, 澡雪精神"
庄子: "若一志, 无听之以耳而听之以心, 无听之以心而听之以气"

操作:
```
① 把当前问题放在一边。不看输入, 不想方案, 不考虑约束。
② 注意力转向呼吸或一个中性物(比如墙上的一个点、窗外的声音)。
③ 持续3-5个"呼吸周期"(在文本中就是3-5个自然的语句周期)。
④ 当感觉思维不再"用力抓取"时——进入下一步。

⛔ 虚静不是"放空大脑"——是"停止用力"。
```

### 第二步: 神凝 — Gather the Spirit

庄子说的"用志不分, 乃凝于神"——不分散注意力, 精神自然凝聚。

```
① 虚静之后, 不直接想问题。
② 只取问题中最核心的一个意象/一个词/一个矛盾点。
③ 盯着它, 不分析, 不想解决方案。
④ 让这个意象像涟漪一样自然扩散——它会自己带出关联。
```

### 第三步: 神游 — Spirited Wandering

**这是真正的"逍遥游"——不是6个固定视角, 是精神的无目的漫游。**

刘勰: "寂然凝虑, 思接千载; 悄焉动容, 视通万里"

```
① 从第二步的涟漪中, 让精神自然漫游:
   - 不要指定方向, 不预设"要看什么"
   - 一个联想带到另一个联想, 允许跳跃
   - 如果漫游到跟问题毫不相干的地方→那是好事
② 不评判:"这个关联有用吗?" 你现在不需要有用。
③ 持续漫游, 直到某个"有意思"的东西自动浮现。
```

### 第四步: 意象 — Images Emerge

庄子: "轮扁不能语斤" — 真正的精髓很难用语言说清楚, 但可以通过意象传达。

```
① 第三步中浮现的东西——它不一定是一个"方案"或"观点"。
② 它可能是一个画面、一种氛围、一个类比、一个印象。
③ 把它写下来, 不需要解释它"为什么"出现。
④ 现在, 看这个意象——如果它是一幅画, 画里有什么?
```

### 第五步: 言意 — Bring Back to the Problem

庄子: "得意而忘言" — 领会了意思就忘掉语言。反过来: 用语言把领会到的东西引出来。

```
① 从第四步的意象中, 找到和当前问题之间的连接点。
② 不需要牵强附会——如果有, 就是有。如果没有, 意象本身也丰富了你的视角。
③ 问自己:
   - 这个意象告诉了我什么之前没注意到的?
   - 如果这个意象是问题的答案, 答案是什么?
```

---

**退出条件**: 不是"五步全走完", 是"有东西浮现了"。如果三步就有东西, 就停。如果六步还没有, 继续。

**⛔ 关键规则 — 得鱼忘筌**: 神思产出的东西, 不带任何框架标签。不写"神思成果"、"虚静阶段产出"、"意象浮现"。直接说内容本身。用户不需要知道这些步骤的存在。

## Phase 1: 逍遥游 — 六视 (Six Perspectives)

神思负责"打破框架", 六视负责"不遗漏视角"。两者都要做, 目的不同。

**六视 — 每次彻底改变观察者的身份、尺度和时空位置**:

Like:
- Human seeing Earth vs Alien seeing Earth
- Physicist seeing light vs Poet seeing light vs Photographer seeing light
- Kun (deep sea) seeing world vs Peng (90k li high) seeing world vs Tiaojiu (branch-level) seeing world

**Six perspective shifts — each MUST be output independently:**


【逍遥游 · Six Perspectives】

Not "analyze from 6 angles."
But "BECOME 6 different beings — each redefines what the 'problem' even is."

视① 鲲鹏之视 [Cosmic Scale · 90,000 li high]

  Identity: Peng bird, wings like clouds, soaring 90,000 li
  View: From cosmic scale — see the whole system, see boundaries, see where this "problem" sits
  ⛔ MUST output:
  - System insight: [3-5 global patterns from macro view]
  - Problem redefinition: [What IS this problem when seen from cosmic scale? May be completely different]
  - Beyond boundary: [What lies outside this problem's boundary?]

视② 蜩鸠之视 [Ground Scale · Branch level]

  Identity: Cicada and dove, flying between elm branches
  View: Daily tangible experience — touchable details, concrete reality unfiltered by "big picture"
  ⛔ MUST output:
  - Micro insight: [3-5 concrete details macro perspective misses]
  - Pain points: [What friction if each detail is unresolved]

视③ 朝菌之视 [Time-Compressed · Morning mushroom]

  Identity: Morning mushroom, lives one day, knows nothing of the month
  View: Extreme short time scale — what changes instantly, what matters right now
  ⛔ MUST output:
  - Immediate action: [If only 1 day, what MUST be done]
  - Droppable: [What seems important but is irrelevant at this scale]

视④ 冥灵之视 [Time-Expanded · 500 years a season]

  Identity: Mingling tree, 500 years = one spring, 500 years = one autumn
  View: Geological time — ignores short-term fluctuation, sees only fundamental shifts
  ⛔ MUST output:
  - Eternal: [What never changes — what to bet on long term]
  - Cascades: [10/50/100 year consequence chains]

视⑤ 列子御风 [Flow State · Riding the wind]

  Identity: Liezi, riding the wind, effortless, following the current
  View: Complete relaxation — let answers emerge naturally, don't "force think"
  ⛔ MUST output:
  - Natural drift: [Where does it go with ZERO intervention]
  - Minimal force: [Smallest, most natural action — could doing nothing be best?]

视⑥ 至人无己 [Selfless · No self, no merit, no fame]

  Identity: Perfect person — no self, no striving, no identity
  View: Completely remove "I" — my stake, my position, my ego
  ⛔ MUST output:
  - Occluded: [What interests/voices are hidden by MY perspective]
  - System-optimal: [If I had zero self-interest, what's the optimal solution]


**⛔ All six perspectives must complete before entering 八卦镜. 六视 = change your eyes. 八卦镜 = examine with new eyes.**

---

## Phase 2: 八卦镜 (Bagua Mirror) — Eight-Facet Examination × 诸子百家 × Cultural Analogy

**⛔ You now have 6 new eyes from Phase 1. Use them to examine the 八卦镜.**

### Round 1: F1→F8 In-Depth per Facet

**Each facet MUST output complete structure. No one-liners.**


┌─────────────────────────────────────────────┐
│ F? ☰/☷/☳/☴/☵/☲/☶/☱ [Name] — [Domain dimension] │
│                                             │
│ 体(Ti): [Universal essence — what this facet IS] │
│ 用(Yong): [Specific manifestation — what it means HERE]│
│                                             │
│ Six-View Cross: [Which perspective from Phase 1 changed this score?] │
│                                             │
│ Sub-lens① [School A] + reasoning (≥3 sentences):  │
│   → Insight: [...]                              │
│ Sub-lens② [School B] + reasoning (≥3 sentences):  │
│   → Insight: [...]                              │
│                                             │
│ Cultural analogy (MUST jump out of domain frame):  │
│   Analogy: [concrete cross-domain example]    │
│   → Lesson: [what the analogy reveals]        │
│                                             │
│ Known: [3-5 facts already established]        │
│ Blindspot: [2-3 uncertain/missing info items] │
│ Ideas: [2-4 directions from this analysis]    │
│ Score: [0-10] — [pre/post 六视 change]        │
└─────────────────────────────────────────────┘


**Facet assignment:**

| Facet | Name | Core Question | 体(Ti) | Sub-lens① | Sub-lens② |
|-------|------|--------------|--------|-----------|-----------|
| F1 ☰ | 乾 Force | Where does drive come from? Is it created or borrowed? | EXTERNAL IMPETUS | 兵家: Competition/advantage | 縱横家: Interest alignment |
| F2 ☷ | 坤 Foundation | What foundation supports this? What soil suits what? | BASE CAPACITY | 農家: Suitability | 水利家: Resource flow |
| F3 ☳ | 震 Change | Where might unexpected change occur? What latent issues? | UNCERTAINTY | 醫家: Symptom vs cause | 陰陽家: Opposite forces |
| F4 ☴ | 巽 Penetration | How does effect spread and permeate? Where's the joint gap? | PROPAGATION | 工匠: Cook Ding's method | 禪家: Strip to essence |
| F5 ☵ | 坎 Risk | Deepest pit? Is non-intervention better? | VULNERABILITY | 史家: Historical precedent | 道家: Anti-intervention |
| F6 ☲ | 离 Visible | What supports the surface? Who's overlooked? | DEPENDENCY STRUCTURE | 工匠: Hidden structure | 儒家: Human values |
| F7 ☶ | 艮 Boundary | Line never to cross? Is stopping protection or limitation? | CONSTRAINT BOUNDARY | 法家: Rules/enforcement | 道家: Knowing when to stop |
| F8 ☱ | 兑 Convergence | How to balance interests? Can interests be redistributed? | STAKEHOLDER EQUILIBRIUM | 儒家: Moral baseline | 縱横家: Alliance building |

### Round 2: Cross-Association — Dimension Pair Interaction

Minimum 3 pairs. Each pair MUST include hexagram interaction (hexagram-lookup) + 理事(Li-Shi) separation + synergy/conflict analysis.

### Round 3: Changing Condition Analysis

For each pair: identify stable factors vs changing factors → second-order effect projection.

### Round 4: Blindspot Completion

For facets scoring <7: ① knowledge graph → ② WebSearch (≤3 score MUST search) → ③ ask user.

### Round 5: Divergence Self-Check

5 questions, answer each:
① Any facet that produced zero ideas?
② Any idea dismissed too early?
③ Any unstated assumptions? (list ≥3)
④ Do 8 facets form a complete picture? What's missing?
⑤ Did we truly jump domain? (≥2 cross-domain analogy examples)

---

## Phase 3: 齐物 (Equalizing All Things)

**⛔ Must pass through 齐物 before entering convergence.**

Zhuangzi's 齐物论: All perspectives have equal validity. None is "correct."


【齐物 · Equalize】

For each perspective (六视 + 八卦 + sub-lens + cultural analogy):

① What unique insight does this perspective reveal that others cannot see?
② If you ONLY see from this perspective, what do you miss?
③ What is the common ground between this perspective and the one you most disagree with?

Then answer:
→ Which perspectives make me most uncomfortable? (discomfort = blindspot contact)
→ What if the most uncomfortable perspective is the correct one?

### Falsification Gate — ⛔ MANDATORY

如果齐物中**没有发现任何与初始五診预测矛盾的视角** → 说明发散不够深，仍在框架内。

三条强制检验:
```
① 有没有视角的结论直接与初始评分矛盾?
   → 如果没有 → 强行构造一个"反向视角"
   例如: "如果'天=8(时间宽裕)'完全是错的, 实际时间紧迫, 会怎样?"

② 有没有发现用户没说过但可能推翻需求的事情?
   → 如果没有 → 说明还在顺着用户思路

③ 如果"最舒服的视角"反而是错的, "最不舒服的视角"才是对的?
   → 如果结果不变 → 说明这个不舒服不够不舒服
```

**⛔ 三条全否 → 不能进入收敛 → 回到六视补一个逆反视角重新发散**
**⛔ 至少通过一条 → 才能进入收敛**

## Phase 4: 庄周梦蝶 — Ultimate Flip

> "Once Zhuang Zhou dreamt he was a butterfly, fluttering about, enjoying itself. He did not know he was Zhou. Suddenly he awoke, and there he was, solid Zhuang Zhou. He did not know whether he was Zhou dreaming he was a butterfly, or a butterfly dreaming he was Zhou."


【梦蝶 Flip】

① Subject-Object Swap:
   "If I AM the problem itself, how would I describe the solution?"
   "If constraints are the main character and goals are background, what happens?"

② Success-Failure Swap:
   "If 'failure' is the actual goal, what do we learn?"
   "If the 'best solution' leads to disaster, what is that disaster?"

③ Time-Order Swap:
   "Looking back from the end, which steps can be skipped?"
   "If the outcome is already determined, do the 'choices' along the way matter?"


---

## Phase 1.5: Info Gap Supplement — User Alignment

After divergence, gaps become visible. Now ask — not before.

**⛔ Minimum 1 AskUserQuestion. Typical 2-3 rounds.**

Output: 【Info Gap Round N】 Asked→Answered | Updated scores | Remaining gaps

---

## Step 2: Reconnaissance Report

Per-facet findings + cross-validation (理事 Li-Shi separation) + explicit assumptions (Confirmed/Unconfirmed).

---

## Phase Two: Converge — Extract Solutions

**① Cluster**: Group idea fragments into directions. 一多(One-Many): 1 core identity + 2-4 mechanisms per cluster.
**② Ti-Yong Dedup**: Same-体 different-用 → merge. Different-体 same-用 → keep.
**③ Cull**: P0~P4 five-level criteria. Unlimited during divergence, ≤10 after convergence.
**④ Crystallize**: Complete solution + Bagua Auditable Scorecard (8 facets scored 1-10).

Output: solution list + coverage matrix (F1-F8 × solutions).

---

## Helper Tools

- Domain hint: identify-domain | Facet loading: get-dimensions
- Blindspot classification: classify-blindspot --score <0-10>
- Ti-Yong check: ti-yong-check | One-Many check: one-many-check
- Cull: node $P/scripts/mcts_compute.js cull --criteria

---

## 🔁 Self-Evolution Loop

The skill learns from every decision cycle. Three feedback loops:


① Divergence → Memory:
   Divergence insights (心斋/六视/八卦镜 findings) → semantic knowledge
   No runtime CLI; preserve divergence in the active reasoning context.

② Five-Element Propagation:
   Tonify/drain one point → propagate through generating/controlling chain
   Auto-link promotes/inhibits between knowledge points
   No runtime CLI; perform interaction through the active skill flow.

③ Knowledge Audit:
   Periodic check: completeness / contradiction / staleness / five-element balance
   No runtime CLI; audit context through the active skill flow.


### Five Element Interactions

| Relationship | Logic | Effect |
|-------------|-------|--------|
| Generating(相生) | wood→fire→earth→metal→water→wood | Tonify nourishes child |
| Controlling(相克) | wood→earth, fire→metal... | Drain releases controlled |
| Over-acting(相乘) | same as controlling, excessive | Strong controller overwhelms |
| Insulting(相侮) | earth→wood, metal→fire... | Strong controlled counter-attacks |

### Knowledge Health Score (mma audit)

Score 0-100 based on: completeness, contradiction count, staleness, five-element balance.
