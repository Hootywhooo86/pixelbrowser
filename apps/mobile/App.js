// Bit Browser for iPhone and Android.
// Real web engine (WKWebView / Android WebView) inside the pixel shell, with
// the same Comet-style AI and encrypted sync as the desktop app.

import { useEffect, useMemo, useRef, useState } from 'react'
import { View, TextInput, Text, Pressable, StyleSheet, Platform, Linking, Alert, ToastAndroid, LayoutAnimation, UIManager, Modal } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import { WebView } from 'react-native-webview'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ScreenOrientation from 'expo-screen-orientation'
import * as NavigationBar from 'expo-navigation-bar'
import { captureRef } from 'react-native-view-shot'
import * as Crypto from 'expo-crypto'
import { looksLikeQuestion, isAllowedUrl, searchUrlFor, searchHome } from '@pixelbrowser/ai-core'
import { loadStore, getState, putRecord, addHistory, useStore } from './src/store'
import { setAIEnabled, session } from './src/ai'
import { checkForAppUpdate } from './src/updates'
import { startSync } from './src/sync'
import { startDownload, looksLikeDownload, guessFilename } from './src/downloads'
import { CAPTURE_LOGIN_JS, autofillJS, findLogins, saveLogin, hasLogin, startPasswordSync } from './src/passwords'
import { emit } from './src/events'
import AIPanel from './src/AIPanel'
import SettingsScreen from './src/SettingsScreen'
import TabsScreen from './src/TabsScreen'
import DownloadsScreen from './src/DownloadsScreen'
import { PButton, PSwitch } from './src/ui'
import { C, PIXEL_FONT } from './src/theme'

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true)

let nextTabId = 1

const homeUrl = () => getState().homepage || searchHome(getState().searchEngine, getState().customSearchUrl)

/** Search with the engine chosen in Settings (its no-AI version when the AI slider is off). */
const searchFor = (query, aiEnabled) => searchUrlFor(getState().searchEngine, query, { aiEnabled, customUrl: getState().customSearchUrl })

