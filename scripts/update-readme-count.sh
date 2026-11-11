#!/usr/bin/env bash
# F2 对账脚本（防 README 用例数第三次漂移）：
#   ① 真跑 node --test test/plugin.test.js，从输出解析 "# tests N"（不猜、不硬编码）
#   ② 与 README 里的机器标记 `<!-- test-count:N -->` 比对
#   ③ 不一致 → 自动回写 README 标记；测试本身有失败 → 退出码 1（不掩盖）
#
# 用法：bash scripts/update-readme-count.sh [--check]
#   --check：只比对不写盘（CI/复验用；不一致退出码 1）
set -u
cd "$(dirname "$0")/.." || exit 1
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

OUT="$(mktemp)"
node --test test/plugin.test.js >"$OUT" 2>&1
TEST_EXIT=$?
N="$(grep -E '^# tests [0-9]+' "$OUT" | tail -1 | grep -oE '[0-9]+')"
FAIL="$(grep -E '^# fail [0-9]+' "$OUT" | tail -1 | grep -oE '[0-9]+')"
rm -f "$OUT"
if [ -z "${N:-}" ]; then
  echo "❌ 无法从 node --test 输出解析用例数（测试可能没跑起来）"
  exit 1
fi
MARK="$(grep -oE '<!-- test-count:[0-9]+ -->' README.md | head -1 | grep -oE '[0-9]+')"
echo "实测：tests=$N fail=${FAIL:-?}"
echo "README 标记：${MARK:-（缺失）}"
if [ "${FAIL:-0}" != "0" ] || [ "$TEST_EXIT" != "0" ]; then
  echo "❌ 测试有失败（fail=${FAIL:-?} exit=$TEST_EXIT）——先修测试再对账"
  exit 1
fi
if [ "${MARK:-}" = "$N" ]; then
  echo "✅ 一致（README 标记 = 实测 $N）"
  exit 0
fi
if [ "$CHECK_ONLY" = "1" ]; then
  echo "❌ 不一致：README=$MARK 实测=$N（运行不带 --check 可自动回写）"
  exit 1
fi
python3 - "$N" <<'PY'
import re, sys
n = sys.argv[1]
p = 'README.md'
s = open(p, encoding='utf-8').read()
if '<!-- test-count:' in s:
    s2 = re.sub(r'<!-- test-count:\d+ -->', f'<!-- test-count:{n} -->', s, count=1)
else:
    s2 = s
open(p, 'w', encoding='utf-8').write(s2)
print(f'✅ 已回写 README 标记 → {n}')
PY
exit 0
