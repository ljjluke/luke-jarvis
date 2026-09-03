/**
 * Jarvis 数字员工公司 · 核心插件（Client）
 *
 * 平台：Client（浏览器）。dsh client bundle（__ModuleLoader__ 经典模式，0.1.2-alpha.2 线）。
 * 用途：web 页面渲染黑板——仅当 Host 侧工作区存在 .jarvis/（用了 /jarvis）才显示，
 *       不入侵其他会话/插件。
 *   1. conversation.session.header.actions：会话头部"📋 黑板"按钮 → 打开浮层
 *   2. shell.overlay：黑板内容浮层（未决项/阻塞/决策/需要开会判定）
 * 数据：GET /api/luke-jarvis/board（Host webServer route）→ 读 .jarvis/board.json 返回摘要；
 *       active=false 不渲染。host.call 仅 dynamic 沙箱可用，静态 bundle 走 HTTP route。
 */
window.__ModuleLoader__.load({
  id: "luke-jarvis",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    const CSS = `.jarvis-hdr{position:relative;}`
    const headerBtnStyle = { fontSize: 12, padding: '6px 10px', borderRadius: 10, cursor: 'pointer', border: '1px solid rgba(120,190,255,.4)', background: 'rgba(30,60,120,.4)', color: '#cfe4ff', marginRight: 6 }
    const overlayWrap = { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(4,8,18,.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80 }
    const overlayBox = { width: 'min(680px,92vw)', maxHeight: '70vh', overflow: 'auto', background: 'linear-gradient(165deg,#12224a,#0a1230)', border: '1px solid rgba(120,170,255,.4)', borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,.7)' }
    const overlayHeader = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(120,170,255,.2)', color: '#e6f1ff', fontSize: 13 }
    const closeBtn = { marginLeft: 'auto', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', color: '#cfe4ff', borderRadius: 8, padding: '4px 9px', cursor: 'pointer', fontSize: 11 }
    const overlayList = { padding: '8px 14px' }
    const emptyStyle = { padding: 20, color: '#7f9cc9', fontSize: 12 }
    function rowStyle(it) { return { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid rgba(120,170,255,.08)', color: '#d7e7ff' } }
    function typeColor(t) {
      const s = String(t || '')
      if (s.includes('阻塞') || s.includes('风险')) return '#ff9b9b'
      if (s.includes('决策')) return '#ffd678'
      if (s.includes('接口')) return '#59c8ff'
      return '#9fc2ff'
    }

    async function fetchBoard() {
      try {
        const res = await fetch('/api/luke-jarvis/board', { headers: { accept: 'application/json' } })
        if (res.ok) {
          const data = await res.json()
          if (data && typeof data === 'object') return data
        }
        return { items: [], active: false, error: res.ok ? '' : 'HTTP ' + res.status }
      } catch (e) {
        return { items: [], active: false, error: String(e && e.message ? e.message : e) }
      }
    }

    // ── 黑板浮层（含入口按钮，active=false 时不渲染任何东西）──
    function BoardOverlay() {
      const [open, setOpen] = React.useState(false)
      const [state, setState] = React.useState({ items: [], active: false })
      const [tick, setTick] = React.useState(0)
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          const r = await fetchBoard()
          if (alive) setState(r)
        }
        load()
        const d = setInterval(() => { load(); setTick((t) => t + 1) }, 15000)
        return () => { alive = false; clearInterval(d) }
      }, [])
      if (!state.active && !state.error) return null // 非 jarvis 会话：不渲染按钮（不入侵）
      const items = state.items || []
      const openItems = items.filter((i) => i.status === 'open' || !i.status)
      return React.createElement(React.Fragment, null,
        !open
          ? React.createElement('button', {
              style: headerBtnStyle,
              title: (state.error ? state.error : '') || undefined,
              onClick: () => setOpen(true),
            }, '📋 黑板'):
          React.createElement('div', { style: overlayWrap },
            React.createElement('div', { style: overlayBox },
              React.createElement('div', { style: overlayHeader },
                React.createElement('b', null, '📋 Jarvis 黑板'),
                React.createElement('span', { style: { color: '#5f7aa6', fontSize: 11 } }, openItems.length + ' 条未决 · 15s 刷新'),
                React.createElement('button', { style: closeBtn, onClick: () => setOpen(false) }, '✕'),
              ),
              openItems.length === 0
                ? React.createElement('div', { style: emptyStyle }, state.error ? '读取错误：' + state.error : '黑板暂无未决项（.jarvis/board.json）')
                : React.createElement('div', { style: overlayList },
                    openItems.map((it, i) => React.createElement('div', { key: it.id || i, style: rowStyle(it) },
                      React.createElement('span', { style: { color: '#5f7aa6', fontSize: 10, minWidth: 22 } }, String(it.id || '#')),
                      React.createElement('b', { style: { color: typeColor(it.type), minWidth: 52, fontSize: 11 } }, String(it.type || '问题')),
                      React.createElement('span', { style: { flex: 1, fontSize: 11, lineHeight: 1.5 } }, String(it.content || '').slice(0, 140)),
                      React.createElement('span', { style: { color: '#5f7aa6', fontSize: 9, minWidth: 30 } }, it.role || ''),
                      it.essenceChecked ? React.createElement('span', { style: { color: '#59ffc8', fontSize: 10 } }, '✓') : null,
                    )),
                  ),
            ),
          ),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      const stylesSvc = ctx.get('styles')
      if (slots === undefined) return
      if (stylesSvc) ctx.effect(() => stylesSvc.insert(CSS))

      slots.inject('conversation.session.header.actions', () => slots.register(
        { name: 'conversation.session.header.actions', id: 'jarvis-board-btn', order: 5 },
        () => React.createElement(BoardOverlay, null),
      ))
    }

    const inject = ["slots"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
})
