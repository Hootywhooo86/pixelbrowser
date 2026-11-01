// Search your own history, bookmarks, notes and reading list in plain words:
// "that shipping supplies site I saw last week". Local first: keywords,
// site names and date words ("yesterday", "last week", "3 days ago") are
// scored on the phone. With AI on, Bitter can also rewrite a vague question
// into better search words; your history itself never leaves the phone.

import { chat, providerProblem } from '@pixelbrowser/ai-core'
import { getState, liveRecords } from './store'
import { currentProvider } from './ai'
import { scoreItems } from './web-tools-core'

const text = (v) => (typeof v === 'string' ? v : '')

/** Everything searchable, as { kind, title, url, text, at }. */
export function searchableItems() {
  const out = []
  for (const r of liveRecords('history')) {
    const d = r.data || {}
    if (d.url) out.push({ kind: 'history', id: r.id, title: d.title || d.url, url: d.url, at: d.visitedAt || r.updatedAt })
  }
  for (const r of liveRecords('bookmarks')) {
    const d = r.data || {}
    if (d.url) out.push({ kind: 'bookmark', id: r.id, title: d.title || d.url, url: d.url, text: d.folder || '', at: d.createdAt || r.updatedAt })
  }
  for (const r of liveRecords('notes')) {
    const d = r.data || {}
    const body = text(d.text) || text(d.body) || text(d.quote)
    out.push({ kind: 'note', id: r.id, title: d.title || body.slice(0, 80) || 'Note', url: d.url || '', text: body, at: d.updatedAt || d.createdAt || r.updatedAt })
  }
  for (const r of liveRecords('readlater')) {
    const d = r.data || {}
    if (d.url) out.push({ kind: 'readlater', id: r.id, title: d.title || d.url, url: d.url, text: text(d.excerpt) || text(d.article?.text) || '', at: d.savedAt || d.createdAt || r.updatedAt })
  }
  return out
}

/** Local search, best matches first: [{ kind, title, url, text, at, score }]. */
export function searchEverything(query, { limit = 50 } = {}) {
  return scoreItems(searchableItems(), query, { limit })
}

/** Ask the chosen AI for a short text answer (used by search and watchers). */
export async function askAIText(system, user, { maxChars = 4000 } = {}) {
  if (!getState()?.aiEnabled) throw new Error('AI is off.')
  const provider = await currentProvider()
  const problem = providerProblem(provider)
  if (problem) throw new Error(problem)
  const res = await chat(provider, { system, messages: [{ role: 'user', content: String(user).slice(0, maxChars * 4) }] })
  return (res.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
}

/**
 * Local search, plus (when `useAI` and AI is on) Bitter turning the question
 * into search words. Only your question is sent to the AI, never your history.
 * Returns { results, rewritten }.
 */
export async function smartSearch(query, { useAI = false, limit = 50 } = {}) {
  let results = searchEverything(query, { limit })
  let rewritten = null
  if (useAI && getState()?.aiEnabled && results.length < 5) {
    try {
      const words = await askAIText(
        'You turn a person\'s vague description of a web page they visited into 3-8 search keywords (site names, product words, synonyms). Keep any time words like "yesterday" or "last week". Reply with the keywords only, separated by spaces.',
        query
      )
      rewritten = words.replace(/[^\p{L}\p{N}\s.-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      if (rewritten) {
        const seen = new Set(results.map((r) => `${r.kind}:${r.id}`))
        for (const r of searchEverything(rewritten, { limit })) if (!seen.has(`${r.kind}:${r.id}`)) results.push({ ...r, score: r.score * 0.8 })
        results = results.sort((a, b) => b.score - a.score).slice(0, limit)
      }
    } catch {
      // AI unavailable: the local results stand.
    }
  }
  return { results, rewritten }
}
