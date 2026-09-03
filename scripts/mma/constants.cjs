/**
 * constants.js — 知识库路径常量 + 知识维度定义
 *
 * v1.18.58: 精简重构，移除经脉/五行/七情/六爻/飞星等装饰层常量
 * 只保留路径常量和知识维度定义
 */
const { dataRoot: DATA_DIR, resolveData } = require('../runtime-paths.cjs');

// ===== 存储路径（新运行时 + 迁移兼容） =====
const MEMORY_DIR = resolveData('memory');
const PHILOSOPHY_FILE = resolveData('memory', 'philosophy.json');
const KNOWLEDGE_FILE = resolveData('memory', 'knowledge.json');
const STEP_HISTORY_FILE = resolveData('memory', 'step_history.json');
const ARCHIVE_DIR = resolveData('memory', 'archive');
const MMA_FILE = resolveData('memory', 'meridian_kg.json');
const MMA_SHARDS_DIR = resolveData('memory', 'shards');
const WORKING_MEMORY_FILE = resolveData('memory', 'working_memory.json');

// ===== 知识七维度 (7 Knowledge Dimensions) =====
// 人脑对完整知识的7个自然维度 — 八面镜补全的目标结构
const KNOWLEDGE_DIMENSIONS = {
    core:           { name: "核心",   name_en: "Core",        question: "这个知识的核心是什么？一句话概括。" },
    why:            { name: "原因",   name_en: "Why",         question: "为什么这样做？背后的原因/动机是什么？" },
    when:           { name: "场景",   name_en: "When",        question: "什么场景/条件下适用？什么情况下不适用？" },
    how:            { name: "方法",   name_en: "How",         question: "具体怎么做？步骤/方法是什么？" },
    risks:          { name: "风险",   name_en: "Risks",       question: "有什么隐藏的风险？容易出什么问题？" },
    alternatives:   { name: "替代",   name_en: "Alternatives",question: "有没有其他做法？各自的优劣是什么？" },
    prerequisites:  { name: "前提",   name_en: "Prerequisites",question: "需要什么前提条件？依赖什么？" }
};

// 八面镜审视角度 — 用于补全缺失维度时从8个视角追问
const EIGHT_FACET_QUESTIONS = [
    { facet: "驱动力", angle: "驱动力",   question: "这个维度的驱动力/来源是什么？" },
    { facet: "基础",   angle: "基础",     question: "这个维度依赖的已知基础事实是什么？" },
    { facet: "变化",   angle: "变化",     question: "这个维度有什么不确定/可能变化的地方？" },
    { facet: "渗透",   angle: "渗透",     question: "这个维度可以借鉴什么已有知识？" },
    { facet: "深渊",   angle: "深渊",     question: "这个维度有什么隐藏的风险/陷阱？" },
    { facet: "依附",   angle: "依附",     question: "表面下有什么容易被忽略的？" },
    { facet: "边界",   angle: "边界",     question: "有什么边界/限制/不能做的事？" },
    { facet: "汇聚",   angle: "汇聚",     question: "有什么可以互补/整合的知识？" }
];

// ===== 知识维度映射 (从旧十二经脉category迁移) =====
const KNOWLEDGE_CATEGORIES = {
    tools_and_means:              "工具与手段",
    verification_and_validation:  "检验与验证",
    core_decision:                "关键决策",
    input_and_output:             "输入与输出",
    dependencies_and_coordination:"依赖与协调",
    external_interface:           "对外接口",
    core_process:                 "核心过程",
    judgment_and_strategy:        "判断与策略",
    environment_and_conditions:   "环境与条件",
    structure_and_framework:      "结构与框架",
    efficiency_and_resources:     "效率与资源",
    safety_and_bottom_line:       "安全与底线",
    general:                      "通用",
};

module.exports = {
    DATA_DIR, MEMORY_DIR, PHILOSOPHY_FILE, KNOWLEDGE_FILE, STEP_HISTORY_FILE, ARCHIVE_DIR,
    // 旧路径（仅迁移兼容）
    MMA_FILE, MMA_SHARDS_DIR, WORKING_MEMORY_FILE,
    // 知识维度
    KNOWLEDGE_DIMENSIONS, EIGHT_FACET_QUESTIONS,
    KNOWLEDGE_CATEGORIES,
};
