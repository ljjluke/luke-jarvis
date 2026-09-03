#!/usr/bin/env node
/**
 * Unified knowledge acquisition layer.
 *
 * Single entry point for all data needs:
 *   1. Check local knowledge base (tags + semantic matching)
 *   2. If empty → WebSearch
 *   3. Store what's found with classification
 *   4. Return best available data
 *
 * Classification (lifecycle):
 *   CONFIRMED   — user confirmed or cross-verified → use with high confidence
 *   PROVISIONAL — used but not verified → use with caution
 *   HYPOTHESIS  — new, unverified → treat as tentative
 *   DISPUTED    — has contradictory evidence → flag when used
 *   REFUTED     — proven wrong → EXCLUDE from recall
 *   SLEEPING    — unused for 30d
 *
 * v1.18.58: 精简重构，从 mma 分片存储迁移到单文件 knowledge.json
 */
const { childProcessOptions } = require('./runtime-paths.cjs');

// 步骤命名单一真源 + 历史别名兼容层
const { normalizeStep, categoryFor } = require('./step-names.cjs');

// 新模块：简化的IO/存储/检索/生命周期
const simpleIO = require('./mma/simple-io.cjs');
const simpleStore = require('./mma/simple-store.cjs');
const simpleRecall = require('./mma/simple-recall.cjs');
const simpleLifecycle = require('./mma/simple-lifecycle.cjs');

// 分词:中英文混合切词(acquire 和 recallStepHistory 共用)
function _seg(s){if(!s)return[];var r=[];var buf='';for(var i=0;i<s.length;i++){var c=s[i];if(/[a-zA-Z0-9À-ɏ]/.test(c)){buf+=c}else{if(buf.length>0){r.push(buf);buf=''}if(c.trim()&&!c.match(/[\s,，。、]/))r.push(c)}}if(buf.length>0)r.push(buf);return r}

function acquire(query, options = {}, stepName = '') {
  // Preserve the runtime boundary for callers that pass child-process overrides.
  childProcessOptions(options.childProcessOptions || {});
  const { tags = [], limit = 5, allowSearch = true } = query || {};
  const result = { source: 'none', entries: [] };

  // Phase 1: Check knowledge base
  if (tags.length > 0) {
    try {

      // 领域标签由指令层（LLM）传入 query.domain，代码层直接透传
      const callerDomain = query.domain || null;

      const candidates = simpleRecall.recallByTags(tags, {
        limit: limit * 2,
        query: query.query || '',
        anchors: query.anchors || [],       // LLM 生成的查询锚点词
        domain: callerDomain,
      });

      if (candidates.length > 0) {
        result.source = 'knowledge';
        // Tag each recalled point with step usage
        if (stepName) {
          for (const c of candidates) {
            usedInStep(c.id, stepName);
          }
        }
        result.entries = candidates;
        result._caller_domain = callerDomain; // 告知上游本次召回使用的领域上下文
      }

      // 每次召回触发知识保洁
      const data = simpleIO.loadKnowledge('knowledge');
      const actions = simpleLifecycle.knowledgeGroom(data, 'knowledge');
      if (actions.length > 0) {
        simpleIO.saveKnowledge("knowledge", data);
        result._groomed = actions.length;
      }
    } catch (e) { /* non-blocking */ }

    // Phase 1.5: Semantic re-ranking
    if (result.entries.length > 0 && query.tags) {
      const queryText = (Array.isArray(query.tags) ? query.tags.join(' ') : '') + ' ' + (query.query || '');
      const queryWords = _seg(queryText);
      const queryTopics = new Set(queryWords);

      for (const entry of result.entries) {
        const descWords = (entry.content || '').toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const tagWords = (entry.tags || []).join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const allWords = new Set([...descWords, ...tagWords]);

        let overlap = 0;
        for (const qw of queryTopics) {
          for (const aw of allWords) {
            if (aw === qw || aw.includes(qw) || qw.includes(aw)) {
              overlap++;
              break;
            }
          }
        }
        const semanticScore = queryTopics.size > 0 ? overlap / queryTopics.size : 0;
        const categoryBonus = query.query && entry.content && entry.content.includes(query.query) ? 0.2 : 0;
        entry._match_score = (entry.confidence || entry.q || 0.5) * 0.6 + semanticScore * 0.3 + categoryBonus;
        entry._semantic_score = Math.round(semanticScore * 100) / 100;
      }

      result.entries.sort((a, b) => (b._match_score || 0) - (a._match_score || 0));
      result.entries = result.entries.slice(0, limit);
      result._reranked_by_semantic = true;
    }
  }

  // Phase 2: If knowledge base has results, return them
  if (result.entries.length > 0) return result;

  // Phase 3: Fallback to WebSearch
  if (allowSearch) {
    result.source = 'web';
    result.entries = [{
      content: `[WebSearch needed for: ${tags.join(', ')}]`,
      tags,
      confidence: 0,
      status: 'HYPOTHESIS',
      source: 'web',
      needs_search: true,
    }];
  }

  return result;
}

