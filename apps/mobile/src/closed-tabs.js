// "Reopen closed tab": the last 25 normal tabs you closed (private ones never).

import { getState, update, useStore } from './store'

const LIMIT = 25

export function rememberClosed(tab) {
  if (!tab || tab.private || !/^https?:/i.test(tab.url || '')) return
  update((s) => {
    s.closedTabs = [...(s.closedTabs || []), { url: tab.url, title: tab.title || tab.url, space: tab.space || 'personal', closedAt: Date.now() }].slice(-LIMIT)
  })
}

/** Take the most recently closed tab (from this Space if given). */
export function popClosed(space) {
  const list = getState().closedTabs || []
  let i = list.length - 1
  if (space) while (i >= 0 && (list[i].space || 'personal') !== space) i--
  if (i < 0) return null
  const item = list[i]
  update((s) => {
    s.closedTabs = (s.closedTabs || []).filter((_, j) => j !== i)
  })
  return item
}

export function useClosedTabs() {
  return useStore((s) => s.closedTabs || [])
}
