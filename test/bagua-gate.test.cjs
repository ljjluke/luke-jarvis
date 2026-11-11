// 独立测试八卦镜完整性校验逻辑（复制 skills/ponder/scripts/orchestrate.cjs 中的校验函数逻辑）。
// D8 修复：原版硬编码读 /tmp/bagua4.json（文件不存在即 fail，且 node --test 下不是合法用例）。
// 现在改为 node:test 用例 + 每个用例自己造临时夹具；缺宿主模块（node:test 不可用）时显式 skip 而非 fail。
// 运行：node --test test/bagua-gate.test.cjs

let test = null
let assert = null
try {
  test = require('node:test').test
  assert = require('node:assert')
} catch {
  // 宿主模块缺失（极简 node/裁剪运行时）→ 显式 skip，不让测试套挂成失败
  test = null
}
if (!test) {
  console.log('SKIP: node:test 不可用（缺宿主模块），跳过八卦镜完整性校验测试')
  process.exit(0)
}

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
      var matched = expectedFacets[fi].keys.some(function (k) { return name.indexOf(k.toLowerCase()) !== -1; });
      if (matched) {
        covered[fi] = true;
        if (content.length < 8) baguaIssues.push('维度 ' + (d.name || '第' + (di + 1) + '项') + ' 的盲点内容为空/过短');
        break;
      }
    }
    if (name && expectedFacets.every(function (f, i) { return !f.keys.some(function (k) { return name.indexOf(k.toLowerCase()) !== -1; }); })) {
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

/** 造一个临时「4 维 run」夹具（原版从 /tmp/bagua4.json 读，现已去掉硬编码） */
function real4Fixture() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bagua4-'));
  const file = path.join(dir, 'bagua4.json');
  fs.writeFileSync(file, JSON.stringify({
    dimensions: [
      { name: 'F1驱动力', blindspot: '驱动因素只列了技术层，漏了组织推动力' },
      { name: 'F2基础', blindspot: '基础条件假设了单团队、多项目共享场景未验' },
      { name: 'F5风险', blindspot: '隐藏风险是误杀合法跨阶段动作' },
      { name: 'F7边界', blindspot: '边界没写清 72h 判据的适用期' },
    ],
  }));
  return file;
}

test('八卦镜完整性：真实 4 维 run → 被拦并点名缺 4 维', () => {
  const fs = require('node:fs');
  const real4 = JSON.parse(fs.readFileSync(real4Fixture(), 'utf8'));
  const issues = checkBagua(real4);
  assert.ok(issues.length > 0, '只有 4 维必须被拦');
  assert.ok(issues.join(' ').includes('缺 4 个维度未覆盖'), `须点名缺维：${issues.join('; ')}`);
});

test('八卦镜完整性：完整 8 维且每维有实质盲点 → 通过', () => {
  const full8 = {
    dimensions: [
      { name: 'F1驱动力', blindspot: '驱动力被忽略的是人工补闸痕迹' },
      { name: 'F2基础', blindspot: '基础条件漏了 team.json 写时机' },
      { name: 'F3变化', blindspot: '变化因素低估了版本升级影响' },
      { name: 'F4渗透', blindspot: '影响面漏了 computeStage 的共用方' },
      { name: 'F5风险', blindspot: '隐藏风险是假收口' },
      { name: 'F6依附', blindspot: '深层依附是 agent-teams 私有存储' },
      { name: 'F7边界', blindspot: '边界没写 peer optional 适用范围' },
      { name: 'F8平衡', blindspot: '相关方漏了装包用户视角' },
    ],
  };
  assert.deepStrictEqual(checkBagua(full8), []);
});

test('八卦镜完整性：空输出 → 被拦', () => {
  const issues = checkBagua({});
  assert.ok(issues.length > 0 && issues[0].includes('没有任何维度'), `空输出须被拦：${issues}`);
});

test('八卦镜完整性：8 条但重复维度缺 F2 → 报缺且点名', () => {
  const dup8 = {
    dimensions: [
      { name: 'F1驱动力', blindspot: 'a'.repeat(30) },
      { name: 'F1驱动力', blindspot: 'a'.repeat(30) },
      { name: 'F3变化', blindspot: 'c'.repeat(30) },
      { name: 'F4渗透', blindspot: 'd'.repeat(30) },
      { name: 'F5风险', blindspot: 'e'.repeat(30) },
      { name: 'F6依附', blindspot: 'f'.repeat(30) },
      { name: 'F7边界', blindspot: 'g'.repeat(30) },
      { name: 'F8平衡', blindspot: 'h'.repeat(30) },
    ],
  };
  const issues = checkBagua(dup8);
  assert.ok(issues.length > 0 && issues.join(' ').includes('F2'), `重复维度须报缺 F2：${issues.join('; ')}`);
});
