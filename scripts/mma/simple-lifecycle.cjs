/**
 * simple-lifecycle.js — 知识点状态管理 + 分轨保洁
 *
 * 三文件独立保洁策略:
 *   philosophy.json   — 永不衰减，永不淘汰（少而精，全量加载）
 *   knowledge.json     — 500条上限，LRU淘汰最弱的HYPOTHESIS/SLEEPING
 *   step_history.json  — 按时间淘汰（30天SLEEPING，60天ARCHIVED，90天清除）
 *
 * 状态流转:
 *   HYPOTHESIS → PROVISIONAL → CONFIRMED
 *        ↓              ↓          ↓
 *      SLEEPING      SLEEPING   SLEEPING → ARCHIVED
 *        ↓
 *      REFUTED (用户驳斥)
 */
const io = require('./simple-io.cjs');

// 可靠状态（衰减慢）
const RELIABLE = new Set(['ACTIVE', 'MATURE', 'CONFIRMED']);
// 不可靠状态
const UNRELIABLE = new Set(['HYPOTHESIS', 'PROVISIONAL', 'DISPUTED']);
// 失效状态（不参与召回）
const INACTIVE = new Set(['REFUTED', 'ARCHIVED', 'SLEEPING']);

// ═══ 分轨保洁配置 ═══
const PHILOSOPHY_MAX = 200;     // philosophy 硬上限（极少触发）
const KNOWLEDGE_MAX = 500;      // knowledge 500条上限
const STEP_HISTORY_MAX = 2000;  // step_history 硬上限

// SLEEPING 阈值（天）
const THRESHOLDS = {
  philosophy:   { sleep: 365, archive: 730 },  // 基本不衰减
  knowledge:    { sleep: 120, archive: 180 },  // 语义记忆长周期
  step_history: { sleep: 30,  archive: 60 },   // 步骤历史短周期
};

/**
 * 记录用户确认/驳斥结果
 * @param {object} data - 知识库数据（单文件）
 * @param {string} pointId - 知识点ID
 * @param {string} outcome - confirmed / refuted / corrected
 * @param {string} [detail] - 详情
 * @returns {boolean} 是否成功
 */
function recordOutcome(data, pointId, outcome, detail) {
  if (!data || !data.points) return false;
  const found = io.findById(data, pointId);
  if (!found) return false;

  const p = found.point;
  const now = new Date().toISOString();

  if (outcome === 'confirmed') {
    p.status = 'CONFIRMED';
    p.q = Math.min(1.0, (p.q || 0.5) + 0.15);
    p.n = (p.n || 0) + 1;
    p.consolidation_score = (p.consolidation_score || 0) + 5;
    p.last_verified = now;
    if (!p.tags) p.tags = [];
    if (!p.tags.includes('verdict:confirmed')) p.tags.push('verdict:confirmed');
  } else if (outcome === 'refuted' || outcome === 'corrected') {
    p.status = 'REFUTED';
    p.q = Math.max(0, (p.q || 0.5) - 0.3);
    p.last_verified = now;
    if (!p.tags) p.tags = [];
    if (!p.tags.includes('verdict:' + outcome)) p.tags.push('verdict:' + outcome);
    if (detail) {
      p.correction = detail.substring(0, 500);
      if (!p.tags.includes('correction')) p.tags.push('correction');
    }
    // 跨文件传播驳斥
    propagateRefutationCrossFile(pointId);
  }
  return true;
}

/**
 * 跨文件驳斥传播：被驳斥的知识点，关联知识点标记为DISPUTED
 */
function propagateRefutationCrossFile(refutedId) {
  for (const file of ['philosophy', 'knowledge', 'step_history']) {
    const data = io.loadKnowledge(file);
    for (const p of data.points) {
      if (p.status === 'CONFIRMED' && p.related_points) {
        for (const r of p.related_points) {
          if (r.id === refutedId) {
            p.status = 'DISPUTED';
            if (!p.tags) p.tags = [];
            if (!p.tags.includes('disputed_by:' + refutedId)) {
              p.tags.push('disputed_by:' + refutedId);
            }
            break;
          }
        }
      }
    }
    io.saveKnowledge(file, data);
  }
}