function normalizeInput(input, aiEnabled = true) {
  const text = String(input || '').trim()
  if (!text) return homeUrl()
  if (/^https?:\/\//i.test(text)) return text
  if (/^[^\s]+\.[^\s]{2,}$/.test(text)) return `https://${text}`
  return searchFor(text, aiEnabled)
}

const newTab = (url = homeUrl(), opts = {}) => ({ id: nextTabId++, url, source: url, title: 'New tab', loading: true, canGoBack: false, canGoForward: false, private: !!opts.private })

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

const toast = (text) => (Platform.OS === 'android' ? ToastAndroid.show(text, ToastAndroid.SHORT) : Alert.alert(text))

// Tells the app when a page's video goes full screen.
const FULLSCREEN_JS = `(function(){
  if (window.__bitFs) return; window.__bitFs = true;
  function post(on){ try{ window.ReactNativeWebView.postMessage(JSON.stringify({__bitFullscreen:on})) }catch(e){} }
  function check(){ post(!!(document.fullscreenElement || document.webkitFullscreenElement)) }
  document.addEventListener('fullscreenchange', check);
  document.addEventListener('webkitfullscreenchange', check);
  document.addEventListener('webkitbeginfullscreen', function(){ post(true) }, true);
  document.addEventListener('webkitendfullscreen', function(){ post(false) }, true);
})();`

const INJECTED_JS = `${FULLSCREEN_JS}\n${CAPTURE_LOGIN_JS}\ntrue;`

export default function App() {
  const [ready, setReady] = useState(false)
  const [fontsLoaded] = useFonts({ [PIXEL_FONT]: require('./assets/fonts/PressStart2P-Regular.ttf') })

  useEffect(() => {
    loadStore().then(() => {
      setReady(true)
      startSync()
      startPasswordSync()
    })
  }, [])

  return (
    <SafeAreaProvider style={{ backgroundColor: C.bg }}>
      {!ready || !fontsLoaded ? <View style={{ flex: 1, backgroundColor: C.bg }} /> : <Browser />}
    </SafeAreaProvider>
  )
}

function Browser() {
  useStore((s) => s.deviceName)
  const aiEnabled = useStore((s) => s.aiEnabled)
  const textZoom = useStore((s) => s.textZoom || 100)
  const insets = useSafeAreaInsets()
  const [tabs, setTabs] = useState(() => [newTab()])
  const [activeId, setActiveId] = useState(tabs[0].id)
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiRequest, setAiRequest] = useState(null)
  const [agentActive, setAgentActive] = useState(false)
  const [agentSteps, setAgentSteps] = useState([])
  const [tabsOpen, setTabsOpen] = useState(false)
  const [thumbs, setThumbs] = useState({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [appUpdate, setAppUpdate] = useState(null)
  const [barsHidden, setBarsHidden] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [fillOffer, setFillOffer] = useState(null) // { tabId, login }

  useEffect(() => {
    if (getState().checkUpdates) checkForAppUpdate().then(setAppUpdate)
  }, [])

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const views = useRef({}) // tab id -> WebView
  const pageArea = useRef(null)
  const pending = useRef(new Map()) // script id -> { resolve, reject }
  const lastScrollY = useRef(0)

  const active = tabs.find((t) => t.id === activeId) || tabs[0]
  const patchTab = (id, patch) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const openTab = (url, opts) => {
    const tab = newTab(url, opts)
    setTabs((list) => [...list, tab])
    setActiveId(tab.id)
    if (!tab.private) emit('tab.opened')
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

  // Closes every tab of one kind (normal or private) from the tab grid.
  const closeAllTabs = ({ private: priv = false } = {}) => {
    const keep = tabsRef.current.filter((t) => !!t.private !== priv)
    for (const t of tabsRef.current) if (!!t.private === priv) delete views.current[t.id]
    if (!keep.length) keep.push(newTab())
    setTabs(keep)
    if (!keep.some((t) => t.id === activeRef.current)) setActiveId(keep[keep.length - 1].id)
  }

  const navigate = (id, url) => patchTab(id, { source: url, url, loading: true })

  // Links opened from other apps (Bit Browser as the default browser) open as new tabs.
  useEffect(() => {
    const open = (url) => url && /^https?:/i.test(url) && openTab(url)
    Linking.getInitialURL().then(open).catch(() => {})
    const sub = Linking.addEventListener('url', (e) => open(e.url))
    return () => sub.remove()
  }, [])

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

  const showBars = (show) => {
    if (show === !barsHidden) return
    LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'))
    setBarsHidden(!show)
  }

  // Full-screen video: landscape, no app bars, no system bars. Restored on exit.
  const setVideoFullscreen = async (on) => {
    if (getState().fullscreenVideo === false) return
    setFullscreen(on)
    try {
      if (getState().rotateFullscreen !== false) {
        await ScreenOrientation.lockAsync(on ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP)
      }
      if (Platform.OS === 'android') await NavigationBar.setVisibilityAsync(on ? 'hidden' : 'visible')
    } catch {}
  }

  const offerToSave = async (tab, login) => {
    if (tab.private || getState().offerToSavePasswords === false || !login?.password) return
    if (await hasLogin(login).catch(() => false)) return
    const host = hostOf(login.url)
    Alert.alert('Save password?', `Bit Browser can save the password for ${login.username || 'this account'} on ${host}. It's encrypted on this phone.`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Save', onPress: () => saveLogin(login).then(() => toast('Password saved')).catch(() => {}) },
    ])
  }

  const onMessage = (tab) => (event) => {
    let msg
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }
    if (!msg) return
    if (msg.__bitFullscreen !== undefined) return setVideoFullscreen(!!msg.__bitFullscreen)
    if (msg.__bitLogin) return offerToSave(tab, msg.__bitLogin)
    const waiter = msg.__pixel && pending.current.get(msg.__pixel)
    if (!waiter) return
    pending.current.delete(msg.__pixel)
    msg.ok ? waiter.resolve(msg.v) : waiter.reject(new Error(msg.e))
  }

  const download = (url, extra = {}) => {
    const filename = extra.filename || guessFilename(url)
    toast(`Downloading ${filename}`)
    startDownload({ url, filename, ...extra })
      .then(() => toast(`Downloaded ${filename}. Open it from Menu > Downloads.`))
      .catch((e) => Alert.alert('Download failed', String(e?.message || e)))
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
    if (!active.private && aiEnabled && (q.startsWith('?') || looksLikeQuestion(q))) {
      // Comet-style: results in the tab, AI answer in the panel.
      const question = q.replace(/^\?\s*/, '')
      navigate(active.id, searchFor(question, true))
      setAiOpen(true)
      setAiRequest({ input: question, search: true, includePage: false, nonce: Date.now() })
      return
    }
    navigate(active.id, normalizeInput(q, aiEnabled))
  }

  const openUrl = (url) => {
    if (!isAllowedUrl(url)) return
    setAiOpen(false)
    openTab(url)
  }

  const openTabs = async () => {
    // Snapshot the current page for its card in the tab grid.
    try {
      if (pageArea.current) {
        const uri = await captureRef(pageArea.current, { format: 'jpg', quality: 0.5, width: 360 })
        setThumbs((t) => ({ ...t, [activeRef.current]: uri }))
      }
    } catch {}
    setTabsOpen(true)
  }

  const takeOver = () => {
    setMenuOpen(false)
    if (!aiEnabled) return Alert.alert('AI is off', 'Turn on the AI slider at the top to let Bitter take over.')
    if (active.private) return Alert.alert('Private tab', 'Bitter is off in private tabs.')
    setAiOpen(true)
    setAiRequest({ mode: 'agent', nonce: Date.now() })
  }

  const stopAgent = () => {
    session.stop()
    setAgentActive(false)
  }

  const isPrivate = active.private
  const accent = isPrivate ? C.purple : agentActive ? C.pink : C.teal
  const hint = (text) => () => toast(text)

  return (
    <View style={[st.root, { paddingTop: fullscreen ? 0 : insets.top, paddingBottom: fullscreen ? 0 : insets.bottom }]}>
      <StatusBar style="light" hidden={fullscreen} />

      {/* address bar (slides away while you scroll down) */}
      {!fullscreen && !barsHidden && (
        <View style={[st.top, { borderBottomColor: accent }]}>
          <View style={[st.logo, { backgroundColor: accent }]}>
            <Text style={st.logoText}>B</Text>
          </View>
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
            numberOfLines={1}
            placeholder={aiEnabled ? 'Search, URL, or ask Bitter' : 'Search or URL'}
            placeholderTextColor={C.muted}
            accessibilityLabel="Address and search bar"
          />
          <PSwitch
            value={aiEnabled}
            accessibilityLabel={aiEnabled ? 'AI on. Turn off for private browsing.' : 'AI off. Nothing is sent to any AI.'}
            onChange={(on) => {
              setAIEnabled(on)
              if (!on) {
                setAiOpen(false)
                setAgentActive(false)
              }
            }}
          />
        </View>
      )}
      {!fullscreen && barsHidden && (
        <Pressable onPress={() => showBars(true)} style={[st.mini, { borderBottomColor: accent }]} accessibilityLabel="Show the address bar and buttons">
          <Text style={st.miniText} numberOfLines={1}>{hostOf(active.url) || 'Bit Browser'}</Text>
        </Pressable>
      )}
      {!fullscreen && active.loading && <View style={[st.progress, { backgroundColor: C.orange }]} />}
      {!fullscreen && appUpdate && !barsHidden && (
        <View style={st.update}>
          <Text style={st.updateText}>BIT BROWSER {appUpdate.version} IS OUT</Text>
          <PButton small hot color={C.orange} label="GET IT" onPress={() => Linking.openURL(appUpdate.url)} />
          <PButton small label="X" onPress={() => setAppUpdate(null)} />
        </View>
      )}
      {!fullscreen && fillOffer && fillOffer.tabId === active.id && (
        <View style={st.update}>
          <Text style={[st.updateText, { color: C.teal }]} numberOfLines={1}>FILL PASSWORD FOR {String(fillOffer.login.username || '').toUpperCase()}?</Text>
          <PButton
            small
            hot
            label="FILL"
            onPress={() => {
              views.current[fillOffer.tabId]?.injectJavaScript(autofillJS(fillOffer.login.username, fillOffer.login.password))
              setFillOffer(null)
            }}
          />
          <PButton small label="X" onPress={() => setFillOffer(null)} />
        </View>
      )}

      {/* pages */}
      <View style={[{ flex: 1 }, agentActive && !fullscreen && st.agentFrame]}>
        <View ref={pageArea} collapsable={false} style={{ flex: 1 }}>
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
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction
              textZoom={textZoom}
              injectedJavaScript={INJECTED_JS}
              onMessage={onMessage(t)}
              onScroll={(e) => {
                if (t.id !== activeRef.current) return
                const y = e.nativeEvent.contentOffset?.y || 0
                const dy = y - lastScrollY.current
                lastScrollY.current = y
                if (y < 24) showBars(true)
                else if (dy > 12) showBars(false)
                else if (dy < -12) showBars(true)
              }}
              onShouldStartLoadWithRequest={(req) => {
                if (looksLikeDownload(req.url)) {
                  download(req.url)
                  return false
                }
                return true
              }}
              onFileDownload={(e) => download(e.nativeEvent.downloadUrl)}
              onNavigationStateChange={(nav) => {
                patchTab(t.id, { url: nav.url, title: nav.title || nav.url, loading: nav.loading, canGoBack: nav.canGoBack, canGoForward: nav.canGoForward })
                if (!nav.loading && !t.private) {
                  addHistory(nav.url, nav.title)
                }
              }}
              onLoadEnd={(e) => {
                patchTab(t.id, { loading: false })
                lastScrollY.current = 0
                if (t.private) return
                findLogins(e.nativeEvent.url)
                  .then((list) => list?.length && setFillOffer({ tabId: t.id, login: list[0] }))
                  .catch(() => {})
              }}
            />
          ))}
        </View>
        {agentActive && !fullscreen && (
          <View style={st.agentBar}>
            <View style={{ flex: 1 }}>
              <Text style={st.agentTitle}>BITTER IS DRIVING</Text>
              {agentSteps.slice(-3).map((s, i) => (
                <Text key={i} style={st.agentStep} numberOfLines={1}>{'> '}{s}</Text>
              ))}
            </View>
            <Pressable onPress={stopAgent} style={st.stop} accessibilityRole="button" accessibilityLabel="Stop Bitter">
              <Text style={st.stopText}>STOP</Text>
            </Pressable>
          </View>
        )}
        {aiEnabled && (
          <AIPanel
            browser={browser}
            visible={aiOpen && !fullscreen}
            request={aiRequest}
            onClose={() => setAiOpen(false)}
            onOpenSettings={() => setSettingsOpen(true)}
            onAgent={(on) => {
              setAgentActive(on)
              if (on) setAgentSteps([])
            }}
            onStep={(s) => setAgentSteps((x) => [...x.slice(-20), s])}
            openUrl={openUrl}
          />
        )}
      </View>

      {/* bottom bar: icon + label, long-press for a hint */}
      {!fullscreen && !barsHidden && (
        <View style={[st.bottom, { borderTopColor: accent }]}>
          <BarButton icon="<" label="Back" disabled={!active.canGoBack} onPress={() => views.current[active.id]?.goBack()} onLongPress={hint('Back: the previous page')} />
          <BarButton icon=">" label="Forward" disabled={!active.canGoForward} onPress={() => views.current[active.id]?.goForward()} onLongPress={hint('Forward: the next page')} />
          <BarButton
            icon={active.loading ? 'X' : 'R'}
            label={active.loading ? 'Stop' : 'Reload'}
            onPress={() => (active.loading ? views.current[active.id]?.stopLoading() : views.current[active.id]?.reload())}
            onLongPress={hint('Reload this page, or stop it loading')}
          />
          <BarButton icon={String(tabs.length)} boxed label="Tabs" onPress={openTabs} onLongPress={hint('Tabs: see, search and close your tabs')} />
          {aiEnabled && <BarButton icon="B" label="Bitter" hot={aiOpen} onPress={() => setAiOpen(!aiOpen)} onLongPress={hint('Bitter: ask about this page or let it take over')} />}
          <BarButton icon="..." label="Menu" onPress={() => setMenuOpen(true)} onLongPress={hint('Menu: new tab, downloads, settings')} />
        </View>
      )}

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <Pressable style={st.scrim} onPress={() => setMenuOpen(false)}>
          <View style={[st.menu, { marginBottom: insets.bottom + 70 }]}>
            <MenuItem label="+ NEW TAB" onPress={() => (setMenuOpen(false), openTab(homeUrl()))} />
            <MenuItem label="+ NEW PRIVATE TAB" onPress={() => (setMenuOpen(false), openTab(homeUrl(), { private: true }))} />
            {aiEnabled && <MenuItem label="LET BITTER TAKE OVER" color={C.pink} onPress={takeOver} />}
            <MenuItem label="DOWNLOADS" onPress={() => (setMenuOpen(false), setDownloadsOpen(true))} />
            <MenuItem label="SETTINGS" onPress={() => (setMenuOpen(false), setSettingsOpen(true))} />
          </View>
        </Pressable>
      </Modal>

      <Modal visible={downloadsOpen} animationType="slide" onRequestClose={() => setDownloadsOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <View style={[st.sheet, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={st.sheetHead}>
            <Text style={[st.agentTitle, { flex: 1, color: C.ink }]}>DOWNLOADS</Text>
            <PButton small label="DONE" onPress={() => setDownloadsOpen(false)} />
          </View>
          <DownloadsScreen />
        </View>
      </Modal>

      <TabsScreen
        visible={tabsOpen}
        tabs={tabs}
        activeId={active.id}
        thumbs={thumbs}
        onSelect={(id) => {
          setActiveId(id)
          setTabsOpen(false)
        }}
        onCloseTab={closeTab}
        onCloseAll={closeAllTabs}
        onNewTab={(opts) => {
          openTab(homeUrl(), opts)
          setTabsOpen(false)
        }}
        onOpenUrl={(url) => {
          openTab(url)
          setTabsOpen(false)
        }}
        onClose={() => setTabsOpen(false)}
      />
      <SettingsScreen visible={settingsOpen} onClose={() => setSettingsOpen(false)} openUrl={openUrl} downloadsScreen={<DownloadsScreen />} />
    </View>
  )
}

function BarButton({ icon, label, onPress, onLongPress, disabled, hot, boxed }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Long-press for a hint"
      hitSlop={4}
      style={({ pressed }) => [st.barBtn, disabled && { opacity: 0.35 }, pressed && { backgroundColor: C.edge }]}
    >
      <View style={[st.barIcon, boxed && st.barBoxed, hot && { backgroundColor: C.teal, borderColor: C.tealDark }]}>
        <Text style={[st.barIconText, hot && { color: C.bg }]}>{icon}</Text>
      </View>
      <Text style={st.barLabel}>{label}</Text>
    </Pressable>
  )
}

