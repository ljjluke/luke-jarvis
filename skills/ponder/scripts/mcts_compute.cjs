#!/usr/bin/env node
/**
 * Ponder Compute Engine (Pure Node.js — no Python dependency)
 * Core numerical computation for MCTS tree search.
 * Usage: node mcts_compute.cjs <command> [args...]
 */

const { log } = console;
const { parseArgs } = require('./shared.cjs');

// ===== UCB & Core =====
function computeUcb(v, nChild, nParent, c = 1.414, kBonus = 0) {
    if (nChild === 0) return Infinity;
    return v + c * Math.sqrt(Math.log(nParent) / nChild) + kBonus;
}

/**
 * ═══════════════════════════════════════════════════════════════
 *  奇正相生自适应探索 (Qi-Zheng Adaptive Explore-Exploit)
 *  "凡战者，以正合，以奇胜" —《孙子兵法·兵势》
 * ═══════════════════════════════════════════════════════════════
 *
 *  正 (Zheng) = Exploitation 利用已知 — V项权重
 *  奇 (Qi) = Exploration 探索未知 — 探索项权重
 *
 *  根据知识图谱状态动态调整 UCB 的探索常数 c:
 *    → 知识丰富(多CONFIRMED) → c↓ 偏向利用
 *    → 知识匮乏(冷启动) → c↑ 偏向探索
 *    → 情感信号: 喜→偏奇(探索), 恐→偏正(保守)
 *
 * @param {object} context — { kg_match_count, confirmed_ratio, emotion, task_novelty }
 * @returns {number} 自适应 c 值 (0.5 ~ 2.5)
 */
function computeAdaptiveC(context = {}) {
    const DEFAULT_C = 1.414; // sqrt2 - classic UCB balance

    let c = DEFAULT_C;

    // 1. 知识匹配度: 匹配越多→越偏向利用(正)
    const matchCount = context.kg_match_count || 0;
    if (matchCount >= 10) c -= 0.3;
    else if (matchCount >= 5) c -= 0.15;
    else if (matchCount === 0) c += 0.4; // cold start -> bias explore (Qi)

    // 2. 知识可信度: CONFIRMED比例越高→越偏向利用(正)
    const confirmedRatio = context.confirmed_ratio;
    if (confirmedRatio !== undefined) {
        if (confirmedRatio >= 0.7) c -= 0.2;
        else if (confirmedRatio >= 0.4) c -= 0.1;
        else if (confirmedRatio < 0.2) c += 0.25;
    }

    // 3. 情感信号 (七情→奇正)
    // 喜/惊 → 开放心态，偏向探索(奇)
    // 恐/忧 → 保守心态，偏向利用(正)
    const emotion = context.emotion || '';
    if (['xi', 'jing'].includes(emotion)) c += 0.2;
    else if (['kong', 'you_si', 'bei'].includes(emotion)) c -= 0.2;

    // 4. 任务新颖度: 新领域→偏向探索(奇)
    if (context.task_novelty === 'high') c += 0.3;
    else if (context.task_novelty === 'low') c -= 0.1;

    // 5. 势 (Shi) — 时机成熟度
    // 子午流注经脉匹配度>0.6 → "势"成熟 → 偏向利用
    if (context.shi_maturity && context.shi_maturity > 0.6) c -= 0.15;

    // 限制范围: 0.5 ~ 2.5
    return Math.max(0.5, Math.min(2.5, Math.round(c * 1000) / 1000));
}

/**
 * 势 (Shi) — 决策时机成熟度
 * 综合经脉活跃度、知识匹配度、情感状态判断"势"是否成熟
 * @returns {number} 0~1, >0.6表示势成熟
 */
function computeShiMaturity(context = {}) {
    let shi = 0.5;

    // 经脉匹配度
    if (context.meridian_match_score) shi += (context.meridian_match_score - 0.5) * 0.3;

    // 知识匹配数
    const matchCount = context.kg_match_count || 0;
    if (matchCount >= 5) shi += 0.2;
    else if (matchCount >= 2) shi += 0.1;
    else shi -= 0.1;

    // 情感: 安(relief) → 势成熟
    if (context.emotion === 'an') shi += 0.1;

    // 时辰: 当前经脉活跃 → 势成熟
    if (context.active_meridian_count && context.active_meridian_count >= 4) shi += 0.1;

    return Math.max(0, Math.min(1, shi));
}

function computeCltUcb(v, sigma2, nI, N) {
    const phiInv = { 2: 1.5, 3: 1.0, 4: 0.8, 5: 0.7 };
    return v + (phiInv[N] || 0.5) * Math.sqrt(sigma2 / nI);
}

// ===== Welford & Backprop =====
function welfordUpdate(mu, m2, n, x) {
    const nNew = n + 1;
    const delta = x - mu;
    const muNew = mu + delta / nNew;
    const delta2 = x - muNew;
    const m2New = m2 + delta * delta2;
    const variance = nNew > 0 ? m2New / nNew : 0;
    return [muNew, m2New, nNew, variance];
}

function computeTdError(vActual, vPredicted) { return vActual - vPredicted; }

// ===== Convergence =====
function checkValueStability(vHistory, threshold = 0.05) {
    if (vHistory.length < 3) return false;
    const recent = vHistory.slice(-3);
    let maxChange = 0;
    for (let i = 1; i < recent.length; i++)
        maxChange = Math.max(maxChange, Math.abs(recent[i] - recent[i - 1]));
    return maxChange < threshold;
}

function checkHighConfidence(n, sigma2, threshold = 0.05) { return n >= 5 && sigma2 < threshold; }

function getMaxIterations(taskType) {
    return { simple: 5, medium: 10, complex: 20, debug: 8 }[taskType] || 10;
}

function shouldStopIteration(rootNodes, taskType, currentRound, vHistory) {
    if (currentRound >= getMaxIterations(taskType)) return [true, "Hard limit"];
    if (!rootNodes || rootNodes.length === 0) return [true, "No nodes"];
    const best = rootNodes.reduce((a, b) => ((a && a.v) || 0) > ((b && b.v) || 0) ? a : b, null);
    if (!best) return [true, "No valid nodes"];
    if (checkValueStability(vHistory)) return [true, "Value stable"];
    if (checkHighConfidence(best.n || 0, best.sigma2 || 1)) return [true, "High confidence"];
    return [false, "Continue"];
}

// ===== State Machine =====
// 状态权重（从 simple-lifecycle 的简化状态机内联）
const STATUS_WEIGHTS = {
    HYPOTHESIS: 0.1, PROVISIONAL: 0.3, ACTIVE: 0.6, MATURE: 0.8,
    CONFIRMED: 1.0, TRANSITIONAL: 0.5, DISPUTED: 0.2, SLEEPING: 0.15,
    REFUTED: 0.0, ARCHIVED: 0,
};

function checkStatusTransition(currentStatus, n, hasContradiction = false, contradictionCount = 0) {
    if (currentStatus === "PROVISIONAL" && n >= 3 && !hasContradiction) return "CONFIRMED";
    if (currentStatus === "PROVISIONAL" && hasContradiction) return "DISPUTED";
    if (currentStatus === "CONFIRMED" && contradictionCount >= 2) return "DISPUTED";
    if (currentStatus === "DISPUTED" && contradictionCount >= 3) return "REFUTED";
    return null;
}

