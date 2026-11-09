// ══════════════════════════════════════════════════════════════════════════════
// 指令面（写路径）：把 UI 里的一句话真正投递给 DSH 会话（agent.followup）。
//
// 为什么单独成文件：
//  - 之前页面只会说"这条没发出去"（诚实但等于没接）；接了之后必须能证明真的投递到了某个会话，
//    而不是在前端伪造一条"收到"（那是假对接）。
//  - 校验/消息构造/投递分开：消息形状按 dsh-agent 的 UserMessage 契约（role/content/source），
//    宿主 agent 只吃这个形状，前端自己拼容易拼错。
// ══════════════════════════════════════════════════════════════════════════════

export const CHAT_LIMITS = Object.freeze({ maxChars: 4000 })

/** 规整文本：去首尾空白、拒绝空/超长（返回 {ok,text,error}，不抛）。 */
export function normalizeChatText(raw) {
  const text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim()
  if (!text) return { ok: false, error: '消息为空' }
  if (text.length > CHAT_LIMITS.maxChars) return { ok: false, error: `消息过长（${text.length} > ${CHAT_LIMITS.maxChars} 字）` }
  return { ok: true, text }
}

/** 构造 dsh-agent 的 UserMessage（source.kind 固定 user：这是人从界面说的话）。 */
export function buildUserMessage(text, opts = {}) {
  const id = String(opts.id || `ui-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`)
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/**
 * 真投递：调 agent.followup(message)（dsh-agent Agent 契约：排队一轮并把会话唤醒）。
 * @returns {ok:true, sessionId, chars} | {ok:false, error}
 */
export function deliverChat(agent, textRaw, opts = {}) {
  const norm = normalizeChatText(textRaw)
  if (!norm.ok) return { ok: false, error: norm.error }
  const followup = agent && agent.followup
  if (typeof followup !== 'function') return { ok: false, error: '该会话不支持投递（缺少 followup 接口）' }
  const message = buildUserMessage(norm.text, { id: opts.id })
  try {
    followup.call(agent, message)
  } catch (e) {
    return { ok: false, error: `投递失败：${String((e && e.message) || e)}` }
  }
  let sessionId = ''
  try { sessionId = String((agent.session && agent.session.id) || '') } catch { sessionId = '' }
  return { ok: true, sessionId, chars: norm.text.length, messageId: message.id }
}
