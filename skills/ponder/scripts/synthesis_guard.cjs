#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *  综合阶段互斥守护 (Synthesis Mutual-Exclusion Guard)
 * ═══════════════════════════════════════════════════════════════
 *
 *  综合阶段三个动作(结论自反/可谬标注/不可同化项)的硬互斥约束,
 *  原本写在 prompt 自然语言里靠 LLM 自觉遵守。两轮协同测试发现
 *  一半缺陷是 LLM 没遵守这些约束才暴露的。这个守护把核心互斥
 *  下沉成代码校验——LLM 想违反也违反不了(违反则 verdict=VIOLATION)。
 *
 *  3个守卫命令:
 *    exclusion-check   — 三动作两两互斥(可谬↔自反/可谬↔他者)
 *    otherness-gate    — 他者极严门控(非空时三字段齐全+reason非软话)
 *    all               — 全部检查
 *
 *  ⚠️ 重要诚实声明: "同对象"判断在代码层做不了语义级判断。
 *  本守护用"核心名词重叠"做初筛——两字段共享的核心名词占比
 *  超过阈值则警告。这是初筛不是定论:可能是真重复(该改),
 *  也可能是同一核心不确定性被合理引用(引用不重写是允许的)。
 *  最终判定权仍在推理过程,guard 只负责把"明显重写"拦下来。
 *
 *  Usage: node synthesis_guard.cjs <command> [--state '<JSON>']
 *         node synthesis_guard.cjs exclusion-check --state '{"meta_questioning":{...},"fallibilism":{...},"otherness":{...}}'
 */

const { log } = console;

// ═══════════════════════════════════════════════════════════════
//  工具: 提取核心名词 + 计算两段文本的对象重叠度
// ═══════════════════════════════════════════════════════════════

// 软话黑名单(他者reason不接受的话)
const SOFT_PHRASES = ['有点矛盾', '不太好办', '不太好处理', '有点复杂', '暂时没找到', '先挂着', '不太确定', '可能有影响'];

// 停用词(提取核心名词时过滤)
const STOPWORDS = new Set([
    '的', '了', '是', '在', '和', '与', '或', '及', '或', '一个', '一种', '这个', '那个', '这些', '那些',
    '如果', '那么', '因为', '所以', '但是', '不过', '而且', '以及', '对于', '关于', '通过', '进行',
    '可以', '应该', '必须', '可能', '或者', '当中', '其中', '以及', '以下', '上述', '本身', '所有',
    '方案', '结论', '判断', '问题', '情况', '时候', '条件', '时候', '部分', '群体', '这部分', '那部分',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'but',
    'if', 'then', 'because', 'so', 'with', 'that', 'this', 'it',
]);

/**
 * 提取一段中文/英文文本的核心名词集合(多粒度粗筛)
 * 不是真正的分词,是"把文本里所有可能的中文核心名词token都抽出来"的初筛。
 * 关键: 用多粒度(2/3/4字连续汉字的所有子串),而非固定长度滑窗——
 *   固定滑窗会把"社区网络"切成"赖社区网"+"络可满足",核心名词被劈成两半永远匹配不上。
 *   多粒度则"社区网络"(4字)、"社区"/"网络"(2字)都能被抽到,跨文本匹配才稳。
 */
function extractKeyTokens(text) {
    if (!text || typeof text !== 'string') return new Set();
    const tokens = new Set();
    // 中文: 先抽出所有连续汉字段,再对每段抽2/3/4字子串(多粒度)
    const cjkSegments = text.match(/[一-龥]+/g) || [];
    for (const seg of cjkSegments) {
        for (let len = 2; len <= 4; len++) {
            for (let i = 0; i + len <= seg.length; i++) {
                const w = seg.substr(i, len);
                if (!STOPWORDS.has(w)) tokens.add(w);
            }
        }
    }
    // 英文: 抽取3字以上的词
    const enMatches = text.toLowerCase().match(/[a-z]{3,}/g) || [];
    for (const w of enMatches) {
        if (!STOPWORDS.has(w)) tokens.add(w);
    }
    return tokens;
}

/**
 * 计算两段文本的对象重叠度
 *
 * 多粒度抽取会产生噪音(如"赖社""络可"这类无意义2字拼接),所以单看共享token数量
 * 或简单 ratio 都会被噪音稀释。这里用两个指标:
 *   - longest_shared: 两段共享的最长token字数(≥3才有语义意义,2字噪音太多)
 *   - shared_long: 共享的≥3字token个数
 *
 * 判定"同对象"用 longest_shared≥4 或 shared_long≥2(两个3字以上核心词重合)。
 * 这样"社区网络"(4字)一处就够判同对象,而"社区"(2字)单凭噪音匹配不会误判。
 *
 * @returns {overlap, shared, longest_shared, shared_long, ratio}
 */
