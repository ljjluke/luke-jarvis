#!/usr/bin/env node
/**
 * pipeline-metrics.js — 增量式步骤指标收集器
 *
 * 每步结束后单独记录，不再等完整管道跑完才收集。
 *
 * 用法:
 *   node skills/ponder/scripts/pipeline-metrics.js step <步骤名> '<步骤输出JSON>'  — 记录一步
 *   node skills/ponder/scripts/pipeline-metrics.js log                              — 查看日志
 *   node skills/ponder/scripts/pipeline-metrics.js status                           — 统计概览
 */
const fs = require('fs');
const path = require('path');
const { resolveData } = require('../../../scripts/runtime-paths.cjs');

const DATA_DIR = resolveData('metrics');
const STEP_LOG = path.join(DATA_DIR, 'step-runs.ndjson'); // 每步一条记录
const OLD_LOG = path.join(DATA_DIR, 'pipeline-runs.ndjson'); // 旧管道格式（兼容读取）

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 收集单步指标（增量式）
 * @param {string} stepName — 步骤名: interview|shensi|divergence|bagua|plans|converge|score|simulate|debate|synthesis
 * @param {object} stepOutput — 该步骤的结构化输出（agent schema 返回的对象）
 * @param {object} opts — 可选: { question_type, user_request, run_id }
 * @returns {object} 记录的指标对象
 */
function collectStep(stepName, stepOutput, opts = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    type: 'step',
    step: stepName,
    question_type: opts.question_type || '',
    user_request: opts.user_request || '',
    run_id: opts.run_id || '',
    is_clear: stepOutput.is_clear !== undefined ? stepOutput.is_clear : true,
    questions_count: Array.isArray(stepOutput.user_questions) ? stepOutput.user_questions.length : 0,
    questions: stepOutput.user_questions || [],
    certainty: typeof stepOutput.certainty === 'number' ? stepOutput.certainty : null,
  };
  if (stepOutput.reasoning_dynamics) record.reasoning_dynamics = stepOutput.reasoning_dynamics;

  // 神思步骤: 收集赌注判定(全链门控的单一真源,立场层空转根因的落盘点)
  if (stepName === 'shensi') {
    record.has_stake = !!stepOutput.stake;
    record.stake_level = (stepOutput.stake && stepOutput.stake.level) || 'missing';
    if (stepOutput.stake && stepOutput.stake.criteria) record.stake_criteria = stepOutput.stake.criteria;
  }

  // 按步骤类型提取结构化字段
  if (stepName === 'divergence' && stepOutput.perspectives) {
    var filledSources = stepOutput.perspectives.filter(function(p) { return p.data_source && p.data_source.length > 0 }).length;
    record.field_fill_rate = filledSources / stepOutput.perspectives.length;
    record.item_count = stepOutput.perspectives.length;
  } else if (stepName === 'bagua' && stepOutput.dimensions) {
    var filledEvidence = stepOutput.dimensions.filter(function(d) { return d.evidence && d.evidence.length > 0 }).length;
    record.field_fill_rate = filledEvidence / stepOutput.dimensions.length;
    record.item_count = stepOutput.dimensions.length;
  } else if (stepName === 'plans' && stepOutput.plans) {
    record.item_count = stepOutput.plans.length;
  } else if (stepName === 'converge' && stepOutput.survivors) {
    record.item_count = stepOutput.survivors.length;
  } else if (stepName === 'score') {
    var scorecards = stepOutput.scorecards || stepOutput.scores || stepOutput.scored || [];
    if (Array.isArray(scorecards)) record.item_count = scorecards.length;
  } else if (stepName === 'simulate' && Array.isArray(stepOutput)) {
    record.item_count = stepOutput.length;
  } else if (stepName === 'debate' && stepOutput.ranked) {
    record.item_count = stepOutput.ranked.length;
  }

  return record;
}

/**
 * 写入一步指标到日志（追加）
 */
function appendStepMetric(record) {
  ensureDir();
  fs.appendFileSync(STEP_LOG, JSON.stringify(record) + '\n', 'utf-8');
}

/**
 * 全量统计（兼容新旧两种日志格式）
 */
