## Step 3.5: Self-Check (Critical Error Prevention)

**⛔ MANDATORY — answer ALL 5 questions before proceeding.**

① **Find flaws** → "为人谋而不忠乎?": Is any judgment vague? Any assumption unverified? Any risk ignored?
   - Zhong=loyal to the problem itself, not own preferences. Check if biased by "I'm good at X"
   - Check each solution: does it rely on "probably fine" or "should work"?
   - Check for wishful thinking: "someone else will handle that" → really?

② **Reverse thinking**: If 2nd place > 1st place, why? How likely? Does it change selection?
   - Construct a scenario where 2nd place wins. Is it plausible?
   - If yes → ask user about that scenario specifically

③ **Risk assessment** → "与朋友交而不信乎?": Worst outcome of the #1 choice? Can we bear it?
   - Xin=whether the solution's promises can be fulfilled. 1st place says "feasible" — is it truly credible?
   - What's the maximum downside? Probability? Can it be reversed?
   - If irreversible and probability >10% → ⚠️ Risk

④ **Root-Shift Check** (本末): Does 1st place violate the root dimension from 五診?
   - Root dimension = the one that defines the problem's essence
   - If 1st place sacrifices root for branch convenience → conditional pass only

⑤ **動静 Mode Check** → "传不习乎?": Are we biased?
   - Xi=practical verification, not mechanically following process. Are we "going through motions" rather than "truly thinking"?
   - Over-analyzing a simple problem (靜→動 bias)? → simplify, decide
   - Under-analyzing a complex problem (動→靜 bias)? → slow down, more sim


Self-Check Verdict:
  ✅ Pass — all 5 questions satisfied
  ⚠️ Risk — specific concern, recommend user confirm (use AskUserQuestion)
  ❌ Not passed — re-simulate with adjusted assumptions


Self-check: node $P/scripts/mcts.js compute handle-self-check --data '<JSON>'

Code: handle-self-check --conclusion <Pass/Risk/NotPassed>

**Circuit breaker**: get-fuse-mode --accuracy <float> --consecutive-bad <int>
<70% → simplified | <50% → ask user | 3× <50% → suggest manual

---

## Step 3.6: Blindspot Audit + 言意 Gap
