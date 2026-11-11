// T11：**只给适配页的场景 iframe 用**（原 demo 页仍加载它自己的 pixoffice-config.js，零改动）。
// 上游页面读 globalThis.__PIXOFFICE_CONFIG__ 的 relayUrl 决定 EventSource 的基址：
//   relayUrl = ''（同源）→ 页面请求 '/api/pixoffice/events'，正好打到本插件新注册的 relay 路由。
// 这样场景层就能收到本公司快照（employees 带 sceneActorId → 人物换绑），而不是跑上游 demo 的假花名册。
globalThis.__PIXOFFICE_CONFIG__ = { relayUrl: '' }
