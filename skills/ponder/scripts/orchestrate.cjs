#!/usr/bin/env node
/**
 * orchestrate.cjs — 增量式步骤存储 + 流程收尾
 *
 * 不在流程开始前加载任何东西，各步骤独立查询自己的历史。
 * 这个脚本只做两件事:
 *   存一步产出到MMA + 记指标  |  流程结束后的保洁+学习
 *
 * 用法:
 *   node skills/ponder/scripts/orchestrate.cjs step <步骤名> <问题类型> '<步骤输出JSON>'
 *     存一步产出到MMA + 记录该步指标
 *
 *   node skills/ponder/scripts/orchestrate.cjs finalize <问题类型> <问题描述>
 *     知识保洁 + 权重学习 + 进化分析
 *
 *   node skills/ponder/scripts/orchestrate.cjs rules <步骤名> <问题类型>
 *     查本步命中的自适应进化规则（供管线起跑前注入prompt参考）
 */
const fs = require('fs');
const path = require('path');
const { dataRoot, initializeJsonDataFile, resolvePlugin } = require('./_lib/runtime-paths.cjs');

const DATA_DIR = dataRoot;
const META_FILE = initializeJsonDataFile('pipeline-meta.json', resolvePlugin('resources', 'pipeline-meta.json'));

// 延迟加载
var _WeightRegistry = null;
function getWeightRegistry() {
  if (!_WeightRegistry) {
    var wr = require('./weights.cjs');
    _WeightRegistry = new wr.WeightRegistry();
  }
  return _WeightRegistry;
}

// ── History: 查步骤历史（top 3） ──
function queryHistory(stepName, questionType) {
  var result = { entries: [] };
  try {
    var knowledge = require('./_lib/knowledge.cjs');
    var hist = knowledge.recallStepHistory(stepName, questionType, { query: '', limit: 20 });
    if (hist && hist.length > 0) {
      result.entries = hist.slice(0, 3).map(function(h) { return { content: (h.content || '').substring(0, 200), q: h.q, status: h.status }; });
      result.count = hist.length;
      // 消费证据：本次召回命中了哪些知识（可观测）
      result.recalled_ids = hist.slice(0, 3).map(function(h) { return h.id; });
    }
  } catch(e) { result.error = e.message; }
  console.log(JSON.stringify(result));
}

// ── Rules: 查本步命中的自适应进化规则（薄包装 evolve.getMatchingRules） ──
function queryRules(stepName, questionType) {
  var result = { matched: [] };
  try {
    var evolve = require('./evolve.cjs');
    var rules = evolve.getMatchingRules(questionType, stepName);
    if (rules && rules.length > 0) {
      result.matched = rules.map(function(r) {
        return {
          id: r.id,
          step: r.condition && r.condition.step,
          action: r.action && r.action.type,
          description: r.action && r.action.description,
          details: r.action && r.action.details
        };
      });
      result.count = rules.length;
    }
  } catch(e) { result.error = e.message; }
  console.log(JSON.stringify(result));
}

