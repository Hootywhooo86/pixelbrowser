// Packages: every tracking number you've saved, grouped by carrier. Tap one
// to open the carrier's tracking page; ask Bitter to sum up its status.

import { useMemo, useState } from 'react'
import { Modal, View, Text, Pressable, FlatList, StyleSheet, Alert, Share } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePackages, addPackage, removePackage, labelPackage, carrierFor, CARRIERS } from './packages'
import { PButton, PText, Field, PHeader } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

export default function PackagesScreen({ visible, onClose, onOpen, onAsk }) {
  const insets = useSafeAreaInsets()
  const items = usePackages()
  const [number, setNumber] = useState('')
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState(null)
  const guess = carrierFor(number)

  const rows = useMemo(() => {
    const out = []
    for (const key of Object.keys(CARRIERS)) {
      const list = items.filter((p) => p.carrier === key)
      if (!list.length) continue
      out.push({ key: `h:${key}`, header: `${CARRIERS[key].name.toUpperCase()} · ${list.length}` })
      for (const p of list) out.push({ key: p.id, p })
    }
    return out
  }, [items])

  const add = () => {
    const id = addPackage({ number, label })
    if (!id) return Alert.alert('Not a tracking number', "That doesn't look like a UPS, USPS, FedEx, Canada Post, DHL, Purolator or Amazon tracking number. Check it and try again.")
    setNumber('')
    setLabel('')
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="download" size={16} color={C.orange} />
          <PText style={st.title}>PACKAGES</PText>
          <PButton small label="DONE" onPress={onClose} />
        </View>
        <View style={st.addBox}>
          <Field value={number} onChangeText={setNumber} placeholder="Tracking number" autoCapitalize="characters" accessibilityLabel="Tracking number" />
          <Field value={label} onChangeText={setLabel} placeholder="What is it? (optional)" accessibilityLabel="Package label" style={{ marginTop: 6 }} />
          <View style={st.addRow}>
            <Text style={st.muted} numberOfLines={1}>{number.trim() ? (guess ? `Carrier: ${CARRIERS[guess].name}` : 'Carrier: not recognised yet') : 'Bit Browser also spots tracking numbers on pages for you.'}</Text>
            <PButton small hot icon="plus" label="ADD" onPress={add} disabled={!number.trim()} />
          </View>
        </View>
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={st.body}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: r }) =>
            r.header ? (
              <PHeader color={C.orange} style={{ marginTop: 10 }}>{r.header}</PHeader>
            ) : (
              <Pressable
                onPress={() => onOpen?.(r.p.url)}
                onLongPress={() => setEditing({ id: r.p.id, label: r.p.label || '' })}
                style={({ pressed }) => [st.row, pressed && { backgroundColor: C.edge }]}
                accessibilityRole="button"
                accessibilityLabel={`${r.p.carrierName} ${r.p.number}${r.p.label ? `, ${r.p.label}` : ''}`}
                accessibilityHint="Opens the carrier's tracking page. Long-press to rename."
              >
                <View style={{ flex: 1 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{r.p.label || r.p.number}</Text>
                  <Text style={st.rowSub} numberOfLines={1}>{r.p.label ? `${r.p.number} · ` : ''}{new Date(r.p.addedAt).toLocaleDateString()}</Text>
                </View>
                {onAsk && (
                  <Pressable onPress={() => onAsk(r.p.url, r.p)} hitSlop={8} style={st.icon} accessibilityLabel="Ask Bitter for the status">
                    <PixelIcon name="bitter" size={14} color={C.teal} />
                  </Pressable>
                )}
                <Pressable onPress={() => Share.share({ message: `${r.p.carrierName} tracking ${r.p.number}: ${r.p.url}` })} hitSlop={8} style={st.icon} accessibilityLabel="Share tracking link">
                  <PixelIcon name="share" size={14} color={C.muted} />
                </Pressable>
                <Pressable
                  onPress={() => Alert.alert('Remove package?', r.p.label || r.p.number, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => removePackage(r.p.id) }])}
                  hitSlop={8}
                  style={st.icon}
                  accessibilityLabel="Remove package"
                >
                  <PixelIcon name="close" size={12} color={C.muted} />
                </Pressable>
              </Pressable>
            )
          }
          ListEmptyComponent={<Text style={st.empty}>No packages yet. Add a tracking number above, or open a page with one (like a Shippo label or a shipping email) and tap TRACK.</Text>}
        />
        <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)} statusBarTranslucent>
          <View style={st.scrim}>
            <View style={st.sheet}>
              <PText>NAME THIS PACKAGE</PText>
              <Field value={editing?.label || ''} onChangeText={(t) => setEditing((e) => ({ ...e, label: t }))} placeholder="e.g. Blue lamp for Sam" autoFocus />
              <View style={st.addRow}>
                <PButton small label="CANCEL" onPress={() => setEditing(null)} />
                <PButton small hot label="SAVE" onPress={() => (labelPackage(editing.id, editing.label), setEditing(null))} />
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  addBox: { padding: 14, paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: C.edge },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 },
  muted: { flex: 1, color: C.muted, fontSize: 12, lineHeight: 16 },
  body: { padding: 14, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 2, borderColor: C.edge, backgroundColor: C.panel, marginBottom: 6 },
  rowTitle: { color: C.ink, fontSize: 15, lineHeight: 20, includeFontPadding: false },
  rowSub: { color: C.muted, fontSize: 12, lineHeight: 16, includeFontPadding: false },
  icon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 40, paddingHorizontal: 10, lineHeight: 20 },
  scrim: { flex: 1, backgroundColor: 'rgba(5,5,15,0.7)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, padding: 16, gap: 10 },
})
