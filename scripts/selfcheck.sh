#!/usr/bin/env bash
# luke-jarvis 发布/安装自检（防 bug：发布前与安装后各跑一次）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1) 核心插件语法 =="
node --check src/host/plugin.js && echo "   HOST-OK"
node --check src/client/plugin.js && echo "   CLIENT-OK"

echo "== 2) 插件可被 ESM 加载并导出 apply =="
node -e "import('./src/host/plugin.js').then(m=>{if(!m.default||typeof m.default.apply!=='function'){console.error('BAD: host 未导出 apply');process.exit(1)};console.log('   HOST apply=OK')})"

echo "== 3) 配置文件 JSON 合法 =="
for f in docs/community-entry.example.json package.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" >/dev/null 2>&1 || { echo "   BAD: $f"; exit 1; }
done
echo "   JSON-OK"

echo "== 4) 领域无关设计（插件无静态卡/无领域预设） =="
[ ! -d roles ] && echo "   无 roles/ 静态卡目录: OK" || { echo "   FAIL: roles/ 仍存在（插件不应携带静态卡）"; exit 1; }
grep -q "DOMAIN_PROCESS" src/host/plugin.js && { echo "   FAIL: jarvis_process 仍有领域库"; exit 1; } || echo "   jarvis_process 无领域库: OK"
grep -qE "黄峥|巴菲特" src/host/plugin.js && { echo "   FAIL: identifyIndustry 仍有领域关键词"; exit 1; } || echo "   identifyIndustry 无行业关键词: OK"

echo "== 5) 铁律落位（防 bug 核心） =="
R=$(grep -l "现场蒸馏\|项目沉淀\|真实情况优先" src/host/plugin.js skills/jarvis-roles.md skills/jarvis-boss.md preset/agent.cordis.yml 2>/dev/null | wc -l)
[ "$R" -ge 4 ] && echo "   铁律已内嵌(≥4 处文件): $R" || { echo "   铁律缺失: $R"; exit 1; }

echo "== 6) distill 校验四检查（source/六段式/协同架构/防冒名） =="
grep -q "validateCardShape" src/host/plugin.js && grep -q "协同架构" src/host/plugin.js && grep -q "source" src/host/plugin.js && grep -q "防冒名" src/host/plugin.js && echo "   DISTILL-CHECKS-OK" || { echo "   DISTILL-CHECKS-MISSING"; exit 1; }

echo "== 7) 单元测试（node --test） =="
node --test test/plugin.test.js >/dev/null 2>&1 && echo "   TESTS-OK" || { echo "   TESTS-FAIL"; exit 1; }

echo "== 8) 端到端流程（入口→流程→蒸馏→保真度→协同→思考→裁决→问题上行→黑板→沉淀→建队） =="
node test/e2e-flow.test.mjs >/dev/null 2>&1 && echo "   E2E-OK" || { echo "   E2E-FAIL"; exit 1; }

echo "== 9) 新铁律落位（需求本质/问题上行/能力补足/项目沉淀） =="
grep -q "jarvis_essence" src/host/plugin.js && grep -q "jarvis_escalate" src/host/plugin.js && grep -q "jarvis_capability" src/host/plugin.js && grep -q "jarvis_store" src/host/plugin.js && echo "   IRON-RULES-OK (essence/escalate/capability/store 四闸在位)" || { echo "   IRON-RULES-MISSING"; exit 1; }

echo ""
echo "✅ 全部通过：luke-jarvis 可发布/可安装。"