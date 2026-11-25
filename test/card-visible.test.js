/** 蒸馏角色卡可见性回归测试（v0.20）。
 *
 *  用户实测（2026-11-25）：「升级最新版后，/jarvis xxx 这样调用，都没有看到子任务的蒸馏角色」。
 *
 *  排查结论（已核实）：
 *    ① /jarvis 命令正常（plugin.js:77 返回 5 步指令文本），不是它的问题
 *    ② 37 个 jarvis_* 工具全部注册（/api/jarvis/tools 实测）
 *    ③ profile 与源仓库同 inode（硬链接有效），v0.15.3，代码是最新的
 *    ④ 服务进程启动时间(15:21:44) 晚于代码修改(15:21:27) → 重启过了
 *    → 真正根因：**工作区没有 .jarvis/cards/**，角色卡缺失时：
 *        - jarvis_member_brief 仍返回 6000+ 字通用模板（cardMissing=true 只在返回字段里）
 *        - brief 正文的"⛔ 你没有角色卡"警告埋在 6000 字中段，谁都看不到
 *        - jarvis_ticket open 缺卡照样派活 → 成员凭默认思路干
 *      表现就是"看不到子任务的蒸馏角色"。
 *
 *  本测试锁定修复后的三条不变量：警告前置、verdict 首句可见、派活机械拦截。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const reviewSrc = fs.readFileSync(new URL('../src/host/tools/review.js', import.meta.url), 'utf8')
const deliverSrc = fs.readFileSync(new URL('../src/host/tools/deliver.js', import.meta.url), 'utf8')

// ── ① 警告必须前置（不能埋在正文中段）────────────────────────────
test('jarvis_member_brief：缺卡警告必须出现在 brief 最顶部', () => {
  assert.ok(/noCardBanner/.test(reviewSrc), '应有独立的缺卡横幅变量')
  // banner 必须插在 brief 数组的靠前位置（JARVIS_CULTURE 之前）
  const briefStart = reviewSrc.indexOf('const brief = [')
  const bannerIdx = reviewSrc.indexOf('noCardBanner,', briefStart)
  const cultureIdx = reviewSrc.indexOf('JARVIS_CULTURE,', briefStart)
  assert.ok(briefIdxOk(bannerIdx, cultureIdx), '缺卡横幅必须在 culture 段之前（两者都在 brief 数组内）')
  function briefIdxOk(b, c) { return b > briefStart && c > briefStart && b < c }
  // 横幅必须含可执行的三步
  assert.ok(/jarvis_distill_guide/.test(reviewSrc.slice(reviewSrc.indexOf('noCardBanner'), reviewSrc.indexOf('noCardBanner') + 1400)), '横幅要给出蒸馏第一步')
  assert.ok(/jarvis_store/.test(reviewSrc.slice(reviewSrc.indexOf('noCardBanner'), reviewSrc.indexOf('noCardBanner') + 1400)), '横幅要给出落卡命令')
})

test('jarvis_member_brief：缺卡时 verdict 第一句就报出来', () => {
  // 调用方常只读 verdict 不读 brief 正文——所以 verdict 必须区分有卡/无卡
  const verdictBlock = reviewSrc.slice(reviewSrc.indexOf('verdict: card'), reviewSrc.indexOf('verdict: card') + 1200)
  assert.ok(verdictBlock.length > 0, 'verdict 应按 card 是否存在分两种文案')
  assert.ok(/⛔/.test(verdictBlock), '缺卡分支必须用醒目符号开头')
  assert.ok(/该角色没有角色卡/.test(verdictBlock), '缺卡分支必须明说没有角色卡')
  assert.ok(/先蒸馏/.test(verdictBlock), '缺卡分支必须指明下一步')
  // 有卡分支应显示卡路径
  assert.ok(/角色卡：\$\{card\.relPath\}/.test(verdictBlock), '有卡时应显示卡路径（让调用方确认用的是哪张卡）')
})

// ── ② 派活必须机械拦截 ────────────────────────────────────────────
test('jarvis_ticket open：缺卡角色拒绝派活（不是静默降级成通用模板）', () => {
  assert.ok(/缺卡拦截/.test(deliverSrc), '应有明确的缺卡拦截代码块')
  assert.ok(/没有蒸馏角色卡，拒绝派活/.test(deliverSrc), '拒绝文案要写清原因')
  assert.ok(/targetRole !== 'captain'/.test(deliverSrc), 'captain 自己接活不需要卡（它是调度者）')
  assert.ok(/allowNoCard/.test(deliverSrc), '必须留一个显式跳过开关（防流程死锁）')
  // 拦截必须在开单之前——不能在派完再检查
  const guardIdx = deliverSrc.indexOf('缺卡拦截')
  const openIdx = deliverSrc.indexOf("const out = action === 'adjudicate'")
  assert.ok(guardIdx > 0 && openIdx > guardIdx, `拦截(${guardIdx}) 必须在开单(${openIdx}) 之前`)
})

test('缺卡拦截：卡片匹配要宽容（允许 岗位名 与 卡文件名 互相包含）', () => {
  const block = deliverSrc.slice(deliverSrc.indexOf('缺卡拦截'), deliverSrc.indexOf('缺卡拦截') + 1800)
  assert.ok(/base === targetRole/.test(block), '精确同名应命中')
  assert.ok(/base\.includes\(targetRole\)/.test(block), '卡名含角色名应命中（如「健壮性审计.md」vs「审计」）')
  assert.ok(/targetRole\.includes\(base\)/.test(block), '角色名含卡名也应命中（双向包含，避免误拦）')
  assert.ok(/\.replace\(\/\\\.md\$\/i/.test(block) || /\.md\$/i.test(block), '要剥掉 .md 后缀再比')
})

// ── ③ 不破坏既有行为 ──────────────────────────────────────────────
test('警告与拦截都不影响「有卡」的正常流程', () => {
  // banner 只在 card 为空时生成
  assert.ok(/card \? '' : \[/.test(reviewSrc), '横幅必须是条件生成（有卡时为空）')
  // 拦截只在角色非 captain 且未显式跳过时生效
  assert.ok(/!Boolean\(args\?\.allowNoCard\)/.test(deliverSrc), '默认要拦，但显式开关可跳过')
  // 异常不能阻断开单（宁可放过也不要死锁）
  assert.ok(/卡片检查异常不阻断开单/.test(deliverSrc), '卡片检查抛错时应放行，防流程死锁')
})

test('缺卡拦截文案含完整蒸馏三步链', () => {
  const block = deliverSrc.slice(deliverSrc.indexOf('没有蒸馏角色卡，拒绝派活'), deliverSrc.indexOf('没有蒸馏角色卡，拒绝派活') + 1200)
  for (const step of ['jarvis_distill_guide', 'jarvis_distill', 'jarvis_store']) {
    assert.ok(block.includes(step), `拒绝文案必须含 ${step}`)
  }
  assert.ok(/\.jarvis\/cards\//.test(block), '要指明卡片落盘位置')
})
