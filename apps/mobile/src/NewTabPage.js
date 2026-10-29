// The pixel new tab page (url 'bit://newtab'): search, shortcut tiles,
// pinned and synced tabs, Shields and XP stats, and this week's quests.

import { useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, Image, StyleSheet, Alert } from 'react-native'
import { useStore, update, getState } from './store'
import { remoteTabs } from './sync'
import { progressOf } from './xp-core'
import { PText, PCard, PHeader, PProgress } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

// This week's quests come in as a prop (from src/quests.js when it exists):
// [{ id, title, progress, goal }].

export const NEW_TAB_URL = 'bit://newtab'

export const DEFAULT_SHORTCUTS = [
  { title: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
  { title: 'YouTube', url: 'https://m.youtube.com/' },
  { title: 'Gmail', url: 'https://mail.google.com/' },
  { title: 'Shippo', url: 'https://apps.goshippo.com/' },
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'Reddit', url: 'https://www.reddit.com/' },
]

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

const fmt = (n) => Number(n || 0).toLocaleString()

const shortcutsOf = (s) => (Array.isArray(s.ntp?.shortcuts) ? s.ntp.shortcuts : DEFAULT_SHORTCUTS)
const setShortcuts = (list) => update((s) => (s.ntp = { ...(s.ntp || {}), shortcuts: list.slice(0, 16) }))

function toUrl(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  if (/^[^\s]+\.[^\s]{2,}$/.test(t)) return `https://${t}`
  return ''
}