/**
 * List all REFUTED entries — for LLM to semantically review before storing new knowledge.
 */
function listRefuted(limit = 20) {
  try {
    const data = simpleIO.loadKnowledge("knowledge");
    return simpleLifecycle.listRefuted(data, limit);
  } catch (e) {
    return [];
  }
}

/**
 * 存储一条知识。LLM 必须在存储前通过 checkDuplicate 检查语义重复，
 * 确认无重复后再调用此函数。
 * @param {object} entry
 * @param {string} entry.description - 已提炼的抽象描述
 * @param {string} [entry.summary] - LLM 生成的语义摘要（1-2句，用于去重比对）
 * @param {string[]} [entry.anchors] - LLM 生成的锚点词（3-8个抽象概念词，用于代码层粗筛）
 * @param {string[]} entry.tags - 标签
 * @param {string} [entry.knowledge_level] - 指令层显式传入
 * @param {string} [entry.domain] - 指令层显式传入领域标签
 */
function store(entry) {
  if (!entry?.description) return null;

  // 结晶化: 如果有推理上下文,追加到描述中
  var desc = entry.description;
  var reasoningParts = [];
  if (entry._reasoning) {
    const r = entry._reasoning;
    if (r.divergence_consensus) reasoningParts.push(r.divergence_consensus);
    if (r.dimension_finding || r.bagua_finding) reasoningParts.push(r.dimension_finding || r.bagua_finding);
    if (r.synthesis_conclusion) reasoningParts.push(r.synthesis_conclusion);
    if (r.verification_verdict) reasoningParts.push('验证:' + r.verification_verdict);
  }
  if (reasoningParts.length > 0) {
    desc = desc + '\n\n---\n[推理] ' + reasoningParts.join(' | ');
  }

  var storeEntry = {
    description: desc,
    summary: entry.summary || undefined,
    anchors: entry.anchors || undefined,
    tags: entry.tags || [],
    category: entry.category || 'general',
    q: entry.q || 0.5,
    source: entry.source || 'acquire',
    epistemic_status: entry.epistemic_status || 'deduced',
    knowledge_level: entry.knowledge_level || undefined,
    domain: entry.domain || undefined,
  };
  if (entry.original_example) {
    storeEntry.original_example = entry.original_example;
  }
  const stored = simpleStore.store(storeEntry);
  return stored && stored.id ? { ...stored, point_id: stored.id } : stored;
}

/**
 * 存储步骤输出 — 每个管道步骤的结果存进知识库，供后续同类问题参考
 */
