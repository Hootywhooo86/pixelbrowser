// "Use AI on my computer over Wi-Fi": Bitter talks to Ollama or LM Studio
// running on your own computer, so nothing goes to an AI company and no key
// is needed. (A model running on the phone itself is researched in
// docs/PASSKEYS-TOR-OFFLINE-AI.md; this is the private option that works today.)

import { useState } from 'react'
import { View, Text } from 'react-native'
import { saveAISettings } from './ai'
import { getState } from './store'
import { PButton, Field, PCard } from './ui'
import { Note, Label, f } from './ScreenFrame'
import { C } from './theme'

export const LOCAL_AI = {
  ollama: { label: 'Ollama', port: 11434, setup: 'On the computer, quit Ollama, then start it so other devices can reach it: set OLLAMA_HOST=0.0.0.0 (Windows: System → Environment Variables; Mac: launchctl setenv OLLAMA_HOST 0.0.0.0) and open Ollama again.' },
  lmstudio: { label: 'LM Studio', port: 1234, setup: 'In LM Studio, open the Developer tab, start the server and turn on "Serve on Local Network".' },
}

/** "192.168.1.20" / "192.168.1.20:11434" / "http://pc.local:1234/v1" → "http://host:port". */
export function normalizeLocalAddress(input, kind = 'ollama') {
  let s = String(input || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  try {
    const u = new URL(s)
    if (!u.port) u.port = String(LOCAL_AI[kind]?.port || 11434)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

/** Ask the computer which models it has. Throws a plain-language error if it can't be reached. */
export async function testLocalAI(address, kind = 'ollama') {
  const base = normalizeLocalAddress(address, kind)
  if (!base) throw new Error('Type your computer\'s address, like 192.168.1.20.')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(`${base}/v1/models`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`The computer answered ${res.status}.`)
    const j = await res.json()
    const models = (j.data || []).map((m) => m.id).filter(Boolean)
    return { base, models }
  } catch (e) {
    if (e.name === 'AbortError' || /Network request failed|Failed to fetch/i.test(e.message)) {
      throw new Error(`Couldn't reach ${LOCAL_AI[kind]?.label} at ${base}. Is the computer on the same Wi-Fi, and is ${LOCAL_AI[kind]?.label} set to accept other devices?`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Make Bitter use the computer's AI. */
export async function applyLocalAI({ kind = 'ollama', address, model }) {
  const base = normalizeLocalAddress(address, kind)
  await saveAISettings({ provider: kind, baseUrl: `${base}/v1`, model: model || '' })
}

/** Settings form: pick Ollama or LM Studio, type the computer's address, test, use. */
export function OfflineAIForm({ onDone }) {
  const cur = getState()?.ai || {}
  const curBase = cur.providers?.[cur.provider]?.baseUrl || ''
  const [kind, setKind] = useState(cur.provider === 'lmstudio' ? 'lmstudio' : 'ollama')
  const [address, setAddress] = useState(/localhost|127\.0\.0\.1/.test(curBase) ? '' : curBase.replace(/\/v1\/?$/, ''))
  const [models, setModels] = useState([])
  const [model, setModel] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const test = async () => {
    setBusy(true)
    setMsg('')
    try {
      const r = await testLocalAI(address, kind)
      setModels(r.models)
      setModel(r.models[0] || '')
      setMsg(r.models.length ? `Found ${r.models.length} model${r.models.length > 1 ? 's' : ''}.` : 'Connected, but no models are installed yet.')
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <PCard>
      <Label>AI ON MY COMPUTER (WI-FI)</Label>
      <Note>Private and free: Bitter uses a model running on your own computer. Your phone and computer need to be on the same Wi-Fi.</Note>
      <View style={[f.actions, { marginTop: 6 }]}>
        {Object.entries(LOCAL_AI).map(([id, k]) => (
          <PButton key={id} small hot={kind === id} label={k.label.toUpperCase()} onPress={() => (setKind(id), setModels([]))} />
        ))}
      </View>
      <Note style={{ marginTop: 6 }}>{LOCAL_AI[kind].setup}</Note>
      <Field style={{ marginTop: 6 }} value={address} onChangeText={setAddress} placeholder={`Computer address, e.g. 192.168.1.20:${LOCAL_AI[kind].port}`} keyboardType="url" accessibilityLabel="Computer address" />
      <View style={[f.actions, { marginTop: 8 }]}>
        <PButton small label={busy ? 'TESTING…' : 'TEST'} disabled={busy || !address.trim()} onPress={test} />
        {models.length > 0 && (
          <PButton
            small
            hot
            label="USE IT"
            onPress={async () => {
              await applyLocalAI({ kind, address, model })
              setMsg(`Bitter now uses ${model} on your computer.`)
              onDone?.()
            }}
          />
        )}
      </View>
      {models.length > 1 && (
        <View style={[f.actions, { marginTop: 8 }]}>
          {models.slice(0, 12).map((m) => (
            <PButton key={m} small hot={model === m} label={m.slice(0, 24)} onPress={() => setModel(m)} />
          ))}
        </View>
      )}
      {!!msg && <Text style={[f.note, { marginTop: 6, color: /Couldn|answered/.test(msg) ? C.pink : C.teal }]}>{msg}</Text>}
      <Note style={{ marginTop: 6 }}>Find the address on the computer: Windows → Settings → Network → your Wi-Fi → IPv4 address; Mac → System Settings → Wi-Fi → Details → IP address.</Note>
    </PCard>
  )
}
