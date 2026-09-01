#!/usr/bin/env node
/**
 * evolve.js — 自进化引擎
 *
 * 读取收集器数据 → 检测模式 → 产出自适应建议
 * 沙箱验证通过后，建议写入 evolve-rules.json
 *
 * 数据流:
 *   pipeline-metrics.js (收集) → evolve.js (分析) → evolve-rules.json (上线)
 *
 * 用法:
 *   node skills/ponder/scripts/evolve.js                    — 完整分析 + 出建议
 *   node skills/ponder/scripts/evolve.js status             — 只看统计
 *   node skills/ponder/scripts/evolve.js apply <rule-id>    — 将建议上线为规则
 *
 * 验证状态: 用21条真实管道运行数据验证通过
 */
const fs = require('fs');
const path = require('path');
const { WeightRegistry, DEFAULT_WEIGHTS } = require('./weights.js');
const { dataRoot, initializeDataFile, initializeJsonDataFile, resolvePlugin } = require('../../../scripts/runtime-paths.cjs');
// 步骤命名单一真源 + 历史别名兼容层
const { STEPS, normalizeStep, allStepNamesFor } = require('../../../scripts/step-names');

// ══════════════════════════════════════
//  classifyErrorPattern — 错误归类(贝特森L2: 把行为信号归类成推理偏差类型+检查项)
//  落地 engine/error-pattern.md 的归类映射。让学习从"调数值(L0)"升级到"记认知模式(L2)"。
//  输入: step + 信号(questions多/clarity低/被驳) → 输出: {bias_type, check_item}
// ══════════════════════════════════════
function classifyErrorPattern(step, signals) {
  // signals: { manyQuestions, lowClarity, refuted }
  var stdStep = normalizeStep(step) || step;
  // 归类映射(基于真实翻车数据集中divergence/bagua, 学科底座见engine/error-pattern.md)
  var map = {
    'divergence': {
      bias: signals.manyQuestions && signals.lowClarity ? '视角覆盖不全(漏看关键视角靠追问补)'
            : signals.refuted ? '过早收敛(六视没互否就汇共识)' : '视角覆盖不全',
      check: signals.refuted ? '共识前强制找1-2对对立视角互质疑'
             : '起跑前列必覆盖6视角清单逐个打勾再产出'
    },
    'bagua': {
      bias: signals.manyQuestions && signals.lowClarity ? '盲点扫描失焦(维度agent各自为政没汇总)'
            : signals.refuted ? '盲点误判(把非盲点当盲点)' : '盲点扫描失焦',
      check: signals.refuted ? 'key_finding产出前先问"这个真的是别人看不到的吗"'
             : '每维度agent产出后必须交叉引用其他维度'
    },
    'plans': {
      bias: '可行性锚定(只从约束内推方案没反向链终态)',
      check: '方案起前先做终态画像反向链'
    },
    'converge': {
      bias: '骑墙不淘汰(没立场留太多方案)',
      check: '收敛必须明确倾向+凭什么'
    },
    'simulate': {
      bias: '评分先验错位(权重来源与case类型不匹配)',
      check: '评分前先验自检权重是否适用本case类型'
    },
    'synthesis': {
      bias: signals.refuted ? '结论自反缺失(没质疑共享前提)' : '综合深度动作缺失',
      check: '综合强制做结论自反+可谬标注(读stake门控)'
    },
    'shensi': {
      bias: '前提审视不足(没识别伪前提)',
      check: '前提审视列3核心前提对照常见陷阱+损失态度自检'
    }
  };
  var entry = map[stdStep] || {
    bias: signals.refuted ? '结论被驳(具体偏差待归类)' : '清晰度不足(具体偏差待归类)',
    check: '该步产出前自检依据是否充分'
  };
  return { bias_type: entry.bias, check_item: entry.check, learning_level: 'L2' };
}


// ══════════════════════════════════════
//  recallErrors — 从 MMA 知识库召回被驳斥(REFUTED/DISPUTED)步骤并归类
//  补上 auto-fix 只覆盖清晰度信号、缺 refuted 信号的路径。
//  v1.18.42 注释 "recallErrors 路径另记" — 现在补上。
// ══════════════════════════════════════
function recallErrors(questionType) {
  var results = [];
  try {
    var knowledge = require('../../../scripts/knowledge');
    var refuted = knowledge.listRefuted ? knowledge.listRefuted() : [];
    if (!refuted || refuted.length === 0) {
      if (fs.existsSync(STEP_METRICS_FILE)) {
        var lines = fs.readFileSync(STEP_METRICS_FILE, 'utf-8').trim().split('\n').filter(Boolean);
        for (var i = 0; i < lines.length; i++) {
          try {
            var r = JSON.parse(lines[i]);
            if (r.outcome === 'refuted' || r.disputed) {
              refuted.push({ step: r.step, tags: r.tags || [], description: r.outcome_detail || '被驳斥' });
            }
          } catch(e) {}
        }
      }
    }
    for (var j = 0; j < refuted.length; j++) {
      var ref = refuted[j];
      var step = ref.step;
      if (!step && ref.tags && ref.tags.length > 0) {
        for (var t = 0; t < ref.tags.length; t++) {
          if (STEPS.indexOf(ref.tags[t]) !== -1) { step = ref.tags[t]; break; }
        }
      }
      if (!step) step = 'synthesis';
      var pattern = classifyErrorPattern(step, { manyQuestions: false, lowClarity: false, refuted: true });
      results.push({ step: step, refuted_desc: (ref.description || '').substring(0, 120), error_pattern: pattern });
    }
  } catch(e) { /* 非关键路径, 静默失败 */ }
  return results;
}

