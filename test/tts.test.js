/** 发声通道回归测试（v0.18）。
 *
 *  背景：Ark 账号没有任何 TTS 模型（task_type 含 text_to_speech 的 0 个，
 *  output_modalities 含 audio 的 0 个），所以「JARVIS 说话」只能靠浏览器内置
 *  speechSynthesis。这条路有两个真实缺陷：
 *    ① 每句话都先发一次必然失败的 POST /api/jarvis/tts（未配置时返回 400），
 *       然后才降级到浏览器——白白浪费一次往返。
 *    ② speakBrowser 没有超时兜底：Chrome 在标签页失焦/长文本时 onend 不触发，
 *       整条播报队列永久卡死，之后再也不出声，且用户看不出原因。
 *
 *  本测试锁定修复后的三条不变量：探测缓存、超时兜底、状态如实呈现。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const uiSrc = fs.readFileSync(new URL('../webui/jarvis-v2-wings.html', import.meta.url), 'utf8')

function extractFn(src, name) {
  const a = src.indexOf('function ' + name)
  if (a < 0) throw new Error('找不到函数 ' + name)
  let i = src.indexOf('{', a)
  let d = 0
  for (; i < src.length; i += 1) {
    if (src[i] === '{') d += 1
    else if (src[i] === '}') { d -= 1; if (d === 0) break }
  }
  return src.slice(a, i + 1)
}

// ── 探测缓存：不再每句都试服务端 ───────────────────────────────────
test('TTS 可用性探测：页面加载探一次并缓存三态', () => {
  assert.ok(/__JARVIS_TTS_MODE__/.test(uiSrc), '必须有 TTS 可用性状态变量')
  assert.ok(/probeTts/.test(uiSrc), '必须有探测函数')
  assert.ok(/'unknown'/.test(uiSrc) && /'server'/.test(uiSrc) && /'browser'/.test(uiSrc),
    '三态必须齐全：unknown/server/browser')
  // 探测结论要能写入
  assert.ok(/window\.__JARVIS_TTS_MODE__\s*=/.test(uiSrc), '探测必须能更新状态')
})

test('speakNext：已知不可用时直接走浏览器（不白发请求）', () => {
  const body = extractFn(uiSrc, 'speakNext')
  assert.ok(/__JARVIS_TTS_MODE__!=='browser'/.test(body.replace(/ /g, '')) || /__JARVIS_TTS_MODE__ !== 'browser'/.test(body),
    '必须先判 mode 再决定是否试服务端')
  // 服务端失败后要把结论固化为 browser，避免后续每句都再试
  assert.ok(/unknown[\s\S]{0,80}browser/.test(body), '首句失败后应把 unknown 固化为 browser')
  // 浏览器兜底必须仍在
  assert.ok(/speakBrowser/.test(body), '服务端不可用时仍须走浏览器（不能静默无声）')
})

// ── 超时兜底：最关键的健壮性修复 ───────────────────────────────────
test('speakBrowser：必须有超时兜底（Chrome onend 可能永不触发）', () => {
  const body = extractFn(uiSrc, 'speakBrowser')
  assert.ok(/setTimeout/.test(body), '必须有超时定时器')
  assert.ok(/clearTimeout/.test(body), '正常结束时要清掉定时器，否则泄漏')
  assert.ok(/done/.test(body), '必须有幂等标记（onend 与超时可能都触发）')
  // 预算按字数估算，且有上下限
  assert.ok(/String\(s\)\.length/.test(body), '超时时长应按文本长度估算')
  assert.ok(/Math\.min\(30000/.test(body), '超时上限应为 30 秒（防一句话拖死队列）')
  assert.ok(/Math\.max\(3000/.test(body), '超时下限应 ≥3 秒（防短句被误杀）')
  // 超时后要 cancel 取消正在进行的朗读，否则可能叠加
  assert.ok(/speechSynthesis\.cancel/.test(body), '超时后应取消朗读，避免叠加/残留')
})

// ── 状态如实呈现 ──────────────────────────────────────────────────
test('updateSpeakerUI 不再是空函数：必须显示发声通道', () => {
  const body = extractFn(uiSrc, 'updateSpeakerUI')
  // 空函数的特征是正文字数为 0（除了注释）
  const codeOnly = body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/function\s+updateSpeakerUI\s*\(\)\s*\{|\}\s*$/g, '').trim()
  assert.ok(codeOnly.length > 0, `updateSpeakerUI 不能是空函数（实际正文：${codeOnly.slice(0, 40)}）`)
  assert.ok(/voice\.ch\.server|voice\.ch\.browser|voice\.ch\.muted/.test(body), '必须区分服务端/浏览器/静音三种通道')
  assert.ok(/voiceEnabled/.test(body), '静音时状态要跟着变')
})

test('发声通道文案齐备（中英双语）', () => {
  for (const k of ['voice.ch.server', 'voice.ch.browser', 'voice.ch.muted']) {
    assert.ok(uiSrc.includes(`'${k}'`), `缺少发声通道文案：${k}`)
  }
})

// ── 音色：空音色时不至于读错语言 ──────────────────────────────────
test('speakBrowser：音色为空时再取一次（getVoices 是异步的）', () => {
  const body = extractFn(uiSrc, 'speakBrowser')
  assert.ok(/if\(!preferredVoice\)|if \(!preferredVoice\)/.test(body), '音色为空时应主动再取一次')
  assert.ok(/selectJarvisVoice/.test(body), '要调用已有的音色挑选函数，而不是自己重写逻辑')
  assert.ok(/zh-CN/.test(body), '默认语言须是 zh-CN（否则中文会被英文音色读出怪调）')
})

// ── 不变量：探测失败不能导致无声 ──────────────────────────────────
test('探测异常一律按"不可用"处理，永远保留浏览器兜底', () => {
  const probe = uiSrc.slice(uiSrc.indexOf('probeTts'))
  const head = probe.slice(0, 900)
  assert.ok(/catch[\s\S]{0,80}browser/.test(head), '探测异常时应落到 browser 态（保证有声音）')
  // 不能因为探测失败就禁用播报
  assert.ok(!/catch[\s\S]{0,120}voiceEnabled\s*=\s*false/.test(head), '探测失败不得关闭播报')
})