function storeStepOutput(stepName, questionType, output, opts = {}) {
  if (!stepName || !questionType) return null;
  // 归一化到标准步骤名
  stepName = normalizeStep(stepName) || stepName;
  // 清理 questionType
  if (typeof questionType !== 'string') questionType = String(questionType);
  if (questionType.startsWith('{') || questionType.startsWith('[')) {
    try {
      var parsed = JSON.parse(questionType);
      questionType = parsed.question_type || parsed.type || parsed.category || '';
      if (typeof questionType === 'object') questionType = '';
    } catch(e) { questionType = ''; }
  }
  if (questionType.length > 60) questionType = questionType.substring(0, 60);
  if (!questionType) questionType = 'general';

  // 从输出中提取自然语言文本
  var summary = '';
  // 尝试解析 JSON 字符串
  var parsedOutput = null;
  if (typeof output === 'string') {
    try { parsedOutput = JSON.parse(output); } catch(e) {
      // 尝试从自然语言中抠出 JSON 块
      var m = output.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) { try { parsedOutput = JSON.parse(m[1]); } catch(e2) {} }
      var s = output.indexOf('{'), e2 = output.lastIndexOf('}');
      if (!parsedOutput && s !== -1 && e2 > s) { try { parsedOutput = JSON.parse(output.slice(s, e2+1)); } catch(e3) {} }
    }
  } else if (typeof output === 'object') {
    parsedOutput = output;
  }

  if (parsedOutput && typeof parsedOutput === 'object') {
    var textFields = ['consensus', 'key_finding', 'synthesis', 'conclusion', 'reasoning', 'detail', 'description', 'insight', 'evidence'];
    for (var i = 0; i < textFields.length; i++) {
      if (parsedOutput[textFields[i]] && typeof parsedOutput[textFields[i]] === 'string' && parsedOutput[textFields[i]].length > 20) {
        summary = parsedOutput[textFields[i]].substring(0, 300);
        break;
      }
    }
    if (!summary) {
      var parts = [];
      var skipKeys = ['original_example', '_reasoning', '_fallback_raw', '_raw_text'];
      for (var k in parsedOutput) {
        if (skipKeys.indexOf(k) !== -1) continue;
        if (typeof parsedOutput[k] === 'string' && parsedOutput[k].length > 5 && parsedOutput[k].length < 200) {
          parts.push(parsedOutput[k].substring(0, 100));
        }
        if (parts.length >= 3) break;
      }
      // 结构化数组提取：score/converge/debate 类产出（scores/survivors/ranked/...）
      // 拼成"方案名:数值"可读摘要，避免 JSON.stringify 截断产生乱码
      if (!parts.length) {
        var arrays = [];
        if (Array.isArray(parsedOutput)) arrays.push(parsedOutput);
        else {
          var arrKeys = ['scores', 'survivors', 'ranked', 'plans', 'candidates', 'results', 'perspectives', 'dimensions'];
          for (var ak = 0; ak < arrKeys.length; ak++) {
            if (Array.isArray(parsedOutput[arrKeys[ak]])) { arrays.push(parsedOutput[arrKeys[ak]]); break; }
          }
        }
        for (var ai = 0; ai < arrays.length && parts.length < 5; ai++) {
          var arr = arrays[ai];
          for (var aj = 0; aj < arr.length && parts.length < 5; aj++) {
            var it = arr[aj];
            if (it && typeof it === 'object' && it.name) {
              var num = '';
              if (it.total != null) num = ':' + it.total;
              else if (it.score != null) num = ':' + it.score;
              else if (it.rank != null) num = ':第' + it.rank;
              else if (it.reason) num = ':' + String(it.reason).substring(0, 30);
              parts.push(String(it.name).substring(0, 40) + num);
            } else if (typeof it === 'string' && it.length > 5) {
              parts.push(it.substring(0, 60));
            }
          }
        }
        if (parts.length) summary = parts.join(' / ');
      }
      if (!summary) summary = JSON.stringify(parsedOutput).substring(0, 150);
    }
  } else {
    // 降级：无法解析为 JSON，直接截取原始文本
    summary = String(output).substring(0, 300);
  }
  // 截断在自然边界收口（最后一个句读/空格），避免切坏 JSON 或词组
  if (summary.length > 300) {
    var cutS = summary.substring(0, 300);
    var lastB = Math.max(cutS.lastIndexOf('。'), cutS.lastIndexOf('；'), cutS.lastIndexOf('，'), cutS.lastIndexOf(','), cutS.lastIndexOf(' '), cutS.lastIndexOf('/'));
    summary = lastB > 100 ? cutS.substring(0, lastB) : cutS;
  }
  var entryDesc = '[step:' + stepName + '] ' + questionType + ': ' + summary;
  if (entryDesc.length > 400) {
    var cutD = entryDesc.substring(0, 400);
    var lastD = Math.max(cutD.lastIndexOf('。'), cutD.lastIndexOf('；'), cutD.lastIndexOf('，'), cutD.lastIndexOf(','), cutD.lastIndexOf(' '));
    entryDesc = lastD > 150 ? cutD.substring(0, lastD) : cutD;
  }

  // 构造 tags, 清洗每个 tag
  var rawTags = ['step_history', 'step_' + stepName, questionType, ...(opts.tags || [])];
  var cleanTags = [];
  for (var ti = 0; ti < rawTags.length; ti++) {
    var tag = String(rawTags[ti]);
    if (tag.startsWith('{') || tag.startsWith('[')) continue;
    if (tag.length > 60) tag = tag.substring(0, 60);
    if (tag && !cleanTags.includes(tag)) cleanTags.push(tag);
  }

  // 使用 simple-store 直接写入
  try {
    var data = simpleIO.loadKnowledge("step_history");
    var storeOpts = {
      description: entryDesc,
      tags: cleanTags,
      category: categoryFor(stepName),
      q: 0.7,
      source: 'step_history',
      knowledge_level: 'step_history',  // 显式标记：步骤历史不参与用户知识查询
    };
    // 传递 original_example（抽象提炼后保留的原始案例）
    if (opts.original_example) {
      storeOpts.original_example = opts.original_example;
    }
    var result = simpleStore.storePoint(data, storeOpts);
    if (result && result.id) result.point_id = result.id;
    if (result) {
      // 额外打上用户请求的标签
      if (opts.user_request) {
        var found = simpleIO.findById(data, result.id);
        if (found && found.point.tags) {
          if (!found.point.tags.includes('step_history:' + stepName)) {
            found.point.tags.push('step_history:' + stepName);
          }
        }
      }
      simpleIO.saveKnowledge("step_history", data);
    }
    return result;
  } catch (e) {
    // 降级: 用 store 函数
    var fallbackEntry = {
      description: entryDesc,
      tags: cleanTags,
      category: categoryFor(stepName),
      q: 0.7,
      source: 'step_history',
    };
    if (opts.original_example) {
      fallbackEntry.original_example = opts.original_example;
    }
    return store(fallbackEntry);
  }
}