export default function NewTabPage({ onSubmit, onOpen, pinnedTabs = [], onSelectTab, quests }) {
  const s = useStore()
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const shortcuts = shortcutsOf(s)
  const remote = remoteTabs().filter((d) => d.tabs.length)
  const totals = s.shields?.totals || {}
  const xp = progressOf(s.xp?.total || 0)

  const addShortcut = () => {
    const url = toUrl(newUrl)
    if (!url) return Alert.alert('Add shortcut', 'Type a web address, like shippo.com.')
    setShortcuts([...shortcutsOf(getState()).filter((x) => x.url !== url), { title: hostOf(url).replace(/^www\./, ''), url }])
    setNewUrl('')
    setAdding(false)
  }
  const removeShortcut = (sc) =>
    Alert.alert('Remove shortcut?', sc.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setShortcuts(shortcutsOf(getState()).filter((x) => x.url !== sc.url)) },
    ])

  return (
    <ScrollView style={st.wrap} contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
      <View style={st.logoRow}>
        <View style={st.logo}>
          <Text style={st.logoText}>B</Text>
        </View>
        <PText style={st.brand}>BIT BROWSER</PText>
      </View>

      <View style={st.searchBox}>
        <PixelIcon name="search" size={16} color={C.muted} />
        <TextInput
          style={st.search}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => text.trim() && onSubmit(text.trim())}
          placeholder={s.aiEnabled ? 'Search, URL, or ask Bitter' : 'Search or URL'}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="web-search"
          returnKeyType="go"
          accessibilityLabel="Search or type a web address"
        />
      </View>

      <View style={st.tiles}>
        {shortcuts.map((sc) => (
          <Pressable key={sc.url} onPress={() => onOpen(sc.url)} onLongPress={() => removeShortcut(sc)} style={({ pressed }) => [st.tile, pressed && { transform: [{ translateX: 2 }, { translateY: 2 }] }]} accessibilityRole="button" accessibilityLabel={sc.title} accessibilityHint="Long-press to remove">
            <View style={st.tileIcon}>
              <Image source={{ uri: `https://icons.duckduckgo.com/ip3/${hostOf(sc.url)}.ico` }} style={st.favicon} />
            </View>
            <Text style={st.tileText} numberOfLines={1}>{sc.title}</Text>
          </Pressable>
        ))}
        {shortcuts.length < 16 && (
          <Pressable onPress={() => setAdding(!adding)} style={st.tile} accessibilityRole="button" accessibilityLabel="Add a shortcut">
            <View style={[st.tileIcon, { borderStyle: 'dashed' }]}>
              <PixelIcon name="plus" size={16} color={C.teal} />
            </View>
            <Text style={st.tileText}>Add</Text>
          </Pressable>
        )}
      </View>
      {adding && (
        <View style={st.addRow}>
          <TextInput style={[st.search, st.addInput]} value={newUrl} onChangeText={setNewUrl} onSubmitEditing={addShortcut} placeholder="shippo.com" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" autoFocus />
          <Pressable onPress={addShortcut} style={st.addBtn} accessibilityRole="button">
            <Text style={st.addBtnText}>ADD</Text>
          </Pressable>
        </View>
      )}

      {s.ntp?.showStats !== false && (
        <PCard style={st.card}>
          <View style={st.stats}>
            <Stat value={fmt((totals.ads || 0) + (totals.trackers || 0))} label="BLOCKED" color={C.orange} icon="shield" />
            <Stat value={`LV ${xp.level}`} label={`${fmt(s.xp?.streak || 0)} DAY STREAK`} color={C.teal} icon="xp" />
          </View>
          <PProgress value={xp.pct} segments={14} style={{ marginTop: 10 }} />
        </PCard>
      )}

      {quests?.length > 0 && (
        <>
          <PHeader color={C.orange}>QUESTS</PHeader>
          {quests.slice(0, 3).map((q) => (
            <View key={q.id} style={st.quest}>
              <Text style={st.questText} numberOfLines={2}>{q.title || q.label}</Text>
              <PProgress value={q.goal ? Math.min(1, (q.progress || 0) / q.goal) : 0} segments={8} color={C.orange} />
            </View>
          ))}
        </>
      )}

      {pinnedTabs.length > 0 && (
        <>
          <PHeader color={C.orange}>PINNED</PHeader>
          {pinnedTabs.map((t) => (
            <Row key={t.id} title={t.title || t.url} url={t.url} icon="bookmark" onPress={() => onSelectTab?.(t.id)} />
          ))}
        </>
      )}

      {remote.slice(0, 3).map((d) => (
        <View key={d.deviceName}>
          <PHeader>{`ON ${String(d.deviceName || 'YOUR OTHER DEVICE').toUpperCase()}`}</PHeader>
          {d.tabs.slice(0, 5).map((t, i) => (
            <Row key={i} title={t.title || t.url} url={t.url} onPress={() => onOpen(t.url)} />
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

function Stat({ value, label, color, icon }) {
  return (
    <View style={st.stat}>
      <PixelIcon name={icon} size={16} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[st.statValue, { color }]} numberOfLines={1}>{value}</Text>
        <Text style={st.statLabel} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  )
}

function Row({ title, url, icon, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.row, pressed && { backgroundColor: C.edge }]} accessibilityRole="button">
      {icon ? <PixelIcon name={icon} size={14} color={C.orange} /> : <Image source={{ uri: `https://icons.duckduckgo.com/ip3/${hostOf(url)}.ico` }} style={st.favicon} />}
      <Text style={st.rowTitle} numberOfLines={1}>{title}</Text>
    </Pressable>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  body: { padding: 16, paddingBottom: 40 },
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 18, marginBottom: 18 },
  logo: { width: 44, height: 44, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', borderRightWidth: 4, borderBottomWidth: 4, borderColor: C.tealDark },
  logoText: { ...px(18), color: C.bg },
  brand: { ...px(12), color: C.ink },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 12, backgroundColor: C.panel, borderWidth: 3, borderColor: C.teal, borderRightWidth: 6, borderBottomWidth: 6, borderRightColor: C.tealDark, borderBottomColor: C.tealDark },
  search: { flex: 1, height: 44, color: C.ink, fontSize: 16, paddingVertical: 0, includeFontPadding: false, textAlignVertical: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, marginTop: 20, marginHorizontal: -4 },
  tile: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  tileIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, borderRightWidth: 5, borderBottomWidth: 5, borderRightColor: '#05050f', borderBottomColor: '#05050f' },
  favicon: { width: 20, height: 20 },
  tileText: { color: C.ink, fontSize: 11, lineHeight: 14, includeFontPadding: false, textAlign: 'center', maxWidth: 80 },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  addInput: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, paddingHorizontal: 10 },
  addBtn: { height: 44, paddingHorizontal: 14, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { ...px(9), color: C.bg },
  card: { marginTop: 22 },
  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statValue: { ...px(12) },
  statLabel: { color: C.muted, fontSize: 11, lineHeight: 14, includeFontPadding: false, marginTop: 2 },
  quest: { gap: 6, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: C.edge },
  questText: { color: C.ink, fontSize: 14, lineHeight: 19, includeFontPadding: false },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 8, borderBottomWidth: 2, borderBottomColor: C.edge },
  rowTitle: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 19, includeFontPadding: false },
})
