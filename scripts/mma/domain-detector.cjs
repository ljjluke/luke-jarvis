/**
 * domain-detector.js — 格式级信号检测
 *
 * 核心原则：代码层不做语义分类（不猜"这是什么知识"），只做格式马桶。
 * 格式马桶：拦明确垃圾（叙事口语/文件路径/代码格式/URL），其他的信任指令层。
 *
 * getKnowledgeLevel(desc):
 *   'philosophy'   — 无负面信号 → 默认通过（指令层判断，代码层信任）
 *   'rejected'     — 命中负面信号 → 拒绝（明确垃圾）
 *   'step_history' — 仅当显式传入 knowledge_level 时使用
 *   'domain_expert'— 仅当显式传入 knowledge_level 时使用
 *
 * needsAbstraction() — 格式级信号（代码/金额/URL格式模式）
 */

// ═══ 格式信号 ═══

// 股票/基金代码数字格式: 000001.SZ, 510300
const CODE_RE = /\d{6}\.(SZ|SH|BJ)/i;
const FUND_RE = /\b5\d{5}\b/;
const BARE_STOCK_RE = /\b\d{6}\b(?=[一-龥])/;

// 金额格式
const AMOUNT_RE = /[¥￥]\s*[\d,]+(\.\d+)?|[\d,]+(\.\d+)?\s*[万亿千万百万]\s*[元美元人民币]?|(?:¥|￥|USD|CNY|RMB)\s*\d+/i;

// URL
const URL_RE = /https?:\/\/[\w.-]+\.[a-z]{2,}/i;

function needsAbstraction(desc) {
  if (!desc || typeof desc !== 'string') return false;
  return CODE_RE.test(desc)
    || FUND_RE.test(desc)
    || BARE_STOCK_RE.test(desc)
    || AMOUNT_RE.test(desc)
    || URL_RE.test(desc);
}

// ═══ 负面信号：格式马桶 ═══
// 只拦明确垃圾——步骤历史前缀、叙事口语、文件路径、纯数字操作、代码/金额格式、领域标记
const NEGATIVE_SIGNALS = [
  { re: /^\[step:/ },                                                              // 步骤历史
  { re: /(?:我|我们|他们|她|他|它)\s*(?:先|已经|正在|打算|准备|尝试|做了|发现|看到|觉得|认为|选择|决定)/ },  // 叙事口语
  { re: /\b(?:scripts|agents|engine|hooks)\/[^\s,，。]{3,}\b/ },                   // 文件路径
  { re: /\b[a-z_]+\.(?:js|md|json|py|sh|yml|yaml)\b/ },                            // 文件名
  { re: /\d+\s*(?:个|分钟|小时|天|次|轮|条|项|步|篇|页|行|段)\s*(?:方案|agent|步骤|知识点|文件|发现|测试|案例|记录|输出)/ },  // 纯数字操作
  { re: /\[领域相关\]/ },                                                           // 领域标记
  { re: /^(?:今天|明天|昨天|最近|这几天)\s*(?:天气|心情|状态|感觉|身体).*(?:不错|还行|可以|挺好|不好|很差|糟糕|舒服|难受|开心|难过|高兴|郁闷|累|困|饿|饱)/ },  // 纯口语闲聊
  { re: CODE_RE }, { re: FUND_RE }, { re: BARE_STOCK_RE }, { re: AMOUNT_RE }, { re: URL_RE },  // 格式信号
];

// 最小信息量：少于8个汉字/英文词视为无信息
const MIN_CONTENT_LENGTH = 8;

/**
 * 代码层分类：默认信任指令层，只拦明确垃圾。
 *
 * - 无负面信号 → 'philosophy'（信任指令层，不检查抽象词汇）
 * - 命中负面信号 → 'rejected'（明确垃圾）
 * - 其他 level 需要调用方显式传入
 *
 * @param {string} desc - 待检测描述
 * @returns {'philosophy'|'rejected'}
 */
function getKnowledgeLevel(desc) {
  if (!desc || typeof desc !== 'string') return 'rejected';

  // 最小信息量：去掉标点空格后少于 MIN_CONTENT_LENGTH 个字 → 无信息
  const stripped = desc.replace(/[\s，,。、：:；;！!？?（）()【】\[\]""''""'']/g, '');
  if (stripped.length < MIN_CONTENT_LENGTH) return 'rejected';

  for (const sig of NEGATIVE_SIGNALS) {
    if (sig.re.test(desc)) return 'rejected';
  }

  // 无负面信号 → 信任指令层，默认 philosophy
  return 'philosophy';
}

/**
 * 旧接口兼容
 */
function isAbstractKnowledge(desc) {
  return getKnowledgeLevel(desc) === 'philosophy';
}

module.exports = { needsAbstraction, isAbstractKnowledge, getKnowledgeLevel };