/**
 * 召回历史步骤输出 — 为当前步骤找到最相关的历史输出
 */
function recallStepHistory(stepName, questionType, opts = {}) {
  // 使用 simple-recall 直接检索
  return simpleRecall.recallStepHistory(stepName, questionType, opts);
}

/**
 * 召回错误警告 — 过去犯过的错
 */
function recallErrors(questionType, stepName, opts = {}) {
  const limit = opts.limit || 5;
  const errors = [];

  try {
    // 三文件全扫 REFUTED
    const allData = simpleIO.loadAll();
    const allPoints = [
      ...(allData.philosophy?.points || []),
      ...(allData.knowledge?.points || []),
      ...(allData.step_history?.points || []),
    ];
    for (const p of allPoints) {
      if (p.status === 'REFUTED' && !p.hidden) {
        const tags = p.tags || [];
        const typeMatch = !questionType || tags.some(t => questionType.includes(t));
        if (typeMatch) {
          errors.push({
            type: 'refuted',
            summary: '用户驳斥: ' + (p.description || '').substring(0, 80),
            detail: (p.description || '').substring(0, 200),
            severity: 'high',
            tags: tags.slice(0, 5),
          });
        }
      }
    }
  } catch (e) {}

  errors.sort(function(a, b) {
    if (a.severity === 'high' && b.severity !== 'high') return -1;
    if (a.severity !== 'high' && b.severity === 'high') return 1;
    return 0;
  });
  return errors.slice(0, limit);
}

/**
 * 去重检查（供 LLM 在存储前调用）。
 *
 * 流程：
 *  1. 代码层用 LLM 生成的 anchors 在同 level 内粗筛候选
 *  2. 返回候选的 ID + summary + 权重信息
 *  3. LLM 比较新摘要和候选摘要，判断是否真的语义重叠
 *  4. 重叠 → LLM 调用 reinforce 强化已有知识
 *     不重叠 → LLM 调用 store 存新知识
 *
 * @param {string} newSummary - 新知识的语义摘要
 * @param {string[]} newAnchors - 新知识的锚点词
 * @param {string} knowledgeLevel - 知识层级
 * @param {string} [domain] - 领域标签（domain_expert 时传入）
 * @param {string} [newDesc] - 新知识的完整描述（可选，用于 LLM 最终比对）
 * @returns {object} { candidates: [...], new_summary, new_anchors, new_desc }
 */
