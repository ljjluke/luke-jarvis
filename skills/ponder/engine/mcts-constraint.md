---
name: mcts-constraint
description: Ponder Step 0 — Constraint Collection + Xuanxue/Zhanbu Enhancements
---

# Phase 0: Requirement Constraint Collection

> **Path note**: Commands use node $P/scripts/mcts.js (relative). When executing, replace with node <plugin>/scripts/mcts.js <args> — <plugin> = path from [Ponder] Plugin: in SessionStart log.

> **🔒 COMPRESSION-SAFE RULES:**
> 1. OUTPUT in user's language | 2. MUST ASK when unclear | 3. DEMAND REFINEMENT before solutions
> 4. HARD vs SOFT constraints | 5. SOURCE TRACKING per constraint | 6. DECOMPOSITION CHECK before "single solution"
> 7. ROOT-BRANCH after 五診(Wuzhen) | 8. ABSENCE DETECTION per dimension | 9. RELATIONAL TENSION → diverge priority
> 10. 动静(Dong-Jing) MODE before engine

---

## 0.1 五診 (Wuzhen) Requirement Portrait

5 dimensions, each scored 0-10.

| Dim | Name | Abstract Probe | Generic Questions |
|-----|------|---------------|-------------------|
| 天 | Timing | When? Temporal context? | Stage? Deadline? Environment stability? Window closing? |
| 地 | Resources | What to work with? Limits? | People/budget/materials available? Locked-in deps? |
| 人 | People | Who affected? Acceptance? | Impacted stakeholders? Resistance? Final say? |
| 法 | Rules | What rules? Forbidden? | Regulations? Process? Structural constraints? |
| 物 | Essence | What is this REALLY about? | Core purpose? Success criteria? Deal-breakers? |

⚠️ Adapt questions to user's domain — never assume "software project".

Code: node $P/scripts/mcts_compute.js five-diagnosis --scores '<JSON>'

### Anti-Guessing Scoring Rules (MANDATORY)

Scores must be based on sources, not LLM "feelings."

| Source situation | Allowed score | Internal tag |
|-----------------|---------------|--------------|
| User explicitly stated | 0-10 | ✅ verified |
| Inferred from user words, unconfirmed | 0-6 | ⚠️ inferred |
| No user input, LLM guessing | **MUST ≤3** | ❓ speculative |
| User didn't say + code/files confirm | 0-10 | ✅ verified(code) |

Key rules:
- ❓ speculative dimension **MUST ask user** (equivalent to ≤3)
- Any dimension scoring ≥5 without ✅ verified source → violation
- Can't default unknown dimensions to 7 "seems fine"

**Principle: Rather low than high. Uncertain = low score (ask) ≠ medium score (guess).**

### Follow-up Strategy

- sufficient (≥7) → record, no follow-up
- partial (4-6) → ask 1-2 key questions
- severe (≤3) → MUST ask with guided options (AskUserQuestion)
- ⛔ 任何 ❓ speculative 维度 → 等同于 ≤3 → MUST ask
- Max 3-5 questions per round. Only ask what "only the user would know".

Cross-dimension validation (5 pairs from tension scan):
  天↔人: window vs readiness | 地↔法: resources vs governance | 物↔天: goal vs timing
  人↔物: stakeholders vs purpose | 物↔法: goal vs rules
  → Contradiction → ask user | |diff|≥4 → HOTSPOT for diverge

### Portrait Output Format


【Requirement Portrait · Wuzhen Integrated Assessment】
```text
 Task: [xxx]
 ① 天(Tian) [7/10] sufficient — Stage: ... | Time: ... | Env: ...
 ② 地(Di)   [4/10] partial ← ask — [what's missing]
 ③ 人(Ren)  [3/10] severe ← MUST ask — [what's missing]
 ④ 法(Fa)   [8/10] sufficient — [known constraints]
 ⑤ 物(Wu)   [5/10] partial ← ask — [what's missing]

 Questions: [Q1] [Q2] [Q3]
 Cross-dimension: [findings]
 Root (Ben): [dimension] | Absence: [alerts] | Tension: [hotspots]
```


Render the portrait directly as Markdown; no template CLI is available.

---

## 0.1b Xuanxue Enhancements (AFTER Wuzhen, MANDATORY)

### 本末 (Root-Branch)

After Wuzhen scores, identify root dimension (ben) — its constraints are super-hard.
Adjacent dimension violation → HARD. Peripheral → SOFT.

Code: node $P/scripts/mcts_compute.js root-branch --scores '<JSON>'

### 有无 (Absence Detection)

For each dimension, check what constraints are ABSENT that should normally be present.
Abnormal absence → mark blindspot → Info Gap phase asks about it.

Code: node $P/scripts/mcts_compute.js absence-detect --domain '<str>' --constraints '<JSON>'

### Relational Tension (六壬(Liu-Ren) Method)

Compute tension for key dimension pairs: 天↔地, 人↔物, 法↔地, 天↔人, 物↔法
Tension = |score_A - score_B|. ≥4: HOTSPOT → diverge priority. ≤1: STABLE.

Code: node $P/scripts/mcts_compute.js tension-scan --scores '<JSON>'

### 动静 (Movement-Stillness) — Engine Mode

Before engine engages, determine mode:
- Urgency markers ("紧急/ASAP") → **Dong**: simplified engine, 3-5 MCTS rounds, skip Round 3
- Depth markers ("重要/慎重/全面") → **Jing**: full engine, 8-10 rounds
- No signal → judge from complexity: 1 viable option → Dong, 3+ with uncertainty → Jing

Mode switch: if Dong mode reveals hidden complexity → upgrade to Jing.

Code: node $P/scripts/mcts_compute.js dong-jing --message '<msg>' --decision-count <N>

---

## 0.2 Technical Constraint Checklist

Checklist items: methodology, resources_external, structure, compliance, performance, safety, time_budget, legacy_constraints, stakeholder_preference.

Items with auto_detect=true → check from available materials. auto_detect=false → MUST ask user.

## 0.3 Constraint Sources (by priority)

1. User explicit → Hard Constraint
2. Code inferred → Fact Constraint
3. Industry common knowledge → Inferred (confirm with user)
4. Knowledge graph → Experience (reference, confirm)

## 0.4 Handling Missing Constraints

- Can self-confirm from code → do it, record as Fact
- Cannot self-confirm → Pause → Ask user
- User answered but incomplete → Follow-up until clear
- ⛔ "Cannot fabricate" ≠ "output empty". Correct: search public data → output with uncertainty annotation

## 0.5 Low Facet Scores

Any facet ≤3 → WebSearch + ask user. Do NOT skip or output empty template.

## 0.6 Constraint Impact

Hard constraint violated → eliminate solution. Soft → lower match score M.

## 0.7 Constraint Changes During Simulation

1. Add new constraint. 2. Evaluate existing solutions. 3. All violate hard → return to Diverge.

---

## Constraint Output Format


【Requirement Constraint List】
```text
 Task: [xxx]
 Hard: [✓/✗] constraint (source)
 Soft: [ ] constraint (source, unconfirmed)
 Sources: User=N, Code=N, Inferred=N
```


Render the constraint list directly as Markdown; no template CLI is available.
