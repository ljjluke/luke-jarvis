# luke-jarvis · 发布清单与自检

## 一、发布三步

1. **固化代码**（本仓库已做完）：
   - `src/host/plugin.js`（14 工具 + /jarvis 命令：project/store/process/distill/review/essence/escalate/capability/think/think_deep/fidelity/collab/meeting/board，铁律内嵌）
   - `src/client/plugin.js`
   - `preset/`（jarvis-org 预设：persona + 铁律 + 工具行）
   - `skills/`（jarvis-boss 老板协议、jarvis-roles「角色卡项目沉淀与复用指南」）
   - **无 `roles/` 静态卡目录**（领域无关设计：插件不携带任何角色卡/领域模板，领域内容来自「项目沉淀 .jarvis/ + 现场蒸馏」）

2. **上架**：
   - 把本仓库推到 GitHub（将 `package.json`/`docs/community-entry.example.json` 中 `<YOUR-ACCOUNT>` 换成真实账号）。
   - 向 `github.com/zhu1090093659/dsh-web` 提交 PR，在根 `community.json` 追加 `docs/community-entry.example.json` 的条目（需含 `repo` 必填；`npm` 可后续补发）。
   - GitHub Actions 跑 `market:check` 契约校验（`node scripts/community-index`）通过后，创意工坊/dsh-market.com 即展示。

3. **验证**：安装到干净环境后跑下面自检。

## 二、安装自检（发布前必做）

```bash
# 1) 预设与技能落位
ls ~/.dsh/.agent-presets/jarvis-org/agent.cordis.yml   # 存在
ls ~/.dsh/skills/jarvis-boss/SKILL.md                   # 存在
ls ~/.dsh/skills/jarvis-roles/SKILL.md                  # 存在

# 2) 核心插件代码语法自检（Node）
node --check src/host/plugin.js && echo HOST-OK
node --check src/client/plugin.js && echo CLIENT-OK

# 3) 全量自检（含单测 + e2e + 铁律/四闸落位）
bash scripts/selfcheck.sh
```

## 三、功能自检（人工）

- 新会话用 jarvis-org 预设 → 输入 `/jarvis 我要做一个 xx` → 应开始：需求本质回归 → `jarvis_process` 定领域流程（插件无预设，CEO 现场定）→ 查本项目 `.jarvis/` 沉淀 → web 蒸馏 CEO → 定子角色 → 逐卡蒸馏+`jarvis_distill` 校验 → `jarvis_store` 落盘沉淀 → 协同架构 → kickoff 会 → 独思/黑板/按需二次会 → 收口交付。
- `jarvis_distill` 故意喂"缺 source/缺防冒名/缺协同架构"的 CEO 卡 → 必须不通过（防 bug 校验生效）。
- 角色卡必须来自「项目沉淀（本项目）+ 现场蒸馏」——插件无静态卡；`jarvis_process` 不返回任何领域模板（customized 恒 true）。
- 重启 dsh web 后核心工具仍在（bundle 持久化安装）——这正是"动态插件重启丢失"的修复点。

## 四、打包前检查项（对照）

- [ ] 无 `roles/` 静态卡目录；`package.json` `files` 不含 `roles`
- [ ] `skills/jarvis-roles.md` 是「角色卡项目沉淀与复用指南」版本（含"插件无卡、跨项目禁止复用"）
- [ ] `src/host/plugin.js` 内 distill 校验含 source/六段式/协同架构/防冒名/我的协同 硬闸
- [ ] `jarvis_process` 无领域预设（DOMAIN_PROCESS 已移除）；`identifyIndustry` 无行业关键词
- [ ] README 含"使用前必读（防 bug 铁律）"+"故障排查表"
- [ ] `preset/agent.cordis.yml` 中 persona 文本含"真实情况优先/现场蒸馏/协同架构/项目沉淀"铁律
- [ ] community 条目 `repo` 必填、`id` 不与现有条目冲突（可在 dsh-web 仓库 `community.json` 搜索）