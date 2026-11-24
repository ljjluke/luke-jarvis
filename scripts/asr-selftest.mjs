#!/usr/bin/env node
/** 语音识别（ASR）自验脚本——模型开通后用一条命令确认链路可用。
 *
 *  为什么需要它：火山方舟的 ASR 模型（doubao-seed-2-0-lite 等）默认未开通，
 *  未开通时接口返回 ModelNotOpen。开通是账号级操作，代码无法检测「以后会不会好」，
 *  所以提供这个脚本：开通后跑一次，看到 PASS 就说明整条链路通了。
 *
 *  用法（在服务器上）：
 *    node scripts/asr-selftest.mjs                    # 用进程里的 ARK_API_KEY
 *    ARK_API_KEY=xxx node scripts/asr-selftest.mjs    # 显式给 key
 *    JARVIS_ASR_MODEL=doubao-seed-2-0-mini-260428 node scripts/asr-selftest.mjs
 *
 *  它会做三件事：
 *    ① 探测 key 是否有效（GET /models）
 *    ② 确认目标模型在本账号**已开通**（发一个极小的 chat 请求，看是否 ModelNotOpen）
 *    ③ 用一段合成音（1 秒正弦波 wav）跑完整 ASR 往返，确认音频输入字段格式被接受
 *
 *  退出码：0=全通；1=有阻塞（会打印具体是哪一步、怎么修）。
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const BASE = String(process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
const MODEL = String(process.env.JARVIS_ASR_MODEL || 'doubao-seed-2-0-lite-260428').trim()

function readKeyFromCredentials() {
  try {
    const p = path.join(os.homedir(), '.dsh', '.credentials.yaml')
    const txt = fs.readFileSync(p, 'utf8')
    const m = txt.match(/ARK_API_KEY:\s*([^\s#]+)/)
    if (m) return m[1].trim()
  } catch { /* 没有该文件 */ }
  return ''
}

/** 合成 1 秒 16kHz 单声道 wav（440Hz 正弦）。只用来验证「音频字段被接受」，
 *  模型听不出内容没关系——我们要看的是接口不报字段错误。 */
function makeTestWav(seconds = 1, rate = 16000) {
  const n = rate * seconds
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000)
    buf.writeInt16LE(v, 44 + i * 2)
  }
  return buf
}

function step(n, msg) { console.log(`\n[${n}] ${msg}`) }
function ok(msg) { console.log('  ✅ ' + msg) }
function bad(msg) { console.log('  ❌ ' + msg) }
function hint(msg) { console.log('  💡 ' + msg) }

async function main() {
  const key = String(process.env.ARK_API_KEY || '').trim() || readKeyFromCredentials()
  console.log(`ASR 自验 — 模型=${MODEL}  endpoint=${BASE}`)
  if (!key) {
    step(1, '读取 API key')
    bad('找不到 ARK_API_KEY（进程环境变量和 ~/.dsh/.credentials.yaml 都没有）')
    hint('在 /root/.dsh/.credentials.yaml 写 `ARK_API_KEY: <你的key>` 后重跑')
    process.exit(1)
  }
  ok(`key 已读取（${key.slice(0, 8)}…）`)

  step(2, '探测 key 是否有效（GET /models）')
  let modelsOk = false
  try {
    const r = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) })
    if (r.ok) { modelsOk = true; ok(`key 有效（HTTP ${r.status}）`) }
    else bad(`key 可能无效（HTTP ${r.status}）`)
  } catch (e) {
    bad('网络不通：' + String(e.message || e).slice(0, 120))
  }

  step(3, `确认模型「${MODEL}」在本账号已开通`)
  let modelOpen = false
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'OK' }], max_tokens: 4 }),
      signal: AbortSignal.timeout(30000),
    })
    const t = await r.text()
    if (r.ok) { modelOpen = true; ok('模型已开通，可用') }
    else if (/ModelNotOpen|not activated|InvalidEndpointOrModel/i.test(t)) {
      bad('模型未开通（返回 ModelNotOpen）')
      hint('登录火山方舟控制台 → 开通管理 → 找到该模型 → 激活；激活后无需改代码（或设 JARVIS_ASR_MODEL 换成已开通的模型）')
    } else {
      bad(`调用失败 HTTP ${r.status}：${t.slice(0, 200)}`)
    }
  } catch (e) {
    bad('调用异常：' + String(e.message || e).slice(0, 120))
  }
  if (!modelOpen) {
    step(4, '音频往返测试')
    console.log('  ⏭ 跳过——模型未开通，无法验证音频字段（开通后重跑本脚本）')
  } else {
    step(4, '音频往返测试（1 秒合成音，验证 input_audio 字段被接受）')
    const wav = makeTestWav(1)
    const b64 = wav.toString('base64')
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{
            role: 'user',
            content: [
              { type: 'input_audio', input_audio: { data: b64, format: 'wav' } },
              { type: 'text', text: '转写这段音频的内容；若没有语音就只回复「静音」。' },
            ],
          }],
          max_tokens: 200,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(60000),
      })
      const t = await r.text()
      if (r.ok) {
        let out = ''
        try {
          const j = JSON.parse(t)
          out = String(j?.choices?.[0]?.message?.content || '')
        } catch { /* 非 JSON */ }
        ok(`音频字段被接受，模型返回：「${out.slice(0, 80) || '(空)'}」`)
        console.log('\n链路已通。前端会在内置识别失败时自动改用这个通道。')
      } else if (/input_audio|unsupported|invalid|audio/i.test(t)) {
        bad(`音频字段可能不被该模型接受 HTTP ${r.status}：${t.slice(0, 240)}`)
        hint('Models API 显示该模型 input_modalities 含 audio；若此处报字段错误，说明接口形状与预期不同——请把这段错误反馈给我，我调整字段名。')
      } else {
        bad(`HTTP ${r.status}：${t.slice(0, 200)}`)
      }
    } catch (e) {
      bad('音频调用异常：' + String(e.message || e).slice(0, 120))
    }
  }

  console.log('\n' + '─'.repeat(60))
  if (!modelsOk) process.exit(1)
  if (!modelOpen) process.exit(1)
  process.exit(0)
}

main().catch((e) => { console.error('自验脚本异常：', e); process.exit(1) })
