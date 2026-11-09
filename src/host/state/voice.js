/** 语音模型配置（全局设置，不只某个项目）。多供应商版。
 *
 *  数据模型（`~/.dsh/luke-jarvis/voice.json`，权限 600）：
 *   {
 *     "active": "我的OpenAI",            // 当前生效的供应商卡名（空 = 浏览器语音）
 *     "providers": [                     // 供应商卡片数组，设置页可增删/切换
 *       { "name": "我的OpenAI", "protocol": "openai", "baseUrl": "https://api.openai.com/v1",
 *         "apiKey": "sk-…", "model": "gpt-4o-mini-tts", "voice": "nova", "speed": 0.95 }
 *     ]
 *   }
 *
 *  协议不锁死厂商：protocol 决定接入方式——
 *   browser = 浏览器本地语音（无需服务）；openai = OpenAI 兼容 /audio/speech
 *   （OpenAI、SiliconFlow、自建 GPT-SoVITS/IndexTTS 网关等，换厂商只改 baseUrl）；
 *   aliyun = DashScope（qwen-tts / CosyVoice，非 OpenAI 协议单独适配）。
 *
 *  API Key 只写不读：GET 返回掩码 `sk-…abcd`，PUT 时空字符串表示"按名字保留原值"。
 *  兼容旧单配置格式：读入时自动迁移为 providers[0]。
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
  models: ['qwen-tts', 'cosyvoice-v2', 'gpt-4o-mini-tts', 'tts-1', 'tts-1-hd', 'index-tts', 'gpt-sovits'],
}

export const VOICE_PROTOCOLS = ['browser', 'openai', 'aliyun']

export function voiceConfigPath() {
  const path = _require('node:path')
  const os = _require('node:os')
  const home = process.env.HOME || os.homedir() || '/root'
  return path.join(home, '.dsh/luke-jarvis/voice.json')
}

const DEFAULTS = { active: '', providers: [] }

export function maskKey(key) {
  const k = String(key || '')
  if (!k) return ''
  if (k.length <= 8) return '****'
  return `${k.slice(0, 3)}…${k.slice(-4)}`
}

/** 规范化一张供应商卡；prev 同名旧卡用于 apiKey 空值保留。 */
function normCard(p, prev) {
  const o = p && typeof p === 'object' ? p : {}
  const protocol = VOICE_PROTOCOLS.includes(String(o.protocol))
    ? String(o.protocol)
    : (VOICE_PROTOCOLS.includes(String(o.provider)) ? String(o.provider) : 'openai')
  let name = String(o.name || '').trim()
  if (!name) {
    const host = String(o.baseUrl || '').replace(/^https?:\/\//, '').split(/[/?#]/)[0]
    name = host || (protocol === 'browser' ? '浏览器语音' : '未命名供应商')
  }
  let apiKey = String(o.apiKey || '').trim()
  if (!apiKey && prev && typeof prev === 'object' && prev.apiKey) apiKey = String(prev.apiKey)
  return {
    name,
    protocol,
    baseUrl: String(o.baseUrl || '').trim(),
    apiKey,
    model: String(o.model || '').trim(),
    voice: String(o.voice || '').trim() || 'nova',
    speed: Math.max(0.5, Math.min(1.5, Number(o.speed) || 0.95)),
  }
}

/** 任意输入（voice.json 原文 / Config 默认 / 未知形状）→ 规范化 {active, providers}；旧单配置自动迁移。 */
export function normalizeVoiceState(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  if (Array.isArray(r.providers)) {
    const providers = r.providers.map((p) => normCard(p))
    const active = String(r.active || '').trim()
    return { active: providers.some((p) => p.name === active && p.protocol !== 'browser') ? active : '', providers }
  }
  // 旧单配置格式迁移：{provider,baseUrl,apiKey,model,voice,speed}
  if (r.provider || r.baseUrl || r.apiKey || r.model) {
    const card = normCard(r)
    if (card.protocol === 'browser') return { active: '', providers: [] }
    return { active: card.name, providers: [card] }
  }
  return { ...DEFAULTS, providers: [] }
}

export function readVoiceConfig() {
  const fs = _require('node:fs')
  try {
    return normalizeVoiceState(JSON.parse(fs.readFileSync(voiceConfigPath(), 'utf8')))
  } catch {
    return { ...DEFAULTS, providers: [] }
  }
}

/** 读原始 voice.json（不规范化）：用于 apiKey 空值保留等场景。 */
export function readVoiceConfigRaw() {
  const fs = _require('node:fs')
  try { return JSON.parse(fs.readFileSync(voiceConfigPath(), 'utf8')) } catch { return {} }
}

/** 写入（body: {active, providers}；卡内 apiKey 空 = 按 name 保留原值）；兼容旧单配置 patch。 */
export function saveVoiceConfig(patch = {}) {
  const fs = _require('node:fs')
  const path = _require('node:path')
  const cur = readVoiceConfig()
  let incoming = patch && typeof patch === 'object' ? patch : {}
  if (!Array.isArray(incoming.providers) && (incoming.provider || incoming.baseUrl || incoming.model)) {
    // 旧格式：只更新第一张卡
    const first = cur.providers[0] || { name: '默认供应商' }
    incoming = {
      active: String(incoming.provider) === 'browser' ? '' : first.name,
      providers: [{ ...first, ...incoming, name: first.name }],
    }
  }
  const prevList = cur.providers.slice()
  const rawRaw = readVoiceConfigRaw()
  const prevRawList = Array.isArray(rawRaw && rawRaw.providers) ? rawRaw.providers : []
  const providers = (Array.isArray(incoming.providers) ? incoming.providers : prevList).map((p) => {
    const o = normCard(p, prevList.find((q) => q.name === (p && p.name)) || prevRawList.find((q) => q && q.name === (p && p.name)))
    if (!o.apiKey) {
      const old = prevRawList.find((q) => q && q.name === o.name) || prevList.find((q) => q.name === o.name)
      if (old && old.apiKey) o.apiKey = String(old.apiKey)
    }
    return o
  })
  const active = String(incoming.active ?? '').trim()
  const next = { active: providers.some((p) => p.name === active && p.protocol !== 'browser') ? active : '', providers }
  const file = voiceConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* 非 POSIX 忽略 */ }
  return next
}

