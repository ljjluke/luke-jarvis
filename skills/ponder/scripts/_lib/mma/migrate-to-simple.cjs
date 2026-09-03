#!/usr/bin/env node
/** Migrate legacy MMA shards into the three-file runtime without deleting legacy data. */
const fs = require('fs');
const { ensureDataDir, resolveData } = require('../runtime-paths.cjs');
const simpleIO = require('./simple-io.cjs');

const SHARDS_DIR = resolveData('memory', 'shards');
const LEGACY_FILE = resolveData('memory', 'meridian_kg.json');
const WORKING_MEMORY_FILE = resolveData('memory', 'working_memory.json');
const BACKUP_DIR = resolveData('memory', 'migration-backups');
const MIGRATION_SOURCE = 'legacy-mma-shards';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { console.error(`[migrate] Skipping ${file}: ${error.message}`); return null; }
}

function pointsFrom(value) {
  if (Array.isArray(value)) return value;
  return value && Array.isArray(value.points) ? value.points : [];
}

function collectLegacyPoints() {
  const collected = [];
  if (fs.existsSync(SHARDS_DIR)) {
    for (const name of fs.readdirSync(SHARDS_DIR).sort()) {
      if (!name.endsWith('.json') || name.endsWith('.bak.json') || name === 'meta.json') continue;
      const file = resolveData('memory', 'shards', name);
      for (const point of pointsFrom(readJson(file))) collected.push({ point, source: name.replace(/\.json$/, '') });
    }
  }
  if (fs.existsSync(LEGACY_FILE)) {
    const legacy = readJson(LEGACY_FILE) || {};
    for (const [name, shard] of Object.entries(legacy.meridians || {})) {
      for (const point of pointsFrom(shard)) collected.push({ point, source: name });
    }
    for (const [name, shard] of Object.entries(legacy.extra || {})) {
      for (const point of pointsFrom(shard)) collected.push({ point, source: `_extra_${name}` });
    }
  }
  if (fs.existsSync(WORKING_MEMORY_FILE)) {
    const working = readJson(WORKING_MEMORY_FILE) || {};
    for (const entry of working.upper || []) {
      if (entry && entry.point) collected.push({ point: entry.point, source: 'working_memory' });
    }
  }
  return collected;
}

function route(point) {
  if (point.knowledge_level === 'step_history' || (point.tags || []).includes('step_history')) return 'step_history';
  if (point.knowledge_level === 'philosophy') return 'philosophy';
  return 'knowledge';
}

function convert(point, source) {
  const now = new Date().toISOString();
  return {
    ...point,
    description: String(point.description || '').substring(0, 500),
    summary: String(point.summary || point.description || '').substring(0, 200),
    tags: (point.tags || []).filter(tag => tag && String(tag).length < 80),
    anchors: (point.anchors || []).filter(Boolean).slice(0, 10),
    category: point.category || 'general',
    status: point.status || 'HYPOTHESIS',
    epistemic_status: point.epistemic_status || 'deduced',
    q: point.q ?? 0.5,
    n: point.n || 0,
    sigma2: point.sigma2 ?? 0.25,
    consolidation_score: point.consolidation_score || 0,
    created_at: point.created_at || now,
    last_verified: point.last_verified || point.created_at || now,
    source: point.source || source,
    knowledge_level: point.knowledge_level || (route(point) === 'step_history' ? 'step_history' : 'domain_expert'),
    _original_meridian: point._original_meridian || source,
  };
}

function backupSources() {
  ensureDataDir('memory', 'migration-backups');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolveData('memory', 'migration-backups', stamp);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(SHARDS_DIR)) fs.cpSync(SHARDS_DIR, resolveData('memory', 'migration-backups', stamp, 'shards'), { recursive: true });
  for (const file of [LEGACY_FILE, WORKING_MEMORY_FILE]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, resolveData('memory', 'migration-backups', stamp, require('path').basename(file)));
  }
  return dir;
}

function migrate() {
  ensureDataDir('memory');
  const legacy = collectLegacyPoints();
  if (legacy.length === 0) return { migrated: 0, skipped: 0, backup: null };
  let migrated = 0, skipped = 0;
  const datasets = Object.fromEntries(['philosophy', 'knowledge', 'step_history'].map(level => [level, simpleIO.loadKnowledge(level)]));
  const seen = new Set();
  for (const data of Object.values(datasets)) for (const point of data.points) if (point.id) seen.add(point.id);
  const hasNewPoints = legacy.some(item => item.point && !item.point.hidden && item.point.id && !seen.has(item.point.id));
  if (!hasNewPoints) return { migrated: 0, skipped: legacy.length, backup: null };
  const backup = backupSources();

  for (const item of legacy) {
    if (!item.point || item.point.hidden || !item.point.id || seen.has(item.point.id)) { skipped++; continue; }
    const level = route(item.point);
    datasets[level].points.push(convert(item.point, item.source));
    seen.add(item.point.id);
    migrated++;
  }
  for (const [level, data] of Object.entries(datasets)) {
    const maxSeq = data.points.reduce((max, point) => {
      const match = String(point.id || '').match(/(\d+)/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    data.meta.next_point_seq = Math.max(data.meta.next_point_seq || 1, maxSeq + 1);
    data.meta.migrated_from = MIGRATION_SOURCE;
    data.meta.migration_date = new Date().toISOString();
    simpleIO.saveKnowledge(level, data);
  }
  return { migrated, skipped, backup };
}

if (require.main === module) {
  const result = migrate();
  console.log(JSON.stringify(result, null, 2));
}
module.exports = { migrate, collectLegacyPoints, convert, route };
