// Command bar: type ">" in the address bar to jump to a tab, bookmark, page
// you've visited, a setting, or run an action (print, pin, reader mode…).
//
// The app calls onAction(id, arg):
//   'tab' (tab id) · 'open' (url) · 'settings' (settings page id) · or one of
//   the ACTIONS ids below (no arg).

import { memo, useMemo } from 'react'
import { View, Text, Pressable, FlatList, StyleSheet, Keyboard } from 'react-native'
import { liveRecords, useStore } from './store'
import { useBookmarks } from './bookmarks'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

export const ACTIONS = [
  { id: 'newTab', title: 'New tab', icon: 'plus', words: 'open' },
  { id: 'newPrivateTab', title: 'New private tab', icon: 'lock', words: 'incognito' },
  { id: 'find', title: 'Find in page', icon: 'search', words: 'search text' },
  { id: 'reader', title: 'Reader mode', icon: 'home', words: 'article read' },
  { id: 'readLater', title: 'Read later', icon: 'bookmark', words: 'save reading list' },
  { id: 'translate', title: 'Translate page', icon: 'bitter', words: 'language' },
  { id: 'print', title: 'Print page', icon: 'print', words: 'paper' },
  { id: 'savePdf', title: 'Save page as PDF', icon: 'pdf', words: 'download' },
  { id: 'pin', title: 'Pin / unpin this tab', icon: 'bookmark', words: 'keep' },
  { id: 'bookmark', title: 'Bookmark this page', icon: 'star', words: 'favourite favorite save' },
  { id: 'saveNote', title: 'Save page to notes', icon: 'star', words: 'clip note' },
  { id: 'askBitter', title: 'Ask Bitter', icon: 'bitter', words: 'ai question summarize' },
  { id: 'takeOver', title: 'Let Bitter take over', icon: 'bitter', words: 'agent' },
  { id: 'packages', title: 'Packages', icon: 'download', words: 'tracking shipping parcel' },
  { id: 'notes', title: 'Notes', icon: 'star', words: 'clips' },
  { id: 'readingList', title: 'Reading list', icon: 'bookmark', words: 'read later offline' },
  { id: 'bookmarks', title: 'Bookmarks', icon: 'bookmark', words: '' },
  { id: 'history', title: 'History', icon: 'reload', words: 'visited' },
  { id: 'downloads', title: 'Downloads', icon: 'download', words: 'files pdf' },
  { id: 'reopenClosed', title: 'Reopen closed tab', icon: 'back', words: 'undo' },
  { id: 'thisSite', title: 'This site settings', icon: 'settings', words: 'permissions camera desktop' },
  { id: 'qr', title: 'QR code for this page', icon: 'share', words: 'share scan' },
  { id: 'scanQr', title: 'Scan QR code', icon: 'search', words: 'camera barcode' },
  { id: 'hideElement', title: 'Hide part of this page', icon: 'close', words: 'block element annoying banner popup' },
  { id: 'homeScreen', title: 'Add to home screen', icon: 'home', words: 'shortcut icon app' },
  { id: 'desktopSite', title: 'Desktop / mobile site', icon: 'home', words: '' },
  { id: 'fillBusiness', title: 'Fill business details', icon: 'star', words: 'form address company' },
  { id: 'backup', title: 'Back up everything', icon: 'download', words: 'export restore' },
  { id: 'panic', title: 'Panic: wipe private tabs', icon: 'panic', words: 'clear history' },
  { id: 'settings', title: 'Settings', icon: 'settings', words: 'preferences' },
]

// Settings pages (ids match SettingsScreen's sections).
export const SETTINGS_PAGES = [
  ['shields', 'Shields & privacy'], ['ai', 'Bitter AI'], ['sync', 'Sync'], ['family', '128bit family'],
  ['search', 'Search engines'], ['homepage', 'Homepage'], ['report', 'Privacy report'], ['sites', 'Site settings'],
  ['downloads', 'Downloads'], ['default', 'Default browser'], ['tabs', 'Tabs and tab groups'], ['media', 'Media'],
  ['appearance', 'Appearance'], ['ntp', 'New tab page'], ['a11y', 'Accessibility / text size'], ['languages', 'Languages'],
  ['passwords', 'Bit Password Manager'], ['autofill', 'Autofill services'], ['cards', 'Payment methods'], ['addresses', 'Addresses'],
  ['business', 'Business details'], ['about', 'About Bit Browser / updates'], ['crash', 'Crash reports'],
].map(([id, title]) => ({ id, title }))

