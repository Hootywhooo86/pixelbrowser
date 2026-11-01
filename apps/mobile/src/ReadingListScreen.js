// Reading list: pages saved for later. Opens the offline copy in reader mode
// when this device has it, otherwise the page itself.

import { useState } from 'react'
import { Modal, View, Text, Pressable, FlatList, StyleSheet, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useReadingList, savedArticle, markRead, removeFromList } from './readlater'
import ReaderView from './ReaderView'
import { PButton, PText } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export default function ReadingListScreen({ visible, onClose, onOpen }) {
  const insets = useSafeAreaInsets()
  const items = useReadingList()
  const [reading, setReading] = useState(null) // { id, article }
  const unread = items.filter((i) => !i.readAt).length

  const open = async (item) => {
    const article = item.hasArticle ? await savedArticle(item.id) : null
    if (article) setReading({ id: item.id, article })
    else {
      markRead(item.id)
      onOpen?.(item.url)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="bookmark" size={16} color={C.orange} />
          <PText style={st.title}>READING LIST{unread ? ` · ${unread}` : ''}</PText>
          <PButton small label="DONE" onPress={onClose} />
        </View>
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={st.body}
          renderItem={({ item: i }) => (
            <Pressable onPress={() => open(i)} style={({ pressed }) => [st.row, i.readAt && { opacity: 0.6 }, pressed && { backgroundColor: C.edge }]} accessibilityRole="button" accessibilityLabel={`${i.title}${i.readAt ? ', read' : ''}`}>
              <View style={[st.dot, { backgroundColor: i.readAt ? C.edge : C.orange }]} />
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle} numberOfLines={2}>{i.title}</Text>
                <Text style={st.rowSub} numberOfLines={1}>{[i.siteName || hostOf(i.url), i.hasArticle ? 'saved offline' : null].filter(Boolean).join(' · ')}</Text>
              </View>
              <Pressable onPress={() => markRead(i.id, !i.readAt)} hitSlop={8} style={st.icon} accessibilityLabel={i.readAt ? 'Mark unread' : 'Mark read'}>
                <PixelIcon name={i.readAt ? 'reload' : 'star'} size={12} color={C.muted} />
              </Pressable>
              <Pressable
                onPress={() => Alert.alert('Remove from reading list?', i.title, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => removeFromList(i.id) }])}
                hitSlop={8}
                style={st.icon}
                accessibilityLabel="Remove from reading list"
              >
                <PixelIcon name="close" size={12} color={C.muted} />
              </Pressable>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={st.empty}>Nothing saved yet. On an article, use Menu → Read later to keep it here, even offline.</Text>}
        />
        <ReaderView
          visible={!!reading}
          article={reading?.article}
          onClose={() => {
            if (reading) markRead(reading.id)
            setReading(null)
          }}
          onOpen={(url) => {
            setReading(null)
            onOpen?.(url)
          }}
        />
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  body: { padding: 14, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 2, borderColor: C.edge, backgroundColor: C.panel, marginBottom: 6 },
  dot: { width: 8, height: 8 },
  rowTitle: { color: C.ink, fontSize: 15, lineHeight: 20, includeFontPadding: false },
  rowSub: { color: C.muted, fontSize: 12, lineHeight: 16, includeFontPadding: false },
  icon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 40, paddingHorizontal: 10, lineHeight: 20 },
})
