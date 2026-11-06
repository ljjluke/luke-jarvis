/** jarvis_* 工具（evolution）：自进化闭环——GitHub issue 上报 / 巡检过滤 / 稳定版检测。
 *
 *  闭环分工（docs/设计-GitHub自进化闭环.md）：
 *    - 用户环境（workspaceMode=user）：jarvis_report_issue（疑点→确认门→提 issue）+ jarvis_release_check（检测稳定版）
 *    - 研发环境（workspaceMode=dev）：jarvis_issue_sync（拉取 issues → 沙盒过滤 → 审批工单 → 误报回复关闭）
 *  铁律：
 *    - 用户环境不做沙盒复现（零开销，只当传感器）；是否真 bug 由研发环境判定
 *    - token 未配置 → 如实报错，不静默降级、不编造结果
 *    - 提交前指纹去重（防多实例刷屏）；reportMode=confirm 时必须人确认才发
 *    - 审批工单 pending_approval：approvalRequired=true（默认）时人工批准前不许动源码
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFsService, getRuntimeContext, getLatestExec, resolveWorkspace } from '../runtime.js'
import { readBoardItems, writeBoardItems, nextBoardId } from '../state/board.js'
import { getSelfEvolutionConfig } from '../state/selfconfig.js'
import { createGitHubAdapter } from '../adapters/github.js'
const _require = createRequire(import.meta.url)

// ── 上报指纹账本：<workspace>/.jarvis/reported-issues.json（防多实例重复提交同一问题）──
function ledgerPath() {
  const cwd = resolveWorkspace(getRuntimeContext(), getLatestExec()) || (typeof process !== 'undefined' && process.cwd ? process.cwd() : '')
  return (cwd ? cwd + '/' : '') + '.jarvis/reported-issues.json'
}

async function readLedger(fsSvc) {
  const p = ledgerPath()
  try {
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      const t = await fsSvc.resolve(p)
      if (!t) return []
      const txt = await fsSvc.readText(t)
      const j = txt ? JSON.parse(txt) : null
      return j && Array.isArray(j.entries) ? j.entries : []
    }
  } catch { /* 走 fs 兜底 */ }
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    return j && Array.isArray(j.entries) ? j.entries : []
  } catch { return [] }
}

async function writeLedger(fsSvc, entries) {
  const p = ledgerPath()
  const content = JSON.stringify({ entries, updatedAt: new Date().toISOString() }, null, 2)
  try {
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.writeText === 'function') {
      const t = await fsSvc.resolve(p)
      if (t) { await fsSvc.writeText(t, content); return true }
    }
  } catch { /* 走 fs 兜底 */ }
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content, 'utf8')
    return true
  } catch { return false }
}

/** 指纹：规范化（去空白/大小写/常见标点差异）+ djb2——同症状不同措辞尽量命中同一条。 */
export function issueFingerprint(title, symptoms) {
  const norm = String(title || '') + '\n' + String(symptoms || '')
  const s = norm.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return 'fp' + h.toString(16)
}

/** 语义版本比较：返回 >0 / 0 / <0（容忍 v 前缀与脏尾缀）。 */
export function compareSemver(a, b) {
  const pa = String(a || '').replace(/^v/, '').split(/[-+]/)[0].split('.').map(Number)
  const pb = String(b || '').replace(/^v/, '').split(/[-+]/)[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0; const y = pb[i] || 0
    if (x !== y) return x - y
  }
  return 0
}

/** 插件本地版本：从本文件向上找 luke-jarvis 的 package.json（最多 5 级，防 src 层级变动）。 */
export function localPluginVersion() {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      if (pkg && (pkg.name === 'luke-jarvis' || pkg.version)) return String(pkg.version || '')
    } catch { /* 继续向上 */ }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return ''
}

/** 组装当前配置的 GitHub 适配器（工具层统一入口，测试经 _setGitHubFetchForTests 注入）。 */
function currentAdapter(cfg, repoOverride) {
  return createGitHubAdapter({ repo: repoOverride || cfg.githubRepo, token: cfg.githubToken })
}