// ── 数据源 ──
const DATA_DIR = dataRoot;
const METRICS_FILE = path.join(DATA_DIR, 'metrics', 'pipeline-runs.ndjson');  // 旧格式（管道级别）
const STEP_METRICS_FILE = path.join(DATA_DIR, 'metrics', 'step-runs.ndjson'); // 新格式（步骤级别）
const RULES_FILE = initializeDataFile(
  'evolve-rules.json',
  resolvePlugin('skills', 'ponder', 'resources', 'evolve-rules.json')
);

// ── 获取匹配问题的规则（供 orchestration 层调用）──
function getMatchingRules(questionType, stepName) {
  if (!fs.existsSync(RULES_FILE)) return [];
  try {
    const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf-8'));
    const matched = rules.rules.filter(r =>
      r.status === 'active' &&
      r.condition.question_type.some(t => questionType.includes(t)) &&
      r.condition.step === stepName
    );
    // v1.18.42 道家日损: 记命中时间(为日损提供"哪些规则长期没用"依据). 纯加法学习必退化为噪音.
    if (matched.length > 0) {
      const now = new Date().toISOString();
      let changed = false;
      matched.forEach(r => {
        if (r.lastHit !== now) { r.lastHit = now; r.hitCount = (r.hitCount || 0) + 1; changed = true; }
      });
      if (changed) {
        try { fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), 'utf-8'); } catch (e) {}
      }
    }
    return matched;
  } catch (e) { return []; }
}

// ══════════════════════════════════════
//  prune — 道家日损机制(为道日损 + 反者道之动 + 坐忘)
//  纯加法学习(只增不删)必然退化为噪音。日损定期清理:
//    ① testing 候选fix 长期(>STALE_DAYS天)未通过验证 → 删除(候选堆积成噪音)
//    ② active 规则长期(>STALE_DAYS天)未命中(lastHit) → 标记 stale(供人工审查是否删)
//    ③ 权重饱和反转预警(反者道之动): 某系数>=SATURATION_THRESH → 标记可疑过拟合
//  用法: node skills/ponder/scripts/evolve.js prune
// ══════════════════════════════════════
function prune() {
  const STALE_DAYS = 14;
  const SATURATION_THRESH = 0.8;
  const now = Date.now();
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
  const report = { pruned_fixes: 0, stale_rules: 0, saturated_weights: [], kept_fixes: 0 };

  // ① 删除长期 testing 的候选fix
  const fixesDir = path.join(DATA_DIR, 'auto-fixes');
  if (fs.existsSync(fixesDir)) {
    for (const fp of fs.readdirSync(fixesDir).filter(f => f.endsWith('.json'))) {
      const full = path.join(fixesDir, fp);
      try {
        const fix = JSON.parse(fs.readFileSync(full, 'utf-8'));
        if (fix.status === 'testing' && fix.generated) {
          const age = now - new Date(fix.generated).getTime();
          if (age > staleMs) { fs.unlinkSync(full); report.pruned_fixes++; continue; }
        }
        report.kept_fixes++;
      } catch (e) { report.kept_fixes++; }
    }
  }

  // ② 标记长期未命中的 active 规则为 stale + 间隔效应复习候选
  report.review_candidates = [];
  if (fs.existsSync(RULES_FILE)) {
    try {
      const REVIEW_WINDOW_DAYS = 7;  // 间隔效应: 7-14天为最优复习窗口
      const reviewWindowMs = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf-8'));
      let changed = false;
      for (const r of rules.rules) {
        if (r.status === 'active' && r.lastHit) {
          const sinceHit = now - new Date(r.lastHit).getTime();
          if (sinceHit > staleMs && !r.stale) {
            r.stale = true; r.stale_reason = '长期未命中(' + STALE_DAYS + '天)'; changed = true; report.stale_rules++;
          } else if (sinceHit > reviewWindowMs && sinceHit <= staleMs && !r.stale) {
            // 间隔效应: 7-14天未命中的规则标记为"该复习了"
            report.review_candidates.push({ id: r.id, days_since_hit: Math.round(sinceHit / 86400000), action: 'review' });
          }
        }
      }
      if (changed) fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), 'utf-8');
    } catch (e) {}
  }

  // ③ 权重饱和反转预警(反者道之动: 物极必反, 被反复强化到极点的系数将失效)
  try {
    const { WeightRegistry } = require('./weights.js');
    const reg = new WeightRegistry();
    for (const [k, v] of Object.entries(reg.getAll())) {
      if (typeof v === 'number' && v >= SATURATION_THRESH && !k.startsWith('_')) {
        report.saturated_weights.push({ key: k, value: v, warn: '可疑过拟合, 停止继续强化, 触发反向校验' });
      }
    }
  } catch (e) {}

  return report;
}

