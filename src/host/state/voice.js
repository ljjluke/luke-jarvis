/** 语音模型配置（全局设置，不只某个项目）。

 *  用户要求：在 DSH 的设计里加一个设置项，可以配置语音大模型并选择音色。
 *  设计：
 *   - 配置文件 `~/.dsh/luke-jarvis/voice.json`（全局；换项目不用重配），权限 600；
 *   - 只支持 **OpenAI 兼容的 /audio/speech**（覆盖 OpenAI、SiliconFlow CosyVoice、自建 GPT-SoVITS/IndexTTS 网关），
 *     `provider: 'browser'` 时完全用浏览器语音，不依赖任何服务；
 *   - API Key 只写不读：GET 返回掩码 `sk-…abcd`，PUT 时空字符串表示"保持原值"。
 */
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

export const VOICE_PRESETS = {
  voices: [
    { id: 'nova', label: 'nova · 成熟女声（通用）' },
    { id: 'shimmer', label: 'shimmer · 温柔女声' },
    { id: 'alloy', label: 'alloy · 中性' },
    { id: 'echo', label: 'echo · 偏低沉' },
    { id: 'fable', label: 'fable · 叙事感' },
    { id: 'onyx', label: 'onyx · 低沉男声' },
    { id: 'longxiaochun', label: 'longxiaochun · 龙小春（CosyVoice 女声）' },
    { id: 'longwan', label: 'longwan · 龙婉（CosyVoice 女声）' },
  ],
  models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd', 'cosyvoice-v2', 'index-tts', 'gpt-sovits'],
}

export function voiceConfigPath() {
  const path = _require('node:path')
  const os = _require('node:os')
  const home = process.env.HOME || os.homedir() || '/root'
  return path.join(home, '.dsh/luke-jarvis/voice.json')
}

const DEFAULTS = { provider: 'browser', baseUrl: '', apiKey: '', model: '', voice: 'nova', speed: 0.95 }

export function maskKey(key) {
  const k = String(key || '')
  if (!k) return ''
  if (k.length <= 8) return '****'
  return `${k.slice(0, 3)}…${k.slice(-4)}`
}

export function readVoiceConfig() {
  const fs = _require('node:fs')
  try {
    const raw = JSON.parse(fs.readFileSync(voiceConfigPath(), 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

/** 读原始 voice.json（不注入内置默认值）：用于区分「用户显式保存」与「默认填充」。 */
export function readVoiceConfigRaw() {
  const fs = _require('node:fs')
  try { return JSON.parse(fs.readFileSync(voiceConfigPath(), 'utf8')) } catch { return {} }
}

/** 写入（apiKey 空 = 保留原值）；返回落盘后的配置。 */
export function saveVoiceConfig(patch = {}) {
  const fs = _require('node:fs')
  const path = _require('node:path')
  const cur = readVoiceConfig()
  const next = { ...cur }
  if (patch.provider !== undefined) next.provider = patch.provider === 'openai' ? 'openai' : 'browser'
  if (patch.baseUrl !== undefined) next.baseUrl = String(patch.baseUrl || '').trim()
  if (patch.model !== undefined) next.model = String(patch.model || '').trim()
  if (patch.voice !== undefined) next.voice = String(patch.voice || '').trim()
  if (patch.speed !== undefined) next.speed = Math.max(0.5, Math.min(1.5, Number(patch.speed) || 0.95))
  if (patch.apiKey !== undefined && String(patch.apiKey || '').trim()) next.apiKey = String(patch.apiKey).trim()
  const file = voiceConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* 非 POSIX 忽略 */ }
  return next
}

/** 对外暴露的配置（apiKey 一律掩码）。 */
export function publicVoiceConfig(cfg = readVoiceConfig()) {
  const c = cfg || {}
  return {
    provider: c.provider === 'openai' ? 'openai' : 'browser',
    baseUrl: c.baseUrl || '',
    model: c.model || '',
    voice: c.voice || '',
    speed: Number(c.speed || 0.95),
    apiKeyMasked: maskKey(c.apiKey),
    configured: Boolean(c.provider === 'openai' && c.baseUrl && c.apiKey),
    configPath: voiceConfigPath(),
    note: c.provider === 'openai' && !(c.baseUrl && c.apiKey)
      ? '已选语音模型模式，但还缺服务地址或 API Key——这时会回退浏览器语音'
      : undefined,
  }
}

/** 规范化 baseUrl：允许用户填 `https://api.openai.com/v1` 或完整 `/audio/speech`。 */
export function speechEndpoint(cfg) {
  const base = String(cfg?.baseUrl || '').replace(/\/+$/, '')
  if (!base) return ''
  if (/\/audio\/speech$/.test(base)) return base
  return base + '/audio/speech'
}
