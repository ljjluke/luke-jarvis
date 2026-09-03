/**
 * simple-recall.js — 三路多策略召回
 *
 * 三个文件独立读取：
 *   recallAllPhilosophy() → 直接读 philosophy.json，全量返回
 *   recallByTags()       → 读 knowledge.json，三路并行召回
 *   recallStepHistory()  → 读 step_history.json
 *
 * 召回策略:
 *   - anchors 锚点词匹配（语义相似）
 *   - tags 标签精确匹配
 *   - keyword 关键词兜底（summary + description 全文扫）
 */
const io = require('./simple-io.cjs');

// ═══ 权重常量 ═══
const EPISTEMIC_WEIGHTS = { verified: 1.0, observed: 0.85, deduced: 0.7, assumed: 0.5 };

function _applyDomainDowngrade(candidates, callerDomain, factor = 0.3) {
  if (!callerDomain) {
    return candidates.map(c => {
      if (c._knowledge_level === 'domain_expert') {
        c._match_score = (c._match_score || c.q || 0.5) * factor;
        c._domain_downgraded = true;
      }
      return c;
    });
  }
  return candidates.map(c => {
    if (c._knowledge_level === 'domain_expert' && c._domain !== callerDomain) {
      c._match_score = (c._match_score || c.q || 0.5) * factor;
      c._domain_downgraded = true;
    }
    return c;
  });
}

function _anchorMatchScore(queryAnchors, pointAnchors) {
  if (!queryAnchors || queryAnchors.length === 0) return 0;
  if (!pointAnchors || pointAnchors.length === 0) return 0;
  const qSet = new Set(queryAnchors.map(a => a.toLowerCase()));
  let match = 0;
  for (const a of pointAnchors) {
    if (qSet.has(a.toLowerCase())) match++;
  }
  return match / Math.max(queryAnchors.length, 1);
}

function _toResult(p, extra = {}) {
  const epWeight = EPISTEMIC_WEIGHTS[p.epistemic_status] || 0.7;
  return {
    id: p.id,
    content: p.description || '',
    summary: p.summary || '',
    anchors: p.anchors || [],
    tags: p.tags || [],
    q: p.q || 0.5,
    n: p.n || 0,
    status: p.status,
    epistemic_status: p.epistemic_status || 'deduced',
    source: 'knowledge',
    _knowledge_level: p.knowledge_level || 'domain_expert',
    _domain: p.domain || null,
    original_example: p.original_example || undefined,
    _epistemic_weight: epWeight,
    ...extra,
  };
}

// ═══ 三条召回路径 ═══

function _recallByAnchors(data, queryAnchors) {
  const results = [];
  if (!queryAnchors || queryAnchors.length === 0) return results;

  for (const p of data.points) {
    if (p.hidden || p.status === 'ARCHIVED' || p.status === 'REFUTED') continue;

    const score = _anchorMatchScore(queryAnchors, p.anchors || []);
    if (score === 0) continue;

    results.push(_toResult(p, {
      _anchor_score: Math.round(score * 100) / 100,
      _match_score: score * 0.5 + (p.q || 0.5) * 0.3 + Math.min((p.n || 0) / 10, 1) * 0.2,
      _recall_source: 'anchors',
    }));
  }

  results.sort((a, b) => b._match_score - a._match_score);
  return results;
}

function _recallByTags(data, searchTags) {
  const results = [];
  if (!searchTags || searchTags.size === 0) return results;

  for (const p of data.points) {
    if (p.hidden || p.status === 'ARCHIVED' || p.status === 'REFUTED') continue;

    let tagScore = 0;
    if (p.tags) {
      for (const t of p.tags) {
        if (searchTags.has(t)) tagScore++;
      }
    }
    if (tagScore === 0) continue;

    const normalized = tagScore / Math.max(searchTags.size, 1);
    results.push(_toResult(p, {
      _anchor_score: 0,
      _match_score: normalized * 0.4 + (p.q || 0.5) * 0.3 + Math.min((p.n || 0) / 10, 1) * 0.3,
      _recall_source: 'tags',
    }));
  }

  results.sort((a, b) => b._match_score - a._match_score);
  return results;
}

function _recallByKeyword(data, queryText) {
  const results = [];
  if (!queryText || queryText.length < 2) return results;

  const keywords = queryText
    .replace(/[，,。、；：？！\s]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 2)
    .map(w => w.toLowerCase());

  if (keywords.length === 0) return results;

  for (const p of data.points) {
    if (p.hidden || p.status === 'ARCHIVED' || p.status === 'REFUTED') continue;

    const haystack = ((p.summary || '') + ' ' + (p.description || '') + ' ' + (p.tags || []).join(' ')).toLowerCase();
    let hitCount = 0;
    for (const kw of keywords) {
      if (haystack.includes(kw)) hitCount++;
    }
    if (hitCount === 0) continue;

    const score = hitCount / keywords.length;
    results.push(_toResult(p, {
      _anchor_score: 0,
      _match_score: score * 0.3 + (p.q || 0.5) * 0.3 + Math.min((p.n || 0) / 10, 1) * 0.2,
      _recall_source: 'keyword',
    }));
  }

  results.sort((a, b) => b._match_score - a._match_score);
  return results;
}

// ═══ 对外接口 ═══

/**
 * 全量召回哲学知识（直接读 philosophy.json）
 */
function recallAllPhilosophy() {
  const data = io.loadKnowledge('philosophy');
  if (!data || !data.points || data.points.length === 0) return [];

  return data.points
    .filter(p => !p.hidden && p.status !== 'ARCHIVED' && p.status !== 'REFUTED')
    .sort((a, b) => (b.q || 0.5) - (a.q || 0.5))
    .map(p => _toResult(p, { _knowledge_level: 'philosophy' }));
}

