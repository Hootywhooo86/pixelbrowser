// Settings, laid out like Brave's: a searchable list of sections, each row
// opening its own page. Full screen, kept clear of the status bar and the
// gesture bar with safe-area insets.

import { useEffect, useMemo, useState } from 'react'
import { Modal, ScrollView, View, Text, Pressable, Switch, StyleSheet, Alert, Platform, Linking, BackHandler, useWindowDimensions } from 'react-native'
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
import { C, setTheme, PIXEL_FONT } from './theme'
import { THEMES, SWATCHES, themeColors } from './themes'
import { BADGES, levelOf, progressOf } from './xp'
import DataDashboard from './DataDashboard'
import Mascot from './Mascot'

const REPO_URL = 'https://github.com/Hootywhooo86/pixelbrowser'

// Brave's structure. `keywords` feed the search box.
const SECTIONS = [
  {
    title: 'FEATURES',
    rows: [
      { id: 'shields', title: 'Shields & privacy', sub: 'Blocking, cookies, clear data', keywords: 'privacy tracker ads cookies https clear history data shields block blocker youtube phishing malware dns lock dashboard' },
      { id: 'ai', title: 'Bitter AI', sub: 'AI slider, model, keys, memory', keywords: 'ai bitter model provider key api memory claude chatgpt gemini spending cap budget cost activity log' },
      { id: 'sync', title: 'Sync', sub: 'Encrypted sync with your computer', keywords: 'sync qr code devices tabs encrypted' },
      { id: 'family', title: '128bit family', sub: 'Account, XP and streaks', keywords: '128bit family account xp streak quests events badges level bitcaller tracker' },
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
      { id: 'tabs', title: 'Tabs and tab groups', sub: 'Spaces, hide bars when scrolling', keywords: 'tabs groups grid list spaces workspaces work personal scroll hide bars smooth' },
      { id: 'media', title: 'Media', sub: 'Autoplay, full-screen video', keywords: 'media video fullscreen full screen rotate landscape autoplay' },
      { id: 'appearance', title: 'Appearance', sub: 'Pixel themes, tab skins, sounds', keywords: 'appearance theme dark light colors custom skin sound effects retro game boy arcade' },
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

const TITLES = {
  ...Object.fromEntries(SECTIONS.flatMap((s) => s.rows.map((r) => [r.id, r.title]))),
  // pages opened from inside other pages
  data: 'Data on this phone',
  agentlog: 'Bitter activity log',
  spaces: 'Spaces',
}
// Where BACK goes from a sub-page.
const PARENT = { data: 'shields', agentlog: 'ai', spaces: 'tabs' }

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

  const { width } = useWindowDimensions()
  const wide = width >= 700 // tablets and Chromebooks: list on the left, page on the right

  const back = () => {
    if (scanning) return setScanning(null)
    if (page) return setPage(PARENT[page] || null)
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
          {page && !(wide && !PARENT[page]) ? <PButton small label="< BACK" onPress={() => setPage(PARENT[page] || null)} /> : null}
          <PText style={{ flex: 1 }} numberOfLines={1}>{page ? (TITLES[page] || '').toUpperCase() : 'SETTINGS'}</PText>
          <PButton small label="DONE" hot onPress={onClose} />
        </View>
        {wide ? (
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <ScrollView style={st.pane} contentContainerStyle={[st.body, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
              <SettingsList sections={sections} query={query} setQuery={setQuery} page={page} setPage={setPage} />
            </ScrollView>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={[st.body, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
              {page ? <Page id={page} go={go} open={setPage} downloadsScreen={downloadsScreen} onScan={setScanning} /> : <Text style={[st.muted, { marginTop: 24 }]}>Pick a setting on the left.</Text>}
            </ScrollView>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[st.body, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
            {!page ? (
              <SettingsList sections={sections} query={query} setQuery={setQuery} page={page} setPage={setPage} />
            ) : (
              <Page id={page} go={go} open={setPage} downloadsScreen={downloadsScreen} onScan={setScanning} />
            )}
          </ScrollView>
        )}
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

function SettingsList({ sections, query, setQuery, page, setPage }) {
  return (
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
                style={({ pressed }) => [st.navRow, i > 0 && st.navDivider, page === r.id && { backgroundColor: C.edge }, pressed && { backgroundColor: C.edge }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{r.title}</Text>
                  {!!r.sub && <Text style={st.muted} numberOfLines={1}>{r.sub}</Text>}
                </View>
                <Text style={st.chev}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {!sections.length && <Text style={[st.muted, { marginTop: 16 }]}>No settings match “{query}”.</Text>}
    </>
  )
}

function Page({ id, go, open, downloadsScreen, onScan }) {
  switch (id) {
    case 'shields':
      return <ShieldsPage open={open} />
    case 'data':
      return <DataDashboard />
    case 'ai':
      return <AIPage go={go} open={open} />
    case 'agentlog':
      return <AgentLogPage />
    case 'spaces':
      return <SpacesPage />
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
      return <TabsPage open={open} />
    case 'media':
      return <MediaPage />
    case 'appearance':
      return <AppearancePage />
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
      <Switch value={!!value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} trackColor={{ false: C.edge, true: C.tealDark }} thumbColor={value ? C.teal : C.muted} />
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

import { LIST_INFO, setShieldsEnabled, setListEnabled, updateListsNow, setSiteShields, useShieldsStatus } from './shields'

// Filter lists the phone can use, from the Shields engine.
const SHIELD_LISTS = LIST_INFO.filter((l) => !l.regional)

const fmt = (n) => Number(n || 0).toLocaleString()

async function openPrivateDnsSettings() {
  if (Platform.OS !== 'android') return Linking.openSettings()
  try {
    // Android has no direct link to Private DNS; it lives under Network & internet.
    await Linking.sendIntent('android.settings.WIRELESS_SETTINGS')
  } catch {
    await Linking.openSettings()
  }
}

function ShieldsPage({ open }) {
  const sh = useStore((s) => s.shields)
  const phishing = useStore((s) => s.phishing?.enabled !== false)
  const privateLock = useStore((s) => !!s.privateLock)
  const history = useStore((s) => Object.keys(s.records.history).length)
  const siteOff = Object.keys(sh?.siteOff || {}).filter((h) => sh.siteOff[h]).sort()
  const totals = sh?.totals || {}
  const status = useShieldsStatus() || {}
  return (
    <>
      <View style={[st.card, { borderColor: sh?.enabled ? C.teal : C.edge }]}>
        <Toggle value={sh?.enabled} onChange={(v) => setShieldsEnabled(v)} label="Bit Shields" note="Block ads, trackers and YouTube ads on every site" />
        <View style={[st.row, { marginTop: 4 }]}>
          <Stat value={fmt(totals.ads)} label="ADS BLOCKED" color={C.orange} />
          <Stat value={fmt(totals.trackers)} label="TRACKERS" color={C.teal} />
        </View>
        <Text style={[st.muted, { marginTop: 8 }]}>Counted on this phone only. Nothing about what you browse is sent anywhere.</Text>
      </View>

      <PText style={st.h}>FILTER LISTS</PText>
      <Text style={st.muted}>Lists download straight from the people who make them and update on their own.</Text>
      {SHIELD_LISTS.map((l) => (
        <Toggle key={l.id} value={sh?.lists?.[l.id]} onChange={(v) => setListEnabled(l.id, v)} label={l.name} note={l.description} disabled={!sh?.enabled} />
      ))}
      <View style={st.row}>
        <PButton label={status.updating ? 'UPDATING…' : 'UPDATE LISTS NOW'} onPress={() => updateListsNow()} disabled={!sh?.enabled || status.updating} />
        <Text style={[st.muted, { flex: 1 }]}>{status.error ? `Couldn't update: ${status.error}` : sh?.lastUpdate ? `Updated ${new Date(sh.lastUpdate).toLocaleString()}${status.rules ? ` · ${fmt(status.rules)} rules` : ''}` : 'Not downloaded yet'}</Text>
      </View>

      <PText style={st.h}>SHIELDS DOWN FOR</PText>
      {!siteOff.length && <Text style={st.muted}>No sites. Turn Shields off for one site from the shield button in the address bar.</Text>}
      {siteOff.map((host) => (
        <View key={host} style={st.itemRow}>
          <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>{host}</Text>
          <PButton small label="SHIELDS UP" onPress={() => setSiteShields(`https://${host}/`, true)} />
        </View>
      ))}

      <PText style={st.h}>SAFETY</PText>
      <Toggle value={phishing} onChange={(v) => update((s) => (s.phishing = { ...s.phishing, enabled: v }))} label="Warn me about phishing and malware sites" note="Checked on this phone against free blocklists. The sites you visit are never sent anywhere." />
      <Toggle value={privateLock} onChange={(v) => update((s) => (s.privateLock = v))} label="Lock private tabs with fingerprint or face" note="Asks before showing private tabs when you come back to the app" />
      <Text style={st.label}>Secure DNS (DNS over HTTPS)</Text>
      <Text style={st.body2}>
        {Platform.OS === 'android'
          ? 'On Android, secure DNS is set for the whole phone. Open Settings → Network & internet → Private DNS, then pick "Private DNS provider hostname" and type one of: one.one.one.one (Cloudflare), dns.quad9.net (Quad9) or your NextDNS address.'
          : 'iPhone uses secure DNS through a DNS profile or app from your provider (Cloudflare 1.1.1.1, Quad9, NextDNS).'}
      </Text>
      <PButton label="OPEN NETWORK SETTINGS" style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={openPrivateDnsSettings} />

      <PText style={st.h}>YOUR DATA</PText>
      <NavRow title="Data on this phone" sub="What's stored, what's synced, delete it" onPress={() => open('data')} />
      <Text style={[st.muted, { marginTop: 10 }]}>{history} pages in your history.</Text>
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
      <PText style={st.h}>ALWAYS ON</PText>
      <Text style={st.body2}>• Third-party cookies blocked</Text>
      <Text style={st.body2}>• Private tabs keep no history or cookies</Text>
      <Text style={st.body2}>• Sites load over HTTPS when they support it</Text>
    </>
  )
}

function Stat({ value, label, color }) {
  return (
    <View style={[st.stat, { borderColor: color }]}>
      <PText style={{ color }} numberOfLines={1} adjustsFontSizeToFit>{value}</PText>
      <Text style={st.muted} numberOfLines={1}>{label}</Text>
    </View>
  )
}

function NavRow({ title, sub, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [st.group, st.navRow, { marginTop: 8 }, pressed && { backgroundColor: C.edge }]}>
      <View style={{ flex: 1 }}>
        <Text style={st.rowTitle} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={st.muted} numberOfLines={1}>{sub}</Text>}
      </View>
      <Text style={st.chev}>›</Text>
    </Pressable>
  )
}

function AIPage({ go, open }) {
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

      <PText style={st.h}>SPENDING CAP</PText>
      <SpendingCaps />

      <PText style={st.h}>ACTIVITY</PText>
      <NavRow title="Bitter activity log" sub="Everything Bitter clicked, typed or opened" onPress={() => open('agentlog')} />
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
  const xp = useStore((s) => s.xp) || {}
  const links = useStore((s) => s.familyLinks) || {}
  const prog = progressOf(xp.total || 0)
  const earned = BADGES.filter((b) => xp.badges?.[b.id]).length
  return (
    <>
      <View style={[st.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
        <Mascot size={64} />
        <View style={{ flex: 1 }}>
          <PText style={{ color: C.teal }}>LEVEL {prog.level}</PText>
          <View style={st.xpBar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: prog.needed, now: prog.into }}>
            <View style={[st.xpFill, { width: `${Math.max(3, Math.round(prog.pct * 100))}%` }]} />
          </View>
          <Text style={st.muted}>
            {fmt(xp.total)} XP · {fmt(prog.needed - prog.into)} to level {prog.level + 1}
          </Text>
        </View>
      </View>
      <View style={st.row}>
        <Stat value={fmt(xp.streak)} label="DAY STREAK" color={C.orange} />
        <Stat value={`${earned}/${BADGES.length}`} label="BADGES" color={C.teal} />
      </View>
      <Text style={[st.muted, { marginTop: 8 }]}>XP is kept on this phone and synced (encrypted) to your other devices. It joins your 128bit account when accounts arrive.</Text>

      <PText style={st.h}>BADGES</PText>
      <View style={st.badges}>
        {BADGES.map((b) => {
          const got = !!xp.badges?.[b.id]
          return (
            <View key={b.id} style={[st.badge, got ? { borderColor: C.orange } : { opacity: 0.45 }]} accessibilityLabel={`${b.label}: ${got ? 'earned' : 'not earned yet'}. ${b.note}`}>
              <View style={[st.badgeIcon, { backgroundColor: got ? C.orange : C.edge }]}>
                <Text style={st.badgeIconText}>{got ? '★' : '?'}</Text>
              </View>
              <Text style={st.badgeTitle} numberOfLines={2}>{b.label}</Text>
              <Text style={[st.muted, { fontSize: 11, textAlign: 'center' }]} numberOfLines={2}>{b.note}</Text>
            </View>
          )
        })}
      </View>

      <PText style={st.h}>FAMILY APPS</PText>
      <Toggle value={links.bitcaller !== false} onChange={(v) => update((s) => (s.familyLinks = { ...s.familyLinks, bitcaller: v }))} label="Open phone numbers in BitCaller" note="Tap a phone number on a page to call with BitCaller (or your phone app if BitCaller isn't installed)" />
      <Toggle value={links.tracker !== false} onChange={(v) => update((s) => (s.familyLinks = { ...s.familyLinks, tracker: v }))} label='Show "Add to 128bittracker"' note="On TV show and movie pages (IMDb, TMDB and streaming sites)" />
      {FAMILY_APPS.map((a) => (
        <View key={a.id} style={st.itemRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.rowTitle}>{a.label}</Text>
            <Text style={st.muted}>{a.note}</Text>
          </View>
        </View>
      ))}

      <View style={[st.card, { marginTop: 18 }]}>
        <PText style={{ color: C.teal }}>128BIT ACCOUNT</PText>
        <Text style={[st.body2, { marginTop: 8 }]}>
          {f.connected ? `Signed in as ${f.account?.name || 'you'}.` : 'Connect a 128bit account to share XP and streaks with the family and get quests from 128bitlife.'}
        </Text>
        <View style={st.row}>
          {f.connected ? (
            <PButton label="DISCONNECT" onPress={disconnectFamily} />
          ) : (
            <PButton hot label="CONNECT" onPress={() => Alert.alert('Coming soon', '128bit accounts are coming soon. Everything here stays off until you connect.')} />
          )}
          {!f.connected && <Text style={st.muted}>COMING SOON</Text>}
        </View>
      </View>
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

function TabsPage({ open }) {
  const s = useStore()
  return (
    <>
      <Toggle
        value={!!s.hideBarsOnScroll}
        onChange={(v) => update((x) => (x.hideBarsOnScroll = v))}
        label="Hide bars when scrolling"
        note="Off is smoothest. On: the address bar and buttons slide away when you scroll down."
      />
      <NavRow title="Spaces" sub={`${(s.spaces || []).length} spaces: keep work, personal and 128bit tabs apart`} onPress={() => open('spaces')} />
      <Text style={st.label}>Tab switcher layout</Text>
      <View style={st.row}>
        {['grid', 'list'].map((v) => (
          <PButton key={v} label={v.toUpperCase()} hot={s.tabLayout === v} onPress={() => update((x) => (x.tabLayout = v))} />
        ))}
      </View>
      <Toggle value={s.closeTabsOnExit} onChange={(v) => update((x) => (x.closeTabsOnExit = v))} label="Close tabs when I leave the app" />
    </>
  )
}

function SpacesPage() {
  const spaces = useStore((s) => s.spaces || [])
  const activeSpace = useStore((s) => s.activeSpace || 'personal')
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null) // { id, name }
  const add = () => {
    const n = name.trim().slice(0, 24)
    if (!n) return
    const id = `${n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'space'}-${Date.now().toString(36)}`
    update((s) => (s.spaces = [...(s.spaces || []), { id, name: n }]))
    setName('')
  }
  const remove = (sp) =>
    Alert.alert(`Delete ${sp.name}?`, 'Its tabs move to your current space. Bitter forgets what it remembered for this space.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => update((s) => (s.spaces = s.spaces.filter((x) => x.id !== sp.id))) },
    ])
  return (
    <>
      <Text style={st.body2}>Each space has its own tabs and its own Bitter memory. Switch spaces from the top of the tabs screen.</Text>
      {spaces.map((sp) => (
        <View key={sp.id} style={st.itemRow}>
          {editing?.id === sp.id ? (
            <>
              <Field style={{ flex: 1 }} value={editing.name} onChangeText={(v) => setEditing({ ...editing, name: v })} autoFocus />
              <PButton
                small
                hot
                label="SAVE"
                onPress={() => {
                  const n = editing.name.trim().slice(0, 24)
                  if (n) update((s) => (s.spaces = s.spaces.map((x) => (x.id === sp.id ? { ...x, name: n } : x))))
                  setEditing(null)
                }}
              />
            </>
          ) : (
            <>
              <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>
                {sp.name}
                {sp.id === activeSpace ? '  (current)' : ''}
              </Text>
              <PButton small label="RENAME" onPress={() => setEditing({ id: sp.id, name: sp.name })} />
              <PButton small label="X" accessibilityLabel={`Delete ${sp.name}`} disabled={sp.id === activeSpace || spaces.length <= 1} onPress={() => remove(sp)} />
            </>
          )}
        </View>
      ))}
      <View style={st.row}>
        <Field style={{ flex: 1 }} value={name} onChangeText={setName} placeholder="New space, e.g. School" onSubmitEditing={add} returnKeyType="done" />
        <PButton hot label="ADD" onPress={add} />
      </View>
      <Text style={[st.muted, { marginTop: 8 }]}>You can't delete the space you're in or your last space.</Text>
    </>
  )
}

function MediaPage() {
  const s = useStore()
  const autoplay = s.autoplay || 'muted'
  const choices = [
    ['off', 'OFF', "Videos never start on their own"],
    ['muted', 'MUTED ONLY', 'Silent previews can play; sound waits for a tap (smoothest)'],
    ['on', 'ON', 'Videos can start with sound'],
  ]
  return (
    <>
      <Text style={st.label}>Autoplay</Text>
      <View style={st.list}>
        {choices.map(([id, label, note]) => (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ checked: autoplay === id }}
            onPress={() => update((x) => (x.autoplay = id))}
            style={({ pressed }) => [st.choice, { flexDirection: 'column', gap: 4 }, autoplay === id && { borderColor: C.teal }, pressed && { opacity: 0.85 }]}
          >
            <PText style={{ color: autoplay === id ? C.teal : C.ink }}>{label}</PText>
            <Text style={st.muted}>{note}</Text>
          </Pressable>
        ))}
      </View>
      <PText style={st.h}>FULL SCREEN</PText>
      <Toggle value={s.fullscreenVideo} onChange={(v) => update((x) => (x.fullscreenVideo = v))} label="Full-screen videos" note="Let videos (YouTube and others) fill the screen" />
      <Toggle value={s.rotateFullscreen} onChange={(v) => update((x) => (x.rotateFullscreen = v))} label="Turn sideways in full screen" note="Rotate to landscape while a video is full screen" disabled={!s.fullscreenVideo} />
    </>
  )
}

function AppearancePage() {
  const s = useStore()
  const current = s.theme || 'bit'
  const [custom, setCustom] = useState(() => s.customTheme || { accent: C.teal, bg: C.bg, panel: C.panel, ink: C.ink })
  const [slot, setSlot] = useState('accent')
  const [msg, setMsg] = useState('')
  const apply = async (choice) => {
    setMsg('Applying…')
    const reloaded = await setTheme(choice)
    if (!reloaded) setMsg('Saved. Close and reopen Bit Browser to see the new theme.')
  }
  const preview = themeColors({ id: 'custom', custom }).colors
  return (
    <>
      <Text style={st.label}>Pixel themes</Text>
      <View style={st.themeGrid}>
        {Object.values(THEMES).map((t) => (
          <ThemeCard key={t.id} name={t.label} colors={t.colors} on={current === t.id} onPress={() => apply({ id: t.id })} />
        ))}
      </View>

      <PText style={st.h}>BUILD YOUR OWN</PText>
      <View style={st.row}>
        {[
          ['accent', 'ACCENT'],
          ['bg', 'BACKGROUND'],
          ['panel', 'PANELS'],
          ['ink', 'TEXT'],
        ].map(([id, label]) => (
          <Pressable key={id} onPress={() => setSlot(id)} accessibilityRole="radio" accessibilityState={{ checked: slot === id }} style={[st.slot, slot === id && { borderColor: C.teal }]}>
            <View style={[st.slotDot, { backgroundColor: custom[id] }]} />
            <Text style={[st.slotText, slot === id && { color: C.ink }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={st.swatches}>
        {SWATCHES.map((hex) => (
          <Pressable
            key={hex}
            onPress={() => setCustom({ ...custom, [slot]: hex })}
            accessibilityLabel={`Color ${hex}`}
            style={[st.swatch, { backgroundColor: hex }, custom[slot] === hex && { borderColor: C.orange, borderWidth: 3 }]}
          />
        ))}
      </View>
      <ThemeCard name="Your theme" colors={preview} on={current === 'custom'} wide />
      <PButton hot label="USE MY THEME" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={() => apply({ id: 'custom', custom })} />
      {!!msg && <Text style={[st.muted, { marginTop: 6 }]}>{msg}</Text>}

      <PText style={st.h}>TAB CARDS</PText>
      <View style={st.row}>
        {[
          ['classic', 'CLASSIC'],
          ['chunky', 'CHUNKY'],
        ].map(([id, label]) => (
          <PButton key={id} label={label} hot={(s.tabSkin || 'classic') === id} onPress={() => update((x) => (x.tabSkin = id))} />
        ))}
      </View>
      <PText style={st.h}>SOUND</PText>
      <Toggle value={!!s.sounds} onChange={(v) => update((x) => (x.sounds = v))} label="Retro sound effects" note="Bleeps for new tabs, blocked ads and level-ups" />
    </>
  )
}

function ThemeCard({ name, colors, on, onPress, wide }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'radio' : undefined}
      accessibilityState={onPress ? { checked: on } : undefined}
      accessibilityLabel={name}
      style={({ pressed }) => [st.themeCard, wide && { width: '100%', marginTop: 10 }, { backgroundColor: colors.bg, borderColor: on ? colors.orange : colors.edge }, pressed && { opacity: 0.85 }]}
    >
      <View style={[st.themeBar, { backgroundColor: colors.panel, borderBottomColor: colors.teal }]}>
        <View style={[st.themeLogo, { backgroundColor: colors.teal }]}>
          <Text style={[st.themeLogoText, { color: colors.bg }]}>B</Text>
        </View>
        <View style={[st.themeUrl, { backgroundColor: colors.bg, borderColor: colors.edge }]} />
      </View>
      <View style={{ padding: 8, gap: 4 }}>
        <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{name}</Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {[colors.teal, colors.orange, colors.pink, colors.muted].map((c, i) => (
            <View key={i} style={{ width: 12, height: 12, backgroundColor: c }} />
          ))}
        </View>
      </View>
      {on && <Text style={[st.themeOn, { color: colors.orange }]}>ON</Text>}
    </Pressable>
  )
}

function SpendingCaps() {
  const sp = useStore((s) => s.spending) || {}
  const [day, setDay] = useState(sp.capDay ? String(sp.capDay) : '')
  const [month, setMonth] = useState(sp.capMonth ? String(sp.capMonth) : '')
  const [saved, setSaved] = useState(false)
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  const monthKey = today.slice(0, 7)
  const spent = sp.spent || {}
  const spentToday = Number(spent[today] || 0)
  const spentMonth = Object.entries(spent).reduce((sum, [k, v]) => (k.startsWith(monthKey) ? sum + Number(v || 0) : sum), 0)
  const money = (v) => `$${Number(v || 0).toFixed(2)}`
  const save = () => {
    const toCap = (v) => Math.max(0, Math.round((parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0) * 100) / 100)
    update((s) => (s.spending = { ...s.spending, capDay: toCap(day), capMonth: toCap(month) }))
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  return (
    <>
      <Text style={st.muted}>Bitter stops and asks you before going over these. Costs are estimates from your AI provider's prices. Leave empty for no cap.</Text>
      <View style={st.row}>
        <Stat value={money(spentToday)} label={sp.capDay ? `TODAY / ${money(sp.capDay)}` : 'TODAY'} color={sp.capDay && spentToday >= sp.capDay ? C.pink : C.teal} />
        <Stat value={money(spentMonth)} label={sp.capMonth ? `MONTH / ${money(sp.capMonth)}` : 'THIS MONTH'} color={sp.capMonth && spentMonth >= sp.capMonth ? C.pink : C.teal} />
      </View>
      <View style={st.row}>
        <View style={{ flex: 1 }}>
          <Text style={st.label}>Per day ($)</Text>
          <Field value={day} onChangeText={setDay} keyboardType="decimal-pad" placeholder="No cap" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.label}>Per month ($)</Text>
          <Field value={month} onChangeText={setMonth} keyboardType="decimal-pad" placeholder="No cap" />
        </View>
      </View>
      <PButton hot label={saved ? 'SAVED' : 'SAVE CAPS'} style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={save} />
    </>
  )
}

const LOG_COLORS = { click: 'teal', type: 'orange', navigate: 'teal', confirm: 'pink', open: 'teal' }

function AgentLogPage() {
  const log = useStore((s) => s.agentLog) || []
  const items = useMemo(() => [...log].reverse(), [log])
  return (
    <>
      <Text style={st.body2}>Every click, typed text, page and confirmation from Bitter's agent mode, newest first. Kept on this phone only.</Text>
      <PButton
        label="CLEAR LOG"
        disabled={!log.length}
        style={{ alignSelf: 'flex-start', marginTop: 8 }}
        onPress={() => Alert.alert('Clear the activity log?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => update((s) => (s.agentLog = [])) }])}
      />
      {!items.length && <Text style={[st.muted, { marginTop: 12 }]}>Nothing yet. Use "Let Bitter take over" and its steps show up here.</Text>}
      {items.map((e, i) => (
        <View key={e.id || i} style={[st.logRow, { borderLeftColor: C[LOG_COLORS[e.kind]] || C.edge }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={st.logKind}>{String(e.kind || 'step').toUpperCase()}</Text>
            <Text style={st.muted} numberOfLines={1}>{e.at ? new Date(e.at).toLocaleString() : ''}</Text>
          </View>
          <Text style={st.body2}>{e.text}</Text>
          {!!e.site && <Text style={st.muted} numberOfLines={1}>{e.site}</Text>}
        </View>
      ))}
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

const noPad = Platform.OS === 'android' ? { includeFontPadding: false, textAlignVertical: 'center' } : {}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  body: { padding: 16, gap: 6 },
  h: { color: C.teal, marginTop: 24, marginBottom: 8 },
  group: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel },
  navRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, minHeight: 52 },
  navDivider: { borderTopWidth: 1, borderTopColor: C.edge },
  rowTitle: { color: C.ink, fontSize: 15 },
  muted: { color: C.muted, fontSize: 13 },
  body2: { color: C.ink, fontSize: 14, lineHeight: 20 },
  label: { color: C.muted, fontSize: 13, marginTop: 10 },
  list: { gap: 6, marginTop: 8 },
  choice: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, padding: 10, flexDirection: 'row', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 56, borderBottomWidth: 1, borderBottomColor: C.edge },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, minHeight: 48, borderBottomWidth: 1, borderBottomColor: C.edge },
  codeBox: { marginTop: 12, padding: 10, borderWidth: 3, borderColor: C.orange },
  card: { borderWidth: 3, borderColor: C.teal, backgroundColor: C.panel, padding: 12, marginTop: 8 },
  stat: { flex: 1, minWidth: 120, borderWidth: 3, padding: 12, alignItems: 'center', gap: 6, backgroundColor: C.panel },
  pane: { width: 340, maxWidth: '42%', borderRightWidth: 3, borderRightColor: C.edge },
  chev: { color: C.muted, fontSize: 20, lineHeight: 22, marginLeft: 8, ...noPad },
  xpBar: { height: 12, borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg, marginVertical: 8 },
  xpFill: { height: '100%', backgroundColor: C.orange },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '31%', minWidth: 96, flexGrow: 1, borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, padding: 8, alignItems: 'center', gap: 4 },
  badgeIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  badgeIconText: { color: C.bg, fontSize: 16, fontWeight: '900', ...noPad },
  badgeTitle: { color: C.ink, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  themeCard: { width: '47%', flexGrow: 1, minWidth: 140, borderWidth: 3 },
  themeBar: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderBottomWidth: 3 },
  themeLogo: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  themeLogoText: { fontFamily: PIXEL_FONT, fontSize: 8, lineHeight: 10, ...noPad },
  themeUrl: { flex: 1, height: 14, borderWidth: 2 },
  themeOn: { position: 'absolute', right: 8, bottom: 8, fontFamily: PIXEL_FONT, fontSize: 8 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, paddingHorizontal: 8, height: 36 },
  slotDot: { width: 16, height: 16, borderWidth: 2, borderColor: C.edge },
  slotText: { fontFamily: PIXEL_FONT, fontSize: 7, lineHeight: 10, color: C.muted, ...noPad },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  swatch: { width: 30, height: 30, borderWidth: 2, borderColor: C.edge },
  logRow: { borderLeftWidth: 4, backgroundColor: C.panel, padding: 10, marginTop: 8, gap: 4 },
  logKind: { fontFamily: PIXEL_FONT, fontSize: 7, lineHeight: 10, color: C.muted, ...noPad },
})
