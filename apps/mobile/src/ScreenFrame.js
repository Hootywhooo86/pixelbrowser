// Shared frame for the full-screen pages added in 0.5 (aliases, watchers,
// family, sharing, kids): safe-area padding, a pixel header with an icon and
// DONE, and a scrolling body.

import { Modal, View, ScrollView, Text, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PButton, PText } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

export default function ScreenFrame({ visible, onClose, title, icon = 'settings', children, modal = true }) {
  const insets = useSafeAreaInsets()
  const body = (
    <View style={[f.wrap, modal && { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {modal && (
        <View style={f.head}>
          <PixelIcon name={icon} size={16} color={C.orange} />
          <PText style={f.title} numberOfLines={1}>{title}</PText>
          <PButton small label="DONE" onPress={onClose} />
        </View>
      )}
      <ScrollView contentContainerStyle={f.body} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  )
  if (!modal) return body
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {body}
    </Modal>
  )
}

/** Muted paragraph. */
export function Note({ children, style }) {
  return <Text style={[f.note, style]}>{children}</Text>
}

/** Section label in the pixel font. */
export function Label({ children, color = C.teal }) {
  return <PText style={[f.label, { color }]}>{children}</PText>
}

export const f = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  body: { padding: 14, paddingBottom: 48, gap: 10 },
  note: { color: C.muted, fontSize: 13, lineHeight: 19 },
  label: { ...px(8), marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 2, borderColor: C.edge, backgroundColor: C.panel },
  rowTitle: { color: C.ink, fontSize: 15, lineHeight: 20, includeFontPadding: false },
  rowSub: { color: C.muted, fontSize: 12, lineHeight: 16, includeFontPadding: false },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  big: { ...px(16), color: C.ink },
})
