## Step 3: Aggregate Comparison

### 执两用中 — Doctrine of the Mean (中庸)

"执其两端，用其中于民" — Not averaging, but finding the optimal balance by grasping both ends.

Converge ranking is not simply picking the highest V:
- V_final = 0.5×V_feas + 0.3×V_robust + 0.2×V_persp + Body-Use bonus
- This quantifies Zhi-Liang-Yong-Zhong: feasibility(orthodox) + robustness(unorthodox) → comprehensive optimum(mean)
- 1st place high V_feas but low V_robust → deviant, not the "mean"
- Self-Check ④(Ben-Mo) = check if deviating from the "mean"

Academic support: Herbert Simon "Bounded Rationality" (1956) — When optimal is unattainable, satisficing(mean) is more practical.

### Multi-Layer Ranking


Rank │ Solution │ V_final │ V_feas │ V_robust │ V_persp │ σ² │ n │ Conf
─────┼──────────┼─────────┼────────┼──────────┼─────────┼────┼───┼──────
  1  │ [...]    │ [...]   │ [...]  │ [...]    │ [...]   │ .. │ . │ HIGH


V_final = 0.5×V_feas + 0.3×V_robust + 0.2×V_persp + Body-Use bonus
Code: rank --solutions '<JSON>'

### Convergence

check-final-convergence: Root n≥solutions×4, 1st n≥5, σ²<0.10, V gap >0.05
Not converged → +3 rounds (max 2×), still not → mark "not fully converged"

### Display + Confirm

Before self-check, **display MCTS conclusion to user** with ranking + best path + main risk + confidence.

---

## Step 3.5: Self-Check (Critical Error Prevention)
