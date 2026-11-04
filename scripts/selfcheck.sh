#!/usr/bin/env bash
# luke-jarvis 发布/安装自检（防 bug：发布前与安装后各跑一次）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1) 核心插件语法 =="
node --check src/host/plugin.js && echo "   HOST-OK"

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
R=$(grep -l "现场蒸馏\|项目沉淀\|真实情况优先" src/host/plugin.js skills/jarvis.md preset/agent.cordis.yml README.md 2>/dev/null | wc -l)
[ "$R" -ge 3 ] && echo "   铁律已内嵌(≥3 处文件): $R" || { echo "   铁律缺失: $R"; exit 1; }

echo "== 6) distill 校验四检查（source/六段式/协同架构/防冒名） =="
grep -q "validateCardShape" src/host/plugin.js && grep -q "协同架构" src/host/plugin.js && grep -q "source" src/host/plugin.js && grep -q "防冒名" src/host/plugin.js && echo "   DISTILL-CHECKS-OK" || { echo "   DISTILL-CHECKS-MISSING"; exit 1; }

echo "== 7) 单元测试（node --test） =="
node --test test/plugin.test.js >/dev/null 2>&1 && echo "   TESTS-OK" || { echo "   TESTS-FAIL"; exit 1; }

echo "== 8) 端到端流程（入口→流程→蒸馏→保真度→协同→思考→裁决→问题上行→黑板→沉淀→建队） =="
node test/e2e-flow.test.mjs >/dev/null 2>&1 && echo "   E2E-OK" || { echo "   E2E-FAIL"; exit 1; }

echo "== 9) 新铁律落位（需求本质/问题上行/能力补足/项目记忆库/深度闸/蒸馏引导/版本交付/绩效换人） =="
grep -q "jarvis_essence" src/host/plugin.js && grep -q "jarvis_escalate" src/host/plugin.js && grep -q "jarvis_capability" src/host/plugin.js && grep -q "jarvis_store" src/host/plugin.js && grep -q "assessCardDepth" src/host/plugin.js && grep -q "jarvis_distill_guide" src/host/plugin.js && grep -q "jarvis_release" src/host/plugin.js && grep -q "jarvis_perf" src/host/plugin.js && echo "   IRON-RULES-OK (essence/escalate/capability/store/deep/guide/release/perf 八闸在位)" || { echo "   IRON-RULES-MISSING"; exit 1; }

echo "== 9.5) 安装配置正确性（persona prefix——dsh-persona schema 要求 prefix 必填，用户安装后不该手动修） =="
grep -q "    prefix: >-" preset/agent.cordis.yml && echo "   PRESET-PREFIX-OK（preset/agent.cordis.yml persona 用 prefix 字段）" || { echo "   PRESET-PREFIX-FAIL（persona 须用 prefix 不是 text——dsh-persona schema: prefix required）"; exit 1; }

echo "== 9.6) agent-teams 成员委托深度（memberMaxDepth——ponder 在成员环境起子 agent 必需，默认0会拦） =="
grep -q "memberMaxDepth: 2" cordis.patch.yml && echo "   MEMBER-DEPTH-OK（patch 含 memberMaxDepth: 2，用户安装自动带上）" || { echo "   MEMBER-DEPTH-FAIL（缺 memberMaxDepth——成员跑 ponder 八卦镜会 delegation limit 0 卡死）"; exit 1; }

echo "== 10) 蒸馏深度硬闸行为实测（浅层卡须被拦） =="
node -e "
import('./src/host/plugin.js').then(async (m) => {
  const VOID = ['身份定位：高管。','思维模型：很强（跨域复现：有；生成力：有）。','核心方法论：方法论。','代表作品：作品——只借鉴框架，不冒充署名。','决策红线：底线。','语言风格：简洁。','我的协同：本角色位置=上游；依赖=产品给契约；给测试喂接口；升级=CEO。','证据链：著作+对话+表达+他者+决策+时间线。','保真度：一手0.6；矛盾保留。','诚实边界：信息截止；推测已标。','source：https://example.com/fake','防冒名声明：只借鉴框架，不冒充署名。'].join('\n')
  const r = await m.TOOLS.find(t=>t.name==='jarvis_distill').handler({role:'x',card:VOID,isCeo:false})
  if (r.ok || (r.depthScore ?? 100) >= 60) { console.error('FAIL: 空洞卡未拦'); process.exit(1) }
  console.log('   空洞卡被深度闸拦下(深度 '+r.depthScore+'/100): OK')
})" >/dev/null 2>&1 && echo "   DEPTH-GATE-OK" || { echo "   DEPTH-GATE-FAIL"; exit 1; }

