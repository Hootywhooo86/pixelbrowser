// Rough AI cost estimates for the spending cap. Prices are US dollars per
// million tokens [input, output]. Local models cost nothing. Unknown models
// fall back to the provider's default price, so the cap still bites.

export const PRICES = {
  anthropic: {
    'claude-opus-5-5': [4, 20],
    'claude-opus-5': [5, 25],
    'claude-sonnet-5-5': [2, 10],
    'claude-sonnet-5': [2, 10],
    'claude-haiku-5-5': [0.1, 0.5],
    'claude-fable-5-1': [10, 50],
    'claude-fable-5': [10, 50],
    default: [4, 20],
  },
  openai: { 'gpt-5': [1.25, 10], 'gpt-5-mini': [0.25, 2], default: [1.25, 10] },
  gemini: { 'gemini-2.5-flash': [0.3, 2.5], 'gemini-2.5-pro': [1.25, 10], default: [0.3, 2.5] },
  xai: { 'grok-4': [3, 15], default: [3, 15] },
  mistral: { 'mistral-large-latest': [2, 6], default: [2, 6] },
  deepseek: { 'deepseek-chat': [0.27, 1.1], default: [0.27, 1.1] },
  groq: { default: [0.59, 0.79] },
  openrouter: { default: [3, 15] },
  perplexity: { sonar: [1, 1], default: [1, 1] },
  ollama: { default: [0, 0] },
  lmstudio: { default: [0, 0] },
  custom: { default: [0, 0] },
}

export function priceFor(providerId, model) {
  const table = PRICES[providerId] || PRICES.custom
  if (table[model]) return table[model]
  // Longest matching prefix, so 'gpt-5-mini-…' isn't priced as 'gpt-5'.
  const key = Object.keys(table)
    .filter((k) => k !== 'default' && model && String(model).startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return key ? table[key] : table.default
}

/** Tokens from a rough character count (about 4 characters per token). */
export const tokensFromChars = (chars) => Math.ceil((Number(chars) || 0) / 4)

/** Dollars for one call. usage = { input, output } in tokens. */
export function estimateCost(providerId, model, usage = {}) {
  const [inp, out] = priceFor(providerId, model)
  return ((Number(usage.input) || 0) * inp + (Number(usage.output) || 0) * out) / 1e6
}

export const dayKey = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/**
 * Has spending reached a cap? spent maps 'YYYY-MM-DD' -> dollars.
 * Returns null when under both caps, else { which: 'day'|'month', spent, cap }.
 */
export function capStatus({ capDay = 0, capMonth = 0, spent = {} }, now = new Date()) {
  const today = dayKey(now)
  const month = today.slice(0, 7)
  const day = Number(spent[today]) || 0
  const monthTotal = Object.entries(spent).reduce((sum, [k, v]) => (k.startsWith(month) ? sum + (Number(v) || 0) : sum), 0)
  if (capDay > 0 && day >= capDay) return { which: 'day', spent: day, cap: capDay }
  if (capMonth > 0 && monthTotal >= capMonth) return { which: 'month', spent: monthTotal, cap: capMonth }
  return null
}

/** Add a cost to a spent map in place; drops days older than ~3 months. */
export function addSpend(spent, dollars, now = new Date()) {
  const k = dayKey(now)
  spent[k] = Math.round(((Number(spent[k]) || 0) + (Number(dollars) || 0)) * 1e6) / 1e6
  const cutoff = dayKey(new Date(now.getTime() - 100 * 86400000))
  for (const key of Object.keys(spent)) if (key < cutoff) delete spent[key]
  return spent
}

export const capMessage = (c) =>
  `Bitter hit your ${c.which === 'day' ? 'daily' : 'monthly'} AI spending cap ($${c.cap.toFixed(2)}; about $${c.spent.toFixed(2)} spent). Continue anyway, just this once?`