function objectOverlap(textA, textB) {
    const tokensA = extractKeyTokens(textA);
    const tokensB = extractKeyTokens(textB);
    if (tokensA.size === 0 || tokensB.size === 0) {
        return { overlap: 0, shared: [], longest_shared: 0, shared_long: 0, ratio: 0 };
    }
    const shared = [];
    let longest = 0;
    for (const t of tokensA) {
        if (tokensB.has(t)) {
            shared.push(t);
            if (t.length > longest) longest = t.length;
        }
    }
    const sharedLong = shared.filter(t => t.length >= 3).length;
    const minSize = Math.min(tokensA.size, tokensB.size);
    const ratio = minSize > 0 ? shared.length / minSize : 0;
    return { overlap: shared.length, shared, longest_shared: longest, shared_long: sharedLong, ratio };
}

/**
 * 判定两段是否"可能在说同一对象"(初筛)
 * 条件: 共享≥4字核心名词, 或共享≥2个3字以上名词
 */
function isLikelySameObject(textA, textB) {
    const ov = objectOverlap(textA, textB);
    return ov.longest_shared >= 4 || ov.shared_long >= 2;
}

// 重叠阈值常量已废弃,改用 isLikelySameObject() 的语义化判定(见下)
// 保留导出兼容: OVERLAP_THRESHOLD 仅用于文档引用,实际判定不再用它
const OVERLAP_THRESHOLD = 0.5;

// ═══════════════════════════════════════════════════════════════
//  守卫1: 三动作两两互斥检查
// ═══════════════════════════════════════════════════════════════

/**
 * 检查综合阶段三动作是否撞同一对象:
 *   ① 可谬.likely_wrong_point 不得与 结论自反.shared_premises最弱那条(acceptable=false) 同对象
 *   ② 可谬.likely_wrong_point 不得与 不可同化项.unassimilable_party 同对象
 *
 * @param {object} state — { meta_questioning, fallibilism, otherness }
 *   meta_questioning.shared_premises: [{premise, acceptable, reason}]
 *   fallibilism: { likely_wrong_point, fallback }
 *   otherness: { unassimilable_party, reason, applicability_constraint, ... }
 */
function exclusionCheck(state = {}) {
    const { meta_questioning = {}, fallibilism = {}, otherness = {} } = state;
    const violations = [];
    const warnings = [];

    const wrongPoint = fallibilism.likely_wrong_point || '';

    // 找共享前提最弱那条(acceptable=false 的;若没有,取第一条)
    const premises = meta_questioning.shared_premises || [];
    let weakestPremise = null;
    for (const p of premises) {
        if (p.acceptable === false) { weakestPremise = p; break; }
    }
    if (!weakestPremise && premises.length > 0) weakestPremise = premises[0];
    const weakestText = weakestPremise ? (weakestPremise.premise || '') : '';

    // ① 可谬 ↔ 结论自反互斥
    if (wrongPoint && weakestText) {
        const ov = objectOverlap(wrongPoint, weakestText);
        if (isLikelySameObject(wrongPoint, weakestText)) {
            violations.push({
                rule: '可谬↔结论自反互斥',
                detail: `可谬的"最可能错点"与共享前提最弱那条(acceptable=${weakestPremise.acceptable})对象重叠(最长共享${ov.longest_shared}字: ${ov.shared.filter(t=>t.length>=3).join('/')})`,
                shared_tokens: ov.shared.filter(t => t.length >= 3),
                likely_wrong_point: wrongPoint,
                weakest_premise: weakestText,
                fix: '可谬应只标该前提的"未实测状态"(一句话),另找方案执行层的不同对象作为最可能错点',
            });
        }
    }

    // ② 可谬 ↔ 他者互斥
    const unassimilable = otherness.unassimilable_party || '';
    if (wrongPoint && unassimilable) {
        const ov = objectOverlap(wrongPoint, unassimilable);
        if (isLikelySameObject(wrongPoint, unassimilable)) {
            violations.push({
                rule: '可谬↔他者互斥',
                detail: `可谬的"最可能错点"与不可同化项的"不可收编方"对象重叠(最长共享${ov.longest_shared}字: ${ov.shared.filter(t=>t.length>=3).join('/')})`,
                shared_tokens: ov.shared.filter(t => t.length >= 3),
                likely_wrong_point: wrongPoint,
                unassimilable_party: unassimilable,
                fix: '可谬管方案内执行判断失效,他者管方案外不可代表者;可谬应改标另一个方案内执行层判断,把"不可代表"留给不可同化项',
            });
        }
    }

    // 友情提示: 三者都为空(可逆小事)是正常的,不算违规
    if (!wrongPoint && !weakestText && !unassimilable) {
        warnings.push('三动作均为空——若是可逆小事则正常(门控跳过),若是高赌注问题则缺失反思');
    }

    const verdict = violations.length > 0 ? 'VIOLATION' : 'OK';
    return {
        verdict,
        violations,
        warnings,
        note: '同对象判断为"核心名词≥4字共享或≥2个3字名词共享"的初筛,非语义级定论。可能是真重复(该改),也可能是同一核心不确定性被合理引用(引用不重写允许)。最终判定权在推理过程。',
    };
}