/** 解析当前生效供应商 → 下游 TTS 用的扁平 cfg（provider=protocol）。无 active / browser → 浏览器语音。 */
export function resolveActiveVoice(state) {
  const s = normalizeVoiceState(state)
  const card = s.active ? s.providers.find((p) => p.name === s.active) : null
  if (!card || card.protocol === 'browser') {
    return { provider: 'browser', baseUrl: '', apiKey: '', model: '', voice: 'nova', speed: 0.95 }
  }
  return { provider: card.protocol, baseUrl: card.baseUrl, apiKey: card.apiKey, model: card.model, voice: card.voice, speed: card.speed }
}

/** 设置页用的完整状态（apiKey 掩码、只写不读）。 */
export function publicVoiceState(state) {
  const s = normalizeVoiceState(state)
  return {
    active: s.active,
    providers: s.providers.map((p) => ({
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      model: p.model,
      voice: p.voice,
      speed: p.speed,
      apiKeyMasked: maskKey(p.apiKey),
      configured: p.protocol === 'browser' ? true : Boolean(p.apiKey && (p.protocol === 'aliyun' || p.baseUrl)),
    })),
    configPath: voiceConfigPath(),
  }
}

/** 兼容旧扁平形状（apiKey 掩码）：解析当前生效供应商后的对外视图。 */
export function publicVoiceConfig(cfg) {
  const flat = resolveActiveVoice(cfg)
  return {
    provider: flat.provider,
    baseUrl: flat.baseUrl,
    model: flat.model,
    voice: flat.voice,
    speed: flat.speed,
    apiKeyMasked: maskKey(flat.apiKey),
    configured: flat.provider !== 'browser' && Boolean(flat.apiKey && (flat.provider === 'aliyun' || flat.baseUrl)),
    configPath: voiceConfigPath(),
  }
}

/** 规范化 baseUrl：允许用户填 `https://api.openai.com/v1` 或完整 `/audio/speech`。 */
export function speechEndpoint(cfg) {
  const base = String(cfg?.baseUrl || '').replace(/\/+$/, '')
  if (!base) return ''
  if (/\/audio\/speech$/.test(base)) return base
  return base + '/audio/speech'
}
