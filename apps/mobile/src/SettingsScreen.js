// Settings, laid out like Brave's: a searchable list of sections, each row
// opening its own page. Full screen, kept clear of the status bar and the
// gesture bar with safe-area insets.

import { useEffect, useMemo, useState } from 'react'
import { Modal, ScrollView, View, Text, Pressable, Switch, StyleSheet, Alert, Platform, Linking, BackHandler } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import Constants from 'expo-constants'
import { PROVIDERS, SEARCH_ENGINES } from '@pixelbrowser/ai-core'
import { parseSyncQr } from '@pixelbrowser/sync-core'
import { useStore, update, memory, getState, setSearchEngine, liveRecords } from './store'
import { saveAISettings, setAIEnabled } from './ai'
import { createChain, joinChain, leaveChain, showCode, syncNow, remoteTabs } from './sync'
import { checkForAppUpdate } from './updates'
import * as pw from './passwords'
import { EVENT_TYPES, FAMILY_APPS, setShare, disconnectFamily } from './events'
import { PButton, PText, Field, PSwitch } from './ui'
import { C } from './theme'

const REPO_URL = 'https://github.com/Hootywhooo86/pixelbrowser'

// Brave's structure. `keywords` feed the search box.
const SECTIONS = [
  {
    title: 'FEATURES',
    rows: [
      { id: 'shields', title: 'Shields & privacy', sub: 'Blocking, cookies, clear data', keywords: 'privacy tracker ads cookies https clear history data' },
      { id: 'ai', title: 'Bitter AI', sub: 'AI slider, model, keys, memory', keywords: 'ai bitter model provider key api memory claude chatgpt gemini' },
      { id: 'sync', title: 'Sync', sub: 'Encrypted sync with your computer', keywords: 'sync qr code devices tabs encrypted' },
      { id: 'family', title: '128bit family', sub: 'Account, XP and streaks', keywords: '128bit family account xp streak quests events' },
    ],
  },
  {
    title: 'GENERAL',
    rows: [
      { id: 'search', title: 'Search engines', sub: 'Address bar search', keywords: 'search engine duckduckgo brave google bing startpage' },
      { id: 'homepage', title: 'Homepage', sub: 'Page for new tabs', keywords: 'home page start new tab' },
      { id: 'sync', title: 'Sync', sub: 'Encrypted sync with your computer', keywords: 'sync' },
      { id: 'report', title: 'Privacy report', sub: 'What stays on this phone', keywords: 'privacy report stats' },
      { id: 'notifications', title: 'Notifications', keywords: 'notifications alerts' },
      { id: 'sites', title: 'Site settings', sub: 'Camera, mic, location', keywords: 'site permissions camera microphone location' },
      { id: 'downloads', title: 'Downloads', keywords: 'downloads files apk' },
      { id: 'default', title: 'Default browser', sub: 'Open links in Bit Browser', keywords: 'default browser preferred links' },
    ],
  },
  {
    title: 'DISPLAY',
    rows: [
      { id: 'tabs', title: 'Tabs and tab groups', keywords: 'tabs groups grid list' },
      { id: 'media', title: 'Media', sub: 'Full-screen video', keywords: 'media video fullscreen full screen rotate landscape' },
      { id: 'appearance', title: 'Appearance', keywords: 'appearance theme dark colors' },
      { id: 'ntp', title: 'New tab page', keywords: 'new tab page synced' },
      { id: 'a11y', title: 'Accessibility', sub: 'Text size', keywords: 'accessibility text size zoom font' },
      { id: 'languages', title: 'Languages', keywords: 'language translate' },
    ],
  },
  {
    title: 'PASSWORDS AND AUTOFILL',
    rows: [
      { id: 'passwords', title: 'Bit Password Manager', sub: 'Saved logins', keywords: 'passwords logins manager autofill save' },
      { id: 'autofill', title: 'Autofill services', keywords: 'autofill service android' },
      { id: 'cards', title: 'Payment methods', keywords: 'payment cards credit card' },
      { id: 'addresses', title: 'Addresses', keywords: 'addresses shipping address phone email' },
    ],
  },
  {
    title: 'SUPPORT',
    rows: [{ id: 'about', title: 'About Bit Browser', sub: 'Version, updates, licenses', keywords: 'about version update licenses help support' }],
  },
]

const TITLES = Object.fromEntries(SECTIONS.flatMap((s) => s.rows.map((r) => [r.id, r.title])))

