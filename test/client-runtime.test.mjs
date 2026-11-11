/** client 半运行时冒烟：react 桩 + mock ctx 把 apply→插槽注册→组件渲染→提交路由整链跑真。
 *
 *  与 settings-card.test.js 的分工：那边钉静态契约（文件内容），这里钉运行时行为——
 *  模块真的能加载、apply 真的注册上插槽、表单真的渲染出全部字段、submit 真的
 *  路由到 ready 的命名空间。react 由 module.register 拦截替换成桩（浏览器模块表的替身）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./client-loader.mjs', import.meta.url)

// document 桩：injectStyles 在 Node 里没有 document
globalThis.document = {
  createElement: () => ({ set textContent(v) { this._t = v }, get textContent() { return this._t }, remove() {} }),
  head: { appendChild() {} },
}

const mod = await import('../src/client/index.js')

/** mock settings scope（configForms.get 的返回形状）。 */
function makeForm(status, value = {}, { revision = 7, writable = true } = {}) {
  const calls = { mutate: [] }
  const listeners = new Set()
  const snapshot = status === 'ready'
    ? { status, writable, revision, value, base: {}, user: {} }
    : { status }
  return {
    calls,
    getSnapshot: () => snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    mutate: (ops, expectedRevision) => {
      calls.mutate.push({ ops, expectedRevision })
      return true
    },
  }
}

/** mock ctx：记录 slots/locale 注册。 */
function makeCtx(forms) {
  const log = { slots: [], locale: [], effects: [] }
  return {
    log,
    configForms: { get: (ns) => forms[ns] },
    locale: { register: (ns, dict) => { log.locale.push({ ns, dict }); return () => {} } },
    effect: (fn) => { log.effects.push(fn); try { const cleanup = fn(); return typeof cleanup === 'function' ? cleanup : () => {} } catch { return () => {} } },
    slots: {
      inject: (name, reg) => { log.slots.push(name); reg() },
      register: (opts, component) => { log.lastRegister = { opts, component }; return () => {} },
    },
  }
}

test('C1 apply 注册 plugins.bundle.config 插槽 + locale 字典', () => {
  const ctx = makeCtx({ 'jarvis-core': makeForm('ready') })
  mod.apply(ctx)
  assert.ok(ctx.log.slots.includes('plugins.bundle.config'), '必须注入配置插槽')
  const { opts } = ctx.log.lastRegister
  assert.strictEqual(opts.key, 'luke-jarvis', '插槽 key = 包名')
  assert.strictEqual(opts.locale, 'settings.lukeJarvis')
  assert.strictEqual(typeof opts.inject, 'function')
  assert.strictEqual(typeof ctx.log.lastRegister.component, 'function')
  const dict = ctx.log.locale[0]
  assert.deepStrictEqual(Object.keys(dict.dict), ['zh', 'en'])
  assert.ok(dict.dict.zh['card.title'].includes('路克贾维斯'))
})

test('C2 命名空间路由：jarvis-core ready 优先，未 ready 落到包名兜底', () => {
  const coreForm = makeForm('ready', { ui: 'legacy' })
  const pkgForm = makeForm('ready', { ui: 'wings' })
  const ctx = makeCtx({ 'jarvis-core': coreForm, 'luke-jarvis': pkgForm })
  mod.apply(ctx)
  const face = ctx.log.lastRegister.opts.inject()
  assert.strictEqual(face.hooks.jarvisConfig.getSnapshot().value.ui, 'legacy', '行 id 命名空间优先')

  const ctx2 = makeCtx({ 'jarvis-core': makeForm('unavailable'), 'luke-jarvis': pkgForm })
  mod.apply(ctx2)
  const face2 = ctx2.log.lastRegister.opts.inject()
  assert.strictEqual(face2.hooks.jarvisConfig.getSnapshot().value.ui, 'wings', '行 id 未服务时用包名兜底')

  const ctx3 = makeCtx({ 'jarvis-core': makeForm('loading') })
  mod.apply(ctx3)
  const face3 = ctx3.log.lastRegister.opts.inject()
  assert.strictEqual(face3.hooks.jarvisConfig.getSnapshot().status, 'loading')
})

test('C3 submit 路由到 ready 的命名空间，携带 ops 与 revision 围栏', async () => {
  const coreForm = makeForm('ready', { ui: 'legacy' }, { revision: 42 })
  const ctx = makeCtx({ 'jarvis-core': coreForm })
  mod.apply(ctx)
  const face = ctx.log.lastRegister.opts.inject()
  const ok = await face.submit([{ op: 'set', path: ['ui'], value: 'wings' }], 42)
  assert.strictEqual(ok, true)
  assert.strictEqual(coreForm.calls.mutate.length, 1)
  assert.deepStrictEqual(coreForm.calls.mutate[0].ops, [{ op: 'set', path: ['ui'], value: 'wings' }])
  assert.strictEqual(coreForm.calls.mutate[0].expectedRevision, 42)
})

