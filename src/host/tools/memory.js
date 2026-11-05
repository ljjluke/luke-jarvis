/** jarvis_* 工具（memory）：项目记忆与可视化：记忆库读写、教训、流程沉淀、本质、黑板、会话快照。
 *
 *  工具定义与 handler 同文件；依赖一律从层模块 import（runtime/gates/state/pixoffice/distill/protocol），
 *  不在工具内再实现判定逻辑——闸与状态只认单一事实源。
 */
import { createRequire } from 'node:module'
import { toPixOfficeSnapshot } from '../office-bridge.js'
import { Engine, reasonText } from '../core/index.js'
import { JsonTicketRepositories } from '../adapters/json-tickets.js'
import { SECTIONS, EVIDENCE_SECTIONS, COLLAB_FOUR, checkCollabHealth, validateCardShape, assessCardDepth, distillGuide, identifyIndustry, checkContentFingerprint } from '../distill/index.js'
import { JARVIS_SYSTEM_PROTOCOL, JARVIS_CULTURE } from '../protocol/index.js'
import { COORD_TASK_RE, TERMINAL_TASK_STATUS, ACTIVE_TEAM_MARKER_TTL_MS, ACTIVE_TEAM_MAX_AGE_MS, ARCHIVED_TEAM_RE, resolveOwnedTeams, looksLikePluginRepo, stateRootConflict, writeActiveTeamMarker } from '../gates/ownership.js'
import { listNames, readTextSafe, hasTeamJson, resolveWorkspace, ponderVerifyProjectDir, getFsService, getRuntimeContext, getLatestExec, getResolvedWorkspace, markJarvisSession, isJarvisSession } from '../runtime.js'
import { MEMORY_MAX_AGE_MS, checkMemoryFresh, _readGates, _memoryState, recordGate, _flowState } from '../gates/store.js'
import { JARVIS_STAGES, STAGE_LABELS, STAGE_GATE, STAGE_DENY, PAID_WORK_TOOLS, computeStage, renderStage, jarvisStageGate, captainExecutionGuard } from '../gates/stage.js'
import { TEAM_TOOLS, jarvisFlowGuard } from '../gates/flow.js'
import { auditTeamBriefs, auditCaptainOwnedTasks, auditStaleTasks, checkTalentPreconditions, checkPonderVerify, checkCoverageGate, hasGlob, _dropMissing } from '../gates/audit.js'
import { boardFilePath, readBoardItems, writeBoardItems, nextBoardId } from '../state/board.js'
import { meetingPolicy } from '../state/meetings.js'
import { appendEvent } from '../state/events.js'
import { companyStateFile, readCompanyState, writeCompanyState, syncCompanyState } from '../state/company.js'
import { PIXOFFICE_ACTOR_IDS, PIXOFFICE_EVENT_KINDS, PIXOFFICE_COMMANDS, PIXOFFICE_LIMITS, normalizeEventKind, buildPixOfficeFrame, validatePixOfficeFrame, sseFrameString, relaySeqDecision, frameHash, validatePixOfficeCommand } from '../pixoffice/index.js'
const _require = createRequire(import.meta.url)


