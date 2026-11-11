/** ═══════════════════════════════════════════════════════════════
 *  用户画像 (User Profile) — 习惯/性格/沟通偏好
 *  "知己知彼" —《孙子兵法》
 *
 *  与知识库完全分离:
 *    - 知识(MMA) = 全局共享, 跨用户跨场景
 *    - 画像(Profile) = 每个用户独立, 只影响输出格式
 *    - 发散引擎永不接收画像数据 → 思维不受限
 * ═══════════════════════════════════════════════════════════════ */
const fs = require('fs');
const crypto = require('crypto');
const { ensureDataDir, resolveData } = require('../runtime-paths.cjs');

const USERS_DIR = resolveData('users');

function ensureDir() { ensureDataDir('users'); }

function userFilePath(userId) {
    const safeId = String(userId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
    return resolveData('users', safeId + '.json');
}

/**
 * 默认用户画像 (冷启动)
 */
function defaultProfile(userId) {
    return {
        user_id: userId,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        session_count: 0,
        // 沟通偏好 (只影响输出格式)
        preferences: {
            output_style: 'balanced',     // concise | balanced | detailed
            risk_appetite: 'balanced',    // conservative | balanced | aggressive
            focus_dimensions: [],          // ['tian','di','ren','fa','wu'] 用户特别关注的维度
            language: null,                // 自动检测
        },
        // 人格特征 (基于交互行为推断)
        personality: {
            wuxing_type: null,            // wood | fire | earth | metal | water
            wuxing_confidence: 0,
            observed_traits: [],           // ['prefers_宏观','prefers_细节','prefers_风险分析']
        },
        // 行为观察 (从交互中积累)
        observations: {
            prefers_short_output: 0,       // 计数器: 喜欢简短输出
            prefers_deep_analysis: 0,      // 计数器: 喜欢深度分析
            asks_about_risks: 0,           // 计数器: 多次问风险
            interrupts_verbose: 0,         // 计数器: 嫌啰嗦
            corrects_assumptions: 0,       // 计数器: 纠正假设
        },
        // 领域专业维度 — 由苏格拉底无知自检补上的、五诊探不到的专业事项
        // 格式: [{ dimension: "税负结构", value: "相关税法规定", source: "无知自检追问", session: "..." }]
        domain_professional_dimensions: [],
        // 交互历史摘要 (最近10条)
        recent_interactions: [],
    };
}

/**
 * 加载用户画像
 */
function loadProfile(userId) {
    ensureDir();
    const fp = userFilePath(userId);
    try {
        if (fs.existsSync(fp)) {
            const profile = JSON.parse(fs.readFileSync(fp, 'utf-8'));
            // 跨会话追踪：距上次可见超过1小时算新会话
            const now = Date.now();
            const last = profile.last_seen ? new Date(profile.last_seen).getTime() : 0;
            if (now - last > 3600000) {
                profile.session_count = (profile.session_count || 0) + 1;
            }
            profile.last_seen = new Date().toISOString();
            return profile;
        }
    } catch (e) { /* corrupted → reset */ }
    const profile = defaultProfile(userId);
    profile.session_count = 1;
    profile.last_seen = new Date().toISOString();
    saveProfile(profile);
    return profile;
}

/**
 * 保存用户画像
 */
function saveProfile(profile) {
    ensureDir();
    const fp = userFilePath(profile.user_id);
    profile.last_seen = new Date().toISOString();
    const tmp = `${fp}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(profile, null, 2), { encoding: 'utf-8', flag: 'wx' });
        fs.renameSync(tmp, fp);
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
}

/**
 * 记录观察到的行为
 */
function observeBehavior(profile, behavior) {
    if (!profile.observations[behavior]) profile.observations[behavior] = 0;
    profile.observations[behavior]++;

    // 自动触发调整
    const adj = [];
    if (profile.observations.prefers_short_output >= 3 || profile.observations.interrupts_verbose >= 2) {
        if (profile.preferences.output_style !== 'concise') {
            profile.preferences.output_style = 'concise';
            adj.push('output_style→concise');
        }
    }
    if (profile.observations.prefers_deep_analysis >= 3) {
        if (profile.preferences.output_style !== 'detailed') {
            profile.preferences.output_style = 'detailed';
            adj.push('output_style→detailed');
        }
    }
    if (profile.observations.asks_about_risks >= 3) {
        if (!profile.preferences.focus_dimensions.includes('fa')) {
            profile.preferences.focus_dimensions.push('fa');
            adj.push('added_focus:fa(risks)');
        }
    }
    if (profile.observations.corrects_assumptions >= 3) {
        if (!profile.preferences.focus_dimensions.includes('wu')) {
            profile.preferences.focus_dimensions.push('wu');
            adj.push('added_focus:wu(essence)');
        }
    }

    return { behavior, count: profile.observations[behavior], adjustments: adj };
}

/**
 * 九征人格分类 (《人物志》刘劭)
 * 神(意识)、精(智力)、筋(胆识)、骨(意志)、气(情绪)、
 * 色(表情)、仪(举止)、容(态度)、言(言语)
 * → 归类为五行五常
 */
const JIU_ZHENG = {
    // 五行→九征→五常→行为信号映射
    wood:  { wuchang: '仁', traits: '弘毅(宽宏坚毅)', signals: ['协作','宏观','长期'], oppose: '短视' },
    fire:  { wuchang: '礼', traits: '文理(文采条理)', signals: ['规则','细节','流程'], oppose: '混乱' },
    earth: { wuchang: '信', traits: '贞固(坚贞稳固)', signals: ['务实','稳定','可靠'], oppose: '冒进' },
    metal: { wuchang: '义', traits: '勇敢(勇敢果断)', signals: ['果断','效率','直接'], oppose: '犹豫' },
    water: { wuchang: '智', traits: '通微(通达精微)', signals: ['分析','深度','创新'], oppose: '肤浅' },
};

/**
 * 更新人格五行类型 — 基于《人物志》九征 + 行为信号
 * 输入: 从对话中提取的行为倾向信号
 */
function inferWuxingType(profile, signals = {}) {
    if (!signals || Object.keys(signals).length < 3) return null;

    const types = {};
    for (const [wx, cfg] of Object.entries(JIU_ZHENG)) {
        let score = 0;
        let count = 0;
        for (const sig of cfg.signals) {
            if (signals[sig] !== undefined) { score += signals[sig]; count++; }
        }
        const oppose = cfg.oppose;
        if (signals[oppose] !== undefined) { score -= signals[oppose] * 0.5; }
        types[wx] = count > 0 ? score / count : 0;
    }

    let best = null, bestScore = 0;
    for (const [type, score] of Object.entries(types)) {
        if (score > bestScore) { bestScore = score; best = type; }
    }

    if (best && bestScore > 0.3) {
        profile.personality.wuxing_type = best;
        profile.personality.wuxing_confidence = Math.round(bestScore * 100) / 100;
        const jz = JIU_ZHENG[best];
        profile.personality.observed_traits = profile.personality.observed_traits || [];
        if (!profile.personality.observed_traits.includes(jz.wuchang)) {
            profile.personality.observed_traits.push(jz.wuchang);
        }
        return { wuxing_type: best, confidence: profile.personality.wuxing_confidence, wuchang: jz.wuchang, traits: jz.traits };
    }
    return null;
}

/**
 * 获取格式调整建议 (基于用户偏好, 不改变分析内容)
 */
function getFormatAdjustments(profile) {
    const adj = [];
    const p = profile.preferences;
    const c = profile.observations;

    if (p.output_style === 'concise') {
        adj.push('output: concise — avoid lengthy explanations');
        adj.push('diverge: prioritize key insights, skip mechanical steps');
    } else if (p.output_style === 'detailed') {
        adj.push('output: detailed — provide thorough analysis');
    }

    if (p.risk_appetite === 'conservative') {
        adj.push('ranking: emphasize risk/reliability in comparison');
    }

    if (c.asks_about_risks >= 2) {
        adj.push('risk: expand risk analysis section');
    }

    if (c.corrects_assumptions >= 2) {
        adj.push('assumptions: label them clearly — user likes to correct');
    }

    return adj;
}

/**
 * 记录一次交互到画像
 */
function logInteraction(profile, type, summary) {
    profile.recent_interactions = profile.recent_interactions || [];
    profile.recent_interactions.unshift({
        type, summary: summary.slice(0, 120),
        timestamp: new Date().toISOString(),
    });
    if (profile.recent_interactions.length > 10) profile.recent_interactions = profile.recent_interactions.slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════
function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('User Profile — per-user habits & communication preferences');
        console.log('  load <user-id>                       Load profile');
        console.log('  observe <user-id> --behavior <name>   Record observed behavior');
        console.log('  infer <user-id> --signals <json>      Infer wuxing personality type');
        console.log('  format-adjust <user-id>                Get output format adjustments');
        console.log('  info <user-id>                         Show profile summary (user-visible)');
        return;
    }
    const cmd = args[0];
    const uid = args[1] || 'default';
    function parseFlags(k) {
        const idx = args.indexOf('--' + k);
        return idx >= 0 ? args[idx + 1] : null;
    }

    try {
        switch (cmd) {
        case 'load': {
            const profile = loadProfile(uid);
            const adj = getFormatAdjustments(profile);
            console.log(JSON.stringify({
                user_id: uid,
                sessions: profile.session_count,
                wuxing_type: profile.personality.wuxing_type,
                style: profile.preferences.output_style,
                format_adjustments: adj,
                first_seen: profile.first_seen,
                recent_interactions: profile.recent_interactions.slice(0, 3),
            }, null, 2));
            break;
        }
        case 'observe': {
            const profile = loadProfile(uid);
            const behavior = parseFlags('behavior') || 'unknown';
            const result = observeBehavior(profile, behavior);
            saveProfile(profile);
            console.log(JSON.stringify(result, null, 2));
            break;
        }
        case 'infer': {
            const profile = loadProfile(uid);
            const signals = JSON.parse(parseFlags('signals') || '{}');
            const result = inferWuxingType(profile, signals);
            saveProfile(profile);
            console.log(JSON.stringify(result || { error: 'not enough signals' }, null, 2));
            break;
        }
        case 'format-adjust': {
            const profile = loadProfile(uid);
            const adj = getFormatAdjustments(profile);
            console.log(JSON.stringify({ adjustments: adj }, null, 2));
            break;
        }
        case 'info': {
            const profile = loadProfile(uid);
            const p = profile.preferences;
            const obs = profile.observations;
            const wu = profile.personality.wuxing_type;
            console.log(JSON.stringify({
                message: '我记得你上次...',
                details: [
                    wu ? `你倾向于${({wood:'宏观战略',fire:'流程规范',earth:'务实稳定',metal:'高效果断',water:'深度分析'})[wu]||wu}型思考` : null,
                    p.output_style === 'concise' ? '你喜欢简洁输出' : p.output_style === 'detailed' ? '你喜欢深度分析' : null,
                    obs.asks_about_risks > 2 ? '你经常关注风险 — 我会加强风险分析' : null,
                    obs.corrects_assumptions > 2 ? '你经常纠正假设 — 我会明确标注未验证项' : null,
                    obs.interrupts_verbose > 1 ? '我注意到你嫌啰嗦 — 我会精简输出' : null,
                ].filter(Boolean),
            }, null, 2));
            break;
        }
        default:
            console.log('Unknown:', cmd);
        }
    } catch (e) { console.log('Error:', e.message); }
}

if (require.main === module) main();

module.exports = {
    loadProfile, saveProfile, defaultProfile,
    observeBehavior, inferWuxingType,
    getFormatAdjustments, logInteraction,
};