/**
 * 多路并行召回领域知识（读 knowledge.json）
 */
function recallByTags(tags, opts = {}) {
  const data = io.loadKnowledge('knowledge');
  if (!data || !data.points || data.points.length === 0) return [];

  const limit = opts.limit || 20;
  const query = opts.query || '';
  const queryAnchors = opts.anchors || [];
  const callerDomain = opts.domain || null;
  const searchTags = new Set((tags || []).filter(Boolean));

  // 三路并行
  const byAnchors = _recallByAnchors(data, queryAnchors);
  const byTags = _recallByTags(data, searchTags);
  const byKeyword = _recallByKeyword(data, query);

  // 去重合并
  const merged = new Map();
  for (const r of [...byAnchors, ...byTags, ...byKeyword]) {
    const existing = merged.get(r.id);
    if (!existing || r._match_score > existing._match_score) {
      merged.set(r.id, r);
    }
  }

  const candidates = Array.from(merged.values());

  // 乘溯源权重 + 领域降权
  for (const c of candidates) {
    c._match_score = (c._match_score || 0) * (c._epistemic_weight || 0.7);
  }

  const downGraded = _applyDomainDowngrade(candidates, callerDomain);
  downGraded.sort((a, b) => (b._match_score || 0) - (a._match_score || 0));

  // 标记来源
  for (const c of downGraded) {
    const sources = [];
    if (byAnchors.some(r => r.id === c.id)) sources.push('anchors');
    if (byTags.some(r => r.id === c.id)) sources.push('tags');
    if (byKeyword.some(r => r.id === c.id)) sources.push('keyword');
    c._recall_sources = sources;
  }

  return downGraded.slice(0, limit);
}

/**
 * 召回步骤历史（读 step_history.json）
 */
function recallStepHistory(stepName, questionType, opts = {}) {
  const data = io.loadKnowledge('step_history');
  if (!data || !data.points || data.points.length === 0) return [];

  const limit = opts.limit || 20;

  const searchTags = new Set([
    'step_history',
    'step_' + stepName,
    questionType,
    ...(opts.tags || []),
  ]);

  try {
    const { allStepNamesFor } = require('../step-names.cjs');
    allStepNamesFor(stepName).forEach(n => searchTags.add('step_' + n));
  } catch (e) {}

  const candidates = [];

  for (const p of data.points) {
    if (p.hidden || p.status === 'ARCHIVED') continue;
    if (!p.tags || !p.tags.some(t => searchTags.has(t))) continue;
    if (p.description && !_matchStepPrefix(p.description, stepName)) continue;

    const anchorScore = _anchorMatchScore(opts.anchors || [], p.anchors || []);
    const matchScore = anchorScore * 0.4 + (p.q || 0.5) * 0.3 + (p.n || 0) * 0.1;

    candidates.push(_toResult(p, {
      _anchor_score: Math.round(anchorScore * 100) / 100,
      _match_score: Math.round(matchScore * 1000) / 1000,
      _knowledge_level: 'step_history',
    }));
  }

  const relevant = candidates.filter(c => (c._anchor_score || 0) > 0 || c.tags.some(t => t === questionType));
  const final = relevant.length > 0 ? relevant : candidates.slice(0, 3);
  final.sort((a, b) => (b._match_score || 0) - (a._match_score || 0));
  const result = final.slice(0, limit);

  // 消费证据：命中条目打 used_in:<step> 标记（知识是否被消费过有据可查）
  try {
    let consumed = false;
    for (const c of result) {
      const found = io.findById(data, c.id);
      if (found && found.point) {
        if (!found.point.tags) found.point.tags = [];
        const useTag = 'used_in:' + stepName;
        if (!found.point.tags.includes(useTag)) {
          found.point.tags.push(useTag);
          found.point.last_verified = new Date().toISOString();
          consumed = true;
        }
      }
    }
    if (consumed) io.saveKnowledge('step_history', data);
  } catch (e) { /* 打标失败不影响召回 */ }

  return result;
}

function _matchStepPrefix(description, stepName) {
  if (!description) return false;
  const m = description.match(/\[step:([^\]]+)\]/);
  if (m) {
    const descStep = m[1].toLowerCase();
    if (descStep === stepName.toLowerCase()) return true;
    try {
      const { allStepNamesFor } = require('../step-names.cjs');
      if (allStepNamesFor(stepName).some(a => a.toLowerCase() === descStep)) return true;
    } catch (e) {}
    return false;
  }
  return true;
}

/**
 * 获取某条知识的完整原文（按 ID 前缀路由到对应文件）
 */
function getFullContent(pointId) {
  if (!pointId) return null;
  let level;
  if (pointId.startsWith('PH')) level = 'philosophy';
  else if (pointId.startsWith('KN')) level = 'knowledge';
  else if (pointId.startsWith('SH')) level = 'step_history';
  else level = 'knowledge'; // 兜底

  const data = io.loadKnowledge(level);
  const found = io.findById(data, pointId);
  if (!found) return null;

  const p = found.point;
  return {
    id: p.id,
    content: p.description,
    summary: p.summary || '',
    anchors: p.anchors || [],
    tags: p.tags || [],
    q: p.q,
    n: p.n,
    epistemic_status: p.epistemic_status || 'deduced',
    status: p.status,
    knowledge_level: p.knowledge_level || level,
    domain: p.domain || null,
    original_example: p.original_example || null,
    related_points: p.related_points || [],
    created_at: p.created_at,
    last_verified: p.last_verified,
    consolidation_score: p.consolidation_score || 0,
  };
}

module.exports = { recallAllPhilosophy, recallByTags, recallStepHistory, getFullContent, _anchorMatchScore, _applyDomainDowngrade };
