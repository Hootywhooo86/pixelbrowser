// Import bookmarks and passwords from Chrome, Brave, Edge and others.

import { useState } from 'react'
import { Modal, View, Text, ScrollView, StyleSheet, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { pickImportFile, readImport, importBookmarks, importPasswords, EXPORT_HELP } from './importer'
import { PButton, PText, PCard, PHeader, PProgress } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

export default function ImportScreen({ visible, onClose }) {
  const insets = useSafeAreaInsets()
  const [found, setFound] = useState(null) // readImport() result
  const [busy, setBusy] = useState(null) // { done, total }
  const [result, setResult] = useState(null)

  const reset = () => {
    setFound(null)
    setBusy(null)
    setResult(null)
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const pick = async () => {
    try {
      setResult(null)
      const file = await pickImportFile()
      if (!file) return
      const info = readImport(file.text, file.name)
      if (info.kind === 'unknown') return Alert.alert("Couldn't read that file", 'Pick a bookmarks export (.html) or a passwords export (.csv).')
      setFound({ ...info, name: file.name })
    } catch (e) {
      Alert.alert("Couldn't open the file", String(e?.message || e))
    }
  }

  const run = async () => {
    const onProgress = (done, total) => setBusy({ done, total })
    setBusy({ done: 0, total: found.items.length })
    try {
      const res = found.kind === 'bookmarks' ? await importBookmarks(found.items, onProgress) : await importPasswords(found.items, onProgress)
      setResult({ kind: found.kind, ...res })
      setFound(null)
    } catch (e) {
      Alert.alert('Import stopped', String(e?.message || e))
    } finally {
      setBusy(null)
    }
  }

  const folderCount = found?.kind === 'bookmarks' ? new Set(found.items.map((b) => b.folder)).size : 0

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="download" size={16} color={C.teal} />
          <PText style={st.title}>IMPORT</PText>
          <PButton small label="DONE" onPress={close} disabled={!!busy} />
        </View>
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <Text style={st.lead}>Bring your bookmarks and passwords from Chrome, Brave, Edge, Firefox, Bitwarden, 1Password or LastPass. Everything stays on this phone, and passwords are stored encrypted.</Text>

          {!found && !busy && <PButton hot icon="download" label="PICK AN EXPORT FILE" onPress={pick} style={{ alignSelf: 'flex-start' }} />}

          {found && !busy && (
            <PCard style={st.card}>
              <PHeader color={C.orange}>{found.kind === 'bookmarks' ? 'BOOKMARKS FOUND' : 'PASSWORDS FOUND'}</PHeader>
              <Text style={st.big}>{found.items.length.toLocaleString()}</Text>
              <Text style={st.muted} numberOfLines={1}>{found.name}</Text>
              {found.kind === 'bookmarks' && <Text style={st.muted}>In {folderCount} folder{folderCount === 1 ? '' : 's'}. Ones you already have are skipped.</Text>}
              {found.kind === 'passwords' && (
                <Text style={st.muted}>
                  {found.skipped ? `${found.skipped} rows without a website or password will be skipped. ` : ''}Logins you already have are skipped.
                </Text>
              )}
              <View style={st.row}>
                <PButton hot label="IMPORT" onPress={run} />
                <PButton label="CANCEL" onPress={reset} />
              </View>
            </PCard>
          )}

          {busy && (
            <PCard style={st.card}>
              <PHeader>IMPORTING…</PHeader>
              <PProgress value={busy.total ? busy.done / busy.total : 0} />
              <Text style={st.muted}>{busy.done.toLocaleString()} of {busy.total.toLocaleString()}</Text>
            </PCard>
          )}

          {result && (
            <PCard style={st.card} color={C.teal}>
              <PHeader color={C.teal}>DONE</PHeader>
              <Text style={st.text}>
                Added {result.added.toLocaleString()} {result.kind === 'bookmarks' ? 'bookmarks' : 'passwords'}
                {result.skipped ? `, skipped ${result.skipped.toLocaleString()} you already had or couldn't use` : ''}.
              </Text>
              {result.kind === 'passwords' && <Text style={st.warn}>Now delete the .csv file from your Downloads and Drive. It isn't encrypted.</Text>}
              <PButton label="IMPORT ANOTHER FILE" onPress={pick} style={{ alignSelf: 'flex-start' }} />
            </PCard>
          )}

          <PHeader style={{ marginTop: 18 }}>HOW TO EXPORT</PHeader>
          {EXPORT_HELP.map((h) => (
            <View key={h.title} style={st.help}>
              <Text style={st.helpTitle}>{h.title}</Text>
              {h.steps.map((s, i) => (
                <Text key={i} style={st.step}>
                  {'• '}
                  {s}
                </Text>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  body: { padding: 16, paddingBottom: 40, gap: 12 },
  lead: { color: C.ink, fontSize: 15, lineHeight: 22 },
  card: { gap: 8 },
  big: { ...px(20), color: C.ink },
  text: { color: C.ink, fontSize: 15, lineHeight: 21 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  warn: { color: C.orange, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  help: { gap: 4, marginBottom: 6 },
  helpTitle: { color: C.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  step: { color: C.muted, fontSize: 13, lineHeight: 19, paddingLeft: 4 },
})
