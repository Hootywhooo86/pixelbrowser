// History: everything you visited (not private tabs), newest first and
// grouped by day, with search, delete one, and clear by time range.

import { useMemo, useState } from 'react'
import { Modal, View, Text, Pressable, FlatList, StyleSheet, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStore, liveRecords, putRecord } from './store'
import { PButton, PText, Field } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0)

function dayLabel(t) {
  const today = startOfDay(Date.now())
  const day = startOfDay(t)
  if (day === today) return 'TODAY'
  if (day === today - 86400000) return 'YESTERDAY'
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: day < today - 300 * 86400000 ? 'numeric' : undefined }).toUpperCase()
}

const timeOf = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** Delete history visited at or after `since` (ms). */
export function clearHistorySince(since) {
  for (const r of liveRecords('history')) if ((r.data?.visitedAt || r.updatedAt) >= since) putRecord('history', r.id, null, { deleted: true })
}

export default function HistoryScreen({ visible, onClose, onOpen }) {
  const insets = useSafeAreaInsets()
  useStore((s) => s.records.history)
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    if (!visible) return []
    const q = query.trim().toLowerCase()
    const items = liveRecords('history')
      .filter((r) => r.data?.url && (!q || `${r.data.title} ${r.data.url}`.toLowerCase().includes(q)))
      .map((r) => ({ id: r.id, url: r.data.url, title: r.data.title || r.data.url, at: r.data.visitedAt || r.updatedAt }))
      .sort((a, b) => b.at - a.at)
    const out = []
    let day = null
    for (const it of items) {
      const d = startOfDay(it.at)
      if (d !== day) {
        day = d
        out.push({ key: `d:${d}`, label: dayLabel(it.at) })
      }
      out.push({ key: it.id, it })
    }
    return out
  }, [visible, query, liveRecords('history').length])

  const clear = () =>
    Alert.alert('Clear browsing history', 'Delete history from your devices for…', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Last hour', onPress: () => clearHistorySince(Date.now() - 3600000) },
      { text: 'Today', onPress: () => clearHistorySince(startOfDay(Date.now())) },
      { text: 'All time', style: 'destructive', onPress: () => clearHistorySince(0) },
    ])

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="reload" size={16} color={C.teal} />
          <PText style={st.title}>HISTORY</PText>
          <PButton small label="CLEAR" color={C.pink} onPress={clear} />
          <PButton small label="DONE" onPress={onClose} />
        </View>
        <Field style={st.search} value={query} onChangeText={setQuery} placeholder="Search history" accessibilityLabel="Search history" />
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={st.body}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={24}
          maxToRenderPerBatch={30}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item: r }) =>
            r.label ? (
              <Text style={st.day}>{r.label}</Text>
            ) : (
              <Pressable onPress={() => onOpen(r.it.url)} style={({ pressed }) => [st.row, pressed && { backgroundColor: C.edge }]} accessibilityRole="button">
                <Text style={st.time}>{timeOf(r.it.at)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{r.it.title}</Text>
                  <Text style={st.rowUrl} numberOfLines={1}>{hostOf(r.it.url)}</Text>
                </View>
                <Pressable onPress={() => putRecord('history', r.it.id, null, { deleted: true })} hitSlop={10} accessibilityLabel={`Delete ${r.it.title} from history`} style={st.x}>
                  <PixelIcon name="close" size={12} color={C.muted} />
                </Pressable>
              </Pressable>
            )
          }
          ListEmptyComponent={<Text style={st.empty}>{query ? 'Nothing in your history matches.' : 'No history yet. Private tabs are never saved here.'}</Text>}
        />
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  search: { marginHorizontal: 14, marginTop: 10 },
  body: { padding: 14, paddingBottom: 40 },
  day: { ...px(8), color: C.teal, marginTop: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: C.edge },
  time: { color: C.muted, fontSize: 11, width: 58, includeFontPadding: false },
  rowTitle: { color: C.ink, fontSize: 15, lineHeight: 20, includeFontPadding: false },
  rowUrl: { color: C.muted, fontSize: 12, lineHeight: 16, includeFontPadding: false },
  x: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 40, paddingHorizontal: 10, lineHeight: 20 },
})
