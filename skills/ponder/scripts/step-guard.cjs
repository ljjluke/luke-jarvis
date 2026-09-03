#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *  step-guard.cjs — 步骤强制守卫
 *  "不积跬步，无以至千里" —《荀子·劝学》
 * ═══════════════════════════════════════════════════════════════
 *
 *  Ponder 管线10步必须顺序执行，不可跳过。
 *  此守卫用文件持久化步骤完成状态，LLM每步前后必须调用。
 *
 *  命令:
 *    node step-guard.cjs init <问题摘要>           — 初始化新运行
 *    node step-guard.cjs before <步骤名>           — 检查前置步骤是否完成
 *    node step-guard.cjs after <步骤名> [子agent数] [certainty] — 记录步骤完成(可选:确定性0-1)
 *    node step-guard.cjs status                    — 查看当前运行进度
 *    node step-guard.cjs reset                    — 清除运行状态
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataRoot } = require('./_lib/runtime-paths.cjs');

const DATA_DIR = dataRoot;

const GUARD_FILE = path.join(DATA_DIR, 'step-guard.cjson');

// 步骤顺序（单一真源，与 step-names.cjs 一致）
const STEPS = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis'];

// 步骤中文标签
const LABELS = {
  interview: '需求打磨',
  shensi: '神思',
  divergence: '发散',
  bagua: '八卦镜',
  plans: '方案',
  converge: '收敛',
  score: '方案评分',
  simulate: '推演',
  debate: '辩论',
  synthesis: '综合',
};

// 步骤图标
const ICONS = {
  interview: '📋',
  shensi: '💭',
  divergence: '🔭',
  bagua: '🔍',
  plans: '📋',
  converge: '🎯',
  score: '📊',
  simulate: '🎬',
  debate: '⚔️',
  synthesis: '🏆',
};

// 子agent最小数量（0=主线程，无子agent）
const MIN_AGENTS = {
  interview: 0,
  shensi: 0,
  divergence: 0,
  bagua: 8,
  plans: 5,
  converge: 0,
  score: 3,    // 收敛阶段至少保留3个幸存方案，必须全部评分
  simulate: 3, // 每个幸存方案都必须推演
  debate: 3,   // 每个幸存方案都必须立论
  synthesis: 0,
};