echo "== 11) 蒸馏引导实测（distill_guide 输出品味原则/来源分级/黑名单/验证锚点） =="
node -e "
import('./src/host/plugin.js').then(async (m) => {
  const r = await m.TOOLS.find(t=>t.name==='jarvis_distill_guide').handler({role:'CEO',material:'x'})
  if (!r.tastePrinciples || r.tastePrinciples.length < 5 || !r.sourceBlacklist.some(x=>x.includes('知乎')) || !r.validationAnchors.includes('已知答案测试')) { console.error('FAIL: distill_guide 缺关键要素'); process.exit(1) }
  console.log('   distill_guide 完整(品味原则'+r.tastePrinciples.length+'条/黑名单/来源分级/验证锚点): OK')
})" >/dev/null 2>&1 && echo "   GUIDE-OK" || { echo "   GUIDE-FAIL"; exit 1; }

echo "== 12) 完全插件包装（CLI / 预设生成物 / 结构文档） =="
[ -f bin/luke-jarvis.mjs ] && node bin/luke-jarvis.mjs help >/dev/null 2>&1 && echo "   CLI-OK" || { echo "   CLI-FAIL"; exit 1; }
node bin/luke-jarvis.mjs presets >/dev/null 2>&1 && echo "   CLI-PRESETS-OK" || { echo "   CLI-PRESETS-FAIL"; exit 1; }
node scripts/build-preset-patches.mjs --check >/dev/null 2>&1 && echo "   PRESETS-SYNC-OK" || { echo "   PRESETS-DRIFT（跑 node scripts/build-preset-patches.mjs）"; exit 1; }
[ -f docs/STRUCTURE.md ] && echo "   STRUCTURE-DOC-OK" || { echo "   STRUCTURE-DOC-MISSING"; exit 1; }
node -e "const p=require('./package.json'); if(!p.bin||!p.bin['luke-jarvis']||!p.exports['./presets/*']) {console.error('bad');process.exit(1)}" && echo "   PKG-EXPORTS-OK" || { echo "   PKG-EXPORTS-FAIL"; exit 1; }

echo "== 13) 状态根隔离（插件仓库不得出现 jarvis 记忆文件） =="
POLLUTED=""
for d in .jarvis .agent-teams artifacts; do [ -e "$d" ] && POLLUTED="$POLLUTED $d"; done
if [ -n "$POLLUTED" ]; then echo "   STATE-ROOT-POLLUTION:$POLLUTED（删除后重跑；插件仓库不是状态根）"; exit 1; fi
git check-ignore -q .jarvis/ && git check-ignore -q .agent-teams/ && git check-ignore -q artifacts/ && echo "   GITIGNORE-OK" || { echo "   GITIGNORE-MISSING"; exit 1; }
node -e "
import('./src/host/plugin.js').then((m) => {
  if (typeof m.stateRootConflict !== 'function') { console.error('FAIL: 缺 stateRootConflict'); process.exit(1) }
  const c = m.stateRootConflict(process.cwd())
  if (!c || c.error !== 'STATE_ROOT_CONFLICT') { console.error('FAIL: 插件仓库应返回 STATE_ROOT_CONFLICT'); process.exit(1) }
})" >/dev/null 2>&1 && echo "   STATE-GUARD-OK" || { echo "   STATE-GUARD-FAIL"; exit 1; }

echo "== 14) 本地归档隔离（记忆/审计文档不在仓库内） =="
if [ -e .jarvis-archive ]; then echo "   ARCHIVE-IN-REPO（请移出仓库：mv .jarvis-archive 仓库外目录）"; exit 1; fi
echo "   ARCHIVE-ABSENT-OK"
git check-ignore -q .jarvis-archive/ && echo "   ARCHIVE-GUARD-OK" || { echo "   ARCHIVE-GUARD-MISSING（.gitignore 保留 .jarvis-archive/ 兜底）"; exit 1; }
if git ls-files --error-unmatch .jarvis-archive >/dev/null 2>&1; then echo "   ARCHIVE-STILL-TRACKED（跑 git rm -r --cached .jarvis-archive）"; exit 1; fi
echo "   ARCHIVE-UNTRACKED-OK"

echo "== 15) 领域内核与模块化（runtime / core / adapters / distill / protocol） =="
for f in src/host/runtime.js src/host/core/model.js src/host/core/ports.js src/host/core/reasons.js src/host/core/stage.js src/host/core/tickets.js src/host/core/engine.js src/host/core/memory.js src/host/core/index.js src/host/adapters/json-tickets.js src/host/distill/index.js src/host/protocol/index.js; do
  [ -f "$f" ] || { echo "   MODULE-MISSING: $f"; exit 1; }
done
echo "   CORE-LAYOUT-OK"
node -e "
import('./src/host/plugin.js').then((m) => {
  const t = m.TOOLS.find((x) => x.name === 'jarvis_ticket')
  if (!t) { console.error('缺 jarvis_ticket'); process.exit(1) }
})" >/dev/null 2>&1 && echo "   TICKET-TOOL-OK" || { echo "   TICKET-TOOL-MISSING"; exit 1; }
node --test test/core.test.js >/dev/null 2>&1 && echo "   CORE-TESTS-OK" || { echo "   CORE-TESTS-FAIL"; exit 1; }

echo ""
echo "✅ 全部通过：luke-jarvis 可发布/可安装。"