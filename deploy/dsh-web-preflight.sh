#!/usr/bin/env bash
# dsh-web ExecStartPre：等 3080 端口真正释放再启动。
#
# 为什么需要（2026-11-27 实证）：
#   每次重启时，旧实例（或手工 setsid 起的孤儿进程）还占着 127.0.0.1:3080 没退干净，
#   新实例一 listen 就 EADDRINUSE → webserver（required）激活失败 → 依赖它的
#   7 个插件全部起不来（jarvis-core 也在其中）→ 整个 dsh web 启动失败。
#   11-19 的 journal 里 restart counter 一路到 17，全是这个原因。
#   客户端侧看到的就是 nginx 大量 "connect() failed (111: Connection refused)"。
#
# 策略：最多等 20 秒；仍被占用则**明确失败**（让 systemd 记 failed、日志里看得见），
#       而不是带着旧进程半死不活地跑起来——后者更难排查。
set -uo pipefail

PORT="${DSH_WEB_PORT:-3080}"
LIMIT="${DSH_PREFLIGHT_WAIT:-20}"

busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -lnt 2>/dev/null | grep -q "127.0.0.1:${PORT}\$" && return 0
    ss -lnt 2>/dev/null | grep -q ":${PORT}\$" && return 0
    return 1
  fi
  # 无 ss 时的兜底：用 bash 的 /dev/tcp 探测
  (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") >/dev/null 2>&1 && return 0
  return 1
}

if ! busy; then
  exit 0
fi

echo "preflight: port ${PORT} 仍被占用，等待释放（最多 ${LIMIT}s）…" >&2
for i in $(seq 1 "$LIMIT"); do
  sleep 1
  if ! busy; then
    echo "preflight: 端口在 ${i}s 后释放，继续启动" >&2
    exit 0
  fi
done

echo "preflight: 端口 ${PORT} 在 ${LIMIT}s 内未释放——拒绝启动（避免与旧实例抢端口导致整站不可用）。" >&2
echo "preflight: 排查：ss -lntp | grep ${PORT}；若是手工起的孤儿进程，先 kill 掉再 systemctl start dsh-web。" >&2
exit 1
