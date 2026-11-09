// ══════════════════════════════════════════════════════════════════════════════
// 本地 JSON Schema 校验（替代 @deepseek-ai/dsh-tools 的同名断言，零外部依赖）
//
// 为什么要替代：插件装进 profile 后，`@deepseek-ai/dsh-tools` 会连带解析它的一堆 peer 依赖
// （cordis / dsh-scope / dsh-agent / dsh-llm …），profile 里没有这些 → **插件在真实安装环境里加载失败**
// （doctor 实测：Cannot find package '@deepseek-ai/dsh-scope'）。工具定义校验只用到两个断言，
// 本地实现即可让插件保持零重依赖，安装后一定能加载。
//
// 校验范围 = DSH 工具契约要求的结构化输出子集（type/properties/required/additionalProperties/items/
// enum/const/oneOf/anyOf/description/default/min/max/pattern/format）。超出子集 → 抛错（坏定义在 apply 期暴露）。
// ══════════════════════════════════════════════════════════════════════════════

const ALLOWED_KEYS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'oneOf', 'anyOf', 'allOf', 'description', 'title', 'default', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems',
])
const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

export class JsonSchemaError extends TypeError {
  constructor(violations) {
    super(`unsupported JSON schema: ${violations.join('; ')}`)
    this.name = 'JsonSchemaError'
    this.violations = violations
  }
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function checkNode(node, pathName, violations) {
  if (node === true || node === false) return // 布尔 schema 是合法 JSON Schema
  if (!isRecord(node)) { violations.push(`${pathName} must be an object schema`); return }
  for (const key of Object.keys(node)) {
    if (!ALLOWED_KEYS.has(key)) violations.push(`${pathName}.${key} is not in the supported subset`)
  }
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type]
    for (const t of types) {
      if (!ALLOWED_TYPES.has(t)) violations.push(`${pathName}.type "${t}" is not supported`)
    }
  }
  if (node.properties !== undefined) {
    if (!isRecord(node.properties)) violations.push(`${pathName}.properties must be an object`)
    else for (const [k, v] of Object.entries(node.properties)) checkNode(v, `${pathName}.properties.${k}`, violations)
  }
  if (node.items !== undefined) {
    if (Array.isArray(node.items)) violations.push(`${pathName}.items must be a schema (tuple form unsupported)`)
    else checkNode(node.items, `${pathName}.items`, violations)
  }
  if (node.required !== undefined && (!Array.isArray(node.required) || node.required.some((r) => typeof r !== 'string'))) {
    violations.push(`${pathName}.required must be string[]`)
  }
  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') {
    checkNode(node.additionalProperties, `${pathName}.additionalProperties`, violations)
  }
  for (const comb of ['oneOf', 'anyOf', 'allOf']) {
    if (node[comb] === undefined) continue
    if (!Array.isArray(node[comb])) violations.push(`${pathName}.${comb} must be an array`)
    else node[comb].forEach((v, i) => checkNode(v, `${pathName}.${comb}[${i}]`, violations))
  }
  if (node.enum !== undefined && !Array.isArray(node.enum)) violations.push(`${pathName}.enum must be an array`)
}

/** 断言属于受支持子集。 */
export function assertSupportedJsonSchema(schema) {
  const violations = []
  checkNode(schema, 'schema', violations)
  if (violations.length) throw new JsonSchemaError(violations)
}

/** 断言受支持子集 + object 根（结构化输出的要求）。 */
export function assertObjectJsonSchema(schema) {
  const violations = []
  checkNode(schema, 'schema', violations)
  if (!violations.length && (!isRecord(schema) || !Object.hasOwn(schema, 'type') || schema.type !== 'object')) {
    violations.push('schema.type must be "object" (structured output is object-rooted)')
  }
  if (violations.length) throw new JsonSchemaError(violations)
}