// ═══════════════════════════════════════════════════════════════
//  守卫2: 他者极严门控
// ═══════════════════════════════════════════════════════════════

/**
 * 不可同化项极严门控:
 *   - otherness 为空对象 {} → OK(多数问题无真他者,正常留空)
 *   - otherness 非空 → 必须三字段(unassimilable_party/reason/applicability_constraint)都有内容
 *   - reason 不得含软话("有点矛盾"/"不太好办"等)
 *
 * @param {object} otherness — { unassimilable_party, reason, applicability_constraint, referenced_opposition }
 */
function othernessGate(otherness = {}) {
    const violations = [];

    // 空对象 = 留空,正常
    const isEmpty = Object.keys(otherness).length === 0 ||
        Object.values(otherness).every(v => !v || (typeof v === 'string' && v.trim() === ''));
    if (isEmpty) {
        return {
            verdict: 'OK',
            message: '不可同化项留空——多数问题无真他者,极严门控正确跳过(宁缺毋凑)',
        };
    }

    // 非空: 三字段必须齐全
    const required = ['unassimilable_party', 'reason', 'applicability_constraint'];
    for (const field of required) {
        const val = otherness[field];
        if (!val || (typeof val === 'string' && val.trim() === '')) {
            violations.push({
                rule: '极严门控·字段齐全',
                detail: `不可同化项非空但缺字段: ${field}`,
                fix: '要么三条件全满足(真他者+合题留硬剩余+具体理由)填全,要么留空。不允许填一半。',
            });
        }
    }

    // reason 不得含软话
    const reason = otherness.reason || '';
    if (reason) {
        const foundSoft = SOFT_PHRASES.filter(p => reason.includes(p));
        if (foundSoft.length > 0) {
            violations.push({
                rule: '极严门控·理由具体',
                detail: `reason含软话: ${foundSoft.join('/')}`,
                fix: 'reason须具体到"合题把它假设成了X,实际是Y",不接受"有点矛盾/不太好办"这类万能废话',
            });
        }
        // reason 太短也算(具体理由不会很短)
        if (reason.length < 15) {
            violations.push({
                rule: '极严门控·理由具体',
                detail: `reason过短(${reason.length}字),疑似敷衍`,
                fix: '具体理由须说明为什么任何合题都会扭曲这个他者,通常需要一定篇幅',
            });
        }
    }

    const verdict = violations.length > 0 ? 'VIOLATION' : 'OK';
    return { verdict, violations, otherness_given: otherness };
}

// ═══════════════════════════════════════════════════════════════
//  CLI 调度
// ═══════════════════════════════════════════════════════════════

function parseStateArg(argv) {
    const idx = argv.indexOf('--state');
    if (idx === -1 || idx + 1 >= argv.length) return null;
    try {
        return JSON.parse(argv[idx + 1]);
    } catch (e) {
        log(`Error parsing --state JSON: ${e.message}`);
        process.exit(1);
    }
}

function main() {
    const [, , cmd, ...rest] = process.argv;
    const state = parseStateArg(process.argv);

    try {
        switch (cmd) {
            case 'exclusion-check': {
                if (!state) { log('Usage: synthesis_guard.cjs exclusion-check --state \'{"meta_questioning":{...},"fallibilism":{...},"otherness":{...}}\''); process.exit(1); }
                log(JSON.stringify(exclusionCheck(state), null, 2));
                break;
            }
            case 'otherness-gate': {
                const otherness = state ? (state.otherness || state) : {};
                log(JSON.stringify(othernessGate(otherness), null, 2));
                break;
            }
            case 'all': {
                if (!state) { log('Usage: synthesis_guard.cjs all --state \'{...full synthesis output...}\''); process.exit(1); }
                log(JSON.stringify({
                    exclusion_check: exclusionCheck(state),
                    otherness_gate: othernessGate(state.otherness || {}),
                }, null, 2));
                break;
            }
            default:
                log(`Usage: node synthesis_guard.cjs <command> [--state '<JSON>']
Commands:
  exclusion-check   三动作两两互斥(可谬↔自反/可谬↔他者)
  otherness-gate    他者极严门控(非空时三字段齐全+reason非软话)
  all               全部检查
State JSON shape:
  { meta_questioning:{shared_premises:[{premise,acceptable,reason}]},
    fallibilism:{likely_wrong_point,fallback},
    otherness:{unassimilable_party,reason,applicability_constraint,referenced_opposition} }`);
                process.exit(cmd ? 1 : 0);
        }
    } catch (e) {
        log(`Error: ${e.message}`);
        process.exit(1);
    }
}

if (require.main === module) main();

module.exports = { exclusionCheck, othernessGate, objectOverlap, isLikelySameObject, extractKeyTokens,
    SOFT_PHRASES };
