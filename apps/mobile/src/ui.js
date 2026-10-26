// Small pixel-styled building blocks: chunky bevelled buttons with hard
// shadows, a square-knob toggle, notched cards, dashed dividers and
// segmented bars. Every pixel-font label goes through px() so it sits in
// the middle of its box instead of overlapping the borders.
import { Pressable, Text, TextInput, View, StyleSheet } from 'react-native'
import { C, PIXEL_FONT, px } from './theme'
import PixelIcon from './PixelIcon'

const SHADOW = 3 // px of hard drop shadow under buttons and cards

/** Pixel-font text. A fontSize in `style` gets a matching line height automatically. */
export function PText({ style, children, ...rest }) {
  const flat = StyleSheet.flatten(style) || {}
  const fit = flat.fontSize && !flat.lineHeight ? { lineHeight: Math.round(flat.fontSize * 1.6) } : null
  return (
    <Text style={[s.ptext, style, fit]} {...rest}>
      {children}
    </Text>
  )
}

/**
 * Chunky pixel button: 3px border, light top-left and dark bottom-right
 * bevel, hard 3px shadow (a View, so Android draws it too). Pressing pushes
 * it into the shadow. Optional `icon` (a PixelIcon name) before the label.
 */
export function PButton({ label, icon, onPress, onLongPress, hot, color, disabled, style, small, accessibilityLabel }) {
  const face = hot ? color || C.teal : C.panel
  const ink = hot ? C.bg : C.ink
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={small ? 6 : 2}
      style={[s.btnWrap, disabled && { opacity: 0.4 }, style]}
    >
      {({ pressed }) => (
        <>
          <View style={[s.btnShadow, small && s.btnShadowSmall]} />
          <View
            style={[
              s.btn,
              small && s.small,
              { backgroundColor: face, borderColor: hot ? C.tealDark : C.edge },
              pressed && s.pressed,
            ]}
          >
            <View style={[s.bevelHi, hot && { backgroundColor: 'rgba(255,255,255,0.35)' }]} />
            <View style={s.bevelLo} />
            {icon ? <PixelIcon name={icon} size={small ? 12 : 16} color={ink} /> : null}
            {label ? (
              <Text numberOfLines={1} style={[s.btnText, small && s.btnTextSmall, { color: ink }]}>
                {label}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  )
}

/** Pixel toggle: a square knob that jumps across a bordered track. */
export function PSwitch({ value, onChange, label = 'AI', accessibilityLabel, disabled }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel || `${label} ${value ? 'on' : 'off'}`}
      hitSlop={8}
      style={[s.switch, value && { backgroundColor: C.teal, borderColor: C.tealDark }, disabled && { opacity: 0.45 }]}
    >
      <View style={[s.knob, value ? { right: 2, backgroundColor: C.bg } : { left: 2 }]}>
        <View style={[s.knobShine, value && { backgroundColor: C.teal }]} />
      </View>
      <Text style={[s.switchText, value ? { left: 5, color: C.bg } : { right: 5 }]}>{label}</Text>
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

/** Bordered pixel panel with notched (cut) corners and a hard shadow. */
export function PCard({ children, style, color, ...rest }) {
  return (
    <View style={[s.cardWrap, style]} {...rest}>
      <View style={s.cardShadow} />
      <View style={[s.card, color && { borderColor: color }]}>{children}</View>
      {/* notches: one pixel-block cut out of each corner */}
      <View style={[s.notch, { top: 0, left: 0 }]} />
      <View style={[s.notch, { top: 0, right: SHADOW }]} />
      <View style={[s.notch, { bottom: SHADOW, left: 0 }]} />
      <View style={[s.notch, { bottom: SHADOW, right: SHADOW }]} />
    </View>
  )
}

/** Dashed pixel line. */
export function PDivider({ color = C.edge, style }) {
  return (
    <View style={[s.divider, style]}>
      {Array.from({ length: 40 }, (_, i) => (
        <View key={i} style={[s.dash, { backgroundColor: color }]} />
      ))}
    </View>
  )
}

/** Segmented XP-style bar. value 0..1. */
export function PProgress({ value = 0, segments = 12, color = C.teal, style }) {
  const on = Math.round(Math.max(0, Math.min(1, value)) * segments)
  return (
    <View style={[s.progress, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      {Array.from({ length: segments }, (_, i) => (
        <View key={i} style={[s.segment, { backgroundColor: i < on ? color : C.bg }]} />
      ))}
    </View>
  )
}

/** Small pixel tag, e.g. <PBadge label="SYNCED" color={C.teal} />. */
export function PBadge({ label, color = C.teal, style }) {
  return (
    <View style={[s.badge, { borderColor: color }, style]}>
      <Text style={[s.badgeText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/** Pixel section header with a little block marker: ■ FILTER LISTS */
export function PHeader({ children, color = C.teal, style }) {
  return (
    <View style={[s.header, style]}>
      <View style={[s.headerBlock, { backgroundColor: color }]} />
      <Text style={[s.headerText, { color }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  )
}

export const s = StyleSheet.create({
  ptext: { ...px(9, 1.6), color: C.ink },

  btnWrap: { paddingRight: SHADOW, paddingBottom: SHADOW },
  btnShadow: { position: 'absolute', left: SHADOW, top: SHADOW, right: 0, bottom: 0, backgroundColor: '#05050f' },
  btnShadowSmall: { left: 2, top: 2 },
  btn: {
    flexGrow: 1,
    flexDirection: 'row',
    gap: 8,
    borderWidth: 3,
    paddingHorizontal: 12,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { minHeight: 32, paddingHorizontal: 9, gap: 6 },
  pressed: { transform: [{ translateX: 2 }, { translateY: 2 }] },
  bevelHi: { position: 'absolute', left: 0, top: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.12)' },
  bevelLo: { position: 'absolute', left: 0, bottom: 0, right: 0, height: 2, backgroundColor: 'rgba(0,0,0,0.35)' },
  btnText: { ...px(9), color: C.ink, textAlign: 'center' },
  btnTextSmall: px(7),

  switch: { width: 60, height: 34, borderWidth: 3, borderColor: C.edge, backgroundColor: C.bg, justifyContent: 'center' },
  knob: { position: 'absolute', top: 2, width: 24, height: 24, backgroundColor: C.muted },
  knobShine: { position: 'absolute', left: 3, top: 3, width: 6, height: 6, backgroundColor: C.ink, opacity: 0.6 },
  switchText: { position: 'absolute', ...px(7), color: C.muted },

  field: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 12, fontSize: 15 },
  fieldSingle: { height: 48, paddingVertical: 0, includeFontPadding: false, textAlignVertical: 'center' },
  fieldMulti: { minHeight: 80, paddingVertical: 10, textAlignVertical: 'top' },

  cardWrap: { paddingRight: SHADOW, paddingBottom: SHADOW },
  cardShadow: { position: 'absolute', left: SHADOW, top: SHADOW, right: 0, bottom: 0, backgroundColor: '#05050f' },
  card: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, padding: 14, gap: 10 },
  notch: { position: 'absolute', width: 3, height: 3, backgroundColor: C.bg },

  divider: { flexDirection: 'row', overflow: 'hidden', height: 3, gap: 4, marginVertical: 10 },
  dash: { width: 6, height: 3 },

  progress: { flexDirection: 'row', gap: 2, height: 14, padding: 2, borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg },
  segment: { flex: 1 },

  badge: { alignSelf: 'flex-start', borderWidth: 2, paddingHorizontal: 5, minHeight: 18, justifyContent: 'center' },
  badgeText: px(6),

  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 8 },
  headerBlock: { width: 8, height: 8 },
  headerText: { ...px(9), flexShrink: 1 },
})

export { PIXEL_FONT }