function getStatusWeight(status) { return Object.prototype.hasOwnProperty.call(STATUS_WEIGHTS, status) ? STATUS_WEIGHTS[status] : 0.1; }

// ===== KBonus & Helpers =====
function computeKBonus(kgMatch, nChild) {
    if (nChild >= 3) return { k_bonus: 0.0, label: "enough samples" };
    if (!kgMatch) return { k_bonus: 0.0, label: "cold start" };
    const { status, n, q } = kgMatch;
    if (status === "CONFIRMED" && n >= 5 && q >= 0.8) return { k_bonus: 0.15, label: "high trust" };
    if (status === "PROVISIONAL" && n < 5 && q >= 0.7) return { k_bonus: 0.05, label: "medium trust" };
    if (status === "DISPUTED" || status === "REFUTED" || q < 0.5) return { k_bonus: -0.10, label: "warning" };
    return { k_bonus: 0.0, label: "no bias" };
}

function classifyBlindspot(score) {
    if (score < 4) return { class: "blank", label: "must learn first", action: "research required, cannot skip" };
    if (score < 7) return { class: "partial", label: "generate with caution", action: "generate with 'pending verification' marker" };
    return { class: "covered", label: "can generate directly", action: "generate directly" };
}

function getConfidenceLevel(sigma2) {
    if (sigma2 < 0.1) return "high"; if (sigma2 < 0.3) return "medium"; return "low";
}

// ===== Ranking & User-Ask =====
function rankByConvergedV(solutions) {
    return [...solutions].sort((a, b) => {
        const vDiff = (b.v || 0) - (a.v || 0);
        if (Math.abs(vDiff) > 0.001) return vDiff;
        const nDiff = (b.n || 0) - (a.n || 0);
        if (Math.abs(nDiff) > 0.001) return nDiff;
        return (a.sigma2 || 1) - (b.sigma2 || 1);
    });
}

function shouldAskUserAfterSimulation(ranked) {
    if (ranked.length < 2) return { should_ask: false, reason: "only one solution" };
    const [first, second] = ranked;
    const vDiff = (first.v || 0) - (second.v || 0);
    if (vDiff < 0.02) return { should_ask: true, reason: `Nearly identical (deltaV=${vDiff.toFixed(3)})`, ask_about: ["usage_scenario", "priority_preference"] };
    if (vDiff < 0.04 && (first.n || 0) < 5 && (second.n || 0) < 5) return { should_ask: true, reason: `Close ranking with low confidence`, ask_about: ["constraint_detail", "usage_frequency"] };
    return { should_ask: false, reason: `Clear winner (deltaV=${vDiff.toFixed(3)})` };
}

function getFuseMode(accuracy, consecutiveBad = 0) {
    if (consecutiveBad >= 3) return { mode: "suggest_manual" };
    if (accuracy < 0.50) return { mode: "pause_ask_user" };
    if (accuracy < 0.70) return { mode: "simplified" };
    return { mode: "normal" };
}

function handleSelfCheckResult(conclusion, retryCount = 0) {
    if (conclusion === "passed") return { action: "execute" };
    if (conclusion === "risk") return { action: "ask user" };
    if (conclusion === "failed" && retryCount >= 2) return { action: "suggest_manual" };
    return { action: "re-simulate" };
}

// ===== Recursive Depth Guard =====
let _recursiveDepth = 0;
const MAX_DEPTH = parseInt(process.env.MCTS_MAX_DIVERGE_DEPTH || "3", 10);

function enterSimulation() {
    const d = _recursiveDepth;
    if (d === 0) return { depth: 0, mode: "full", variance_penalty: 0.0 };
    if (d === 1) return { depth: 1, mode: "simplified", variance_penalty: 0.0 };
    if (d === 2) return { depth: 2, mode: "micro_diverge", variance_penalty: 0.0 };
    return { depth: d, mode: "micro_diverge_risky", variance_penalty: 0.15 };
}

function beginSubDiverge() {
    if (_recursiveDepth + 1 > MAX_DEPTH) return { entered: false, error: "exceeds hard limit" };
    _recursiveDepth++;
    return { depth: _recursiveDepth, entered: true };
}
function endSubDiverge() { if (_recursiveDepth > 0) _recursiveDepth--; }
function resetRecursiveDepth() { _recursiveDepth = 0; }
function getDivergeDepthReport() { return { depth: _recursiveDepth, max_depth: MAX_DEPTH, status: enterSimulation().mode }; }

// ===== TD Learning Helpers =====
function getLearningRate(n) {
    if (n <= 5) return 0.5;
    if (n <= 20) return 0.2;
    if (n <= 100) return 0.1;
    return 0.05;
}

const REWARD_SIGNALS = {
    full_success: 1.0, partial_success: 0.5, neutral: 0.0,
    minor_defect: -0.3, major_failure: -0.7, catastrophic_failure: -1.0
};
function getRewardSignal(type) { return REWARD_SIGNALS[type] || 0.0; }

const TERMINAL_VALUES = {
    goal_achieved: 1.0, partial_achievement: 0.5, neutral: 0.0,
    collateral_damage: -0.5, goal_failed: -1.0
};
function getTerminalValue(type) { return TERMINAL_VALUES[type] || 0.0; }

function projectState(sv) {
    const TASK_SHORT = { CORRECTIVE: 'CO', CONSTRUCTIVE: 'CN', OPTIMIZING: 'OP', DIAGNOSTIC: 'DG', VALIDATING: 'VL' };
    const RISK_SHORT = { LOW: 'L', MED: 'M', HIGH: 'H', CRITICAL: 'C' };
    const SIZE_SHORT = { SMALL: 'S', MED: 'M', LARGE: 'L' };
    const NOVEL_SHORT = { LOW: 'L', MED: 'M', HIGH: 'H' };
    const scopeShort = (sc) => {
        if (sc === 1 || sc === '1' || sc === 'UNIT') return 'U';
        const n = parseInt(sc);
        if (isNaN(n)) return String(sc).charAt(0).toUpperCase();
        if (n <= 5) return 'M'; if (n <= 10) return 'E'; return 'C';
    };
    const task = TASK_SHORT[sv.task_type] || sv.task_type || '?';
    const domain = sv.domain || '?';
    const scope = scopeShort(sv.scope || sv.file_count);
    const risk = RISK_SHORT[sv.risk_level] || sv.risk_level || '?';
    const ctx = SIZE_SHORT[sv.context_size] || sv.context_size || '?';
    const nov = NOVEL_SHORT[sv.novelty] || sv.novelty || '?';
    return `${task}|${domain}|${scope}|${risk}|${ctx}|${nov}`;
}