// ── Step: 存一步产出 + 记一步指标 ──
function storeStep(stepName, questionType, stepOutputJson, userRequest, knowledgeEntry) {
  var output;
  // 宽松解析:先试直接 parse,失败则尝试从自然语言中抠出 JSON 块,再失败则降级存原始文本不崩
  function extractJson(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch(e) {}
    // 尝试 ```json ... ``` 代码块
    var m = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) { try { return JSON.parse(m[1]); } catch(e) {} }
    // 尝试第一个 { 到最后一个 } 之间
    var s = str.indexOf('{'), e2 = str.lastIndexOf('}');
    if (s !== -1 && e2 > s) { try { return JSON.parse(str.slice(s, e2+1)); } catch(e) {} }
    return null;
  }
  output = extractJson(stepOutputJson);
  var validJson = !!output;
  if (!output) {
    // 降级:不崩,存原始文本,记 warning,指标用空对象
    console.error('⚠️ 步骤输出非合法JSON,降级存原始文本(step=' + stepName + ')');
    output = { _fallback_raw: true, _raw_text: String(stepOutputJson).slice(0, 2000) };
  }

  var result = { stored: false, metric_recorded: false };
  var orderValid = true;
  var guardState = null;

  // 0. 步骤顺序校验：非法 JSON、未初始化或跳步都不得持久化。
  try {
    var stepGuard = require('./step-guard.cjs');
    guardState = stepGuard.status();
    var stdStep = stepGuard.normalizeStepName(stepName);
    var STEPS = stepGuard.STEPS || [];
    if (STEPS.indexOf(stdStep) !== -1) {
      var guardResult = stepGuard.before(stdStep);
      if (guardResult.verdict !== 'OK') {
        orderValid = false;
        result.step_order_violation = true;
        result.blocked_step = stdStep;
        result.missing_steps = guardResult.missing || [];
        result.message = guardResult.message;
      }
    }
  } catch(e) {
    orderValid = false;
    result.step_order_error = e.message;
  }

  if (!validJson || !orderValid) {
    result.invalid_json = !validJson;
    result.step_guard = 'NOT_ADVANCED';
    console.log(JSON.stringify(result));
    return result;
  }

  // 1. 存步骤产出到MMA
  try {
    var knowledge = require('./_lib/knowledge.cjs');
    // 提取 original_example（抽象提炼后保留的原始案例）
    var originalExample = output && output.original_example ? output.original_example : '';
    var storeResult = knowledge.storeStepOutput(stepName, questionType, stepOutputJson, {
      tags: [questionType],
      user_request: userRequest || '',
      original_example: originalExample,
    });
    result.stored = true;
    if (storeResult && storeResult.id) result.point_id = storeResult.id;
  } catch(e) { console.error('存储步骤产出失败:', e.message); }

  // 1.5 如果提供了提炼后的知识条目，同时存到对应知识文件（philosophy/knowledge）
  // knowledge_entry_JSON: {"description","summary","anchors","tags","knowledge_level","domain","epistemic_status","applicability","original_example"}
  // applicability（适用条件）必填级强烈建议：没有适用条件的结论是格言，无法指导后续决策
  if (knowledgeEntry && typeof knowledgeEntry === 'object' && knowledgeEntry.description) {
    try {
      var knowledgeStore = require('./_lib/knowledge.cjs');
      var knowledgeResult = knowledgeStore.store(knowledgeEntry);
      if (knowledgeResult && knowledgeResult.id) {
        result.knowledge_point_id = knowledgeResult.id;
        result.knowledge_file = knowledgeResult.file;
        if (knowledgeResult.anchors_derived) result.knowledge_anchors_derived = true;
        if (knowledgeResult.level_downgraded_to) result.knowledge_level_downgraded_to = knowledgeResult.level_downgraded_to;
      }
    } catch(e) { console.error('存储提炼知识失败:', e.message); }
  }

  // 2. 记指标
  try {
    var metrics = require('./pipeline-metrics.cjs');
    var record = metrics.collectStep(stepName, output, {
      question_type: questionType,
      user_request: userRequest || '',
      run_id: guardState && guardState.run_id ? guardState.run_id : '',
    });
    metrics.appendStepMetric(record);
    result.metric_recorded = true;
    result.is_clear = record.is_clear;
    result.questions = record.questions_count;
  } catch(e) { console.error('记录指标失败:', e.message); }

  // 3. Guard 由调用方在确认存储成功后，以完整 worker 数和 certainty 显式推进。
  result.step_guard = result.stored && result.metric_recorded ? 'READY_FOR_AFTER' : 'NOT_ADVANCED';

  console.log(JSON.stringify(result));
  return result;
}