function checkDuplicate(newSummary, newAnchors, knowledgeLevel, domain, newDesc) {
  // 按 level 路由到对应文件
  const file = knowledgeLevel === 'step_history' ? 'step_history'
             : knowledgeLevel === 'philosophy' ? 'philosophy'
             : 'knowledge';
  const data = simpleIO.loadKnowledge(file);
  const candidates = simpleStore.getDedupCandidates(
    data,
    newAnchors,
    knowledgeLevel,
    domain || null,
    10
  );

  return {
    candidates: candidates.map(c => ({
      id: c.id,
      summary: c.summary,
      anchors: c.anchors,
      tags: c.tags,
      q: c.q,
      status: c.status,
      _match_count: c._match_count,
      _weight: Math.round(c._weight * 1000) / 1000,
    })),
    new_summary: newSummary,
    new_anchors: newAnchors,
    new_desc: newDesc || '',
    knowledge_level: knowledgeLevel,
    domain: domain || null,
    total_in_level: data.points.filter(p =>
      !p.hidden && p.status !== 'ARCHIVED' && p.status !== 'REFUTED'
    ).length,
  };
}

/**
 * 强化已有知识（去重命中后 LLM 调用此函数替代 store）
 */
function reinforce(existingId, newTags) {
  // 按 ID 前缀路由
  const file = _fileForId(existingId);
  const data = simpleIO.loadKnowledge(file);
  const ok = simpleStore.reinforceExisting(data, existingId, newTags);
  if (ok) simpleIO.saveKnowledge(file, data);
  return { reinforced: ok, id: existingId };
}

/**
 * ID 前缀 → 文件路由
 */
function _fileForId(id) {
  if (id.startsWith('PH')) return 'philosophy';
  if (id.startsWith('KN')) return 'knowledge';
  if (id.startsWith('SH')) return 'step_history';
  return 'knowledge';
}
/**
 * 记录矛盾关系：两条知识语义相关但结论相反。
 * 两个知识点都标记为 DISPUTED，互相记录矛盾对。
 */
function markContradiction(pointIdA, pointIdB, detail) {
  const fileA = _fileForId(pointIdA);
  const fileB = _fileForId(pointIdB);
  const dataA = simpleIO.loadKnowledge(fileA);
  const dataB = simpleIO.loadKnowledge(fileB);

  const a = simpleIO.findById(dataA, pointIdA);
  const b = simpleIO.findById(dataB, pointIdB);
  if (!a || !b) return false;

  const now = new Date().toISOString();

  for (const [found, data, file] of [[a, dataA, fileA], [b, dataB, fileB]]) {
    found.point.status = 'DISPUTED';
    found.point.related_points = found.point.related_points || [];
    const otherId = found === a ? pointIdB : pointIdA;
    if (!found.point.related_points.some(r => r.id === otherId && r.relation === 'contradicts')) {
      found.point.related_points.push({
        id: otherId,
        relation: 'contradicts',
        detail: (detail || '').substring(0, 200),
        at: now,
      });
    }
    simpleIO.saveKnowledge(file, data);
  }

  return { contradicted: true, a: pointIdA, b: pointIdB };
}

function recordOutcome(pointId, outcome, detail = '') {
  if (!pointId) return { recorded: false, error: 'missing_point_id' };

  const file = _fileForId(pointId);
  try {
    const data = simpleIO.loadKnowledge(file);
    const success = simpleLifecycle.recordOutcome(data, pointId, outcome, detail);
    if (!success) return { recorded: false, pointId, outcome, error: 'point_not_found' };
    simpleIO.saveKnowledge(file, data);
    if (outcome === 'refuted' || outcome === 'corrected') {
      simpleStore.storePoint(data, {
        description: '[CORRECTION] ' + (detail || 'User refuted previous knowledge'),
        tags: ['correction', 'refuted'],
        q: 0.9,
        source: 'user_correction',
      });
      simpleIO.saveKnowledge(file, data);
    }
    return { recorded: true, pointId, outcome };
  } catch (e) {
    return { recorded: false, pointId, outcome, error: e.message };
  }
}

