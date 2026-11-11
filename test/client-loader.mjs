/** ESM resolve 钩子：把 'react' 重定向到测试桩（浏览器模块表的替身），其余照常解析。 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'react') {
    return {
      url: new URL('./client-react-stub.mjs', import.meta.url).href,
      shortCircuit: true,
      format: 'module',
    }
  }
  return nextResolve(specifier, context)
}
