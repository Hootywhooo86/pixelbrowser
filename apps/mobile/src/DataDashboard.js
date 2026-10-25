// Settings → Shields & privacy → Data on this phone: what Bit Browser keeps,
// roughly how big it is, whether it syncs (end-to-end encrypted), and a
// delete button for each kind.

import { View, Text, StyleSheet, Alert, Platform } from 'react-native'
import { useStore, update, liveRecords } from './store'
import { useDownloads, deleteDownload, formatSize } from './downloads'
import { PButton, PText } from './ui'
import { C, PIXEL_FONT } from './theme'

const sizeOf = (v) => {
  try {
    return JSON.stringify(v ?? null).length
  } catch {
    return 0
  }
}

/** Mark every live record in a collection deleted (the deletion syncs too). */
function wipeCollection(collection) {
  update((s) => {
    const now = Date.now()
    for (const [id, r] of Object.entries(s.records[collection] || {})) {
      if (!r.deleted) s.records[collection][id] = { id, updatedAt: now, deviceId: s.deviceId, deleted: true, data: null }
    }
  })
}

const confirm = (title, text, onYes) =>
  Alert.alert(title, text, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onYes },
  ])

export default function DataDashboard() {
  const s = useStore()
  const downloads = useDownloads()
  const recSize = (c) => sizeOf(s.records[c])

  const rows = [
    {
      id: 'history',
      label: 'History',
      count: liveRecords('history').length,
      size: recSize('history'),
      synced: s.sync.enabled,
      onDelete: () => confirm('Delete all history?', 'Also removed from your synced devices.', () => wipeCollection('history')),
    },
    {
      id: 'memory',
      label: 'Bitter memory',
      count: liveRecords('memory').length,
      size: recSize('memory'),
      synced: s.sync.enabled,
      onDelete: () => confirm('Forget everything Bitter remembers?', 'Also removed from your synced devices.', () => wipeCollection('memory')),
    },
    { id: 'tabs', label: 'Open tabs (for your other devices)', count: liveRecords('tabs').length, size: recSize('tabs'), synced: s.sync.enabled },
    { id: 'passwords', label: 'Saved passwords', count: (s.passwordIndex || []).length, size: null, synced: s.sync.enabled && !!s.syncPasswords, note: 'Encrypted in the phone’s secure storage. Delete them in Bit Password Manager.' },
    { id: 'addresses', label: 'Addresses', count: (s.addressIndex || []).length, size: null, synced: s.sync.enabled && !!s.syncPasswords },
    { id: 'cards', label: 'Payment cards', count: (s.cardIndex || []).length, size: null, synced: s.sync.enabled && !!s.syncCards },
    {
      id: 'downloads',
      label: 'Downloads',
      count: downloads.length,
      sizeText: formatSize(downloads.reduce((sum, d) => sum + (d.size || 0), 0)) || '0 B',
      synced: false,
      onDelete: downloads.length ? () => confirm('Delete all downloads?', 'The files are removed from this phone.', () => downloads.forEach((d) => deleteDownload(d.id).catch(() => {}))) : null,
    },
    {
      id: 'agentLog',
      label: 'Bitter activity log',
      count: (s.agentLog || []).length,
      size: sizeOf(s.agentLog),
      synced: false,
      onDelete: () => confirm('Clear the activity log?', '', () => update((x) => (x.agentLog = []))),
    },
    {
      id: 'events',
      label: '128bit events waiting to send',
      count: (s.family?.queue || []).length,
      size: sizeOf(s.family?.queue),
      synced: false,
      onDelete: () => confirm('Delete waiting 128bit events?', '', () => update((x) => (x.family = { ...x.family, queue: [] }))),
    },
    { id: 'settings', label: 'Settings', count: liveRecords('settings').length, size: recSize('settings'), synced: s.sync.enabled, note: 'Search engine, AI choice, theme, XP. AI keys sync only if you turned that on.' },
  ]

  const total = rows.reduce((sum, r) => sum + (r.size || 0), 0)

  return (
    <View>
      <Text style={st.body}>
        Everything Bit Browser keeps is on this phone. Items marked SYNCED are also on your other devices, encrypted so the sync server can't read them.
      </Text>
      <Text style={[st.muted, { marginTop: 6 }]}>About {formatSize(total) || '0 B'} of browsing data, plus downloads.</Text>
      {rows.map((r) => (
        <View key={r.id} style={st.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={st.title} numberOfLines={2}>{r.label}</Text>
            <Text style={st.muted}>
              {r.count} item{r.count === 1 ? '' : 's'}
              {r.sizeText ? ` · ${r.sizeText}` : r.size ? ` · ${formatSize(r.size)}` : ''}
            </Text>
            {!!r.note && <Text style={st.note}>{r.note}</Text>}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[st.tag, { borderColor: r.synced ? C.teal : C.edge }]}>
              <Text style={[st.tagText, { color: r.synced ? C.teal : C.muted }]}>{r.synced ? 'SYNCED' : 'THIS PHONE'}</Text>
            </View>
            {r.onDelete && <PButton small label="DELETE" disabled={!r.count} onPress={r.onDelete} accessibilityLabel={`Delete ${r.label}`} />}
          </View>
        </View>
      ))}
      <PText style={st.h}>NEVER STORED</PText>
      <Text style={st.body}>• Pages you visit in private tabs</Text>
      <Text style={st.body}>• Anything while the AI slider is off is sent to no AI</Text>
      <Text style={st.body}>• Ad and tracker counts never leave this phone</Text>
    </View>
  )
}

const noPad = Platform.OS === 'android' ? { includeFontPadding: false, textAlignVertical: 'center' } : {}

const st = StyleSheet.create({
  body: { color: C.ink, fontSize: 14, lineHeight: 20 },
  muted: { color: C.muted, fontSize: 13 },
  note: { color: C.muted, fontSize: 12, fontStyle: 'italic' },
  title: { color: C.ink, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.edge },
  tag: { borderWidth: 2, paddingHorizontal: 6, height: 22, justifyContent: 'center' },
  tagText: { fontFamily: PIXEL_FONT, fontSize: 6, lineHeight: 9, ...noPad },
  h: { color: C.teal, marginTop: 22, marginBottom: 8 },
})
