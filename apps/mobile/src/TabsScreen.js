// Tabs screen (Brave-style): a grid of tab cards with thumbnails, search,
// a normal/private switch, swipe to close, and tabs from your other devices.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, ScrollView, Text, TextInput, Pressable, Image, StyleSheet, Animated, PanResponder, Alert, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStore } from './store'
import { remoteTabs } from './sync'
import { PButton, PText } from './ui'
import { C, PIXEL_FONT } from './theme'

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const letterOf = (tab) => (hostOf(tab.url) || tab.title || '?').charAt(0).toUpperCase()

export default function TabsScreen({ visible, tabs, activeId, thumbs = {}, onSelect, onCloseTab, onCloseAll, onNewTab, onOpenUrl, onClose }) {
  useStore() // re-render when synced tabs arrive
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const active = tabs.find((t) => t.id === activeId)
  const [privateMode, setPrivateMode] = useState(!!active?.private)
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (visible) {
      setPrivateMode(!!tabs.find((t) => t.id === activeId)?.private)
      setQuery('')
      setMenuOpen(false)
    }
  }, [visible])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tabs.filter((t) => !!t.private === privateMode && (!q || `${t.title} ${t.url}`.toLowerCase().includes(q)))
  }, [tabs, privateMode, query])

  const count = tabs.filter((t) => !!t.private === privateMode).length
  const accent = privateMode ? C.purple : C.teal
  const cardWidth = Math.floor((width - 14 * 2 - 12) / 2)
  const remote = privateMode ? [] : remoteTabs()

  const closeAll = () => {
    setMenuOpen(false)
    Alert.alert(privateMode ? 'Close all private tabs?' : 'Close all tabs?', `${count} tab${count === 1 ? '' : 's'} will close.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close all', style: 'destructive', onPress: () => onCloseAll?.({ private: privateMode }) },
    ])
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, privateMode && { backgroundColor: '#120a1f' }, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* top: normal / private + count */}
        <View style={[st.head, { borderBottomColor: accent }]}>
          <View style={st.segment} accessibilityRole="tablist">
            {[
              [false, 'NORMAL'],
              [true, 'PRIVATE'],
            ].map(([isPriv, label]) => {
              const on = privateMode === isPriv
              return (
                <Pressable
                  key={label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${label.toLowerCase()} tabs`}
                  onPress={() => setPrivateMode(isPriv)}
                  style={[st.segBtn, on && { backgroundColor: isPriv ? C.purple : C.teal }]}
                >
                  <Text style={[st.segText, on && { color: C.bg }]}>{label}</Text>
                </Pressable>
              )
            })}
          </View>
          <View style={[st.count, { borderColor: accent }]} accessibilityLabel={`${count} tabs`}>
            <Text style={[st.countText, { color: accent }]}>{count}</Text>
          </View>
        </View>

        <TextInput
          style={st.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search your tabs"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search your tabs"
        />

        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          {!shown.length && (
            <Text style={st.empty}>{query ? 'No tabs match.' : privateMode ? 'No private tabs. Tap + to open one. Nothing you do in them is saved.' : 'No tabs. Tap + to open one.'}</Text>
          )}
          <View style={st.grid}>
            {shown.map((t) => (
              <TabCard
                key={t.id}
                tab={t}
                width={cardWidth}
                active={t.id === activeId}
                thumb={thumbs[t.id]}
                onPress={() => onSelect(t.id)}
                onCloseTab={() => onCloseTab(t.id)}
              />
            ))}
          </View>

          {remote.length > 0 && <PText style={st.h}>ON YOUR OTHER DEVICES</PText>}
          {remote.map((d) => (
            <View key={d.deviceName} style={{ marginBottom: 10 }}>
              <Text style={{ color: C.ink, fontWeight: '700', marginBottom: 4 }}>{d.deviceName}</Text>
              {d.tabs.map((t, i) => (
                <Text key={i} style={{ color: C.teal, paddingVertical: 6 }} numberOfLines={1} onPress={() => onOpenUrl(t.url)}>
                  {t.title || t.url}
                </Text>
              ))}
            </View>
          ))}
        </ScrollView>

        {menuOpen && (
          <View style={[st.menu, { bottom: insets.bottom + 70 }]}>
            <Pressable style={st.menuItem} onPress={closeAll} accessibilityRole="button">
              <Text style={st.menuText}>Close all {privateMode ? 'private ' : ''}tabs</Text>
            </Pressable>
            <Pressable style={st.menuItem} onPress={() => setMenuOpen(false)} accessibilityRole="button" accessibilityHint="Coming soon">
              <Text style={[st.menuText, { color: C.muted }]}>Tab groups (coming soon)</Text>
            </Pressable>
          </View>
        )}

        {/* bottom: menu, big +, done */}
        <View style={[st.bottom, { borderTopColor: accent }]}>
          <PButton label="MENU" hot={menuOpen} onPress={() => setMenuOpen(!menuOpen)} />
          <Pressable
            onPress={() => onNewTab({ private: privateMode })}
            accessibilityRole="button"
            accessibilityLabel={privateMode ? 'New private tab' : 'New tab'}
            style={({ pressed }) => [st.plus, { backgroundColor: accent }, pressed && { transform: [{ translateX: 2 }, { translateY: 2 }] }]}
          >
            <Text style={st.plusText}>+</Text>
          </Pressable>
          <PButton label="DONE" onPress={onClose} />
        </View>
      </View>
    </Modal>
  )
}

