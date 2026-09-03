#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// DSH 运行环境检测：DSH_HOME / DSH_SESSION_ID 由 DeepSeek Harness 注入。
const isDSH = !!(process.env.DSH_HOME || process.env.DSH_SESSION_ID);

const pluginRoot = path.resolve(__dirname, '..', '..'); // 技能自包含：<技能根>/scripts/_lib/ → <技能根>
const projectRoot = path.resolve(process.env.PONDER_PROJECT_DIR || process.cwd());
const defaultDataDir = process.env.PONDER_DATA_DIR
  ? process.env.PONDER_DATA_DIR
  : isDSH
    ? path.join(os.homedir(), '.dsh', 'data', 'ponder') // DSH：~/.dsh/data/ponder
    : path.join(os.homedir(), '.claude', 'data', 'skills', 'ponder'); // Claude Code 默认
const dataRoot = path.resolve(defaultDataDir);

function normalizeForComparison(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(parent, candidate) {
  const relative = path.relative(
    normalizeForComparison(parent),
    normalizeForComparison(candidate)
  );
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function canonicalizeWithMissingSegments(value) {
  let existing = path.resolve(value);
  const missing = [];

  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }

  const canonicalBase = fs.existsSync(existing)
    ? fs.realpathSync.native(existing)
    : path.resolve(existing);
  return path.resolve(canonicalBase, ...missing);
}

const canonicalPluginRoot = canonicalizeWithMissingSegments(pluginRoot);
const canonicalDataRoot = canonicalizeWithMissingSegments(dataRoot);

if (isWithin(canonicalPluginRoot, canonicalDataRoot)) {
  throw new Error('PONDER_DATA_DIR must be outside the plugin installation directory');
}

function assertWithin(root, candidate, label) {
  const resolved = path.resolve(candidate);
  if (!isWithin(root, resolved)) {
    throw new Error(`${label} escapes its allowed root`);
  }
  const canonicalRoot = canonicalizeWithMissingSegments(root);
  const canonicalCandidate = canonicalizeWithMissingSegments(resolved);
  if (!isWithin(canonicalRoot, canonicalCandidate)) {
    throw new Error(`${label} escapes its allowed root through a symbolic link or junction`);
  }
  return resolved;
}

function ensureDataDir(...segments) {
  const dir = assertWithin(dataRoot, path.join(dataRoot, ...segments), 'Data directory');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveData(...segments) {
  return assertWithin(dataRoot, path.join(dataRoot, ...segments), 'Data path');
}

function resolvePlugin(...segments) {
  return assertWithin(pluginRoot, path.join(pluginRoot, ...segments), 'Bundled resource path');
}

function resolveProjectOutput(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Project output path must be a non-empty relative path');
  }
  const resolved = assertWithin(projectRoot, path.resolve(projectRoot, relativePath), 'Project output path');
  const canonicalOutput = canonicalizeWithMissingSegments(resolved);
  if (isWithin(canonicalPluginRoot, canonicalOutput)) {
    throw new Error('Project output path must be outside the plugin installation directory');
  }
  return resolved;
}

function initializeDataFile(relativePath, bundledPath) {
  const target = resolveData(relativePath);
  const source = assertWithin(pluginRoot, bundledPath, 'Bundled resource path');
  if (fs.existsSync(target)) return target;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const contents = fs.readFileSync(source);
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, contents, { flag: 'wx' });
    try {
      fs.renameSync(temp, target);
    } catch (error) {
      if (!fs.existsSync(target)) throw error;
    }
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return target;
}

function mergeMissingFields(target, seed) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) return target;
  const output = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
  for (const [key, value] of Object.entries(seed)) {
    if (!Object.prototype.hasOwnProperty.call(output, key)) output[key] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) output[key] = mergeMissingFields(output[key], value);
  }
  return output;
}

function initializeJsonDataFile(relativePath, bundledPath) {
  const target = initializeDataFile(relativePath, bundledPath);
  const source = assertWithin(pluginRoot, bundledPath, 'Bundled resource path');
  const current = JSON.parse(fs.readFileSync(target, 'utf8'));
  const before = JSON.stringify(current);
  const upgraded = mergeMissingFields(current, JSON.parse(fs.readFileSync(source, 'utf8')));
  if (JSON.stringify(upgraded) !== before) {
    const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(upgraded, null, 2) + '\n', { flag: 'wx' });
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  return target;
}

function childProcessOptions(overrides = {}) {
  return {
    ...overrides,
    cwd: overrides.cwd || projectRoot,
    env: {
      ...process.env,
      ...overrides.env,
      PONDER_PROJECT_DIR: projectRoot,
      PONDER_DATA_DIR: dataRoot,
    },
  };
}

module.exports = {
  pluginRoot,
  projectRoot,
  dataRoot,
  isDSH,
  isWithin,
  ensureDataDir,
  resolveData,
  resolvePlugin,
  resolveProjectOutput,
  initializeDataFile,
  initializeJsonDataFile,
  childProcessOptions,
};