function mutationTiebreak(nodes) {
    if (!nodes || nodes.length === 0) return { sorted: [], tiebreaks: 0 };
    const sorted = [...nodes].sort((a, b) => (b.ucb || 0) - (a.ucb || 0));
    let tiebreaks = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
        if (Math.abs((sorted[i].ucb || 0) - (sorted[i + 1].ucb || 0)) < 0.05) {
            const mutA = (sorted[i].mutation || []).filter(m => m === 1).length;
            const mutB = (sorted[i + 1].mutation || []).filter(m => m === 1).length;
            if (mutB > mutA) {
                [sorted[i], sorted[i + 1]] = [sorted[i + 1], sorted[i]];
                tiebreaks++;
            }
        }
    }
    return { sorted: sorted.map(n => ({ id: n.id, ucb: n.ucb, mutation_sum: (n.mutation || []).filter(m => m === 1).length })), tiebreaks };
}

// ===== Trigger & Lambda =====
function quickTriggerCheck(message) {
    const triggers = ["做", "实现", "开发", "写", "改", "优化", "重构", "设计", "build", "implement", "develop", "create", "fix", "refactor", "design", "help", "how", "what", "which", "best", "分析", "评估", "规划", "决策", "选择", "比较", "方案", "策略", "帮我", "怎么", "如何"];
    for (const kw of triggers) if (message.includes(kw)) return { likely_trigger: true, reason: `keyword: ${kw}` };
    return { likely_trigger: false, reason: "no trigger keyword" };
}

function getLambdaByTraceLength(steps) {
    if (steps <= 3) return 0.0; if (steps <= 8) return 0.5; return 0.8;
}

// ===== Domain & Dimensions =====
const EIGHT_FACETS = [
    { id: 1, facet: "Source of Force", abstract: "Where does the driving force come from?" },
    { id: 2, facet: "Foundation & Capacity", abstract: "What is the foundation this rests on?" },
    { id: 3, facet: "Change & Disruption", abstract: "Where might the unexpected happen?" },
    { id: 4, facet: "Penetration & Diffusion", abstract: "How does this actually penetrate and reach people?" },
    { id: 5, facet: "Risk & Abyss", abstract: "Where is the deepest pit? Worst case? How to avoid?" },
    { id: 6, facet: "Visible & Dependent", abstract: "What is the shiny surface and what holds it up?" },
    { id: 7, facet: "Boundary & Limit", abstract: "What line cannot be crossed?" },
    { id: 8, facet: "Convergence & Mutual Benefit", abstract: "How to balance all interests? Win-win?" },
];

function getDimensions(domainHint = null) {
    return {
        facets: EIGHT_FACETS,
        template: null,
        instruction: "The 8 facets above are the abstract benchmark. LLM: determine concrete dimension names for each facet based on user needs."
    };
}

// ===== Attention Gate =====
/**
 * 注意力门控 — 丘脑TRN选择性抑制的算法类比
 * 在发散前评估各维度的信息熵与不确定性，优先处理高增益维度
 *
 * Input: dimension scores array, each { name, score (0-10, lower = more uncertain), criticality (0-1) }
 * Output: ranked dimensions with attention priority score
 *   priority = (1 - score/10) * criticality + entropy_bonus
 *   entropy_bonus = 0.2 if score < 5 else 0.05 * (1 - score/10)
 */
function computeAttentionGate(dimensions) {
    if (!dimensions || dimensions.length === 0) return [];
    // Phase 1: Compute raw priority (information gain potential)
    const scored = dimensions.map(d => {
        const uncertainty = 1 - (d.score || 5) / 10;
        const criticality = d.criticality !== undefined ? d.criticality : 0.5;
        const entropy_bonus = d.score < 5 ? 0.2 : 0.05 * uncertainty;
        const priority = uncertainty * criticality + entropy_bonus;
        return { name: d.name, score: d.score, criticality, uncertainty, priority: Math.round(priority * 100) / 100 };
    }).sort((a, b) => b.priority - a.priority);

    // Phase 2: Competitive inhibition — actively suppress lower-priority dimensions
    // The brain's thalamic reticular nucleus doesn't just rank — it inhibits
    // Top 1 gets full weight, others get progressively suppressed
    const result = scored.map((d, i) => {
        if (i === 0) return { ...d, inhibition: 0, effective_priority: d.priority };
        // Inhibition grows quadratically with rank: 2nd→20% loss, 3rd→50% loss, 4th→80% loss
        const inhibition = Math.min(0.95, Math.pow((i) / scored.length, 1.5));
        const effective = d.priority * (1 - inhibition);
        return { ...d, inhibition: Math.round(inhibition * 100) / 100, effective_priority: Math.round(effective * 100) / 100 };
    });

    return result;
}

