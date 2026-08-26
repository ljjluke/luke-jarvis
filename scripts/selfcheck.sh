#!/usr/bin/env bash
# luke-jarvis 发布/安装自检（防 bug：发布前与安装后各跑一次）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1) 核心插件语法 =="
node --check src/host/plugin.js && echo "   HOST-OK"
node --check src/client/plugin.js && echo "   CLIENT-OK"

echo "== 2) 插件可被 ESM 加载并导出 apply =="
node -e "import('./src/host/plugin.js').then(m=>{if(!m.default||typeof m.default.apply!=='function'){console.error('BAD: host 未导出 apply');process.exit(1)};console.log('   HOST apply=OK')})"

echo "== 3) 角色库 JSON 合法 =="
for f in roles/*.json roles/domains/*.json docs/community-entry.example.json package.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" >/dev/null 2>&1 || { echo "   BAD: $f"; exit 1; }
done
echo "   ROLES-OK"

echo "== 4) 铁律落位（防 bug 核心） =="
R=$(grep -l "现场蒸馏\|动态蒸馏\|真实情况优先" src/host/plugin.js skills/jarvis-roles.md roles/ceo-protocol.md preset/agent.cordis.yml 2>/dev/null | wc -l)
[ "$R" -ge 4 ] && echo "   铁律已内嵌(≥4 处文件): $R" || { echo "   铁律缺失: $R"; exit 1; }

echo "== 5) distill 校验四检查（source/六段式/协同架构/防冒名） =="
grep -q "validateCardShape" src/host/plugin.js && grep -q "协同架构" src/host/plugin.js && grep -q "source" src/host/plugin.js && grep -q "防冒名" src/host/plugin.js && echo "   DISTILL-CHECKS-OK" || { echo "   DISTILL-CHECKS-MISSING"; exit 1; }

echo "== 6) 单元测试（node --test） =="
node --test test/plugin.test.js >/dev/null 2>&1 && echo "   TESTS-OK" || { echo "   TESTS-FAIL"; exit 1; }

echo "== 7) 端到端流程（入口→蒸馏→保真度→协同→建队） =="
node test/e2e-flow.test.mjs >/dev/null 2>&1 && echo "   E2E-OK" || { echo "   E2E-FAIL"; exit 1; }

echo ""
echo "✅ 全部通过：luke-jarvis 可发布/可安装。"