#!/usr/bin/env node
/**
 * WeightRegistry — 可学习的权重注册表
 *
 * 所有硬编码权重的持久化替代方案。
 * 从 pipeline 验证结果中学习，自动调整系数。
 *
 * 用法:
 *   node skills/ponder/scripts/weights.cjs status           — 查看所有权重
 *   node skills/ponder/scripts/weights.cjs get <key>        — 获取单个权重
 *   node skills/ponder/scripts/weights.cjs set <key> <val>  — 手动设置
 *   node skills/ponder/scripts/weights.cjs learn '<json>'   — 从pipeline结果自动学习
 *   node skills/ponder/scripts/weights.cjs reset            — 恢复出厂设置
 *
 * 学习信号:
 *   verifyPassed → 当前权重被"确认"，微幅向使用值巩固
 *   verifyFailed → 主导不确定性类型的系数不足 → 增加
 *   boundaryHelped → 边界加深有效 → 阈值略微提高（减少敏感度）
 *   boundaryMissed → 边界未触发但验证失败 → 阈值降低（增加敏感度）
 */

const path = require('path')
const fs = require('fs')
const { dataRoot } = require('./_lib/runtime-paths.cjs')

const DATA_DIR = dataRoot
const WEIGHTS_FILE = path.join(DATA_DIR, 'learned-weights.cjson')

const DEFAULT_WEIGHTS = {
  // ── 不确定性合成系数 ──
  // 加权组合: composite = amb * w_amb + risk * w_risk + ign * w_ign
  uncertainty_ambiguity: 0.35,
  uncertainty_risk: 0.40,
  uncertainty_ignorance: 0.25,

  // ── 不确定性分级阈值 ──
  uncertainty_low: 0.30,
  uncertainty_medium: 0.55,

  // ── 事件边界检测阈值 ──
  // error > boundary_deepen → 立即加深
  // error > boundary_adjust → 日志提醒
  // *_strict 用于收敛→验证（更严格）
  boundary_deepen: 0.50,
  boundary_adjust: 0.25,
  boundary_deepen_strict: 0.40,
  boundary_adjust_strict: 0.15,

  // ── 自由能系数 ──
  free_energy_verify: 0.4,
  free_energy_selfcheck: 0.3,
  free_energy_prederror: 0.3,

  // ── V_final 排名权重 (converge engine) ──
  // ⚠️ 孤儿键（v1.18.36 核实）：全库无任何代码读取 vfinal_* 用于排名加权。
  // learn() 可写入、get() 可读取，但无调用方。设计意图是给 converge 阶段加权幸存方案排名，
  // 但 converge 逻辑当前不读它，"可学习"是装饰性的。待 converge 引擎接入加权排名后启用，
  // 在此之前不要误以为这三项权重正在影响评分。见 engine/working-stance.md 的进化回路诊断。
  vfinal_feas: 0.5,
  vfinal_robust: 0.3,
  vfinal_persp: 0.2,

  // ── 清晰度评分权重 (evolve.cjs 多信号清晰度可信分, v1.18.42 从硬编码改为可学习) ──
  // 之前 evolve.cjs 第278行 isClearWeight=0.25/0.35 等硬编码三元运算, 学了也不读.
  // 现注册成可学习权重, evolve.cjs 评分逻辑读 registry.get(), learn() 能调整它们.
  // 信号1: is_clear 本身权重 (发散步骤可信度低用低权重, 其他步骤用默认)
  clarity_weight_divergence: 0.25,   // 发散步骤 is_clear 信号权重 (发散不可信77%)
  clarity_weight_default: 0.35,     // 其他步骤 is_clear 信号权重 (维度可信96%)
  // 信号2: 问题数惩罚权重
  clarity_question_divergence: 0.45, // 发散步骤问题数信号权重
  clarity_question_default: 0.35,    // 其他步骤问题数信号权重
  // 信号3: 验证交叉验证权重 (后续验证步骤独立判断)
  clarity_verify: 0.3,

  // ── 元数据 ──
  _learning_rate: 0.08,
  _version: 1,
}

