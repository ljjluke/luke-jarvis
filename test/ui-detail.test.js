/** 增强 UI「看得懂做了什么」回归测试（用户实测 2026-11-19）。
 *
 *  用户原话：
 *    · 「像模式显示的信息描述太短了，看不明白到底干了什么，无法判断有用无用」
 *    · 「点开的详情页也是空的」
 *
 *  根因链（三条，全部在本次修掉）：
 *    1. web 服务重启后 agents.list() 为空 → 前端拿不到 workspace → 全部接口 no workspace
 *       → 页面只剩空壳（看起来像「详情页是空的」）
 *    2. 子会话 digest 只保留一条 lastText → 详情页无内容可展开
 *    3. 详情行只有任务名 + 一句 20 字概括 → 老板判断不出工作有没有用
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const pluginSrc = fs.readFileSync(new URL('../src/host/plugin.js', import.meta.url), 'utf8')
const snapSrc = fs.readFileSync(new URL('../src/host/state/snapshot.js', import.meta.url), 'utf8')
const uiSrc = fs.readFileSync(new URL('../webui/jarvis-v2-wings.html', import.meta.url), 'utf8')

// ── 根因 1：重启后没有 live 会话，必须能从磁盘推断工作区 ─────────────
test('工作区解析：live 会话为空时，回退到「最近有活动的磁盘会话」', () => {
  assert.ok(/function lastActiveSessionCwd\(\)/.test(pluginSrc), '应有磁盘兜底函数')
  assert.ok(/const disk = lastActiveSessionCwd\(\)/.test(pluginSrc), 'requestWorkspace 必须尝试磁盘兜底')
  // 兜底必须在 firstSessionCwd 之后（live 优先，磁盘其次）
  const liveIdx = pluginSrc.indexOf('const live = firstSessionCwd(ctx)')
  const diskIdx = pluginSrc.indexOf('const disk = lastActiveSessionCwd()')
  assert.ok(liveIdx > 0 && diskIdx > liveIdx, '必须先信 live 会话，再退磁盘（' + liveIdx + ' → ' + diskIdx + '）')
  // 磁盘兜底同样只认「存在且已建队」的目录（不能把任意目录当工作区）
  const diskFn = pluginSrc.slice(diskIdx, pluginSrc.indexOf('function cwdOfSession', diskIdx) > 0 ? pluginSrc.indexOf('function cwdOfSession', diskIdx) : diskIdx + 6000)
  assert.ok(/\.agent-teams/.test(diskFn), '磁盘兜底也要做目录白名单校验')
  assert.ok(/_diskWsCache/.test(pluginSrc), '磁盘兜底要有缓存（避免每请求扫盘）')
})

// ── 根因 2：digest 必须提供详情页需要的多维素材 ─────────────────────
test('子会话 digest 提取：派活原文 / 叙述轨 / 读过的材料 / 行动轨迹', () => {
  assert.ok(/brief: ''/.test(snapSrc), 'digest 要有 brief 字段（它接到的任务书）')
  assert.ok(/agent\/inbox\/spliced/.test(snapSrc), 'brief 必须从 next-turn 派活事件里取（不是开场白）')
  assert.ok(/trail: \[\]/.test(snapSrc), 'digest 要有 trail 字段（每步做了什么）')
  assert.ok(/texts: \[\]/.test(snapSrc), 'digest 要有 texts 字段（过程叙述）')
  assert.ok(/reads: \[\]/.test(snapSrc), 'digest 要有 reads 字段（核对过哪些材料）')
  assert.ok(/function describeCmd\(/.test(snapSrc), 'bash 命令要压成可读的一句话')
  assert.ok(/function describeArg\(/.test(snapSrc), 'write/read 工具的参数要压成可读的一句话')
  // 轨迹不能被 outputs 的上限吃掉——它是独立的、始终记录的
  const trailBlock = snapSrc.slice(snapSrc.indexOf('// 行动轨迹'), snapSrc.indexOf('if (out.outputs.length < 8)'))
  assert.ok(/out\.trail\.push/.test(trailBlock), 'trail 必须在 outputs 上限之外记录')
  // 工作目录切换也要处理（CEO 常从 A 建会话、去 B 干活）
  assert.ok(/working-directory\/change/.test(snapSrc), '必须记录工作目录变更')
  assert.ok(/dirs: Array.isArray\(digest\.dirs\)/.test(snapSrc), '实际工作目录要吐到 items 里')
})

test('命令解析质量：不把 shell 语法当文件名', () => {
  // 用真实命令反例（都来自实测转录），防止退回「写入 &1; echo」「检索 -m1」「写入 null」
  const bad = [/2>&1/, /\/dev\/null/, /\$1/, /<<\s*'EOF'/]
  // describeCmd 必须只认「像文件名」的目标
  assert.ok(/looksLikeFile/.test(snapSrc), '必须用 looksLikeFile 判定产物目标')
  assert.ok(/(md\|json\|mjs\|sh\|ts\|js\|txt\|log\|csv)/.test(snapSrc), 'looksLikeFile 要覆盖常见扩展名')
  // 必须按命令段切分（避免 A 段参数被 B 段正则误判——`cat 证据/host-*.json` 曾被判成 `ls`）
  assert.ok(/raw\.split\(\/\[;\]\|&&\|\\\|\\\|\|\\\|\/\)/.test(snapSrc), '必须按 ; && || | 切分指令段')
  // 段内必须跳过 cd 前缀（切目录不算「做了什么」）
  assert.ok(/if \(\/\^cd\\s\+\/\.test\(s\)\) return null/.test(snapSrc), 'cd 段不应算作动作')
  void bad
})

// ── 根因 3：UI 详情行必须给出可判断的硬事实 ─────────────────────────
test('详情行：接的活 / 做了什么 / 交出的东西 三栏齐全', () => {
  assert.ok(/main:'接的活'/.test(uiSrc), '详情要有「接的活」')
  assert.ok(/main:'做了什么'/.test(uiSrc), '详情要有「做了什么」')
  assert.ok(/main:'交出的东西'/.test(uiSrc), '详情要有「交出的东西」')
  assert.ok(/main:'动用的手段'/.test(uiSrc), '详情要有「动用的手段」')
  // 渲染端必须支持 deep（可展开明细），否则 detailRows 白算
  assert.ok(/r\.deep/.test(uiSrc), 'showDetail 必须渲染 r.deep')
  assert.ok(/\.detail-deep\{/.test(uiSrc), '必须有 .detail-deep 样式（否则挤成一团）')
})

test('描述不再只有一句话：主屏 copy 与详情 sub 都要够长', () => {
  // describe 的兜底链：汇报正文(220) > 产出+工具 > 工具+片段 > 160 字截断
  assert.ok(/clipRaw\(txt,220\)/.test(uiSrc), '有汇报时至少给 220 字')
  assert.ok(/clipRaw\(txt,160\)/.test(uiSrc), '没有汇报时的兜底也不能短于 160')
  assert.ok(/阶段说明/.test(uiSrc), '详情要有阶段说明（多段叙述，不是一句）')
  assert.ok(/slice\(-2\)/.test(uiSrc), '阶段说明要取最近多段（不是只取最后一条）')
})

test('派活原文要剥掉角色套话；没有任务段时不拿约束条件冒充任务', () => {
  // 「你是修复岗「fix-contract」（角色卡：…，先读；…）。你只改指定文件域。」→ 应返回空
  assert.ok(/（\[^）\]\{0,400\}）/ .test(uiSrc) || /[（][^）]{0,400}[）]/.test(uiSrc), '角色卡括号必须整段剥除（括号内可能含句号/分号）')
  assert.ok(/你只\|只改\|不要\|禁止/.test(uiSrc), '剥完只剩约束句时应判为空')
  assert.ok(/你的文件域/.test(uiSrc), '到「你的文件域」小标题处截断（执行细节不占首行）')
})

// ── 不变量：性能与安全 ─────────────────────────────────────────────
test('磁盘兜底不读全文：只解压会话第一行', () => {
  const block = pluginSrc.slice(pluginSrc.indexOf('function lastActiveSessionCwd()'))
  assert.ok(/head -n 1/.test(block), '只读会话头（zstdcat | head -1），不能解压整个转录')
  assert.ok(/timeout: 3000/.test(block), '必须有超时（坏文件不能挂住请求）')
  assert.ok(/\.slice\(0, 5\)/.test(block), '最多检查 5 个候选目录（不能全盘扫）')
  // 只在真宿主里启用：否则测试环境会被本机真实会话目录污染，
  // 「没有工作区」这条事实永远报不出来（实测捕获过这个副作用）。
  assert.ok(/base === 'dsh'/.test(block), '磁盘兜底必须只在宿主进程（argv[1] basename=dsh）生效')
  // 新鲜度门槛：几天前的历史会话不该冒充「当前工作区」
  assert.ok(/DISK_WS_RECENT_MS/.test(block), '必须有新鲜度门槛')
})
