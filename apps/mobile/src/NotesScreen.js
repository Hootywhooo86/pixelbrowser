// Notes: clips and notes, grouped by Space, with search, edit, share and delete.

import { useMemo, useState } from 'react'
import { Modal, View, Text, Pressable, FlatList, StyleSheet, Alert, Share, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNotes, addNote, updateNote, removeNote } from './notes'
import { useStore } from './store'
import { PButton, PText, Field } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export default function NotesScreen({ visible, onClose, onOpen }) {
  const insets = useSafeAreaInsets()
  const spaces = useStore((s) => s.spaces || [])
  const activeSpace = useStore((s) => s.activeSpace || 'personal')
  const [space, setSpace] = useState(null) // null = all spaces
  const notes = useNotes(space)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // { id?, text }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes.filter((n) => !q || `${n.text} ${n.title} ${n.url}`.toLowerCase().includes(q))
  }, [notes, query])
  const spaceName = (id) => spaces.find((x) => x.id === id)?.name || id

  const save = () => {
    const text = editing.text.trim()
    if (editing.id) updateNote(editing.id, { text })
    else if (text) addNote({ text, space: space || activeSpace })
    setEditing(null)
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="star" size={16} color={C.orange} />
          <PText style={st.title}>NOTES</PText>
          <PButton small icon="plus" label="NEW" onPress={() => setEditing({ text: '' })} />
          <PButton small label="DONE" onPress={onClose} />
        </View>
        <ScrollView horizontal style={st.chips} contentContainerStyle={st.chipRow} showsHorizontalScrollIndicator={false}>
          {[{ id: null, name: 'All' }, ...spaces].map((sp) => (
            <Pressable key={sp.id || 'all'} onPress={() => setSpace(sp.id)} style={[st.chip, space === sp.id && st.chipOn]} accessibilityRole="button" accessibilityState={{ selected: space === sp.id }}>
              <Text style={[st.chipText, space === sp.id && { color: C.bg }]} numberOfLines={1}>{sp.name.toUpperCase()}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Field style={st.search} value={query} onChangeText={setQuery} placeholder="Search notes" accessibilityLabel="Search notes" />
        <FlatList
          data={shown}
          keyExtractor={(n) => n.id}
          contentContainerStyle={st.body}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: n }) => (
            <Pressable onPress={() => setEditing({ id: n.id, text: n.text })} style={({ pressed }) => [st.card, pressed && { backgroundColor: C.edge }]} accessibilityRole="button" accessibilityHint="Tap to edit">
              {!!n.text && <Text style={st.text} numberOfLines={6}>{n.text}</Text>}
              <View style={st.metaRow}>
                <Text style={st.meta} numberOfLines={1}>
                  {[n.url && (n.title || hostOf(n.url)), !space && spaceName(n.space), new Date(n.editedAt).toLocaleDateString()].filter(Boolean).join(' · ')}
                </Text>
                {!!n.url && (
                  <Pressable onPress={() => onOpen?.(n.url)} hitSlop={8} style={st.icon} accessibilityLabel="Open the page this came from">
                    <PixelIcon name="forward" size={12} color={C.teal} />
                  </Pressable>
                )}
                <Pressable onPress={() => Share.share({ message: [n.text, n.url].filter(Boolean).join('\n\n') })} hitSlop={8} style={st.icon} accessibilityLabel="Share note">
                  <PixelIcon name="share" size={12} color={C.muted} />
                </Pressable>
                <Pressable
                  onPress={() => Alert.alert('Delete note?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => removeNote(n.id) }])}
                  hitSlop={8}
                  style={st.icon}
                  accessibilityLabel="Delete note"
                >
                  <PixelIcon name="close" size={12} color={C.muted} />
                </Pressable>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={st.empty}>{query ? 'No notes match.' : 'No notes yet. Highlight text on a page and choose "Save to notes", use Menu → Save page to notes, or tap NEW.'}</Text>}
        />
        <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)} statusBarTranslucent>
          <View style={st.scrim}>
            <View style={st.sheet}>
              <PText>{editing?.id ? 'EDIT NOTE' : 'NEW NOTE'}</PText>
              <Field value={editing?.text || ''} onChangeText={(t) => setEditing((e) => ({ ...e, text: t }))} multiline autoFocus style={st.editor} placeholder="Write anything…" autoCapitalize="sentences" autoCorrect />
              <View style={st.actions}>
                <PButton small label="CANCEL" onPress={() => setEditing(null)} />
                <PButton small hot label="SAVE" onPress={save} />
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
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  chips: { flexGrow: 0, marginTop: 10 },
  chipRow: { paddingHorizontal: 14, gap: 8 },
  chip: { height: 32, paddingHorizontal: 10, borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: C.teal, borderColor: C.tealDark },
  chipText: { ...px(7), color: C.muted },
  search: { marginHorizontal: 14, marginTop: 10 },
  body: { padding: 14, paddingBottom: 40 },
  card: { borderWidth: 2, borderColor: C.edge, backgroundColor: C.panel, padding: 10, marginBottom: 8, gap: 6 },
  text: { color: C.ink, fontSize: 15, lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { flex: 1, color: C.muted, fontSize: 12, lineHeight: 16 },
  icon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 40, paddingHorizontal: 10, lineHeight: 20 },
  scrim: { flex: 1, backgroundColor: 'rgba(5,5,15,0.7)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, padding: 16, gap: 10 },
  editor: { minHeight: 160, textAlignVertical: 'top', paddingTop: 10 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
})
