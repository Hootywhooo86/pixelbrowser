// Tabs screen (Brave-style): a grid of tab cards with thumbnails, search,
// a normal/private switch, Spaces, swipe to close, and tabs from your other
// devices. More columns on tablets and Chromebooks.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, ScrollView, FlatList, Text, TextInput, Pressable, Image, StyleSheet, Animated, PanResponder, Alert, useWindowDimensions, Platform } from 'react-native'
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

/** Which Space a tab belongs to (tabs from before Spaces are in Personal). */
export const spaceOf = (tab) => tab.space || 'personal'

/** Grid columns for a screen width: phones 2, tablets 3, big screens 4. */
export const columnsFor = (width) => (width >= 1000 ? 4 : width >= 700 ? 3 : 2)

const GAP = 12
const PAD = 14

export default function TabsScreen({ visible, tabs, activeId, thumbs = {}, onSelect, onCloseTab, onCloseAll, onNewTab, onOpenUrl, onClose, onSwitchSpace }) {
  useStore() // re-render when synced tabs arrive
  const spaces = useStore((s) => s.spaces || [])
  const activeSpace = useStore((s) => s.activeSpace || 'personal')
  const skin = useStore((s) => s.tabSkin || 'classic')
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

  // Stable callbacks so memoized cards don't redraw when the parent does.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const closeTabRef = useRef(onCloseTab)
  closeTabRef.current = onCloseTab
  const select = useCallback((id) => selectRef.current(id), [])
  const close = useCallback((id) => closeTabRef.current(id), [])

  // Private tabs aren't in a Space; normal tabs show for the current Space.
  // A tab whose Space was deleted shows in the current Space.
  const known = new Set(spaces.map((x) => x.id))
  const spaceFor = (t) => (known.has(spaceOf(t)) ? spaceOf(t) : activeSpace)
  const inView = (t) => !!t.private === privateMode && (privateMode || spaceFor(t) === activeSpace)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tabs.filter((t) => inView(t) && (!q || `${t.title} ${t.url}`.toLowerCase().includes(q)))
  }, [tabs, privateMode, query, activeSpace, spaces])

  const count = tabs.filter(inView).length
  const accent = privateMode ? C.purple : C.teal
  const cols = columnsFor(width - insets.left - insets.right)
  const cardWidth = Math.floor((width - insets.left - insets.right - PAD * 2 - GAP * (cols - 1)) / cols)
  const spaceName = spaces.find((x) => x.id === activeSpace)?.name || 'Personal'
  const remote = privateMode ? [] : remoteTabs()

  const closeAll = () => {
    setMenuOpen(false)
    Alert.alert(privateMode ? 'Close all private tabs?' : `Close all ${spaceName} tabs?`, `${count} tab${count === 1 ? '' : 's'} will close.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close all', style: 'destructive', onPress: () => onCloseAll?.({ private: privateMode, space: privateMode ? undefined : activeSpace }) },
    ])
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, privateMode && { backgroundColor: C.purpleDark }, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
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

        {!privateMode && spaces.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.spaces} contentContainerStyle={st.spacesRow} keyboardShouldPersistTaps="handled">
            {spaces.map((sp) => {
              const on = sp.id === activeSpace
              const n = tabs.filter((t) => !t.private && spaceFor(t) === sp.id).length
              return (
                <Pressable
                  key={sp.id}
                  onPress={() => onSwitchSpace?.(sp.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${sp.name} space, ${n} tabs`}
                  style={({ pressed }) => [st.chip, on && { backgroundColor: C.teal, borderColor: C.tealDark }, pressed && { opacity: 0.8 }]}
                >
                  <Text style={[st.chipText, on && { color: C.bg }]} numberOfLines={1}>{sp.name.toUpperCase()} · {n}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        )}

        <TextInput
          style={st.search}
          value={query}
          onChangeText={setQuery}
          placeholder={privateMode ? 'Search private tabs' : `Search ${spaceName} tabs`}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search your tabs"
        />

        <FlatList
          key={cols} // FlatList can't change its column count in place
          data={shown}
          keyExtractor={(t) => String(t.id)}
          numColumns={cols}
          columnWrapperStyle={cols > 1 ? st.gridRow : undefined}
          contentContainerStyle={st.body}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={8}
          windowSize={5}
          removeClippedSubviews
          extraData={activeId}
          renderItem={({ item: t }) => (
            <TabCard tab={t} width={cardWidth} skin={skin} active={t.id === activeId} thumb={thumbs[t.id]} onSelect={select} onCloseTab={close} />
          )}
          ListEmptyComponent={
            <Text style={st.empty}>{query ? 'No tabs match.' : privateMode ? 'No private tabs. Tap + to open one. Nothing you do in them is saved.' : `No tabs in ${spaceName}. Tap + to open one.`}</Text>
          }
          ListFooterComponent={
            remote.length > 0 ? (
              <View>
                <PText style={st.h}>ON YOUR OTHER DEVICES</PText>
                {remote.map((d) => (
                  <View key={d.deviceName} style={{ marginBottom: 10 }}>
                    <Text style={{ color: C.ink, fontWeight: '700', marginBottom: 4 }} numberOfLines={1}>{d.deviceName}</Text>
                    {d.tabs.map((t, i) => (
                      <Text key={i} style={{ color: C.teal, paddingVertical: 6 }} numberOfLines={1} onPress={() => onOpenUrl(t.url)}>
                        {t.title || t.url}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            ) : null
          }
        />

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

const TabCard = memo(function TabCard({ tab, width, skin, active, thumb, onSelect, onCloseTab }) {
  const x = useRef(new Animated.Value(0)).current
  const onPress = () => onSelect(tab.id)
  const closeRef = useRef(() => onCloseTab(tab.id))
  closeRef.current = () => onCloseTab(tab.id)
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_e, g) => x.setValue(g.dx),
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) > width * 0.45 || Math.abs(g.vx) > 1.2) {
            Animated.timing(x, { toValue: Math.sign(g.dx || 1) * width * 2, duration: 160, useNativeDriver: true }).start(() => closeRef.current())
          } else {
            Animated.spring(x, { toValue: 0, useNativeDriver: true }).start()
          }
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
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
        style={({ pressed }) => [st.card, skin === 'chunky' && st.cardChunky, active && { borderColor: accent }, tab.private && { backgroundColor: C.purpleDark }, pressed && { opacity: 0.85 }]}
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
          <Pressable onPress={() => closeRef.current()} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Close ${tab.title || 'tab'}`} style={st.x}>
            <Text style={st.xText}>X</Text>
          </Pressable>
        </View>
        <View style={[st.thumbBox, { height: Math.round(width * 1.15) }]}>
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
})

const noPad = Platform.OS === 'android' ? { includeFontPadding: false, textAlignVertical: 'center' } : {}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3 },
  segment: { flex: 1, flexDirection: 'row', borderWidth: 3, borderColor: C.edge, backgroundColor: C.bg },
  segBtn: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: PIXEL_FONT, fontSize: 8, lineHeight: 11, color: C.muted, ...noPad },
  count: { minWidth: 36, height: 34, borderWidth: 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countText: { fontFamily: PIXEL_FONT, fontSize: 9, lineHeight: 12, ...noPad },
  search: { marginHorizontal: PAD, marginTop: 10, height: 44, backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 12, paddingVertical: 0, fontSize: 15, ...noPad },
  spaces: { flexGrow: 0, marginTop: 10 },
  spacesRow: { paddingHorizontal: PAD, gap: 8 },
  chip: { height: 32, paddingHorizontal: 10, borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: PIXEL_FONT, fontSize: 7, lineHeight: 10, color: C.muted, ...noPad },
  body: { padding: PAD, paddingBottom: 30 },
  gridRow: { gap: GAP, marginBottom: GAP },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 30, paddingHorizontal: 10 },
  card: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel },
  cardChunky: { borderWidth: 5, shadowColor: '#05050f', shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, height: 32 },
  favicon: { width: 16, height: 16 },
  letterIcon: { alignItems: 'center', justifyContent: 'center' },
  letterIconText: { fontFamily: PIXEL_FONT, fontSize: 7, lineHeight: 10, color: C.bg, ...noPad },
  title: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '600' },
  x: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg },
  xText: { fontFamily: PIXEL_FONT, fontSize: 7, lineHeight: 10, color: C.ink, ...noPad },
  thumbBox: { backgroundColor: '#fff', overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontFamily: PIXEL_FONT, fontSize: 28, lineHeight: 34, ...noPad },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  h: { color: C.teal, marginTop: 22, marginBottom: 8 },
  menu: { position: 'absolute', left: PAD, backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, minWidth: 220 },
  menuItem: { paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.edge },
  menuText: { color: C.ink, fontSize: 15 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: PAD, paddingVertical: 10, backgroundColor: C.panel, borderTopWidth: 3 },
  plus: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.bg },
  plusText: { fontFamily: PIXEL_FONT, fontSize: 24, lineHeight: 28, color: C.bg, marginLeft: 3, ...noPad },
})
