#!/usr/bin/env bash
# F3（T3 打回项）· 安装一致性检查：仓库源码 vs DSH profile 运行副本
#
# 为什么需要（T3 报告 §三 F3）：DSH profile 用 `file:` 依赖安装 luke-jarvis，pnpm 做**硬链**。
# 仓库里的 `src/host/plugin.js` 一旦被重写（编辑器/工具写入=新 inode），硬链断裂 → profile 里留下**旧副本**：
# package.json 显示 version 0.9.1、plugin.js 却还是 M2 之前的代码。结果是「仓库测试全绿、GUI 里闸不存在」的静默降级。
#
# 本脚本只做**只读比对**，不重装、不重启（重启会中断在跑成员）。
# 退出码：0=一致（运行副本已是仓库版本）｜2=不一致（需重装 profile 并重启）｜3=未安装该 profile
#
# 用法：
#   bash scripts/check-install-consistency.sh                 # 默认 profile: ~/.dsh/profiles/web
#   DSH_PROFILE_DIR=/path/to/profile bash scripts/check-install-consistency.sh
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_PLUGIN="$REPO_ROOT/src/host/plugin.js"
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"

if [ ! -f "$REPO_PLUGIN" ]; then
  echo "❌ 仓库路径异常：找不到 $REPO_PLUGIN"
  exit 3
fi

# pnpm 布局（.pnpm/luke-jarvis@file+*/node_modules/luke-jarvis）与扁平布局（node_modules/luke-jarvis）都找一遍
shopt -s nullglob
cands=(
  "$PROFILE_DIR"/node_modules/luke-jarvis/src/host/plugin.js
  "$PROFILE_DIR"/node_modules/.pnpm/luke-jarvis@*/node_modules/luke-jarvis/src/host/plugin.js
)
INSTALLED=""
for c in "${cands[@]}"; do
  if [ -f "$c" ]; then INSTALLED="$c"; break; fi
done

echo "── 安装一致性检查（F3）──"
echo "仓库源码 : $REPO_PLUGIN"
echo "profile  : $PROFILE_DIR"
if [ -z "$INSTALLED" ]; then
  echo "运行副本 : （未安装/未解析到 luke-jarvis）"
  echo "✅ 结论：该 profile 未安装 luke-jarvis → 无一致性可查（退出码 3）"
  exit 3
fi
echo "运行副本 : $INSTALLED"
echo

REPO_SHA="$(sha256sum "$REPO_PLUGIN" | awk '{print $1}')"
INST_SHA="$(sha256sum "$INSTALLED" | awk '{print $1}')"
REPO_GATE="$(grep -c 'jarvisStageGate' "$REPO_PLUGIN" || true)"
INST_GATE="$(grep -c 'jarvisStageGate' "$INSTALLED" || true)"
REPO_INODE="$(stat -c '%i' "$REPO_PLUGIN")"
INST_INODE="$(stat -c '%i' "$INSTALLED")"
REPO_MTIME="$(stat -c '%y' "$REPO_PLUGIN" | cut -d. -f1)"
INST_MTIME="$(stat -c '%y' "$INSTALLED" | cut -d. -f1)"

printf 'sha256   仓库=%s\n         运行=%s\n' "${REPO_SHA:0:16}…" "${INST_SHA:0:16}…"
printf 'inode    仓库=%s 运行=%s（不同=硬链已断，pnpm 留下旧副本）\n' "$REPO_INODE" "$INST_INODE"
printf 'mtime    仓库=%s 运行=%s\n' "$REPO_MTIME" "$INST_MTIME"
printf 'jarvisStageGate 计数  仓库=%s 运行=%s\n\n' "$REPO_GATE" "$INST_GATE"

if [ "$REPO_SHA" = "$INST_SHA" ] && [ "$REPO_GATE" = "$INST_GATE" ]; then
  echo "✅ 结论：一致 —— 运行副本与仓库相同（sha256 相同、jarvisStageGate 计数相同）"
  exit 0
fi

echo "⛔ 结论：不一致 —— GUI 里跑的不是仓库当前代码（阶段网关可能不存在/行为不同）"
echo
echo "处置（升级时执行，须在全员空闲时做——重启会中断在跑成员）："
echo "  1) 重装 profile 的 file: 依赖："
echo "       cd \"$PROFILE_DIR\" && pnpm install --force"
echo "     （或删掉该硬链目录后重新安装：rm -rf \"$PROFILE_DIR/node_modules/.pnpm/luke-jarvis@file+\"* ）"
echo "  2) 重启 dsh web 进程（让 host 侧重新加载插件）："
echo "       # 停掉当前 dsh web 后重新启动（具体命令按你的启动方式，如 dsh web / systemctl restart）"
echo "  3) 复跑本脚本，直到输出「✅ 一致」；再在 GUI 内发一次越阶段工具调用确认被机械拒绝。"
echo
echo "注意：本脚本**不会自动重装/重启**（属破坏性操作，须人工在空闲窗口执行）。"
exit 2
