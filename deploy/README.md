# 部署运维（systemd + 端口预检）

> 2026-11-27 实证：服务「用了好多问题」的根因是**部署方式**，不是插件本身。
> 修完后主入口（`/`）稳定：实测 30015 次访问中 0 次 5xx（除重启窗外）。

## 问题：手工起的野进程 + 端口抢占

| 症状 | 根因 |
|---|---|
| 页面间歇性 502 / "Connection refused" | 旧实例没退干净，新实例 `EADDRINUSE` → `webserver`(required) 激活失败 → 依赖它的 7 个插件全挂（含 `jarvis-core`） |
| 服务停了一周没人知道 | `Restart=on-failure`：进程 exit 0 时不重启；`dsh-web.service` 自 11-19 起就 `inactive (dead)` |
| 越重启越糟 | 11-19 journal 里 `restart counter` 一路到 17，全是端口抢占循环 |

**原部署方式错了**：用 `setsid nohup bash /usr/local/bin/dsh-web-run &` 手工起，
进程 `PPID=1`、不在 systemd cgroup 里 → 挂了不重启、重启时与旧进程抢 3080。

## 正确部署（三件套）

```
/etc/systemd/system/dsh-web.service          # unit（本目录 dsh-web.service 是副本）
/usr/local/bin/dsh-web-run                   # 启动脚本（起 dsh web、写 one-time token 到 nginx entry）
/usr/local/bin/dsh-web-preflight             # ExecStartPre：等 3080 释放，否则明确失败
```

关键配置（相对旧版的三处修正）：

```ini
ExecStartPre=/usr/local/bin/dsh-web-preflight   # 新增：等端口释放
Restart=always                                  # 原 on-failure → 干净退出也拉起
KillMode=mixed                                  # SIGTERM 主进程 + SIGKILL 整个 cgroup（子 node 一起退）
```

## 运维命令（**不要再用 setsid 手工起**）

```bash
# 部署/更新 unit 后
systemctl daemon-reload

# 重启（端口会被 preflight 自动等待释放）
systemctl restart dsh-web

# 看状态 / 日志
systemctl status dsh-web
journalctl -u dsh-web -n 50 --no-pager

# 排查端口占用（preflight 失败时会提示这条）
ss -lntp | grep 3080
# 若是手工起的孤儿：pkill -f 'bin/dsh web' 后再 systemctl start dsh-web
```

## 验证清单（改动部署后必跑）

```bash
systemctl is-active dsh-web                                   # active
ss -lntp | grep 3080 | wc -l                                   # 1（不能是 2+）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/api/jarvis/state   # 200
grep -ic EADDRINUSE /var/log/dsh-web.log                      # 0
systemctl show dsh-web -p NRestarts --value                   # 0（若反复增长=在死循环重启）
```

## 副入口 `/superagent/`

superagent 跑在独立的 `tmux` 会话（端口 3082），不受 `dsh-web.service` 管。
实测使用率极低（30015 次主入口访问 vs 1 次 superagent），暂未纳入 systemd；
如需稳定化，可仿照本目录建 `dsh-superagent.service`（端口 3082，同样加 preflight）。