/**
 * @deprecated 旧单文件版本，保留兼容
 */
function propagateRefutation(data, refutedId) {
  for (const p of data.points) {
    if (p.status === 'CONFIRMED' && p.related_points) {
      for (const r of p.related_points) {
        if (r.id === refutedId) {
          p.status = 'DISPUTED';
          if (!p.tags) p.tags = [];
          if (!p.tags.includes('disputed_by:' + refutedId)) {
            p.tags.push('disputed_by:' + refutedId);
          }
          break;
        }
      }
    }
  }
}

/**
 * 衰减检查 — 分轨不同周期
 *
 * philosophy:  365天SLEEPING / 730天ARCHIVED（基本不衰减）
 * knowledge:   120天SLEEPING / 180天ARCHIVED
 * step_history: 30天SLEEPING / 60天ARCHIVED
 *
 * @param {object} data - 知识库数据
 * @param {'philosophy'|'knowledge'|'step_history'} level
 * @returns {Array} 衰减动作列表
 */
function decayCheck(data, level) {
  if (!data || !data.points) return [];
  const now = new Date();
  const actions = [];
  const t = THRESHOLDS[level] || THRESHOLDS.knowledge;

  for (const p of data.points) {
    if (p.hidden || p.status === 'ARCHIVED' || p.status === 'REFUTED') continue;

    const lastVerified = new Date(p.last_verified || p.created_at || now);
    const daysSince = (now - lastVerified) / 86400000;

    if (p.status !== 'SLEEPING' && daysSince > t.sleep && !RELIABLE.has(p.status)) {
      p.status = 'SLEEPING';
      p.slept_at = now.toISOString();
      actions.push({ point_id: p.id, file: level, action: 'sleep', days: Math.round(daysSince) });
    } else if (p.status === 'SLEEPING' && daysSince > t.archive) {
      p.status = 'ARCHIVED';
      p.archived_at = now.toISOString();
      actions.push({ point_id: p.id, file: level, action: 'archive', days: Math.round(daysSince) });
    } else if (p.status === 'SLEEPING' && daysSince <= 7 && p.n > 0) {
      p.status = 'PROVISIONAL';
      p.awoke_at = now.toISOString();
      actions.push({ point_id: p.id, file: level, action: 'awaken', days: Math.round(daysSince) });
    }
  }
  return actions;
}

/**
 * 分轨知识保洁
 *
 * philosophy:  衰减检查 + 200条硬上限（极少触发，哲学条目少而精）
 * knowledge:   衰减检查 + 500条上限（淘汰最弱的HYPOTHESIS/SLEEPING）
 * step_history: 衰减检查 + 2000条硬上限 + 清除90天以上ARCHIVED
 *
 * @param {object} data - 知识库数据
 * @param {'philosophy'|'knowledge'|'step_history'} level
 * @returns {Array} 保洁动作列表
 */
