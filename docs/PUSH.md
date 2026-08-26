# luke-jarvis · 自行提交指南（从零推送）

本目录已整理为可发布的插件包（32 个文件：源码 + preset + skills + roles + 文档 + 测试）。
提交前请先在本目录跑一次自检，确认可发布：

```bash
cd luke-jarvis
./scripts/selfcheck.sh        # 六项自检（语法/导入/JSON/铁律/distill 校验/单元测试）
npm test                      # 15 项单元测试全绿
npm pack --dry-run            # 确认可打包为 npm 包
```

## 方式 A：用已生成好的 git 历史直接推（本目录已 init + commit）

```bash
cd luke-jarvis
git status                    # 应为 clean
git remote -v                 # origin = https://github.com/ljjluke/luke-jarvis.git
git push -u origin main
# 提示输入用户名: ljjluke
# 密码: 你的 GitHub Personal Access Token（需 repo 写权限，GitHub 已停用密码 push）
```

## 方式 B：不要本地 .git，重新初始化后推

```bash
cd luke-jarvis
rm -rf .git
git init -b main
git add -A
git commit -m "luke-jarvis v0.1.0: 数字员工公司插件 — 现场蒸馏真人大佬 CEO/子角色 + AgentTeams 并行建队 + 铁律防 bug"
git remote add origin https://github.com/ljjluke/luke-jarvis.git
git push -u origin main
```

## 方式 C：GitHub 网页上传（不想要命令行）

1. 用 zip 打包本目录（**排除 `.git`**，避免带历史）：
   ```bash
   cd /opt/work/first && tar --exclude='luke-jarvis/.git' -czf luke-jarvis-src.tar.gz luke-jarvis
   ```
2. 到 `github.com/ljjluke/luke-jarvis` → Add file → Upload files → 上传解压后的内容 → 提交。
   - 注意：远端已有你创建的 README.md，上传时选择"覆盖/合并"（我们的 README 顶部已保留你那句简介）。

## 推送后（可选）：进社区市场

向 `github.com/zhu1090093659/dsh-web` 提交 PR，把 `docs/community-entry.example.json` 的内容（id `luke-jarvis`）追加进它的根 `community.json`。维护者合并后，创意工坊 / dsh-market.com 即展示，用户可一键安装。

## 发布前必读

- `README.md` 顶部"使用前必读（防 bug 铁律）"是给使用者的第一条防线。
- 角色参考库 `roles/` 与 `skills/` **只作"往哪找真人"的参考方向**，绝不是可直接复用的角色卡——每次建队必须现场 web 蒸馏 + `jarvis_distill` 校验。