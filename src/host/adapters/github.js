/** GitHub API 适配器（ports.github）：自进化闭环的出站通道（issues / releases）。
 *
 *  设计约定：
 *  - 走 Node 全局 fetch（DSH 运行时 Node 18+）；测试经 _setGitHubFetchForTests 注入 mock。
 *  - 未配 token 时只读接口仍可用（公开仓库匿名限流 60/h），写接口（createIssue/comment）
 *    在适配器外由工具先查 hasToken() 如实报错——不静默降级、不编造结果。
 *  - 所有错误原样上抛（含 HTTP 状态码），由工具层转成可读 verdict，调用方看得见失败原因。
 *  - issues 接口会把 PR 一并返回：listIssues 统一过滤掉 pull_request，调用方拿到的是纯 issue。
 */

let _fetchOverride = null

/** 测试注入 fetch 实现（防真实外呼）；传 null 恢复全局 fetch。 */
export function _setGitHubFetchForTests(fn) {
  _fetchOverride = fn
}

export function createGitHubAdapter(opts = {}) {
  const repo = String(opts.repo || 'ljjluke/luke-jarvis').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  const token = String(opts.token || '')
  const fetchImpl = opts.fetchImpl || _fetchOverride || (typeof globalThis !== 'undefined' ? globalThis.fetch : null)
  const base = `https://api.github.com/repos/${repo}`

  async function gh(path, init = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('运行时无 fetch（Node <18 或宿主未提供）——GitHub API 不可用')
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'luke-jarvis-plugin',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    }
    const res = await fetchImpl(base + path, { ...init, headers })
    if (!res || typeof res.ok !== 'boolean') throw new Error('GitHub API 响应异常（非标准 Response）')
    if (!res.ok) {
      let detail = ''
      try { const j = await res.json(); if (j && j.message) detail = '：' + j.message } catch { /* 保留状态码即可 */ }
      throw new Error(`GitHub API ${res.status} ${res.statusText || ''}${detail}`)
    }
    if (res.status === 204) return null
    return res.json()
  }

  return {
    repo,
    /** 是否配置了 PAT（写操作的前置条件，工具层据此如实报错）。 */
    hasToken: () => Boolean(token),

    /** 拉 open issues（过滤 PR）。返回精简字段，body 截 500 字防爆上下文。 */
    async listIssues({ state = 'open', perPage = 50 } = {}) {
      const arr = await gh(`/issues?state=${encodeURIComponent(state)}&per_page=${perPage}&sort=created&direction=desc`)
      return (Array.isArray(arr) ? arr : [])
        .filter((i) => i && !i.pull_request)
        .map((i) => ({
          number: Number(i.number),
          title: String(i.title || ''),
          body: String(i.body || '').slice(0, 500),
          state: String(i.state || ''),
          createdAt: String(i.created_at || ''),
          labels: Array.isArray(i.labels) ? i.labels.map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean) : [],
        }))
    },

    /** 创建 issue（需 PAT）。返回 { number, url }。 */
    async createIssue({ title, body, labels } = {}) {
      if (!token) throw new Error('未配置 GitHub Token——创建 issue 需要 PAT（DSH 设置面板 selfEvolution.githubToken）')
      const r = await gh('/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: String(title || ''), body: String(body || ''), ...(Array.isArray(labels) && labels.length ? { labels } : {}) }),
      })
      return { number: Number(r && r.number), url: String((r && r.html_url) || '') }
    },

    /** issue 评论 + 关闭（研发环境过滤误报用）。需 PAT。 */
    async commentAndClose(number, comment) {
      if (!token) throw new Error('未配置 GitHub Token——回复/关闭 issue 需要 PAT')
      const n = Number(number)
      if (!Number.isInteger(n) || n <= 0) throw new Error(`非法 issue 编号：${number}`)
      await gh(`/issues/${n}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: String(comment || '') }),
      })
      await gh(`/issues/${n}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'closed' }),
      })
      return true
    },

    /** 最新正式 release（channel=stable 用）；仓库尚无 release → null（不是错误）。 */
    async latestRelease() {
      try {
        const r = await gh('/releases/latest')
        return r ? _normRelease(r) : null
      } catch (e) {
        if (/404/.test(String(e.message))) return null
        throw e
      }
    },

    /** release 列表（channel=latest 用，含 prerelease，第一条=最新）。 */
    async listReleases(perPage = 10) {
      const arr = await gh(`/releases?per_page=${perPage}`)
      return (Array.isArray(arr) ? arr : []).map(_normRelease)
    },
  }
}

function _normRelease(r) {
  return {
    tagName: String((r && r.tag_name) || ''),
    name: String((r && r.name) || (r && r.tag_name) || ''),
    prerelease: Boolean(r && r.prerelease),
    draft: Boolean(r && r.draft),
    url: String((r && r.html_url) || ''),
    notes: String((r && r.body) || '').slice(0, 500),
    publishedAt: String((r && r.published_at) || ''),
  }
}
