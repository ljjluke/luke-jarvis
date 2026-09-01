/**
 * luke-jarvis · ponder 运行底座 runtime-paths（补全原 ponder 缺失的模块）
 *
 * 原 ponder 脚本 require('../../../scripts/runtime-paths') 但该文件在源技能目录缺失
 * ——这是 ponder 从未真正跑通（step-guard run_id=None）的根因之一。
 * 本文件补全这个运行底座，让 ponder 满血脚本在 luke-jarvis 包内可执行（集成：只装 jarvis 就有 ponder）。
 *
 * 提供 API（对齐原脚本 usage）：
 *   dataRoot                    数据目录（~/.dsh/data/ponder，PONDER_DATA_DIR 可覆盖）
 *   initializeDataFile(file)    确保数据文件存在（不存在则初始化）
 *   initializeJsonDataFile(file, default)  JSON 数据文件初始化
 *   resolvePlugin(name)         定位插件根（用于找十阶段 json / engine 资源）
 *   resolveData(...args)        数据路径解析（join dataRoot）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── 数据根（PONDER_DATA_DIR 覆盖，默认 ~/.dsh/data/ponder）──
const PONDER_DATA_DIR = process.env.PONDER_DATA_DIR || path.join(os.homedir(), '.dsh', 'data', 'ponder');
const dataRoot = PONDER_DATA_DIR;

// ── 插件根（本文件位于 <repo>/scripts/，向上 1 级即仓库根）──
const repoRoot = path.resolve(__dirname, '..');

/** 确保目录存在 */
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** 初始化数据文件：不存在则创建空文件 */
function initializeDataFile(rel) {
  const target = path.join(dataRoot, rel);
  ensureDir(path.dirname(target));
  if (!fs.existsSync(target)) fs.writeFileSync(target, '', 'utf8');
  return target;
}

/** 初始化 JSON 数据文件：不存在则写入默认值 */
function initializeJsonDataFile(rel, def) {
  const target = path.join(dataRoot, rel);
  ensureDir(path.dirname(target));
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, JSON.stringify(def ?? {}, null, 2), 'utf8');
  }
  return target;
}

/** 定位插件根（当前即 luke-jarvis 仓库根；name 保留兼容） */
function resolvePlugin(name) {
  return repoRoot;
}

/** 数据路径解析（join dataRoot） */
function resolveData(...args) {
  return path.join(dataRoot, ...args);
}

module.exports = { dataRoot, initializeDataFile, initializeJsonDataFile, resolvePlugin, resolveData, repoRoot };
