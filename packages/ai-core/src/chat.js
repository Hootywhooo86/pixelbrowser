// One chat() call for every provider.
//
// Conversation format used across the app (provider-neutral):
//   { role: 'user', content: string | Block[] }
//   { role: 'assistant', content: Block[], native?: { provider, content } }
// Blocks:
//   { type: 'text', text }
//   { type: 'tool_call', id, name, input }
//   { type: 'tool_result', id, output, isError? }
//
// Assistant turns keep the provider's raw content in `native` so the same
// provider gets its own blocks back unchanged on the next request (Claude
// needs this for its thinking blocks). History is append-only.

import Anthropic from '@anthropic-ai/sdk'

const MAX_TOKENS = 16000

/**
 * @returns {Promise<{ blocks: object[], native: object, stop: 'end'|'tool'|'length'|'refusal', usage?: { input, output } }>}
 */
export async function chat(provider, { system, messages, tools = [], signal }) {
  const useTools = provider.tools && tools.length > 0 ? tools : []
  return provider.kind === 'anthropic'
    ? chatAnthropic(provider, { system, messages, tools: useTools, signal })
    : chatOpenAICompatible(provider, { system, messages, tools: useTools, signal })
}

// ---------- Claude (official SDK) ----------

// Models that accept output_config.effort and server-side refusal fallbacks.
const EFFORT_MODELS = /^claude-(opus-(4-[5-9]|5)|sonnet-5|fable-5|haiku-5|mythos-5)/
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5-1)/

async function chatAnthropic(provider, { system, messages, tools, signal }) {
  const client = new Anthropic({
    apiKey: provider.apiKey,
    ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
    // The key belongs to the user and stays on their device; the mobile app
    // runs in a JS runtime the SDK may treat as a browser.
    dangerouslyAllowBrowser: true,
  })

  const params = {
    model: provider.model,
    max_tokens: MAX_TOKENS,
    system,
    messages: messages.map(toAnthropicMessage),
    ...(tools.length
      ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
      : {}),
    ...(EFFORT_MODELS.test(provider.model) ? { output_config: { effort: 'medium' } } : {}),
  }

  let response
  if (FALLBACK_MODELS.test(provider.model)) {
    // If a safety classifier declines, the API retries on its recommended
    // fallback model inside the same call.
    response = await client.beta.messages.create(
      { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
      { signal }
    )
  } else {
    response = await client.messages.create(params, { signal })
  }

  const u = response.usage || {}
  const usage = {
    input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) * 0.1,
    output: u.output_tokens || 0,
  }
  if (response.stop_reason === 'refusal') {
    const why = response.stop_details?.explanation
    return {
      blocks: [{ type: 'text', text: why ? `I can't help with that: ${why}` : "I can't help with that one." }],
      native: { provider: 'anthropic', content: response.content },
      stop: 'refusal',
      usage,
    }
  }

  const blocks = []
  for (const b of response.content) {
    if (b.type === 'text' && b.text) blocks.push({ type: 'text', text: b.text })
    else if (b.type === 'tool_use') blocks.push({ type: 'tool_call', id: b.id, name: b.name, input: b.input || {} })
  }
  return {
    blocks,
    native: { provider: 'anthropic', content: response.content },
    stop: response.stop_reason === 'tool_use' ? 'tool' : response.stop_reason === 'max_tokens' ? 'length' : 'end',
    usage,
  }
}

function toAnthropicMessage(m) {
  if (m.role === 'assistant') {
    if (m.native?.provider === 'anthropic') return { role: 'assistant', content: m.native.content }
    return {
      role: 'assistant',
      content: m.content.map((b) =>
        b.type === 'tool_call'
          ? { type: 'tool_use', id: b.id, name: b.name, input: b.input }
          : { type: 'text', text: b.text }
      ),
    }
  }
  if (typeof m.content === 'string') return { role: 'user', content: m.content }
  return {
    role: 'user',
    content: m.content.map((b) =>
      b.type === 'tool_result'
        ? { type: 'tool_result', tool_use_id: b.id, content: b.output, ...(b.isError ? { is_error: true } : {}) }
        : { type: 'text', text: b.text }
    ),
  }
}

// ---------- OpenAI-compatible (OpenAI, Gemini, Grok, Mistral, OpenRouter, Ollama...) ----------

async function chatOpenAICompatible(provider, { system, messages, tools, signal }) {
  const body = {
    model: provider.model,
    messages: [{ role: 'system', content: system }, ...messages.flatMap(toOpenAIMessages)],
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
  }

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      ...(provider.id === 'openrouter' ? { 'X-Title': 'Bit Browser' } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${provider.label} returned ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  const choice = data.choices?.[0]
  const msg = choice?.message || {}

  const blocks = []
  const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p) => p.text || '').join('') : ''
  if (text) blocks.push({ type: 'text', text })
  for (const call of msg.tool_calls || []) {
    blocks.push({ type: 'tool_call', id: call.id, name: call.function?.name, input: parseArgs(call.function?.arguments) })
  }
  const hasCalls = blocks.some((b) => b.type === 'tool_call')
  return {
    blocks,
    native: { provider: provider.id, content: null },
    stop: hasCalls ? 'tool' : choice?.finish_reason === 'length' ? 'length' : 'end',
    ...(data.usage ? { usage: { input: data.usage.prompt_tokens || 0, output: data.usage.completion_tokens || 0 } } : {}),
  }
}

function parseArgs(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function toOpenAIMessages(m) {
  if (m.role === 'assistant') {
    const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    const calls = m.content.filter((b) => b.type === 'tool_call')
    return [
      {
        role: 'assistant',
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
              })),
            }
          : {}),
      },
    ]
  }
  if (typeof m.content === 'string') return [{ role: 'user', content: m.content }]
  const out = []
  const texts = []
  for (const b of m.content) {
    if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.id, content: b.output })
    else texts.push(b.text)
  }
  if (texts.length) out.push({ role: 'user', content: texts.join('\n\n') })
  return out
}