export default function SettingsScreen({ visible, onClose, openUrl, downloadsScreen }) {
  const insets = useSafeAreaInsets()
  const [page, setPage] = useState(null)
  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(null) // onCode callback while the QR scanner is open

  useEffect(() => {
    if (!visible) {
      setPage(null)
      setQuery('')
      setScanning(null)
    }
  }, [visible])

  const back = () => {
    if (scanning) return setScanning(null)
    if (page) return setPage(null)
    onClose()
  }

  const go = (url) => {
    onClose()
    openUrl(url)
  }

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.map((s) => ({ ...s, rows: s.rows.filter((r) => `${r.title} ${r.sub || ''} ${r.keywords}`.toLowerCase().includes(q)) })).filter((s) => s.rows.length)
  }, [query])

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={st.head}>
          {page ? <PButton small label="< BACK" onPress={() => setPage(null)} /> : null}
          <PText style={{ flex: 1 }} numberOfLines={1}>{page ? (TITLES[page] || '').toUpperCase() : 'SETTINGS'}</PText>
          <PButton small label="DONE" hot onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={[st.body, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          {!page ? (
            <>
              <Field value={query} onChangeText={setQuery} placeholder="Search settings" accessibilityLabel="Search settings" />
              {sections.map((s) => (
                <View key={s.title}>
                  <PText style={st.h}>{s.title}</PText>
                  <View style={st.group}>
                    {s.rows.map((r, i) => (
                      <Pressable
                        key={`${s.title}-${r.id}`}
                        onPress={() => setPage(r.id)}
                        accessibilityRole="button"
                        style={({ pressed }) => [st.navRow, i > 0 && st.navDivider, pressed && { backgroundColor: C.edge }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={st.rowTitle}>{r.title}</Text>
                          {!!r.sub && <Text style={st.muted}>{r.sub}</Text>}
                        </View>
                        <Text style={{ color: C.muted, fontSize: 18 }}>›</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
              {!sections.length && <Text style={[st.muted, { marginTop: 16 }]}>No settings match “{query}”.</Text>}
            </>
          ) : (
            <Page id={page} go={go} downloadsScreen={downloadsScreen} onScan={setScanning} />
          )}
        </ScrollView>
      </View>
      {!!scanning && (
        <Scanner
          insets={insets}
          onClose={() => setScanning(null)}
          onCode={(text) => {
            const cb = scanning
            setScanning(null)
            cb(text)
          }}
        />
      )}
    </Modal>
  )
}

function Page({ id, go, downloadsScreen, onScan }) {
  switch (id) {
    case 'shields':
      return <ShieldsPage />
    case 'ai':
      return <AIPage go={go} />
    case 'sync':
      return <SyncPage go={go} onScan={onScan} />
    case 'family':
      return <FamilyPage />
    case 'search':
      return <SearchPage />
    case 'homepage':
      return <HomepagePage />
    case 'report':
      return <ReportPage />
    case 'notifications':
      return <Info text="Websites can't send you notifications in Bit Browser yet. When they can, you'll choose site by site, and it will be off by default." />
    case 'sites':
      return <Info text="For your privacy, websites can't use your camera, microphone or location in Bit Browser right now. Per-site permission prompts are coming." />
    case 'downloads':
      return downloadsScreen || <Info text="Downloads will show here." />
    case 'default':
      return <DefaultBrowserPage />
    case 'tabs':
      return <TabsPage />
    case 'media':
      return <MediaPage />
    case 'appearance':
      return <Info text="Bit Browser uses the Pixel dark theme: navy, teal and orange. More pixel themes and tab-bar skins are coming." />
    case 'ntp':
      return <NtpPage />
    case 'a11y':
      return <A11yPage />
    case 'languages':
      return <Info text="Bit Browser follows your phone's language for websites. Change it in your phone's Settings → System → Languages." />
    case 'passwords':
      return <PasswordsPage />
    case 'autofill':
      return <AutofillPage />
    case 'cards':
      return <CardsPage />
    case 'addresses':
      return <AddressesPage />
    case 'about':
      return <AboutPage go={go} />
    default:
      return null
  }
}

// ---------- small building blocks ----------

function Info({ text }) {
  return <Text style={st.body2}>{text}</Text>
}

function Toggle({ value, onChange, label, note, disabled }) {
  return (
    <View style={[st.toggle, disabled && { opacity: 0.5 }]}>
      <View style={{ flex: 1 }}>
        <Text style={st.rowTitle}>{label}</Text>
        {!!note && <Text style={st.muted}>{note}</Text>}
      </View>
      <Switch value={!!value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  )
}

function ErrorText({ error }) {
  return error ? <Text style={{ color: C.pink, marginTop: 8 }}>{error}</Text> : null
}

function useRun() {
  const [error, setError] = useState('')
  const run = async (fn) => {
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(String(err?.message || err))
    }
  }
  return [error, run, setError]
}

// ---------- features ----------

function ShieldsPage() {
  const history = useStore((s) => Object.keys(s.records.history).length)
  return (
    <>
      <Info text="Bit Browser blocks third-party cookies in every tab, never sells or shares what you browse, and private tabs keep nothing after you close them." />
      <PText style={st.h}>PROTECTIONS</PText>
      <Text style={st.body2}>• Third-party cookies: blocked</Text>
      <Text style={st.body2}>• Private tabs: no history, no cookies kept</Text>
      <Text style={st.body2}>• HTTPS: sites load over HTTPS when they support it. Bit Browser warns about broken certificates.</Text>
      <Text style={st.muted}>Ad and tracker blocking on the phone is coming. The desktop app already blocks them.</Text>
      <PText style={st.h}>CLEAR BROWSING DATA</PText>
      <Text style={st.muted}>{history} pages in your history.</Text>
      <PButton
        hot
        color={C.pink}
        label="CLEAR HISTORY"
        style={{ alignSelf: 'flex-start', marginTop: 8 }}
        onPress={() =>
          Alert.alert('Clear history?', 'This removes your browsing history from this phone (and from your synced devices if sync is on).', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Clear',
              style: 'destructive',
              onPress: () =>
                update((s) => {
                  const now = Date.now()
                  for (const id of Object.keys(s.records.history)) s.records.history[id] = { id, updatedAt: now, deviceId: s.deviceId, deleted: true, data: null }
                }),
            },
          ])
        }
      />
    </>
  )
}

function AIPage({ go }) {
  const state = useStore()
  const [provider, setProvider] = useState(state.ai.provider)
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [memInput, setMemInput] = useState('')
  const [error, run] = useRun()
  const p = PROVIDERS[provider]

  useEffect(() => {
    const o = state.ai.providers[provider] || {}
    setModel(o.model || p.model || '')
    setBaseUrl(o.baseUrl || p.baseUrl || '')
    setApiKey('')
  }, [provider])

  const save = () =>
    run(async () => {
      await saveAISettings({ provider, model, baseUrl, ...(apiKey ? { apiKey } : {}) })
      setApiKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })

  return (
    <>
      <View style={st.row}>
        <PSwitch value={state.aiEnabled} onChange={setAIEnabled} accessibilityLabel={state.aiEnabled ? 'Bitter is on' : 'Bitter is off'} />
        <Text style={{ color: C.ink, flex: 1 }}>{state.aiEnabled ? 'Bitter is on.' : 'AI is off: private mode. Nothing is sent to any AI.'}</Text>
      </View>
      <Text style={st.muted}>Turn AI off any time to browse privately. Your AI settings and memory stay saved on this phone.</Text>

      <PText style={st.h}>AI MODEL</PText>
      <Text style={st.muted}>Pick any AI for Bitter. Bring your own key, or point it at a model running on your own computer.</Text>
      <View style={st.list}>
        {Object.entries(PROVIDERS).map(([pid, info]) => (
          <Pressable key={pid} onPress={() => setProvider(pid)} style={[st.choice, provider === pid && { borderColor: C.teal }]}>
            <Text style={{ color: provider === pid ? C.ink : C.muted, fontSize: 13 }}>{info.label}</Text>
            {state.keysPresent[pid] && <Text style={{ color: C.teal, fontSize: 11 }}>key saved</Text>}
          </Pressable>
        ))}
      </View>
      <Text style={st.label}>Model</Text>
      <Field value={model} onChangeText={setModel} placeholder="model name" />
      {!!p.models && <Text style={st.muted}>Try: {p.models.join(', ')}</Text>}
      {p.kind !== 'anthropic' && (
        <>
          <Text style={st.label}>API address</Text>
          <Field value={baseUrl} onChangeText={setBaseUrl} placeholder="https://…/v1" />
        </>
      )}
      {!p.noKey && (
        <>
          <Text style={st.label}>API key</Text>
          <Field value={apiKey} onChangeText={setApiKey} secureTextEntry placeholder={state.keysPresent[provider] ? 'Saved (type to replace)' : p.keyOptional ? 'Optional' : 'Paste your API key'} />
        </>
      )}
      <View style={st.row}>
        <PButton hot label={saved ? 'SAVED' : 'SAVE'} onPress={save} />
        {!!p.keyUrl && <PButton label="GET A KEY" onPress={() => go(p.keyUrl)} />}
      </View>

      <PText style={st.h}>MEMORY</PText>
      <Toggle value={state.memoryEnabled} onChange={(v) => update((s) => (s.memoryEnabled = v))} label="Let Bitter remember things you tell it" />
      {memory.items().map((m) => (
        <View key={m} style={st.itemRow}>
          <Text style={{ color: C.ink, flex: 1 }}>{m}</Text>
          <PButton small label="X" onPress={() => memory.remove(m)} />
        </View>
      ))}
      <View style={st.row}>
        <Field style={{ flex: 1 }} value={memInput} onChangeText={setMemInput} placeholder="e.g. I'm vegetarian" />
        <PButton label="ADD" onPress={() => { memory.add(memInput); setMemInput('') }} />
      </View>
      <ErrorText error={error} />
    </>
  )
}

function SyncPage({ go, onScan }) {
  const state = useStore()
  const [server, setServer] = useState(state.sync.server)
  const [code, setCode] = useState('')
  const [shownCode, setShownCode] = useState('')
  const [error, run, setError] = useRun()

  const scan = () =>
    onScan(() => (text) => {
      const parsed = parseSyncQr(text)
      if (!parsed) return setError("That QR code isn't a Bit Browser sync code.")
      setServer(parsed.server)
      run(() => joinChain(parsed.server || getState().sync.server, parsed.code))
    })

  return (
    <>
      <Text style={st.muted}>Memory, history, open tabs and AI settings sync with your computer. Everything is encrypted on this phone first, so the sync server can't read it.</Text>
      {!state.sync.enabled ? (
        <>
          <Text style={st.label}>Sync server</Text>
          <Field value={server} onChangeText={setServer} placeholder="https://sync.example.com" keyboardType="url" />
          <View style={st.row}>
            <PButton hot label="SCAN QR" onPress={scan} />
            <PButton label="START NEW" onPress={() => run(async () => setShownCode(await createChain(server)))} />
          </View>
          <Text style={st.label}>…or type the 24-word code from your computer</Text>
          <Field value={code} onChangeText={setCode} multiline style={{ minHeight: 80 }} />
          <PButton label="JOIN" onPress={() => run(() => joinChain(server, code))} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
        </>
      ) : (
        <>
          <Text style={{ color: C.ink, marginTop: 8 }}>
            {state.sync.lastSyncAt ? `Synced ${new Date(state.sync.lastSyncAt).toLocaleString()}` : 'Syncing…'} with {state.sync.server}
          </Text>
          <Text style={st.label}>This device's name</Text>
          <Field value={state.deviceName} onChangeText={(v) => update((s) => (s.deviceName = v.slice(0, 40)))} />
          <Toggle value={state.sync.syncKeys} onChange={(v) => update((s) => (s.sync.syncKeys = v))} label="Also sync my AI keys (encrypted)" />
          <Toggle
            value={state.syncPasswords}
            onChange={(v) => {
              update((s) => (s.syncPasswords = v))
              if (v) pw.pushAllForSync()
            }}
            label="Sync passwords and addresses (encrypted)"
          />
          <View style={st.row}>
            <PButton hot label="SYNC NOW" onPress={() => run(syncNow)} />
            <PButton label="SHOW CODE" onPress={() => run(async () => setShownCode(await showCode()))} />
            <PButton
              label="STOP"
              onPress={() =>
                Alert.alert('Stop syncing?', 'You can also delete the encrypted copy from the server.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'This phone only', onPress: () => run(() => leaveChain()) },
                  { text: 'Delete from server', style: 'destructive', onPress: () => run(() => leaveChain({ wipe: true })) },
                ])
              }
            />
          </View>
          <PText style={st.h}>TABS ON YOUR OTHER DEVICES</PText>
          {remoteTabs().map((d) => (
            <View key={d.deviceName} style={{ marginBottom: 8 }}>
              <Text style={{ color: C.ink, fontWeight: '700' }}>{d.deviceName}</Text>
              {d.tabs.map((t, i) => (
                <Text key={i} style={{ color: C.teal, paddingVertical: 3 }} numberOfLines={1} onPress={() => go(t.url)}>
                  {t.title || t.url}
                </Text>
              ))}
            </View>
          ))}
        </>
      )}
      {!!shownCode && (
        <View style={st.codeBox}>
          <Text style={st.muted}>Your sync code. Keep it secret: anyone with it can read your synced data.</Text>
          <Text selectable style={{ color: C.ink, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', marginTop: 6 }}>{shownCode}</Text>
        </View>
      )}
      <ErrorText error={error || (state.sync.error ? `Sync problem: ${state.sync.error}` : '')} />
    </>
  )
}

function FamilyPage() {
  const f = useStore((s) => s.family)
  return (
    <>
      <View style={st.card}>
        <PText style={{ color: C.teal }}>128BIT ACCOUNT</PText>
        <Text style={[st.body2, { marginTop: 8 }]}>
          {f.connected ? `Signed in as ${f.account?.name || 'you'}.` : 'Connect a 128bit account to earn XP and streaks for finishing what you read, and get tab quests from 128bitlife.'}
        </Text>
        <View style={st.row}>
          {f.connected ? (
            <PButton label="DISCONNECT" onPress={disconnectFamily} />
          ) : (
            <PButton hot label="CONNECT" onPress={() => Alert.alert('Coming soon', '128bit accounts are coming soon. Everything here stays off until you connect.')} />
          )}
        </View>
        <Text style={[st.muted, { marginTop: 8 }]}>COMING SOON</Text>
      </View>
      <View style={[st.row, { marginTop: 12 }]}>
        <View style={[st.stat, { borderColor: C.orange }]}>
          <PText style={{ color: C.orange }}>{f.xp || 0}</PText>
          <Text style={st.muted}>XP</Text>
        </View>
        <View style={[st.stat, { borderColor: C.teal }]}>
          <PText style={{ color: C.teal }}>{f.streak || 0}</PText>
          <Text style={st.muted}>DAY STREAK</Text>
        </View>
      </View>
      <PText style={st.h}>FAMILY APPS</PText>
      {FAMILY_APPS.map((a) => (
        <View key={a.id} style={st.itemRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.rowTitle}>{a.label}</Text>
            <Text style={st.muted}>{a.note}</Text>
          </View>
        </View>
      ))}
      <PText style={st.h}>WHAT BIT BROWSER SHARES</PText>
      <Text style={st.muted}>All off by default. Nothing is shared until you connect and turn an item on. Never the pages you visit.</Text>
      {Object.entries(EVENT_TYPES).map(([type, e]) => (
        <Toggle key={type} value={f.share?.[type]} onChange={(v) => setShare(type, v)} label={e.label} note={e.note} disabled={!f.connected} />
      ))}
    </>
  )
}

// ---------- general ----------

function SearchPage() {
  const state = useStore()
  const [customUrl, setCustomUrl] = useState(state.customSearchUrl)
  const [pickCustom, setPickCustom] = useState(false)
  const [error, , setError] = useRun()
  return (
    <>
      <Text style={st.muted}>Used when you type words in the address bar.</Text>
      <View style={st.list}>
        {Object.entries(SEARCH_ENGINES).map(([id, e]) => {
          const on = id === 'custom' ? pickCustom || state.searchEngine === 'custom' : state.searchEngine === id && !pickCustom
          return (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => (id === 'custom' ? setPickCustom(true) : (setPickCustom(false), setSearchEngine(id)))}
              style={[st.choice, { flexDirection: 'column' }, on && { borderColor: C.teal }]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: on ? C.ink : C.muted, fontSize: 14, fontWeight: '600' }}>{e.label}</Text>
                {!e.custom && <Text style={{ color: e.private ? C.teal : C.orange, fontSize: 11 }}>{e.private ? 'PRIVATE' : 'TRACKS YOU'}</Text>}
              </View>
              <Text style={{ color: C.muted, fontSize: 12 }}>{e.note}</Text>
            </Pressable>
          )
        })}
      </View>
      {(pickCustom || state.searchEngine === 'custom') && (
        <>
          <Text style={st.label}>Search address (put %s where the words go)</Text>
          <Field value={customUrl} onChangeText={setCustomUrl} placeholder="https://search.example.com/?q=%s" keyboardType="url" />
          <PButton
            label="SAVE"
            hot
            style={{ alignSelf: 'flex-start', marginTop: 8 }}
            onPress={() => {
              if (!/^https?:\/\/\S+$/.test(customUrl.trim()) || !customUrl.includes('%s')) return setError('Use a full https:// address with %s in it.')
              setError('')
              setPickCustom(false)
              setSearchEngine('custom', customUrl)
            }}
          />
        </>
      )}
      <ErrorText error={error} />
    </>
  )
}

function HomepagePage() {
  const homepage = useStore((s) => s.homepage)
  const [value, setValue] = useState(homepage)
  const [error, , setError] = useRun()
  return (
    <>
      <Text style={st.muted}>New tabs open this page. Leave it empty to use your search engine's home page.</Text>
      <Field value={value} onChangeText={setValue} placeholder="https://example.com" keyboardType="url" style={{ marginTop: 8 }} />
      <View style={st.row}>
        <PButton
          hot
          label="SAVE"
          onPress={() => {
            const v = value.trim()
            if (v && !/^https?:\/\/\S+$/.test(v)) return setError('Use a full https:// address.')
            setError('')
            update((s) => (s.homepage = v))
          }}
        />
        <PButton label="USE SEARCH HOME" onPress={() => { setValue(''); update((s) => (s.homepage = '')) }} />
      </View>
      <ErrorText error={error} />
    </>
  )
}

function ReportPage() {
  const s = useStore()
  const history = liveRecords('history').length
  const memories = liveRecords('memory').length
  const logins = (s.passwordIndex || []).length
  return (
    <>
      <Text style={st.body2}>Everything below lives on this phone. Sync (if on) is end-to-end encrypted, so the server can't read it.</Text>
      {[
        ['Pages in history', history],
        ['Things Bitter remembers', memories],
        ['Saved logins', logins],
        ['Sync', s.sync.enabled ? 'On (encrypted)' : 'Off'],
        ['AI', s.aiEnabled ? `On (${PROVIDERS[s.ai.provider]?.label || s.ai.provider})` : 'Off: nothing is sent to any AI'],
        ['128bit sharing', s.family.connected ? 'Connected' : 'Off'],
      ].map(([k, v]) => (
        <View key={k} style={st.itemRow}>
          <Text style={[st.rowTitle, { flex: 1 }]}>{k}</Text>
          <Text style={{ color: C.teal }}>{String(v)}</Text>
        </View>
      ))}
      <Text style={[st.muted, { marginTop: 8 }]}>When the AI slider is off, Bit Browser sends zero requests to any AI.</Text>
    </>
  )
}

async function openDefaultAppsSettings() {
  if (Platform.OS === 'android') {
    try {
      await Linking.sendIntent('android.settings.MANAGE_DEFAULT_APPS_SETTINGS')
    } catch {
      await Linking.openSettings()
    }
  } else {
    await Linking.openURL('app-settings:').catch(() => Linking.openSettings())
  }
}

function DefaultBrowserPage() {
  return (
    <>
      <Text style={st.body2}>Make Bit Browser open the links you tap in other apps.</Text>
      <PButton hot label="MAKE BIT BROWSER YOUR DEFAULT BROWSER" style={{ marginTop: 12 }} onPress={openDefaultAppsSettings} />
      <Text style={[st.muted, { marginTop: 10 }]}>
        {Platform.OS === 'android'
          ? 'Android opens Default apps. Tap "Browser app" and pick Bit Browser.'
          : 'iPhone opens Settings. Tap "Default Browser App" and pick Bit Browser.'}
      </Text>
    </>
  )
}

// ---------- display ----------

function TabsPage() {
  const s = useStore()
  return (
    <>
      <Text style={st.label}>Tab switcher layout</Text>
      <View style={st.row}>
        {['grid', 'list'].map((v) => (
          <PButton key={v} label={v.toUpperCase()} hot={s.tabLayout === v} onPress={() => update((x) => (x.tabLayout = v))} />
        ))}
      </View>
      <Toggle value={s.closeTabsOnExit} onChange={(v) => update((x) => (x.closeTabsOnExit = v))} label="Close tabs when I leave the app" />
      <Text style={st.muted}>Tab groups: long-press a tab in the tab switcher.</Text>
    </>
  )
}

function MediaPage() {
  const s = useStore()
  return (
    <>
      <Toggle value={s.fullscreenVideo} onChange={(v) => update((x) => (x.fullscreenVideo = v))} label="Full-screen videos" note="Let videos (YouTube and others) fill the screen" />
      <Toggle value={s.rotateFullscreen} onChange={(v) => update((x) => (x.rotateFullscreen = v))} label="Turn sideways in full screen" note="Rotate to landscape while a video is full screen" disabled={!s.fullscreenVideo} />
    </>
  )
}

function NtpPage() {
  const s = useStore()
  return <Toggle value={s.ntpShowSynced} onChange={(v) => update((x) => (x.ntpShowSynced = v))} label="Show tabs from my other devices" />
}

function A11yPage() {
  const zoom = useStore((s) => s.textZoom || 100)
  const set = (v) => update((s) => (s.textZoom = Math.max(80, Math.min(200, v))))
  return (
    <>
      <Text style={st.label}>Text size on web pages</Text>
      <View style={st.row}>
        <PButton label="-" onPress={() => set(zoom - 10)} disabled={zoom <= 80} />
        <PText style={{ minWidth: 70, textAlign: 'center' }}>{zoom}%</PText>
        <PButton label="+" onPress={() => set(zoom + 10)} disabled={zoom >= 200} />
        <PButton small label="RESET" onPress={() => set(100)} />
      </View>
      <Text style={{ color: C.ink, fontSize: 16 * (zoom / 100), marginTop: 12 }}>Preview: the quick pixel fox jumps.</Text>
    </>
  )
}

// ---------- passwords and autofill ----------

function PasswordsPage() {
  const s = useStore()
  const [unlocked, setUnlocked] = useState(false)
  const [logins, setLogins] = useState([])
  const [query, setQuery] = useState('')
  const [edit, setEdit] = useState(null) // { id?, url, username, password }
  const [reveal, setReveal] = useState({})
  const [error, run, setError] = useRun()

  const refresh = async () => setLogins(await pw.listLogins())
  useEffect(() => {
    if (unlocked) refresh()
  }, [unlocked, s.passwordIndex])

  const doUnlock = async () => {
    if (await pw.unlock()) setUnlocked(true)
    else setError("Couldn't unlock. Try again.")
  }

  const shown = logins
    .filter((l) => `${l.origin} ${l.username}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.origin.localeCompare(b.origin))

  return (
    <>
      <Toggle value={s.offerToSavePasswords} onChange={(v) => update((x) => (x.offerToSavePasswords = v))} label="Offer to save passwords" note="Bit Browser asks after you log in, and fills them in next time" />
      <Toggle
        value={s.syncPasswords}
        onChange={(v) => {
          update((x) => (x.syncPasswords = v))
          if (v) pw.pushAllForSync()
        }}
        label="Sync passwords (end-to-end encrypted)"
        note={s.sync.enabled ? 'Only your devices can read them' : 'Turn on Sync first'}
        disabled={!s.sync.enabled && !s.syncPasswords}
      />
      <Text style={st.muted}>Passwords are encrypted in your phone's secure storage (Keychain / Keystore).</Text>
      <PText style={st.h}>SAVED LOGINS ({(s.passwordIndex || []).length})</PText>
      {!unlocked ? (
        <PButton hot label="UNLOCK" style={{ alignSelf: 'flex-start' }} onPress={doUnlock} />
      ) : edit ? (
        <View style={st.card}>
          <Text style={st.label}>Website</Text>
          <Field value={edit.url} onChangeText={(v) => setEdit({ ...edit, url: v })} placeholder="https://example.com" keyboardType="url" />
          <Text style={st.label}>Username</Text>
          <Field value={edit.username} onChangeText={(v) => setEdit({ ...edit, username: v })} />
          <Text style={st.label}>Password</Text>
          <Field value={edit.password} onChangeText={(v) => setEdit({ ...edit, password: v })} secureTextEntry={!reveal.edit} />
          <View style={st.row}>
            <PButton
              hot
              label="SAVE"
              onPress={() =>
                run(async () => {
                  if (!pw.originOf(edit.url)) throw new Error('Use a full https:// address.')
                  if (!edit.password) throw new Error('Type a password.')
                  if (edit.id) await pw.updateLogin(edit.id, { url: edit.url, username: edit.username, password: edit.password })
                  else await pw.saveLogin(edit)
                  setEdit(null)
                  refresh()
                })
              }
            />
            <PButton label={reveal.edit ? 'HIDE' : 'SHOW'} onPress={() => setReveal({ ...reveal, edit: !reveal.edit })} />
            <PButton label="CANCEL" onPress={() => setEdit(null)} />
          </View>
        </View>
      ) : (
        <>
          <View style={st.row}>
            <Field style={{ flex: 1 }} value={query} onChangeText={setQuery} placeholder="Search passwords" />
            <PButton hot label="+ ADD" onPress={() => setEdit({ url: 'https://', username: '', password: '' })} />
          </View>
          {shown.map((l) => (
            <View key={l.id} style={st.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle} numberOfLines={1}>{l.origin.replace(/^https?:\/\//, '')}</Text>
                <Text style={st.muted} numberOfLines={1}>{l.username || '(no username)'}</Text>
                <Text selectable style={{ color: C.ink, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>{reveal[l.id] ? l.password : '••••••••'}</Text>
              </View>
              <PButton small label={reveal[l.id] ? 'HIDE' : 'SHOW'} onPress={() => setReveal({ ...reveal, [l.id]: !reveal[l.id] })} />
              <PButton small label="EDIT" onPress={() => setEdit({ id: l.id, url: l.origin, username: l.username, password: l.password })} />
              <PButton
                small
                label="X"
                onPress={() =>
                  Alert.alert('Delete this password?', l.origin, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => run(async () => { await pw.deleteLogin(l.id); refresh() }) },
                  ])
                }
              />
            </View>
          ))}
          {!shown.length && <Text style={st.muted}>No saved passwords yet.</Text>}
        </>
      )}
      <ErrorText error={error} />
    </>
  )
}

async function openAutofillSettings() {
  if (Platform.OS !== 'android') return Linking.openSettings()
  try {
    // Android's "Autofill service" picker, pre-selecting nothing.
    await Linking.sendIntent('android.settings.REQUEST_SET_AUTOFILL_SERVICE', [{ key: 'android.intent.extra.PACKAGE_NAME', value: 'com.pixelbrowser.app' }])
  } catch {
    try {
      await Linking.sendIntent('android.settings.SETTINGS')
    } catch {
      await Linking.openSettings()
    }
  }
}

function AutofillPage() {
  return (
    <>
      <Text style={st.body2}>Bit Browser fills in passwords you saved with Bit Password Manager on web pages.</Text>
      <Text style={[st.body2, { marginTop: 8 }]}>
        {Platform.OS === 'android'
          ? 'To use another password manager (Bitwarden, 1Password, Google) across your phone, pick it in Android\'s autofill settings: Settings → Passwords & accounts → Autofill service.'
          : 'To use another password manager across your phone, pick it in Settings → Passwords → Password Options.'}
      </Text>
      <PButton hot label="OPEN AUTOFILL SETTINGS" style={{ alignSelf: 'flex-start', marginTop: 12 }} onPress={openAutofillSettings} />
    </>
  )
}

function CardsPage() {
  const s = useStore()
  const [edit, setEdit] = useState(null)
  const [error, run] = useRun()
  return (
    <>
      <Text style={st.muted}>Card numbers are encrypted in your phone's secure storage. Only the last 4 digits are shown.</Text>
      <Toggle
        value={s.syncCards}
        onChange={(v) => {
          update((x) => (x.syncCards = v))
          if (v) pw.pushAllForSync()
        }}
        label="Sync card numbers (end-to-end encrypted)"
        note="Off by default. Card numbers never leave this phone unless you turn this on."
        disabled={!s.sync.enabled && !s.syncCards}
      />
      {edit ? (
        <View style={st.card}>
          <Text style={st.label}>Name on card</Text>
          <Field value={edit.holder} onChangeText={(v) => setEdit({ ...edit, holder: v })} />
          <Text style={st.label}>Card number</Text>
          <Field value={edit.number} onChangeText={(v) => setEdit({ ...edit, number: v.replace(/[^\d ]/g, '') })} keyboardType="number-pad" secureTextEntry />
          <Text style={st.label}>Expires (MM/YY)</Text>
          <Field value={edit.exp} onChangeText={(v) => setEdit({ ...edit, exp: v.slice(0, 5) })} placeholder="08/29" keyboardType="numbers-and-punctuation" />
          <View style={st.row}>
            <PButton
              hot
              label="SAVE"
              onPress={() =>
                run(async () => {
                  const digits = edit.number.replace(/\D/g, '')
                  if (digits.length < 12) throw new Error('That card number looks too short.')
                  await pw.saveCard(edit)
                  setEdit(null)
                })
              }
            />
            <PButton label="CANCEL" onPress={() => setEdit(null)} />
          </View>
        </View>
      ) : (
        <PButton hot label="+ ADD CARD" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={async () => (await pw.unlock()) && setEdit({ holder: '', number: '', exp: '' })} />
      )}
      {(s.cardIndex || []).map((c) => (
        <View key={c.id} style={st.itemRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.rowTitle}>•••• {c.last4}</Text>
            <Text style={st.muted}>{[c.holder, c.exp].filter(Boolean).join(' · ')}</Text>
          </View>
          <PButton small label="X" onPress={() => Alert.alert('Delete this card?', `•••• ${c.last4}`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => run(() => pw.deleteCard(c.id)) }])} />
        </View>
      ))}
      <ErrorText error={error} />
    </>
  )
}

const ADDRESS_FIELDS = [
  ['name', 'Full name'],
  ['street', 'Street address'],
  ['city', 'City'],
  ['region', 'Province / state'],
  ['postal', 'Postal / ZIP code'],
  ['country', 'Country'],
  ['phone', 'Phone'],
  ['email', 'Email'],
]

function AddressesPage() {
  const s = useStore()
  const [edit, setEdit] = useState(null)
  const [error, run] = useRun()
  const startEdit = async (id) => {
    if (!id) return setEdit(Object.fromEntries(ADDRESS_FIELDS.map(([k]) => [k, ''])))
    const all = await pw.listAddresses()
    setEdit(all.find((a) => a.id === id) || null)
  }
  return (
    <>
      <Text style={st.muted}>Saved on this phone in secure storage. Synced (encrypted) only if "Sync passwords" is on.</Text>
      {edit ? (
        <View style={st.card}>
          {ADDRESS_FIELDS.map(([k, label]) => (
            <View key={k}>
              <Text style={st.label}>{label}</Text>
              <Field
                value={edit[k] || ''}
                onChangeText={(v) => setEdit({ ...edit, [k]: v })}
                keyboardType={k === 'phone' ? 'phone-pad' : k === 'email' ? 'email-address' : 'default'}
                autoCapitalize={k === 'email' ? 'none' : 'words'}
              />
            </View>
          ))}
          <View style={st.row}>
            <PButton hot label="SAVE" onPress={() => run(async () => { await pw.saveAddress(edit); setEdit(null) })} />
            <PButton label="CANCEL" onPress={() => setEdit(null)} />
          </View>
        </View>
      ) : (
        <PButton hot label="+ ADD ADDRESS" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={() => startEdit(null)} />
      )}
      {(s.addressIndex || []).map((a) => (
        <View key={a.id} style={st.itemRow}>
          <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={2}>{a.label}</Text>
          <PButton small label="EDIT" onPress={() => startEdit(a.id)} />
          <PButton small label="X" onPress={() => Alert.alert('Delete this address?', a.label, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => run(() => pw.deleteAddress(a.id)) }])} />
        </View>
      ))}
      <ErrorText error={error} />
    </>
  )
}

// ---------- about ----------

const LICENSES = [
  ['Press Start 2P font', 'SIL Open Font License 1.1'],
  ['React Native', 'MIT'],
  ['Expo', 'MIT'],
  ['react-native-webview', 'MIT'],
  ['@noble/ciphers, @noble/hashes, @scure/bip39', 'MIT'],
  ['Anthropic SDK', 'MIT'],
]

function AboutPage({ go }) {
  const checkUpdates = useStore((s) => s.checkUpdates)
  const [status, setStatus] = useState('')
  const version = Constants.expoConfig?.version || '?'
  return (
    <>
      <View style={st.card}>
        <PText style={{ color: C.teal }}>BIT BROWSER</PText>
        <Text style={[st.body2, { marginTop: 6 }]}>Version {version}</Text>
        <Text style={st.muted}>Part of the 128bit family.</Text>
      </View>
      {Platform.OS === 'android' && (
        <>
          <PText style={st.h}>UPDATES</PText>
          <Toggle value={checkUpdates} onChange={(v) => update((s) => (s.checkUpdates = v))} label="Tell me when a new version is out" note="For the app installed from GitHub. Google Play updates it for you." />
          <View style={st.row}>
            <PButton
              label="CHECK NOW"
              onPress={async () => {
                setStatus('Checking…')
                const u = await checkForAppUpdate()
                if (!u) return setStatus("You're on the newest version.")
                setStatus(`Bit Browser ${u.version} is out.`)
                Alert.alert(`Bit Browser ${u.version} is out`, 'Download it now?', [
                  { text: 'Later', style: 'cancel' },
                  { text: 'Get it', onPress: () => Linking.openURL(u.url) },
                ])
              }}
            />
          </View>
          {!!status && <Text style={st.muted}>{status}</Text>}
        </>
      )}
      <PText style={st.h}>LICENSES</PText>
      {LICENSES.map(([name, lic]) => (
        <View key={name} style={st.itemRow}>
          <Text style={[st.rowTitle, { flex: 1 }]}>{name}</Text>
          <Text style={st.muted}>{lic}</Text>
        </View>
      ))}
      <PButton label="SOURCE CODE ON GITHUB" style={{ alignSelf: 'flex-start', marginTop: 12 }} onPress={() => go(REPO_URL)} />
    </>
  )
}

// ---------- QR scanner ----------

function Scanner({ onCode, onClose, insets }) {
  const [permission, requestPermission] = useCameraPermissions()
  const [done, setDone] = useState(false)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (onClose(), true))
    return () => sub.remove()
  }, [])
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {!permission?.granted && (
          <>
            <Text style={{ color: C.ink, textAlign: 'center', paddingHorizontal: 24 }}>Bit Browser needs the camera to scan the sync QR code on your computer.</Text>
            <PButton hot label="ALLOW CAMERA" onPress={requestPermission} />
          </>
        )}
      </View>
      {permission?.granted && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={done ? undefined : ({ data }) => { setDone(true); onCode(data) }}
        />
      )}
      <PText style={{ position: 'absolute', top: insets.top + 16, alignSelf: 'center', color: C.ink, backgroundColor: C.bg, padding: 8 }}>SCAN THE SYNC QR CODE</PText>
      <PButton label="CANCEL" onPress={onClose} style={{ position: 'absolute', bottom: insets.bottom + 24, alignSelf: 'center' }} />
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  body: { padding: 16, gap: 6 },
  h: { color: C.teal, marginTop: 22, marginBottom: 6 },
  group: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel },
  navRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, minHeight: 52 },
  navDivider: { borderTopWidth: 1, borderTopColor: C.edge },
  rowTitle: { color: C.ink, fontSize: 15 },
  muted: { color: C.muted, fontSize: 13 },
  body2: { color: C.ink, fontSize: 14, lineHeight: 20 },
  label: { color: C.muted, fontSize: 13, marginTop: 10 },
  list: { gap: 6, marginTop: 8 },
  choice: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, padding: 10, flexDirection: 'row', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.edge },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.edge },
  codeBox: { marginTop: 12, padding: 10, borderWidth: 3, borderColor: C.orange },
  card: { borderWidth: 3, borderColor: C.teal, backgroundColor: C.panel, padding: 12, marginTop: 8 },
  stat: { flex: 1, borderWidth: 3, padding: 12, alignItems: 'center', gap: 6, backgroundColor: C.panel },
})
