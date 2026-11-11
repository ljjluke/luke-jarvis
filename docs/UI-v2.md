# UI v2（增强 UI）接入说明

> 入口：`/jarvis-ui` → 302 → `/jarvis-office/v2/index.html`
> 数据：**只走 4 个契约端点**，不读 `.jarvis` 文件布局。改 UI 不用改插件，改插件不影响 UI。

## 一、页面结构（哪些是动态的）

| 区域 | 是否动态 | 数据来源 |
|---|---|---|
| 右下角光球菜单 | **静态**（鼠标操作菜单） | 无 |
| 主界面 6 个浮动块（当前阶段 / 语音 / 流程闸 / 最新事件 / 接入通道 / 下一步） | **全部动态** | `/api/jarvis/state` + `/api/jarvis/events` |
| 中央对话（主文案/副文案/三项指标） | **动态** | 同上 |
| 进度页（六阶段链、缺口、事件控制台、汇报指标） | **动态** | `/api/jarvis/state`（stage/gates/meetings/memory）+ events |
| 员工协作空间 | **3D 实时场景**（Three.js） | `state.tasks.byAssignee` → 人物工位/状态色 |
| 成员列表 / 黑板未决 / 决策条 | **动态** | 同上 |
| 语音链路节点 | **动态**（麦克风状态 + 当前音色） | 浏览器麦克风 + `/api/jarvis/voice` |

轮询节奏：快照 5s、事件 3s（`since=lastSeq` 增量）。没有任何写死的演示数据（测试会拦"全局服务巡检""5 人在线"这类假文案）。

## 二、语音：从"浏览器合成"升级为"语音大模型"

**当前实现（两条路，自动回退）**
1. 默认 `provider: browser`：用浏览器 `speechSynthesis`（零依赖、免费；音色取决于系统，非模型、情感有限）；
2. 配置 `provider: openai` 后：前端把文本 POST 给插件 `/api/jarvis/tts`，插件用**你配的 key** 调用 OpenAI 兼容 `/audio/speech`，返回 mp3 播放——key 只在服务端用，不下发浏览器。

**设置项位置**：光球菜单 →「语音设置 · 模型与音色」→ 引擎 / 服务地址 / API Key / 模型 / 音色 / 语速 / 试听 / 保存。
配置落盘 `~/.dsh/luke-jarvis/voice.json`（全局，权限 600；切项目不用重配）；GET 只回掩码 `sk-…abcd`，PUT 传空串表示"保留原值"。

**可选的开源/商业语音模型**（只要有 OpenAI 兼容 `/audio/speech` 网关就能接）

| 类型 | 方案 | 说明 |
|---|---|---|
| 开源·情感强 | **CosyVoice 2**（阿里，Apache-2.0） | 中英、情感/方言指令控制，社区有 OpenAI 兼容网关 |
| 开源·零样本克隆 | **GPT-SoVITS**（MIT） | 几秒音频克隆音色；社区有 `api_v2` HTTP 网关 |
| 开源·高自然度 | **IndexTTS 2**（Apache-2.0） | 情绪/时长控制强，B 站开源项目 |
| 开源·轻量 | **Kokoro-82M**（Apache-2.0） | 单卡即可跑，英文强、中文一般 |
| 开源·多语 | **Fish Speech**（Apache-2.0） | 多语言+克隆 |
| 商业 API | OpenAI `gpt-4o-mini-tts`、火山引擎豆包语音、MiniMax speech-02、阿里 CosyVoice API | 直接填 baseUrl + key + model/voice |

**情感怎么来**：OpenAI `gpt-4o-mini-tts` 支持 `instructions`（"用平静克制的语气"），CosyVoice/IndexTTS 支持情感指令与参考音频。当前代理透传 `model/voice/speed`；要加 `instructions`/参考音频，改 `/api/jarvis/tts` 的请求体映射即可（P1 项）。

## 三、员工协作空间 = 开源 PixOffice 场景（不自己画）

**来源**：`https://github.com/workbzw/pixoffice`（PixOffice，MIT，Vite + React + PixiJS 的像素办公室）。
仓库是 monorepo：`packages/renderer-pixi`（PixiJS 渲染）、`packages/protocol`（relay/协议）、`packages/assets-office`（像素素材）、
`example/office-web`（完整办公室页面）。**画面一律来自它的源码/构建产物，jarvis 侧不重画场景。**

**接入方式（同源 iframe + 数据 relay）**

| 环节 | 做法 |
|---|---|
| 场景页 | `/jarvis-office/jarvis-scene.html` = 上游 office 页的构建产物（`office/assets/*`、`office/characters/*`，随插件包一起发） |
| 配置 | `office/jarvis-scene-config.js` 里 `globalThis.__PIXOFFICE_CONFIG__ = { relayUrl: '' }` → 场景请求同源 `/api/pixoffice/events` |
| 数据 relay | 插件路由 `/api/pixoffice/{events,messages,ui,reply}`：把 `.jarvis/company-state.json` 投影成上游协议帧（SSE，4s 心跳、跨连接单调 seq、`Last-Event-ID` 续传）；命令走白名单校验 |
| 页面内嵌 | v2 团队页 `<iframe id="teamScene" src="/jarvis-office/jarvis-scene.html">`，与左侧成员/黑板/决策条同页 |

