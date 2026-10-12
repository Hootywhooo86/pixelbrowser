// Settings: pick any AI, memory, and end-to-end encrypted sync.

import { useEffect, useState } from 'react'
import { Modal, ScrollView, View, Text, Pressable, Switch, StyleSheet, Alert, Platform } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { PROVIDERS, SEARCH_ENGINES } from '@pixelbrowser/ai-core'
import { parseSyncQr } from '@pixelbrowser/sync-core'
import { useStore, update, memory, getState, setSearchEngine } from './store'
import { saveAISettings, setAIEnabled } from './ai'
import { createChain, joinChain, leaveChain, showCode, syncNow, remoteTabs } from './sync'
import { PButton, PText, Field, PSwitch } from './ui'
import { C } from './theme'

export default function SettingsSheet({ visible, onClose, openUrl }) {
  const state = useStore()
  const [provider, setProvider] = useState(state.ai.provider)
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [memInput, setMemInput] = useState('')
  const [server, setServer] = useState(state.sync.server)
  const [code, setCode] = useState('')
  const [shownCode, setShownCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [customUrl, setCustomUrl] = useState(state.customSearchUrl)
  const [pickCustom, setPickCustom] = useState(false)

  const p = PROVIDERS[provider]
  useEffect(() => {
    const o = state.ai.providers[provider] || {}
    setModel(o.model || p.model || '')
    setBaseUrl(o.baseUrl || p.baseUrl || '')
    setApiKey('')
  }, [provider, visible])

  const run = async (fn) => {
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(String(err.message || err))
    }
  }

  const save = () =>
    run(async () => {
      await saveAISettings({ provider, model, baseUrl, ...(apiKey ? { apiKey } : {}) })
      setApiKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={st.wrap}>
        <View style={st.head}>
          <PText style={{ flex: 1 }}>SETTINGS</PText>
          <PButton small label="DONE" hot onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <PText style={[st.h, { marginTop: 4 }]}>SEARCH ENGINE</PText>
          <Text style={st.muted}>Used when you type words in the address bar.</Text>
          <View style={st.providers}>
            {Object.entries(SEARCH_ENGINES).map(([id, e]) => {
              const on = id === 'custom' ? pickCustom || state.searchEngine === 'custom' : state.searchEngine === id && !pickCustom
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => (id === 'custom' ? setPickCustom(true) : (setPickCustom(false), setSearchEngine(id)))}
                  style={[st.provider, { flexDirection: 'column' }, on && { borderColor: C.teal }]}
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

          <PText style={st.h}>AI</PText>
          <View style={st.row}>
            <PSwitch value={state.aiEnabled} onChange={setAIEnabled} />
            <Text style={{ color: C.ink, flex: 1 }}>
              {state.aiEnabled ? 'AI is on.' : 'AI is off: private mode. Nothing is sent to any AI.'}
            </Text>
          </View>
          <Text style={st.muted}>Turn AI off any time to browse privately. Your AI settings and memory stay saved on this phone.</Text>

          <PText style={st.h}>AI MODEL</PText>
          <Text style={st.muted}>Pick any AI. Bring your own key, or point it at a model running on your own computer.</Text>
          <View style={st.providers}>
            {Object.entries(PROVIDERS).map(([id, info]) => (
              <Pressable key={id} onPress={() => setProvider(id)} style={[st.provider, provider === id && { borderColor: C.teal }]}>
                <Text style={{ color: provider === id ? C.ink : C.muted, fontSize: 13 }}>{info.label}</Text>
                {state.keysPresent[id] && <Text style={{ color: C.teal, fontSize: 11 }}>key saved</Text>}
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
            {!!p.keyUrl && <PButton label="GET A KEY" onPress={() => { onClose(); openUrl(p.keyUrl) }} />}
          </View>

          <PText style={st.h}>MEMORY</PText>
          <View style={st.row}>
            <Switch value={state.memoryEnabled} onValueChange={(v) => update((s) => (s.memoryEnabled = v))} />
            <Text style={{ color: C.ink, flex: 1 }}>Let Pixel remember things you tell it</Text>
          </View>
          {memory.items().map((m) => (
            <View key={m} style={st.memRow}>
              <Text style={{ color: C.ink, flex: 1 }}>{m}</Text>
              <PButton small label="X" onPress={() => memory.remove(m)} />
            </View>
          ))}
          <View style={st.row}>
            <Field style={{ flex: 1 }} value={memInput} onChangeText={setMemInput} placeholder="e.g. I'm vegetarian" />
            <PButton label="ADD" onPress={() => { memory.add(memInput); setMemInput('') }} />
          </View>

          <PText style={st.h}>SYNC</PText>
          <Text style={st.muted}>Memory, history, open tabs and AI settings sync with your computer. Everything is encrypted on this phone first, so the sync server can't read it.</Text>
          {!state.sync.enabled ? (
            <>
              <Text style={st.label}>Sync server</Text>
              <Field value={server} onChangeText={setServer} placeholder="https://sync.example.com" keyboardType="url" />
              <View style={st.row}>
                <PButton hot label="SCAN QR" onPress={() => setScanning(true)} />
                <PButton label="START NEW" onPress={() => run(async () => setShownCode(await createChain(server)))} />
              </View>
              <Text style={st.label}>…or type the 24-word code from your computer</Text>
              <Field value={code} onChangeText={setCode} multiline style={{ minHeight: 80 }} />
              <PButton label="JOIN" onPress={() => run(() => joinChain(server, code))} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
            </>
          ) : (
            <>
              <Text style={{ color: C.ink }}>
                {state.sync.lastSyncAt ? `Synced ${new Date(state.sync.lastSyncAt).toLocaleString()}` : 'Syncing…'} with {state.sync.server}
              </Text>
              <Text style={st.label}>This device's name</Text>
              <Field value={state.deviceName} onChangeText={(v) => update((s) => (s.deviceName = v.slice(0, 40)))} />
              <View style={st.row}>
                <Switch value={state.sync.syncKeys} onValueChange={(v) => update((s) => (s.sync.syncKeys = v))} />
                <Text style={{ color: C.ink, flex: 1 }}>Also sync my AI keys (encrypted)</Text>
              </View>
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
              <PText style={[st.h, { fontSize: 8 }]}>TABS ON YOUR OTHER DEVICES</PText>
              {remoteTabs().map((d) => (
                <View key={d.deviceName} style={{ marginBottom: 8 }}>
                  <Text style={{ color: C.ink, fontWeight: '700' }}>{d.deviceName}</Text>
                  {d.tabs.map((t, i) => (
                    <Text key={i} style={{ color: C.teal, paddingVertical: 3 }} numberOfLines={1} onPress={() => { onClose(); openUrl(t.url) }}>
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
              <Text selectable style={{ color: C.ink, fontFamily: 'Courier', marginTop: 6 }}>{shownCode}</Text>
            </View>
          )}
          {Platform.OS === 'android' && (
            <>
              <PText style={st.h}>UPDATES</PText>
              <View style={st.row}>
                <Switch value={state.checkUpdates} onValueChange={(v) => update((s) => (s.checkUpdates = v))} />
                <Text style={{ color: C.ink, flex: 1 }}>Tell me when a new version is out</Text>
              </View>
              <Text style={st.muted}>For the app installed from GitHub. Google Play updates it for you. The check only asks GitHub for the newest version number.</Text>
            </>
          )}
          {!!(error || state.sync.error) && <Text style={{ color: C.pink, marginTop: 8 }}>{error || `Sync problem: ${state.sync.error}`}</Text>}
        </ScrollView>
      </View>
      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onCode={(text) => {
            setScanning(false)
            const parsed = parseSyncQr(text)
            if (!parsed) return setError("That QR code isn't a Pixelbrowser sync code.")
            setServer(parsed.server)
            run(() => joinChain(parsed.server || getState().sync.server, parsed.code))
          }}
        />
      )}
    </Modal>
  )
}

function Scanner({ onCode, onClose }) {
  const [permission, requestPermission] = useCameraPermissions()
  const [done, setDone] = useState(false)
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', gap: 12 }]}>
        {!permission?.granted && (
          <>
            <Text style={{ color: C.ink, textAlign: 'center', paddingHorizontal: 24 }}>Pixelbrowser needs the camera to scan the sync QR code on your computer.</Text>
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
      <PButton label="CANCEL" onPress={onClose} style={{ position: 'absolute', bottom: 50, alignSelf: 'center' }} />
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingTop: 20, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  body: { padding: 16, paddingBottom: 60, gap: 6 },
  h: { color: C.teal, marginTop: 22, marginBottom: 4 },
  muted: { color: C.muted, fontSize: 13 },
  label: { color: C.muted, fontSize: 13, marginTop: 10 },
  providers: { gap: 6, marginTop: 8 },
  provider: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.panel, padding: 10, flexDirection: 'row', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  memRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.edge },
  codeBox: { marginTop: 12, padding: 10, borderWidth: 3, borderColor: C.orange },
})
