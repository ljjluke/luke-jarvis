/** 调用前置体检（other 工作区会话实测缺陷的通用化修复）。
 *
 *  背景（真实会话取证 /opt/work/other）：
 *   ① 模型在 stage1 反复调 agent_teams_* → 得到英文报错 "you do not lead or belong to any active team yet"，
 *      模型不知道下一步该干什么，白烧一轮；
 *   ② 模型 glob 到 /root/.dsh（含数千依赖）→ "tool call timed out after 30000ms"，同样白烧一轮。
 *  设计：guard 在**调用发生前**拦截"必然失败/必然超时"的调用，直接给中文可执行指引；
 *        只拦确定会失败的场景，判不准一律放行（误拦比不拦更糟）。
 */
import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

/** 大目录：命中即以"必然超时"拦下（这些目录单层就上千文件）。 */
const HUGE_ROOTS = [/^\/root\/\.dsh(\/|$)/, /^\/root\/\.nvm(\/|$)/, /\/node_modules(\/|$)/, /\/\.git(\/|$)/, /^\/$/, /^\/root$/, /^\/opt$/]
/** 只在"整仓扫"时才拦：模式本身过宽 + 路径是上述大目录。 */
const WIDE_PATTERNS = [/^\*\*?$/, /^\*\*\/\*$/, /^\*$/, /^\*\*\/\*\*$/]

function absOf(p, cwd) {
  const path = _require('node:path')
  const raw = String(p || '')
  if (!raw) return String(cwd || '')
  try { return path.resolve(String(cwd || process.cwd()), raw) } catch { return raw }
}

function isHuge(p) { return HUGE_ROOTS.some((re) => re.test(String(p || ''))) }

/** 有团队吗（.agent-teams 下至少一个 team.json）——只读判定，不猜。 */
function hasAnyTeam(cwd) {
  const fs = _require('node:fs')
  const path = _require('node:path')
  const dir = path.join(String(cwd || ''), '.agent-teams')
  try {
    for (const name of fs.readdirSync(dir)) {
      if (/^(archived?|_archive|\.)/i.test(name) || /-archive$/i.test(name)) continue
      if (fs.existsSync(path.join(dir, name, 'team.json'))) return true
    }
  } catch { /* 无目录 */ }
  return false
}

function sessionCwd(exec) {
  return String((exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd) || '')
}

/** 主入口：返回字符串 = 拦截并给出指引；返回 undefined = 放行。 */
export function jarvisPrecheck(exec) {
  try {
    const name = String((exec && exec.name) || '')
    const args = (exec && exec.arguments) || {}
    const cwd = sessionCwd(exec)
    if (!cwd) return undefined

    // ① agent_teams_*：没有团队时必然失败 → 提前给中文指引（替代英文报错）
    if (/^agent_teams_/.test(name) && !hasAnyTeam(cwd)) {
      return `【团队前置检查】当前工作区还没有任何团队（.agent-teams 里没有 team.json），\`${name}\` 现在调用必然失败（原生报错是英文 "you do not lead or belong to any active team yet"，模型往往误判成权限问题）。\n` +
        `不要重试这个工具。按流程走：① jarvis_clarify 打磨需求 → ② 产出 .jarvis/docs/需求规格-*.md（≥300 字含验收）→ ③ jarvis_flowguard(step="clarify") → 拆解/方案 → ④ 建队（jarvis_distill 蒸馏角色卡 + jarvis_company 落员工）→ ⑤ jarvis_dispatch_task 派活。\n` +
        `想确认团队现状：jarvis_ticket(action=list) 或 jarvis_company(mode=snapshot)，这两个在没有团队时也能安全调用。`
    }

    // ② glob/grep 扫大目录或通配整仓 → 30s 超时必然发生 → 提前拦，给精确替代
    if (name === 'glob' || name === 'grep' || name === 'search') {
      const target = absOf(args.path || args.dir || args.cwd || cwd, cwd)
      const pat = String(args.pattern || args.query || '')
      const wide = WIDE_PATTERNS.some((re) => re.test(pat.trim()))
      if (isHuge(target) || (wide && isHuge(absOf(args.path || '', cwd)))) {
        return `【检索前置检查】不要在 ${target} 这类超大目录（含依赖/.git/会话存储，几千个文件）上做 ${name}——实测会 30 秒超时，白烧一轮。\n` +
          `改用精确范围：① path 指到具体子目录（如 ${cwd}/.jarvis/docs 或 ${cwd}/src）② pattern 写具体名（如 "需求规格-*.md"、"*.test.js"）③ 找符号用 grep(path=具体目录, pattern=符号名)。\n` +
          `要看插件自身实现：path=${cwd}/src/host，别扫 /root/.dsh（那是会话与依赖存储）。`
      }
    }
    return undefined
  } catch {
    return undefined // 体检自身出错绝不阻断正常调用
  }
}
