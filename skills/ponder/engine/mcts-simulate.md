---
name: mcts-simulate
description: Ponder Step 2 — MCTS Tree Search. Multi-round iteration: Selection→Expansion→Simulation→Backpropagation + Knowledge Update.
---

# Step 2: MCTS Tree Search Simulation

> **Path note**: Commands use node $P/scripts/mcts.js (relative). When executing, use node <plugin>/scripts/mcts.js <args> — <plugin> = path from SessionStart [Ponder] Plugin:.

> **🔒 COMPRESSION-SAFE RULES:**
> 1. OUTPUT in user language | 2. 4 phases per round visible to user
> 3. Knowledge acquisition: ① Diverge handoff ② Memory ③ Web ④ Ask user ⑤ Assume (+0.1)
>    ⛔ NEVER jump to ④⑤ without exhausting ①②③. Verify: info-gap-guard
> 4. Stop when V stable 3 rounds OR max iterations | 5. Multi-layer reasoning mandatory
> 6. MUTATION VECTOR: 5-bit mask per node, volatile dimensions → higher exploration
> 7. BODY-USE COMPATIBILITY: final ranking gets 体用(Ti-Yong) Sheng-Ke bonus

---

## Multi-Layer Simulation

Each solution simulated at 3 layers:

| Layer | Question | Prior From | Output |
|-------|----------|-----------|--------|
| Feasibility | "Is this viable given conditions?" | F1/F2/F6/F7 | V_feasibility |
| Counterfactual | "If key assumptions fail?" | F3/F5 low scores | V_robustness |
| Perspective | "From different cultural lenses?" | 2-3 sub-lens findings | V_perspective |

**V_final = 0.5×V_feas + 0.3×V_robust + 0.2×V_persp**

Verify: simulate-layer-guard --state '{solutions:[...]}'

---

## Tree Data Structure (REAL — persisted to disk)

**⛔ MCTS now uses a real tree stored in ~/.claude/data/skills/ponder/memory/trees/.**
This is NOT just a thought process. Every node is a real data object with CRUD operations.

The removed tree CLI has no runtime replacement; use the active simulation agent flow.

```text
Node = { id, description, parentId, childIds[],
  n, w, V, σ²,                          // MCTS stats
  nodeType: ACTION|RISK|FALLBACK|TERMINAL,
  isTerminal, expansionPotential: HIGH|MED|LOW|NONE,
  mutation: [0,0,0,0,0],               // 5-bit: [Tian,Di,Ren,Fa,Wu] 0=stable 1=volatile
  solutionId, lastSelected, created
}
```


### MCTS Round Cycle — via Real Tree

Each round MUST use the real tree CLI. No text-simulated trees.

```text
Step ① SELECTION:
  [removed tree CLI] select <node-id> --session <sid>
  → Returns UCB-ranked children. Pick the top one.
  ⛔ `UCB` values are COMPUTED, not approximated by LLM.

Step ② EXPANSION:
  [removed tree CLI] add-children <parent-id> \
    --session <sid> \
    --children '[{"description":"...", "nodeType":"ACTION"}]'
  → Creates N real tree nodes with auto-increment IDs.

Step ③ SIMULATION:
  [removed tree CLI] simulate <leaf-id> \
    --session <sid> --v <V> --sigma2 <σ²>
  → Records V and marks leaf as terminal.

Step ④ BACKPROPAGATION:
  [removed tree CLI] backprop <leaf-id> --session <sid>
  → Walks path to ROOT, updates n/V/σ² via Welford.

Multi-round shortcut:
  [removed tree CLI] round-start --session <sid>
  → One complete round: select + (LLM adds children) + simulate + backprop
```


### Quick Reference

| Action | CLI |
|--------|-----|
| Init tree from solutions | tree init --solutions '<json>' |
| Select child (UCB-ranked) | tree select <node-id> --session <sid> |
| Add child nodes | tree add-children <node-id> --children '<json>' --session <sid> |
| Record simulation | tree simulate <leaf-id> --v <V> --session <sid> |
| Backpropagate | tree backprop <leaf-id> --session <sid> |
| Tree status | tree status --session <sid> |
| Start next round | tree round-start --session <sid> |
| Persist | tree save --session <sid> (auto-saved) |
| Load previous | tree load <session-id> |
| All sessions | tree list |

---

## ① SELECTION — UCB + Knowledge Bias

**`UCB` = V + c×√(ln(N_parent)/n_child) + K_bonus**, c=√2
Code: ucb --v <V> --n <n> --parent-n <N> --k-bonus <K>
Real tree: tree select <node-id> --session <sid> (uses actual UCB formula)

### 奇正相生(Qi-Zheng Interplay) — Sun Tzu's Orthodox & Unorthodox (虚实篇 Xu Shi Pian)

"凡战者，以正合，以奇胜" — 正(orthodox)=exploit known best, 奇(unorthodox)=explore unknown potential

