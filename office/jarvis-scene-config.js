// 场景页 relay 配置（只给适配页的 iframe 用；原 demo 页仍加载它自己的 pixoffice-config.js）。
//
// v0.35 修复（2026-11-28）——为什么 relayUrl 不能是空字符串：
//   上游 bundle 的接线函数是 A(){ return globalThis.__PIXOFFICE_CONFIG__?.relayUrl || void 0 }
//   （定义在 assets/connectionConfig-*.js，导出名 t，被 office bundle `import { t as x }`）。
//   旧值 relayUrl: '' 是空字符串 → '' || void 0 === undefined
//   → Lr() 判定为"没配后端" → 渲染 Ir() 的离线 demo 分支
//   → 画面显示 bundle 里写死的 6 人花名册（王明/李研/周理/陈书/刘市/赵审），
//   与真实员工（总经理/技术判定官/证据核验官/猎头…）完全对不上。
//   这就是用户反馈"画面里显示王明陈书、完全没对上"的根因。
//
// relayUrl: '/'（同源根）→ baseUrl 拼出 /api/pixoffice/ui 与 /api/pixoffice/reply，
//   正好命中本插件注册的 relay 路由；SSE 走 /api/pixoffice/events。
// 注意：relay 的 workspace 由服务端解析（?workspace= 优先，其次配置的 defaultWorkspace），
//   因此切换工作区时，场景页 URL 需要带 ?workspace=<路径>（见 jarvis-v2-wings.html 的 iframe src）。
globalThis.__PIXOFFICE_CONFIG__ = { relayUrl: '/' }
