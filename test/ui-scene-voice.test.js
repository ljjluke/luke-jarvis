/** 团队一览换 PixOffice 场景 + 语音播报修正（只报事件，不因切页面重复报）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const html = () => fs.readFileSync(new URL('../webui/jarvis-v2-wings.html', import.meta.url), 'utf8')

test('团队一览：嵌入项目内置的 PixOffice 场景（不是外部网站）', () => {
  const h = html()
  assert.ok(/id="teamScene"[^>]*src="\/jarvis-office\/jarvis-scene\.html"/.test(h), '团队页必须嵌本地 PixOffice 场景')
  assert.ok(/\.team-scene-frame\{/.test(h), 'iframe 要有铺满的样式')
  assert.ok(!/class="person p1"/.test(h), '不再用自绘 CSS 假人')
  assert.ok(!/class="worker-model"/.test(h) || !/teamScene.*worker-model/.test(h), '假人结构与 iframe 不共存')
})

test('团队一览：无团队时仍给空状态（iframe 之外）', () => {
  const h = html()
  assert.ok(/id="officeEmpty"/.test(h), '要有空状态占位')
  assert.ok(/emptyEl\.style\.display=rows\.length\?'none':'block'/.test(h), '有成员时隐藏空状态')
})

test('语音：切页面不播报（用户要求不重复念）', () => {
  const h = html()
  // 三个 show* 函数签名里不能再有 announce，也不能调 speak
  assert.ok(/function showMain\(\)\{currentView='main'/.test(h), 'showMain 不得带 announce')
  assert.ok(/function showTeam\(\)\{currentView='team'/.test(h), 'showTeam 不得带 announce')
  const showTeamBody = h.slice(h.indexOf('function showTeam()'), h.indexOf('function showTeam()') + 200)
  assert.ok(!/speak\(/.test(showTeamBody), 'showTeam 不得播报')
  const showProgBody = h.slice(h.indexOf('function showProgress('), h.indexOf('function showProgress(') + 260)
  assert.ok(!/speak\(/.test(showProgBody), 'showProgress 不得播报')
})

test('语音：事件驱动全局播报（完成/汇报类才念）+ 首轮静默 + 去重', () => {
  const h = html()
  assert.ok(/function announceEvents\(fresh\)/.test(h), '要有事件播报函数')
  assert.ok(/ty==='task\.completed'/.test(h), '完成任务要播')
  assert.ok(/LIVE\.announceArmed/.test(h), '首轮（历史事件）要静默，不念旧账')
  assert.ok(/seq<=LIVE\.maxEventSeq/.test(h), '同一事件不能重复播（按 seq 去重）')
  // 播报不受当前页面限制（系统级，不看 currentView）
  const fnBody = h.slice(h.indexOf('function announceEvents('), h.indexOf('function announceEvents(') + 900)
  assert.ok(!/currentView/.test(fnBody), '播报不该依赖当前在哪个页面')
})
