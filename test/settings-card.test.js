/** 设置卡片（client 半）与 volatile 配置桥契约测试。
 *
 *  背景：客户反馈"DSH 设置里没有路克贾维斯"。根因是原版 DSH 不会凭 host 的 Config
 *  自动生成设置 UI——配置卡片由插件 client 半注册（官方 dsh-plugin-template 契约）。
 *  这组测试把"卡片为什么能出现"的全部接线钉死，防回归。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isConfigRef, readConfigValue, bindPluginConfig } from '../src/host/state/liveconfig.js'
import {
  setSelfEvolutionConfig,
  bindSelfEvolutionLive,
  getSelfEvolutionConfig,
  _resetSelfEvolutionConfigForTests,
} from '../src/host/state/selfconfig.js'
import { Config } from '../src/host/plugin.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('S1 package.json 声明 dsh.client（plugin-manager 注入）+ exports./client 指向真实文件', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.ok(pkg.dsh && pkg.dsh.client, '必须有 dsh.client 声明（client 模块发现的入口）')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'))
  const clientEntry = pkg.exports['./client']
  assert.ok(clientEntry, 'exports 必须暴露 ./client')
  assert.ok(fs.existsSync(path.join(ROOT, clientEntry)), 'client 入口文件必须真实存在且随包发布')
  assert.ok(pkg.files.includes('src'), 'src 在 files 白名单内（client 随 npm 包发布）')
})

test('S2 client 半静态契约：插槽/命名空间/inject/apply 全部对齐官方模板', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/client/index.js'), 'utf8')
  assert.ok(src.includes("from 'react'"), 'react 由浏览器模块表提供（无构建步骤）')
  assert.ok(src.includes("'plugins.bundle.config'"), '必须注册 plugins.bundle.config 插槽')
  assert.ok(src.includes("const SLOT_KEY = 'luke-jarvis'"), '插槽 key = 包名（Plugins 页 entryKey）')
  assert.ok(src.includes("'jarvis-core'"), 'settings 命名空间首选 cordis.patch.yml 行 id')
  assert.ok(src.includes('configForms'), '表单数据来自 ctx.configForms（页面不传 form）')
  assert.ok(src.includes("export const inject = ['slots', 'locale', 'configForms']"))
  assert.ok(src.includes('export function apply(ctx)'))
  assert.ok(!/from '\.\.\/host|from '\.\/host|node:/.test(src), 'client 半不得 import host 侧或 Node 内置模块')
  // 每个字段的 locale 文案 zh/en 齐全（表单是手写的，漏 key 就显示原始键名）
  for (const id of ['ui', 'defaultWorkspace', 'workspaceMode', 'voiceProvider', 'voiceBaseUrl', 'voiceModel', 'voiceVoice', 'voiceSpeed', 'githubRepo', 'githubToken', 'reportMode', 'approvalRequired', 'releaseChannel']) {
    const occurrences = src.split(`'field.${id}.label'`).length - 1
    assert.ok(occurrences >= 2, `field.${id}.label 应有 zh + en 两份文案（实际 ${occurrences} 处）`)
    assert.ok(src.includes(`'field.${id}.hint'`), `field.${id}.hint 文案缺失`)
  }
})

test('S3 liveconfig：裸值兼容（合法覆盖/非法忽略）', () => {
  const target = { ui: 'wings', defaultWorkspace: '', voice: null }
  bindPluginConfig(target, { ui: 'legacy', defaultWorkspace: '/x', voice: { provider: 'openai' } })
  assert.strictEqual(target.ui, 'legacy')
  assert.strictEqual(target.defaultWorkspace, '/x')
  assert.deepStrictEqual(target.voice, { provider: 'openai' })
  bindPluginConfig(target, { ui: 'bad-value', defaultWorkspace: 42, voice: null })
  assert.strictEqual(target.ui, 'legacy', '非法裸值忽略，保持旧值')
  assert.strictEqual(target.defaultWorkspace, '/x')
  assert.deepStrictEqual(target.voice, { provider: 'openai' })
})

test('S4 liveconfig：volatile ref 绑定实时 getter，ref 值变化即生效', () => {
  const target = { ui: 'wings', defaultWorkspace: '', voice: null }
  let current = 'wings'
  bindPluginConfig(target, { ui: { get: () => current } })
  assert.strictEqual(target.ui, 'wings')
  current = 'legacy'
  assert.strictEqual(target.ui, 'legacy', 'ref 更新后读取点零改动拿到新值')
  current = 'garbage'
  assert.strictEqual(target.ui, 'wings', 'ref 给出非法值时回落默认')
  // 裸值可以覆盖先绑的 ref（测试重复 apply 的场景）
  bindPluginConfig(target, { ui: 'legacy' })
  assert.strictEqual(target.ui, 'legacy')
})

test('S5 liveconfig：真实 Config 解析产物（schemastery volatile ref）可直接绑定', () => {
  const parsed = Config({ ui: 'legacy', defaultWorkspace: '/ws', voice: { provider: 'openai', speed: 1.2 } })
  assert.ok(isConfigRef(parsed.ui), 'volatile 字段解析后是 ref')
  const target = { ui: 'wings', defaultWorkspace: '', voice: null }
  bindPluginConfig(target, parsed)
  assert.strictEqual(target.ui, 'legacy')
  assert.strictEqual(target.defaultWorkspace, '/ws')
  assert.strictEqual(target.voice.provider, 'openai')
  assert.strictEqual(target.voice.speed, 1.2)
  assert.strictEqual(readConfigValue(parsed.ui), 'legacy')
})

test('S6 selfconfig：volatile 实时源叠加，面板保存后工具下轮即读新值', () => {
  _resetSelfEvolutionConfigForTests()
  const parsed = Config({ workspaceMode: 'dev', selfEvolution: { githubToken: 'tok-1', reportMode: 'auto', approvalRequired: false } })
  setSelfEvolutionConfig({ ...readConfigValue(parsed.selfEvolution), workspaceMode: readConfigValue(parsed.workspaceMode) })
  bindSelfEvolutionLive(parsed)
  const c1 = getSelfEvolutionConfig()
  assert.strictEqual(c1.workspaceMode, 'dev')
  assert.strictEqual(c1.githubToken, 'tok-1')
  assert.strictEqual(c1.reportMode, 'auto')
  assert.strictEqual(c1.approvalRequired, false)
  assert.strictEqual(c1.releaseChannel, 'stable', '未覆盖字段保持默认')
  // 模拟面板保存：换一个 ref 值来源（实时语义由 S4 覆盖，这里验证叠加逻辑不缓存）
  let mode = 'dev'
  bindSelfEvolutionLive({ workspaceMode: { get: () => mode }, selfEvolution: null })
  mode = 'user'
  assert.strictEqual(getSelfEvolutionConfig().workspaceMode, 'user')
  _resetSelfEvolutionConfigForTests()
  assert.strictEqual(getSelfEvolutionConfig().workspaceMode, 'user')
  assert.strictEqual(getSelfEvolutionConfig().githubToken, '')
})

test('S7 selfconfig：实时源非法值被校验拦截，不污染运行配置', () => {
  _resetSelfEvolutionConfigForTests()
  setSelfEvolutionConfig({ workspaceMode: 'dev' })
  bindSelfEvolutionLive({
    workspaceMode: { get: () => 'root' },
    selfEvolution: { get: () => ({ reportMode: 'yolo', approvalRequired: 'yes', githubToken: 42 }) },
  })
  const c = getSelfEvolutionConfig()
  assert.strictEqual(c.workspaceMode, 'dev', '非法角色值回落落定值')
  assert.strictEqual(c.reportMode, 'confirm')
  assert.strictEqual(c.approvalRequired, true)
  assert.strictEqual(c.githubToken, '')
  _resetSelfEvolutionConfigForTests()
})
