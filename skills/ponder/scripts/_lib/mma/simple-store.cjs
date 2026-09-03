/**
 * simple-store.js — 按知识层级分轨存储
 *
 * 三个文件独立存储：
 *   philosophy.json   — getKnowledgeLevel 返回 'philosophy' → 存入
 *   knowledge.json     — knowledge_level='domain_expert' → 存入
 *   step_history.json  — knowledge_level='step_history' → 存入
 *
 * 存储前 LLM 必须通过 checkDuplicate 检查语义重复。
 * 代码层用 anchors 做粗筛候选，LLM 精判。
 */
const io = require('./simple-io.cjs');
const { getKnowledgeLevel } = require('./domain-detector.cjs');

/**
 * 根据 knowledge_level 路由到对应文件和 ID 前缀
 */
function _route(level) {
  switch (level) {
    case 'philosophy':   return { file: 'philosophy',   prefix: 'PH' };
    case 'domain_expert': return { file: 'knowledge',    prefix: 'KN' };
    case 'step_history':  return { file: 'step_history', prefix: 'SH' };
    default:              return { file: 'knowledge',    prefix: 'KN' };
  }
}

/**
 * 锚点词代码层兜底提取 - 当 LLM 未生成 anchors 时从 tags/summary/description 提取
 *
 * 锚点是召回主通道（_recallByAnchors 靠它算语义匹配），空锚点=该条知识召不回。
 * 提取策略（不依赖分词库，按标点+常见虚词切分）：
 *   1. tags 直接作为锚点（tags 本身就是语义标签）
 *   2. summary/description 切出 2-8 字的概念片段
 *
 * @param {object} entry - 知识条目
 * @returns {Array<string>} 锚点词列表（最多8个）
 */
function deriveAnchors(entry) {
  const anchors = new Set();

  // 1. tags 作为锚点基础（剔除管线内部标签）
  (entry.tags || []).forEach(t => {
    if (t && t.length >= 2 && t.length < 50 && !t.startsWith('step_') && t !== 'step_history' && !t.startsWith('used_in:')) {
      anchors.add(t);
    }
  });

  // 2. 从 summary + description 切概念片段
  const text = (entry.summary || '') + '，' + (entry.description || '');
  const segments = text.split(/[,，。、；;：:！!？?\s\-|（）()【】\[\]]+/);
  for (const seg of segments) {
    // 按常见虚词再切，取名词性短片段
    const subs = seg.split(/(?:的|是|在|和|与|或|而|且|也|都|就|才|只|会|能|要|有|为|被|把|让|给|从|到|对|比|等|之|其)/);
    for (const s of subs) {
      const t = s.trim();
      if (t.length >= 2 && t.length <= 8 && /[一-龥A-Za-z]/.test(t) && !/^\d+$/.test(t)) {
        anchors.add(t);
        if (anchors.size >= 8) return Array.from(anchors);
      }
    }
  }
  return Array.from(anchors);
}

/**
 * 锚点词粗筛：在指定 level 文件内找候选
 */
function getDedupCandidates(data, newAnchors, knowledgeLevel, domain, maxCandidates = 10) {
  if (!data || !data.points || data.points.length === 0) return [];
  if (!newAnchors || newAnchors.length === 0) return [];

  const newAnchorSet = new Set(newAnchors.map(a => a.toLowerCase()));
  const candidates = [];

  for (const p of data.points) {
    if (p.hidden || p.status === 'ARCHIVED' || p.status === 'REFUTED') continue;

    // domain_expert 时还要匹配 domain
    if (knowledgeLevel === 'domain_expert' && domain && p.domain !== domain) continue;

    const pAnchors = p.anchors || [];
    if (pAnchors.length === 0) continue;

    let matchCount = 0;
    for (const a of pAnchors) {
      if (newAnchorSet.has(a.toLowerCase())) matchCount++;
    }

    if (matchCount > 0) {
      candidates.push({
        id: p.id,
        summary: p.summary || p.description || '',
        description: p.description || '',
        anchors: pAnchors,
        tags: p.tags || [],
        q: p.q || 0.5,
        n: p.n || 0,
        status: p.status,
        knowledge_level: p.knowledge_level || knowledgeLevel,
        _match_count: matchCount,
        _weight: matchCount * 0.5 + (p.q || 0.5) * 0.3 + Math.min((p.n || 0) / 10, 1) * 0.2,
      });
    }
  }

  candidates.sort((a, b) => b._weight - a._weight);
  return candidates.slice(0, maxCandidates);
}

/**
 * 强化已有知识（去重命中时调用）
 */
