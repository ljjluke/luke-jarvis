/**
 * io.js — 兼容层：将旧 loadMMA/saveMMA 调用转发到 simple-io
 *
 * v1.18.58: 原分片存储（20个经脉分片+锁+WAL）已迁移到单文件 knowledge.json
 * 此文件保留旧接口签名，确保 evolve.js 等间接调用方不断
 */
const simpleIO = require('./simple-io.cjs');

/**
 * 兼容旧接口：loadMMA()
 * 返回包装对象，旧代码通过 kg.meridians/extra 遍历不会崩
 * 新代码应直接用 simpleIO.loadKnowledge('knowledge') 的 data.points
 */
function loadMMA() {
  const data = simpleIO.loadKnowledge('knowledge');
  return {
    _simple_data: data,
    meridians: {},
    extra: {},
    meta: data.meta,
    points: data.points,
  };
}

/**
 * 兼容旧接口：saveMMA(kg)
 */
function saveMMA(kg) {
  if (kg._simple_data) {
    simpleIO.saveKnowledge('knowledge', kg._simple_data);
  } else if (kg.points) {
    simpleIO.saveKnowledge('knowledge', { meta: kg.meta, points: kg.points });
  }
}

/**
 * 兼容旧接口：findPointById(kg, pointId)
 */
function findPointById(kg, pointId) {
  return simpleIO.findById(kg._simple_data || kg, pointId);
}

/**
 * 兼容旧接口：markDirty() — 单文件模式不需要，空操作
 */
function markDirty() {}

/**
 * 兼容旧接口：ensureDirs()
 */
function ensureDirs() {
  simpleIO.ensureDataDir();
}

/**
 * 兼容旧接口：loadWorkingMemory / saveWorkingMemory
 * 三焦工作记忆已不再使用，返回空结构
 */
function loadWorkingMemory() {
  return { upper: [], middle: [], lower: [], last_meridian: null, last_meridian_ts: null };
}
function saveWorkingMemory() {}

// 兼容旧接口的其他函数（空操作）
function buildTagIndex() {}
function queryByTag() { return []; }
function acquireShardLock() { return true; }
function releaseShardLock() {}
function appendWAL() {}
function replayWAL() { return []; }
function clearWAL() {}

module.exports = {
  ensureDirs,
  loadMMA,
  saveMMA,
  findPointById,
  markDirty,
  buildTagIndex,
  queryByTag,
  loadWorkingMemory,
  saveWorkingMemory,
  acquireShardLock,
  releaseShardLock,
  appendWAL,
  replayWAL,
  clearWAL,
};
