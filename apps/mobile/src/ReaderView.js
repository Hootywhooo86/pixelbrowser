// Reader mode: the article from READER_JS, clean and pixel-themed, with
// text size and font choices remembered on this phone.

import { useEffect, useMemo, useState } from 'react'
import { Modal, View, Text, StyleSheet } from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { PButton } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'
import { readerHtml } from './reader'

const KEY = 'bit-reader-v1'
const SIZES = [14, 16, 18, 20, 23, 26, 30]

export default function ReaderView({ visible, article, onClose, onOpen }) {
  const insets = useSafeAreaInsets()
  const [prefs, setPrefs] = useState({ size: 18, serif: true })

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setPrefs((p) => ({ ...p, ...JSON.parse(raw) })))
      .catch(() => {})
  }, [])

  const change = (patch) =>
    setPrefs((p) => {
      const next = { ...p, ...patch }
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  const step = (dir) => {
    const i = Math.max(0, SIZES.findIndex((s) => s >= prefs.size))
    change({ size: SIZES[Math.min(SIZES.length - 1, Math.max(0, i + dir))] })
  }

  const source = useMemo(() => (article ? { html: readerHtml(article, prefs, C), baseUrl: article.url || 'about:blank' } : null), [article, prefs])
  if (!article) return null

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="home" size={14} color={C.teal} />
          <Text style={st.title} numberOfLines={1}>READER</Text>
          <PButton small label="A-" onPress={() => step(-1)} accessibilityLabel="Smaller text" />
          <PButton small label="A+" onPress={() => step(1)} accessibilityLabel="Bigger text" />
          <PButton small label={prefs.serif ? 'SERIF' : 'SANS'} onPress={() => change({ serif: !prefs.serif })} accessibilityLabel="Switch font" />
          <PButton small hot label="DONE" onPress={onClose} />
        </View>
        <WebView
          style={{ flex: 1, backgroundColor: C.bg }}
          originWhitelist={['*']}
          source={source}
          javaScriptEnabled={false}
          setSupportMultipleWindows={false}
          // Links in the article open as normal tabs.
          onShouldStartLoadWithRequest={(req) => {
            if (req.url === source.baseUrl || /^(data|about):/.test(req.url) || req.url.startsWith(`${source.baseUrl}#`)) return true
            if (/^https?:/i.test(req.url)) onOpen?.(req.url)
            return false
          }}
        />
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(9), color: C.ink },
})