function reinforceExisting(data, existingId, newTags) {
  const found = io.findById(data, existingId);
  if (!found || !found.point) return false;

  found.point.q = Math.min(1.0, (found.point.q || 0.5) + 0.05);
  found.point.n = (found.point.n || 0) + 1;
  found.point.last_verified = new Date().toISOString();

  const existingTags = new Set(found.point.tags || []);
  (newTags || []).filter(t => t && !existingTags.has(t)).forEach(t => found.point.tags.push(t));

  return true;
}

/**
 * 存储一个知识点（LLM 确认无重复后调用）
 *
 * @param {object} data - 对应文件的数据（loadKnowledge 返回的）
 * @param {object} entry - 知识条目
 * @returns {object|null} {id, status, file}
 */
function storePoint(data, entry) {
  if (!entry || !entry.description) return null;

  const raw = entry.description.trim();
  if (raw.length < 5) return null;

  // ═══ 知识层级 ═══
  let level = entry.knowledge_level || getKnowledgeLevel(raw);

  if (level === 'rejected') {
    return { id: null, status: 'SKIPPED_NO_SIGNAL', reason: '无信息量' };
  }

  // ═══ 锚点兜底：LLM 未生成 anchors 时代码层强制提取（召回主通道不可为空） ═══
  let anchors = (entry.anchors || []).filter(a => a && a.length < 50).slice(0, 10);
  let anchors_derived = false;
  if (anchors.length === 0) {
    anchors = deriveAnchors(entry);
    anchors_derived = anchors.length > 0;
  }

  // ═══ 哲学/领域知识轨结构准入：用结构信号倒逼语义质量（领域无关，不做语义判断） ═══
  // doctrine: 可复用知识轨只有经过"从具体案例提炼"才配进入。
  // 硬门槛分两档（都靠结构信号，不做语义判断）：
  //   philosophy（抽象哲学）: 案例 必填 + 适用条件 必填 + 锚点≥2
  //     —— 抽象规律必须说清适用边界，否则是格言；没案例=没提炼
  //   domain_expert（领域知识）: 案例 必填 + domain 必填 + 锚点≥2
  //     —— 领域知识靠 domain 定位，用不到强制 applicability
  if (level === 'philosophy') {
    const hasExample = !!(entry.original_example && String(entry.original_example).trim().length > 0);
    const hasApp     = !!(entry.applicability && String(entry.applicability).trim().length > 0);
    if (!hasExample || !hasApp || anchors.length < 2) level = 'step_history';
  } else if (level === 'domain_expert') {
    const hasExample = !!(entry.original_example && String(entry.original_example).trim().length > 0);
    // 领域知识靠 domain 路由召回，锚点仅辅助，门槛降到 ≥1（中文长描述的锚点提取本就稀疏）
    if (!hasExample || !entry.domain || anchors.length < 1) level = 'step_history';
  }

  // 路由
  const route = _route(level);
  const domainTag = (level === 'domain_expert') ? (entry.domain || null) : null;

  const seq = io.nextPointId(data);
  const id = route.prefix + String(seq).padStart(4, '0');
  const now = new Date().toISOString();

  const tags = (entry.tags || []).filter(t => t && t.length < 80);
  const summary = (entry.summary || '').substring(0, 200);

  const point = {
    id,
    description: raw.substring(0, 500),
    summary: summary || raw.substring(0, 100),
    tags,
    anchors,
    category: entry.category || 'general',
    status: 'HYPOTHESIS',
    epistemic_status: entry.epistemic_status || 'deduced',
    q: entry.q || 0.5,
    n: 0,
    sigma2: 0.25,
    consolidation_score: 0,
    created_at: now,
    last_verified: now,
    source: entry.source || 'unknown',
    knowledge_level: level,
    domain: domainTag,
  };

  // 适用条件透传：防格言化--没有适用条件的结论无法指导后续决策
  if (entry.applicability) {
    point.applicability = String(entry.applicability).substring(0, 300);
  }

  if (entry.original_example) {
    point.original_example = String(entry.original_example).substring(0, 500);
  }

  data.points.push(point);
  const result = { id, status: 'HYPOTHESIS', file: route.file };
  if (anchors_derived) result.anchors_derived = true;
  if (level !== (entry.knowledge_level || '')) result.level_downgraded_to = level;
  return result;
}

/**
 * 存储并持久化
 */
function store(entry) {
  if (!entry || !entry.description) return null;
  const level = entry.knowledge_level || getKnowledgeLevel(entry.description.trim());
  const route = _route(level);
  if (level === 'rejected') return { id: null, status: 'SKIPPED_NO_SIGNAL' };

  const data = io.loadKnowledge(route.file);
  const result = storePoint(data, entry);
  if (result && result.id) io.saveKnowledge(route.file, data);
  return result;
}

module.exports = { storePoint, store, getDedupCandidates, reinforceExisting, deriveAnchors };