function knowledgeGroom(data, level) {
  if (!data || !data.points) return [];
  level = level || 'knowledge';

  const actions = decayCheck(data, level);

  const now = new Date();

  // 清除过期ARCHIVED（各文件不同周期）
  let purgeAge;
  if (level === 'step_history') purgeAge = 90;
  else if (level === 'philosophy') purgeAge = 1095;  // 3年
  else purgeAge = 180;

  const toRemove = [];
  for (let i = data.points.length - 1; i >= 0; i--) {
    const p = data.points[i];
    if (p.status === 'ARCHIVED') {
      const archivedAt = new Date(p.archived_at || p.last_verified || now);
      if ((now - archivedAt) / 86400000 > purgeAge) {
        toRemove.push({ id: p.id, desc: (p.description || '').substring(0, 60) });
        data.points.splice(i, 1);
      }
    }
  }
  if (toRemove.length > 0) {
    actions.push({ action: 'purge_archived', file: level, count: toRemove.length });
  }

  // 限制总知识点数
  let maxPoints;
  if (level === 'philosophy') maxPoints = PHILOSOPHY_MAX;
  else if (level === 'step_history') maxPoints = STEP_HISTORY_MAX;
  else maxPoints = KNOWLEDGE_MAX;

  if (data.points.length > maxPoints) {
    const sorted = data.points
      .map((p, i) => ({ p, i }))
      .filter(x => x.p.status === 'SLEEPING' || x.p.status === 'HYPOTHESIS')
      .sort((a, b) => (a.p.q || 0) - (b.p.q || 0));
    const excess = data.points.length - maxPoints;
    const toDelete = new Set(sorted.slice(0, excess).map(x => x.p.id));
    data.points = data.points.filter(p => !toDelete.has(p.id));
    if (toDelete.size > 0) {
      actions.push({ action: 'cap_points', file: level, removed: toDelete.size });
    }
  }

  return actions;
}

/**
 * 全轨保洁（扫描三文件）
 * @returns {object} { philosophy_actions, knowledge_actions, step_history_actions }
 */
function groomAll() {
  const result = {};
  for (const level of ['philosophy', 'knowledge', 'step_history']) {
    const data = io.loadKnowledge(level);
    const actions = knowledgeGroom(data, level);
    if (actions.length > 0) {
      io.saveKnowledge(level, data);
    }
    result[level + '_actions'] = actions;
  }
  return result;
}

/**
 * 列出所有被驳斥的知识点（跨三文件）
 * @param {number} [limit] - 最大返回数
 * @returns {Array}
 */
function listRefuted(data, limit) {
  limit = limit || 20;
  // 如果只传了一个文件数据，兼容旧调用
  if (data && data.points) {
    return data.points
      .filter(p => p.status === 'REFUTED' || p.status === 'DISPUTED')
      .map(p => ({
        id: p.id,
        description: (p.description || '').substring(0, 100),
        tags: p.tags,
        status: p.status,
        correction: p.correction || null,
      }))
      .slice(0, limit);
  }

  // 跨三文件
  const all = [];
  for (const file of ['philosophy', 'knowledge', 'step_history']) {
    const d = io.loadKnowledge(file);
    all.push(...(d.points || [])
      .filter(p => p.status === 'REFUTED' || p.status === 'DISPUTED')
      .map(p => ({
        id: p.id,
        description: (p.description || '').substring(0, 100),
        tags: p.tags,
        status: p.status,
        correction: p.correction || null,
      })));
  }
  return all.slice(0, limit);
}

/**
 * 分类统计
 * @param {object} data - 知识库数据（单文件）
 * @returns {object} {confirmed, refuted, uncertain, sleeping, total}
 */
function classify(data) {
  if (!data || !data.points) return { confirmed: [], refuted: [], uncertain: [], sleeping: [], total: 0 };
  const result = { confirmed: [], refuted: [], uncertain: [], sleeping: [], total: data.points.length };
  for (const p of data.points) {
    if (p.hidden) continue;
    const entry = { id: p.id, desc: (p.description || '').substring(0, 60), q: p.q, status: p.status };
    if (p.status === 'CONFIRMED' || p.status === 'MATURE') {
      result.confirmed.push(entry);
    } else if (p.status === 'REFUTED' || p.status === 'DISPUTED') {
      result.refuted.push(entry);
    } else if (p.status === 'SLEEPING' || p.status === 'ARCHIVED') {
      result.sleeping.push(entry);
    } else {
      result.uncertain.push(entry);
    }
  }
  return result;
}

module.exports = {
  recordOutcome,
  propagateRefutation,
  propagateRefutationCrossFile,
  decayCheck,
  knowledgeGroom,
  groomAll,
  listRefuted,
  classify,
  RELIABLE,
  UNRELIABLE,
  INACTIVE,
};
