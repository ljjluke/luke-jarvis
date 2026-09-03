/**
 * step-names.js — 步骤命名单一真源 + 历史兼容层
 *
 * 问题: 历史数据(ndjson/MMA)里 step 字段新旧名+中文名混杂:
 *   新名(标准): shensi/divergence/bagua/plans/converge/simulate/debate/synthesis
 *   旧名: dimension(=bagua)/simulations(=simulate)/verification(已废,八步无此步)
 *   中文: 神思/发散/八卦镜/收敛/综合 ...
 * 直接前缀匹配 [step:bagua] 召不回历史用 [step:dimension] 存的数据 → 历史召回断链。
 *
 * 单一真源 = SKILL.md 八步。所有入口读入先 normalizeStep() 归一化,
 * 召回时用 matchStepPrefix() 把全部别名都当前缀候选。
 */

// 标准十步(SKILL.md 单一真源,顺序即管线顺序)
// interview = 需求打磨+无知自检(步骤守卫用)
// score = 方案评分(8维度评分), simulate = 推演(情景模拟)
const STEPS = ['interview', 'shensi', 'divergence', 'bagua', 'plans', 'converge', 'score', 'simulate', 'debate', 'synthesis'];

// 别名 → 标准名(历史兼容)
// dimension=旧版bagua, simulations=旧版simulate(复数), verification=已废八步外步骤
// 中文名=早期实验数据
// 旧版 simulate 同时含评分+推演,新版拆为 score+simulate
const ALIASES = {
  // bagua
  'dimension': 'bagua',
  '八卦镜': 'bagua',
  'baguaMirror': 'bagua',
  // score (方案评分)
  '评分': 'score',
  '方案评分': 'score',
  // simulate (推演)
  'simulations': 'simulate',
  'simulate_draft': 'simulate',
  'mcts': 'simulate',
  '推演': 'simulate',
  '模拟': 'simulate',
  // shensi
  '神思': 'shensi',
  'shen': 'shensi',
  // divergence
  '发散': 'divergence',
  'diverge': 'divergence',
  // converge
  '收敛': 'converge',
  'convergence': 'converge',
  // plans
  '方案': 'plans',
  'plan': 'plans',
  // debate
  '辩论': 'debate',
  // synthesis
  '综合': 'synthesis',
  'conclude': 'synthesis',
  // interview (需求打磨+无知自检)
  '需求打磨': 'interview',
  '采访': 'interview',
  '画像': 'interview',
  '无知自检': 'interview',
  // verification — 八步外,归为 null(不再作为有效步骤,但旧数据召回时降级到 debate 的近邻)
  'verification': null,
  'verify': null,
};

/**
 * 归一化步骤名 → 标准八步名
 * 已是标准名 → 原样返回
 * 是别名 → 返回标准名
 * 未知/空/null映射 → 返回原值(不崩,调用方自己处理)
 */
function normalizeStep(stepName) {
  if (!stepName || typeof stepName !== 'string') return stepName;
  var s = stepName.trim();
  // 标准名直接过
  if (STEPS.indexOf(s) !== -1) return s;
  // 查别名表
  if (ALIASES.hasOwnProperty(s)) return ALIASES[s];
  // 未知名(测试名如 teststep/test_q)→ 原样返回,不归一化(测试数据保留原样便于排查)
  return s;
}

/**
 * 判断一个步骤名是否为有效步骤(标准八步之一,归一化后)
 */
function isValidStep(stepName) {
  var n = normalizeStep(stepName);
  return n && STEPS.indexOf(n) !== -1;
}

/**
 * 给定标准名,返回它可能出现在历史数据里的全部前缀字符串(含自身+别名)
 * 用于召回时扩展前缀匹配,避免历史数据用旧名存而召不回。
 * 例如 normalizeStep('bagua') 后, matchStepPrefix('bagua') 返回 ['bagua','dimension','八卦镜','baguaMirror']
 */
function allStepNamesFor(standardName) {
  var names = [standardName];
  for (var alias in ALIASES) {
    if (ALIASES[alias] === standardName) names.push(alias);
  }
  return names;
}

/**
 * 判断一个历史条目的 description 是否属于给定步骤(扩展前缀匹配)
 * @param {string} desc — 历史条目的 description
 * @param {string} stepName — 当前要查的步骤名(会先归一化)
 * @returns {boolean}
 */
function matchStepPrefix(desc, stepName) {
  if (!desc || !stepName) return false;
  var std = normalizeStep(stepName);
  if (!std) return desc.indexOf('[step:' + stepName + ']') === 0;
  var names = allStepNamesFor(std);
  for (var i = 0; i < names.length; i++) {
    if (desc.indexOf('[step:' + names[i] + ']') === 0) return true;
  }
  return false;
}

/**
 * 步骤 → MMA category 映射(单一真源,替代散落各处的三元判断)
 */
function categoryFor(stepName) {
  var s = normalizeStep(stepName);
  switch (s) {
    case 'shensi':
    case 'divergence': return 'judgment_and_strategy';
    case 'bagua': return 'core_decision';
    case 'plans': return 'input_and_output';
    case 'converge': return 'dependencies_and_coordination';
    case 'score': return 'dependencies_and_coordination';
    case 'simulate': return 'dependencies_and_coordination';
    case 'debate': return 'structure_and_framework';
    case 'synthesis': return 'efficiency_and_resources';
    default: return 'tools_and_means';
  }
}

module.exports = {
  STEPS: STEPS,
  normalizeStep: normalizeStep,
  isValidStep: isValidStep,
  allStepNamesFor: allStepNamesFor,
  matchStepPrefix: matchStepPrefix,
  categoryFor: categoryFor,
};
