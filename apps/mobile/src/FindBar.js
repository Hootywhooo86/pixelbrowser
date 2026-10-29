// Find-in-page bar: a pixel search box with "3 / 12", previous, next and close.
// The page side lives in ./find.js.

import { useEffect, useRef, useState } from 'react'
import { View, TextInput, Text, Pressable, StyleSheet, Platform } from 'react-native'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

export default function FindBar({ visible, onQuery, onNext, onPrev, onClose, index = 0, total = 0 }) {
  const [text, setText] = useState('')
  const timer = useRef(null)
  useEffect(() => {
    if (!visible) {
      setText('')
      clearTimeout(timer.current)
    }
  }, [visible])
  if (!visible) return null

  // Search as you type, a beat after the last key.
  const change = (t) => {
    setText(t)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onQuery?.(t), 250)
  }

  return (
    <View style={st.bar}>
      <PixelIcon name="search" size={16} color={C.muted} />
      <TextInput
        style={st.input}
        value={text}
        onChangeText={change}
        onSubmitEditing={() => (text ? onNext?.() : null)}
        placeholder="Find in page"
        placeholderTextColor={C.muted}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        blurOnSubmit={false}
        accessibilityLabel="Find in page"
      />
      <Text style={[st.count, !total && text ? { color: C.pink } : null]} accessibilityLiveRegion="polite">
        {text ? `${index}/${total}` : ''}
      </Text>
      <Btn icon="back" label="Previous match" onPress={onPrev} disabled={!total} />
      <Btn icon="forward" label="Next match" onPress={onNext} disabled={!total} />
      <Btn icon="close" label="Close find" onPress={onClose} />
    </View>
  )
}

function Btn({ icon, label, onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [st.btn, disabled && { opacity: 0.35 }, pressed && { backgroundColor: C.edge }]}>
      <PixelIcon name={icon} size={14} color={C.ink} />
    </Pressable>
  )
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.orange },
  input: { flex: 1, height: 38, backgroundColor: C.bg, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 8, paddingVertical: 0, fontSize: 15, ...(Platform.OS === 'android' ? { includeFontPadding: false, textAlignVertical: 'center' } : {}) },
  count: { ...px(8), color: C.muted, minWidth: 44, textAlign: 'center' },
  btn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg },
})
