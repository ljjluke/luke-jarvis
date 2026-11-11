/** react 桩：浏览器模块表在 Node 里不存在，冒烟测试经 client-loader.mjs 把 `import React from 'react'`
 *  重定向到本模块。只实现 client 半用到的三个 API（createElement/useState/useEffect），够渲染成树并断言。
 */
const stateIndex = { current: 0 }
const states = []

globalThis.__reactStubReset = () => { stateIndex.current = 0 }

const React = {
  createElement(type, props, ...children) {
    const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
    // 函数组件与真 React 一样被调用（本 client 半的组件不消费 props.children，直接以 props 调用）
    if (typeof type === 'function') return type({ ...(props || {}), children: kids })
    return { type, props: props || {}, children: kids }
  },
  useState(initial) {
    const i = stateIndex.current++
    if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial
    return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v }]
  },
  useEffect() { /* 冒烟不跑副作用 */ },
}

export default React
