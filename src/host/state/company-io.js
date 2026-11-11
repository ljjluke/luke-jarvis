/** 公司状态 IO（从 state/company.js 拆出：读/写/路径，不含业务裁决）。
 *
 *  拆分原因：core Engine 的宿主桥接（host/engine.js）需要复用这三个函数，
 *  而 company.js 的 syncCompanyState 要改为走 Engine —— 不拆会形成循环 import。
 *  裁决已上移到 src/core/model.js#applyCompanyActionTo（纯函数）。
 */
import { createRequire } from 'node:module'
import { resolveWorkspace, getRuntimeContext, getLatestExec } from '../runtime.js'
const _require = createRequire(import.meta.url)

/** 公司状态文件路径（与 jarvis_company 同一文件，3D UI 数据源）。 */
export function companyStateFile(projectDir) {
  const explicit = String(projectDir || '').trim()
  const cwd = explicit || resolveWorkspace(getRuntimeContext(), getLatestExec()) || (typeof process !== 'undefined' && process.cwd ? process.cwd() : '')
  return (cwd ? cwd + '/' : '') + '.jarvis/company-state.json'
}

/** 读公司状态（无文件 → 空骨架）。fs 服务读失败/不可用 → node:fs 兜底读同一路径。 */
export async function readCompanyState(fsSvc, projectDir) {
  const empty = { company: {}, employees: [], meetings: [], recruiting: [], ceo: {}, headhunter: {}, tasks: [], updatedAt: '' }
  const file = companyStateFile(projectDir)
  if (fsSvc && typeof fsSvc.readText === 'function') {
    try {
      const target = await fsSvc.resolve(file)
      if (target) {
        const text = await fsSvc.readText(target)
        if (text) {
          const data = JSON.parse(text)
          if (data && typeof data === 'object') return { ...empty, ...data }
        }
      }
    } catch { /* 落 fallback */ }
  }
  try {
    const fs = _require('node:fs')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? { ...empty, ...data } : empty
  } catch { return empty }
}

/** 写公司状态：① 宿主 fs 服务；② 失败/不可用 → node:fs 原子写（mkdir + tmp + rename）。 */
export async function writeCompanyState(fsSvc, state, projectDir) {
  const file = companyStateFile(projectDir)
  state.updatedAt = new Date().toISOString()
  const text = JSON.stringify(state, null, 2)
  if (fsSvc && typeof fsSvc.writeText === 'function') {
    try {
      const target = await fsSvc.resolve(file)
      if (target) {
        await fsSvc.writeText(target, text)
        return { ok: true, mode: 'fs-service' }
      }
    } catch { /* 落 node:fs 兜底 */ }
  }
  try {
    const fs = _require('node:fs')
    const path = _require('node:path')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)
    return { ok: true, mode: 'node-fs-fallback' }
  } catch { return { ok: false, mode: 'failed' } }
}
