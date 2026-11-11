#!/usr/bin/env bash
# T11 场景层自检：① relay SSE 采样（本地挂载本仓库代码，断言快照含本公司员工且无 error 帧）
#   ② 适配页 relayUrl 注入 + DOM 面板不回退（T9 能力） ③ 场景页/原 demo 页 200 ④ 截图
# 诚实边界：e2e 视觉效果（3D 画面里的人物是否真换成本公司）需**重装 profile + 重启 dsh**后目视确认；
#   本脚本证明的是「协议与页面接线正确」，不证明「场景已渲染」（运行副本仍旧代码，relay 路由尚不存在）。
set -u
cd "$(dirname "$0")/.." || exit 1
BASE="${BASE:-http://127.0.0.1:3080}"
OUT_DIR="${OUT_DIR:-/opt/work/first/artifacts}"
PROJECT_DIR="${PROJECT_DIR:-/opt/work/first}"
CHROME="${CHROME:-/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome}"
DATE="$(date +%Y%m%d-%H%M)"
ok(){ echo "✅ $1"; }
red(){ echo "❌ $1"; FAILED=1; }
say(){ echo "ℹ️  $1"; }
FAILED=0

# ① relay SSE 采样（本仓库代码，本地挂载）
PROBE_OUT="$(mktemp)"
if PROJECT_DIR="$PROJECT_DIR" node scripts/pixoffice-scene-probe.mjs >"$PROBE_OUT" 2>&1; then
  ok "① relay SSE 采样通过（本仓库代码本地挂载）"
  grep -E '快照片段|sceneActorId 绑定' "$PROBE_OUT" | sed 's/^/     /'
else
  red "① relay SSE 采样失败："
  tail -6 "$PROBE_OUT" | sed 's/^/     /'
fi
rm -f "$PROBE_OUT"

# ② 适配页 relayUrl 注入 + 面板 DOM 不回退
# 显式带 workspace（插件侧 resolveWorkspace 是进程级单例，多项目并存会漂移：实测漂到 profile 目录 → 面板 0 员工）
ADA_URL="$BASE/jarvis-office/jarvis.html?workspace=$(printf '%s' "$PROJECT_DIR" | sed 's#/#%2F#g')"
C="$(curl -s -o /dev/null -w '%{http_code}' "$ADA_URL" || echo 000)"
[ "$C" = "200" ] && ok "②-1 适配页 200" || red "②-1 适配页非 200（$C）——运行副本 office/ 缺 jarvis.html？重装或复制静态文件"
REL="$(curl -s "$ADA_URL" | grep -c 'relayUrl' || true)"
[ "$REL" -ge 1 ] && ok "②-2 适配页含 relayUrl 注入（命中 $REL）" || red "②-2 适配页未注入 relayUrl"
if [ -x "$CHROME" ] && [ "$C" = "200" ]; then
  DOM="$(mktemp)"
  "$CHROME" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=8000 --dump-dom "$ADA_URL" >"$DOM" 2>/dev/null || true
  HITS=0
  for r in CEO 企业架构师 质量-探索式测试 办公体系专家; do grep -q "$r" "$DOM" && HITS=$((HITS+1)); done
  EMPN="$(grep -o 'jarvis-emp-count">[0-9]*' "$DOM" | grep -o '[0-9]*$' | head -1)"
  [ "$HITS" -ge 3 ] && ok "②-3 DOM 面板仍含 ≥3 本公司角色（$HITS/4，employees=$EMPN）" || red "②-3 DOM 面板角色命中 $HITS < 3（T9 能力回退）"
  rm -f "$DOM"
fi

# ③ 场景页与原 demo 页 200
S="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/jarvis-office/jarvis-scene.html" || echo 000)"
[ "$S" = "200" ] && ok "③-1 场景页 200（/jarvis-office/jarvis-scene.html）" || say "③-1 场景页非 200（$S）——本地验证需把 office/jarvis-scene.html 与 jarvis-scene-config.js 复制进运行副本 office/（静态按请求读盘、无需重启）"
D="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/jarvis-office/" || echo 000)"
[ "$D" = "200" ] && ok "③-2 原 demo 页仍 200（未受影响）" || red "③-2 原 demo 页非 200（$D）"

# ④ 截图
if [ -x "$CHROME" ] && [ "$C" = "200" ]; then
  SHOT="$OUT_DIR/pixoffice-scene-$DATE.png"
  mkdir -p "$OUT_DIR"
  "$CHROME" --headless=new --no-sandbox --disable-gpu --window-size=1440,900 --virtual-time-budget=9000 --screenshot="$SHOT" "$ADA_URL" >/dev/null 2>&1 || true
  if [ -f "$SHOT" ] && [ "$(stat -c '%s' "$SHOT")" -gt 10000 ]; then
    ok "④ 截图：$SHOT（$(stat -c '%s' "$SHOT") 字节）"
  else
    red "④ 截图失败（$SHOT）"
  fi
else
  red "④ 跳过：chromium 不可用或适配页非 200"
fi

if [ "$FAILED" = "0" ]; then
  say "结论：relay 协议 + 页面接线通过（场景真渲染待重启后目视确认——运行副本仍旧代码）"
  exit 0
fi
say "⛔ 结论：有检查项失败（见上）"
exit 1
