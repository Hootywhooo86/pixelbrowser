// Bit Browser for iPhone and Android.
// Real web engine (WKWebView / Android WebView) inside the pixel shell, with
// the same Comet-style AI and encrypted sync as the desktop app.

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { View, TextInput, Text, Pressable, StyleSheet, Platform, Linking, Alert, ToastAndroid, Modal, ScrollView, AppState, Dimensions, useWindowDimensions } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import { WebView } from 'react-native-webview'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ScreenOrientation from 'expo-screen-orientation'
import * as NavigationBar from 'expo-navigation-bar'
import { captureRef } from 'react-native-view-shot'
import * as Crypto from 'expo-crypto'
import { looksLikeQuestion, isAllowedUrl, searchUrlFor, searchHome } from '@pixelbrowser/ai-core'
import { loadStore, getState, putRecord, addHistory, useStore, update, liveRecords } from './src/store'
import { setAIEnabled, session } from './src/ai'
import { checkForAppUpdate } from './src/updates'
import { startSync } from './src/sync'
import { startDownload, looksLikeDownload, guessFilename } from './src/downloads'
import { CAPTURE_LOGIN_JS, autofillJS, findLogins, saveLogin, hasLogin, startPasswordSync, unlock } from './src/passwords'
import { emit } from './src/events'
import { initShields, useShieldsScript, siteScript, isBlocked, handleShieldsMessage, useBlockedCount, notePageLoaded, siteShieldsOn, setSiteShields } from './src/shields'
import { initPhishing, isDangerous, allowOnce } from './src/phishing'
import AIPanel from './src/AIPanel'
import SettingsScreen from './src/SettingsScreen'
import TabsScreen from './src/TabsScreen'
import DownloadsScreen from './src/DownloadsScreen'
import { PButton, PSwitch } from './src/ui'
import { C, PIXEL_FONT, isLightTheme } from './src/theme'
import { award, onXpEvent } from './src/xp'
import { play } from './src/sounds'

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

const newTab = (url = homeUrl(), opts = {}) => ({ id: nextTabId++, url, source: url, title: 'New tab', loading: true, canGoBack: false, canGoForward: false, private: !!opts.private, space: opts.space || getState().activeSpace || 'personal' })

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