class WeightRegistry {
  constructor(filePath) {
    this.filePath = filePath || WEIGHTS_FILE
    this.weights = this._load() || { ...DEFAULT_WEIGHTS }
    // 确保有新添加的默认值
    let changed = false
    for (const [k, v] of Object.entries(DEFAULT_WEIGHTS)) {
      if (this.weights[k] === undefined) {
        this.weights[k] = v; changed = true
      }
    }
    if (changed) this._save()
  }

  get(key) {
    return this.weights[key] !== undefined ? this.weights[key] : DEFAULT_WEIGHTS[key]
  }

  getAll() { return { ...this.weights } }

  set(key, value) {
    if (key.startsWith('_')) { console.error('Cannot set metadata key: ' + key); return false }
    const num = parseFloat(value)
    if (isNaN(num) || num < 0 || num > 1) { console.error('Weight must be 0-1, got: ' + value); return false }
    this.weights[key] = Math.round(num * 100) / 100
    this.weights._updated_at = new Date().toISOString()
    this._save()
    return true
  }

  /**
   * 基于误差信号学习更新权重
   * @param {string} key — 权重名称
   * @param {number} errorSignal — -1 ~ 1，正数表示需要增加
   */
  learn(key, errorSignal) {
    const lr = this.weights._learning_rate || 0.08
    const old = this.get(key)
    const delta = lr * Math.max(-1, Math.min(1, errorSignal))
    const newVal = Math.max(0.01, Math.min(0.99, old + delta))
    this.weights[key] = Math.round(newVal * 1000) / 1000  // 保留3位小数
    this.weights._total_learns = (this.weights._total_learns || 0) + 1
    this.weights._updated_at = new Date().toISOString()
    this._save()
    return { key, old, new: this.weights[key], delta: Math.round(delta * 100) / 100 }
  }

  /**
   * 从 pipeline 返回结果自动学习
   * @param {object} result — 包含 verifyResult, uncertaintyHistory, loopCount, free_energy 等
   */
  integrateFromPipeline(result) {
    const logs = []
    const verify = result?.verifyResult || {}
    const passed = verify?.all_clear === true
    const issues = verify?.issues || []
    const uncertainty = result?.uncertainty || {}
    const history = uncertainty?.history || []
    const loopCount = result?.loopCount || 0
    const maxLoops = result?.maxLoops || 3

    if (history.length === 0) return logs

    // 获取最后一步的不确定性（通常是 verify 步骤）
    const lastUC = history[history.length - 1]

    // ── 学习不确定性系数 ──
    if (!passed && issues.length > 0 && lastUC) {
      // verify 失败 → 增加主导不确定性类型的系数
      const types = [
        { key: 'uncertainty_ambiguity', val: lastUC.ambiguity || 0 },
        { key: 'uncertainty_risk', val: lastUC.risk || 0 },
        { key: 'uncertainty_ignorance', val: lastUC.ignorance || 0 },
      ].sort((a, b) => b.val - a.val)
      const dominant = types[0]
      if (dominant.val > 0.3) {
        const r = this.learn(dominant.key, +0.2)
        logs.push('verify失败+' + dominant.key.split('_')[1] + '主导 → 系数+' + r.delta)
      }
      // 同时稍微降低非主导类型（多关注薄弱环节）
      for (let i = 1; i < types.length; i++) {
        if (types[i].val > 0.1) {
          const r = this.learn(types[i].key, -0.1)
          logs.push('verify失败→非主导' + types[i].key + '系数' + r.delta)
        }
      }
    } else if (passed) {
      // verify 通过 → 微幅巩固（小幅增加所有系数以保持稳定）
      logs.push('verify通过 → 权重巩固')
    }

    // ── 学习边界阈值 ──
    // 如果边界加深后通过验证 → 阈值合适或偏严格 → 稍微放宽
    // 如果没触发边界但验证失败 → 阈值太松 → 收紧
    const boundaryTriggered = result?.boundaryTriggered || false
    if (boundaryTriggered && passed) {
      const r = this.learn('boundary_deepen', +0.08)
      logs.push('边界加深有效 → 加深阈值+' + r.delta)
    } else if (!boundaryTriggered && !passed && loopCount < maxLoops) {
      const r = this.learn('boundary_deepen', -0.08)
      logs.push('边界未触发但verify失败 → 加深阈值' + r.delta)
    }

    // ── 学习自由能系数 ──
    // 如果 verifyFailRate 高 → free_energy_verify 可能需要调整
    const freeEnergy = result?.free_energy || 0
    if (freeEnergy > 0.5) {
      // 自由能高说明某个组件误差大 → 调整相关系数
      const verifyFailRate = issues.length > 0 ? Math.min(1, issues.length / 5) : 0
      const selfCheckFailRate = result?.selfCheckFailRate || 0
      if (verifyFailRate > selfCheckFailRate && verifyFailRate > 0.3) {
        const r = this.learn('free_energy_verify', +0.12)
        logs.push('验证失败率高 → free_energy_verify+' + r.delta)
      } else if (selfCheckFailRate > verifyFailRate && selfCheckFailRate > 0.3) {
        const r = this.learn('free_energy_selfcheck', +0.12)
        logs.push('自检失败率高 → free_energy_selfcheck+' + r.delta)
      }
    }

    return logs
  }