**主题适配（改颜色但保原效果）**

用户要求"主体风格颜色改成主题风格，但画面必须符合原来开源的效果"，所以只加适配层，**不动像素素材、布局与交互**：

1. iframe 内注入一段 `#jarvis-theme` CSS（同源可注入）：`html,body{background:#02070d}`、`canvas{filter:saturate(.92) contrast(1.04) brightness(.98) hue-rotate(-8deg)}` —— 只压色温到冷青；
2. 页面上叠两层不动交互的装饰：`.team-scene-veil`（径向青光 + 顶部青蓝渐变，`mix-blend-mode:screen`）、
   `.team-scene-frame`（1px 青色内描边 + 内阴影 + 细扫描线），与全息 HUD 同一套视觉语言；
3. 色温参数集中在 `office/v2/jarvis-v2.js` 的 `SCENE.theme`，一处可调；页面暴露 `window.__JARVIS_UI__.scene` 供核验是否注入成功。

**升级上游**：`npm ci && npm run build`（`example/office-web`）→ 用新的 `dist` 覆盖 `office/{assets,characters,office}` 与 `jarvis-scene.html` 的资源清单即可；
relay 协议若变，先跑 `test/` 里的帧校验用例（`buildPixOfficeFrame`/`validatePixOfficeFrame`）。

**已核验 / 未核验（诚实边界）**：帧结构、relay 路由、静态托管、iframe 接线、主题注入代码均有单测/静态断言；
**画面像素级效果本环境没有浏览器，无法截图验收**——重启后需要你在浏览器里目视确认一次（若色温偏冷/偏亮，改 `SCENE.theme.grade` 一处即可）。


## 三之二、能力台（31 个工具全部可从界面执行）

| 环节 | 做法 |
|---|---|
| 清单 | `GET /api/jarvis/tools`：从真实 `TOOLS` 派生 31 条（name/description/parameters/required/group），界面据此**自动生成表单** |
| 执行 | `POST /api/jarvis/command {tool,args,agent?}`：只允许 `jarvis_*`，走宿主 `tools.execute` → **captain 闸/阶段闸/流程闸照常生效**（UI 不能当绕闸后门） |
| 会话绑定 | `GET /api/jarvis/sessions`：按工作区自动匹配活动会话，也可在界面里手选（闸按该会话判定、文件按该 cwd 落盘） |
| 结果 | 返回工具渲染文本 + 结构化 `value` + `elapsedMs`；被闸拒绝时 `denied:true` + 原文原因，界面明确提示"是硬流程，不是页面故障" |
| 事件 | 每次执行落一条 `command` 事件（`.jarvis/events.jsonl`），时间轴/审计可见 |
| 界面 | 光球菜单 →「能力台 · 31 个工具」：左侧按域分组（需求规划/人才角色/记忆知识/流程闸/交付验收/运行协作/深度思考），右侧表单 + JSON 模式 + 执行结果 + 最近执行记录 |

覆盖校验：单测断言 `TOOL_GROUPS` 必须恰好覆盖全部 31 个工具（漏一个就红）。

## 四、与 DSH 的真实对接

| 能力 | 实现 |
|---|---|
| 快照 | 插件路由 `/api/jarvis/state`（`state/snapshot.js`，只读聚合，带 `jarvis.snapshot/1`） |
| 事件流 | `/api/jarvis/events?since=`（`.jarvis/events.jsonl`，闸/黑板/会议/派活写入） |
| 语音设置 | `/api/jarvis/voice` GET/PUT（`state/voice.js`） |
| 语音合成 | `/api/jarvis/tts`（OpenAI 兼容代理，key 不出服务端） |
| 能力台 | `/api/jarvis/tools`、`/api/jarvis/sessions`、`/api/jarvis/command` |
| 公司场景 relay | `/api/pixoffice/{events,messages,ui,reply}`（读 `.jarvis/company-state.json`） |
| 静态托管 | `/jarvis-office/*`（`office/` 目录，含开源场景构建产物），`/jarvis-ui` 302 到 v2 |
| 工作区解析 | `?workspace=/abs/path`，缺省取最近会话 cwd |

## 五、验收

```bash
curl -s http://127.0.0.1:PORT/api/jarvis/state | head -c 200
curl -s http://127.0.0.1:PORT/api/jarvis/voice
curl -s http://127.0.0.1:PORT/jarvis-office/v2/index.html | head -c 120
node --test test/plugin.test.js   # 含 v2 资产/动态钩子/语音配置/302 断言
```

边界：耳机式麦克风识别仍依赖浏览器 `SpeechRecognition`（Chrome/Edge）；Safari 无识别能力时只能手动点击操作。