// ── Finalize: 所有步骤完成后保洁+学习 ──
function finalize(questionType, userRequest) {
  var result = {
    grooming_done: false,
    weights_learned: false,
    evolve_analyzed: false,
  };

  var guardStatus;
  try {
    guardStatus = require('./step-guard.cjs').status();
  } catch (e) {
    result.error = 'step_guard_unavailable';
    result.detail = e.message;
    console.log(JSON.stringify(result));
    return result;
  }
  if (guardStatus.verdict !== 'STATUS' || guardStatus.remaining.length > 0) {
    result.error = 'incomplete_pipeline';
    result.remaining = guardStatus.remaining || [];
    console.log(JSON.stringify(result));
    return result;
  }

  // 1. 知识保洁
  try {
    var simpleLifecycle = require('./_lib/mma/simple-lifecycle.cjs');
    var groomResult = simpleLifecycle.groomAll();
    result.grooming_done = true;
    result.groomed = Object.keys(groomResult).reduce(function(total, key) { return total + (groomResult[key] || []).length; }, 0);
  } catch(e) { console.error('知识保洁失败:', e.message); }

  // 1.5 计算本次运行的 quality_score (供进化系统计算 free_energy)
  try {
    var metrics = require('./pipeline-metrics.cjs');
    var pMetrics = require('path');
    var mDataDir = pMetrics.join(DATA_DIR, 'metrics');
    var stepLog = pMetrics.join(mDataDir, 'step-runs.ndjson');
    if (require('fs').existsSync(stepLog)) {
      var lines = require('fs').readFileSync(stepLog, 'utf-8').trim().split('\n');
      var currentRunId = guardStatus.run_id;
      var recentSteps = lines.map(function(l) { try { return JSON.parse(l); } catch(e) { return null; } })
        .filter(function(record) {
          return record && record.type === 'step' && record.run_id === currentRunId;
        });
      var clearCount = recentSteps.filter(function(s) { return s.is_clear; }).length;
      var qualityScore = recentSteps.length > 0 ? clearCount / recentSteps.length : 0.5;
      // 写入 quality_score 记录
      var qualityRecord = {
        timestamp: new Date().toISOString(),
        type: 'quality_score',
        question_type: questionType,
        run_id: currentRunId,
        quality_score: Math.round(qualityScore * 100) / 100,
        step_count: recentSteps.length,
        clear_count: clearCount,
      };
      require('fs').appendFileSync(stepLog, JSON.stringify(qualityRecord) + '\n', 'utf-8');
      result.quality_score = qualityScore;
    }
  } catch(e) { /* quality_score 计算失败不阻塞 */ }

  // 2. 进化分析 (先跑分析, 结果驱动后续权重学习)
  var evolve = null;
  var analysis = null;
  try {
    evolve = require('./evolve.cjs');
    var runs = evolve.loadRuns();
    if (runs.length >= 3) {
      analysis = evolve.analyze(runs);
      result.evolve_analyzed = analysis.total_runs > 0;
    }
  } catch(e) { console.error('进化分析失败:', e.message); }

  // 3. 权重学习 (从进化分析结果驱动, 替代占位 learn)
  try {
    var registry = getWeightRegistry();
    if (analysis && evolve && typeof evolve.integrateWeightsFromAnalysis === 'function') {
      var weightLogs = evolve.integrateWeightsFromAnalysis(analysis);
      result.weights_learned = weightLogs.length > 0;
      result.weight_logs = weightLogs;
    } else {
      // 数据不足时回退到冷启动占位学习
      if (registry.weights._total_learns === undefined || registry.weights._total_learns === 0) {
        registry.learn('uncertainty_ambiguity', 0.02);
        result.weights_learned = true;
      }
    }
  } catch(e) { console.error('权重学习失败:', e.message); }

  // 4. pipeline-meta 版本递增
  try {
    if (fs.existsSync(META_FILE)) {
      var meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
      if (meta.evolution) {
        meta.evolution.generation = (meta.evolution.generation || 0) + 1;
        meta.topology = meta.topology || {};
        meta.topology.mutation_count = (meta.topology.mutation_count || 0) + 1;
        meta.free_energy = meta.free_energy || { current: 0, history: [], threshold: 0.4 };
        fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
        result.meta_updated = true;
      }
    }
  } catch(e) { console.error('meta更新失败:', e.message); }

  console.log(JSON.stringify(result));
  return result;
}

function main() {
  var args = process.argv.slice(2);
  var cmd = args[0];

  if (cmd === 'history') {
    queryHistory(args[1] || '', args[2] || '');
  } else if (cmd === 'rules') {
    queryRules(args[1] || '', args[2] || '');
  } else if (cmd === 'step') {
    // 参数弹性解析：args[4] 既可能是 userRequest（自然语言）也可能是 knowledge_entry（JSON）
    // 若 args[4] 以 { 开头则视为 knowledge_entry，userRequest 留空
    var userRequest = '';
    var knowledgeEntry = null;
    if (args[4]) {
      var trimmed = String(args[4]).trim();
      if (trimmed.startsWith('{')) {
        try { knowledgeEntry = JSON.parse(trimmed); } catch(e) { userRequest = args[4]; }
      } else {
        userRequest = args[4];
      }
    }
    if (args[5]) {
      try { knowledgeEntry = JSON.parse(args[5]); } catch(e) {}
    }
    storeStep(args[1] || '', args[2] || '', args[3] || '{}', userRequest, knowledgeEntry);
  } else if (cmd === 'finalize') {
    finalize(args[1] || '', args[2] || '');
  } else {
    console.log('用法:');
    console.log('  node skills/ponder/scripts/orchestrate.cjs history <步骤名> <问题类型>          — 查top3历史');
    console.log('  node skills/ponder/scripts/orchestrate.cjs rules <步骤名> <问题类型>            — 查本步命中的进化规则');
    console.log('  node skills/ponder/scripts/orchestrate.cjs step <步骤名> <问题类型> \'<JSON>\' [用户请求] [knowledge_entry_JSON] - 存一步产出+记指标');
    console.log('  node skills/ponder/scripts/orchestrate.cjs finalize <问题类型> <问题描述>        — 保洁+学习');
  }
}

if (require.main === module) main();
module.exports = { storeStep, finalize, queryRules };