/**
 * Classify all existing knowledge — generate summary.
 */
function classify(kg) {
  // 兼容：kg 可能是旧格式的 loadMMA() 返回值，或新格式的 data
  var data = kg;
  if (kg._simple_data) data = kg._simple_data;
  else if (kg.points) data = kg;
  else {
    // 旧格式（有 meridians/extra），加载新数据
    data = simpleIO.loadKnowledge("philosophy");
  }
  return simpleLifecycle.classify(data);
}

/**
 * Link two knowledge points (traceability anchor).
 */
function link(fromId, toId, relation = 'based_on') {
  if (!fromId || !toId) return;
  try {
    const data = simpleIO.loadKnowledge(_fileForId(fromId));
    const from = simpleIO.findById(data, fromId);
    const to = simpleIO.findById(data, toId);
    if (!from || !to) return;
    from.point.related_points = from.point.related_points || [];
    if (!from.point.related_points.some(r => r.id === toId && r.relation === relation)) {
      from.point.related_points.push({ id: toId, relation, at: new Date().toISOString() });
      simpleIO.saveKnowledge(file, data);
    }
  } catch (e) {}
}

/**
 * Mark that a conclusion was verified/refuted by the user.
 * Propagates verdict to all linked knowledge points.
 */
function tagVerdict(pointId, verdict = 'confirmed', detail = '') {
  if (!pointId) return;
  try {
    const data = simpleIO.loadKnowledge(_fileForId(pointId));
    const found = simpleIO.findById(data, pointId);
    if (!found) return;

    const p = found.point;
    p.tags = p.tags || [];
    const verdictTag = 'verdict:' + verdict;
    if (!p.tags.includes(verdictTag)) p.tags.push(verdictTag);
    if (detail && !p.tags.includes('correction:' + detail.substring(0, 20))) {
      p.tags.push('correction:' + detail.substring(0, 20).replace(/\s+/g, '_'));
    }

    if (verdict === 'confirmed') {
      p.status = 'CONFIRMED';
      p.q = Math.min(1.0, (p.q || 0.5) + 0.15);
      p.n = (p.n || 0) + 1;
      p.consolidation_score = (p.consolidation_score || 0) + 5;
      // Reinforce linked points
      const related = p.related_points || [];
      for (const r of related) {
        const linked = simpleIO.findById(data, r.id);
        if (linked && linked.point.status !== 'REFUTED') {
          linked.point.q = Math.min(1.0, (linked.point.q || 0.5) + 0.1);
          linked.point.n = (linked.point.n || 0) + 1;
        }
      }
    } else if (verdict === 'refuted' || verdict === 'corrected') {
      p.status = 'REFUTED';
      p.q = Math.max(0, (p.q || 0.5) - 0.3);
      // Propagate to linked points
      const related = p.related_points || [];
      for (const r of related) {
        const linked = simpleIO.findById(data, r.id);
        if (linked && linked.point.status === 'CONFIRMED') {
          linked.point.status = 'DISPUTED';
          linked.point.tags = linked.point.tags || [];
          if (!linked.point.tags.includes('disputed_by:' + pointId)) {
            linked.point.tags.push('disputed_by:' + pointId);
          }
        }
      }
    }

    simpleIO.saveKnowledge(file, data);
  } catch (e) {}
}

/**
 * Record that a knowledge point was used in a specific pipeline step.
 */
function usedInStep(pointId, stepName) {
  if (!pointId || !stepName) return;
  try {
    const data = simpleIO.loadKnowledge(_fileForId(pointId));
    const found = simpleIO.findById(data, pointId);
    if (!found) return;
    found.point.tags = found.point.tags || [];
    const useTag = 'used_in:' + stepName;
    if (!found.point.tags.includes(useTag)) {
      found.point.tags.push(useTag);
      simpleIO.saveKnowledge(file, data);
    }
  } catch (e) {}
}

/**
 * Trace a conclusion back to its source knowledge.
 */