UCB itself is the mathematical expression of Qi-Zheng interplay:
- **V term**(exploit) = 正(Zheng) — exploit verified optimal path (engage with orthodox)
- **c×√(ln(N)/n) term**(explore) = 奇(Qi) — explore less-visited branches (win with unorthodox)
- **K_bonus adjusts Qi-Zheng ratio**: CONFIRMED+high confidence → increase Zheng(+0.15) | PROVISIONAL/unknown → increase Qi(+0.05) | DISPUTED → reduce Qi(-0.10)

OODA-MCTS correspondence (Boyd was directly influenced by Sun Tzu's Art of War):

OODA:  Observe(Guan 观) → Orient(Cha 察) → Decide(Mou 谋) → Act(Xing 行)
MCTS:  Selection(观)    → Expansion(察)    → Simulation(谋)  → Backprop(行)


**K_bonus**: k-bonus --status <s> --n <n> --q <q>
CONFIRMED+n≥5+q≥0.8 → +0.15 | PROVISIONAL+n<5+q≥0.7 → +0.05 | DISPUTED/q<0.5 → -0.10

**Round 1 special**: all n=0 → use knowledge graph recommendation score for initial sort.

**Mutation Vector influence**: if UCB_a - UCB_b < 0.05 AND mutation_a > mutation_b → select node_a.
Code: node $P/scripts/mcts.js compute mutation-vector --nodes '<JSON>'
Tiebreak: node $P/scripts/mcts.js compute mutation-tiebreak --nodes '<JSON>'

---

## ② EXPANSION

At reached node, expand new child based on node_type:
- ACTION: success path / partial success / obstacle
- RISK: avoided / occurred / misjudged
- FALLBACK: worked / failed / abandon path
- TERMINAL: no expansion

expansion_potential → HIGH: 2-3 children | MED: 1 | LOW: 1 quick-check | NONE: stop

---

## ③ SIMULATION — Quick Roll-out

Quick roll-out from new node to termination. Depth: simple 1-2 steps, medium 2-3, complex 3-4.

**Knowledge Acquisition Priority** (execute in order, cannot skip):
1. **Memory**: query knowledge graph + current session → evaluate credibility
   - HIGH credibility → use directly
   - MED → use but mark for verification
   - LOW → use with lower weight, note uncertainty
2. **Self-learn**: check documents/data/WebSearch → need 2 sources cross-validated
   - Can you read the project's documentation, configuration, or existing materials?
   - Can WebSearch find industry standards or known patterns?
3. **Ask user**: requirement/preference/constraint uncertainty → max 2 questions, collect for batch
   - ⛔ ONLY if ①② exhausted and you truly cannot proceed without user input
   - Use AskUserQuestion, not free text
4. **Assume**: last resort → annotate "Assume: XXX", variance +0.1
   - ⛔ NEVER assume when you could have searched or asked
   - Every assumption must be explicitly stated in output

### Recursive Divergence Depth Control

Sub-decision during roll-out → code guard check:

| Depth | Mode | Scope |
|-------|------|-------|
| 0 | full | 6-dim map + multi-perspective + complete sim |
| 1 | simplified | 2 solutions, 1-2 step sim |
| 2 | micro_diverge | 1 perspective, 1-step, variance +0.1 |
| ≥3 | micro_diverge_risky | micro but high-risk, variance +0.15 |

Commands: enter-simulation, begin-sub-diverge, end-sub-diverge, synthesize-sim, reset-depth
Hard limit: MCTS_MAX_DIVERGE_DEPTH=3

---

## ④ BACKPROPAGATION

Each ancestor: n+=1, w+=V_leaf, V=w/n, Welford online σ²

---

## ⑤ KNOWLEDGE UPDATE

Pre-write gate: use the active knowledge store interface after validating the entry.
Store through the active knowledge interface; the legacy MMA insertion CLI is unavailable.
→ Returns point ID (e.g., "LUN0001") — **collect for session-end tracking**
Score <0.4 → discard | 0.4-0.59 → observe (15-day verify) | ≥0.6 → store

Write when: V≥0.8 | V≤0.3 | Round%5==0 | After convergence
Safety: check-write-safety
Session-end: session-end (decay + cluster + reinforce)

---

## Iteration Control

| Complexity | Max Iterations |
|-----------|---------------|
| simple | 5 |
| medium | 10 |
| complex | 20 |
| debug | 8 |

**Convergence**: V change <0.05 in last 3 rounds AND high-value n≥3 AND best n≥5 σ²<0.05

### Per-Round Output Format


MCTS Round [N]:
  ① Selection: [path] (UCB values, why this path)
  ② Expansion: [new node] (type, potential)
  ③ Simulation: [roll-out path → V=X] (knowledge acquired, assumptions)
  ④ Backprop: [node updates]

Tree State: [summary of all solutions n/V/σ²]
Convergence: [check result]


⛔ FORBIDDEN: outputting only final V/n/σ² without per-round detail | collapsing rounds

Render each MCTS round directly as Markdown; no template CLI is available.

### Final Output


MCTS Complete — [N] rounds, stop reason: [why]
Ranking: SolutionA n=5 V=0.84 σ²=0.03 Conf=High | SolutionB ...
Best path: [...] | Main risk: [...]

Render the final MCTS output directly as Markdown; no template CLI is available.

