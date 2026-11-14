// QR codes: show one for the page you're on (another phone scans it to open
// the page), or scan one with the camera to open its link.

import { useEffect, useMemo, useState } from 'react'
import { Modal, View, Text, StyleSheet, Share, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import QR from 'qrcode/lib/core/qrcode'
import { PButton, PText } from './ui'
import { C, px } from './theme'

/** Dark/light module grid for `text`, or null when it's too long for a QR code. */
export function qrMatrix(text) {
  try {
    const q = QR.create(String(text), { errorCorrectionLevel: 'M' })
    const n = q.modules.size
    const rows = []
    for (let y = 0; y < n; y++) {
      const row = []
      for (let x = 0; x < n; x++) row.push(!!q.modules.get(y, x))
      rows.push(row)
    }
    return rows
  } catch {
    return null
  }
}

/** A QR code drawn with Views: each row's dark runs are one View, so it stays light. */
export function QrCode({ text, size = 240 }) {
  const rows = useMemo(() => qrMatrix(text), [text])
  if (!rows) return <Text style={st.note}>This address is too long for a QR code.</Text>
  const quiet = 4
  const n = rows.length + quiet * 2
  const cell = Math.max(2, Math.floor(size / n))
  const total = cell * n
  return (
    <View style={{ width: total, height: total, backgroundColor: '#fff', padding: cell * quiet }} accessibilityLabel="QR code for this page">
      {rows.map((row, y) => {
        const runs = []
        let x = 0
        while (x < row.length) {
          const on = row[x]
          let w = 1
          while (x + w < row.length && row[x + w] === on) w++
          runs.push({ on, w })
          x += w
        }
        return (
          <View key={y} style={{ flexDirection: 'row', height: cell }}>
            {runs.map((r, i) => (
              <View key={i} style={{ width: cell * r.w, height: cell, backgroundColor: r.on ? '#0b0b16' : '#fff' }} />
            ))}
          </View>
        )
      })}
    </View>
  )
}

/** mode: 'show' (QR for `url`) or 'scan'. onOpen(url) opens a scanned link in a new tab. */
export default function QrSheet({ visible, mode: startMode = 'show', url, title, onOpen, onClose }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [mode, setMode] = useState(startMode)
  const [found, setFound] = useState(null)
  useEffect(() => {
    if (visible) {
      setMode(startMode)
      setFound(null)
    }
  }, [visible, startMode])
  if (!visible) return null
  const canShow = /^https?:/i.test(url || '')
  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={st.tabs}>
          <PButton small hot={mode === 'show'} label="THIS PAGE" onPress={() => setMode('show')} disabled={!canShow} />
          <PButton small hot={mode === 'scan'} label="SCAN" onPress={() => (setFound(null), setMode('scan'))} />
          <View style={{ flex: 1 }} />
          <PButton small icon="close" accessibilityLabel="Close" onPress={onClose} />
        </View>
        {mode === 'show' ? (
          canShow ? (
            <View style={st.center}>
              <PText style={st.h}>SCAN TO OPEN</PText>
              <QrCode text={url} size={Math.min(width - 48, 320)} />
              <Text style={st.title} numberOfLines={2}>{title || url}</Text>
              <Text style={st.note} numberOfLines={3}>{url}</Text>
              <View style={st.row}>
                <PButton small label="COPY LINK" onPress={() => Clipboard.setStringAsync(url).then(onClose)} />
                <PButton small icon="share" label="SHARE" onPress={() => Share.share({ message: url, title }).catch(() => {})} />
              </View>
            </View>
          ) : (
            <Text style={[st.note, { padding: 24 }]}>Open a website first to get its QR code.</Text>
          )
        ) : found ? (
          <View style={st.center}>
            <PText style={st.h}>QR CODE SAYS</PText>
            <Text style={st.found} selectable numberOfLines={8}>{found}</Text>
            <View style={st.row}>
              {/^https?:\/\//i.test(found) && <PButton hot label="OPEN IN NEW TAB" onPress={() => (onOpen(found), onClose())} />}
              <PButton small label="COPY" onPress={() => Clipboard.setStringAsync(found)} />
              <PButton small label="SCAN AGAIN" onPress={() => setFound(null)} />
            </View>
          </View>
        ) : (
          <Scanner onCode={setFound} />
        )}
      </View>
    </Modal>
  )
}

function Scanner({ onCode }) {
  const [perm, requestPerm] = useCameraPermissions()
  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) requestPerm()
  }, [perm?.granted])
  return (
    <View style={st.cam}>
      {perm?.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => data && onCode(String(data))} />
      ) : (
        <Text style={[st.note, { padding: 24 }]}>Bit Browser needs the camera to scan QR codes. Allow it when Android asks, or in the phone's Settings → Apps → Bit Browser → Permissions.</Text>
      )}
      <PText style={st.scanLabel}>POINT AT A QR CODE</PText>
    </View>
  )
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20 },
  h: { ...px(10), color: C.teal },
  title: { color: C.ink, fontSize: 16, textAlign: 'center' },
  note: { color: C.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  found: { color: C.ink, fontSize: 15, lineHeight: 22, textAlign: 'center', borderWidth: 2, borderColor: C.edge, padding: 12, alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  cam: { flex: 1, margin: 14, backgroundColor: '#000', borderWidth: 3, borderColor: C.teal, overflow: 'hidden' },
  scanLabel: { ...px(8), color: '#fff', position: 'absolute', bottom: 16, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 8 },
})
