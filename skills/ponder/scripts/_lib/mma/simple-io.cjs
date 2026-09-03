/**
 * simple-io.js — 三文件知识库读写层
 *
 * 拆分为三个独立文件：
 *   philosophy.json   — 抽象哲学知识（少而精，全量加载，永不淘汰）
 *   knowledge.json     — 领域专业知识（按 domain 分，按需召回，定期保洁）
 *   step_history.json  — 步骤历史（独立管理，周期性淘汰）
 *
 * 每个文件有独立的 ID 序列，数据结构一致：
 *   { meta: { version, total_points, next_point_seq, ... }, points: [...] }
 */
const fs = require('fs');
const crypto = require('crypto');
const {
  dataRoot: DATA_DIR,
  ensureDataDir: ensureRuntimeDataDir,
  resolveData,
} = require('../runtime-paths.cjs');

const MEMORY_DIR = resolveData('memory');
const ARCHIVE_DIR = resolveData('memory', 'archive');

// ═══ 三文件路径 ═══
const FILES = {
  philosophy:   resolveData('memory', 'philosophy.json'),
  knowledge:    resolveData('memory', 'knowledge.json'),
  step_history: resolveData('memory', 'step_history.json'),
};

function ensureDataDir() {
  ensureRuntimeDataDir();
  ensureRuntimeDataDir('memory');
  ensureRuntimeDataDir('memory', 'archive');
}

/**
 * 创建空的知识库结构
 */
function _emptyData() {
  return {
    meta: {
      version: '4.0.0',
      created: new Date().toISOString(),
      last_saved: null,
      total_points: 0,
      save_count: 0,
      next_point_seq: 1,
    },
    points: [],
  };
}

/**
 * 加载指定类型的知识库
 * @param {'philosophy'|'knowledge'|'step_history'} level
 * @returns {object} { meta, points }
 */
function loadKnowledge(level) {
  ensureDataDir();
  const filePath = FILES[level];

  if (!filePath || !fs.existsSync(filePath)) {
    return _emptyData();
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!data.meta) data.meta = _emptyData().meta;
    if (!data.points) data.points = [];
    return data;
  } catch (e) {
    // 文件损坏，备份后重建
    const bak = filePath + '.bak';
    try { fs.copyFileSync(filePath, bak); } catch (e2) {}
    console.error('[io] ' + level + '.json corrupted, starting fresh');
    return _emptyData();
  }
}

/**
 * 保存指定类型的知识库（原子写入）
 */
function saveKnowledge(level, data) {
  ensureDataDir();
  const filePath = FILES[level];
  if (!filePath) return;

  data.meta.last_saved = new Date().toISOString();
  data.meta.total_points = data.points.length;
  data.meta.save_count = (data.meta.save_count || 0) + 1;

  const json = JSON.stringify(data, null, 2);
  const tmpFile = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

  // 备份
  if (fs.existsSync(filePath)) {
    try { fs.copyFileSync(filePath, filePath + '.bak'); } catch (e) {}
  }

  // 原子写入；唯一临时文件避免并发写入争用固定 .tmp。
  try {
    fs.writeFileSync(tmpFile, json, { encoding: 'utf-8', flag: 'wx' });
    try {
      const fd = fs.openSync(tmpFile, 'r+');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (e) {}
    fs.renameSync(tmpFile, filePath);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

/**
 * 加载所有知识（用于全局统计/迁移）
 */
function loadAll() {
  return {
    philosophy: loadKnowledge('philosophy'),
    knowledge: loadKnowledge('knowledge'),
    step_history: loadKnowledge('step_history'),
  };
}

/**
 * 按ID在指定文件中查找知识点
 */
function findById(data, pointId) {
  if (!data || !data.points) return null;
  const idx = data.points.findIndex(p => p.id === pointId);
  if (idx < 0) return null;
  return { point: data.points[idx], index: idx };
}

/**
 * 生成下一个ID（按文件独立序列）
 */
function nextPointId(data) {
  const seq = (data.meta.next_point_seq || 1);
  data.meta.next_point_seq = seq + 1;
  // philosophy → 'PH001'  knowledge → 'KN001'  step_history → 'SH001'
  return seq;
}

// ═══ 兼容层 ═══
function loadMMA() { return loadAll(); }
function saveMMA(kg) { /* no-op: 新架构直接调 saveKnowledge */ }
function findPointById(kg, pointId) {
  if (kg.points) return findById({ points: kg.points }, pointId);
  if (kg.philosophy) return findById(kg.philosophy, pointId);
  return null;
}

module.exports = {
  ensureDataDir,
  loadKnowledge,
  saveKnowledge,
  loadAll,
  findById,
  nextPointId,
  // 兼容
  loadMMA,
  saveMMA,
  findPointById,
  // 路径
  DATA_DIR,
  MEMORY_DIR,
  FILES,
  ARCHIVE_DIR,
};