/** 本组工具（按原始顺序）；由 tools/index.js 汇总成 TOOLS。 */
export const MEMORY_TOOLS = [
  {
    name: 'jarvis_store',
    description:
      '项目记忆库管理（领域无关的"项目长期记忆"，类比 .idea：项目内嵌随项目走）：prototypes(真实人物原型素材)/cards(虚拟人物卡)/process(流程)/components(组件)/project.md(项目细节快照)/board(黑板)/lessons(进度经验) 都沉淀在**项目自己的** <workspace>/.jarvis/ 里——AI 识别到本项目直接读这套记忆继续工作，不用重分析源码。**目录规范**：根目录只放 README.md(规范说明)/board.json/project.md/lessons.md/process-*.json/components.json，其余按类型归档——人物素材→prototypes/、人物卡→cards/(历史→cards/history/)、审计报告→reports/、设计稿→designs/、验证脚本→scripts/、交付文档→docs/，**产物不许散在根目录**。模式：①check=阶段零判定（有记忆→直接读取复用继续；无记忆→从零蒸馏并建立记忆库）；②scaffold=输出记忆库目录结构；③reuse=复用校验（本项目沉淀可复用但须过 jarvis_distill 校验+按新需求修订；跨项目/插件禁止）；④save=按类型写入对应目录（prototype→prototypes/、card→cards/、project→project.md、lesson→lessons.md、process/components→json）。插件本身不携带任何角色卡与领域模板。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'check 查记忆库判定 / scaffold 初始化结构 / reuse 复用校验 / save 写入记忆（默认 scaffold）' },
        projectDir: { type: 'string', description: '项目记忆库根目录（默认 <workspace>/.jarvis/）' },
        itemType: { type: 'string', description: '沉淀类型：prototype=真实人物原型→prototypes/ / card=虚拟人物卡→cards/ / process=领域流程→根 process-*.json / component=组件→components.json / project=项目细节快照→根 project.md / lesson=进度经验→根 lessons.md / report=审计报告→reports/ / design=设计稿→designs/ / script=验证脚本→scripts/ / doc=交付文档→docs/（save 用，按类型归档不散根目录）' },
        name: { type: 'string', description: '角色名或流程/组件名' },
        existingCards: { type: 'string', description: '本项目已沉淀角色卡清单 JSON，如 [{"role":"研发","file":"cards/研发.md"}]（reuse 校验用）' },
        existingDirs: { type: 'string', description: '本项目 .jarvis/ 已有目录清单 JSON（check 判定用）' },
        cards: { type: 'string', description: '已存在的角色卡名，逗号分隔（check 用）' },
        prototypes: { type: 'string', description: '已存在的真实人物原型名，逗号分隔（check 用）' },
        projectMd: { type: 'string', description: 'project.md 是否存在（true/false，check 用）' },
        projectContent: { type: 'string', description: 'project.md 实际内容（check 用，传了就真校验续接五件套五项是否都在）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          structure: { type: 'array', items: { type: 'string' }, description: '项目沉淀目录结构' },
          reuseRule: { type: 'string', description: '复用规则（本项目沉淀 vs 跨项目/插件禁止）' },
          savePath: { type: 'string', description: '本次写沉淀的目标路径' },
          verdict: { type: 'string' },
        },
        required: ['structure', 'reuseRule', 'verdict'],
      },
      render: (r) =>
        `【项目沉淀 · .jarvis/】\n结构：${(r.structure || []).join('\n      ')}\n复用规则：${r.reuseRule}\n本次保存：${r.savePath ?? '—'}\n判定：${r.verdict}`,
    },
    execute: async (args, exec) => {
      const mode = String(args.mode ?? 'scaffold').trim()
      const projectDir = String(args.projectDir ?? '<workspace>/.jarvis/').trim()
      const itemType = String(args.itemType ?? '').trim()
      const name = String(args.name ?? '').trim()
      const existingCards = String(args.existingCards ?? '').trim()
      const existingDirs = String(args.existingDirs ?? '').trim() // 已有沉淀目录清单 JSON（check 用）
      const structure = [
        `${projectDir}README.md        —— 本目录规范说明（每个子目录放什么/怎么命名/怎么归档）——先读它再读写 .jarvis`,
        `${projectDir}prototypes/      —— 真实人物信息资料（原型）：每个真实大佬的原始素材（访谈/著作/决策记录/URL），是蒸馏的证据源，AI 识别到本项目直接读取`,
        `${projectDir}cards/           —— 虚拟人物卡（工作能力细节）：蒸馏出的六段式角色卡（思维模型/方法论/红线/协同），含深度分；历史版本放 cards/history/`,
        `${projectDir}process-*.json   —— 领域流程：CEO 定稿的阶段/闸门/红线/必须角色/会议触点（命名 process-<需求关键词>.json）`,
        `${projectDir}components.json  —— 组件清单：能力补足自研/引入的组件（名字/功能/用法/维护者）`,
        `${projectDir}board.json       —— 统一黑板：会议驱动协作的状态/未决项/决议`,
        `${projectDir}project.md       —— 项目细节快照：需求本质/验收标准/接口契约/进度/关键决策——AI 读到即可继续，不用重分析源码`,
        `${projectDir}lessons.md       —— 当前项目进度经验总结：踩坑/教训/适配度记录，防重复`,
        `${projectDir}reports/         —— 审计/复盘报告：单次专项的产出（如 t1 审计报告），命名 <主题>.md`,
        `${projectDir}designs/         —— 设计稿：方案未实施前的设计文档（供方案评审），实施后归档或并入 docs/`,
        `${projectDir}scripts/         —— 验收/验证脚本：本项目的可执行验证（如判别实验），命名 <用途>.mjs`,
        `${projectDir}docs/            —— 交付文档与索引：方案定稿/交付清单/历史需求索引`,
      ]
      let reuseRule = ''
      let verdict = ''
      let savePath = ''
      if (mode === 'check') {
        // 阶段零：先查项目沉淀——有经验直接继续，没有才从零蒸馏
        const hasJarvis = !!(existingDirs && existingDirs.trim() !== '[]' && existingDirs.trim() !== '')
        const cards = String(args.cards ?? '').trim()
        const proto = String(args.prototypes ?? '').trim()
        const hasProject = String(args.projectMd ?? '').trim()
        if (hasJarvis || cards || proto || hasProject) {
          reuseRule =
            '【有记忆 → 直接继续】本项目 .jarvis/ 已存在完整记忆：prototypes(真实人物原型) + cards(虚拟人物卡) + process(流程) + project.md(项目细节) + board(黑板) + lessons(进度经验)。AI 识别到本项目直接读取这套记忆即可继续工作（卡须过 jarvis_distill 校验+按新需求修订），**不用重新分析源码**——项目细节/progress 已记录。'
          verdict = `阶段零判定：项目已有记忆库${cards ? '（cards: ' + cards + '）' : ''}${proto ? '（prototypes: ' + proto + '）' : ''} → 读取复用继续，不从零蒸馏。`
          // 续接五件套完整性（代码级归一化：有记忆 ≠ 能续接——续接五件套缺项 = 新会话/追加成员仍会断层，提示补）
          const FIVE = [
            ['当前进度', /当前进度|进行到哪|done|in_progress|pending|任务状态/],
            ['下一步', /下一步|接着干|下一个动作|next/],
            ['未决项', /未决项|未决|open|遗留|遗留问题/],
            ['团队清单', /团队|成员|角色|assignee|清单/],
            ['关键决策与依据', /关键决策|决策.*依据|为什么.*定|否决|选型|拍板/],
          ]
          const missingFive = FIVE.filter(([label, re]) => !re.test(reuseRule) && !re.test(verdict)).map(([l]) => l)
          // 以传入的 projectMd 是否可能含五件套为判据（此处无法读文件内容，提示按需补写）
          if (String(args.projectMd ?? '').trim() === 'true') {
            // project.md 存在——若有内容则真校验五件套，否则输出核对提醒
            const content = String(args.projectContent ?? '').trim()
            if (content) {
              const FIVE_RE = [
                ['当前进度', /当前进度|进行到哪|任务状态|done|in_progress|pending/i],
                ['下一步', /下一步|接着干|下一个动作|next step|NEXT/i],
                ['未决项', /未决项|未决|遗留|open|待办/i],
                ['团队清单', /团队|成员|角色|assignee/i],
                ['关键决策与依据', /关键决策|决策.*依据|为什么.*定|否决|选型|拍板|决策记录/i],
              ]
              const missingFive = FIVE_RE.filter(([label, re]) => !re.test(content)).map(([l]) => l)
              if (missingFive.length > 0) {
                reuseRule += ' **⛔ 续接五件套缺 ' + missingFive.length + ' 项：' + missingFive.join('、') + '（project.md 内容里找不到）——缺项会让新会话/追加成员断层，先补这几项再继续**'
              } else {
                reuseRule += ' ✅ 续接五件套齐全（当前进度/下一步/未决项/团队清单/关键决策与依据都在 project.md 中）——可无缝续接。'
              }
            } else {
              reuseRule += ' **⚠️ 续接五件套核对**：读 project.md 时必找五件套（当前进度/下一步/未决项/团队清单/关键决策与依据），缺哪项先补哪项再继续（五件套缺 = 新会话/追加成员会断层）。'
            }
          }
        } else {
          reuseRule =
            '【无记忆 → 从零开始】本项目 .jarvis/ 不存在或为空：走标准建队流程——需求本质回归 → 定领域流程 → web 查证真实人物原型(存 prototypes/) → 现场蒸馏 CEO 卡(存 cards/) → 定子角色 → 逐个蒸馏 → 协同 → 建队，并把 project.md/lessons 持续更新。'
          verdict = '阶段零判定：项目无记忆 → 从零蒸馏 CEO 起，建立项目记忆库。'
        }
      } else if (mode === 'reuse') {
        const typeName = itemType || '沉淀'
        const isLocal = existingCards && name && existingCards.includes(name)
        if (isLocal) {
          reuseRule = `【本项目沉淀可复用】「${name}」在本项目 .jarvis/cards/ 中（本项目角色做过，经验属于项目）——以它为起点：① 必须过 jarvis_distill 结构校验；② 必须按本次新需求修订（职责范围/领域/约束变了就重新蒸馏对应部分）；③ 修订后作为新版本写回沉淀（保留演进线）。`
          verdict = `复用判定：本项目已有「${name}」沉淀 → 允许复用为起点（须校验+按新需求修订，见 reuseRule）。`
        } else if (existingCards && existingCards.includes('###') === false && !name) {
          reuseRule =
            '【本源自查】未指定 name 且无现有沉淀清单，无法判断来源——请指定角色名/沉淀名再复用，或直接走现场蒸馏。'
          verdict = `复用判定：信息不足，需补 ${typeName} 名称/现有沉淀清单。`
        } else {
          reuseRule =
            '【跨项目/插件禁止】插件不携带任何卡；其他项目的卡也禁止直接复用——每个项目是它自己的角色做的，经验属于那个项目。跨项目要用 = 重新现场 web 蒸馏（jarvis_distill 校验），不许照搬。'
          verdict = `${name || typeName} 不在本项目沉淀清单 → 禁止复用（除非是本项目已沉淀且通过校验+修订），跨项目/外部来源必须重新现场蒸馏。`
        }
      } else if (mode === 'save') {
        // 类型 → 目录/扩展名（规范归档：根只放 project/lesson/process/component，其余按类型入子目录）
        const MD_TYPES = ['card', 'prototype', 'project', 'lesson', 'report', 'design', 'doc']
        const ext = itemType === 'script' ? '.mjs' : MD_TYPES.includes(itemType) ? '.md' : '.json'
        const DIR = {
          card: 'cards/',
          prototype: 'prototypes/',
          report: 'reports/',
          design: 'designs/',
          script: 'scripts/',
          doc: 'docs/',
          process: '', component: '', project: '', lesson: '',
        }
        const dir = DIR[itemType] ?? ''
        savePath = `${projectDir}${dir}${(name || itemType || 'item').replace(/[\\/:*?"<>|]/g, '_')}${ext}`
        reuseRule =
          '写入后即成为本项目记忆库：后续本项目需求直接读取复用（卡须过 jarvis_distill 校验+按新需求修订）；跨项目不共享。'
        verdict = `写入 ${savePath}（项目记忆库，非插件资产；按类型归档到对应子目录，不散在 .jarvis/ 根）——AI 识别到本项目直接读它继续，不用重分析源码。`
        if (itemType === 'lesson') {
          verdict += ' ⚠️ 教训必须过 jarvis_lesson 结构化（分类/主责/现场/修向/状态）再写入，防止自由文本不可检索/不可归因/不可复用。'
        }
      } else {
        reuseRule =
          '插件无静态卡/无领域模板（领域无关）。角色卡与流程只能来自：① 本项目 .jarvis/ 沉淀（可复用起点）；② 现场 web 蒸馏（新需求/跨项目必走）。'
        verdict = `项目沉淀结构就绪：${projectDir} 已初始化（CEO 按结构落盘即可，文件由 CEO/成员在工作区管理）。`
      }
      const storeOut = { structure, reuseRule, verdict }
      if (savePath) storeOut.savePath = savePath
      return storeOut
    },
  },

  {
    name: 'jarvis_lesson',
    description:
      '进度经验结构化器（ws8634 八类问题归档借鉴——防"自由文本教训不可检索/不可归因/不可复用"）：把每条 lessons 教训写成统一结构化条目：分类(category)/主责(owner)/现场标记(scene)/修向(fix)/状态(status)/复现脚本(repro)。机械校验缺项，输出可直接写入 .jarvis/lessons.md 的规范条目。任何教训沉淀前先过本工具，防止"记了就以为解决了/同类问题反复踩"。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'schema=输出结构化字段规范 / validate=校验一条教训文本是否结构化 / entry=从字段渲染规范条目（默认 schema）' },
        lesson: { type: 'string', description: '教训全文（validate 用；应含 分类/主责/现场/修向/状态 标记）' },
        category: { type: 'string', description: '问题分类（ws8634 八类参考：采证/并发/生成质量/假Pass/可达性/状态误标/语法门/其他——领域无关可自定义）' },
        owner: { type: 'string', description: '主责（本仓/环境/用户/并行会话/其他）——防误诊' },
        scene: { type: 'string', description: '现场标记（哪个单/哪个环节/触发场景）' },
        problem: { type: 'string', description: '问题描述（一句话说清踩了什么坑）' },
        fix: { type: 'string', description: '修向（怎么修/改哪里/防复发动作）' },
        status: { type: 'string', description: '状态：open=刚发现/fixed=已修/verified=已验证（防"记了=解决了"）' },
        repro: { type: 'string', description: '复现脚本路径或可重跑命令（可空但强烈建议，ws8634 scripts/ 290 个思路）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string' },
          schema: { type: 'string', description: '结构化字段规范' },
          entry: { type: 'string', description: '可直接写入 lessons.md 的规范条目' },
          missing: { type: 'array', items: { type: 'string' }, description: '缺失字段/标记' },
          verdict: { type: 'string' },
        },
        required: ['mode', 'verdict'],
      },
      render: (r) =>
        `【进度经验结构化 · ${r.mode}】\n${r.schema ? '规范：' + r.schema : ''}${r.entry ? '\n条目：\n' + r.entry : ''}${r.missing?.length ? '\n缺失：' + r.missing.join('、') : ''}\n判定：${r.verdict}`,
    },
    execute: async (args, exec) => {
      const mode = String(args.mode ?? 'schema').trim()
      const schemaText =
        '每条教训必须包含 6 个字段：分类(category)/主责(owner)/现场标记(scene)/修向(fix)/状态(status)/复现脚本(repro)。规范条目格式：\n' +
        '`【教训 · 分类】主责=owner；现场=scene；状态=status；问题=problem；修向=fix；复现=repro`\n' +
        '状态枚举：open / fixed / verified（verified=已验证防复发，否则不许标 closed/完成）。'
      if (mode === 'schema') {
        return { mode, schema: schemaText, verdict: '请按 6 字段结构化沉淀教训；任何教训写入 lessons.md 前先过本工具。' }
      }
      if (mode === 'validate') {
        const lesson = String(args.lesson ?? '').trim()
        if (!lesson) return { mode, missing: ['lesson'], verdict: '未提供教训文本——validate 需要传 lesson。' }
        const required = [
          ['分类', /分类[：:]|category[：:]/i],
          ['主责', /主责[：:]|owner[：:]/i],
          ['现场', /现场[：:]|scene[：:]/i],
          ['修向', /修向[：:]|fix[：:]/i],
          ['状态', /状态[：:]|status[：:]/i],
        ]
        const missing = required.filter(([label, re]) => !re.test(lesson)).map(([label]) => label)
        if (missing.length) return { mode, missing, verdict: `教训未结构化（缺 ${missing.join('、')}）——补全后再沉淀，否则同类问题无法检索/归因/防复发。` }
        const statusOk = /状态[：:]\s*(open|fixed|verified)/i.test(lesson)
        if (!statusOk) return { mode, missing: ['状态枚举'], verdict: '状态必须为 open/fixed/verified（verified=已验证防复发）——不允许"已解决/完成"等模糊状态。' }
        return { mode, missing: [], verdict: '✅ 教训已结构化（分类/主责/现场/修向/状态齐全，状态枚举合法）——可写入 lessons.md。' }
      }
      // mode=entry：从字段渲染规范条目
      const category = String(args.category ?? '').trim()
      const owner = String(args.owner ?? '').trim()
      const scene = String(args.scene ?? '').trim()
      const problem = String(args.problem ?? '').trim()
      const fix = String(args.fix ?? '').trim()
      const status = String(args.status ?? '').trim()
      const repro = String(args.repro ?? '').trim()
      const missing = []
      if (!category) missing.push('category')
      if (!owner) missing.push('owner')
      if (!scene) missing.push('scene')
      if (!problem) missing.push('problem')
      if (!fix) missing.push('fix')
      if (!status) missing.push('status')
      if (!['open', 'fixed', 'verified'].includes(status)) missing.push('status枚举')
      if (missing.length) return { mode, missing, verdict: '字段不全/状态非法——补全后再生成条目。' }
      const entry = `【教训 · ${category}】主责=${owner}；现场=${scene}；状态=${status}；问题=${problem}；修向=${fix}${repro ? `；复现=${repro}` : ''}`
      return { mode, entry, missing: [], verdict: '✅ 条目已生成，可直接追加到 .jarvis/lessons.md。' }
    },
  },

  {
    name: 'jarvis_process',
    description:
      '领域流程设计引导器（CEO 定流程的核心权力）：插件不预设任何领域流程——不同行业"怎么干活"完全不同，必须由 CEO 按本项目需求特性现场设计，可参考本项目沉淀（.jarvis/process-*.json，项目自己做过的流程是经验，可参考但按本次需求修订）。输出必须覆盖五要素：必经阶段 / 验收闸门 / 红线 / 必须角色 / 会议触点。CEO 有权增删阶段（overrideStages）。定稿写入黑板与项目沉淀 .jarvis/process-<需求>.json，kickoff 会全员对齐。铁律：流程缺失 = 客户提 bug 的温床，宁可流程多一步不可少一步；严禁把别的项目流程原样照搬。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '本项目需求原文（流程围绕它设计）' },
        industry: { type: 'string', description: 'CEO 判断的领域（仅供标记，不触发任何预设模板）' },
        projectRef: { type: 'string', description: '本项目沉淀的流程参考（.jarvis/process-*.json 内容或路径；可选，CEO 参考后按本次需求修订，不许原样照搬）' },
        overrideStages: { type: 'string', description: 'CEO 增删阶段：追加用"+阶段名"，删除用"-阶段名"，逗号分隔（可选）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          industry: { type: 'string', description: 'CEO 判断的领域（仅标记）' },
          designChecklist: { type: 'string', description: '五要素设计清单（CEO 必须逐项给出）' },
          stages: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的必经阶段（本工具不预设，仅高管增删占位）' },
          gates: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的验收闸门' },
          redlines: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的红线' },
          mustRoles: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的必须角色' },
          touchpoints: { type: 'array', items: { type: 'string' }, description: 'CEO 定稿的会议触点' },
          customized: { type: 'boolean', description: '恒为 true：流程永远由 CEO 现场定制（插件无领域预设）' },
          verdict: { type: 'string' },
        },
        required: ['stages', 'gates', 'redlines', 'verdict'],
      },
      render: (r) =>
        `【${r.industry || '领域由 CEO 判断'} 流程 · ⚠️ CEO 现场定制（插件无预设）\n设计清单：${r.designChecklist ?? ''}\n阶段：${r.stages.join(' → ')}\n闸门：${r.gates.map((g) => '  ⛔ ' + g).join('\n')}\n红线：${r.redlines.map((x) => '  🚫 ' + x).join('\n')}\n必须角色：${(r.mustRoles || []).join(' / ')}\n会议触点：${(r.touchpoints || []).join(' / ')}`,
    },
    execute: async (args, exec) => {
      const industry = String(args.industry ?? '').trim()
      const req = String(args.requirement ?? '').trim()
      const projectRef = String(args.projectRef ?? '').trim()
      // CEO 增删阶段（overrideStages："+X,-Y"）
      const applyOverride = (stages) => {
        const ov = String(args.overrideStages ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        let out = [...stages]
        for (const o of ov) {
          if (o.startsWith('+')) out.push(o.slice(1).trim())
          else if (o.startsWith('-')) out = out.filter((s) => s !== o.slice(1).trim())
          else out.push(o)
        }
        return out
      }
      const refNote = projectRef
        ? `已提供本项目流程沉淀参考（${projectRef.slice(0, 60)}…）：作为经验参考可以，但必须按本次需求特性修订（领域/规模/约束变了就要改），严禁原样照搬。`
        : '未提供项目流程沉淀——CEO 按本次需求特性从零设计（看完需求本质后逐项给出五要素）。'
      const designChecklist =
        `针对需求「${req.slice(0, 80) || '（需求）'}」逐项设计并给出：① 必经阶段（按执行顺序）；② 每阶段验收闸门（过闸才进下一阶段，"怎样算过"可判定）；③ 本领域红线（一票否决项）；④ 必须进场的角色；⑤ 必须开会的节点。\n${refNote}\n流程定稿后写入黑板（jarvis_board）并沉淀到 <项目>/.jarvis/process-${(industry || '项目').slice(0, 12)}.json，kickoff 会全员对齐。`
      const base = ['需求评审', '方案设计', '开发', '验证', '发布', '复盘']
      return {
        industry: industry || '由 CEO 判断',
        designChecklist,
        stages: applyOverride(base),
        gates: ['CEO 必须亲手定义每阶段闸门（不许缺，缺 = 流程缺失 = 客户提 bug 温床）'],
        redlines: ['流程缺失', '无验证就下结论', '照搬其他项目流程'],
        mustRoles: [],
        touchpoints: ['kickoff 会', '验证闸评审', '收口会'],
        customized: true,
        verdict: `插件不预设领域流程；本工具只给设计清单与占位骨架，CEO 必须按「${industry || '本需求领域'}」的实际特性逐项定稿五要素，并沉淀到项目 .jarvis/。`,
      }
    },
  },

  {
    name: 'jarvis_essence',
    description:
      '需求本质决策校验器（防 LLM 通病"迎合/幻觉"的最后闸门）：任何重要决策/黑板决议/角色产出在定稿前，CEO 用它强制回归需求本质。四查：①回归本质——决策服务"为谁解决什么、怎样算成功"，还是做成了别的；②防迎合——是否迎合用户原话/角色卡/主流方案/会议多数（从众）；③防幻觉——是否编造 source/数据/访谈/案例，把推测写成事实；④真实优先——判断是否基于真实代码/数据/复现。未通过 → 禁止进黑板/发布，打回重做。宁 60 分诚实不要 90 分编造。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '原始需求（必填：本质由此提炼）' },
        decision: { type: 'string', description: '待校验的决策/决议/产出（必填）' },
        rationale: { type: 'string', description: '决策依据/推理（可选）' },
        suspects: { type: 'string', description: 'CEO 怀疑的迎合/幻觉点（可选，供校验重点核查）' },
      },
      required: ['requirement', 'decision'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          essence: { type: 'string', description: '需求本质重述（为谁解决什么/怎样算成功）' },
          checks: { type: 'array', items: { type: 'string' }, description: '四查清单' },
          flattery: { type: 'string', description: '迎合痕迹核查指令' },
          hallucination: { type: 'string', description: '幻觉痕迹核查指令' },
          misalignments: { type: 'string', description: '偏离本质核查指令' },
          verdict: { type: 'string', description: '通过/需修正/打回 判定与门槛' },
          respondAs: { type: 'string', description: '要求输出审计结论的 JSON 结构' },
        },
        required: ['essence', 'verdict'],
      },
      render: (r) =>
        `【需求本质审计】本质=${r.essence}\n四查：${(r.checks ?? []).map((c) => '  🔍 ' + c).join('\n')}\n防迎合：${r.flattery ?? ''}\n防幻觉：${r.hallucination ?? ''}\n偏离检查：${r.misalignments ?? ''}\n判定：${r.verdict}\n审计格式：${r.respondAs ?? ''}`,
    },
    execute: async (args, exec) => {
      const requirement = String(args.requirement ?? '').trim()
      const decision = String(args.decision ?? '').trim()
      const rationale = String(args.rationale ?? '').trim()
      const suspects = String(args.suspects ?? '').trim()
      return {
        essence: `从原始需求「${requirement.slice(0, 120) || '（缺失）'}」重述本质：为谁解决什么问题、怎样算成功（成功标准要可判定：指标/场景/时限）。若需求本身空泛，先补需求本质再审计——不许用"大概、尽量"糊弄。`,
        checks: [
          '本质回归：决策直接服务于上面重述的本质吗？还是在做别的（如把"用户要拼团"做成"平台刷 GMV"）？',
          '防迎合：有没有顺着用户原话/顺着角色卡/顺着主流方案/顺着会议多数（从众）下的结论？',
          '防幻觉：决策里有编造的 source/数据/访谈/案例吗？有把推测当事实写吗？',
          '真实优先：判断依据真实代码/数据/复现/历史了吗？还是凭印象？',
        ],
        flattery: `逐个点名核查迎合嫌疑：① 用户说 A 就顺着 A（哪怕 A 不是真需求）？② 角色卡怎么说就怎么下结论（迎合卡）？③ 主流/模板方案拿来就用（迎合常见答案）？④ 会议里没人反对就默认（从众）？` + (suspects ? `重点核查 CEO 怀疑点：${suspects}` : ''),
        hallucination: `逐句核查幻觉：① source/引用是否真实可查（编造 = 一票否决）；② 数据/数字/案例是否来自真实复现或实证（无出处 = 推测，必须标注）；③ 是否把"我认为"写成"事实"；④ 诚实边界是否声明（信息截止/推测成分）。**防幻觉要"查证痕迹"不要"口头无幻觉"**：对决策里引用的每个关键 source/数据/案例，写清"在哪查的/怎么验证的/查不到则标注'未查证-推测'"——**只写'无幻觉'没给查证痕迹 = 审计走过场 = 不算过**；`,
        misalignments: `列出决策「${decision.slice(0, 120)}」偏离需求本质的所有点；每点写明：本质要什么 vs 决策给了什么。偏离超过 1 点 → 判定为偏离本质，打回重做。`,
        verdict: `判定门槛：四查全过 = 通过（可进黑板/发布）；有迎合或幻觉嫌疑 = 打回重做（宁 60 分诚实不要 90 分编造）；只偏离本质未涉造假 = 需修正后再审。没合格不许定稿。`,
        respondAs: `完成上述审计后以 JSON 输出：{"essence":"本质重述","verdict":"PASS|FIX|REJECT","flattery":["迎合嫌疑点或'无'"],"hallucination":["幻觉嫌疑点或'无'"],"misalignments":["偏离点或'无'"],"decision":"修正后的决策(若 REJECT/FIX 则重写)"}。`,
      }
    },
  },

  {
    name: 'jarvis_board',
    description:
      '统一黑板读写器（会议驱动协作的核心状态）：所有角色的问题/发现/决策/风险/接口变更/阻塞都集中登记在同一块黑板，谁都能看到、谁都能追加。add=新增条目（支持"类型：内容"前缀，类型∈问题/发现/决策/风险/阻塞/接口变更，缺省按内容推断）；resolve=关闭条目（按 id 或内容关键词）。输出未决项/阻塞项，并判定"是否需要二次开会"：存在未解决阻塞或接口变更 → 必开会；未决项≥3 → 建议开会；黑板收敛 → 不开会。',
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: '当前黑板 JSON（items 数组），首次可为空' },
        add: { type: 'string', description: '要登记的新条目；多条用换行分隔；可用"类型：内容"前缀；内容前加[需用户]标记"可能需要用户回答"（内部分析后再判定）' },
        needUser: { type: 'string', description: '标记哪些新条目"可能需要用户回答"（内容关键词，可多行）——内部分析判定用' },
        classify: { type: 'string', description: '内部分析判定 JSON {id或关键词:"internal:引用依据" | "needs_user[:原因]"}"——internal=内部能答(必须带引用依据,引用不出=信息缺口=须问用户)；needs_user=信息缺口须提升到最上层让用户解惑' },
        userAnswer: { type: 'string', description: '用户回答 JSON {id或关键词:"用户答案"}——最上层沟通后写回，标 resolved(用户已解惑=闭环)' },
        resolve: { type: 'string', description: '要关闭的条目：id（如 B1）或内容关键词；多条用换行分隔' },
        audited: { type: 'string', description: '已过 jarvis_essence 需求本质审计的决策条目（id 或内容关键词）；多条用换行分隔' },
        role: { type: 'string', description: '登记人角色（默认 ?）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '更新后的全部黑板条目' },
          openItems: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '未决项' },
          blockers: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '未解决的阻塞/接口变更' },
          needsMeeting: { type: 'boolean', description: '是否建议二次开会' },
          reason: { type: 'string', description: '二次开会判定理由' },
          summary: { type: 'string' },
          openResources: { type: 'array', description: '未闭环的资源需求条目（依赖它们的任务不得标记完成）' },
          resourceBlockNote: { type: 'string', description: '资源未闭环提示（有 open 资源需求时输出）' },
          resolvedItems: { type: 'array', description: '已解决条目（历史——主展示不含，需要时查看）' },
          needsUserItems: { type: 'array', description: '待用户回答条目（内部分析判定 needs_user 的信息缺口——最上层与用户沟通的候选，用户回答后 resolve）' },
        },
        required: ['items', 'needsMeeting'],
      },
      render: (r) =>
        // 只展示未解决（open）条目；已解决(resolved)进历史不占主面板——用户要求"未解决的展示、已解决的不展示(历史里)"
        `黑板：${r.openItems.length} 项未解决（${r.blockers.length ? '含阻塞 ' + r.blockers.length + ' 项，' : ''}历史已解决 ${(r.items?.length || 0) - (r.openItems?.length || 0)} 项）\n${(r.openItems || [])
          .map((i) => `  [${i.id}][${i.type}] ${i.role}: ${i.content}`)
          .join('\n') || '  （无未解决项——黑板收敛）'}\n二次会判定：${r.needsMeeting ? '⚠️ ' + r.reason : '✅ ' + r.reason}`,
    },
    execute: async (args, exec) => {
      const role = String(args.role ?? '?').trim() || '?'
      const fsSvc = (() => {
        try { return getFsService(exec) } catch { return null }
      })()
      // 真源：磁盘 .jarvis/board.json（项目级公屏）。board 参数仅作无 fs 环境（如单测）的显式回退。
      const disk = await readBoardItems(fsSvc)
      const items = disk.fromDisk ? disk.items : []
      try {
        const p = JSON.parse(String(args.board ?? '{}'))
        if (p && Array.isArray(p.items)) for (const it of p.items) items.push({ ...it })
      } catch {
        /* 新黑板 */
      }
      // add：新增条目（ID 从磁盘真源取 max 单调递增，修复并发撞 ID）
      const adds = String(args.add ?? '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const raw of adds) {
        let type = '', content = raw
        const m = raw.match(/^\s*(问题|发现|决策|风险|阻塞|接口变更|资源需求)\s*[:：|]\s*(.+)$/)
        if (m) {
          type = m[1]
          content = m[2]
        } else {
          // 按内容推断类型（资源需求优先：角色需要资源必须先上黑板，防幻觉跳过步骤）
          if (/需要|缺少|缺|无.*(资源|数据|文件|权限|API|素材|工具|账号|密钥|接口文档|样例|数据源|凭证|配置)/.test(content) || /资源|数据源|凭证|配置|密钥/.test(content)) type = '资源需求'
          else if (/阻塞|卡住|无法(继续|进行)|pending/.test(content)) type = '阻塞'
          else if (/接口|契约|字段|协议/.test(content)) type = '接口变更'
          else if (/决定|选择|拍板|方案是/.test(content)) type = '决策'
          else if (/风险|担心|隐患/.test(content)) type = '风险'
          else if (/发现|实测|验证|复现/.test(content)) type = '发现'
          else type = '问题'
        }
        // 是否需要用户回答（内部分析判定：needUser 参数标'需要用户'的条目，或内容带 [需用户] 前缀）
        const needUserFlag = String(args.needUser ?? '')
          .split(/\n/)
          .map((x) => x.trim())
          .filter(Boolean)
        const isNeedUser = needUserFlag.some((x) => items.some((it) => it.content.includes(x))) || /^\[需用户\]/.test(content)
        if (/^\[需用户\]/.test(content)) content = content.replace(/^\[需用户\]\s*/, '')
        items.push({ id: nextBoardId(items), role, type, content, status: 'open', answerNeeded: isNeedUser ? 'needs_user' : 'unknown', essenceChecked: type === '决策' ? false : true, time: new Date().toISOString().slice(0, 16) })
      }
      // resolve：关闭条目（按 id 或内容关键词）
      const resolves = String(args.resolve ?? '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const rk of resolves) {
        const target = items.find((it) => it.status === 'open' && (it.id === rk || it.content.includes(rk)))
        if (target) target.status = 'resolved'
      }
      // classify：内部分析判定"是否需要用户回答"（B15 固化为 board 状态）——
      //   internal_answer=内部能答（必须带引用依据，引用不出=信息缺口=须问用户）；
      //   needs_user=信息缺口，须提升到最上层让用户解惑
      const classify = String(args.classify ?? '').trim()
      if (classify) {
        let cj = null
        try { cj = JSON.parse(classify) } catch { cj = null }
        if (cj && typeof cj === 'object') {
          for (const [idOrKey, verdict] of Object.entries(cj)) {
            const target = items.find((it) => it.status === 'open' && (it.id === idOrKey || it.content.includes(idOrKey)))
            if (!target) continue
            const v = String(verdict ?? '').trim()
            if (v.startsWith('internal:')) {
              // 内部能答：必须带引用依据（哪份文档哪节/黑板哪条/哪次实测）
              const ref = v.slice('internal:'.length).trim()
              if (!ref || ref.length < 3) target.answerNeeded = 'needs_user' // 引用不出=信息缺口=须问用户
              else { target.answerNeeded = 'internal_answer'; target.internalAnswer = ref }
            } else if (v === 'needs_user' || v.startsWith('needs_user:')) {
              target.answerNeeded = 'needs_user'
              const why = v.slice('needs_user'.length).replace(/^:/, '').trim()
              if (why) target.needUserReason = why
            }
          }
        }
      }
      // userAnswer：用户回答写回（最上层沟通后）——标 resolved（用户已解惑）
      const userAnswer = String(args.userAnswer ?? '').trim()
      if (userAnswer) {
        let ua = null
        try { ua = JSON.parse(userAnswer) } catch { ua = null }
        if (ua && typeof ua === 'object') {
          for (const [idOrKey, answer] of Object.entries(ua)) {
            const target = items.find((it) => it.id === idOrKey || it.content.includes(idOrKey))
            if (!target) continue
            target.userAnswer = String(answer ?? '')
            target.answeredAt = new Date().toISOString().slice(0, 16)
            target.status = 'resolved' // 用户已解惑=闭环
            target.answerNeeded = 'user_answered'
          }
        }
      }
      // audited：标记已过 jarvis_essence 审计的决策条目
      const audited = String(args.audited ?? '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const ak of audited) {
        const target = items.find((it) => it.type === '决策' && (it.id === ak || it.content.includes(ak)))
        if (target) target.essenceChecked = true
      }
      const openItems = items.filter((i) => i.status === 'open')
      const blockers = openItems.filter((i) => i.type === '阻塞' || i.type === '接口变更')
      // 决策条目必须过 jarvis_essence 需求本质校验才能定稿（防迎合/防幻觉闸门）
      const decisions = items.filter((i) => i.type === '决策' && !!i.essenceChecked === false)
      // 开会判定统一走 state/meetings.js（单一事实源）：不再在黑板工具里手写第二份口径
      const projDir = resolveWorkspace(getRuntimeContext(), exec) || ''
      const mpolicy = meetingPolicy(projDir || '.', _require('node:path'), { boardItems: items })
      const needsMeeting = mpolicy.required.length > 0
      const reason = needsMeeting
        ? mpolicy.required.map((r) => `${r.type}：${r.why}`).join('；')
        : mpolicy.noMeetingReason || `黑板收敛（未决 ${openItems.length} 项，无阻塞）——暂不需要二次会，继续独自思考/干活，有新问题随时写黑板`
      const essenceNote = decisions.length ? `；⚠️ ${decisions.length} 条决策条目未过 jarvis_essence 需求本质校验，定稿前必须审计（防迎合/防幻觉）` : ''
      const summary = `未决 ${openItems.length} 项；阻塞 ${blockers.length} 项${blockers.length ? '：' + blockers.map((b) => b.id + '(' + b.content.slice(0, 20) + ')').join(', ') : ''}。${reason}${essenceNote}`
      // 写回磁盘（项目级公屏持久化）。成功=真源已更新；失败=本次仅内存返回（下次调用仍以磁盘为准，不伪造持久化）
      // 状态根守卫：插件仓库不写 .jarvis/board.json（防记忆文件污染插件项目）
      const boardConflict = stateRootConflict(resolveWorkspace(getRuntimeContext(), exec))
      const persisted = boardConflict ? { ok: false, error: boardConflict.error } : await writeBoardItems(fsSvc, items, disk.version)
      // 事件流（UI 时间轴数据源）：黑板真落盘才记，失败不记（不造"看起来发生了"的事件）
      if (persisted.ok && projDir) {
        try { appendEvent(projDir, 'board', { open: openItems.length, blockers: blockers.map((b) => b.id) }) } catch { /* 事件不阻断 */ }
      }
      // 资源闭环检查（代码级归一化：有 open 的资源需求 = 未闭环 = 相关任务不得标记完成——压缩不丢）
      const openResources = items.filter((i) => i.type === '资源需求' && i.status === 'open')
      const resourceBlockNote = openResources.length
        ? ('；⚠️ ' + openResources.length + ' 条资源需求未闭环（' + openResources.map((r) => r.id + '[' + r.content.slice(0, 24) + ']').join(', ') + '）——依赖这些资源的任务不得标记完成：CEO 分配/上报用户（只有客户能给的→问客户要）→ 提供后 resolve 闭环；资源未到前做不依赖它的任务，不许幻觉跳过/假装有')
        : ''
      const out = { items, openItems, blockers, needsMeeting, reason, summary: summary + resourceBlockNote, openResources, resourceBlockNote: resourceBlockNote.trim() || undefined }
      // 用户要求"未解决的展示、已解决的不展示(历史信息里面)"——resolved 条目归入历史
      out.resolvedItems = items.filter((i) => i.status === 'resolved')
      // 待用户回答清单（内部分析判定 needs_user 的条目——最上层与用户沟通的候选）
      out.needsUserItems = items.filter((i) => i.answerNeeded === 'needs_user')
      if (fsSvc && typeof fsSvc.readText === 'function' && typeof fsSvc.writeText === 'function') {
        out.persisted = persisted.ok
        out.storage = persisted.ok ? '.jarvis/board.json' : undefined
        if (!persisted.ok) out.writeError = persisted.error
      }
      return out
    },
  },

  {
    name: 'jarvis_snapshot',
    description:
      '会话快照（防"工作记忆丢失"——scan 教训：project.md 停在 10-19，会话跑到 10-31，12 天工作全在上下文里，一压缩/换会话就没了）。把当前公司状态 + 团队未完成任务 + 记忆文件新鲜度写进 <项目>/.jarvis/sessions/<会话id>-<时间>.json，作为可追溯的工作快照。建议在每个阶段完成、收口前、长会话中等关键节点调用。',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: '本次快照备注（如"阶段X完成"）' },
        projectDir: { type: 'string', description: '项目目录（缺省=当前会话工作区）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          written: { type: 'string' },
          memoryAgeHours: { type: 'number' },
          openTasks: { type: 'number' },
          verdict: { type: 'string' },
        },
        required: ['written', 'verdict'],
      },
      render: (r) => `会话快照：${r.written}\n记忆已 ${r.memoryAgeHours} 小时未更新 · 未完成任务 ${r.openTasks} 条\n${r.verdict}`,
    },
    execute: async (args, exec) => {
      const path = _require('node:path')
      const fs = _require('node:fs')
      const projectDir = String(args?.projectDir ?? '').trim() || resolveWorkspace(getRuntimeContext(), exec) || '.'
      // 状态根守卫：插件仓库不写 .jarvis（防记忆文件污染插件项目）
      const conflict = stateRootConflict(projectDir)
      if (conflict) return { written: '', memoryAgeHours: 0, openTasks: 0, verdict: `⛔ ${conflict.message}` }
      const sid = (() => { try { return String(exec?.agent?.session?.id || 'unknown') } catch { return 'unknown' } })()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dir = path.join(projectDir, '.jarvis/sessions')
      fs.mkdirSync(dir, { recursive: true })
      const out = path.join(dir, `${sid}-${stamp}.json`)
      const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(projectDir, rel), 'utf8')) } catch { return null } }
      const company = readJson('.jarvis/company-state.json')
      const mem = _memoryState(projectDir)
      let openTasks = []
      try {
        const teamsDir = path.join(projectDir, '.agent-teams')
        for (const t of fs.readdirSync(teamsDir)) {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(teamsDir, t, 'team.json'), 'utf8'))
            for (const task of d.tasks || []) {
              if (['completed', 'cancelled'].includes(String(task.status))) continue
              openTasks.push({ team: d.name || t, id: task.id, status: task.status, assignee: task.assignee, subject: String(task.subject || '').slice(0, 100) })
            }
          } catch {}
        }
      } catch {}
      const payload = {
        sessionId: sid,
        savedAt: new Date().toISOString(),
        note: String(args?.note || ''),
        memory: mem,
        company: company || null,
        openTasks,
        openTaskCount: openTasks.length,
      }
      fs.writeFileSync(out, JSON.stringify(payload, null, 2))
      return {
        written: out,
        memoryAgeHours: Math.round((mem.ageMs / 3600000) * 10) / 10,
        openTasks: openTasks.length,
        verdict: mem.ageMs > 6 * 3600000
          ? '⚠️ 快照已存，但工作记忆（project.md/board.json）已超过 6 小时未更新——请尽快把进度写回 project.md，否则换会话仍会丢。'
          : '✅ 快照已存，记忆新鲜度正常。',
      }
    },
  },
]
