// Pixelbrowser for iPhone and Android.
// Real web engine (WKWebView / Android WebView) inside the pixel shell, with
// the same Comet-style AI and encrypted sync as the desktop app.

import { useEffect, useMemo, useRef, useState } from 'react'
import { View, TextInput, Text, Pressable, StyleSheet, SafeAreaView, Platform, StatusBar as RNStatusBar } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import { WebView } from 'react-native-webview'
import * as Crypto from 'expo-crypto'
import { looksLikeQuestion, isAllowedUrl } from '@pixelbrowser/ai-core'
import { loadStore, getState, putRecord, addHistory, useStore } from './src/store'
import { startSync } from './src/sync'
import AIPanel from './src/AIPanel'
import SettingsSheet from './src/SettingsSheet'
import TabsSheet from './src/TabsSheet'
import { PButton } from './src/ui'
import { C, PIXEL_FONT } from './src/theme'

const HOME_URL = 'https://duckduckgo.com'
let nextTabId = 1

function normalizeInput(input) {
  const text = String(input || '').trim()
  if (!text) return HOME_URL
  if (/^https?:\/\//i.test(text)) return text
  if (/^[^\s]+\.[^\s]{2,}$/.test(text)) return `https://${text}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`
}

const newTab = (url = HOME_URL, opts = {}) => ({ id: nextTabId++, url, source: url, title: 'New tab', loading: true, canGoBack: false, canGoForward: false, private: !!opts.private })

export default function App() {
  const [ready, setReady] = useState(false)
  const [fontsLoaded] = useFonts({ [PIXEL_FONT]: require('./assets/fonts/PressStart2P-Regular.ttf') })

  useEffect(() => {
    loadStore().then(() => {
      setReady(true)
      startSync()
    })
  }, [])

  if (!ready || !fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.bg }} />
  return <Browser />
}

