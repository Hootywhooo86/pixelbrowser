// Tab switcher: your tabs, private tabs, and tabs open on your other devices.

import { Modal, View, ScrollView, Text, Pressable, StyleSheet } from 'react-native'
import { useStore } from './store'
import { remoteTabs } from './sync'
import { PButton, PText } from './ui'
import { C } from './theme'

export default function TabsSheet({ visible, tabs, activeId, onSelect, onClose, onCloseTab, onNewTab, onOpenUrl }) {
  useStore() // re-render when synced tabs arrive
  const remote = remoteTabs()
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={st.wrap}>
        <View style={st.head}>
          <PText style={{ flex: 1 }}>TABS ({tabs.length})</PText>
          <PButton small label="+ PRIVATE" onPress={() => onNewTab({ private: true })} />
          <PButton small hot label="+ TAB" onPress={() => onNewTab({})} />
          <PButton small label="DONE" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={st.body}>
          {tabs.map((t) => (
            <Pressable key={t.id} onPress={() => onSelect(t.id)} style={[st.tab, t.id === activeId && { borderColor: t.private ? C.purple : C.teal }, t.private && { backgroundColor: C.purpleDark }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontWeight: '600' }} numberOfLines={1}>{t.private ? '[PRIVATE] ' : ''}{t.title || 'New tab'}</Text>
                <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>{t.url}</Text>
              </View>
              <PButton small label="X" onPress={() => onCloseTab(t.id)} />
            </Pressable>
          ))}
          {remote.length > 0 && <PText style={st.h}>ON YOUR OTHER DEVICES</PText>}
          {remote.map((d) => (
            <View key={d.deviceName} style={{ marginBottom: 10 }}>
              <Text style={{ color: C.ink, fontWeight: '700', marginBottom: 4 }}>{d.deviceName}</Text>
              {d.tabs.map((t, i) => (
                <Text key={i} style={{ color: C.teal, paddingVertical: 4 }} numberOfLines={1} onPress={() => onOpenUrl(t.url)}>
                  {t.title || t.url}
                </Text>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 14, paddingTop: 20, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  body: { padding: 14, gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, padding: 10 },
  h: { color: C.teal, marginTop: 18, marginBottom: 8 },
})