// Phones stay upright; tablets and Chromebooks turn freely.
const lockForDevice = () => {
  const { width, height } = Dimensions.get('screen')
  return Math.min(width, height) < 600
    ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    : ScreenOrientation.unlockAsync()
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
  // Tell the app while a video is playing, so the bars don't move under it.
  var playing = 0;
  function vid(){ try{ var n=0; document.querySelectorAll('video').forEach(function(v){ if(!v.paused && !v.ended && v.readyState>2 && v.offsetHeight>80) n++ }); if((n>0)!==(playing>0)){ playing=n; window.ReactNativeWebView.postMessage(JSON.stringify({__bitVideo:n>0})) } playing=n }catch(e){} }
  ['playing','pause','ended','emptied'].forEach(function(t){ document.addEventListener(t, vid, true) });
})();`

// Autoplay control (Settings → Media): 'off' pauses videos that start on
// their own, 'muted' lets them play without sound, 'on' leaves them alone.
const autoplayJS = (mode) => `(function(){
  if (window.__bitAutoplay) return; window.__bitAutoplay = true;
  var mode = ${JSON.stringify(mode)}, lastTouch = 0;
  ['touchstart','pointerdown','keydown','click'].forEach(function(t){ document.addEventListener(t, function(){ lastTouch = Date.now() }, true) });
  document.addEventListener('play', function(e){
    var v = e.target; if (!v || v.tagName !== 'VIDEO' && v.tagName !== 'AUDIO') return;
    if (Date.now() - lastTouch < 1500) return;
    if (mode === 'off') { try { v.pause() } catch(_){} }
    else if (mode === 'muted' && !v.muted) { v.muted = true }
  }, true);
})();`

const injectedJS = (autoplay) => `${FULLSCREEN_JS}\n${autoplay === 'on' ? '' : autoplayJS(autoplay)}\n${CAPTURE_LOGIN_JS}\ntrue;`

const PAUSE_MEDIA_JS = `document.querySelectorAll('video,audio').forEach(function(m){try{m.pause()}catch(e){}});true;`

const TRACKER_PAGE = /^https?:\/\/(www\.|m\.)?(imdb\.com\/title\/tt\d+|themoviedb\.org\/(movie|tv)\/\d+)/i

export default function App() {
  const [ready, setReady] = useState(false)
  const [fontsLoaded] = useFonts({ [PIXEL_FONT]: require('./assets/fonts/PressStart2P-Regular.ttf') })

  useEffect(() => {
    loadStore().then(() => {
      setReady(true)
      startSync()
      startPasswordSync()
      initShields().catch(() => {})
      initPhishing().catch(() => {})
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
  const autoplay = useStore((s) => s.autoplay || 'muted')
  const activeSpace = useStore((s) => s.activeSpace || 'personal')
  const familyLinks = useStore((s) => s.familyLinks || {})
  const hideBarsOnScroll = useStore((s) => !!s.hideBarsOnScroll)
  const shieldsJS = useShieldsScript()
  const shieldsOn = useStore((s) => s.shields?.enabled !== false)
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const wide = width >= 700 // tablets and Chromebooks
  const [locked, setLocked] = useState(false) // private tabs hidden until fingerprint/face
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
    lockForDevice().catch(() => {})
    award('dailyVisit')
    return onXpEvent(({ levelUp, level, newBadges }) => {
      if (levelUp) toast(`Level up! You're level ${level}.`)
      else if (newBadges?.length) toast(`Badge unlocked: ${newBadges.map((b) => b.name || b.label || b.id || b).join(', ')}`)
    })
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
    play('tab')
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
    if (activeRef.current === id) {
      const space = getState().activeSpace || 'personal'
      const same = list.filter((t) => (t.space || 'personal') === space)
      setActiveId((same.length ? same : list)[(same.length ? same : list).length - 1].id)
    }
  }

  // Closes every private tab, or every normal tab in one Space, from the tab grid.
  const closeAllTabs = ({ private: priv = false, space } = {}) => {
    const goes = (t) => !!t.private === priv && (priv || !space || (t.space || 'personal') === space)
    const closing = tabsRef.current.filter(goes)
    const keep = tabsRef.current.filter((t) => !goes(t))
    for (const t of closing) delete views.current[t.id]
    if (!priv && closing.length) award('tabCleaned', closing.length)
    if (!keep.length) keep.push(newTab())
    setTabs(keep)
    if (!keep.some((t) => t.id === activeRef.current)) setActiveId(keep[keep.length - 1].id)
  }

  const navigate = (id, url) => patchTab(id, { source: url, url, loading: true })

  // Spaces: each Space has its own tabs (and Bitter memory). Switching shows
  // that Space's tabs, opening a fresh one if it has none.
  const spaceTabs = tabs.filter((t) => (t.space || 'personal') === activeSpace)
  const switchSpace = (id) => {
    update((s) => (s.activeSpace = id))
    const mine = tabsRef.current.filter((t) => (t.space || 'personal') === id)
    if (mine.length) setActiveId(mine[mine.length - 1].id)
    else openTab(homeUrl(), { space: id })
  }

  // Panic button: close every private tab and wipe recent history.
  const panic = () => {
    const wipe = (minutes) => {
      const cutoff = minutes ? Date.now() - minutes * 60000 : new Date().setHours(0, 0, 0, 0)
      for (const r of liveRecords('history')) if ((r.data?.visitedAt || r.updatedAt) >= cutoff) putRecord('history', r.id, null, { deleted: true })
      closeAllTabs({ private: true })
      setThumbs({})
      toast('Private tabs closed and recent history wiped')
    }
    Alert.alert('Panic button', 'Close all private tabs and delete history from the last…', [
      { text: 'Cancel', style: 'cancel' },
      { text: '15 minutes', onPress: () => wipe(15) },
      { text: '1 hour', onPress: () => wipe(60) },
      { text: 'Today', onPress: () => wipe(0) },
    ])
  }

  // Private tab lock: private tabs need your fingerprint/face to show again
  // after you leave the app or come back to them from a normal tab.
  const unlockPrivate = async () => {
    if (await unlock('Unlock your private tabs').catch(() => false)) setLocked(false)
  }
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' && getState().privateLock && tabsRef.current.some((t) => t.private)) setLocked(true)
    })
    return () => sub.remove()
  }, [])
  const prevPrivate = useRef(false)
  useEffect(() => {
    const isPriv = !!tabsRef.current.find((t) => t.id === activeId)?.private
    if (isPriv && !prevPrivate.current && getState().privateLock) setLocked(true)
    prevPrivate.current = isPriv
  }, [activeId])

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
      run: async (id, script) => {
        // Bitter can read a sleeping tab: wake it and wait for its page.
        if (!views.current[id] && tabsRef.current.some((t) => t.id === id)) {
          patchTab(id, { loading: true })
          setAwake((a) => (a.includes(id) ? a : [...a.slice(-2), id]))
          for (let i = 0; i < 50 && (!views.current[id] || tabsRef.current.find((t) => t.id === id)?.loading !== false); i++) await new Promise((r) => setTimeout(r, 200))
        }
        return new Promise((resolve, reject) => {
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
        })
      },
    }),
    []
  )

  // Hide/show the bars only on a deliberate scroll, never while a video
  // plays, and hold still briefly after each change so the page settles.
  const barsHiddenRef = useRef(false)
  const scrollRun = useRef(0)
  const barsLockedUntil = useRef(0)
  const videoPlaying = useRef(false)
  const showBars = (show) => {
    if (show === !barsHiddenRef.current) return
    if (!show && videoPlaying.current) return
    barsHiddenRef.current = !show
    barsLockedUntil.current = Date.now() + 600
    scrollRun.current = 0
    setBarsHidden(!show)
  }

  // Only the current tab and the two before it keep a live page. Older
  // normal tabs are put to sleep (no memory, no CPU) and reload where they
  // were when you come back. Private tabs stay live, since they can't be
  // restored. Hidden live tabs have their videos and sounds paused.
  const recent = useRef([])
  recent.current = [activeId, ...recent.current.filter((id) => id !== activeId && tabs.some((t) => t.id === id))].slice(0, 3)
  const [awake, setAwake] = useState([]) // sleeping tabs Bitter woke up to read
  const live = [...recent.current, ...awake]
  useEffect(() => {
    for (const [id, view] of Object.entries(views.current)) {
      if (Number(id) !== activeId) view?.injectJavaScript(PAUSE_MEDIA_JS)
    }
  }, [activeId])

  // A different tab starts with the bars showing.
  useEffect(() => {
    videoPlaying.current = false
    lastScrollY.current = 0
    showBars(true)
  }, [activeId])

  // Full-screen video: landscape, no app bars, no system bars. Restored on exit.
  const setVideoFullscreen = async (on) => {
    if (getState().fullscreenVideo === false) return
    setFullscreen(on)
    try {
      if (getState().rotateFullscreen !== false) {
        if (on) await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
        else await lockForDevice()
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
    if (handleShieldsMessage(msg, tab.url)) return
    if (msg.__bitFullscreen !== undefined) return setVideoFullscreen(!!msg.__bitFullscreen)
    if (msg.__bitVideo !== undefined) {
      videoPlaying.current = !!msg.__bitVideo && tab.id === activeRef.current
      return
    }
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
        tabs: tabs.filter((x) => !x.private && /^https?:/.test(x.url)).map((x) => ({ title: x.title, url: x.url, space: x.space || 'personal' })),
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

  const openTabs = () => {
    // Open right away; the page snapshot for its card arrives a moment later.
    setTabsOpen(true)
    const id = activeRef.current
    if (pageArea.current)
      captureRef(pageArea.current, { format: 'jpg', quality: 0.5, width: 360 })
        .then((uri) => setThumbs((t) => ({ ...t, [id]: uri })))
        .catch(() => {})
  }

  const takeOver = () => {
    setMenuOpen(false)
    if (!aiEnabled) return Alert.alert('AI is off', 'Turn on the AI slider at the top to let Bitter take over.')
    if (active.private) return Alert.alert('Private tab', 'Bitter is off in private tabs.')
    setAiOpen(true)
    setAiRequest({ mode: 'agent', nonce: Date.now() })
  }

  const explain = (text) => {
    const clean = String(text || '').trim().slice(0, 2000)
    if (!clean) return
    if (!aiEnabled) return Alert.alert('AI is off', 'Turn on the AI slider to ask Bitter.')
    if (active.private) return Alert.alert('Private tab', 'Bitter is off in private tabs.')
    setAiOpen(true)
    setAiRequest({ input: `Explain this simply: "${clean}"`, mode: 'ask', includePage: true, nonce: Date.now() })
  }

  // 128bit family: send a show or movie to 128bittracker.
  const addToTracker = () => {
    setMenuOpen(false)
    const q = new URLSearchParams({ title: active.title || '', url: active.url, source: 'bitbrowser' }).toString()
    Linking.openURL(`128bittracker://add?${q}`).catch(() => Alert.alert('128bittracker', "128bittracker isn't installed on this phone yet."))
  }

  // Phone numbers open in BitCaller when it's installed, else the phone app.
  const openTel = (url) => {
    const number = decodeURIComponent(url.replace(/^tel:/i, '')).replace(/[^\d+]/g, '')
    const fallback = () => Linking.openURL(url).catch(() => {})
    if (getState().familyLinks?.bitcaller === false) return fallback()
    Linking.openURL(`bitcaller://call?number=${encodeURIComponent(number)}`).catch(fallback)
  }

  const stopAgent = () => {
    session.stop()
    setAgentActive(false)
  }

  // Page callbacks for TabView. The object never changes identity, so tabs
  // only re-render when their own data changes; the functions always see the
  // latest state.
  const handlers = useRef({}).current
  Object.assign(handlers, {
    ref: (id, r) => {
      if (r) views.current[id] = r
      else delete views.current[id]
    },
    explain,
    onMessage: (t, e) => onMessage(t)(e),
    onScroll: (t, e) => {
      if (t.id !== activeRef.current || !getState().hideBarsOnScroll) return
      const y = e.nativeEvent.contentOffset?.y || 0
      const dy = y - lastScrollY.current
      lastScrollY.current = y
      if (Date.now() < barsLockedUntil.current) return
      if (y < 24) return showBars(true)
      // Count the scroll in one direction; a change of direction starts over.
      scrollRun.current = Math.sign(dy) === Math.sign(scrollRun.current) ? scrollRun.current + dy : dy
      if (scrollRun.current > 140) showBars(false)
      else if (scrollRun.current < -70) showBars(true)
    },
    shouldStart: (req, t) => {
      // Phishing and malware sites (checked on the phone against downloaded lists).
      const danger = req.isTopFrame !== false && isDangerous(req.url)
      if (danger) {
        Alert.alert('Dangerous site blocked', `${danger.host} is on the ${danger.list} list of phishing or malware sites. It may try to steal your passwords or harm your phone.`, [
          { text: 'Go back', style: 'cancel' },
          { text: 'Continue anyway', style: 'destructive', onPress: () => (allowOnce(danger.host), navigate(t.id, req.url)) },
        ])
        return false
      }
      if (req.isTopFrame === false && isBlocked(req.url, t.url)) return false
      if (/^tel:/i.test(req.url)) {
        openTel(req.url)
        return false
      }
      if (looksLikeDownload(req.url)) {
        download(req.url)
        return false
      }
      return true
    },
    download,
    onNav: (t, nav) => {
      patchTab(t.id, { url: nav.url, title: nav.title || nav.url, loading: nav.loading, canGoBack: nav.canGoBack, canGoForward: nav.canGoForward })
      if (!nav.loading && !t.private) addHistory(nav.url, nav.title)
    },
    onLoadStart: (t, e) => {
      const js = siteScript(e.nativeEvent.url)
      if (js) views.current[t.id]?.injectJavaScript(js)
    },
    onLoadEnd: (t, e) => {
      patchTab(t.id, { loading: false })
      const js = siteScript(e.nativeEvent.url)
      if (js) views.current[t.id]?.injectJavaScript(js)
      notePageLoaded(e.nativeEvent.url)
      lastScrollY.current = 0
      if (t.private) return
      findLogins(e.nativeEvent.url)
        .then((list) => list?.length && setFillOffer({ tabId: t.id, login: list[0] }))
        .catch(() => {})
    },
  })

  const isPrivate = active.private
  const accent = isPrivate ? C.purple : agentActive ? C.pink : C.teal
  const hint = (text) => () => toast(text)

  return (
    <View style={[st.root, { paddingTop: fullscreen ? 0 : insets.top, paddingBottom: fullscreen ? 0 : insets.bottom }]}>
      <StatusBar style={isLightTheme() ? 'dark' : 'light'} hidden={fullscreen} />

      {/* address bar (slides away while you scroll down) */}
      {!fullscreen && !barsHidden && (
        <View style={[st.top, { borderBottomColor: accent }]}>
          <Pressable onLongPress={panic} delayLongPress={600} style={[st.logo, { backgroundColor: accent }]} accessibilityLabel="Bit Browser. Long-press for the panic button">
            <Text style={st.logoText}>B</Text>
          </Pressable>
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
          <ShieldButton url={active.url} on={shieldsOn} onPress={() => {
            const host = hostOf(active.url)
            if (!host) return
            const up = siteShieldsOn(active.url)
            Alert.alert(`Bit Shields: ${host}`, up ? 'Ads and trackers are blocked on this site.' : 'Shields are down for this site.', [
              { text: 'Close', style: 'cancel' },
              { text: up ? 'Shields down for this site' : 'Shields up for this site', onPress: () => setSiteShields(active.url, !up).then(() => views.current[active.id]?.reload()) },
            ])
          }} />
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
      {!fullscreen && !barsHidden && wide && (
        <ScrollView horizontal style={st.strip} contentContainerStyle={st.stripRow} showsHorizontalScrollIndicator={false}>
          {spaceTabs.map((t) => (
            <Pressable key={t.id} onPress={() => setActiveId(t.id)} style={[st.stripTab, t.id === active.id && { borderColor: t.private ? C.purple : C.teal, backgroundColor: C.bg }]}>
              <Text style={st.stripText} numberOfLines={1}>{t.private ? 'PRIVATE · ' : ''}{t.title || 'New tab'}</Text>
              <Pressable onPress={() => closeTab(t.id)} hitSlop={8} accessibilityLabel={`Close ${t.title || 'tab'}`}>
                <Text style={st.stripX}>X</Text>
              </Pressable>
            </Pressable>
          ))}
          <Pressable onPress={() => openTab(homeUrl())} style={st.stripNew} accessibilityLabel="New tab">
            <Text style={st.stripX}>+</Text>
          </Pressable>
        </ScrollView>
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
      <View style={[{ flex: 1 }, wide && { flexDirection: 'row' }]}>
      <View style={[{ flex: 1 }, agentActive && !fullscreen && st.agentFrame]}>
        <View ref={pageArea} collapsable={false} style={{ flex: 1 }}>
          {tabs.map((t) => (
            (t.private || live.includes(t.id)) && (
              <TabView key={t.id} tab={t} active={t.id === active.id} autoplay={autoplay} textZoom={textZoom} aiEnabled={aiEnabled} watchScroll={hideBarsOnScroll} shieldsJS={shieldsJS} h={handlers} />
            )
          ))}
        </View>
        {locked && active.private && !fullscreen && (
          <View style={st.lock}>
            <Text style={st.agentTitle}>PRIVATE TABS LOCKED</Text>
            <PButton hot color={C.purple} label="UNLOCK" onPress={unlockPrivate} />
            <PButton small label="GO TO A NORMAL TAB" onPress={() => {
              const normal = tabsRef.current.filter((t) => !t.private)
              if (normal.length) setActiveId(normal[normal.length - 1].id)
              else openTab(homeUrl())
            }} />
          </View>
        )}
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
        {aiEnabled && !wide && (
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
      {aiEnabled && wide && aiOpen && !fullscreen && (
        <View style={st.side}>
          <AIPanel
            side
            browser={browser}
            visible
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
        </View>
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
          <BarButton icon={String(spaceTabs.length)} boxed label="Tabs" onPress={openTabs} onLongPress={hint('Tabs: see, search and close your tabs')} />
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
            {familyLinks.tracker !== false && TRACKER_PAGE.test(active.url) && <MenuItem label="ADD TO 128BITTRACKER" color={C.orange} onPress={addToTracker} />}
            <MenuItem label="DOWNLOADS" onPress={() => (setMenuOpen(false), setDownloadsOpen(true))} />
            <MenuItem label="SETTINGS" onPress={() => (setMenuOpen(false), setSettingsOpen(true))} />
            <MenuItem label="PANIC: WIPE PRIVATE" color={C.pink} onPress={() => (setMenuOpen(false), panic())} />
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
        onCloseTab={(id) => {
          closeTab(id)
          award('tabCleaned')
        }}
        onCloseAll={closeAllTabs}
        onSwitchSpace={switchSpace}
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

const EXPLAIN_MENU = [{ label: 'Explain with Bitter', key: 'explain' }]
const NO_MENU = []

// One tab's page. Memoized so typing in the address bar, agent steps or
// other tabs loading don't re-render every open page.
const TabView = memo(function TabView({ tab: t, active, autoplay, textZoom, aiEnabled, watchScroll, shieldsJS, h }) {
  const js = useMemo(() => injectedJS(autoplay), [autoplay])
  // A tab woken from sleep reopens its last page; later navigations come in via t.source.
  const [source, setSource] = useState(() => ({ uri: t.url || t.source }))
  const firstSource = useRef(t.source)
  useEffect(() => {
    if (t.source !== firstSource.current) setSource({ uri: t.source })
    firstSource.current = null
  }, [t.source])
  useEffect(() => () => h.ref(t.id, null), [])
  return (
    <WebView
      ref={(r) => h.ref(t.id, r)}
      source={source}
      // Hidden tabs must not take up space: the WebView's outer
      // container is flex: 1 by default, so hide that, not just the page.
      containerStyle={active ? st.pageBox : st.hidden}
      style={st.page}
      incognito={t.private}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      allowsFullscreenVideo
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={autoplay === 'off'}
      textZoom={textZoom}
      injectedJavaScript={js}
      menuItems={t.private || !aiEnabled ? NO_MENU : EXPLAIN_MENU}
      onCustomMenuSelection={(e) => e.nativeEvent.key === 'explain' && h.explain(e.nativeEvent.selectedText)}
      onMessage={(e) => h.onMessage(t, e)}
      // Scroll events cross into JS on every frame, so only listen when the bars hide on scroll.
      onScroll={watchScroll ? (e) => h.onScroll(t, e) : undefined}
      injectedJavaScriptBeforeContentLoaded={shieldsJS}
      onShouldStartLoadWithRequest={(req) => h.shouldStart(req, t)}
      onLoadStart={(e) => h.onLoadStart(t, e)}
      onFileDownload={(e) => h.download(e.nativeEvent.downloadUrl)}
      onNavigationStateChange={(nav) => h.onNav(t, nav)}
      onLoadEnd={(e) => h.onLoadEnd(t, e)}
    />
  )
})

// Shield in the address bar: how many ads and trackers this page had blocked.
function ShieldButton({ url, on, onPress }) {
  const n = useBlockedCount(url)
  const siteOn = on && siteShieldsOn(url)
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={siteOn ? `Bit Shields: ${n} blocked on this page` : 'Bit Shields are off for this site'} style={[st.shield, !siteOn && { opacity: 0.45 }]}>
      <Text style={st.shieldIcon}>{siteOn ? 'S' : '-'}</Text>
      <Text style={st.shieldCount} numberOfLines={1}>{siteOn ? (n > 999 ? '999+' : String(n)) : 'OFF'}</Text>
    </Pressable>
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
  pageBox: { flex: 1 },
  hidden: { display: 'none' },
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
  shield: { minWidth: 34, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.edge, backgroundColor: C.bg, paddingHorizontal: 3 },
  shieldIcon: { fontFamily: PIXEL_FONT, fontSize: 10, color: C.orange, includeFontPadding: false },
  shieldCount: { color: C.ink, fontSize: 10, marginTop: 2, includeFontPadding: false },
  strip: { flexGrow: 0, backgroundColor: C.panel, borderBottomWidth: 2, borderBottomColor: C.edge },
  stripRow: { alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  stripTab: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 200, height: 34, paddingHorizontal: 10, borderWidth: 2, borderColor: C.edge },
  stripText: { flex: 1, color: C.ink, fontSize: 13, includeFontPadding: false },
  stripX: { fontFamily: PIXEL_FONT, fontSize: 9, color: C.muted, includeFontPadding: false },
  stripNew: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.edge },
  side: { width: 380, borderLeftWidth: 3, borderLeftColor: C.edge, backgroundColor: C.panel },
  lock: { ...StyleSheet.absoluteFillObject, backgroundColor: C.purpleDark, alignItems: 'center', justifyContent: 'center', gap: 16 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
})
