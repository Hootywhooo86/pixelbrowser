import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { runAssistant, resolveProvider, parseDuckDuckGo, looksLikeQuestion, riskyActionReason, isSensitivePage, searchUrlFor, searchHome } from '../src/index.js'

// ---------- fakes ----------

let requests = []
let replies = []
const realFetch = globalThis.fetch

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
}

beforeEach(() => {
  requests = []
  replies = []
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    const headers = Object.fromEntries(new Headers(init?.headers || {}).entries())
    requests.push({ url: String(url), body, headers })
    const next = replies.shift()
    if (!next) throw new Error('no fake reply queued')
    return jsonResponse(next)
  }
})
afterEach(() => {
  globalThis.fetch = realFetch
})

function fakeDriver(pages = {}) {
  const log = []
  return {
    log,
    activeTabId: async () => 1,
    listTabs: async () => [{ id: 1, title: 'Shop', url: 'https://shop.test/cart' }],
    run: async (_id, script) => {
      if (script.includes('data-pixel-ref') && script.includes('querySelectorAll(sel)')) {
        return pages.snapshot || { title: 'Shop', url: 'https://shop.test/cart', scrollY: 0, pageHeight: 1000, text: 'Cart', elements: [{ ref: 1, tag: 'button', label: 'Place order', inView: true }] }
      }
      if (script.includes('hasPassword')) return pages.page || { title: 'Shop', url: 'https://shop.test/cart', text: 'Your cart: 1 pixel lamp', selection: '' }
      log.push(script)
      return { ok: true, message: 'Clicked 1.' }
    },
    waitForLoad: async () => {},
    fetchText: async () => '',
  }
}

const openaiReply = (message, finish = 'stop') => ({ choices: [{ message, finish_reason: finish }] })

// ---------- tests ----------

test('ask mode attaches the page and runs tools with an OpenAI-compatible provider', async () => {
  const provider = resolveProvider({ provider: 'openai', apiKey: 'sk-test' })
  replies.push(openaiReply({ content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_tabs', arguments: '{}' } }] }, 'tool_calls'))
  replies.push(openaiReply({ content: 'You have one tab open: Shop.' }))

  const events = []
  const { history } = await runAssistant({ provider, driver: fakeDriver(), input: 'What tabs are open?', onEvent: (e) => events.push(e) })

  assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(requests[0].headers.authorization, 'Bearer sk-test')
  const firstUser = requests[0].body.messages[1].content
  assert.match(firstUser, /<page tab="1"/)
  assert.match(firstUser, /pixel lamp/)
  assert.ok(requests[0].body.tools.some((t) => t.function.name === 'list_tabs'))
  assert.ok(!requests[0].body.tools.some((t) => t.function.name === 'click'), 'no agent tools in ask mode')

  const toolMsg = requests[1].body.messages.find((m) => m.role === 'tool')
  assert.equal(toolMsg.tool_call_id, 'c1')
  assert.match(toolMsg.content, /1: Shop/)

  assert.equal(history.length, 4)
  assert.ok(events.some((e) => e.type === 'text' && /one tab/.test(e.text)))
})

test('agent mode asks before risky clicks and respects a decline', async () => {
  const provider = resolveProvider({ provider: 'groq', apiKey: 'k' })
  replies.push(openaiReply({ content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'look', arguments: '{}' } }] }, 'tool_calls'))
  replies.push(openaiReply({ content: '', tool_calls: [{ id: 'b', type: 'function', function: { name: 'click', arguments: '{"ref":1}' } }] }, 'tool_calls'))
  replies.push(openaiReply({ content: 'OK, I did not place the order.' }))

  const driver = fakeDriver()
  const asked = []
  await runAssistant({
    provider, driver, mode: 'agent', input: 'buy it',
    confirm: async (req) => { asked.push(req); return false },
  })
  assert.equal(asked.length, 1)
  assert.equal(asked[0].kind, 'action')
  assert.match(asked[0].reason, /Place order/)
  assert.equal(driver.log.length, 0, 'click must not run')
  const declined = requests[2].body.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'b')
  assert.match(declined.content, /declined/)
})

