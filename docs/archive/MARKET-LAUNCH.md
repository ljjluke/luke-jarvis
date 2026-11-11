# 🚀 luke-jarvis 上架 DSH 插件市场 · 最终执行清单（只差你执行）

> 背景：本地已领先远端 2 个提交，含本次上架全部材料。**先推这 2 个提交，再开市场 PR。**

## 第 0 步：把本地 2 个新提交推到你的 GitHub（否则上架材料丢失）

```bash
cd /opt/work/first/luke-jarvis
git push origin main
# 用户名 ljjluke + Personal Access Token（repo 写权限；GitHub 已停用密码 push）
```

确认：`git log --oneline -3` 应显示
`c828e07 market: 上架最终材料` / `a06d063 docs: 市场发布步骤` / `5be88c4 docs: 自行提交指南`，且远端 main 指向 `c828e07`。

## 第 1 步：fork + 改 community.json

1. fork `github.com/zhu1090093659/dsh-web`。
2. 打开 fork 的 `packages/dsh-community-plugins/community.json` → 编辑。
3. **替换为 `docs/dsh-web-community.new.json` 全文**（本仓库已内置：官方 37 条 + luke-jarvis 第 38 条，末尾正确，JSON 合法已验）。

## 第 2 步：校验 + 重生成市场清单（在 dsh-web fork 根目录，需装依赖）

```sh
pnpm install
node scripts/community-index      # 校验 community.json（CI 同款）
node scripts/market-build         # 重新生成 market/dist/manifest/plugins.json
# 提交 market/dist/** 变更
```

> 若本机装依赖太重/太慢，也可：只改 community.json 并提 PR，在 PR 说明里注明"已按 docs/plugins.md 需要跑 market-build；本机环境限制暂未生成 market/dist，请 CI/维护者复核"——由维护者决定是否放行。（社区真实流程要求提交生成物，能跑则跑。）

## 第 3 步：提 PR

fork 分支 → Push → 向 `zhu1090093659/dsh-web` 开 Pull Request，描述模板（可直接复制）：

```markdown
## [Community] 登记 luke-jarvis：贾维斯数字员工公司

- 类型：agent 预设 + 核心插件（jarvis_project/distill/review/think + /jarvis 命令）
- 仓库：https://github.com/ljjluke/luke-jarvis
- 能力：识别行业 → 现场蒸馏真实大佬 CEO/子角色（六段式+协同架构+source+防冒名，jarvis_distill 校验）→ AgentTeams 并行建队 → 收口交付
- 铁律：角色卡每次现场蒸馏，绝不复用旧卡；无 source 不蒸馏；真实情况优先于角色卡
- 自检：scripts/selfcheck.sh 六项全过；15 单测全绿；npm pack 40.9kB
- 改动：packages/dsh-community-plugins/community.json 追加 luke-jarvis；market/dist 已重生成
```

## 第 4 步：维护者合并后 → 市场可见

创意工坊（设置 → 创意工坊 → 插件）与 dsh-market.com 即显示 luke-jarvis。

---

## 本仓库已备好的文件（都在 luke-jarvis 仓库内）

| 文件 | 用途 |
|---|---|
| `docs/dsh-web-community.new.json` | 改好的官方 community.json（38 条，直接替换用）|
| `docs/dsh-web-community.diff` | 改动 diff（可 `git apply` 或 PR review 用）|
| `docs/community-entry.example.json` | 单个条目（备查）|
| `MARKET-LAUNCH.md` | 本清单 |
| `docs/MARKET-PR.md` | 详细流程 + npm 发布备选 |
| `docs/PUSH.md` | 推送三方式（A/B/C）|

## 可选增强：发 npm

```sh
cd luke-jarvis && npm login && npm publish   # luke-jarvis@0.1.0
```
发布后在 community 条目加 `"npm": "luke-jarvis"` 再提 PR（不发布 npm 也可收录）。