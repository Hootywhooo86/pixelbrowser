// Bookmarks: search, folders you can fold away, tap to open, long-press to
// rename, move or delete.

import { useMemo, useState } from 'react'
import { Modal, View, Text, Pressable, FlatList, Image, StyleSheet, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBookmarks, folders, renameBookmark, moveBookmark, removeBookmark } from './bookmarks'
import { PButton, PText, Field, PHeader } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export default function BookmarksScreen({ visible, onClose, onOpen }) {
  const insets = useSafeAreaInsets()
  const items = useBookmarks()
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState({}) // folder -> folded
  const [editing, setEditing] = useState(null) // bookmark item

  // One flat list: a header row per folder, then its bookmarks (unless folded).
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = items.filter((b) => !q || `${b.title} ${b.url} ${b.folder}`.toLowerCase().includes(q))
    const out = []
    let folder = null
    for (const b of hits) {
      if (b.folder !== folder) {
        folder = b.folder
        out.push({ key: `f:${folder}`, folder, count: hits.filter((x) => x.folder === folder).length })
      }
      if (q || !closed[folder]) out.push({ key: b.id, b })
    }
    return out
  }, [items, query, closed])

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="bookmark" size={16} color={C.orange} />
          <PText style={st.title}>BOOKMARKS</PText>
          <PButton small label="DONE" onPress={onClose} />
        </View>
        <Field style={st.search} value={query} onChangeText={setQuery} placeholder="Search bookmarks" accessibilityLabel="Search bookmarks" />
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={st.body}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          renderItem={({ item: r }) =>
            r.folder ? (
              <Pressable onPress={() => setClosed((c) => ({ ...c, [r.folder]: !c[r.folder] }))} style={st.folder} accessibilityRole="button" accessibilityLabel={`${r.folder}, ${r.count} bookmarks`}>
                <Text style={st.fold}>{closed[r.folder] && !query ? '+' : '-'}</Text>
                <PHeader color={C.orange} style={{ flex: 1, marginVertical: 0 }}>{`${r.folder.toUpperCase()} · ${r.count}`}</PHeader>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => onOpen(r.b.url)}
                onLongPress={() => setEditing(r.b)}
                style={({ pressed }) => [st.row, pressed && { backgroundColor: C.edge }]}
                accessibilityRole="button"
                accessibilityHint="Long-press to rename, move or delete"
              >
                <Image source={{ uri: `https://icons.duckduckgo.com/ip3/${hostOf(r.b.url)}.ico` }} style={st.favicon} />
                <View style={{ flex: 1 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{r.b.title || r.b.url}</Text>
                  <Text style={st.rowUrl} numberOfLines={1}>{hostOf(r.b.url)}</Text>
                </View>
                <Pressable onPress={() => setEditing(r.b)} hitSlop={10} accessibilityLabel={`Edit ${r.b.title}`} style={st.more}>
                  <PixelIcon name="menu" size={12} color={C.muted} />
                </Pressable>
              </Pressable>
            )
          }
          ListEmptyComponent={
            <Text style={st.empty}>{query ? 'No bookmarks match.' : 'No bookmarks yet. Open a page and use Menu → Bookmark this page.'}</Text>
          }
        />
        <EditBookmark item={editing} onDone={() => setEditing(null)} />
      </View>
    </Modal>
  )
}

function EditBookmark({ item, onDone }) {
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [shownFor, setShownFor] = useState(null)
  if (item && shownFor !== item.id) {
    setShownFor(item.id)
    setTitle(item.title || '')
    setFolder(item.folder)
    setNewFolder('')
  }
  if (!item) return null
  const save = () => {
    if (title.trim() && title !== item.title) renameBookmark(item.id, title)
    const target = newFolder.trim() || folder
    if (target !== item.folder) moveBookmark(item.id, target)
    onDone()
  }
  const remove = () =>
    Alert.alert('Delete bookmark?', item.title || item.url, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => (removeBookmark(item.id), onDone()) },
    ])
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <Pressable style={st.scrim} onPress={onDone}>
        <Pressable style={st.sheet} onPress={() => {}}>
          <PHeader>EDIT BOOKMARK</PHeader>
          <Text style={st.label}>Name</Text>
          <Field value={title} onChangeText={setTitle} placeholder="Name" />
          <Text style={st.label}>Folder</Text>
          <View style={st.chips}>
            {folders().map((f) => (
              <Pressable key={f} onPress={() => (setFolder(f), setNewFolder(''))} style={[st.chip, folder === f && !newFolder && { borderColor: C.orange, backgroundColor: C.bg }]}>
                <Text style={[st.chipText, folder === f && !newFolder && { color: C.orange }]} numberOfLines={1}>{f}</Text>
              </Pressable>
            ))}
          </View>
          <Field value={newFolder} onChangeText={setNewFolder} placeholder="…or a new folder" />
          <View style={st.actions}>
            <PButton small label="DELETE" color={C.pink} onPress={remove} />
            <View style={{ flex: 1 }} />
            <PButton small label="CANCEL" onPress={onDone} />
            <PButton small hot label="SAVE" onPress={save} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  search: { marginHorizontal: 14, marginTop: 10 },
  body: { padding: 14, paddingBottom: 40 },
  folder: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, paddingBottom: 6 },
  fold: { ...px(10), color: C.orange, width: 14, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 2, borderColor: C.edge, backgroundColor: C.panel, marginBottom: 6 },
  favicon: { width: 18, height: 18 },
  rowTitle: { color: C.ink, fontSize: 15, lineHeight: 20, includeFontPadding: false },
  rowUrl: { color: C.muted, fontSize: 12, lineHeight: 16, includeFontPadding: false },
  more: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 40, paddingHorizontal: 10, lineHeight: 20 },
  scrim: { flex: 1, backgroundColor: 'rgba(5,5,15,0.7)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, padding: 16, gap: 8 },
  label: { color: C.muted, fontSize: 12, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { height: 32, paddingHorizontal: 10, borderWidth: 2, borderColor: C.edge, justifyContent: 'center', maxWidth: 180 },
  chipText: { color: C.ink, fontSize: 13, includeFontPadding: false },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
})