/** Score how well `q` matches `text`: 0 = no match. Whole-word and prefix hits rank higher than scattered letters. */
export function matchScore(q, text, scatter = true) {
  const t = String(text || '').toLowerCase()
  if (!q) return 1
  const i = t.indexOf(q)
  if (i === 0) return 100
  if (i > 0) return /\W/.test(t[i - 1]) ? 80 : 60
  if (!scatter || q.length < 2) return 0
  // Letters in order, close together (e.g. "rdm" → "reader mode").
  let pos = 0
  let start = -1
  for (const ch of q) {
    pos = t.indexOf(ch, pos)
    if (pos < 0) return 0
    if (start < 0) start = pos
    pos++
  }
  return pos - start <= q.length * 2 ? 20 : 0
}

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function CommandBar({ query, tabs = [], onAction, onClose }) {
  const q = String(query || '').replace(/^>\s*/, '').trim().toLowerCase()
  const bookmarks = useBookmarks()
  useStore((s) => s.records.history)

  const results = useMemo(() => {
    const out = []
    const add = (kind, item, score, bonus = 0) => score > 0 && out.push({ kind, score: score + bonus, ...item })
    for (const a of ACTIONS) add('action', { key: `a:${a.id}`, title: a.title, sub: 'Action', icon: a.icon, action: a.id }, Math.max(matchScore(q, a.title), matchScore(q, a.words, false) * 0.8), 5)
    for (const t of tabs) add('tab', { key: `t:${t.id}`, title: t.title || 'New tab', sub: `${t.private ? 'Private tab' : 'Open tab'} · ${hostOf(t.url)}`, icon: 'tabs', action: 'tab', arg: t.id }, Math.max(matchScore(q, t.title), matchScore(q, t.url, false)), 3)
    for (const b of bookmarks) add('bookmark', { key: `b:${b.id}`, title: b.title || b.url, sub: `Bookmark · ${hostOf(b.url)}`, icon: 'star', action: 'open', arg: b.url }, Math.max(matchScore(q, b.title), matchScore(q, b.url, false)))
    if (q)
      for (const r of liveRecords('history').slice(-800))
        add('history', { key: `h:${r.id}`, title: r.data.title || r.data.url, sub: `History · ${hostOf(r.data.url)}`, icon: 'reload', action: 'open', arg: r.data.url }, Math.max(matchScore(q, r.data.title), matchScore(q, r.data.url, false)), -5)
    for (const p of SETTINGS_PAGES) add('settings', { key: `s:${p.id}`, title: p.title, sub: 'Settings', icon: 'settings', action: 'settings', arg: p.id }, matchScore(q, p.title))
    return out.sort((a, b) => b.score - a.score).slice(0, q ? 40 : 14)
  }, [q, tabs, bookmarks])

  const run = (r) => {
    Keyboard.dismiss()
    onAction?.(r.action, r.arg)
    onClose?.()
  }

  return (
    <View style={st.box} accessibilityLabel="Command bar">
      <View style={st.head}>
        <Text style={st.headText} numberOfLines={1}>{q ? `> ${q}` : '> TYPE A TAB, PAGE, SETTING OR ACTION'}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close command bar">
          <PixelIcon name="close" size={12} color={C.muted} />
        </Pressable>
      </View>
      <FlatList
        data={results}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="always"
        renderItem={({ item: r, index }) => (
          <Pressable onPress={() => run(r)} style={({ pressed }) => [st.row, index === 0 && q && st.first, pressed && { backgroundColor: C.edge }]} accessibilityRole="button" accessibilityLabel={`${r.title}, ${r.sub}`}>
            <PixelIcon name={r.icon} size={14} color={r.kind === 'action' ? C.orange : C.teal} />
            <View style={{ flex: 1 }}>
              <Text style={st.title} numberOfLines={1}>{r.title}</Text>
              <Text style={st.sub} numberOfLines={1}>{r.sub}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={st.empty}>Nothing matches “{q}”.</Text>}
      />
    </View>
  )
}

export default memo(CommandBar)

/** The first result's action for the current query — run it when the user presses Go. */
export function firstResult(query, tabs = []) {
  const q = String(query || '').replace(/^>\s*/, '').trim().toLowerCase()
  if (!q) return null
  let best = null
  for (const a of ACTIONS) {
    const s = Math.max(matchScore(q, a.title), matchScore(q, a.words, false) * 0.8) + 5
    if (s > 5 && (!best || s > best.s)) best = { s, action: a.id }
  }
  for (const t of tabs) {
    const s = Math.max(matchScore(q, t.title), matchScore(q, t.url, false)) + 3
    if (s > 3 && (!best || s > best.s)) best = { s, action: 'tab', arg: t.id }
  }
  for (const p of SETTINGS_PAGES) {
    const s = matchScore(q, p.title)
    if (s > 0 && (!best || s > best.s)) best = { s, action: 'settings', arg: p.id }
  }
  return best
}

const st = StyleSheet.create({
  box: { position: 'absolute', left: 8, right: 8, top: 0, maxHeight: 420, backgroundColor: C.panel, borderWidth: 3, borderColor: C.teal, borderRightWidth: 6, borderBottomWidth: 6, borderRightColor: '#05050f', borderBottomColor: '#05050f', zIndex: 50, elevation: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 36, borderBottomWidth: 2, borderBottomColor: C.edge },
  headText: { flex: 1, ...px(7), color: C.teal },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 48, borderBottomWidth: 1, borderBottomColor: C.edge },
  first: { backgroundColor: C.bg },
  title: { color: C.ink, fontSize: 15, lineHeight: 20, includeFontPadding: false },
  sub: { color: C.muted, fontSize: 11, lineHeight: 15, includeFontPadding: false },
  empty: { color: C.muted, padding: 16, textAlign: 'center' },
})