// ── 工具函数 ──

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadState() {
  try {
    if (fs.existsSync(GUARD_FILE)) {
      return JSON.parse(fs.readFileSync(GUARD_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { run_id: null, question: '', completed: [], agents: {}, certainties: {}, started_at: null };
}

function saveState(state) {
  ensureDir();
  const tmp = GUARD_FILE + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(tmp, GUARD_FILE);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function generateRunId() {
  return 'run_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function normalizeStepName(step) {
  if (!step || typeof step !== 'string') return step;
  var s = step.trim();
  if (STEPS.indexOf(s) !== -1) return s;
  // 常见别名
  var aliases = {
    '需求打磨': 'interview', '采访': 'interview', '画像': 'interview', '无知自检': 'interview',
    '神思': 'shensi', 'shen': 'shensi',
    '发散': 'divergence', 'diverge': 'divergence',
    '八卦镜': 'bagua', 'dimension': 'bagua', 'baguaMirror': 'bagua',
    '方案': 'plans', 'plan': 'plans',
    '收敛': 'converge', 'convergence': 'converge',
    '评分': 'score', '方案评分': 'score', 'score': 'score',
    '推演': 'simulate', 'simulations': 'simulate', 'mcts': 'simulate', '模拟': 'simulate',
    '辩论': 'debate',
    '综合': 'synthesis', 'conclude': 'synthesis',
  };
  if (aliases[s]) return aliases[s];
  return s;
}

// ── 命令实现 ──

/**
 * init — 初始化新运行
 */
function init(question) {
  var state = {
    run_id: generateRunId(),
    question: question || '',
    completed: [],
    agents: {},
    certainties: {},
    started_at: new Date().toISOString(),
  };
  saveState(state);
  return {
    verdict: 'INITIALIZED',
    run_id: state.run_id,
    total_steps: STEPS.length,
    message: '运行已初始化，从 ' + LABELS[STEPS[0]] + '(' + STEPS[0] + ') 开始',
  };
}

/**
 * before — 检查前置步骤是否完成
 */
function before(step) {
  var stdStep = normalizeStepName(step);
  var state = loadState();

  if (!state.run_id) {
    return {
      verdict: 'BLOCKED',
      step: stdStep,
      message: '⛔ 运行未初始化，请先调用 step-guard.cjs init <问题摘要>',
    };
  }

  var idx = STEPS.indexOf(stdStep);
  if (idx === -1) {
    return {
      verdict: 'UNKNOWN_STEP',
      step: step,
      valid_steps: STEPS,
      message: '未知步骤 "' + step + '"，有效步骤: ' + STEPS.join('/'),
    };
  }

  // 检查所有前置步骤
  var missing = [];
  for (var i = 0; i < idx; i++) {
    if (state.completed.indexOf(STEPS[i]) === -1) {
      missing.push(STEPS[i]);
    }
  }

  if (missing.length > 0) {
    var missingLabels = missing.map(function(s) { return LABELS[s] + '(' + s + ')'; });
    return {
      verdict: 'BLOCKED',
      step: stdStep,
      label: LABELS[stdStep] || stdStep,
      missing: missing,
      missing_labels: missingLabels,
      message: '⛔ 必须先完成 ' + missingLabels.join(' → ') + ' 才能执行 ' + (LABELS[stdStep] || stdStep) + '(' + stdStep + ')',
    };
  }

  return {
    verdict: 'OK',
    step: stdStep,
    label: LABELS[stdStep] || stdStep,
    completed_so_far: state.completed,
    completed_count: state.completed.length,
    total_count: STEPS.length,
    upstream_certainties: state.certainties || {},
    message: LABELS[stdStep] + ' 前置步骤已完成，可以执行',
  };
}

/**
 * after — 记录步骤完成
 */
function after(step, agentCount, certainty) {
  var stdStep = normalizeStepName(step);
  var state = loadState();

  if (!state.run_id) {
    return {
      verdict: 'ERROR',
      message: '⛔ 运行未初始化，请先调用 step-guard.cjs init',
    };
  }

  var idx = STEPS.indexOf(stdStep);
  if (idx === -1) {
    return {
      verdict: 'ERROR',
      message: '未知步骤 "' + step + '"',
    };
  }

  // 幂等：已记录则跳过
  if (state.completed.indexOf(stdStep) !== -1) {
    var remaining = STEPS.filter(function(s) { return state.completed.indexOf(s) === -1; });
    return {
      verdict: 'ALREADY_RECORDED',
      step: stdStep,
      label: LABELS[stdStep] || stdStep,
      completed_count: state.completed.length,
      total_count: STEPS.length,
      remaining: remaining,
      message: LABELS[stdStep] + ' 已记录过，无需重复',
    };
  }

  // after 也必须执行前序校验，防止调用方绕过 before 直接推进。
  var prerequisite = before(stdStep);
  if (prerequisite.verdict !== 'OK') {
    return prerequisite;
  }

  var parsedAgentCount = agentCount === undefined || agentCount === null
    ? 0
    : parseInt(agentCount, 10) || 0;
  var minimumAgents = MIN_AGENTS[stdStep] || 0;
  if (parsedAgentCount < minimumAgents) {
    return {
      verdict: 'BLOCKED',
      step: stdStep,
      required_agents: minimumAgents,
      received_agents: parsedAgentCount,
      message: '⛔ ' + LABELS[stdStep] + ' 至少需要 ' + minimumAgents + ' 个完整 Subagent 结果，当前仅有 ' + parsedAgentCount + ' 个',
    };
  }

  if (certainty !== undefined && certainty !== null) {
    var parsedCertainty = parseFloat(certainty);
    if (isNaN(parsedCertainty) || parsedCertainty < 0 || parsedCertainty > 1) {
      return {
        verdict: 'BLOCKED',
        step: stdStep,
        message: '⛔ certainty 必须是 0 到 1 之间的数值',
      };
    }
  }

  // 记录
  state.completed.push(stdStep);
  state.agents[stdStep] = parsedAgentCount;
  // 记录确定性（可选，0-1浮点数，不传则不记录）
  if (certainty !== undefined && certainty !== null) {
    state.certainties[stdStep] = parseFloat(certainty);
  }
  saveState(state);

  var remaining = STEPS.filter(function(s) { return state.completed.indexOf(s) === -1; });

  var nextMsg = '';
  if (remaining.length > 0) {
    var next = remaining[0];
    nextMsg = ' → 下一步: ' + (LABELS[next] || next) + '(' + next + ') ⛔必须继续执行，禁止在此结束';
  } else {
    nextMsg = ' ✅ 全部步骤已完成，可进入用户确认阶段';
  }

  // 确定性摘要（供 LLM 参考调整下游深度）
  var certaintySummary = '';
  var certKeys = Object.keys(state.certainties);
  if (certKeys.length > 0) {
    var certVals = certKeys.map(function(k) { return state.certainties[k]; });
    var avgCert = certVals.reduce(function(a, b) { return a + b; }, 0) / certVals.length;
    certaintySummary = ' | 平均确定性: ' + avgCert.toFixed(2) + ' (';
    if (avgCert >= 0.8) certaintySummary += '高度收敛→下游可精简深度';
    else if (avgCert <= 0.4) certaintySummary += '高度不确定→下游需充分探索';
    else certaintySummary += '中等→按默认深度执行';
    certaintySummary += ')';
  }

  return {
    verdict: 'RECORDED',
    step: stdStep,
    label: LABELS[stdStep] || stdStep,
    agents: state.agents[stdStep] || 0,
    certainty: state.certainties[stdStep] !== undefined ? state.certainties[stdStep] : null,
    completed_count: state.completed.length,
    total_count: STEPS.length,
    remaining: remaining,
    upstream_certainties: state.certainties,
    message: LABELS[stdStep] + ' 已完成 (' + state.completed.length + '/' + STEPS.length + ')' + certaintySummary + nextMsg,
  };
}

/**
 * status — 查看当前运行进度
 */
function status() {
  var state = loadState();

  if (!state.run_id) {
    return { verdict: 'NO_RUN', message: '当前无运行记录' };
  }

  var table = STEPS.map(function(s) {
    var done = state.completed.indexOf(s) !== -1;
    return {
      step: s,
      label: LABELS[s] || s,
      icon: ICONS[s] || '',
      status: done ? '✅ 已完成' : '❌ 未执行',
      agents: state.agents[s] || 0,
      certainty: state.certainties && state.certainties[s] !== undefined ? state.certainties[s] : null,
    };
  });

  var current = null;
  for (var i = 0; i < STEPS.length; i++) {
    if (state.completed.indexOf(STEPS[i]) === -1) {
      current = STEPS[i];
      break;
    }
  }

  var remaining = STEPS.filter(function(s) { return state.completed.indexOf(s) === -1; });

  return {
    verdict: 'STATUS',
    run_id: state.run_id,
    question: state.question,
    started_at: state.started_at,
    completed_count: state.completed.length,
    total_count: STEPS.length,
    current: current ? { step: current, label: LABELS[current] || current } : null,
    remaining: remaining,
    certainties: state.certainties || {},
    progress: table,
  };
}

/**
 * reset — 清除运行状态
 */
function reset() {
  var state = { run_id: null, question: '', completed: [], agents: {}, certainties: {}, started_at: null };
  saveState(state);
  return { verdict: 'RESET', message: '运行状态已清除' };
}

// ── CLI 入口 ──

function main() {
  var args = process.argv.slice(2);
  var cmd = args[0];

  var result;
  switch (cmd) {
    case 'init':
      result = init(args.slice(1).join(' '));
      break;
    case 'before':
      result = before(args[1] || '');
      break;
    case 'after':
      result = after(args[1] || '', args[2], args[3]);
      break;
    case 'status':
      result = status();
      break;
    case 'reset':
      result = reset();
      break;
    default:
      result = {
        verdict: 'USAGE',
        message: '用法:',
        commands: [
          '  node step-guard.cjs init <问题摘要>           — 初始化新运行',
          '  node step-guard.cjs before <步骤名>           — 检查前置步骤是否完成',
          '  node step-guard.cjs after <步骤名> [子agent数] [certainty] — 记录步骤完成(可选:确定性0-1)',
          '  node step-guard.cjs status                    — 查看当前运行进度',
          '  node step-guard.cjs reset                    — 清除运行状态',
        ],
        steps: STEPS,
      };
  }

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();

module.exports = { init, before, after, status, reset, STEPS, LABELS, normalizeStepName };