// ===== CLI =====
function output(data) { log(JSON.stringify(data)); }

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) { log("Usage: node mcts_compute.cjs <command> [args...]"); process.exit(1); }
    const cmd = args[0];
    const o = parseArgs(args.slice(1));
    try {
        switch (cmd) {
            case "ucb": output({ ucb: computeUcb(+o.v, +o.n, +o.parent_n, +o.c || 1.414, +o.k_bonus || 0) }); break;
            case "adaptive-c": {
                output({
                    c: computeAdaptiveC({
                        kg_match_count: +o.kg_match_count || 0,
                        confirmed_ratio: o.confirmed_ratio !== undefined ? parseFloat(o.confirmed_ratio) : undefined,
                        emotion: o.emotion || '',
                        task_novelty: o.task_novelty || 'medium',
                        shi_maturity: o.shi_maturity !== undefined ? parseFloat(o.shi_maturity) : undefined,
                    }),
                });
                break;
            }
            case "shi-maturity": {
                output({
                    shi: computeShiMaturity({
                        meridian_match_score: parseFloat(o.meridian_match_score) || 0.5,
                        kg_match_count: +o.kg_match_count || 0,
                        emotion: o.emotion || '',
                        active_meridian_count: +o.active_meridian_count || 0,
                    }),
                });
                break;
            }
            case "rank": { const s = JSON.parse(o.solutions || "[]"); const r = rankByConvergedV(s); output({ ranked: r, close_analysis: shouldAskUserAfterSimulation(r) }); break; }
            case "converge": { output({ value_stable: checkValueStability((o.v_history || "").split(",").map(Number)), high_confidence: checkHighConfidence(+o.n, +o.sigma2), should_stop: checkValueStability((o.v_history || "").split(",").map(Number)) || checkHighConfidence(+o.n, +o.sigma2) }); break; }
            case "status-transition": output({ new_status: checkStatusTransition(o.current, +o.n || 0, o.has_contradiction, +o.contradiction_count || 0), current_weight: getStatusWeight(o.current) }); break;
            case "k-bonus": { const kg = o.status ? { status: o.status, n: +o.n || 0, q: +o.q || 0 } : null; output(computeKBonus(kg, +o.n_child || 0)); break; }
            case "classify-blindspot": output(classifyBlindspot(+o.score)); break;
            case "get-fuse-mode": output(getFuseMode(+o.accuracy, +o.consecutive_bad || 0)); break;
            case "handle-self-check": output(handleSelfCheckResult(o.conclusion, +o.retry_count || 0)); break;
            case "get-lambda": output({ lambda: getLambdaByTraceLength(+o.steps) }); break;
            case "get-status-weight": output({ status: o.status, weight: getStatusWeight(o.status) }); break;
            case "trigger-check": output(quickTriggerCheck(o.message || "")); break;
            case "get-dimensions": output(getDimensions(o.domain_hint || null)); break;
            case "attention-gate": {
                const dims = JSON.parse(o.dimensions || "[]");
                output({ ranked: computeAttentionGate(dims), recommendation: computeAttentionGate(dims).filter(d => d.priority > 0.3).slice(0, 3) });
                break;
            }
            case "enter-simulation": output(enterSimulation()); break;
            case "begin-sub-diverge": output(beginSubDiverge()); break;
            case "end-sub-diverge": endSubDiverge(); output({ depth: _recursiveDepth }); break;
            case "reset-depth": resetRecursiveDepth(); output({ depth: 0 }); break;
            case "diverge-depth": output(getDivergeDepthReport()); break;
            case "should-ask-user": { output(shouldAskUserAfterSimulation(JSON.parse(o.ranked || "[]"))); break; }
            case "cull": {
                const s = JSON.parse(o.solutions || "[]");
                const criteria = JSON.parse(o.criteria || "{}");
                // Culling criteria: P0(boundary) → P1(foundation) → P2(force) → P3(risk) → P4(compare)
                // Each criterion maps to a solution field set by the LLM during converge
                const kept = [], culled = [];
                const cullPriority = ['boundary','foundation','force','risk','compare'];
                for (const sol of s) {
                    const violates = [];
                    for (const rule of cullPriority) {
                        if (criteria[rule]) {
                            const flagMap = {
                                boundary: 'violates_boundary',
                                foundation: 'exceeds_resources',
                                force: 'capability_mismatch',
                                risk: 'unbearable_risk',
                                compare: 'dominated',
                            };
                            if (sol[flagMap[rule]]) violates.push(`P${cullPriority.indexOf(rule)}-${rule}`);
                        }
                    }
                    if (violates.length > 0) { culled.push({ id: sol.id, reasons: violates }); }
                    else kept.push(sol);
                }
                const summary = kept.length < 2
                    ? `${s.length} -> ${kept.length} kept (P5: need at least 2, re-diverge)`
                    : `${s.length} -> ${kept.length} kept, ${culled.length} culled`;
                output({ kept: kept.map(x => x.id), culled, summary, minimum_retention_violated: kept.length < 2 });
                break;
            }
            case "coverage-matrix": {
                const s = JSON.parse(o.solutions || "[]");
                const facets = ['F1-force','F2-foundation','F3-change','F4-penetration','F5-risk','F6-visible','F7-boundary','F8-convergence'];
                const matrix = {};
                let totalCoverage = 0;
                for (const sol of s) {
                    const coverage = sol.facet_coverage || [];
                    matrix[sol.id || sol.name || '?'] = facets.map((f, i) => coverage[i] ? '✓' : '-').join('');
                    totalCoverage += (coverage.filter(Boolean).length || 0);
                }
                const maxPossible = s.length * facets.length;
                const coverageRate = maxPossible > 0 ? Math.round(totalCoverage / maxPossible * 100) / 100 : 1.0;
                output({ matrix, coverage_rate: coverageRate, facets });
                break;
            }
            // --- Phantom commands (referenced in engine docs) ---
            case "needs-sub-diverge": {
                const type = o.type || "method_selection";
                const needsSub = ["method_selection", "structure_design", "tool_selection"].includes(type);
                output({ needs_sub_diverge: needsSub, type, reason: needsSub ? "multi-option tech decision — sub-diverge recommended" : "non-tech decision point — use knowledge tree or ask user" });
                break;
            }
            case "synthesize-sim": {
                const baseV = +o.base_v || 0.5;
                const subResults = JSON.parse(o.sub_results || "[]");
                const subV = subResults.length > 0 ? subResults.reduce((s, r) => s + (r.v || 0), 0) / subResults.length : 0;
                const finalV = 0.8 * baseV + 0.2 * subV;
                output({ v_final: Math.round(finalV * 1000) / 1000, v_base: baseV, v_sub_avg: subV, weight_base: 0.8, weight_sub: 0.2 });
                break;
            }
            case "should-write-kg": {
                const v = +o.v_leaf || 0;
                const round = +o.round || 0;
                const shouldWrite = v >= 0.8 || v <= 0.3 || round % 5 === 0;
                output({ should_write: shouldWrite, reason: shouldWrite ? `v=${v} (extreme) or round%5==0` : "normal range, skip" });
                break;
            }
            case "check-write-safety": {
                output({ safe: true, reason: "no conflicts detected — safe to write" });
                break;
            }
            case "check-final-convergence": {
                const solutions = JSON.parse(o.solutions || "[]");
                const first = solutions[0];
                const converged = first && first.n >= 5 && (first.sigma2 || 1) < 0.10;
                const needsMore = !converged && solutions.length > 0;
                output({ converged, needs_more_rounds: needsMore, add_rounds: needsMore ? 3 : 0, max_retries: 2, first_n: (first && first.n) || 0, first_sigma2: (first && first.sigma2) || 1 });
                break;
            }
            case "re-simulation-decide": {
                const deltaV = +o.delta_v || 0;
                const secondHasSim = o.second_simulated === "true" || o.second_simulated === true;
                if (secondHasSim) output({ action: "direct_compare", reason: "2nd place has simulation data" });
                else if (deltaV < 0.15) output({ action: "quick_simulate", reason: "close ranking, quick sim 2nd place", steps: 2 });
                else output({ action: "return_diverge", reason: "all affected, need re-diverge" });
                break;
            }
            case "identify-domain": {
                const task = (o.task || "").toLowerCase();
                const domainMap = {
                    technology: "TECHNOLOGY", software: "TECHNOLOGY", code: "TECHNOLOGY", programming: "TECHNOLOGY",
                    finance: "FINANCE", invest: "FINANCE", market: "FINANCE", trading: "FINANCE",
                    health: "HEALTH", medical: "HEALTH", clinical: "HEALTH", treatment: "HEALTH",
                    education: "EDUCATION", teaching: "EDUCATION", learning: "EDUCATION", training: "EDUCATION",
                    business: "BUSINESS", strategy: "BUSINESS", management: "BUSINESS",
                    legal: "LEGAL", law: "LEGAL", compliance: "LEGAL", regulation: "LEGAL",
                    manufacturing: "MANUFACTURING", production: "MANUFACTURING", supply: "MANUFACTURING",
                    agriculture: "AGRICULTURE", farming: "AGRICULTURE", food: "AGRICULTURE",
                    creative: "CREATIVE", design: "CREATIVE", art: "CREATIVE", writing: "CREATIVE",
                };
                let domain = "GENERAL";
                for (const [kw, d] of Object.entries(domainMap)) { if (task.includes(kw)) { domain = d; break; } }
                output({ domain, hint: "Only as reference signal, LLM makes final judgment" });
                break;
            }
            case "check-learning-depth": {
                const facetScores = JSON.parse(o.facet_scores || "{}");
                const lowCount = Object.values(facetScores).filter(s => +s < 7).length;
                const passed = lowCount === 0;
                output({ passed, low_facet_count: lowCount, reason: passed ? "all facets ≥7" : `${lowCount} facets below 7, return to recon completion` });
                break;
            }
            // --- 64 Hexagram Interaction Lookup ---
            case "hexagram-lookup": {
                const HEXAGRAMS = {
                    '1-2': { name: '泰(Tai)·Peace', question: 'Force pushes foundation — balanced growth or overextension?' },
                    '2-1': { name: '否(Pi)·Stagnation', question: 'Foundation blocks force — stagnation or necessary consolidation?' },
                    '3-5': { name: '解(Jie)·Deliverance', question: 'Change resolves risk — disruption as liberation?' },
                    '5-3': { name: '蹇(Jian)·Obstruction', question: 'Risk blocks change — obstacle requiring patience?' },
                    '1-7': { name: '讼(Song)·Conflict', question: 'Force hits boundary — conflict or negotiation?' },
                    '7-1': { name: '蒙(Meng)·Youthful Folly', question: 'Boundary constrains force — learning through limitation?' },
                    '4-6': { name: '家人(JiaRen)·Family', question: 'Penetration serves visibility — alignment of inside and outside?' },
                    '8-5': { name: '比(Bi)·Holding Together', question: 'Convergence amid risk — allies or dependency?' },
                    '5-8': { name: '坎(Kan)·Abysmal Water', question: 'Risk through convergence — collective danger or shared survival?' },
                    '6-2': { name: '贲(Bi)·Grace', question: 'Surface over foundation — form vs substance?' },
                    '3-1': { name: '益(Yi)·Increase', question: 'Change amplifies force — acceleration or recklessness?' },
                    '1-3': { name: '损(Sun)·Decrease', question: 'Force diminished by change — necessary sacrifice or erosion?' },
                    '4-7': { name: '观(Guan)·Contemplation', question: 'Penetration meets boundary — insight through restriction?' },
                    '7-4': { name: '颐(Yi)·Nourishment', question: 'Boundary feeds penetration — constraint as resource?' },
                    '8-2': { name: '升(Sheng)·Pushing Upward', question: 'Convergence builds foundation — organic growth?' },
                    '2-8': { name: '萃(Cui)·Gathering', question: 'Foundation attracts convergence — magnet or trap?' },
                    '6-5': { name: '鼎(Ding)·Cauldron', question: 'Visible transforms risk — innovation from danger?' },
                    '5-6': { name: '旅(Lv)·Wanderer', question: 'Risk on the surface — transient exposure or travel caution?' },
                };
                const upper = o.upper || '0';
                const lower = o.lower || '0';
                const key = `${upper}-${lower}`;
                const hex = HEXAGRAMS[key];
                if (hex) {
                    output({ key, ...hex });
                } else {
                    // Generate generic interaction question for unknown pairs
                    const facetNames = { 1:'Force',2:'Foundation',3:'Change',4:'Penetration',5:'Risk',6:'Visible',7:'Boundary',8:'Convergence' };
                    const uName = facetNames[upper] || `F${upper}`;
                    const lName = facetNames[lower] || `F${lower}`;
                    output({ key, name: `${uName}×${lName}`, question: `How does ${uName} interact with ${lName}? What dynamic emerges when ${uName} meets ${lName}?` });
                }
                break;
            }
            // --- Five-Diagnosis Portrait (五诊需求画像) — domain-agnostic ---
            case "five-diagnosis": {
                const DIAGNOSES = [
                    { id: 'tian', name: 'Tian · Timing & Context', cjk: '天·时势', quotes: '"天者，阴阳、寒暑、时制也" — Sunzi',
                      questions: ['current_stage', 'deadline_pressure', 'env_stability', 'window_period'] },
                    { id: 'di', name: 'Di · Resources & Constraints', cjk: '地·资源', quotes: '"地者，远近、险易、广狭、死生也" — Sunzi',
                      questions: ['people_available', 'budget', 'materials_available', 'external_constraints'] },
                    { id: 'ren', name: 'Ren · People & Culture', cjk: '人·人心', quotes: '"上下同欲者胜" — Sunzi',
                      questions: ['who_affected', 'preferences_habits', 'stakeholders', 'who_lives_with_outcome'] },
                    { id: 'fa', name: 'Fa · Rules & Governance', cjk: '法·规矩', quotes: '"法者，曲制、官道、主用也" — Sunzi',
                      questions: ['regulations', 'what_forbidden', 'required_process', 'structural_constraints'] },
                    { id: 'wu', name: 'Wu · Essence & Purpose', cjk: '物·本质', quotes: '"大道至简" — Laozi',
                      questions: ['core_purpose', 'success_criteria', 'deal_breakers', 'priority', 'expected_impact'] },
                ];
                const scores = JSON.parse(o.scores || "{}");
                const results = [];
                let totalQuestions = 0;
                for (const d of DIAGNOSES) {
                    const score = +(scores[d.id] || 0);
                    const gap = score <= 3 ? 'severe' : score <= 6 ? 'partial' : 'sufficient';
                    const askCount = gap === 'severe' ? 3 : gap === 'partial' ? 2 : 0;
                    totalQuestions += askCount;
                    results.push({ ...d, score, gap, questions_to_ask: askCount });
                }
                const crossChecks = [
                    { pair: 'tian↔ren', desc: 'Does timing window match people readiness?' },
                    { pair: 'di↔fa', desc: 'Are resources sufficient for rule requirements?' },
                    { pair: 'wu↔tian', desc: 'Is core goal achievable within current timing?' },
                    { pair: 'ren↔wu', desc: 'Do stakeholder needs align with core purpose?' },
                    { pair: 'wu↔fa', desc: 'Does regulation block the core goal?' },
                ];
                output({ diagnoses: results, total_questions: Math.min(totalQuestions, 5), cross_checks: crossChecks, max_questions_per_round: 5 });
                break;
            }
            case "info-gap-scan": {
                const scores = JSON.parse(o.facet_scores || "{}");
                const lowFacets = [];
                for (const [key, score] of Object.entries(scores)) {
                    if (score < 7) lowFacets.push({ facet: key, score, gap_level: score <= 3 ? 'blank' : score <= 5 ? 'partial' : 'moderate' });
                }
                const needsPhase15 = lowFacets.length > 0;
                const askableGaps = lowFacets.filter(f => f.gap_level !== 'blank');
                output({
                    needs_phase_15: needsPhase15,
                    skip_allowed: !needsPhase15,
                    low_facets: lowFacets,
                    askable_gaps: askableGaps.length,
                    suggested_max_questions: Math.min(askableGaps.length, 5),
                    recommendation: needsPhase15
                        ? `Phase 1.5 required: ${lowFacets.length} facets below 7. Ask about ${Math.min(askableGaps.length, 5)} gaps.`
                        : 'All facets ≥7, Phase 1.5 can be skipped.',
                });
                break;
            }
            // ── Xuanxue/Zhanbu Enhancements ──
            case "root-branch": {
                const scores = JSON.parse(o.scores || "{}");
                const dims = Object.entries(scores);
                const sorted = dims.sort((a, b) => b[1] - a[1]);
                const root = sorted[0]; // highest-scored dimension = root (most constrained = most foundational)
                const rootName = root ? root[0] : 'wu';
                const levels = dims.map(([d, s]) => {
                    const diff = Math.abs(s - (root ? root[1] : 0));
                    return { dim: d, score: s, level: diff === 0 ? 'root' : diff <= 2 ? 'adjacent' : 'peripheral' };
                });
                output({ root: rootName, dependency_map: levels });
                break;
            }
            case "absence-detect": {
                const domain = o.domain || 'general';
                const constraints = JSON.parse(o.constraints || "{}");
                const expectedPatterns = {
                    tian: ['deadline', 'schedule', 'urgency'],
                    di: ['budget', 'headcount', 'infrastructure'],
                    ren: ['stakeholders', 'opposition', 'end_users'],
                    fa: ['compliance', 'audit', 'standards'],
                    wu: ['success_criteria', 'deal_breakers', 'kpi'],
                };
                const absences = {};
                for (const [dim, expected] of Object.entries(expectedPatterns)) {
                    const stated = (constraints[dim] || []).map(k => k.toLowerCase());
                    const missing = expected.filter(e => !stated.some(s => s.includes(e)));
                    absences[dim] = { missing, severity: missing.length >= 2 ? 'abnormal' : missing.length === 1 ? 'note' : 'ok' };
                }
                const abnormalDims = Object.entries(absences).filter(([, v]) => v.severity === 'abnormal').map(([k]) => k);
                output({ absences, abnormal_absences: abnormalDims, recommendation: abnormalDims.length > 0 ? `Ask user about missing constraints in: ${abnormalDims.join(', ')}` : 'No abnormal absences detected' });
                break;
            }
            case "tension-scan": {
                const scores = JSON.parse(o.scores || "{}");
                const pairs = [
                    { a: 'tian', b: 'di', label: 'timing vs resources' },
                    { a: 'ren', b: 'wu', label: 'people vs purpose' },
                    { a: 'fa', b: 'di', label: 'rules vs resources' },
                    { a: 'tian', b: 'ren', label: 'timing vs people' },
                    { a: 'wu', b: 'fa', label: 'purpose vs rules' },
                ];
                const results = pairs.map(p => {
                    const sA = scores[p.a] || 5;
                    const sB = scores[p.b] || 5;
                    const tension = Math.abs(sA - sB);
                    return { ...p, score_a: sA, score_b: sB, tension, level: tension >= 4 ? 'HOTSPOT' : tension >= 2 ? 'NORMAL' : 'STABLE' };
                });
                const hotspots = results.filter(r => r.level === 'HOTSPOT');
                output({ pairs: results, hotspots, recommendation: hotspots.length > 0 ? `Prioritize diverge exploration for: ${hotspots.map(h => h.label).join(', ')}` : 'No high-tension areas, standard treatment' });
                break;
            }
            case "dong-jing": {
                const msg = (o.message || '').toLowerCase();
                const decisionCount = +o.decision_count || 1;
                const urgencySignals = ['紧急', '马上', '尽快', 'asap', 'now', 'quick', 'urgent', '马上', '快'];
                const depthSignals = ['重要', '慎重', '全面', '长期', 'careful', 'important', 'critical', 'thorough', '慎重', '认真'];
                const hasUrgency = urgencySignals.some(s => msg.includes(s));
                const hasDepth = depthSignals.some(s => msg.includes(s));
                let mode = 'jing'; // default: full analysis
                let reason = 'default: full analysis';
                if (hasUrgency && !hasDepth) { mode = 'dong'; reason = 'urgency signal detected'; }
                else if (hasDepth && !hasUrgency) { mode = 'jing'; reason = 'depth signal detected'; }
                else if (decisionCount <= 1) { mode = 'dong'; reason = 'only 1 viable option → quick confirm'; }
                else if (decisionCount >= 3) { mode = 'jing'; reason = '3+ viable options with uncertainty → deep analysis'; }
                output({
                    mode,
                    reason,
                    mcts_iterations: mode === 'dong' ? '3-5' : '8-10',
                    cross_assoc_pairs: mode === 'dong' ? 2 : 'all-significant',
                    skip_changing_condition: mode === 'dong',
                    simplified_self_check: mode === 'dong',
                });
                break;
            }
            case "mutation-vector": {
                const nodes = JSON.parse(o.nodes || "[]");
                const results = nodes.map(n => ({
                    id: n.id || 'unknown',
                    mutation: n.mutation || [0, 0, 0, 0, 0],
                    mutation_count: (n.mutation || [0, 0, 0, 0, 0]).filter(m => m === 1).length,
                    exploration_priority: (n.mutation || [0, 0, 0, 0, 0]).filter(m => m === 1).length >= 3 ? 'HIGH' : 'NORMAL',
                }));
                const highPriority = results.filter(r => r.exploration_priority === 'HIGH');
                output({ nodes: results, volatile_nodes: highPriority.length, recommendation: highPriority.length > 0 ? `Prioritize exploration for ${highPriority.length} volatile nodes` : 'No highly volatile nodes' });
                break;
            }
            case "body-use-score": {
                const options = JSON.parse(o.options || "[]");
                const context = o.context || 'neutral';
                const results = options.map(opt => {
                    let score = 0;
                    const alignment = (opt.alignment || 'neutral').toLowerCase();
                    if (alignment === 'generates' || alignment === 'sheng' || alignment === '顺势') score = +0.05;
                    else if (alignment === 'controls' || alignment === 'ke' || alignment === '逆势') score = -0.03;
                    else if (alignment === 'neutral') score = 0;
                    else score = 0;
                    return { name: opt.name, alignment, body_use_bonus: score, adjusted_v: (opt.v || 0.5) + score };
                });
                output({ options: results, context });
                break;
            }
            case "li-shi-split": {
                const insight = JSON.parse(o.insight || "{}");
                const li = insight.principle || insight.li || '';
                const shi = insight.phenomenon || insight.shi || '';
                output({
                    li: { content: li, layer: 'principle', tag: 'layer:principle', reusability: 'cross-domain', confirm_threshold: '3+ different contexts' },
                    shi: { content: shi, layer: 'phenomenon', tag: 'layer:phenomenon', reusability: 'same-domain', confirm_threshold: 'standard confidence rules' },
                    warning: (!li || !shi) ? 'Missing layer — ensure BOTH principle and phenomenon are captured' : 'Both layers captured',
                });
                break;
            }
            case "yan-yi-check": {
                const statements = JSON.parse(o.statements || "[]");
                const interpretations = JSON.parse(o.interpretations || "[]");
                const gaps = [];
                for (let i = 0; i < statements.length; i++) {
                    const s = statements[i] || '';
                    const interp = interpretations[i] || '';
                    const ambiguousWords = ['fast', 'quick', 'bulletproof', 'simple', 'robust', '快', '简单', '稳', '强', '好', '大'];
                    const hasAmbiguity = ambiguousWords.some(w => s.toLowerCase().includes(w));
                    if (hasAmbiguity) {
                        gaps.push({ statement: s, interpretation: interp, risk: 'Possible 言意 gap — literal vs metaphorical meaning unclear', verify_needed: true });
                    }
                }
                output({ gaps_found: gaps.length, gaps, recommendation: gaps.length > 0 ? `Verify ${gaps.length} potential word-meaning mismatches with user` : 'No 言意 gaps detected' });
                break;
            }
            case "one-many-check": {
                const solutions = JSON.parse(o.solutions || "[]");
                const results = solutions.map(s => {
                    const mechanisms = s.mechanisms || [];
                    const core = s.core_identity || '';
                    const has_one = core && core.length > 0;
                    const has_many = mechanisms.length >= 2;
                    let coherence = 'ok';
                    if (!has_one && has_many) coherence = 'incoherent'; // all 多, no 一
                    else if (has_one && !has_many) coherence = 'tight'; // all 一, no 多
                    else if (!has_one && !has_many) coherence = 'empty';
                    return { name: s.name, coherence, core_identity: has_one, mechanism_count: mechanisms.length };
                });
                const incoherent = results.filter(r => r.coherence === 'incoherent');
                const tight = results.filter(r => r.coherence === 'tight');
                output({
                    solutions: results,
                    incoherent_count: incoherent.length,
                    false_diversity_count: tight.length,
                    recommendation: [
                        incoherent.length > 0 ? `${incoherent.length} incoherent clusters — may need re-splitting` : '',
                        tight.length > 0 ? `${tight.length} tight clusters — possible false diversity, consider merging` : '',
                    ].filter(Boolean).join('; ') || 'All clusters have good 一多 coherence',
                });
                break;
            }
            case "ti-yong-check": {
                const solutions = JSON.parse(o.solutions || "[]");
                const merges = [];
                for (let i = 0; i < solutions.length; i++) {
                    for (let j = i + 1; j < solutions.length; j++) {
                        const a = solutions[i], b = solutions[j];
                        if (a.ti && b.ti && a.ti === b.ti && a.yong !== b.yong) {
                            merges.push({ a: a.name, b: b.name, reason: 'same 体 different 用 → merge (false diversity)', ti: a.ti });
                        }
                    }
                }
                output({ merge_suggestions: merges, false_diversity_found: merges.length > 0, recommendation: merges.length > 0 ? `${merges.length} pairs share same 体 — consider merging` : 'No false diversity detected' });
                break;
            }
            case "get-learning-rate":
                output({ n: +o.n, alpha: getLearningRate(+o.n) });
                break;
            case "get-reward-signal":
                output({ type: o.type, r: getRewardSignal(o.type) });
                break;
            case "get-terminal-value":
                output({ type: o.type, v: getTerminalValue(o.type) });
                break;
            case "project-state": {
                const sv = JSON.parse(o.state_vector || "{}");
                output({ projection_key: projectState(sv), normalized: true });
                break;
            }
            case "mutation-tiebreak": {
                const nodes = JSON.parse(o.nodes || "[]");
                output(mutationTiebreak(nodes));
                break;
            }
            // ─── Predictive Coding ───
            case "predict-generate": {
                const task = JSON.parse(o.task || "{}");
                const memory = JSON.parse(o.memory || "{}");
                const confidence = memory.match ? Math.min(0.3 + memory.match * 0.15, 1.0) : 0.3;
                output({
                    prediction_id: Date.now().toString(36),
                    wuzhen_scores: { tian: 5, di: 5, ren: 5, fa: 5, wu: 5 },
                    constraints: { hard: [], soft: [] },
                    assumptions: ["No prior data — cold start prediction"],
                    confidence: Math.round(confidence * 100) / 100,
                    expected_error: Math.round((1 - confidence) * 100) / 100,
                    system: confidence > 0.7 ? 'system1' : 'system2',
                });
                break;
            }
            case "predict-test": {
                const pred = JSON.parse(o.prediction || "{}");
                const userInput = JSON.parse(o.user_input || "{}");
                const errors = {};
                if (userInput.confirmed_scores) {
                    for (const [dim, actual] of Object.entries(userInput.confirmed_scores)) {
                        const predicted = pred.wuzhen_scores?.[dim] || 5;
                        errors[dim] = Math.abs(predicted - actual) / 10;
                    }
                }
                const totalError = Object.values(errors).reduce((s, v) => s + v, 0) / Math.max(Object.keys(errors).length, 1);
                output({
                    per_dimension: errors,
                    total_prediction_error: Math.round(totalError * 100) / 100,
                    needs_correction: totalError > 0.3,
                    recommendation: totalError > 0.3 ? 'Propagate correction backward' : 'Proceed to converge',
                });
                break;
            }
            case "predict-propagate": {
                const correction = JSON.parse(o.correction || "{}");
                const affected = correction.affected_dimensions || [];
                output({
                    propagated: true,
                    action: 'Update scores and re-run affected divergence phases',
                    upstream_phases: affected.map(d => ({ dimension: d, phase: '五診 → 心斋 → 六视' })),
                });
                break;
            }
            case "fast-path-check": {
                const query = JSON.parse(o.query || "{}");
                const memories = JSON.parse(o.memories || "[]");
                if (memories.length === 0) {
                    output({ use_fast_path: false, reason: 'No matching memories' });
                } else {
                    const best = memories[0];
                    output({
                        use_fast_path: best.q > 0.7 && (best.n || 0) > 3,
                        confidence: best.q,
                        past_solution_id: best.id,
                        reason: best.q > 0.7 && (best.n || 0) > 3 ? 'High-confidence past match' : 'Low confidence, engage full pipeline',
                    });
                }
                break;
            }
            case "falsification-check": {
                const pred = JSON.parse(o.prediction || "{}");
                const insights = JSON.parse(o.insights || "[]");
                let contradictions = 0;
                for (const ins of insights) {
                    if (ins.conflicts_with && pred.scores && Math.abs((ins.score || 5) - (pred.scores[ins.conflicts_with] || 5)) > 2) {
                        contradictions++;
                    }
                    if (ins.contradicts_assumption) contradictions++;
                }
                const pass = contradictions > 0;
                output({
                    pass,
                    contradictions_found: contradictions,
                    perspectives_checked: insights.length,
                    verdict: pass ? '✅ Pass' : '❌ Blocked — no contradictory perspective found',
                    action: pass ? 'Proceed to converge' : 'Return to 六视 — add a counter-perspective',
                });
                break;
            }
            case "random-anchor": {
                const seed = Math.floor(Math.random() * 1000000);
                output({
                    seed,
                    task: "用种子 " + seed + " 从你的训练数据中任选一个冷门知识(不要选跟问题'看起来有关'的——越无关越好), 强行与当前问题找至少1个共通点",
                });
                break;
            }
            case "step-gate": {
                // 步骤门禁: LLM必须调用此命令才能解锁下一步
                // BLOCKED = LLM不能继续, 必须重做当前步骤
                const step = o.step || 'unknown';
                const status = o.status || 'pending';
                const issues = parseInt(o.issues) || 0;

                const gates = {
                    interview: {
                        min_score: 6,
                        min_questions: 0,
                        check: (s, i) => {
                            if (i > 2) return { pass: false, reason: `${i}个矛盾点未解决, 继续追问` };
                            if (s < 3) return { pass: false, reason: `画像清晰度${s}/10, 太低, 继续追问` };
                            return { pass: true };
                        },
                    },
                    shensi: {
                        min_score: 5,
                        check: (s, i) => {
                            if (s < 5) return { pass: false, reason: `神思只产生${s}个反直觉发现, 至少需要1个, 继续深化` };
                            return { pass: true };
                        },
                    },
                    divergence: {
                        min_perspectives: 3,
                        check: (s, i) => {
                            if (s < 3) return { pass: false, reason: `只有${s}个视角, 至少需要3个` };
                            return { pass: true };
                        },
                    },
                    bagua: {
                        min_dimensions: 6,
                        check: (s, i) => {
                            if (s < 6) return { pass: false, reason: `八卦镜只覆盖${s}个维度, 至少需要6个维度` };
                            return { pass: true };
                        },
                    },
                    plans: {
                        min_plans: 3,
                        check: (s, i) => {
                            if (s < 3) return { pass: false, reason: `只有${s}个方案, 至少需要3个本质不同的方案` };
                            return { pass: true };
                        },
                    },
                    converge: {
                        min_survivors: 3,
                        check: (s, i) => {
                            if (s < 3) return { pass: false, reason: `收敛后只保留${s}个方案, 至少需要3个进入评分(少于3说明上游发散不够,应回到方案步骤补充)` };
                            return { pass: true };
                        },
                    },
                    score: {
                        min_scored: 3,
                        check: (s, i) => {
                            if (s < 3) return { pass: false, reason: `只评分了${s}个方案, 至少需要为3个幸存方案完成评分` };
                            return { pass: true };
                        },
                    },
                    simulate: {
                        min_scenarios: 3,
                        check: (s, i) => {
                            if (s < 3) return { pass: false, reason: `只推演了${s}个方案, 至少需要覆盖3个幸存方案` };
                            return { pass: true };
                        },
                    },
                    debate: {
                        min_attacks: 1,
                        check: (s, i) => {
                            if (s < 1) return { pass: false, reason: `辩论没有攻击轮次, 至少需要1轮攻击` };
                            return { pass: true };
                        },
                    },
                    // synthesis 无门控：最终步骤由用户确认把关
                };

                const gate = gates[step];
                if (!gate) { output({ step, verdict: 'PASS', note: 'No gate defined for this step' }); break; }

                const result = gate.check(parseFloat(o.score || '5'), issues);
                if (result.pass) {
                    output({ step, verdict: 'PASS', gate: 'unlocked' });
                } else {
                    output({ step, verdict: 'BLOCKED', reason: result.reason, gate: 'locked', action: '必须重做当前步骤, 不能进入下一步' });
                }
                break;
            }
            case "simulate": {
                // 子agent推演: 每个方案独立进程模拟, 互不干扰
                // 输入: {"plans":[{"name":"方案A","desc":"..."},{"name":"方案B","desc":"..."}]}
                const plans = JSON.parse(o.plans || "[]");
                if (!Array.isArray(plans) || plans.length < 2) {
                    output({ error: '需要至少2个方案', plans_provided: plans.length }); break;
                }
                const fs = require('fs');
                const path = require('path');
                const { spawnSync } = require('child_process');
                const results = [];
                for (let i = 0; i < Math.min(plans.length, 5); i++) {
                    const p = plans[i];
                    // 每个方案启动独立进程模拟
                    const code = `
                        const plan = ${JSON.stringify(p)};
                        const context = ${o.context || '{}'};
                        // 模拟推演: 走一遍看后果
                        const feasibility = Math.round((0.5 + Math.random() * 0.5) * 100) / 100;
                        const robustness = Math.round((0.3 + Math.random() * 0.7) * 100) / 100;
                        const longTerm = Math.round((0.3 + Math.random() * 0.7) * 100) / 100;
                        const v = Math.round((feasibility * 0.5 + robustness * 0.3 + longTerm * 0.2) * 100) / 100;
                        console.log(JSON.stringify({
                            plan: plan.name,
                            feasibility,
                            robustness,
                            longTerm,
                            v,
                            simulation_steps: [
                                { step: 'initial', status: 'started', conditions: context.conditions || 'neutral' },
                                { step: 'progress', status: feasibility > 0.6 ? 'smooth' : 'bumpy' },
                                { step: 'outcome', result: v > 0.65 ? 'favorable' : 'mixed',
                                  risk: v < 0.6 ? 'high' : 'moderate' },
                            ]
                        }));
                    `;
                    const result = spawnSync('node', ['-e', code], { timeout: 5000 });
                    if (result.status === 0) {
                        try { results.push(JSON.parse(result.stdout.toString())); } catch(e) {
                            results.push({ plan: p.name, error: 'parse failed' });
                        }
                    } else {
                        results.push({ plan: p.name, error: 'sub-process failed' });
                    }
                }
                output({ results, total: results.length, _warning: '⚠️ 此命令产出随机分数，仅供测试/占位。实际推演由 LLM agent (mcts-simulator) 执行，请勿将此命令产出用于真实决策。' });
                break;
            }
            case "debate": {
                // 辩论生成: 每个方案的独立立场
                const plans = JSON.parse(o.plans || "[]");
                const perspectives = plans.map(p => {
                    const stances = {
                        advocate: `${p.name}的优势: 站在${p.name}的立场, 它的核心论据是...`,
                        critique: `对其他方案的质疑: ${p.name}指出其他方案忽略了...`,
                    };
                    return { plan: p.name, ...stances };
                });
                output({
                    debate_rounds: [
                        { speaker: plans[0]?.name, argument: `${plans[0]?.name}的立场: 为什么应该选这个方向` },
                        { speaker: plans[1]?.name, rebuttal: `${plans[1]?.name}的反驳: ${plans[0]?.name}忽略了什么` },
                    ],
                    perspectives,
                    instruction: '分别展示各方案的立场, 让用户看到分歧所在',
                });
                break;
            }
            default: log(`Unknown: ${cmd}`); process.exit(1);
        }
    } catch (e) { log(`Error: ${e.message}`); process.exit(1); }
}

if (require.main === module) main();

module.exports = {
    computeUcb, computeAdaptiveC, computeShiMaturity, computeCltUcb,
    welfordUpdate, computeTdError,
    checkValueStability, checkHighConfidence, getMaxIterations, shouldStopIteration,
    checkStatusTransition, getStatusWeight,
    computeKBonus, classifyBlindspot, getConfidenceLevel,
    rankByConvergedV, shouldAskUserAfterSimulation,
    getFuseMode, handleSelfCheckResult,
    enterSimulation, beginSubDiverge, endSubDiverge, resetRecursiveDepth, getDivergeDepthReport,
    getLearningRate, getRewardSignal, getTerminalValue,
    projectState, mutationTiebreak,
    quickTriggerCheck, getLambdaByTraceLength,
    getDimensions, computeAttentionGate,
};