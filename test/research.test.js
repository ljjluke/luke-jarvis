/** 外部查证纪律回归测试（v0.19）。
 *
 *  用户定调（2026-11-25）：
 *    ① 「jarvis 一定要少用模型内的资料，需要去互联网上查资料得结论」
 *    ② 「不要固定死用哪些工具，万一后面有更好的呢？」
 *
 *  实测结论（部署前已核实）：
 *    · 宿主 tools 层已有 web_search / web_fetch（dsh-tool-web，已挂在成员预设）。
 *    · 背后 provider 由 dsh-free-search 插件提供：
 *        search → id "ddg"，5 个中文引擎（baidu-html/so360/sogou/wechat/toutiao），无需 key
 *        fetch  → 注册 fs-quality-fetch，插件会自动接管为 "http"
 *      实测 so360 查询「deepseek harness」返回真实 sources（标题+URL+摘要）。
 *    · 服务器可用 curl 直接抓 bing（200/104KB），所以命令行也是有效的兜底通道。
 *    → 真正的问题不是"没有检索能力"，而是"成员不知道自己有、也没被要求用"。
 *
 *  本测试锁定：① 纪律文本覆盖所有档位 ② 判据按能力不按工具名 ③ 降级必须留痕。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  PONDER_TIER, tierGuidance, EXTERNAL_RESEARCH, EXTERNAL_RESEARCH_MARK,
  isExternalResearchCall, TIER_MARK,
} from '../src/host/protocol/deliberation.js'

// ── 纪律覆盖所有档位 ───────────────────────────────────────────────
test('外部查证纪律对所有档位生效（查证不分赌注高低）', () => {
  for (const t of [PONDER_TIER.EASY, PONDER_TIER.STANDARD, PONDER_TIER.COMPLEX]) {
    const g = tierGuidance(t)
    assert.ok(/外部查证纪律/.test(g), `${t} 档必须带外部查证纪律`)
    assert.ok(/不要预设工具名/.test(g), `${t} 档必须写明不绑定工具名`)
    assert.ok(/受限环境推演/.test(g), `${t} 档必须给出降级标注方式`)
    assert.ok(/本地文件搜索[^\n]{0,40}不算外部查证/.test(g), `${t} 档必须区分本地搜索`)
  }
})

test('纪律四要素齐全：探测能力 / 报来源 / 外部优先 / 禁止编造', () => {
  assert.ok(/先探测能力/.test(EXTERNAL_RESEARCH), '① 必须先探测环境有哪些手段')
  assert.ok(/来源在哪/.test(EXTERNAL_RESEARCH), '② 必须报来源')
  assert.ok(/以查到的为准/.test(EXTERNAL_RESEARCH), '③ 冲突时以外部分为准')
  assert.ok(/禁止/.test(EXTERNAL_RESEARCH) && /编造/.test(EXTERNAL_RESEARCH), '④ 必须禁止编造')
  assert.ok(/模型记忆/.test(EXTERNAL_RESEARCH), '必须明说"少用模型记忆"')
})

test('EXTERNAL_RESEARCH_MARK 能识别纪律文本，不误报', () => {
  assert.ok(EXTERNAL_RESEARCH_MARK.test(EXTERNAL_RESEARCH), '应识别自身')
  assert.ok(!EXTERNAL_RESEARCH_MARK.test('随便写点什么'), '无关文本不应误报')
})

// ── 判据：按能力不按工具名（用户第二条要求）──────────────────────────
test('isExternalResearchCall：按能力特征判定，不依赖具体工具名', () => {
  // 检索类：各种可能的命名都认
  for (const n of ['web_search', 'search_web', 'websearch', 'search', '检索']) {
    assert.ok(isExternalResearchCall(n, '{"query":"x"}'), `${n} 应判为外部查证`)
  }
  // 抓取类
  for (const n of ['web_fetch', 'fetch_web', 'fetch', 'crawl', 'browse']) {
    assert.ok(isExternalResearchCall(n, '{"url":"https://x"}'), `${n} 应判为外部查证`)
  }
  // 命令行联网：命令里出现 curl/wget/http
  assert.ok(isExternalResearchCall('bash', '{"command":"curl -s https://api.github.com"}'), 'curl 应算')
  assert.ok(isExternalResearchCall('bash', '{"command":"wget https://x"}'), 'wget 应算')
  assert.ok(isExternalResearchCall('bash', '{"command":"curl https://x"}'), 'http 访问应算')
})

test('isExternalResearchCall：本地搜索不算外部查证（用户明确区分）', () => {
  assert.ok(!isExternalResearchCall('fs_search', '{"pattern":"foo"}'), '本地文件搜索不算')
  assert.ok(!isExternalResearchCall('glob', '{"pattern":"**/*.js"}'), 'glob 不算')
  assert.ok(!isExternalResearchCall('bash', '{"command":"ls -la"}'), '纯本地命令不算')
  assert.ok(!isExternalResearchCall('bash', '{"command":"grep foo src/"}'), '本地 grep 不算')
})

test('判据对未来新工具是开放的（不在名单里但带外网特征也能认）', () => {
  // 用户第二条要求的核心：将来有更好的工具，不该因为"不在名单里"就判成没查
  assert.ok(isExternalResearchCall('my_custom_researcher', '{"q":"x"}') === false,
    '纯自定义名若无线索则不误判（保守）')
  // 但只要具备外网特征就应认——通过抓取/检索关键词匹配
  assert.ok(isExternalResearchCall('custom_web_search_v2', '{"q":"x"}'), '名字含 web_search 变体应认')
})

// ── 注入完整性：执行器必须把纪律带给成员 ───────────────────────────
test('执行器 memberBrief 确实按档位注入（纪律随档位进入简报）', () => {
  const src = fs.readFileSync(new URL('../src/host/adapters/dsh-executor.js', import.meta.url), 'utf8')
  assert.ok(/tierGuidance\(tier\)/.test(src), '必须调用 tierGuidance')
  assert.ok(/ponderTierOf/.test(src), '必须按任务单判定档位')
  // 续接线索与 STATUS.md 也要带（压缩后不能忘）
  const resume = src.slice(src.indexOf('function memberResumeHint'), src.indexOf('function memberResumeHint') + 2600)
  assert.ok(/外部查证/.test(resume), '续接线索必须提示外部查证要求')
  const status = src.slice(src.indexOf('function autoWriteStatus'), src.indexOf('function autoWriteStatus') + 2600)
  assert.ok(/外部查证/.test(status), '自动 STATUS.md 必须记录外部查证要求（失忆后唯一的锚点）')
})

// ── 与既有纪律不冲突 ──────────────────────────────────────────────
test('外部查证纪律不破坏既有的 ponder/阶段/卡点三条要求', () => {
  const g = tierGuidance(PONDER_TIER.STANDARD)
  assert.ok(TIER_MARK.test(g), '档位标记仍应存在')
  assert.ok(/PONDER_SOLO/.test(g), 'ponder 指引仍在')
  assert.ok(/外部查证/.test(g), '外部查证纪律也在')
})
