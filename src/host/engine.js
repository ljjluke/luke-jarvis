/** 宿主桥接（对应 superagent 的 src/app/runtime.ts 组合根，缩小版）：
 *  把 luke-jarvis 既有的 state/gates 模块适配成 core Engine 的 Ports，
 *  并注册 Effects 的 handler（event → events.jsonl）。
 *
 *  依赖方向（与 superagent 一致）：host → core 单向；core 不 import host。
 */
import { createRequire } from 'node:module'
import { createEngine, Effects } from '../core/index.js'
import { readCompanyState, writeCompanyState } from './state/company-io.js'
import { appendEvent } from './state/events.js'
import { stateRootConflict } from './gates/ownership.js'

const _require = createRequire(import.meta.url)

// 每个工作区一个 Effects 实例（事件落盘 handler + .jarvis/effects.json 持久化，重启可重放）
const _effectsByRoot = new Map()
let _eventSeq = 0

// 原始 IO 注册表：board/gates 的原子写实现由各自模块注册（避免 engine ↔ 模块 循环 import）。
// Engine 是唯一写者 = 所有调用方经 Engine 命令；真正落盘的 IO 在这里注册进来。
const _rawIo = { board: null, gates: null }
export function registerRawIo(kind, fn) {
  if (kind === 'board' || kind === 'gates') _rawIo[kind] = fn
}

function effectsFor(projectDir) {
  const key = String(projectDir || '')
  let fx = _effectsByRoot.get(key)
  if (fx) return fx
  // 状态根守卫：无 projectDir（非 jarvis 状态根）→ 纯内存队列，绝不向 cwd 落 .jarvis/
  if (!key) {
    fx = new Effects({ limit: 4 })
    fx.handle('event', async () => { /* 无状态根：事件无处可落，安全跳过 */ })
    _effectsByRoot.set(key, fx)
    return fx
  }
  const fs = _require('node:fs')
  const path = _require('node:path')
  const file = path.join(key, '.jarvis', 'effects.json')
  fx = new Effects({
    limit: 4,
    load: () => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return [] }
    },
    persist: (rows) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
        fs.writeFileSync(tmp, JSON.stringify(rows))
        fs.renameSync(tmp, file)
      } catch { /* 持久化失败不阻断 */ }
    },
  })
  fx.handle('event', async ({ projectDir: pd, event }) => {
    if (!pd) return
    appendEvent(pd, event.type, event.data || {})
  })
  _effectsByRoot.set(key, fx)
  return fx
}

/**
 * 组装一个绑定宿主端口 的 core Engine。
 * @param {{ projectDir?: string, fsSvc?: any, effects?: Effects, events?: any }} [opts]
 */
export function createJarvisEngine(opts = {}) {
  const projectDir = String(opts.projectDir || '')
  const fsSvc = opts.fsSvc
  const effects = opts.effects !== undefined ? opts.effects : effectsFor(projectDir)
  return createEngine({
    company: {
      read: (pd) => readCompanyState(fsSvc, pd),
      write: (pd, state) => writeCompanyState(fsSvc, state, pd),
    },
    board: {
      write: (pd, items, version) => (_rawIo.board
        ? _rawIo.board(fsSvc, pd, items, version)
        : Promise.resolve({ ok: false, error: 'board 原始 IO 未注册' })),
    },
    gates: {
      // recordGateRaw 返回布尔 true/false，这里归一成 { ok } 形态供 core Engine 使用
      record: (pd, step, ok) => {
        const r = _rawIo.gates ? _rawIo.gates(pd, step, ok) : false
        return { ok: r === true || Boolean(r && r.ok) }
      },
    },
    events: opts.events !== undefined ? opts.events : { append: appendEvent },
    guards: { stateRootOk: (pd) => !pd || !stateRootConflict(pd) },
    effects,
  })
}

/** 测试钩子：清空 Effects 单例。 */
export function _resetEngines() {
  _effectsByRoot.clear()
  _eventSeq = 0
}

export { _eventSeq }
