# luke-jarvis · 发布清单与自检

## 一、发布三步

1. **固化代码**（本仓库已做完）：
   - `src/host/plugin.js`（4 工具 + /jarvis 命令，铁律内嵌）
   - `src/client/plugin.js`
   - `preset/`（jarvis-org 预设：persona + 铁律 + 工具行）
   - `skills/`（jarvis-boss 建队协议、jarvis-roles 蒸馏方向库——已改写为"现场蒸馏铁律"版本）
   - `roles/`（ceo-protocol v2、roles.schema、domains/ 参考域库、角色卡示例=仅参考）

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

# 3) 角色参考库 JSON 合法
for f in roles/*.json roles/domains/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BAD: $f"; done && echo ROLES-OK
```

## 三、功能自检（人工）

- 新会话用 jarvis-org 预设 → 输入 `/jarvis 我要做一个 xx` → 应开始：识别行业 → web 蒸馏 CEO → 定子角色 → 逐卡蒸馏+`jarvis_distill` 校验 → 协同架构 → AgentTeams 建队。
- `jarvis_distill` 故意喂"缺 source/缺防冒名/缺协同架构"的 CEO 卡 → 必须不通过（防 bug 校验生效）。
- 角色卡必须每次现场生成——两次同需求建队，CEO/子角色卡不应逐字相同（即使同领域，也因 web 结果与上下文不同而不同）。
- 重启 dsh web 后核心工具仍在（bundle 持久化安装）——这正是"动态插件重启丢失"的修复点。

## 四、打包前检查项（对照）

- [ ] `roles/ceo-protocol.md` 是 v2（含"现场蒸馏铁律"章节）
- [ ] `skills/jarvis-roles.md` 开头有 ⚠️ "非静态人员卡"警告
- [ ] `src/host/plugin.js` 内 distil 校验含 source/六段式/协同架构/防冒名四检查
- [ ] README 含"使用前必读（防 bug 铁律）"+"故障排查表"
- [ ] `preset/agent.cordis.yml` 中 persona 文本含"真实情况优先/现场蒸馏/协同架构/不预制"铁律
- [ ] community 条目 `repo` 必填、`id` 不与现有条目冲突（可在 dsh-web 仓库 `community.json` 搜索）