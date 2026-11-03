#!/usr/bin/env bash
# T8 · PixOffice 官方 UI 数据联动自检（UI 界面 = PixOffice）
#
# 检查四件事（任何一项红都能定位是「页面挂了 / 接口没数据 / 快照没落盘 / 渲染没起来」）：
#   ① 页面与快照接口 HTTP 码（/jarvis-office/ 与 /api/luke-jarvis/company）
#   ② 快照 employees 非空且含 CEO（否则办公室画面是空的）
#   ③ 当前 company-state 的 phase / 员工数 / 任务数（落盘事实，证明 jarvis_company 写进去了）
#   ④ chromium 无头截图（artifacts/pixoffice-<date>.png）——眼见为实
#
# 已知边界（T8 报告与 README 已写清）：
#   • 静态页/快照接口在**旧运行副本**上即可用（不依赖本次 /jarvis-ui 路由）；
#   • `/jarvis-ui` 是新注册的 exact 路由，**必须重装 profile + 重启 dsh web 才生效**（与 F3 同一窗口）；
#     因此本脚本对 /jarvis-ui 期望 404 属「已知未生效」，不算失败——但会显式打印出来，避免被误读成修好了。
#
# 用法：
#   bash scripts/check-pixoffice.sh                          # 默认 http://127.0.0.1:3080
#   BASE=http://127.0.0.1:3080 PROJECT_DIR=/opt/work/first bash scripts/check-pixoffice.sh
#
# 退出码：0=①~④ 全过（/jarvis-ui 未生效不计）｜1=有硬失败（页面/接口/数据/截图）
set -u

BASE="${BASE:-http://127.0.0.1:3080}"
PROJECT_DIR="${PROJECT_DIR:-/opt/work/first}"
CHROME="${CHROME:-/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome}"
STATE_FILE="$PROJECT_DIR/.jarvis/company-state.json"
OUT_DIR="${OUT_DIR:-/opt/work/first/artifacts}"
DATE="$(date +%Y%m%d-%H%M)"
SHOT="$OUT_DIR/pixoffice-$DATE.png"

fail=0
say() { printf '%s\n' "$*"; }
red() { printf '❌ %s\n' "$*"; fail=1; }
ok() { printf '✅ %s\n' "$*"; }

say "── PixOffice 自检（T8）──"
say "base      : $BASE"
say "project   : $PROJECT_DIR"
say "state     : $STATE_FILE"
say "screenshot: $SHOT"
say

# ① 页面 + 接口 HTTP 码
PAGE_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/jarvis-office/" || echo 000)"
API_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/luke-jarvis/company" || echo 000)"
say "① HTTP：/jarvis-office/ = $PAGE_CODE ｜ /api/luke-jarvis/company = $API_CODE"
if [ "$PAGE_CODE" = "200" ] && [ "$API_CODE" = "200" ]; then ok "页面与快照接口均 200"; else red "页面或快照接口非 200（页面=$PAGE_CODE 接口=$API_CODE）"; fi

UI_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/jarvis-ui" || echo 000)"
UI_LOC="$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/jarvis-ui" || true)"
if [ "$UI_CODE" = "302" ]; then
  ok "/jarvis-ui → $UI_LOC（新入口已生效）"
else
  say "ℹ️  /jarvis-ui = $UI_CODE（新路由需重装 profile + 重启 dsh web 才生效；与 F3 同一窗口，属已知未生效）"
fi

# ② 快照 employees 非空且含 CEO
API_BODY="$(curl -s "$BASE/api/luke-jarvis/company" || echo '')"
if [ -z "$API_BODY" ]; then
  red "快照接口返回空（无法校验 employees）"
else
  CHECK="$(printf '%s' "$API_BODY" | node -e '
let s=""; process.stdin.on("data", c => s += c).on("end", () => {
  try {
    const d = JSON.parse(s)
    const snap = d.snapshot || d
    const emps = Array.isArray(snap.employees) ? snap.employees : []
    const hasCeo = emps.some(e => /ceo/i.test(String((e && e.role) || "")) || /ceo/i.test(String((e && e.id) || "")))
    const tasks = Array.isArray(snap.tasks) ? snap.tasks.length : 0
    console.log([d.active === false ? "inactive" : "active", emps.length, hasCeo ? "ceo" : "no-ceo", tasks].join(" "))
  } catch (e) { console.log("parse-error") }
})'
)"
  set -- $CHECK
  if [ "${1:-}" = "parse-error" ]; then
    red "快照接口 JSON 解析失败"
  else
    say "② 快照：active=${1} 员工数=${2} 含CEO=${3} 任务数=${4}"
    if [ "${2:-0}" -gt 0 ]; then ok "employees 非空（${2} 人）"; else red "employees 为空——办公室画面没有员工"; fi
    if [ "${3:-}" = "ceo" ]; then ok "employees 含 CEO"; else red "employees 不含 CEO"; fi
  fi
fi

# ③ company-state 落盘事实
if [ -f "$STATE_FILE" ]; then
  STATS="$(node -e '
const fs = require("fs")
try {
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  console.log([(d.phase || "-"), (d.employees || []).length, (d.tasks || []).length, (d.updatedAt || "-")].join("|"))
} catch (e) { console.log("parse-error") }' "$STATE_FILE")"
  if [ "$STATS" = "parse-error" ]; then
    red "company-state.json 存在但解析失败"
  else
    PHASE="$(printf '%s' "$STATS" | cut -d'|' -f1)"
    EMPS="$(printf '%s' "$STATS" | cut -d'|' -f2)"
    TASKS="$(printf '%s' "$STATS" | cut -d'|' -f3)"
    UPD="$(printf '%s' "$STATS" | cut -d'|' -f4)"
    say "③ company-state：phase=$PHASE 员工数=$EMPS 任务数=$TASKS 更新于=$UPD"
    if [ "$EMPS" -gt 0 ]; then ok "快照文件已落盘且有员工数据"; else red "快照文件 employees 为 0——jarvis_company 没写进去？"; fi
  fi
else
  red "company-state.json 不存在（$STATE_FILE）：jarvis_company 从未落盘"
fi

# ④ 截图
mkdir -p "$OUT_DIR"
if [ -x "$CHROME" ]; then
  "$CHROME" --headless=new --no-sandbox --disable-gpu --window-size=1440,900 \
    --virtual-time-budget=8000 --screenshot="$SHOT" "$BASE/jarvis-office/" >/dev/null 2>&1 || true
  if [ -f "$SHOT" ] && [ "$(stat -c '%s' "$SHOT")" -gt 10000 ]; then
    ok "④ 截图已生成：$SHOT（$(stat -c '%s' "$SHOT") 字节）"
  else
    red "④ 截图失败或文件过小（$SHOT）"
  fi
else
  red "④ 找不到 chromium：$CHROME（可用 CHROME=<path> 覆盖）"
fi

say ""
if [ "$fail" -eq 0 ]; then
  say "✅ 结论：PixOffice 可用（页面/接口/落盘/截图全过；/jarvis-ui 若为 404 属「未重装生效」的已知边界）"
  exit 0
else
  say "⛔ 结论：有检查项失败（见上 ❌）；依次排查 页面 → 接口 → company-state → 截图"
  exit 1
fi
