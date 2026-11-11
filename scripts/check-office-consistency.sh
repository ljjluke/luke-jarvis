#!/usr/bin/env bash
# T11（captain 追加）：office/ 双副本一致性校验——仓库 office/ vs 运行副本 office/
#
# 背景（T9 实测）：运行副本的 office/ 是安装时**独立拷贝**（不是硬链），静态资源按请求读盘。
# 于是「仓库改了、运行副本没同步」会静默表现为：面板掉到 0/4 员工、场景页 404、relay 配置缺失，
# 且没有任何报警。本脚本用 sha256 清单逐文件比对，缺文件/内容不一致时明确报错并给处置。
#
# 退出码：0=一致；2=不一致（有缺/多/内容不同）；3=运行副本 office/ 不存在（未安装）
# 用法：bash scripts/check-office-consistency.sh [--copy]   # --copy：把仓库 office/ 同步到运行副本（本地验证用）
set -u
cd "$(dirname "$0")/.." || exit 1
REPO_DIR="$(pwd)/office"
PROFILE_DIR="${PROFILE_DIR:-/root/.dsh/profiles/web}"
RUNTIME_LINK="$PROFILE_DIR/node_modules/luke-jarvis/office"
RUNTIME_DIR="$(readlink -f "$RUNTIME_LINK" 2>/dev/null || true)"
COPY=0
[ "${1:-}" = "--copy" ] && COPY=1

if [ -z "${RUNTIME_DIR:-}" ] || [ ! -d "$RUNTIME_DIR" ]; then
  echo "❌ 运行副本 office/ 不存在：$RUNTIME_LINK"
  echo "   处置：安装插件（pnpm install / 重装 profile）后重跑；或用 PROFILE_DIR=<现有 profile> 指定"
  exit 3
fi
echo "ℹ️  仓库：$REPO_DIR"
echo "ℹ️  运行：$RUNTIME_DIR"

list() { # $1=dir → 相对路径<TAB>sha256
  ( cd "$1" && find . -type f ! -path './node_modules/*' -print0 | sort -z | xargs -0 sha256sum 2>/dev/null )
}
REPO_LIST="$(list "$REPO_DIR")"
RUN_LIST="$(list "$RUNTIME_DIR")"

MISSING="$(comm -23 <(echo "$REPO_LIST" | awk '{print $2}') <(echo "$RUN_LIST" | awk '{print $2}'))"
EXTRA="$(comm -13 <(echo "$REPO_LIST" | awk '{print $2}') <(echo "$RUN_LIST" | awk '{print $2}'))"
# 逐路径比对（REPO_LIST/RUN_LIST 的行格式是「<sha256>  <相对路径>」，按第 2 字段 join）
DIFF="$(join -j 2 <(printf '%s\n' "$REPO_LIST" | sort -k2) <(printf '%s\n' "$RUN_LIST" | sort -k2) 2>/dev/null | awk '$2!=$3{print $1}')"


BAD=0
if [ -n "$MISSING" ]; then
  BAD=1
  echo "❌ 运行副本缺文件（$(echo "$MISSING" | grep -c .) 个）："
  printf '%s\n' "$MISSING" | sed 's/^/     /' | head -20
  echo "   处置：bash scripts/check-office-consistency.sh --copy（本地验证同步）；正式环境应重装 profile"
fi
if [ -n "$DIFF" ]; then
  BAD=1
  echo "❌ 内容不一致（$(echo -n "$DIFF" | grep -c .) 个）："
  printf '%s' "$DIFF" | sed 's/^/     /' | head -20
  echo "   处置：同上；若是「仓库新、运行旧」→ 正常（待重装），但**不得据此宣称页面已生效**"
fi
if [ -n "$EXTRA" ]; then
  echo "ℹ️  运行副本多出文件（不影响判定，可能是旧版本残留 / 本地验证复制品）："
  printf '%s\n' "$EXTRA" | sed 's/^/     /' | head -10
fi

if [ "$COPY" = "1" ]; then
  echo "ℹ️  --copy：同步仓库 office/ → 运行副本（仅新增/更新文件；不删除多余文件）"
  rsync -a --exclude node_modules "$REPO_DIR/" "$RUNTIME_DIR/" 2>/dev/null || cp -a "$REPO_DIR/." "$RUNTIME_DIR/"
  chmod -R a+r "$RUNTIME_DIR" 2>/dev/null || true
  echo "✅ 已同步（本地验证用；正式生效仍需重装 profile + 重启）"
  exit 0
fi

if [ "$BAD" = "0" ]; then
  echo "✅ 一致：仓库 office/ 与运行副本 office/ 的 sha256 清单完全相同（$(echo "$REPO_LIST" | grep -c .) 个文件）"
  exit 0
fi
echo "⛔ 结论：运行副本 office/ 与仓库不一致 —— 页面/场景/relay 配置可能静默缺失（员工掉 0/4 是典型征兆）"
exit 2