function trace(pointId) {
  if (!pointId) return null;
  try {
    const data = simpleIO.loadKnowledge(_fileForId(pointId));
    const found = simpleIO.findById(data, pointId);
    if (!found) return null;

    const p = found.point;
    const related = (p.related_points || []).filter(r => r.relation === 'based_on');
    const basedOn = related.map(r => {
      const rp = simpleIO.findById(data, r.id);
      return rp ? { id: rp.point.id, description: (rp.point.description || '').substring(0, 80), tags: rp.point.tags, status: rp.point.status } : { id: r.id, status: 'not_found' };
    });
    const stepUsage = (p.tags || []).filter(t => t.startsWith('used_in:')).map(t => t.replace('used_in:', ''));

    return {
      conclusion_id: pointId,
      description: (p.description || '').substring(0, 100),
      verdict: (p.tags || []).filter(t => t.startsWith('verdict:')).map(t => t.replace('verdict:', '')),
      based_on: basedOn,
      step_usage: stepUsage,
      status: p.status,
      q: p.q,
    };
  } catch (e) {
    return null;
  }
}

/**
 * 全量召回所有哲学知识（启动时注入，作为推理的"思维底子"）。
 * 哲学知识量少而精（几十到上百条），全部加载不担心上下文。
 */
function recallPhilosophy(limit = 200) {
  try {
    const all = simpleRecall.recallAllPhilosophy();
    return all.slice(0, limit);
  } catch (e) {
    return [];
  }
}

/**
 * 模式自动升华：扫描知识库，找出同一 anchor 下积累了大量相似知识的模式。
 * 当某个 category/domain 下相同 anchor 有 ≥3 条知识时，提醒 LLM 合成高阶抽象。
 *
 * @returns {Array} 升华候选 [{anchor, count, points: [{id, summary}], suggestion}]
 */
