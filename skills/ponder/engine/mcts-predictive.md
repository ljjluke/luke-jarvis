---
name: mcts-predictive
description: Predictive Coding Engine — transforms linear pipeline into recursive prediction-test-correction loop. Domain-agnostic.
---

# Predictive Coding Engine

> **Path note**: Commands use node $P/scripts/mcts.js (relative). When executing, use node <plugin>/scripts/mcts.js <args> — <plugin> = path from SessionStart [Ponder] Plugin:.

> The brain is not a passive input processor. It is a prediction machine: it continuously generates predictions, tests them against input, computes prediction error, and propagates corrections upward. This is Friston's Free Energy Principle (2010).

The core loop:


┌─────────────────────────────────────────────────┐
│ ① GENERATE PREDICTION  (based on current model)  │
│     → 五診 scores, 心斋 assumptions               │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ ② TEST PREDICTION  (get user input)              │
│     → 信息缺口, AskUserQuestion                   │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ ③ COMPUTE ERROR  (prediction ≠ reality)          │
│     → divergence between assumed and actual       │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ ④ PROPAGATE CORRECTION  (update upstream)        │
│     → correct 五診 → re-run affected divergence  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
     ┌─── error < threshold? ───┐
     │         NO                │ YES
     │         │                 │
     └─── back to ① ────   proceed to converge


## ① Prediction Generation

Generate the initial prediction from available information.
The prediction is a set of weighted hypotheses about the user's domain.


Prediction = {
  wuzhen_scores: { tian: ?, di: ?, ren: ?, fa: ?, wu: ? },
  constraints: [ hard: [...], soft: [...] ],
  assumptions: [ "I assume X because Y", ... ],
  confidence: 0~1,  // how much of this is grounded vs guessed
}


Confidence < 0.7 means prediction is weak → high expected error → more user questions needed.

## ② Prediction Testing

Test each dimension of the prediction against user input.


Test step:
  For each dimension score < 7: ask user
  For each assumption: ask user to confirm/correct
  For each constraint: verify

User answer → actual_value
prediction_error = |predicted - actual|


## ③ Error Computation


Error is computed per-dimension:
  - score_error = |predicted_score - user_confirmed_score|
  - assumption_error = was_user_correction_needed? (binary)
  - constraint_error = was_constraint_wrong? (binary)

Total prediction error = weighted sum of all errors


## ④ Error Propagation

When prediction error > threshold (0.3), the correction must propagate backward:


Correction propagation:
  User corrects an assumption about "budget"
  → 地(Resources) score needs re-evaluation
  → 本末(Root) may shift
  → Divergence that depended on this assumption needs re-run
  → MCTS solutions that assumed this constraint need re-scoring

CLI: node $P/scripts/mcts.js compute predict-propagate --correction '<json>'


## Dual-Process Gating (System 1 / System 2)

Before engaging the full predictive loop, check if past memory provides a direct match:


System 1 (fast):
  deqi recall → if confident match (q > 0.7 + n > 3)
  → output past solution directly
  → skip full loop

System 2 (slow):  
  if no confident match, OR user asks for deeper analysis
  → engage full predictive loop


This mirrors Kahneman (2011): System 1 first, System 2 when needed.

## CLI Reference

bash
# Generate initial prediction
node $P/scripts/mcts.js compute predict-generate --task '<json>'

# Test prediction against user input
node $P/scripts/mcts.js compute predict-test --prediction '<json>' --user-input '<json>'

# Propagate correction through pipeline
node $P/scripts/mcts.js compute predict-propagate --correction '<json>'

# Check if fast path (System 1) applies
node $P/scripts/mcts.js compute fast-path-check --query '<json>'