/** 本组工具（按原始顺序）；由 tools/index.js 汇总成 TOOLS。 */
export const EVOLUTION_TOOLS = [
  {
    name: 'jarvis_report_issue',
    description:
      '问题上报器（用户环境·自进化闭环①信号上报）：把本实例自检发现的疑似 bug 或用户反馈的问题整理成结构化 GitHub issue 上报。铁律：①只整理疑点，不做沙盒复现（验证是研发环境的职责，用户环境零额外开销）；②提交前指纹去重（.jarvis/reported-issues.json）——同一问题绝不重复提交（防多实例刷屏）；③reportMode=confirm（默认）时先出草稿过确认门，人工核对后带 confirm=true 才真正提交；④未配置 selfEvolution.githubToken 时如实报错，不静默降级。用户也可以不经本工具直接在 GitHub 提 issue（旁路）。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'issue 标题（一句话说清什么功能在什么场景下出什么错）' },
        symptoms: { type: 'string', description: '现象描述：实际发生了什么、期望是什么、稳定复现路径（如记得）' },
        context: { type: 'string', description: '环境上下文：触发场景/涉及工具名/插件版本（可从 jarvis_update 本地版本取）' },
        suspectArea: { type: 'string', description: '疑似模块/方向（可选，帮助研发环境快速定位）' },
        confirm: { type: 'string', description: 'true=确认提交（过确认门后）；缺省/false=只出草稿不提交' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          submitted: { type: 'boolean', description: '是否已提交到 GitHub' },
          duplicate: { type: 'boolean', description: '是否命中已上报指纹（防重复）' },
          confirmGate: { type: 'boolean', description: '是否停在确认门（草稿待人工核对）' },
          issueNumber: { type: 'number', description: '已提交/已存在的 issue 编号' },
          url: { type: 'string', description: 'issue 链接' },
          title: { type: 'string', description: 'issue 标题（草稿或已提交）' },
          body: { type: 'string', description: 'issue 正文（草稿或已提交）' },
          verdict: { type: 'string' },
        },
        required: ['verdict'],
      },
      render: (r) => {
        const head = r.submitted ? '✅ 已提交 issue #' + (r.issueNumber ?? '') : r.duplicate ? '♻️ 已上报过' : r.confirmGate ? '⏸ 停在确认门' : '❌ 未提交'
        return `【问题上报】${head}\n标题：${r.title ?? ''}\n${r.url ? '链接：' + r.url + '\n' : ''}判定：${r.verdict}`
      },
    },
    execute: async (args, exec) => {
      const cfg = getSelfEvolutionConfig()
      const title = String(args.title ?? '').trim()
      const symptoms = String(args.symptoms ?? '').trim()
      const context = String(args.context ?? '').trim()
      const suspectArea = String(args.suspectArea ?? '').trim()
      const wantSubmit = String(args.confirm ?? '').trim() === 'true'
      const adapter = currentAdapter(cfg)
      if (!adapter.hasToken()) {
        return { submitted: false, verdict: '未配置 GitHub Token（DSH 设置面板 selfEvolution.githubToken，需 repo 权限 PAT）——无法上报 issue。请配置后重试，或在 GitHub 网页手动提 issue（旁路）' }
      }
      if (!title || !symptoms) {
        return { submitted: false, verdict: '缺 title 或 symptoms：上报必须说清"什么功能+什么现象+期望是什么"（研发环境要靠这个判断是否真 bug）' }
      }
      const fsSvc = getFsService(exec)
      const fp = issueFingerprint(title, symptoms)
      const ledger = await readLedger(fsSvc)
      const dup = ledger.find((e) => e && e.fp === fp)
      if (dup) {
        const out = { submitted: false, duplicate: true, issueNumber: dup.number, verdict: `该问题已上报过（issue #${dup.number}，${dup.time || '时间未知'}）——不重复提交（防多实例刷屏）；如需补充信息请在原 issue 下跟进` }
        if (dup.url) out.url = dup.url
        return out
      }
      const localV = localPluginVersion()
      const body = [
        '## 现象', symptoms,
        '', '## 期望', '（按现象反推的正常行为；如不确定可写"预期不报错/预期生效"）',
        '', '## 环境', context || '（未提供）',
        '', '## 疑似方向', suspectArea || '（未定位，由研发环境沙盒复现判定）',
        '', '---', `_本 issue 由用户环境 jarvis_report_issue 自动整理上报（插件版本 ${localV || '未知'}，未做沙盒复现；是否真 bug 以研发环境验证为准）_`,
      ].join('\n')
      if (!wantSubmit && cfg.reportMode === 'confirm') {
        return { submitted: false, confirmGate: true, title, body, verdict: '确认门（reportMode=confirm）：以上为 issue 草稿，请人工核对内容不涉密、描述准确后，带 confirm=true 重新调用提交' }
      }
      try {
        const r = await adapter.createIssue({ title, body, labels: ['from-jarvis'] })
        ledger.push({ fp, number: r.number, title, url: r.url, time: new Date().toISOString().slice(0, 16) })
        await writeLedger(fsSvc, ledger)
        return { submitted: true, issueNumber: r.number, url: r.url, title, body, verdict: `已提交 issue #${r.number}——研发环境巡检会拉取并沙盒复现判定真伪；指纹已记账，同症状不会再重复提交` }
      } catch (e) {
        return { submitted: false, verdict: `提交失败（${String(e.message || e).slice(0, 160)}）——请检查 Token 权限（需 repo 写）与网络后重试` }
      }
    },
  },

  {
    name: 'jarvis_issue_sync',
    description:
      'issue 巡检同步器（研发环境·自进化闭环②过滤与审批）：workspaceMode=dev 的实例专用。mode=fetch 拉取 open issue 列表（研发 Jarvis 随后逐条沙盒复现过滤真伪）；mode=ticket 把确认的真 bug 写成审批工单进任务看板（status=pending_approval，人工批准前不许动源码——approvalRequired=true 时不可跳过）；mode=close 对误报 issue 回复说明并关闭（commentAndClose）。用户实例（workspaceMode=user）调用一律如实拒绝——修复链路只在研发环境开放。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'fetch 拉取 open issues（默认）/ ticket 确认 bug 转审批工单 / close 误报回复并关闭' },
        issuesJson: { type: 'string', description: 'ticket 用：待修清单 JSON 数组 [{number,title,severity,rootCause}]——number=issue 编号，severity=critical/major/minor，rootCause=沙盒复现后的初判根因' },
        issueNumber: { type: 'string', description: 'close 用：要回复关闭的 issue 编号' },
        comment: { type: 'string', description: 'close 用：回复说明（为何判定误报/无法复现，须具体）' },
        approve: { type: 'string', description: 'ticket 用：true=跳过审批直接 open（仅 approvalRequired=false 时生效，默认配置下忽略）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          mode: { type: 'string' },
          count: { type: 'number', description: 'fetch=拉取条数 / ticket=写入工单数' },
          issues: { type: 'array', items: { type: 'string' }, description: 'fetch：issue 概览列表' },
          verdict: { type: 'string' },
        },
        required: ['ok', 'verdict'],
      },
      render: (r) => {
        const lines = (r.issues ?? []).map((s) => '  ' + s).join('\n')
        return `【issue 巡检 · ${r.mode ?? ''}】${r.ok ? '✅' : '❌'}${typeof r.count === 'number' ? '（' + r.count + ' 条）' : ''}\n${lines ? lines + '\n' : ''}判定：${r.verdict}`
      },
    },
    execute: async (args, exec) => {
      const cfg = getSelfEvolutionConfig()
      const mode = String(args.mode ?? 'fetch').trim()
      if (cfg.workspaceMode !== 'dev') {
        return { ok: false, mode, verdict: '本实例为用户环境（workspaceMode=user）——issue 巡检/修复链路只在研发环境（工作区=源码仓 + workspaceMode=dev）开放；用户实例只负责 jarvis_report_issue 上报与 jarvis_release_check 检测升级' }
      }
      const adapter = currentAdapter(cfg)
      if (mode === 'fetch') {
        try {
          const issues = await adapter.listIssues({ perPage: 30 })
          const out = { ok: true, mode, count: issues.length, issues: issues.map((i) => `「#${i.number}」${i.title}${i.labels.length ? '（' + i.labels.join('/') + '）' : ''}`) }
          out.verdict = issues.length
            ? `已拉取 ${issues.length} 条 open issue。下一步（自进化闭环②）：逐条沙盒复现过滤真伪——误报用 mode=close 回复说明并关闭；确认真 bug 汇总成待修清单用 mode=ticket 生成审批工单（审批通过前不动源码）`
            : '当前无 open issue——闭环②无待办；继续保持巡检节奏（可结合晨会定时复查）'
          return out
        } catch (e) {
          return { ok: false, mode, verdict: `拉取失败（${String(e.message || e).slice(0, 160)}）——匿名限流 60 次/时，配置 PAT 后额度 5000 次/时；稍后重试或手动查看 GitHub issues 页` }
        }
      }
      if (mode === 'ticket') {
        let list = []
        try {
          const parsed = JSON.parse(String(args.issuesJson ?? '[]'))
          if (Array.isArray(parsed)) list = parsed
        } catch { /* 保持空 */ }
        list = list.filter((t) => t && String(t.number).trim() && String(t.title || '').trim())
        if (!list.length) {
          return { ok: false, mode: 'ticket', verdict: '缺 issuesJson 或清单为空：需 [{number,title,severity,rootCause}]——只把沙盒复现确认的真 bug 写进审批工单，疑似≠确认' }
        }
        const fsSvc = getFsService(exec)
        const { items, version } = await readBoardItems(fsSvc)
        const next = [...items]
        const now = new Date().toISOString().slice(0, 16)
        const skipApproval = !cfg.approvalRequired && String(args.approve ?? '').trim() === 'true'
        for (const t of list) {
          next.push({
            id: nextBoardId(next),
            role: 'CEO',
            type: '审批工单',
            content: `GitHub issue #${String(t.number).trim()}（${String(t.severity || '未分级')}）：${String(t.title).trim()}${t.rootCause ? '｜沙盒初判：' + String(t.rootCause).trim() : ''}`,
            status: skipApproval ? 'open' : 'pending_approval',
            essenceChecked: true,
            issueNumber: String(t.number).trim(),
            time: now,
          })
        }
        const w = await writeBoardItems(fsSvc, next, version)
        if (!w || w.ok === false) {
          return { ok: false, mode: 'ticket', verdict: `审批工单写入看板失败（${(w && w.error) || '未知错误'}）——不重试不吞错，请检查 .jarvis/board.json 权限` }
        }
        return {
          ok: true, mode: 'ticket', count: list.length,
          verdict: skipApproval
            ? `已写入 ${list.length} 条审批工单（approvalRequired=false 且 approve=true，直接 open 可开工）`
            : `已写入 ${list.length} 条审批工单（status=pending_approval）——**人工批准（把工单改 open）前不许动源码**（自进化闭环②→③的闸门）；批准后逐条修复，全部通过沙盒回归再统一发稳定版（批量关联 fixes #N..#M）`,
        }
      }
      if (mode === 'close') {
        const n = String(args.issueNumber ?? '').trim()
        const comment = String(args.comment ?? '').trim()
        if (!n || !comment) {
          return { ok: false, mode: 'close', verdict: '缺 issueNumber 或 comment：关闭误报必须回复具体说明（为何判定误报/无法复现的证据）——不许静默关闭' }
        }
        try {
          await adapter.commentAndClose(n, comment)
          return { ok: true, mode: 'close', count: 1, verdict: `已回复并关闭 issue #${n}——误报闭环完成；若后续用户补充信息可重开再判` }
        } catch (e) {
          return { ok: false, mode: 'close', verdict: `关闭失败（${String(e.message || e).slice(0, 160)}）——检查 Token 权限与网络后重试` }
        }
      }
      return { ok: false, mode, verdict: '未知 mode（fetch/ticket/close）' }
    },
  },

  {
    name: 'jarvis_release_check',
    description:
      '稳定版检测器（自进化闭环④分发升级，用户/研发环境通用）：对比 本地插件版本 vs GitHub Releases——releaseChannel=stable（默认）只认正式 release（自动过滤 prerelease/draft），latest 才允许 prerelease。有新版时输出更新摘要与升级步骤；**升级动作必须人工确认**（备份→替换→重启 dsh web），本工具只检测不执行升级。诚实：API 不可用则如实报错，不编造版本号。',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'stable 只认正式 release（默认，取设置面板 releaseChannel）/ latest 允许 prerelease' },
        repo: { type: 'string', description: '仓库（默认取 selfEvolution.githubRepo）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          localVersion: { type: 'string' },
          latestVersion: { type: 'string' },
          hasUpdate: { type: 'boolean' },
          channel: { type: 'string' },
          prerelease: { type: 'boolean', description: '检出的最新 release 是否为 prerelease' },
          releaseUrl: { type: 'string' },
          notes: { type: 'string', description: '更新说明摘要' },
          verdict: { type: 'string' },
        },
        required: ['verdict'],
      },
      render: (r) =>
        `【稳定版检测 · ${r.channel ?? 'stable'}】本地 ${r.localVersion ?? '?'} vs 远程 ${r.latestVersion ?? '?'}${r.hasUpdate ? ' ⬆️ 有新版本' : ' ✅ 已是最新'}${r.prerelease ? '（prerelease）' : ''}\n${r.releaseUrl ? '发布页：' + r.releaseUrl + '\n' : ''}${r.notes ? '更新摘要：' + r.notes.slice(0, 150) + '\n' : ''}判定：${r.verdict}`,
    },
    execute: async (args, exec) => {
      const cfg = getSelfEvolutionConfig()
      const channel = ['stable', 'latest'].includes(String(args.channel ?? '').trim()) ? String(args.channel).trim() : cfg.releaseChannel
      const adapter = currentAdapter(cfg, String(args.repo ?? '').trim() || undefined)
      const localVersion = localPluginVersion()
      const out = { channel, ...(localVersion ? { localVersion } : {}) }
      try {
        let rel = null
        let prerelease = false
        if (channel === 'stable') {
          rel = await adapter.latestRelease()
          if (rel && rel.prerelease) prerelease = true
        } else {
          const rels = (await adapter.listReleases(10)).filter((r) => !r.draft)
          rel = rels[0] || null
          if (rel) prerelease = rel.prerelease
        }
        if (rel) { out.latestVersion = rel.tagName; out.releaseUrl = rel.url; if (rel.notes) out.notes = rel.notes; if (prerelease) out.prerelease = true }
        if (!rel) {
          out.verdict = '远程尚无可用 release（可能首次发布未打 release）——请人工查看 GitHub releases 页判断，不猜测版本号'
          return out
        }
        if (channel === 'stable' && prerelease) {
          out.hasUpdate = false
          out.verdict = `最新 release ${rel.tagName} 是 prerelease——stable 渠道策略不升级（等正式版发布）；如确需尝鲜请显式 channel=latest 并自担风险`
          return out
        }
        const hasUpdate = localVersion ? compareSemver(rel.tagName, localVersion) > 0 : false
        out.hasUpdate = hasUpdate
        if (!localVersion) {
          out.verdict = `远程最新 ${rel.tagName}，但本地版本号读取失败——无法判定是否更新，请人工核对`
        } else if (hasUpdate) {
          out.verdict = `有新版本 ${rel.tagName}（本地 ${localVersion}${prerelease ? '，prerelease' : ''}）——升级须人工确认后执行：备份旧版 → 解包覆盖 node_modules/luke-jarvis → 重启 dsh web（本工具只检测不自动升级）`
        } else {
          out.verdict = `已是最新 ${localVersion}（远程 ${rel.tagName}）：无需升级`
        }
        return out
      } catch (e) {
        out.verdict = `无法检测（${String(e.message || e).slice(0, 160)}）——请稍后重试或手动查看 https://github.com/${adapter.repo}/releases`
        return out
      }
    },
  },
]
