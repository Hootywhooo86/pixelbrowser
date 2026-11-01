// Tabs screen (Brave-style): a grid of tab cards with thumbnails, search,
// a normal/private switch, Spaces, swipe to close, and tabs from your other
// devices. More columns on tablets and Chromebooks.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, ScrollView, FlatList, Text, TextInput, Pressable, Image, StyleSheet, Animated, PanResponder, Alert, useWindowDimensions, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStore, update, getState } from './store'
import { Field } from './ui'
import { remoteTabs } from './sync'
import { PButton, PText } from './ui'
import PixelIcon from './PixelIcon'
import { C, PIXEL_FONT, px } from './theme'

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

// Tab group colors (pixel palette).
export const GROUP_COLORS = ['#2dd4bf', '#ff9f1c', '#ff5d8f', '#c084fc', '#60a5fa', '#a3e635', '#facc15', '#f4f1ff']

/** Groups for a Space: [{ id, name, color, collapsed }], stored in state.tabGroups[space]. */
export const groupsFor = (space) => (getState().tabGroups || {})[space] || []
function saveGroups(space, list) {
  update((s) => (s.tabGroups = { ...(s.tabGroups || {}), [space]: list }))
}

const GAP = 12
const PAD = 14

export default function TabsScreen({ visible, tabs, activeId, thumbs = {}, onSelect, onCloseTab, onCloseAll, onNewTab, onOpenUrl, onClose, onSwitchSpace, onTogglePin, onGroupChange }) {
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
  const allGroups = useStore((s) => s.tabGroups) || {}
  const groups = allGroups[activeSpace] || []
  const [groupFilter, setGroupFilter] = useState(null) // null = all tabs, else a group id
  const [groupEdit, setGroupEdit] = useState(null) // { id?, name, color, tabId? }
  const [cardMenu, setCardMenu] = useState(null) // tab

  useEffect(() => {
    if (visible) {
      setPrivateMode(!!tabs.find((t) => t.id === activeId)?.private)
      setQuery('')
      setMenuOpen(false)
      setGroupFilter(null)
    }
  }, [visible, activeSpace])

  // Stable callbacks so memoized cards don't redraw when the parent does.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const closeTabRef = useRef(onCloseTab)
  closeTabRef.current = onCloseTab
  const pinRef = useRef(onTogglePin)
  pinRef.current = onTogglePin
  const pin = useCallback((id) => pinRef.current?.(id), [])
  const select = useCallback((id) => selectRef.current(id), [])
  const close = useCallback((id) => closeTabRef.current(id), [])
  const openCardMenu = useCallback((tab) => setCardMenu(tab), [])

  // Private tabs aren't in a Space; normal tabs show for the current Space.
  // A tab whose Space was deleted shows in the current Space.
  const known = new Set(spaces.map((x) => x.id))
  const spaceFor = (t) => (known.has(spaceOf(t)) ? spaceOf(t) : activeSpace)
  const inView = (t) => !!t.private === privateMode && (privateMode || spaceFor(t) === activeSpace)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Pinned tabs first, then the rest in the order they were opened.
    const collapsed = new Set(groups.filter((g) => g.collapsed).map((g) => g.id))
    const inGroup = (t) => (groupFilter ? t.group === groupFilter : !(t.group && collapsed.has(t.group)) || !!q)
    return tabs
      .filter((t) => inView(t) && (privateMode || inGroup(t)) && (!q || `${t.title} ${t.url}`.toLowerCase().includes(q)))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
  }, [tabs, privateMode, query, activeSpace, spaces, groupFilter, groups])

  const groupById = Object.fromEntries(groups.map((g) => [g.id, g]))
  const saveGroup = () => {
    const name = String(groupEdit.name || '').trim().slice(0, 30) || 'Group'
    let list = groups
    let id = groupEdit.id
    if (id) list = groups.map((g) => (g.id === id ? { ...g, name, color: groupEdit.color } : g))
    else {
      id = `g${Date.now().toString(36)}`
      list = [...groups, { id, name, color: groupEdit.color, collapsed: false }]
    }
    saveGroups(activeSpace, list)
    if (groupEdit.tabId) onGroupChange?.(groupEdit.tabId, id)
    setGroupEdit(null)
  }
  const deleteGroup = (g) =>
    Alert.alert(`Delete group "${g.name}"?`, 'Its tabs stay open; they just leave the group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          for (const t of tabs) if (t.group === g.id) onGroupChange?.(t.id, null)
          saveGroups(activeSpace, groups.filter((x) => x.id !== g.id))
          if (groupFilter === g.id) setGroupFilter(null)
          setGroupEdit(null)
        },
      },
    ])
  const toggleCollapse = (g) => saveGroups(activeSpace, groups.map((x) => (x.id === g.id ? { ...x, collapsed: !x.collapsed } : x)))

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

        {!privateMode && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.spaces} contentContainerStyle={st.spacesRow} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => setGroupFilter(null)} style={[st.chip, !groupFilter && st.groupOn]} accessibilityRole="button" accessibilityState={{ selected: !groupFilter }}>
              <Text style={[st.chipText, !groupFilter && { color: C.bg }]}>ALL</Text>
            </Pressable>
            {groups.map((g) => {
              const on = groupFilter === g.id
              const n = tabs.filter((t) => !t.private && t.group === g.id).length
              return (
                <Pressable
                  key={g.id}
                  onPress={() => setGroupFilter(on ? null : g.id)}
                  onLongPress={() => setGroupEdit({ id: g.id, name: g.name, color: g.color, collapsed: g.collapsed })}
                  style={[st.chip, { borderColor: g.color }, on && { backgroundColor: g.color }, g.collapsed && !on && { opacity: 0.55 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${g.name} group, ${n} tabs${g.collapsed ? ', collapsed' : ''}`}
                  accessibilityHint="Long-press to rename, recolor, collapse or delete"
                >
                  <Text style={[st.chipText, { color: on ? C.bg : g.color }]} numberOfLines={1}>{g.name.toUpperCase()} · {n}</Text>
                </Pressable>
              )
            })}
            <Pressable onPress={() => setGroupEdit({ name: '', color: GROUP_COLORS[groups.length % GROUP_COLORS.length] })} style={st.chip} accessibilityRole="button" accessibilityLabel="New tab group">
              <Text style={st.chipText}>+ GROUP</Text>
            </Pressable>
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
            <TabCard tab={t} width={cardWidth} skin={skin} active={t.id === activeId} thumb={thumbs[t.id]} groupColor={groupById[t.group]?.color} onSelect={select} onCloseTab={close} onTogglePin={pin} onMenu={openCardMenu} />
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
            {!privateMode && (
              <Pressable style={st.menuItem} onPress={() => (setMenuOpen(false), setGroupEdit({ name: '', color: GROUP_COLORS[groups.length % GROUP_COLORS.length] }))} accessibilityRole="button">
                <Text style={st.menuText}>New tab group</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* long-press a card: pin, group, close */}
        <Modal visible={!!cardMenu} transparent animationType="fade" onRequestClose={() => setCardMenu(null)} statusBarTranslucent>
          <Pressable style={st.scrim} onPress={() => setCardMenu(null)}>
            <View style={st.sheet}>
              <Text style={st.sheetTitle} numberOfLines={1}>{cardMenu?.title || 'Tab'}</Text>
              {!cardMenu?.private && (
                <PButton small icon="bookmark" label={cardMenu?.pinned ? 'UNPIN' : 'PIN'} onPress={() => (pin(cardMenu.id), setCardMenu(null))} />
              )}
              {!cardMenu?.private && (
                <>
                  <Text style={st.sheetLabel}>Add to group</Text>
                  <View style={st.wrapRow}>
                    {groups.map((g) => (
                      <Pressable key={g.id} onPress={() => (onGroupChange?.(cardMenu.id, g.id), setCardMenu(null))} style={[st.chip, { borderColor: g.color }, cardMenu?.group === g.id && { backgroundColor: g.color }]}>
                        <Text style={[st.chipText, { color: cardMenu?.group === g.id ? C.bg : g.color }]}>{g.name.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => (setGroupEdit({ name: '', color: GROUP_COLORS[groups.length % GROUP_COLORS.length], tabId: cardMenu.id }), setCardMenu(null))} style={st.chip}>
                      <Text style={st.chipText}>+ NEW GROUP</Text>
                    </Pressable>
                    {!!cardMenu?.group && (
                      <Pressable onPress={() => (onGroupChange?.(cardMenu.id, null), setCardMenu(null))} style={st.chip}>
                        <Text style={st.chipText}>REMOVE FROM GROUP</Text>
                      </Pressable>
                    )}
                  </View>
                </>
              )}
              {!cardMenu?.pinned && <PButton small icon="close" label="CLOSE TAB" onPress={() => (close(cardMenu.id), setCardMenu(null))} />}
            </View>
          </Pressable>
        </Modal>

        {/* new / edit group */}
        <Modal visible={!!groupEdit} transparent animationType="fade" onRequestClose={() => setGroupEdit(null)} statusBarTranslucent>
          <View style={st.scrim}>
            <View style={st.sheet}>
              <Text style={st.sheetTitle}>{groupEdit?.id ? 'EDIT GROUP' : 'NEW GROUP'}</Text>
              <Field value={groupEdit?.name || ''} onChangeText={(t) => setGroupEdit((g) => ({ ...g, name: t }))} placeholder="Group name, e.g. Shipping" autoFocus={!groupEdit?.id} autoCapitalize="words" />
              <View style={st.wrapRow}>
                {GROUP_COLORS.map((c) => (
                  <Pressable key={c} onPress={() => setGroupEdit((g) => ({ ...g, color: c }))} style={[st.swatch, { backgroundColor: c }, groupEdit?.color === c && st.swatchOn]} accessibilityRole="button" accessibilityLabel={`Color ${c}`} accessibilityState={{ selected: groupEdit?.color === c }} />
                ))}
              </View>
              <View style={st.wrapRow}>
                {groupEdit?.id && <PButton small label={groupEdit.collapsed ? 'EXPAND' : 'COLLAPSE'} onPress={() => (toggleCollapse(groupById[groupEdit.id]), setGroupEdit(null))} />}
                {groupEdit?.id && <PButton small label="DELETE" onPress={() => deleteGroup(groupById[groupEdit.id])} />}
                <View style={{ flex: 1 }} />
                <PButton small label="CANCEL" onPress={() => setGroupEdit(null)} />
                <PButton small hot label="SAVE" onPress={saveGroup} />
              </View>
            </View>
          </View>
        </Modal>

        {/* bottom: menu, big +, done */}
        <View style={[st.bottom, { borderTopColor: accent }]}>
          <PButton icon="menu" label="MENU" hot={menuOpen} onPress={() => setMenuOpen(!menuOpen)} />
          <Pressable
            onPress={() => onNewTab({ private: privateMode })}
            accessibilityRole="button"
            accessibilityLabel={privateMode ? 'New private tab' : 'New tab'}
            style={({ pressed }) => [st.plus, { backgroundColor: accent }, pressed && { transform: [{ translateX: 2 }, { translateY: 2 }] }]}
          >
            <PixelIcon name="plus" size={32} color={C.bg} />
          </Pressable>
          <PButton icon="tabs" label="DONE" onPress={onClose} />
        </View>
      </View>
    </Modal>
  )
}

const TabCard = memo(function TabCard({ tab, width, skin, active, thumb, groupColor, onSelect, onCloseTab, onTogglePin, onMenu }) {
  const x = useRef(new Animated.Value(0)).current
  const onPress = () => onSelect(tab.id)
  const pinnedRef = useRef(!!tab.pinned)
  pinnedRef.current = !!tab.pinned
  const closeRef = useRef(() => onCloseTab(tab.id))
  closeRef.current = () => onCloseTab(tab.id)
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Pinned tabs can't be swiped away; unpin them first.
        onMoveShouldSetPanResponder: (_e, g) => !pinnedRef.current && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
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
        onLongPress={() => (onMenu ? onMenu(tab) : !tab.private && onTogglePin?.(tab.id))}
        accessibilityRole="button"
        accessibilityLabel={`${tab.title || 'New tab'}${tab.pinned ? ', pinned' : ''}${active ? ', current tab' : ''}`}
        accessibilityHint={tab.pinned ? 'Long-press for pin and group options' : 'Swipe left or right to close. Long-press to pin or add to a group'}
        style={({ pressed }) => [st.card, skin === 'chunky' && st.cardChunky, active && { borderColor: accent }, tab.private && { backgroundColor: C.purpleDark }, pressed && { opacity: 0.85 }]}
      >
        {!!groupColor && <View style={[st.groupBar, { backgroundColor: groupColor }]} />}
        <View style={st.cardHead}>
          {!tab.private && host ? (
            <Image source={{ uri: `https://icons.duckduckgo.com/ip3/${host}.ico` }} style={st.favicon} />
          ) : (
            <View style={[st.favicon, st.letterIcon, { backgroundColor: accent }]}>
              <Text style={st.letterIconText}>{letterOf(tab)}</Text>
            </View>
          )}
          <Text style={st.title} numberOfLines={1}>{tab.title || 'New tab'}</Text>
          {!tab.private && (
            <Pressable onPress={() => onTogglePin?.(tab.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={tab.pinned ? `Unpin ${tab.title || 'tab'}` : `Pin ${tab.title || 'tab'}`} style={[st.x, tab.pinned && { backgroundColor: C.orange, borderColor: C.orange }]}>
              <PixelIcon name="bookmark" size={12} color={tab.pinned ? C.bg : C.muted} />
            </Pressable>
          )}
          {!tab.pinned && (
            <Pressable onPress={() => closeRef.current()} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Close ${tab.title || 'tab'}`} style={st.x}>
              <PixelIcon name="close" size={12} color={C.ink} />
            </Pressable>
          )}
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
  segText: { ...px(8), color: C.muted },
  count: { minWidth: 36, height: 34, borderWidth: 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countText: { ...px(9) },
  search: { marginHorizontal: PAD, marginTop: 10, height: 44, backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 12, paddingVertical: 0, fontSize: 15, ...noPad },
  spaces: { flexGrow: 0, marginTop: 10 },
  spacesRow: { paddingHorizontal: PAD, gap: 8 },
  chip: { height: 32, paddingHorizontal: 10, borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  chipText: { ...px(7), color: C.muted },
  body: { padding: PAD, paddingBottom: 30 },
  gridRow: { gap: GAP, marginBottom: GAP },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 30, paddingHorizontal: 10 },
  card: { borderWidth: 3, borderRightWidth: 5, borderBottomWidth: 5, borderColor: C.edge, borderRightColor: '#05050f', borderBottomColor: '#05050f', backgroundColor: C.panel },
  cardChunky: { borderWidth: 5, borderRightWidth: 8, borderBottomWidth: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, height: 32 },
  favicon: { width: 16, height: 16 },
  letterIcon: { alignItems: 'center', justifyContent: 'center' },
  letterIconText: { ...px(7), color: C.bg },
  title: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '600' },
  x: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg },
  xText: { ...px(7), color: C.ink },
  thumbBox: { backgroundColor: '#fff', overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { ...px(28) },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  h: { color: C.teal, marginTop: 22, marginBottom: 8 },
  menu: { position: 'absolute', left: PAD, backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, minWidth: 220 },
  menuItem: { paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.edge },
  menuText: { color: C.ink, fontSize: 15 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: PAD, paddingVertical: 10, backgroundColor: C.panel, borderTopWidth: 3 },
  plus: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.bg, borderRightWidth: 6, borderBottomWidth: 6, borderRightColor: '#05050f', borderBottomColor: '#05050f' },
  plusText: { ...px(24), color: C.bg, marginLeft: 3 },
  groupOn: { backgroundColor: C.teal, borderColor: C.tealDark },
  groupBar: { height: 4 },
  scrim: { flex: 1, backgroundColor: 'rgba(5,5,15,0.7)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, padding: 16, gap: 10 },
  sheetTitle: { ...px(9), color: C.ink },
  sheetLabel: { color: C.muted, fontSize: 12 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  swatch: { width: 34, height: 34, borderWidth: 3, borderColor: C.edge },
  swatchOn: { borderColor: C.ink, transform: [{ scale: 1.1 }] },
})
