# 🚀 把 luke-jarvis 上架到 DSH 插件市场（最终可执行清单）

**文件** `docs/dsh-web-community.new.json` = 官方 community.json **已改好**（38 条，luke-jarvis 在末尾）。
你只需把它提交到 dsh-web 仓库，再跑两条命令即可。

## 步骤（约 5 分钟）

1. **fork** dsh-web：`github.com/zhu1090093659/dsh-web` → Fork。
2. 进入 fork 仓库 → 打开 `packages/dsh-community-plugins/community.json` → ✏️ 编辑：
   - 用 `docs/dsh-web-community.new.json` 的**全文**替换该文件内容（注意末尾逗号/JSON 完整）。
   - 或本机方式：`git clone` dsh-web → 覆盖该文件 → `git diff` 确认。
3. **跑校验 + 重新生成市场清单**（在 dsh-web 仓库根目录，装了依赖后）：
   ```sh
   node scripts/community-index       # 校验 community.json（CI 同款）
   node scripts/market-build          # 重新生成 market/dist（manifest/plugins.json）
   # 把 market/dist/** 变更一起提交
   ```
4. **commit + push 到你的 fork**，然后向 `zhu1090093659/dsh-web` 提 Pull Request，PR 描述：

   ```markdown
   ## [Community] 登记 luke-jarvis：贾维斯数字员工公司
   类型：agent 预设 + 核心插件
   仓库：https://github.com/ljjluke/luke-jarvis
   能力：识别行业 → 现场蒸馏真实大佬 CEO/子角色（六段式+协同架构+source+防冒名，jarvis_distill 校验）
        → AgentTeams 并行建队 → 收口交付
   铁律：角色卡每次现场蒸馏，绝不复用旧卡；无 source 不蒸馏；真实情况优先于角色卡
   自检：scripts/selfcheck.sh 全过；15 单测全绿；npm pack 40.9kB
   已执行：community-index ✅ && market-build ✅（market/dist 已重生成提交）
   ```

5. 维护者合并后 → 创意工坊 + dsh-market.com 即显示 luke-jarvis。

---
### 高度可选：先发 npm（让条目带 npm 字段，用户可一键安装）
`cd luke-jarvis && npm login && npm publish`（发布 `luke-jarvis@0.1.0`）。
不发布 npm 也能收录（dsh-data-agent/pilot 先例无 npm 字段）。