function Browser() {
  useStore((s) => s.deviceName)
  const [tabs, setTabs] = useState(() => [newTab()])
  const [activeId, setActiveId] = useState(tabs[0].id)
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiRequest, setAiRequest] = useState(null)
  const [agentActive, setAgentActive] = useState(false)
  const [tabsOpen, setTabsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const views = useRef({}) // tab id -> WebView
  const pending = useRef(new Map()) // script id -> { resolve, reject }

  const active = tabs.find((t) => t.id === activeId) || tabs[0]
  const patchTab = (id, patch) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const openTab = (url, opts) => {
    const tab = newTab(url, opts)
    setTabs((list) => [...list, tab])
    setActiveId(tab.id)
    return tab.id
  }

  const closeTab = (id) => {
    const list = tabsRef.current.filter((t) => t.id !== id)
    delete views.current[id]
    if (!list.length) {
      const t = newTab()
      setTabs([t])
      setActiveId(t.id)
      return
    }
    setTabs(list)
    if (activeRef.current === id) setActiveId(list[list.length - 1].id)
  }

  const navigate = (id, url) => patchTab(id, { source: url, url, loading: true })

  // The browser API the shared AI agent drives.
  const browser = useMemo(
    () => ({
      tabs: () => tabsRef.current,
      activeId: () => activeRef.current,
      isLoading: (id) => !!tabsRef.current.find((t) => t.id === id)?.loading,
      navigate: (id, url) => navigate(id, url),
      goBack: (id) => views.current[id]?.goBack(),
      openTab: (url) => openTab(url),
      selectTab: (id) => setActiveId(id),
      run: (id, script) =>
        new Promise((resolve, reject) => {
          const view = views.current[id]
          if (!view) return reject(new Error(`Tab ${id} is not open.`))
          const rid = Crypto.randomUUID()
          pending.current.set(rid, { resolve, reject })
          const post = (body) => `window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({__pixel:${JSON.stringify(rid)}},${body})))`
          view.injectJavaScript(
            `(function(){try{var r=(${script});Promise.resolve(r).then(function(v){${post('{ok:true,v:v}')}},function(e){${post('{ok:false,e:String(e)}')}})}catch(e){${post('{ok:false,e:String(e)}')}}})();true;`
          )
          setTimeout(() => {
            if (pending.current.delete(rid)) reject(new Error('The page did not respond.'))
          }, 10000)
        }),
    }),
    []
  )

  const onMessage = (event) => {
    let msg
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }
    const waiter = msg?.__pixel && pending.current.get(msg.__pixel)
    if (!waiter) return
    pending.current.delete(msg.__pixel)
    msg.ok ? waiter.resolve(msg.v) : waiter.reject(new Error(msg.e))
  }

  // Share open (non-private) tabs with your other devices, encrypted.
  useEffect(() => {
    const t = setTimeout(() => {
      const s = getState()
      putRecord('tabs', s.deviceId, {
        deviceName: s.deviceName,
        tabs: tabs.filter((x) => !x.private && /^https?:/.test(x.url)).map((x) => ({ title: x.title, url: x.url })),
      })
    }, 3000)
    return () => clearTimeout(t)
  }, [tabs.map((t) => t.url).join('|')])

  const go = (text) => {
    setEditing(false)
    const q = String(text || '').trim()
    if (!active.private && (q.startsWith('?') || looksLikeQuestion(q))) {
      // Comet-style: results in the tab, AI answer in the panel.
      const question = q.replace(/^\?\s*/, '')
      navigate(active.id, `https://duckduckgo.com/?q=${encodeURIComponent(question)}`)
      setAiOpen(true)
      setAiRequest({ input: question, search: true, includePage: false, nonce: Date.now() })
      return
    }
    navigate(active.id, normalizeInput(q))
  }

  const openUrl = (url) => {
    if (!isAllowedUrl(url)) return
    setAiOpen(false)
    openTab(url)
  }

  const isPrivate = active.private
  const accent = isPrivate ? C.purple : agentActive ? C.pink : C.teal

  return (
    <SafeAreaView style={[st.root, { paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 }]}>
      <StatusBar style="light" />
      {/* address bar */}
      <View style={[st.top, { borderBottomColor: accent }]}>
        <View style={[st.logo, { backgroundColor: accent }]}>
          <Text style={st.logoText}>P</Text>
        </View>
        {agentActive && <Text style={st.agent}>AGENT</Text>}
        <TextInput
          style={st.address}
          value={editing ? address : active.url}
          onFocus={() => {
            setEditing(true)
            setAddress(active.url)
          }}
          onBlur={() => setEditing(false)}
          onChangeText={setAddress}
          onSubmitEditing={(e) => go(e.nativeEvent.text)}
          selectTextOnFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="web-search"
          returnKeyType="go"
          placeholder="Search, URL, or ask AI"
          placeholderTextColor={C.muted}
        />
      </View>
      {active.loading && <View style={[st.progress, { backgroundColor: C.orange }]} />}

      {/* pages */}
      <View style={{ flex: 1 }}>
        {tabs.map((t) => (
          <WebView
            key={t.id}
            ref={(r) => {
              if (r) views.current[t.id] = r
            }}
            source={{ uri: t.source }}
            style={[st.page, t.id !== active.id && { display: 'none' }]}
            incognito={t.private}
            thirdPartyCookiesEnabled={false}
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures
            onMessage={onMessage}
            onNavigationStateChange={(nav) => {
              patchTab(t.id, { url: nav.url, title: nav.title || nav.url, loading: nav.loading, canGoBack: nav.canGoBack, canGoForward: nav.canGoForward })
              if (!nav.loading && !t.private) addHistory(nav.url, nav.title)
            }}
            onLoadEnd={() => patchTab(t.id, { loading: false })}
          />
        ))}
        <AIPanel
          browser={browser}
          visible={aiOpen}
          request={aiRequest}
          onClose={() => setAiOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onAgent={setAgentActive}
          openUrl={openUrl}
        />
      </View>

      {/* bottom bar */}
      <View style={[st.bottom, { borderTopColor: accent }]}>
        <PButton label="<" disabled={!active.canGoBack} onPress={() => views.current[active.id]?.goBack()} />
        <PButton label=">" disabled={!active.canGoForward} onPress={() => views.current[active.id]?.goForward()} />
        <PButton label={active.loading ? 'X' : 'R'} onPress={() => (active.loading ? views.current[active.id]?.stopLoading() : views.current[active.id]?.reload())} />
        <PButton label={String(tabs.length)} onPress={() => setTabsOpen(true)} />
        <PButton label="AI" hot={aiOpen} onPress={() => setAiOpen(!aiOpen)} />
        <PButton label="SET" onPress={() => setSettingsOpen(true)} />
      </View>

      <TabsSheet
        visible={tabsOpen}
        tabs={tabs}
        activeId={active.id}
        onSelect={(id) => {
          setActiveId(id)
          setTabsOpen(false)
        }}
        onCloseTab={closeTab}
        onNewTab={(opts) => {
          openTab(HOME_URL, opts)
          setTabsOpen(false)
        }}
        onOpenUrl={(url) => {
          openTab(url)
          setTabsOpen(false)
        }}
        onClose={() => setTabsOpen(false)}
      />
      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} openUrl={openUrl} />
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: C.panel, borderBottomWidth: 3 },
  logo: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: PIXEL_FONT, fontSize: 11, color: C.bg },
  agent: { fontFamily: PIXEL_FONT, fontSize: 7, color: C.bg, backgroundColor: C.pink, paddingHorizontal: 5, paddingVertical: 4 },
  address: { flex: 1, height: 38, backgroundColor: C.bg, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 8, fontSize: 14 },
  progress: { height: 3 },
  page: { flex: 1, backgroundColor: '#fff' },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, backgroundColor: C.panel, borderTopWidth: 3 },
})