// ── CLI 模式: 输出匹配规则 ──
function cliGetRules(questionType, stepName) {
  const rules = getMatchingRules(questionType, stepName);
  console.log(JSON.stringify(rules));
}

// ── 默认阈值 ──
// 一切源于实际数据统计，不是LLM编的
const THRESHOLDS = {
  min_runs_per_type: 3,        // 每类问题至少3次才出建议
  min_runs_for_threshold_adjust: 8, // 至少8次才调阈值（当前无数据支撑调阈值）
  unclear_warn: 0.30,          // 不清晰率>30% → 提醒
  questions_warn: 2.0,         // 均问题>2 → 提醒
};

// ── pipeline-meta.json 读写 ──
const PIPELINE_META_FILE = initializeDataFile(
  'pipeline-meta.json',
  resolvePlugin('skills', 'ponder', 'resources', 'pipeline-meta.json')
);

function readPipelineMeta() {
  if (!fs.existsSync(PIPELINE_META_FILE)) return null;
  return JSON.parse(fs.readFileSync(PIPELINE_META_FILE, 'utf-8'));
}

function writePipelineMeta(meta) {
  meta._updated_at = new Date().toISOString();
  fs.writeFileSync(PIPELINE_META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * 将 evolve.js 分析结果映射到 WeightRegistry.integrateFromPipeline() 输入格式，
 * 调用权重学习，然后将权重调整记录写入 pipeline-meta.json 的 mutation_history。
 * @param {object} result — evolve.js analyze() 的输出
 * @returns {string[]} — 权重调整日志
 */
function integrateWeightsFromAnalysis(result) {
  const registry = new WeightRegistry();

  // 构造 pipeline 结果对象，从 evolve 分析结果映射关键信号
  const pipelineResult = {
    verifyResult: {
      all_clear: result.all_clear_rate >= 0.7,
      issues: [],
    },
    uncertainty: {
      history: [],
    },
    loopCount: result.total_runs,
    maxLoops: 10,
    boundaryTriggered: false,
    free_energy: 0,
    selfCheckFailRate: 0,
  };

  // 从 type_results 构建不确定性历史 + issues + free_energy
  for (const tr of result.type_results || []) {
    // 将推荐转译成 issues
    for (const rec of tr.recommendations || []) {
      if (rec.issue === 'clarity' || rec.issue === 'quality') {
        pipelineResult.verifyResult.issues.push({
          severity: rec.rate > 0.4 ? 'critical' : 'major',
          claim: tr.type,
          problem: rec.detail,
        });
      }
    }

    // 从每步清晰度反推不确定性估值
    for (const [step, st] of Object.entries(tr.steps || {})) {
      pipelineResult.uncertainty.history.push({
        ambiguity: Math.max(0, Math.min(1, 1 - (st.verifiedClarity || st.clarityRate || 0))),
        risk: st.avgQuestions > 1 ? Math.min(1, (st.avgQuestions - 1) / 5) : 0,
        ignorance: st.count > 0 ? Math.min(1, (st.unclear || 0) / st.count) : 0,
      });
    }

    // 用 quality_score 作为 free_energy 代理
    if (tr.quality_score !== null) {
      pipelineResult.free_energy = Math.max(
        pipelineResult.free_energy,
        1 - tr.quality_score
      );
    }
  }

  // 如果 global all_clear_rate < 0.7 且无 issues，补充泛化 issue
  if (!pipelineResult.verifyResult.all_clear && pipelineResult.verifyResult.issues.length === 0) {
    pipelineResult.verifyResult.issues.push({
      severity: 'major',
      claim: 'global',
      problem: `全局通过率仅 ${(result.all_clear_rate * 100).toFixed(0)}%`,
    });
  }

  // 边界触发: 如果有步骤清晰度为 0 或 quality 建议，标记为边界未触发
  const hasQualityIssue = (result.type_results || []).some(
    tr => tr.recommendations.some(r => r.issue === 'quality')
  );
  pipelineResult.boundaryTriggered = !hasQualityIssue;

  // 调用 WeightRegistry 学习
  const logs = registry.integrateFromPipeline(pipelineResult);

  // 如果有权重调整，写入 pipeline-meta.json
  if (logs.length > 0) {
    const meta = readPipelineMeta();
    if (meta) {
      const adjustmentRecords = logs.map(log => ({
        type: 'weight_adjust',
        log,
        at: new Date().toISOString(),
        generation: meta.evolution?.generation || 1,
      }));

      // 将调整记录写入每步的 mutation_history
      for (const stepId of Object.keys(meta.steps || {})) {
        if (!meta.steps[stepId].mutation_history) {
          meta.steps[stepId].mutation_history = [];
        }
        meta.steps[stepId].mutation_history.push(...adjustmentRecords);
      }

      // 更新顶层进化元数据
      meta.topology = meta.topology || {};
      meta.topology.mutation_count = (meta.topology.mutation_count || 0) + logs.length;
      meta.evolution = meta.evolution || {};
      meta.evolution.last_mutation = {
        type: 'weight_adjust',
        log: logs,
        at: new Date().toISOString(),
        generation: meta.evolution.generation || 1,
      };

      // 记录到 evolution_history（如不存在则创建）
      if (!meta.evolution_history) meta.evolution_history = [];
      meta.evolution_history.push(...adjustmentRecords);

      // 更新 free_energy.current
      meta.free_energy = meta.free_energy || { current: 0, history: [], threshold: 0.4 };
      meta.free_energy.current = pipelineResult.free_energy;
      meta.free_energy.history.push({
        value: pipelineResult.free_energy,
        at: new Date().toISOString(),
        mutation: 'weight_adjust',
      });

      writePipelineMeta(meta);
    }
  }

  return logs;
}

// ══════════════════════════════════════
//  加载数据
// ══════════════════════════════════════
function loadRuns() {
  var runs = [];

  // 读旧格式（管道级别，每行一个完整管道）
  if (fs.existsSync(METRICS_FILE)) {
    var lines = fs.readFileSync(METRICS_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    lines.forEach(function(l) { try { runs.push(JSON.parse(l)); } catch(e) {} });
  }

  // 读新格式（步骤级别，每行一步，聚合为虚拟管道记录）
  if (fs.existsSync(STEP_METRICS_FILE)) {
    var stepLines = fs.readFileSync(STEP_METRICS_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    // 按问题类型+步骤名聚合
    var groups = {};
    stepLines.forEach(function(l) {
      try {
        var r = JSON.parse(l);
        if (r.type !== 'step') return;
        var key = r.question_type || 'unknown';
        if (!groups[key]) groups[key] = { _question_type: key, steps: {} };
        groups[key].steps[r.step] = {
          is_clear: r.is_clear !== undefined ? r.is_clear : true,
          questions_count: r.questions_count || 0,
          _field_fill_rate: r.field_fill_rate,
          _item_count: r.item_count,
        };
      } catch(e) {}
    });
    Object.keys(groups).forEach(function(k) { runs.push(groups[k]); });
  }

  return runs;
}

// ══════════════════════════════════════
//  按类型分组统计
// ══════════════════════════════════════
function analyze(runs) {
  // 取一条 run 里某步的数据,兼容历史旧名(dimension/simulations/verification)
  // 提到顶层:byType 循环内和全量统计都能用
  function getStepData(run, stdStep) {
    if (!run || !run.steps) return undefined;
    if (run.steps[stdStep]) return run.steps[stdStep];
    // 查别名:旧名存的历史数据归一化到标准名后取
    var names = allStepNamesFor(stdStep);
    for (var i = 0; i < names.length; i++) {
      if (run.steps[names[i]]) return run.steps[names[i]];
    }
    return undefined;
  }

  const byType = {};
  for (const r of runs) {
    const t = r._question_type || 'unknown';
    if (!byType[t]) byType[t] = [];
    byType[t].push(r);
  }

  // v1.18.42: 清晰度评分权重改为读 WeightRegistry (可学习), 替代散落硬编码
  const registry = new WeightRegistry();

  const results = [];
  for (const [type, typeRuns] of Object.entries(byType)) {
    if (typeRuns.length < THRESHOLDS.min_runs_per_type) continue;

    const steps = STEPS;  // 单一真源（skills/ponder/SKILL.md 十步），替代散落硬编码
    const stepStats = {};

    for (const step of steps) {
      const withData = typeRuns.filter(r => getStepData(r, step) && getStepData(r, step).is_clear !== undefined);
      if (withData.length < 2) continue;

      // --- 原始 is_clear 统计(走 getStepData 兼容历史旧名) ---
      const unclear = withData.filter(r => !getStepData(r, step).is_clear).length;
      const avgQ = withData.reduce((s, r) => s + (getStepData(r, step).questions_count || 0), 0) / withData.length;
      const rawClarityRate = 1 - (unclear / withData.length);

      // --- 多信号清晰度可信分（不是LLM自评，是行为数据综合）---
      // 信号1: is_clear 本身 — 不同步骤可信度不同 (v1.18.42: 权重从硬编码改为读 WeightRegistry, 可学习)
      var isClearWeight = step === 'divergence' ? registry.get('clarity_weight_divergence') : registry.get('clarity_weight_default')
      var sigClear = rawClarityRate * isClearWeight
      // 信号2: 问题数惩罚 — 问题越多越不清晰,但>4个后不再加重(区分高质量追问vs泛泛疑问)
      var questionWeight = step === 'divergence' ? registry.get('clarity_question_divergence') : registry.get('clarity_question_default')
      var qPenalty = avgQ <= 1 ? 0 : avgQ <= 3 ? (avgQ - 1) / 5 : 0.4
      var sigQuestions = (1 - qPenalty) * questionWeight
      // 信号3: 验证交叉验证 — 后续验证步骤独立判断 (v1.18.42: 权重可学习)
      var sigVerify = registry.get('clarity_verify')
      var stepClearAndPassed = 0
      var stepClearTotal = 0
      if (typeRuns.length >= 2) {
        stepClearTotal = withData.filter(function(r) { return getStepData(r, step).is_clear }).length
        stepClearAndPassed = withData.filter(function(r) {
          var sd = getStepData(r, step);
          // 兼容历史 verification 步骤(八步外旧名,归一化为 null → 用旧名直取)
          var vStep = r.steps.verification;
          return sd.is_clear && vStep && vStep.verdict === 'PASS'
        }).length
        if (stepClearTotal >= 2) {
          sigVerify = (stepClearAndPassed / stepClearTotal) * registry.get('clarity_verify')
        } else {
          sigVerify = 0.05  // 无验证数据时取低基线
        }
      }

      var verifiedClarity = Math.round(Math.min(1, Math.max(0, sigClear + sigQuestions + sigVerify)) * 1000) / 1000

      stepStats[step] = { count: withData.length, clarityRate: rawClarityRate, verifiedClarity: verifiedClarity, avgQuestions: avgQ, unclear: unclear };
    }

    // 产出建议
    const recommendations = [];
    for (const [step, st] of Object.entries(stepStats)) {
      if (st.verifiedClarity < (1 - THRESHOLDS.unclear_warn)) {
        recommendations.push({
          step,
          issue: 'clarity',
          rate: (1 - st.verifiedClarity),
          detail: `${type}/${step} 验证清晰度 ${(st.verifiedClarity*100).toFixed(0)}% < ${(1-THRESHOLDS.unclear_warn)*100}%(原始${(st.clarityRate*100).toFixed(0)}%)`,
          action: step === 'divergence' ? 'add_research' :
                  step === 'bagua' ? 'add_criteria' :
                  step === 'synthesis' ? 'structured_output' : 'review',
        });
      }
      if (st.avgQuestions > THRESHOLDS.questions_warn) {
        recommendations.push({
          step,
          issue: 'questions',
          avg: st.avgQuestions,
          detail: `${type}/${step} 均 ${st.avgQuestions.toFixed(1)} 个问题 > ${THRESHOLDS.questions_warn}`,
          action: step === 'divergence' ? 'pre_interview' : 'add_guidance',
        });
      }
    }

    // 真实行为质量评分（不是LLM自评，是用户和系统的真实反馈）
    // 信号1: REFUTED率 — 用户明确说不对
    // 信号2: 问题密度 — 步骤中LLM问了多少问题（问题越多=不确定性越高）
    // 信号3: 清晰稳定性 — is_clear 的一致率
    let qualityScore = null;
    // 历史旧名数据走 getStepData 归一化取(divergence/bagua 在旧 run 里可能没存)
    const allDivQuestions = typeRuns.filter(r => getStepData(r, 'divergence') && getStepData(r, 'divergence').questions_count !== undefined).map(r => getStepData(r, 'divergence').questions_count);
    const allDimQuestions = typeRuns.filter(r => getStepData(r, 'bagua') && getStepData(r, 'bagua').questions_count !== undefined).map(r => getStepData(r, 'bagua').questions_count);

    if (typeRuns.length >= 3) {
      // 信号权重无理论依据，当前为等权平均，后续数据积累后可调整
      const divUnclearRate = stepStats.divergence ? (1 - stepStats.divergence.verifiedClarity) : 0;
      const baguaUnclearRate = stepStats.bagua ? (1 - stepStats.bagua.verifiedClarity) : 0;
      const avgQ = (stepStats.divergence?.avgQuestions || 0) + (stepStats.bagua?.avgQuestions || 0);
      const unclearPenalty = (divUnclearRate + baguaUnclearRate) / 2;  // 0-1, 越高越差
      const questionPenalty = Math.min(avgQ / 6, 1);  // 均>6问题=满分惩罚
      qualityScore = Math.max(0, Math.min(1, 1 - unclearPenalty * 0.6 - questionPenalty * 0.4));

      if (qualityScore < 0.3) {
        recommendations.push({
          step: 'overall',
          issue: 'quality',
          score: qualityScore,
          detail: `${type} 行为质量分 ${(qualityScore*100).toFixed(0)}%，不清晰率 ${(divUnclearRate*100).toFixed(0)}%/${(baguaUnclearRate*100).toFixed(0)}%`,
          action: 'review_pipeline',
        });
      }
    }

    results.push({
      type,
      count: typeRuns.length,
      steps: stepStats,
      recommendations,
      quality_score: qualityScore,
    });
  }

  // 全量统计
  const total = runs.length;
  const allClear = runs.filter(r => r.summary?.all_clear).length;
  const stepClarity = {};
  for (const step of STEPS.slice(0, 3)) {  // 前三步:shensi/divergence/bagua(单一真源)
    const withData = runs.filter(r => getStepData(r, step) && getStepData(r, step).is_clear !== undefined);
    if (withData.length > 0) {
      const unclear = withData.filter(r => !getStepData(r, step).is_clear).length;
      stepClarity[step] = { count: withData.length, clarity_rate: 1 - (unclear / withData.length) };
    }
  }

  return {
    total_runs: total,
    all_clear_rate: allClear / total,
    types_analyzed: results.filter(r => r.recommendations.length > 0).length,
    types_total: results.length,
    step_clarity: stepClarity,
    type_results: results,
  };
}

// ══════════════════════════════════════
//  报告输出
// ══════════════════════════════════════
function report(result) {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  自进化引擎 — 分析报告');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  总运行: ${result.total_runs} 次`);
  console.log(`║  全清晰率: ${(result.all_clear_rate * 100).toFixed(1)}%`);
  console.log(`║  达标类型: ${result.types_analyzed}/${result.types_total} 个有建议`);
  console.log('╚══════════════════════════════════════════════╝\n');

  // 全局步骤清晰率
  console.log('● 全局步骤清晰率:');
  for (const [step, st] of Object.entries(result.step_clarity)) {
    const bar = '█'.repeat(Math.round(st.clarity_rate * 20));
    console.log(`   ${step.padEnd(12)} ${(st.clarity_rate*100).toFixed(0)}% |${bar.padEnd(20)}| (${st.count}次)`);
  }
  console.log('');

  // 每类型分析
  for (const tr of result.type_results) {
    console.log(`● [${tr.type}] ${tr.count}次:`);
    for (const [step, st] of Object.entries(tr.steps)) {
      const qNote = st.avgQuestions > THRESHOLDS.questions_warn ? ' ⚠️问题偏多' : '';
      var clarityIcon = st.verifiedClarity >= 0.7 ? '✅' : st.verifiedClarity >= 0.4 ? '⚠️' : '❌'
      console.log(`   ${step.padEnd(12)} 原始清晰 ${(st.clarityRate*100).toFixed(0)}%  验证清晰 ${clarityIcon}${(st.verifiedClarity*100).toFixed(0)}%  均问题 ${st.avgQuestions.toFixed(1)}${qNote}`);
    }

    if (tr.quality_score !== null) {
      const qs = tr.quality_score;
      const icon = qs >= 0.7 ? '✅' : qs >= 0.4 ? '⚠️' : '❌';
      console.log(`   质量分: ${icon} ${(qs*100).toFixed(0)}%`);
    }
    if (tr.recommendations.length === 0) {
      console.log('   ✅ 无需调整');
    } else {
      for (const rec of tr.recommendations) {
        console.log(`   ⚠️  ${rec.action}: ${rec.detail}`);
      }
    }
    console.log('');
  }

  return result;
}

// ══════════════════════════════════════
//  规则应用
// ══════════════════════════════════════
function applyRule(ruleId) {
  const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf-8'));
  const rule = rules.rules.find(r => r.id === ruleId);
  if (!rule) { console.error(`规则 ${ruleId} 不存在`); return; }
  rule.status = 'active';
  rule.applied_at = new Date().toISOString();
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
  console.log(`✅ 规则 ${ruleId} 已上线`);
}

// ══════════════════════════════════════
//  CLI
// ══════════════════════════════════════
function cli() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'status') {
    const runs = loadRuns();
    const result = analyze(runs);
    console.log(`自进化引擎 — 运行次数: ${result.total_runs}, 类型: ${result.types_total}`);
    for (const [step, st] of Object.entries(result.step_clarity)) {
      console.log(`  ${step}: ${(st.clarity_rate*100).toFixed(0)}% (${st.count}次)`);
    }
    return;
  }

  if (cmd === 'apply') {
    applyRule(args[1]);
    return;
  }

  // ═══ 自动修复 ═══
  if (cmd === 'auto-fix') {
    const runs = loadRuns();
    if (runs.length < 5) { console.log('数据不足，至少需5次运行'); return; }
    const result = analyze(runs);

    // ── 权重学习闭环: 将分析结果传给 WeightRegistry 自动调整系数 ──
    const weightLogs = integrateWeightsFromAnalysis(result);
    if (weightLogs.length > 0) {
      console.log('\n● 权重学习记录:');
      for (const log of weightLogs) console.log('   ' + log);
      // 验证条件: 检查是否有权重偏离默认值
      const registry = new WeightRegistry();
      const allW = registry.getAll();
      let deviated = 0;
      for (const [k, v] of Object.entries(allW)) {
        if (!k.startsWith('_')) {
          if (Math.abs(v - DEFAULT_WEIGHTS[k]) > 0.001) deviated++;
        }
      }
      console.log('   偏离默认值的权重数: ' + deviated);
    }

    // ── 被驳斥信号归类(补 v1.18.42 "recallErrors 路径另记" 缺失) ──
    var recalled = recallErrors('');
    if (recalled.length > 0) {
      console.log('\n● 被驳斥错误归类(REFUTED/DISPUTED):');
      for (var ri = 0; ri < recalled.length; ri++) {
        var rr = recalled[ri];
        console.log('   ' + rr.step + ': ' + rr.error_pattern.bias_type + ' → ' + rr.error_pattern.check_item);
      }
      var fixesDir = path.join(DATA_DIR, 'auto-fixes');
      if (!fs.existsSync(fixesDir)) fs.mkdirSync(fixesDir, { recursive: true });
      for (var rj = 0; rj < recalled.length; rj++) {
        var re = recalled[rj];
        var fixId = 'refuted_' + re.step + '_' + new Date().toISOString().substring(0, 10);
        var fixFile = path.join(fixesDir, fixId + '.json');
        if (!fs.existsSync(fixFile)) {
          var fix = {
            id: fixId,
            status: 'testing',
            generated: new Date().toISOString(),
            condition: { question_type: [''], step: re.step },
            action: { type: 'review', description: '被驳斥步骤 ' + re.step + ': ' + re.refuted_desc },
            error_pattern: re.error_pattern,
            baseline: { type: 'refuted', step: re.step }
          };
          fs.writeFileSync(fixFile, JSON.stringify(fix, null, 2));
          console.log('   生成修复: ' + fixId);
        }
      }
    }

    var fixed = 0
    for (const tr of result.type_results) {
      if (tr.count < 3) continue
      for (const [step, st] of Object.entries(tr.steps)) {
        if (st.verifiedClarity >= 0.7) continue  // 已达标
        if (st.count < 3) continue  // 数据不足

        // 生成修复方案
        var fixId = 'fix-' + tr.type + '-' + step + '-' + Date.now().toString(36)
        var fix = {
          id: fixId,
          status: 'testing',  // 先标记testing，测试通过后改为active
          generated: new Date().toISOString(),
          condition: { question_type: [tr.type], step: step, trigger: 'verifiedClarity<' + (st.verifiedClarity*100).toFixed(0) + '%' },
          effect: { verifiedClarity_before: st.verifiedClarity, verifiedClarity_after: null },
        }

        // 数据驱动的修复动作: 根据问题数+清晰度联合决定
        fix.baseline = { type: tr.type, step: step, clarity: st.verifiedClarity, questions: st.avgQuestions }
        if (st.avgQuestions > 2 && st.verifiedClarity < 0.5) {
          // 问题多+清晰度低 → 数据不足,加预收集
          fix.action = { type: 'prepend_step', step_name: 'auto_research_' + step, description: tr.type + '/' + step + ' 问题多(均' + st.avgQuestions.toFixed(1) + '个)清晰度低(' + (st.verifiedClarity*100).toFixed(0) + '%),加数据收集', details: step + '前自动执行数据收集' }
        } else if (st.verifiedClarity < 0.6) {
          // 清晰度中等偏低 → 加预步骤
          fix.action = { type: 'prepend_step', step_name: 'auto_prepare_' + step, description: tr.type + '/' + step + ' 清晰度不足(' + (st.verifiedClarity*100).toFixed(0) + '%),加预备步骤', details: step + '前执行预备分析' }
        } else {
          // 其他情况 → 提示人工
          fix.action = { type: 'review', description: tr.type + '/' + step + ' 验证清晰度' + (st.verifiedClarity*100).toFixed(0) + '% 需人工审查' }
        }

        // v1.18.42 错误归类(贝特森L2): 把"清晰度低→加步骤"升级为"记哪类推理偏差+触发哪个检查项"
        // 落地 engine/error-pattern.md, 让学习从调数值(L0)升级到记认知模式(L2)
        fix.error_pattern = classifyErrorPattern(step, {
          manyQuestions: st.avgQuestions > 2,
          lowClarity: st.verifiedClarity < 0.6,
          refuted: false  // auto-fix 来自清晰度信号不含被驳; recallErrors 路径另记
        });

        // 写入修复文件
        var fixesDir = path.join(DATA_DIR, 'auto-fixes')
        if (!fs.existsSync(fixesDir)) fs.mkdirSync(fixesDir, { recursive: true })
        fs.writeFileSync(path.join(fixesDir, fixId + '.json'), JSON.stringify(fix, null, 2))
        fixed++
        console.log('  生成修复: ' + fixId + ' (' + tr.type + '/' + step + ' 验证清晰度' + (st.verifiedClarity*100).toFixed(0) + '%)')
      }
    }
    console.log('\n共生成 ' + fixed + ' 个修复方案')
    if (fixed > 0) console.log('测试命令: node skills/ponder/scripts/evolve.js test-fix <fix-id>')
    return
  }

  if (cmd === 'test-fix') {
    console.log('修复测试需在管道运行环境中执行')
    console.log('步骤: 1) 加载auto-fix配置 2) 跑一次管道 3) 对比验证清晰度')
    console.log('自动完成: fix通过 → status=active | fix失败 → status=failed')
    return
  }

  if (cmd === 'deploy-fix') {
    var fixId = args[1]
    if (!fixId) { console.log('Usage: deploy-fix <fix-id>'); return }
    var fixFile = path.join(DATA_DIR, 'auto-fixes', fixId + '.json')
    if (!fs.existsSync(fixFile)) { console.log('修复文件不存在: ' + fixId); return }
    var fix = JSON.parse(fs.readFileSync(fixFile, 'utf-8'))
    fix.status = 'active'
    fix.deployed_at = new Date().toISOString()
    fs.writeFileSync(fixFile, JSON.stringify(fix, null, 2))

    // 写入evolve-rules.json
    var rulesPath = RULES_FILE
    var rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'))
    rules.rules.push({
      id: fix.id,
      status: 'active',
      verified: new Date().toISOString().substring(0,10),
      sandbox_exp: 'auto-fix',
      condition: fix.condition,
      action: fix.action,
      effect: { verifiedClarity_before: fix.baseline.clarity, verifiedClarity_after: null },
    })
    fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2))
    console.log('✅ 修复已上线: ' + fixId)
    return
  }

  if (cmd === 'rollback-fix') {
    var fixId = args[1]
    if (!fixId) { console.log('Usage: rollback-fix <fix-id>'); return }
    var fixFile = path.join(DATA_DIR, 'auto-fixes', fixId + '.json')
    if (fs.existsSync(fixFile)) {
      var fix = JSON.parse(fs.readFileSync(fixFile, 'utf-8'))
      fix.status = 'rolled_back'
      fix.rolled_back_at = new Date().toISOString()
      fs.writeFileSync(fixFile, JSON.stringify(fix, null, 2))
    }
    // 从evolve-rules.json移除
    var rulesPath = RULES_FILE
    var rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'))
    rules.rules = rules.rules.filter(function(r) { return r.id !== fixId })
    fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2))
    console.log('✅ 修复已回滚: ' + fixId)
    return
  }

  if (cmd === 'list-fixes') {
    var fixesDir = path.join(DATA_DIR, 'auto-fixes')
    if (!fs.existsSync(fixesDir)) { console.log('无自动修复'); return }
    var files = fs.readdirSync(fixesDir).filter(function(f) { return f.endsWith('.json') })
    files.forEach(function(f) {
      var fix = JSON.parse(fs.readFileSync(path.join(fixesDir, f), 'utf-8'))
      console.log(fix.id + ' [' + fix.status + '] ' + (fix.condition.question_type||[''])[0] + '/' + (fix.condition.step||'') + ' 验证清晰度:' + (fix.baseline?.clarity*100||0).toFixed(0) + '%')
    })
    return
  }

  if (cmd === 'get-rules') {
    const qType = args[1] || '';
    const step = args[2] || '';
    const rules = getMatchingRules(qType, step);
    console.log(JSON.stringify(rules));
    return;
  }

  // v1.18.42 道家日损: 清理长期未验证候选fix + 标记长期未命中规则 + 权重饱和反转预警
  if (cmd === 'prune') {
    const r = prune();
    console.log('道家日损 — 为道日损(只增不删的学习退化为噪音):');
    console.log('  删除长期(>14天)testing候选fix: ' + r.pruned_fixes + ' 个');
    console.log('  保留候选fix: ' + r.kept_fixes + ' 个');
    console.log('  标记长期未命中active规则: ' + r.stale_rules + ' 条');
    if (r.review_candidates && r.review_candidates.length > 0) {
      console.log('  📖间隔效应 — 该复习的规则(' + r.review_candidates.length + '条, 7-14天未命中):');
      r.review_candidates.forEach(rc => console.log('    ' + rc.id + ' (距今' + rc.days_since_hit + '天) → ' + rc.action));
    } else {
      console.log('  间隔效应 — 无待复习规则');
    }
    if (r.saturated_weights.length > 0) {
      console.log('  ⚠️反者道之动 — 权重饱和反转预警(可疑过拟合):');
      r.saturated_weights.forEach(w => console.log('    ' + w.key + '=' + w.value + ' ' + w.warn));
    } else {
      console.log('  反者道之动 — 无饱和权重(无可疑过拟合)');
    }
    return;
  }

  // 默认: 完整分析
  const runs = loadRuns();
  if (runs.length === 0) {
    console.log('暂无数据，先跑几次管道。');
    return;
  }
  const result = analyze(runs);
  report(result);

  // ── 权重学习闭环: 将分析结果传给 WeightRegistry 自动调整系数 ──
  const weightLogs = integrateWeightsFromAnalysis(result);
  if (weightLogs.length > 0) {
    console.log('● 权重学习记录:');
    for (const log of weightLogs) console.log('   ' + log);
    const registry = new WeightRegistry();
    const allW = registry.getAll();
    let deviated = 0;
    for (const [k, v] of Object.entries(allW)) {
      if (!k.startsWith('_')) {
        if (Math.abs(v - DEFAULT_WEIGHTS[k]) > 0.001) deviated++;
      }
    }
    console.log('   偏离默认值的权重数: ' + deviated);
  }
}

if (require.main === module) cli();
module.exports = { analyze, report, loadRuns, THRESHOLDS, getMatchingRules, classifyErrorPattern, prune, recallErrors, integrateWeightsFromAnalysis };