function detectSchemaCompression(threshold = 3) {
  const anchorIndex = new Map();
  // 遍历 philosophy + knowledge 两个文件
  for (const file of ['philosophy', 'knowledge']) {
    const data = simpleIO.loadKnowledge(file);
    for (const p of data.points) {
      if (p.hidden || p.status === 'ARCHIVED' || p.status === 'REFUTED') continue;
      if (p.knowledge_level === 'step_history') continue;

      const anchors = p.anchors || [];
      for (const anchor of anchors) {
        const key = anchor.toLowerCase();
        if (!anchorIndex.has(key)) anchorIndex.set(key, []);
        anchorIndex.get(key).push({
          id: p.id,
          summary: p.summary || (p.description || '').substring(0, 80),
          knowledge_level: p.knowledge_level || 'philosophy',
        });
      }
    }
  }

  const candidates = [];
  for (const [anchor, points] of anchorIndex) {
    if (points.length >= threshold) {
      // 按 knowledge_level 分组（只升华同 level 的）
      const byLevel = {};
      for (const p of points) {
        if (!byLevel[p.knowledge_level]) byLevel[p.knowledge_level] = [];
        byLevel[p.knowledge_level].push(p);
      }
      for (const [level, pts] of Object.entries(byLevel)) {
        if (pts.length >= threshold) {
          candidates.push({
            anchor,
            knowledge_level: level,
            count: pts.length,
            points: pts.map(p => ({ id: p.id, summary: p.summary })),
            suggestion: `锚点"${anchor}"下有 ${pts.length} 条 ${level} 知识，建议 LLM 审查是否可以合成为一条更高阶的抽象知识`,
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b.count - a.count);
  return candidates;
}

module.exports = { acquire, recall: acquire, store, checkDuplicate, reinforce, recallPhilosophy, markContradiction, detectSchemaCompression, recordOutcome, classify, link, tagVerdict, usedInStep, trace, listRefuted, storeStepOutput, recallStepHistory, recallErrors };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'status') {
    const data = simpleIO.loadAll();
    const allPoints = [
      ...(data.philosophy?.points || []),
      ...(data.knowledge?.points || []),
      ...(data.step_history?.points || []),
    ];
    const summary = simpleLifecycle.classify({ points: allPoints });
    console.log('=== 知识分类 ===');
    console.log(`✅ 已验证正确 (CONFIRMED): ${summary.confirmed.length}`);
    summary.confirmed.forEach(k => console.log(`   ${k.id}: ${k.desc}`));
    console.log(`\n❌ 已知错误 (REFUTED/DISPUTED): ${summary.refuted.length}`);
    summary.refuted.forEach(k => console.log(`   ${k.id}: ${k.desc}`));
    console.log(`\n❓ 未验证 (HYPOTHESIS/PROVISIONAL): ${summary.uncertain.length}`);
    summary.uncertain.forEach(k => console.log(`   ${k.id} [${k.status}] q=${k.q}: ${k.desc}`));
    console.log(`\n💤 休眠 (SLEEPING/ARCHIVED): ${summary.sleeping.length}`);
    console.log(`\n📊 总计: ${summary.total} 条知识点`);
  } else if (cmd === 'refuted') {
    const list = listRefuted();
    console.log(JSON.stringify(list, null, 2));
  } else if (cmd === 'acquire') {
    const queryOpts = JSON.parse(process.argv[3] || '{}');
    const tags = queryOpts.tags || queryOpts || [];
    const result = acquire({ tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? [tags] : []), limit: queryOpts.limit || 5 });
    console.log(JSON.stringify(result.entries || [], null, 2));
  } else if (cmd === 'outcome') {
    const pointId = process.argv[3] || '';
    const outcome = process.argv[4] || '';
    const detail = process.argv.slice(5).join(' ') || '';
    if (!pointId || !['confirmed', 'refuted', 'corrected'].includes(outcome)) {
      console.log('Usage: node scripts/knowledge.js outcome <pointId> <confirmed|refuted|corrected> [detail]');
      process.exit(1);
    }
    const result = recordOutcome(pointId, outcome, detail);
    console.log(JSON.stringify({ ...result, detail: detail.substring(0, 100) }));
    if (!result.recorded) process.exit(1);
  } else if (cmd === 'check-duplicate') {
    // Usage: node scripts/knowledge.js check-duplicate '<summary>' '<anchors_json>' '<level>' '[domain]' '[desc]'
    const newSummary = process.argv[3] || '';
    const newAnchors = (() => { try { return JSON.parse(process.argv[4] || '[]'); } catch(e) { return []; } })();
    const knowledgeLevel = process.argv[5] || 'philosophy';
    const domain = process.argv[6] || undefined;
    const newDesc = process.argv[7] || '';
    const result = checkDuplicate(newSummary, newAnchors, knowledgeLevel, domain, newDesc);
    console.log(JSON.stringify(result, null, 2));
  } else if (cmd === 'reinforce') {
    // Usage: node scripts/knowledge.js reinforce <pointId> '<tags_json>'
    const pointId = process.argv[3] || '';
    const tags = (() => { try { return JSON.parse(process.argv[4] || '[]'); } catch(e) { return []; } })();
    const result = reinforce(pointId, tags);
    console.log(JSON.stringify(result));
  } else if (cmd === 'contradiction') {
    // Usage: node scripts/knowledge.js contradiction <pointIdA> <pointIdB> '<detail>'
    const a = process.argv[3] || '';
    const b = process.argv[4] || '';
    const detail = process.argv.slice(5).join(' ') || '';
    const result = markContradiction(a, b, detail);
    console.log(JSON.stringify(result));
  } else if (cmd === 'get-full') {
    // Usage: node scripts/knowledge.js get-full <pointId>
    const pointId = process.argv[3] || '';
    const full = simpleRecall.getFullContent(pointId);
    console.log(JSON.stringify(full, null, 2));
  } else if (cmd === 'philosophy') {
    // 全量召回哲学知识（启动时注入）
    const limit = parseInt(process.argv[3]) || 200;
    const all = recallPhilosophy(limit);
    console.log(JSON.stringify({ philosophy: all, count: all.length }, null, 2));
  } else if (cmd === 'detect-schema') {
    // Usage: node scripts/knowledge.js detect-schema [threshold=3]
    const threshold = parseInt(process.argv[3]) || 3;
    const candidates = detectSchemaCompression(threshold);
    console.log(JSON.stringify({ candidates, count: candidates.length }, null, 2));
  } else {
    console.log('Usage: node scripts/knowledge.js <status|acquire|refuted|outcome|check-duplicate|reinforce|contradiction|detect-schema|get-full|philosophy>');
  }
}
