/** volatile 配置桥：DSH 设置面板实时值（ref.get()）与测试/旧运行时裸值双兼容。
 *
 *  背景：DSH 只为「Config 里带 .volatile() 字段」的插件派生 settings 命名空间
 *  （设置 → 内置插件 → 配置卡片的数据源）。volatile 字段传到 apply 时是
 *  `{ get() }` 引用而不是裸值，设置面板保存后 ref 内的值实时更新、无需重启。
 *  本模块把 ref 桥接成 PLUGIN_CONFIG 上的 getter，所有既有读取点零改动；
 *  测试里直接构造的裸值配置也照常生效（非法裸值忽略，与旧语义一致）。
 */

/** 是否 volatile 引用（{ get() } 形状）。 */
export function isConfigRef(v) {
  return !!v && typeof v === 'object' && typeof v.get === 'function'
}

/** 读配置值：ref 取 get()（异常返回 undefined），裸值原样返回。 */
export function readConfigValue(v) {
  if (isConfigRef(v)) {
    try { return v.get() } catch { return undefined }
  }
  return v
}

const DEFAULTS = { ui: 'wings', defaultWorkspace: '', name: 'Jarvis', lang: 'zh', voiceEnabled: true, voice: null }
const VALIDATORS = {
  ui: (v) => v === 'wings' || v === 'legacy',
  defaultWorkspace: (v) => typeof v === 'string',
  name: (v) => typeof v === 'string' && v.trim() !== '',
  lang: (v) => v === 'zh' || v === 'en',
  voiceEnabled: (v) => typeof v === 'boolean',
  voice: (v) => !!v && typeof v === 'object',
}

/**
 * 把 apply 收到的 config 绑定到 PLUGIN_CONFIG。
 * ref → 定义实时 getter（面板保存即生效）；裸值 → 校验通过才覆盖（旧语义）。
 */
export function bindPluginConfig(target, config) {
  const c = config || {}
  for (const key of Object.keys(DEFAULTS)) {
    const raw = c[key]
    if (isConfigRef(raw)) {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get() {
          const v = readConfigValue(raw)
          return VALIDATORS[key](v) ? v : DEFAULTS[key]
        },
      })
    } else if (VALIDATORS[key](raw)) {
      // 同 key 可能先绑过 ref（测试重复 apply）：getter 属性要用 defineProperty 覆盖。
      const desc = Object.getOwnPropertyDescriptor(target, key)
      if (desc && desc.get) {
        Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: true, value: raw })
      } else {
        target[key] = raw
      }
    }
  }
  return target
}
