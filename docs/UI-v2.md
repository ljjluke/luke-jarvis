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

## 三、3D 员工协作空间

- 渲染：**Three.js（MIT，已 vendored 到 `office/v2/vendor/three.module.js`，不走 CDN）**，真 WebGL，不是 CSS 假 3D；
- 场景：环形 6 工位 + 中心全息白板 + 平台网格 + 三色动态光；角色 = 胶囊身体 + 球头 + 状态环 + 名牌；
- 交互：拖拽旋转、滚轮缩放、点击成员 → 会话里播报该成员状态；
- 主题：颜色取自页面 CSS 变量（`--cyan/--green/--amber/--dim`），与全息 HUD 同一套，**不破坏原开源画面风格**；
- 数据：`state.tasks.byAssignee` → 每个 assignee 一个工位；状态色：`in_progress/working` 青、`meeting` 琥珀、`idle/pending` 灰、`completed` 绿。

**换用你提供的开源 3D 办公室**：只需替换 `office/v2/scene3d.js`，保持两个接口不变——
`createOffice3D(canvas)` 返回 `{ setMembers(list), onPick(fn), dispose() }`；`setMembers` 收 `[{name, role, status, task}]`。
页面与数据层不用动。

## 四、与 DSH 的真实对接

| 能力 | 实现 |
|---|---|
| 快照 | 插件路由 `/api/jarvis/state`（`state/snapshot.js`，只读聚合，带 `jarvis.snapshot/1`） |
| 事件流 | `/api/jarvis/events?since=`（`.jarvis/events.jsonl`，闸/黑板/会议/派活写入） |
| 语音设置 | `/api/jarvis/voice` GET/PUT（`state/voice.js`） |
| 语音合成 | `/api/jarvis/tts`（OpenAI 兼容代理，key 不出服务端） |
| 静态托管 | `/jarvis-office/*`（`office/` 目录），`/jarvis-ui` 302 到 v2 |
| 工作区解析 | `?workspace=/abs/path`，缺省取最近会话 cwd |

## 五、验收

```bash
curl -s http://127.0.0.1:PORT/api/jarvis/state | head -c 200
curl -s http://127.0.0.1:PORT/api/jarvis/voice
curl -s http://127.0.0.1:PORT/jarvis-office/v2/index.html | head -c 120
node --test test/plugin.test.js   # 含 v2 资产/动态钩子/语音配置/302 断言
```

边界：耳机式麦克风识别仍依赖浏览器 `SpeechRecognition`（Chrome/Edge）；Safari 无识别能力时只能手动点击操作。