function MenuItem({ label, onPress, color }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.menuItem, pressed && { backgroundColor: C.edge }]} accessibilityRole="button">
      <Text style={[st.menuText, color && { color }]}>{label}</Text>
    </Pressable>
  )
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.panel },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: C.panel, borderBottomWidth: 3 },
  logo: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: PIXEL_FONT, fontSize: 12, color: C.bg },
  address: { flex: 1, height: 44, backgroundColor: C.bg, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 10, paddingVertical: 0, fontSize: 15, textAlignVertical: 'center', includeFontPadding: false },
  mini: { height: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel, borderBottomWidth: 2 },
  miniText: { color: C.muted, fontSize: 12 },
  progress: { height: 3 },
  update: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#2a1a05', borderBottomWidth: 3, borderBottomColor: C.orange },
  updateText: { flex: 1, fontFamily: PIXEL_FONT, fontSize: 7, color: C.orange },
  page: { flex: 1, backgroundColor: '#fff' },
  agentFrame: { borderWidth: 4, borderColor: C.pink },
  agentBar: { position: 'absolute', left: 8, right: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: '#2a0b18', borderWidth: 3, borderColor: C.pink },
  agentTitle: { fontFamily: PIXEL_FONT, fontSize: 9, color: C.pink, marginBottom: 4 },
  agentStep: { color: C.ink, fontSize: 12 },
  stop: { backgroundColor: C.pink, borderWidth: 3, borderColor: '#a02a55', paddingHorizontal: 16, paddingVertical: 14 },
  stopText: { fontFamily: PIXEL_FONT, fontSize: 12, color: C.bg },
  bottom: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 4, paddingTop: 6, paddingBottom: 6, backgroundColor: C.panel, borderTopWidth: 3 },
  barBtn: { alignItems: 'center', justifyContent: 'center', minWidth: 52, paddingVertical: 2 },
  barIcon: { height: 26, minWidth: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  barBoxed: { borderWidth: 2, borderColor: C.ink },
  barIconText: { fontFamily: PIXEL_FONT, fontSize: 12, color: C.ink },
  barLabel: { color: C.muted, fontSize: 10, marginTop: 2 },
  scrim: { flex: 1, backgroundColor: 'rgba(5,5,15,0.6)', justifyContent: 'flex-end', alignItems: 'flex-end', padding: 10 },
  menu: { width: 250, backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge },
  menuItem: { paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: C.edge },
  menuText: { fontFamily: PIXEL_FONT, fontSize: 9, color: C.ink },
  sheet: { flex: 1, backgroundColor: C.bg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
})