  reset() {
    this.weights = { ...DEFAULT_WEIGHTS, _reset_at: new Date().toISOString() }
    this._save()
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      }
    } catch (e) { /* ignore corrupt file */ }
    return null
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(this.weights, null, 2), 'utf-8')
    } catch (e) {
      console.error('Failed to save weights:', e.message)
    }
  }
}

// ── CLI ──
function cli(args) {
  const registry = new WeightRegistry()
  const cmd = args[0]

  switch (cmd) {
    case 'status':
    case 'list': {
      const w = registry.getAll()
      console.log('╔══════════════════════════════════════════╗')
      console.log('║  WeightRegistry — 可学习权重注册表       ║')
      console.log('╠══════════════════════════════════════════╣')
      console.log('║  学习率: ' + String(w._learning_rate || 0.05).padEnd(30) + ' ║')
      console.log('║  学习次数: ' + String(w._total_learns || 0).padEnd(27) + ' ║')
      if (w._updated_at) console.log('║  最后更新: ' + String(w._updated_at).padEnd(27) + ' ║')
      console.log('╠══════════════════════════════════════════╣')
      for (const [k, v] of Object.entries(w)) {
        if (!k.startsWith('_')) {
          const valStr = typeof v === 'number' ? v.toFixed(3) : String(v)
          const def = DEFAULT_WEIGHTS[k]
          const diff = def !== undefined ? (v - def) : 0
          const diffStr = diff !== 0 ? (diff > 0 ? ' ▲+' + diff.toFixed(2) : ' ▼' + diff.toFixed(2)) : '  ='
          console.log('    ' + k.padEnd(28) + valStr + diffStr)
        }
      }
      console.log('╚══════════════════════════════════════════╝')
      break
    }
    case 'list-json': {
      console.log(JSON.stringify(registry.getAll()))
      break
    }
    case 'get': {
      if (!args[1]) { console.error('Usage: node skills/ponder/scripts/weights.cjs get <key>'); break }
      const v = registry.get(args[1])
      if (v === undefined) { console.error('Unknown weight: ' + args[1]); break }
      console.log(v)
      break
    }
    case 'set': {
      if (!args[1] || !args[2]) { console.error('Usage: node skills/ponder/scripts/weights.cjs set <key> <value>'); break }
      registry.set(args[1], args[2])
      console.log('✅ ' + args[1] + ' = ' + registry.get(args[1]))
      break
    }
    case 'learn': {
      if (!args[1]) { console.error('Usage: node skills/ponder/scripts/weights.cjs learn <json-string>'); break }
      const result = JSON.parse(args[1])
      const logs = registry.integrateFromPipeline(result)
      console.log(JSON.stringify({ learned: logs.length > 0, changes: logs }))
      break
    }
    case 'reset': {
      registry.reset()
      console.log('✅ Weights reset to defaults')
      break
    }
    default:
      console.log('Usage: node skills/ponder/scripts/weights.cjs <status|get|set|learn|reset> [args...]')
      console.log('  status            — 查看所有权重')
      console.log('  get <key>         — 获取单个权重')
      console.log('  set <key> <val>   — 手动设置 (0-1)')
      console.log('  learn \'<json>\'    — 从pipeline结果自动学习')
      console.log('  reset             — 恢复出厂设置')
  }
}

if (require.main === module) {
  cli(process.argv.slice(2))
}

module.exports = { WeightRegistry, DEFAULT_WEIGHTS, WEIGHTS_FILE }
