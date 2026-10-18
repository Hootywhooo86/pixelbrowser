// Settings → Downloads: files saved from web pages.

import { View, Text, StyleSheet, Alert } from 'react-native'
import { useDownloads, openDownload, shareDownload, deleteDownload, formatSize } from './downloads'
import { PButton, PText } from './ui'
import { C } from './theme'

const run = (fn) => fn().catch((e) => Alert.alert("Couldn't do that", String(e?.message || e)))

export default function DownloadsScreen() {
  const list = useDownloads()
  if (!list.length) {
    return (
      <View style={st.empty}>
        <PText style={{ color: C.muted }}>NO DOWNLOADS YET</PText>
        <Text style={st.muted}>Tap a file link on a web page (an APK, PDF, ZIP…) and it's saved here.</Text>
      </View>
    )
  }
  return (
    <View style={st.list}>
      {list.map((d) => {
        const pct = Math.round((d.progress || 0) * 100)
        const status =
          d.status === 'downloading' ? `Downloading… ${d.progress ? `${pct}%` : ''}` : d.status === 'failed' ? `Failed${d.error ? `: ${d.error}` : ''}` : formatSize(d.size) || 'Done'
        return (
          <View key={d.id} style={st.item}>
            <Text style={st.name} numberOfLines={2}>{d.filename}</Text>
            <Text style={[st.muted, d.status === 'failed' && { color: C.pink }]} numberOfLines={2}>{status}</Text>
            {d.status === 'downloading' && (
              <View style={st.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
                <View style={[st.fill, { width: `${Math.max(pct, 3)}%` }]} />
              </View>
            )}
            <View style={st.row}>
              {d.status === 'done' && <PButton small hot label="OPEN" onPress={() => run(() => openDownload(d))} />}
              {d.status === 'done' && <PButton small label="SHARE" onPress={() => run(() => shareDownload(d))} />}
              <PButton small label={d.status === 'downloading' ? 'CANCEL' : 'DELETE'} onPress={() => run(() => deleteDownload(d.id))} />
            </View>
          </View>
        )
      })}
    </View>
  )
}

const st = StyleSheet.create({
  empty: { padding: 20, gap: 10, alignItems: 'center' },
  list: { gap: 10 },
  item: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, padding: 10, gap: 6 },
  name: { color: C.ink, fontWeight: '600', fontSize: 15 },
  muted: { color: C.muted, fontSize: 13, textAlign: 'left' },
  bar: { height: 8, backgroundColor: C.bg, borderWidth: 2, borderColor: C.edge },
  fill: { height: '100%', backgroundColor: C.teal },
  row: { flexDirection: 'row', gap: 8, marginTop: 2 },
})