function TabCard({ tab, width, active, thumb, onPress, onCloseTab }) {
  const x = useRef(new Animated.Value(0)).current
  const closeRef = useRef(onCloseTab)
  closeRef.current = onCloseTab
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: Animated.event([null, { dx: x }], { useNativeDriver: false }),
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) > width * 0.45 || Math.abs(g.vx) > 1.2) {
            Animated.timing(x, { toValue: Math.sign(g.dx || 1) * width * 2, duration: 160, useNativeDriver: false }).start(() => closeRef.current())
          } else {
            Animated.spring(x, { toValue: 0, useNativeDriver: false }).start()
          }
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: false }).start(),
      }),
    [width]
  )
  const opacity = x.interpolate({ inputRange: [-width, 0, width], outputRange: [0.2, 1, 0.2], extrapolate: 'clamp' })
  const accent = tab.private ? C.purple : C.teal
  const host = hostOf(tab.url)

  return (
    <Animated.View style={{ width, transform: [{ translateX: x }], opacity }} {...pan.panHandlers}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${tab.title || 'New tab'}${active ? ', current tab' : ''}`}
        accessibilityHint="Swipe left or right to close"
        style={[st.card, active && { borderColor: accent }, tab.private && { backgroundColor: C.purpleDark }]}
      >
        <View style={st.cardHead}>
          {!tab.private && host ? (
            <Image source={{ uri: `https://icons.duckduckgo.com/ip3/${host}.ico` }} style={st.favicon} />
          ) : (
            <View style={[st.favicon, st.letterIcon, { backgroundColor: accent }]}>
              <Text style={st.letterIconText}>{letterOf(tab)}</Text>
            </View>
          )}
          <Text style={st.title} numberOfLines={1}>{tab.title || 'New tab'}</Text>
          <Pressable onPress={onCloseTab} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Close ${tab.title || 'tab'}`} style={st.x}>
            <Text style={st.xText}>X</Text>
          </Pressable>
        </View>
        <View style={st.thumbBox}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={st.thumb} resizeMode="cover" />
          ) : (
            <View style={[st.thumb, st.placeholder]}>
              <Text style={[st.placeholderText, { color: accent }]}>{letterOf(tab)}</Text>
            </View>
          )}
          {tab.loading && <View style={[st.loading, { backgroundColor: C.orange }]} />}
        </View>
      </Pressable>
    </Animated.View>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3 },
  segment: { flex: 1, flexDirection: 'row', borderWidth: 3, borderColor: C.edge, backgroundColor: C.bg },
  segBtn: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: PIXEL_FONT, fontSize: 8, color: C.muted },
  count: { minWidth: 36, height: 34, borderWidth: 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countText: { fontFamily: PIXEL_FONT, fontSize: 9 },
  search: { marginHorizontal: 14, marginTop: 10, height: 42, backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 10, fontSize: 15 },
  body: { padding: 14, paddingBottom: 30 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 30, paddingHorizontal: 10 },
  card: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, height: 32 },
  favicon: { width: 16, height: 16 },
  letterIcon: { alignItems: 'center', justifyContent: 'center' },
  letterIconText: { fontFamily: PIXEL_FONT, fontSize: 7, color: C.bg },
  title: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '600' },
  x: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg },
  xText: { fontFamily: PIXEL_FONT, fontSize: 7, color: C.ink },
  thumbBox: { height: 170, backgroundColor: '#fff', overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontFamily: PIXEL_FONT, fontSize: 28 },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  h: { color: C.teal, marginTop: 22, marginBottom: 8 },
  menu: { position: 'absolute', left: 14, backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, minWidth: 220 },
  menuItem: { paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.edge },
  menuText: { color: C.ink, fontSize: 15 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderTopWidth: 3 },
  plus: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.bg },
  plusText: { fontFamily: PIXEL_FONT, fontSize: 24, color: C.bg, marginLeft: 3, marginTop: 3 },
})
