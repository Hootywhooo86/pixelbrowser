// Small pixel-styled building blocks.
import { Pressable, Text, TextInput, View, StyleSheet, Platform } from 'react-native'
import { C, PIXEL_FONT } from './theme'

export function PText({ style, children, ...rest }) {
  return (
    <Text style={[s.ptext, style]} {...rest}>
      {children}
    </Text>
  )
}

export function PButton({ label, onPress, onLongPress, hot, color, disabled, style, small, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={small ? 6 : 2}
      style={({ pressed }) => [
        s.btn,
        small && s.small,
        hot && { backgroundColor: color || C.teal, borderColor: C.tealDark },
        disabled && { opacity: 0.4 },
        pressed && s.pressed,
        style,
      ]}
    >
      <Text numberOfLines={1} style={[s.btnText, small && s.btnTextSmall, hot && { color: C.bg }]}>{label}</Text>
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
  return (
    <TextInput
      placeholderTextColor={C.muted}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[s.field, props.multiline ? s.fieldMulti : s.fieldSingle, props.style]}
    />
  )
}

// The pixel font sits high in its line box on Android; these keep its
// letters centered in buttons and labels.
const noPad = Platform.OS === 'android' ? { includeFontPadding: false, textAlignVertical: 'center' } : {}

export const s = StyleSheet.create({
  ptext: { fontFamily: PIXEL_FONT, fontSize: 9, color: C.ink, lineHeight: 15, ...noPad },
  btn: {
    backgroundColor: C.panel,
    borderWidth: 3,
    borderColor: C.edge,
    paddingHorizontal: 12,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#05050f',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 0,
  },
  small: { minHeight: 30, paddingHorizontal: 8 },
  pressed: { transform: [{ translateX: 1 }, { translateY: 1 }], shadowOffset: { width: 0, height: 0 }, opacity: 0.85 },
  btnText: { fontFamily: PIXEL_FONT, fontSize: 9, lineHeight: 12, color: C.ink, textAlign: 'center', ...noPad },
  btnTextSmall: { fontSize: 7, lineHeight: 10 },
  switch: { width: 58, height: 32, borderWidth: 3, borderColor: C.edge, backgroundColor: C.bg, justifyContent: 'center' },
  knob: { position: 'absolute', top: 4, width: 18, height: 18, backgroundColor: C.muted },
  switchText: { position: 'absolute', fontFamily: PIXEL_FONT, fontSize: 7, lineHeight: 10, color: C.muted, ...noPad },
  field: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 12, fontSize: 15 },
  fieldSingle: { height: 46, paddingVertical: 0, ...noPad },
  fieldMulti: { minHeight: 80, paddingVertical: 10, textAlignVertical: 'top' },
})
