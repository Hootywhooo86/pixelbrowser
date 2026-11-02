// Settings → Downloads: files saved from web pages.

import { useState } from 'react'
import { View, Text, StyleSheet, Alert, ScrollView, Share } from 'react-native'
import { useDownloads, openDownload, shareDownload, deleteDownload, formatSize, isPdf, openPdf, printDownload, useDownloadLog } from './downloads'
import { PButton, PText } from './ui'
import { C } from './theme'

const run = (fn) => fn().catch((e) => Alert.alert("Couldn't do that", String(e?.message || e)))

/**
 * The downloads list. Inside Settings it's part of the page's scroll view;
 * on its own (Menu → Downloads) pass `scroll` so it scrolls and has padding.
 */
export default function DownloadsScreen({ scroll = false, bottomInset = 0 }) {
  const body = (
    <>
      <DownloadsList />
      <TroubleshootLog />
    </>
  )
  if (!scroll) return body
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottomInset }} keyboardShouldPersistTaps="handled">
      {body}
    </ScrollView>
  )
}

// What sites did when you tapped download buttons: helps explain a download
// that didn't happen. In memory only; shared only if you tap SHARE.
function TroubleshootLog() {
  const log = useDownloadLog()
  const [open, setOpen] = useState(false)
  if (!log.length) return null
  const text = log.map((e) => `${new Date(e.at).toLocaleTimeString()}  ${e.what}  ${e.url}${e.page ? `  (on ${e.page})` : ''}`).join('\n')
  return (
    <View style={{ marginTop: 18, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <PText style={{ color: C.muted, flex: 1 }}>DOWNLOAD LOG</PText>
        <PButton small label={open ? 'HIDE' : 'SHOW'} onPress={() => setOpen(!open)} />
        <PButton small label="SHARE" onPress={() => Share.share({ message: `Bit Browser download log\n\n${text}` }).catch(() => {})} />
      </View>
      {open && <Text style={[st.muted, { fontSize: 11, lineHeight: 15 }]} selectable>{text}</Text>}
    </View>
  )
}

function DownloadsList() {
  const list = useDownloads()
  if (!list.length) {
    return (
      <View style={st.empty}>
        <PText style={{ color: C.muted }}>NO DOWNLOADS YET</PText>
        <Text style={[st.muted, { textAlign: 'center' }]}>Tap a file link on a web page (a shipping label PDF, an APK, a ZIP…) and it's saved here. PDFs open in the viewer.</Text>
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
              {d.status === 'done' && isPdf(d) && <PButton small hot label="VIEW" onPress={() => openPdf(d)} />}
              {d.status === 'done' && isPdf(d) && <PButton small label="PRINT" onPress={() => run(() => printDownload(d))} />}
              {d.status === 'done' && <PButton small hot={!isPdf(d)} label={isPdf(d) ? 'OPEN WITH' : 'OPEN'} onPress={() => run(() => openDownload(d))} />}
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
})
