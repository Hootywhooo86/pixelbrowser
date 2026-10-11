// Every AI the assistant can talk to. Users pick one in settings and bring
// their own key (or run a local model). Two wire formats cover all of them:
// Claude uses the official Anthropic SDK; everything else speaks the
// OpenAI-compatible chat-completions format.
//
// Model names are editable in settings. The defaults are just starting points.

export const PROVIDERS = {
  anthropic: {
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    model: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    label: 'Gemini (Google)',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  xai: {
    label: 'Grok (xAI)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4',
    keyUrl: 'https://console.x.ai',
  },
  mistral: {
    label: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  groq: {
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter (hundreds of models)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/auto',
    keyUrl: 'https://openrouter.ai/keys',
  },
  perplexity: {
    label: 'Perplexity',
    kind: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    model: 'sonar',
    tools: false, // chat + page questions only; agent mode needs tool calling
    keyUrl: 'https://www.perplexity.ai/settings/api',
  },
  ollama: {
    label: 'Ollama (on this device, private)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    noKey: true,
    local: true,
  },
  lmstudio: {
    label: 'LM Studio (on this device, private)',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    noKey: true,
    local: true,
  },
  custom: {
    label: 'Custom (any OpenAI-compatible API)',
    kind: 'openai',
    baseUrl: '',
    model: '',
    keyOptional: true,
  },
}

// AI web apps that open inside the sidebar, signed in with the user's own
// account. These need no API key.
export const WEB_APPS = {
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com' },
  claude: { label: 'Claude', url: 'https://claude.ai' },
  gemini: { label: 'Gemini', url: 'https://gemini.google.com' },
  perplexity: { label: 'Perplexity', url: 'https://www.perplexity.ai' },
  copilot: { label: 'Copilot', url: 'https://copilot.microsoft.com' },
  grok: { label: 'Grok', url: 'https://grok.com' },
  deepseek: { label: 'DeepSeek', url: 'https://chat.deepseek.com' },
  mistral: { label: 'Le Chat', url: 'https://chat.mistral.ai' },
  meta: { label: 'Meta AI', url: 'https://www.meta.ai' },
}

/**
 * Merge a saved user config over the catalog defaults.
 * config: { provider, model?, baseUrl?, apiKey? }
 */
export function resolveProvider(config = {}) {
  const base = PROVIDERS[config.provider] || PROVIDERS.anthropic
  return {
    id: PROVIDERS[config.provider] ? config.provider : 'anthropic',
    ...base,
    model: config.model || base.model,
    baseUrl: (config.baseUrl || base.baseUrl || '').replace(/\/+$/, ''),
    apiKey: config.apiKey || '',
    tools: base.tools !== false,
  }
}

export function providerProblem(p) {
  if (!p.model) return 'Pick a model in AI settings.'
  if (p.kind === 'openai' && !p.baseUrl) return 'Add the API address (base URL) in AI settings.'
  if (!p.noKey && !p.keyOptional && !p.apiKey) return `Add your ${p.label} API key in AI settings.`
  return null
}
