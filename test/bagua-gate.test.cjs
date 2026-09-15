// 独立测试八卦镜完整性校验逻辑（复制 orchestrate 中的校验函数逻辑）
function checkBagua(output) {
  var baguaIssues = [];
  var dims = null;
  if (Array.isArray(output.dimensions)) dims = output.dimensions;
  else if (Array.isArray(output.八维度)) dims = output.八维度;
  var expectedFacets = [
    { keys: ['F1', '驱动力', 'driving', 'motivation', 'force'] },
    { keys: ['F2', '基础', 'foundation', 'base', 'ground'] },
    { keys: ['F3', '变化', 'change', 'uncertain', 'variation'] },
    { keys: ['F4', '渗透', 'penetration', 'propagat', 'spread'] },
    { keys: ['F5', '风险', 'risk', 'vulnerab'] },
    { keys: ['F6', '依附', 'dependency', 'support', 'depend'] },
    { keys: ['F7', '边界', 'boundary', 'constraint', 'limit'] },
    { keys: ['F8', '平衡', 'convergence', 'balance', 'stakeholder'] },
  ];
  var covered = new Array(expectedFacets.length).fill(false);
  if (!dims || dims.length === 0) {
    return ['八卦镜产出没有任何维度（dimensions/八维度 为空）——8 个子 agent 的盲点必须全部收进产出'];
  }
  for (var di = 0; di < dims.length; di++) {
    var d = dims[di] || {};
    var name = String(d.name || d.维度 || d.facet || '').toLowerCase();
    var content = String(d.blindspot || d.key || d.产出 || d.insight || d.content || '').trim();
    for (var fi = 0; fi < expectedFacets.length; fi++) {
      var matched = expectedFacets[fi].keys.some(function(k) { return name.indexOf(k.toLowerCase()) !== -1; });
      if (matched) {
        covered[fi] = true;
        if (content.length < 8) baguaIssues.push('维度 ' + (d.name || '第' + (di+1) + '项') + ' 的盲点内容为空/过短');
        break;
      }
    }
    if (name && expectedFacets.every(function(f, i) { return !f.keys.some(function(k) { return name.indexOf(k.toLowerCase()) !== -1; }); })) {
      baguaIssues.push('维度 "' + (d.name || d.维度) + '" 不在八卦镜 8 维度中');
    }
  }
  var missingFacets = [];
  for (var fi2 = 0; fi2 < expectedFacets.length; fi2++) {
    if (!covered[fi2]) missingFacets.push(expectedFacets[fi2].keys[0] + '(' + expectedFacets[fi2].keys[1] + ')');
  }
  if (missingFacets.length > 0) baguaIssues.push('八卦镜缺 ' + missingFacets.length + ' 个维度未覆盖：' + missingFacets.join('、'));
  return baguaIssues;
}

const fs = require('fs');
// 测试1: 真实4维数据 → 应报缺4维
const real4 = JSON.parse(fs.readFileSync('/tmp/bagua4.json', 'utf8'));
let issues = checkBagua(real4);
console.log('测试1 真实4维run: ' + (issues.length ? '❌ 被拦(' + issues.join('; ') + ')' : '✅ 通过'));
// 测试2: 完整8维 → 应通过
const full8 = { dimensions: [
  {name:'F1驱动力', blindspot:'a'.repeat(30)}, {name:'F2基础', blindspot:'b'.repeat(30)},
  {name:'F3变化', blindspot:'c'.repeat(30)}, {name:'F4渗透', blindspot:'d'.repeat(30)},
  {name:'F5风险', blindspot:'e'.repeat(30)}, {name:'F6依附', blindspot:'f'.repeat(30)},
  {name:'F7边界', blindspot:'g'.repeat(30)}, {name:'F8平衡', blindspot:'h'.repeat(30)},
]};
issues = checkBagua(full8);
console.log('测试2 完整8维: ' + (issues.length ? '❌ 被拦(' + issues.join('; ') + ')' : '✅ 通过'));
// 测试3: 空输出 → 应被拦
issues = checkBagua({});
console.log('测试3 空输出: ' + (issues.length ? '❌ 被拦(' + issues[0] + ')' : '✅ 通过'));
// 测试4: 8个但有重复维度缺1个 → 应报缺
const dup8 = { dimensions: [
  {name:'F1驱动力', blindspot:'a'.repeat(30)}, {name:'F1驱动力', blindspot:'a'.repeat(30)},
  {name:'F3变化', blindspot:'c'.repeat(30)}, {name:'F4渗透', blindspot:'d'.repeat(30)},
  {name:'F5风险', blindspot:'e'.repeat(30)}, {name:'F6依附', blindspot:'f'.repeat(30)},
  {name:'F7边界', blindspot:'g'.repeat(30)}, {name:'F8平衡', blindspot:'h'.repeat(30)},
]};
issues = checkBagua(dup8);
console.log('测试4 重复维度缺F2: ' + (issues.length ? '❌ 被拦(' + issues.join('; ') + ')' : '✅ 通过'));
