// Small pixel-styled building blocks.
import { Pressable, Text, TextInput, View, StyleSheet } from 'react-native'
import { C, PIXEL_FONT } from './theme'

export function PText({ style, children, ...rest }) {
  return (
    <Text style={[s.ptext, style]} {...rest}>
      {children}
    </Text>
  )
}

export function PButton({ label, onPress, hot, color, disabled, style, small }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        small && s.small,
        hot && { backgroundColor: color || C.teal, borderColor: C.tealDark },
        disabled && { opacity: 0.4 },
        pressed && { transform: [{ translateX: 1 }, { translateY: 1 }], shadowOffset: { width: 0, height: 0 } },
        style,
      ]}
    >
      <Text style={[s.btnText, small && { fontSize: 7 }, hot && { color: C.bg }]}>{label}</Text>
    </Pressable>
  )
}

/** Pixel slider switch. */
export function PSwitch({ value, onChange, label = 'AI', accessibilityLabel }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel || `${label} ${value ? 'on' : 'off'}`}
      hitSlop={8}
      style={[s.switch, value && { backgroundColor: C.teal, borderColor: C.tealDark }]}
    >
      <View style={[s.knob, value ? { right: 3, backgroundColor: C.bg } : { left: 3 }]} />
      <Text style={[s.switchText, value ? { left: 6, color: C.bg } : { right: 6 }]}>{label}</Text>
    </Pressable>
  )
}

export function Field(props) {
  return <TextInput placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} {...props} style={[s.field, props.style]} />
}

export const s = StyleSheet.create({
  ptext: { fontFamily: PIXEL_FONT, fontSize: 9, color: C.ink, lineHeight: 15 },
  btn: {
    backgroundColor: C.panel,
    borderWidth: 3,
    borderColor: C.edge,
    paddingHorizontal: 10,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#05050f',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 0,
  },
  small: { height: 28, paddingHorizontal: 7 },
  btnText: { fontFamily: PIXEL_FONT, fontSize: 9, color: C.ink },
  switch: { width: 58, height: 32, borderWidth: 3, borderColor: C.edge, backgroundColor: C.bg, justifyContent: 'center' },
  knob: { position: 'absolute', top: 4, width: 18, height: 18, backgroundColor: C.muted },
  switchText: { position: 'absolute', fontFamily: PIXEL_FONT, fontSize: 7, color: C.muted },
  field: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
})