test('Claude goes through the Anthropic SDK with refusal fallbacks and keeps native blocks', async () => {
  const provider = resolveProvider({ provider: 'anthropic', apiKey: 'sk-ant-test' })
  replies.push({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'tu1', name: 'list_tabs', input: {} }],
    stop_reason: 'tool_use', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 },
  })
  replies.push({
    id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: 'One tab.' }],
    stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 },
  })
  await runAssistant({ provider, driver: fakeDriver(), input: 'tabs?' })

  assert.match(requests[0].url, /api\.anthropic\.com\/v1\/messages/)
  assert.equal(requests[0].headers['x-api-key'], 'sk-ant-test')
  assert.match(requests[0].headers['anthropic-beta'], /server-side-fallback-2026-07-01/)
  assert.equal(requests[0].body.fallbacks, 'default')
  assert.equal(requests[0].body.model, 'claude-opus-5-5')
  assert.deepEqual(requests[0].body.output_config, { effort: 'medium' })
  assert.ok(requests[0].body.tools[0].input_schema)

  // Second request replays the first assistant turn unchanged (thinking block included).
  const replayed = requests[1].body.messages[1]
  assert.equal(replayed.role, 'assistant')
  assert.equal(replayed.content[0].type, 'thinking')
  const result = requests[1].body.messages[2].content[0]
  assert.equal(result.type, 'tool_result')
  assert.equal(result.tool_use_id, 'tu1')
})

test('sensitive pages need permission before the AI reads them', async () => {
  const provider = resolveProvider({ provider: 'ollama' })
  replies.push(openaiReply({ content: 'ok' }))
  const driver = fakeDriver({ page: { title: 'Login', url: 'https://www.chase.com/', text: 'balance 1234', hasPassword: true } })
  await runAssistant({ provider, driver, input: 'summarize', confirm: async () => false })
  const sent = requests[0].body.messages[1].content
  assert.ok(!sent.includes('balance 1234'))
  assert.match(sent, /chose not to share/)
  assert.equal(requests[0].headers.authorization, undefined, 'local models need no key')
})

test('Perplexity has no tools, so agent mode is refused', async () => {
  const provider = resolveProvider({ provider: 'perplexity', apiKey: 'k' })
  await assert.rejects(runAssistant({ provider, driver: fakeDriver(), mode: 'agent', input: 'x' }), /Agent mode/)
})

test('helpers', () => {
  const html = `<div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">Example &amp; Co</a><a class="result__snippet" href="#">An <b>example</b> site</a></div>`
  assert.deepEqual(parseDuckDuckGo(html), [{ title: 'Example & Co', url: 'https://example.com/a', snippet: 'An example site' }])
  assert.ok(looksLikeQuestion('what is the best pixel font?'))
  assert.ok(looksLikeQuestion('how do magnets work'))
  assert.ok(!looksLikeQuestion('example.com'))
  assert.ok(!looksLikeQuestion('pixel art'))
  assert.ok(riskyActionReason({ kind: 'click' }, { label: 'Buy now' }))
  assert.ok(riskyActionReason({ kind: 'type', text: 'x' }, { type: 'password', label: '' }))
  assert.equal(riskyActionReason({ kind: 'click' }, { label: 'Next page' }), null)
  assert.equal(riskyActionReason({ kind: 'type', text: 'lamp', submit: true }, { tag: 'input', type: 'search', label: 'Search' }), null)
  assert.ok(riskyActionReason({ kind: 'type', text: 'hi', submit: true }, { tag: 'textarea', label: 'Message' }))
  assert.ok(isSensitivePage({ url: 'https://online.citi.com/x' }))
  assert.equal(isSensitivePage({ url: 'https://example.com' }), null)
})

test('search engine choice', () => {
  assert.equal(searchUrlFor('brave', 'pixel art'), 'https://search.brave.com/search?q=pixel%20art')
  assert.equal(searchUrlFor('duckduckgo', 'x', { aiEnabled: false }), 'https://noai.duckduckgo.com/?q=x')
  assert.equal(searchUrlFor('google', 'x', { aiEnabled: false }), 'https://www.google.com/search?udm=14&q=x')
  assert.equal(searchUrlFor('mojeek', 'x', { aiEnabled: false }), 'https://www.mojeek.com/search?q=x')
  assert.equal(searchUrlFor('custom', 'a b', { customUrl: 'https://search.example/find?term=%s' }), 'https://search.example/find?term=a%20b')
  assert.equal(searchUrlFor('custom', 'x', { customUrl: 'javascript:alert(%s)' }), 'https://duckduckgo.com/?q=x', 'unsafe templates fall back')
  assert.equal(searchUrlFor('nope', 'x'), 'https://duckduckgo.com/?q=x')
  assert.equal(searchHome('custom', 'https://search.example/find?term=%s'), 'https://search.example')
  assert.equal(searchHome('startpage'), 'https://www.startpage.com')
})