function statusReport() {
  const stepRecords = [];
  const oldRecords = [];

  // 读新格式
  if (fs.existsSync(STEP_LOG)) {
    var lines = fs.readFileSync(STEP_LOG, 'utf-8').trim().split('\n').filter(Boolean);
    lines.forEach(function(l) {
      try { stepRecords.push(JSON.parse(l)); } catch(e) {}
    });
  }

  // 读旧格式（兼容）
  if (fs.existsSync(OLD_LOG)) {
    var oldLines = fs.readFileSync(OLD_LOG, 'utf-8').trim().split('\n').filter(Boolean);
    oldLines.forEach(function(l) {
      try { oldRecords.push(JSON.parse(l)); } catch(e) {}
    });
  }

  if (stepRecords.length === 0 && oldRecords.length === 0) return { total: 0 };

  // 按步骤名分组（新格式）
  var byStep = {};
  stepRecords.forEach(function(r) {
    if (!byStep[r.step]) byStep[r.step] = [];
    byStep[r.step].push(r);
  });

  var stepStats = {};
  for (var stepName in byStep) {
    var recs = byStep[stepName];
    var unclear = recs.filter(function(r) { return !r.is_clear }).length;
    var totalQuestions = recs.reduce(function(s, r) { return s + (r.questions_count || 0) }, 0);
    stepStats[stepName] = {
      count: recs.length,
      clear_rate: recs.length > 0 ? 1 - (unclear / recs.length) : 0,
      avg_questions: recs.length > 0 ? (totalQuestions / recs.length) : 0,
    };
    // 神思步骤额外统计赌注判定覆盖率(验证stake落盘是否生效,修复前=0%)
    if (stepName === 'shensi') {
      var withStake = recs.filter(function(r) { return r.has_stake }).length;
      var highStake = recs.filter(function(r) { return r.stake_level === 'high' }).length;
      stepStats[stepName].stake_coverage_rate = recs.length > 0 ? withStake / recs.length : 0;
      stepStats[stepName].high_stake_rate = withStake > 0 ? highStake / withStake : 0;
    }
  }

  // 旧格式兼容: 提取前两个步骤的清晰率
  if (oldRecords.length > 0) {
    var divSteps = oldRecords.filter(function(r) { return r.steps && r.steps.divergence && r.steps.divergence.is_clear !== undefined });
    var dimSteps = oldRecords.filter(function(r) { return r.steps && r.steps.dimension && r.steps.dimension.is_clear !== undefined });
    if (!stepStats.divergence && divSteps.length > 0) {
      var unc = divSteps.filter(function(r) { return !r.steps.divergence.is_clear }).length;
      stepStats.divergence = { count: divSteps.length, clear_rate: 1 - unc / divSteps.length, avg_questions: 0 };
    }
    if (!stepStats.dimension && dimSteps.length > 0) {
      var unc2 = dimSteps.filter(function(r) { return !r.steps.dimension.is_clear }).length;
      stepStats.dimension = { count: dimSteps.length, clear_rate: 1 - unc2 / dimSteps.length, avg_questions: 0 };
    }
  }

  return {
    total: stepRecords.length,
    step_stats: stepStats,
  };
}

// ── CLI ──
function main() {
  var args = process.argv.slice(2);
  var cmd = args[0];

  if (cmd === 'step') {
    var stepName = args[1];
    var outputJson = args[2];
    if (!stepName || !outputJson) { console.error('用法: node pipeline-metrics.js step <步骤名> \'<输出JSON>\''); process.exit(1); }
    var output;
    try { output = JSON.parse(outputJson); } catch(e) {
      // 宽松解析:尝试从自然语言中抠 JSON,再失败则降级空对象不崩
      var m = String(outputJson).match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) { try { output = JSON.parse(m[1]); } catch(e2) {} }
      if (!output) {
        var s = String(outputJson).indexOf('{'), e3 = String(outputJson).lastIndexOf('}');
        if (s !== -1 && e3 > s) { try { output = JSON.parse(String(outputJson).slice(s, e3+1)); } catch(e4) {} }
      }
      if (!output) { console.error('⚠️ 指标采集:输出非合法JSON,降级空对象(step=' + stepName + ')'); output = {}; }
    }
    var record = collectStep(stepName, output);
    appendStepMetric(record);
    console.log(JSON.stringify({ recorded: stepName, is_clear: record.is_clear, questions: record.questions_count }));

  } else if (cmd === 'log') {
    if (!fs.existsSync(STEP_LOG)) { console.log('暂无数据'); return; }
    var lines = fs.readFileSync(STEP_LOG, 'utf-8').trim().split('\n').filter(Boolean);
    console.log('共 ' + lines.length + ' 条记录\n');
    var tail = lines.slice(-15);
    tail.forEach(function(l) {
      try {
        var r = JSON.parse(l);
        var icon = r.is_clear ? '✅' : '❌';
        console.log(icon + ' [' + (r.step || '?').padEnd(10) + '] ' + r.question_type + ' 问题:' + (r.questions_count || 0));
      } catch(e) {}
    });

  } else if (cmd === 'status') {
    var s = statusReport();
    if (s.total === 0 && Object.keys(s.step_stats || {}).length === 0) { console.log('暂无数据'); return; }
    console.log('按步骤统计:');
    for (var stepName in (s.step_stats || {})) {
      var st = s.step_stats[stepName];
      var bar = '█'.repeat(Math.round(st.clear_rate * 20));
      var line = '  ' + stepName.padEnd(12) + ' ' + (st.clear_rate * 100).toFixed(0) + '% |' + bar.padEnd(20) + '| (' + st.count + '次, 均' + st.avg_questions.toFixed(1) + '问题)';
      if (stepName === 'shensi' && st.stake_coverage_rate !== undefined) {
        line += '\n               赌注判定覆盖率: ' + (st.stake_coverage_rate * 100).toFixed(0) + '% | 高赌注占比: ' + (st.high_stake_rate * 100).toFixed(0) + '%';
      }
      console.log(line);
    }

  } else {
    console.log('用法:');
    console.log('  node skills/ponder/scripts/pipeline-metrics.js step <步骤名> \'<JSON>\'   — 记录一步');
    console.log('  node skills/ponder/scripts/pipeline-metrics.js log                       — 查看日志');
    console.log('  node skills/ponder/scripts/pipeline-metrics.js status                    — 统计概览');
  }
}

if (require.main === module) main();

module.exports = { collectStep, appendStepMetric, statusReport, STEP_LOG, OLD_LOG, DATA_DIR };