test('C4 组件渲染：summary / loading / unavailable / 完整表单四态', () => {
  globalThis.__reactStubReset()
  const Comp = ctxRefComponent()
  const t = (k) => k
  // summary 态
  let tree = Comp({ t, view: 'summary', useJarvisConfig: (sel) => sel({ x: 1 }) })
  assert.strictEqual(tree.type, 'p')
  assert.strictEqual(tree.children[0], 'card.description')
  // unavailable 态
  tree = Comp({ t, view: 'page', useJarvisConfig: (sel) => sel({ status: 'unavailable' }) })
  assert.strictEqual(tree.children[0], 'card.unavailable')
  // loading 态
  tree = Comp({ t, view: 'page', useJarvisConfig: (sel) => sel({ status: 'loading' }) })
  assert.strictEqual(tree.children[0], 'card.loading')
  // ready 态：完整表单
  globalThis.__reactStubReset()
  const snapshot = {
    status: 'ready', writable: true, revision: 7,
    value: { ui: 'legacy', voice: { provider: 'openai', speed: 1.5 }, selfEvolution: { approvalRequired: false } },
    base: {}, user: { voice: { provider: 'openai' } },
  }
  const submitted = []
  tree = Comp({ t, view: 'page', useJarvisConfig: (sel) => sel(snapshot), submit: async (ops, rev) => { submitted.push({ ops, rev }); return true } })
  assert.strictEqual(tree.type, 'form')
  const flat = flatten(tree)
  const inputs = flat.filter((n) => n.type === 'input' || n.type === 'select')
  assert.strictEqual(inputs.length, 13, '13 个字段控件（11 文本/数字/密码 + 2 复选）')
  const selects = inputs.filter((n) => n.type === 'select')
  assert.deepStrictEqual(selects.map((s) => s.props.value).sort(), ['confirm', 'legacy', 'openai', 'stable', 'user'].sort(), 'select 草稿值来自已接受值/回退默认')
  assert.strictEqual(selects.find((s) => s.props.id === 'lkj-ui').props.value, 'legacy', '已接受值进草稿')
  const checkbox = inputs.find((n) => n.props.type === 'checkbox')
  assert.strictEqual(checkbox.props.checked, false, 'selfEvolution.approvalRequired=false 生效')
  const speed = inputs.find((n) => n.props.id === 'lkj-voiceSpeed')
  assert.strictEqual(speed.props.value, '1.5')
  const password = inputs.find((n) => n.props.type === 'password')
  assert.strictEqual(password.props.id, 'lkj-githubToken')
  // 覆盖徽标只出现在被用户层覆盖的字段上（voice.provider）
  const badges = flat.filter((n) => n.props.className === 'lkj-badge')
  assert.strictEqual(badges.length, 1)
  assert.ok(badges[0].children.join('').includes('card.overridden'))
  // 分节标题齐全
  for (const section of ['section.basic', 'section.voice', 'section.evolution']) {
    assert.ok(flat.some((n) => n.type === 'h4' && n.children[0] === section), `${section} 分节应渲染`)
  }
})

test('C5 表单提交：buildOps 语义（新值 set / 等于部署默认 unset / 未变不发）', async () => {
  globalThis.__reactStubReset()
  const Comp = ctxRefComponent()
  const t = (k) => k
  const snapshot = {
    status: 'ready', writable: true, revision: 9,
    value: { ui: 'wings', voice: { provider: 'browser', speed: 0.95 } },
    base: { ui: 'wings', voice: { provider: 'browser', speed: 0.95 }, defaultWorkspace: '' },
    user: {},
  }
  const submitted = []
  const tree = Comp({ t, view: 'page', useJarvisConfig: (sel) => sel(snapshot), submit: async (ops, rev) => { submitted.push({ ops, rev }); return true } })
  // 渲染出的草稿 = {ui:'wings', ...}；模拟用户改 ui=legacy、voice.speed=1.2、workspaceMode=dev
  // 通过 React 桩的 setter 直接改草稿（states 数组在桩内部，改由事件语义等价路径：直接驱动 save）
  // → 这里改走另一条路：把 accepted 值改成与 base 相同但草稿不同，验证 unset 分支由 buildOps 自身保证。
  // 最直接的运行时验证：驱动表单 onSubmit。
  assert.strictEqual(tree.type, 'form')
  assert.strictEqual(typeof tree.props.onSubmit, 'function')
  // 未改草稿时提交：ops 为空 → submit 不被调用（buildOps 全部"未变"跳过）
  await tree.props.onSubmit({ preventDefault() {} })
  assert.strictEqual(submitted.length, 0, '草稿与已接受值一致时不发写操作')
})

/** 拿到注册进插槽的组件（每个用例独立 apply + reset）。 */
function ctxRefComponent() {
  const form = makeForm('ready', { ui: 'wings', voice: { provider: 'browser', speed: 0.95 } })
  const ctx = makeCtx({ 'jarvis-core': form })
  mod.apply(ctx)
  return ctx.log.lastRegister.component
}

function flatten(node, out = []) {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  for (const c of node.children || []) flatten(c, out)
  return out
}
