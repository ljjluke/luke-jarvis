# 发布到 DSH 插件市场 · 精确步骤（luke-jarvis）

> 市场收录索引：`github.com/zhu1090093659/dsh-web` → `packages/dsh-community-plugins/community.json`
> 流程依据：该仓库 `docs/plugins.md`「社区插件索引登记」一节（raw 已验证）。

## 你要做的：向 dsh-web 提交一个 PR，含两处改动

### 改动 1：在 community.json 追加 luke-jarvis 条目

文件：`packages/dsh-community-plugins/community.json`

把下面这段 append 到数组末尾（保持条目风格一致，逗号分隔正确）：

```json
,
{
  "id": "luke-jarvis",
  "name": "贾维斯数字员工公司",
  "nameEn": "Luke Jarvis — Digital Employee Company",
  "author": "ljjluke",
  "description": "给 DSH 用的数字员工公司：识别行业→现场 web 蒸馏该领域真实大佬做 CEO/子角色（六段式+协同架构+source+防冒名，jarvis_distill 校验）→AgentTeams 并行建队协作→收口交付。铁律：角色卡每次现场蒸馏，绝不复用旧卡。",
  "descriptionEn": "A digital-employee company for DSH: identify the industry, live-distill the domain real authority into CEO/sub-role cards (six-section + co-architecture + source + anti-impersonation, validated by jarvis_distill), build a parallel AgentTeams team, and deliver. Hard rule: every role card is live-distilled per requirement, never reused.",
  "repo": "https://github.com/ljjluke/luke-jarvis",
  "category": "agent"
}
```

> `category: "agent"` 与标杆 `dsh-data-agent` 同类。可选 `npm` 字段先不加——你的包尚未发 npm，市场只收录仓库链接即可（`dsh-data-agent`/`dsh-pilot` 同样无 npm 字段仍被收录）。

### 改动 2：重新生成并提交 market/dist 清单

dsh-web 的 CI 门禁要求 community.json 与派生的市场清单一致，必须运行（在 dsh-web 仓库目录）：

```sh
node scripts/community-index      # 校验 community.json（cI 门禁同款），通过后才改数据有效
node scripts/market-build         # 重新生成 market/dist（manifest/plugins.json 由 community.json 派生）
```

把生成的 `market/dist/**` 变更一并提交进同一个 PR（`market:check` 校验一致）。

### PR 信息模板

```markdown
## luke-jarvis 登记：贾维斯数字员工公司

- 类型：agent 预设 + 核心插件（jarvis_project/distill/review/think + /jarvis 命令）
- 仓库：https://github.com/ljjluke/luke-jarvis
- 定位：识别行业 → 现场蒸馏真实大佬 CEO/子角色（六段式+协同架构+source+防冒名，jarvis_distill 校验）→ AgentTeams 并行建队 → 收口交付
- 铁律：角色卡每次现场蒸馏，绝不复用旧卡；无 source 不蒸馏；真实情况优先于角色卡
- 自检：仓库内 scripts/selfcheck.sh 六项通过；15 个单元测试全绿；npm pack 可构建 40.9kB

已运行：node scripts/community-index && node scripts/market-build（清单已重生成提交）
```

## 提交方式

- **网页 PR**：fork `zhu1090093659/dsh-web` → 改 `packages/dsh-community-plugins/community.json` + `market/dist` → Pull Request。
- **本地**：`git clone` dsh-web，改数据、跑上面两条命令、commit、push 你的 fork 分支、提 PR。
- 维护者审核合并后：创意工坊（设置→创意工坊→插件）与 dsh-market.com 即展示，用户可一键安装/跳转仓库。

## 备选：npm 发布（可选增强，让市场条目可一键 npm 安装）

要加 `npm` 字段，需要先真正发布到 npm registry：

```sh
cd luke-jarvis
npm login            # 你的 npm 账号
npm publish          # 发布 luke-jarvis@0.1.0 到 npm
```

发布成功后把 community 条目加 `"npm": "luke-jarvis"` 再走上面 PR。不发布 npm 也不影响收录（仓库链接已够）。