// Hide my email: connect SimpleLogin or addy.io, make aliases, copy or fill them.

import { useEffect, useState } from 'react'
import { View, Text, Pressable, Linking, Alert, Share } from 'react-native'
import { ALIAS_PROVIDERS, aliasSettings, isConnected, connectAliases, disconnectAliases, listAliases, createAlias } from './aliases'
import { useStore } from './store'
import { PButton, PText, Field, PCard } from './ui'
import ScreenFrame, { Note, Label, f } from './ScreenFrame'
import { C } from './theme'

/**
 * Props: visible, onClose, onFill(email) — fill the alias into the page's
 * email field (App injects fillAliasJS), pageHost — used as the new alias's note.
 * Pass modal={false} to embed it in a Settings page.
 */
export default function AliasesScreen({ visible = true, onClose, onFill, pageHost = '', modal = true }) {
  useStore((s) => s.aliases)
  const { provider } = aliasSettings()
  const [connected, setConnected] = useState(false)
  const [pick, setPick] = useState('simplelogin')
  const [key, setKey] = useState('')
  const [base, setBase] = useState('')
  const [list, setList] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    const c = await isConnected()
    setConnected(c)
    if (c) setList(await listAliases().catch((e) => (setError(e.message), [])))
  }
  useEffect(() => {
    if (visible) refresh()
  }, [visible, provider])

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const make = () =>
    run(async () => {
      const email = await createAlias(pageHost ? `Made in Bit Browser for ${pageHost}` : 'Made in Bit Browser')
      setList((l) => [{ id: email, email, note: pageHost, active: true }, ...l])
      if (onFill) onFill(email)
      else Share.share({ message: email })
    })

  return (
    <ScreenFrame visible={visible} onClose={onClose} title="HIDE MY EMAIL" icon="lock" modal={modal}>
      <Note>Sign up for sites with a throwaway address that forwards to your real inbox. If a site starts spamming you or leaks your address, turn that one alias off. Bit Browser uses your own SimpleLogin or addy.io account (both have free plans).</Note>
      {!connected ? (
        <PCard>
          <Label>CONNECT AN ACCOUNT</Label>
          <View style={f.actions}>
            {Object.entries(ALIAS_PROVIDERS).map(([id, p]) => (
              <PButton key={id} small hot={pick === id} label={p.label.toUpperCase()} onPress={() => setPick(id)} />
            ))}
          </View>
          <Note>Get your key: {ALIAS_PROVIDERS[pick].keyHelp}.</Note>
          <Field value={key} onChangeText={setKey} placeholder="API key" secureTextEntry accessibilityLabel="API key" />
          <Field value={base} onChangeText={setBase} placeholder={`Server (optional, default ${ALIAS_PROVIDERS[pick].baseUrl})`} accessibilityLabel="Server address" />
          <View style={f.actions}>
            <PButton hot label={busy ? 'CHECKING…' : 'CONNECT'} disabled={busy || !key.trim()} onPress={() => run(async () => (await connectAliases(pick, key, base), setKey(''), await refresh()))} />
            <PButton small label="MAKE AN ACCOUNT" onPress={() => Linking.openURL(ALIAS_PROVIDERS[pick].signup)} />
          </View>
        </PCard>
      ) : (
        <>
          <PCard>
            <Text style={f.rowTitle}>Connected to {ALIAS_PROVIDERS[provider]?.label}</Text>
            <View style={[f.actions, { marginTop: 8 }]}>
              <PButton hot icon="plus" label={busy ? 'MAKING…' : onFill ? 'NEW ALIAS + FILL' : 'NEW ALIAS'} disabled={busy} onPress={make} />
              <PButton small label="DISCONNECT" onPress={() => Alert.alert('Disconnect?', 'Your aliases keep working; Bit Browser just stops making new ones.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => disconnectAliases().then(refresh) }])} />
            </View>
          </PCard>
          <Label>YOUR ALIASES</Label>
          {!list.length && <Note>No aliases yet.</Note>}
          {list.slice(0, 50).map((a) => (
            <Pressable key={a.id} onPress={() => (onFill ? onFill(a.email) : Share.share({ message: a.email }))} style={f.row} accessibilityRole="button" accessibilityLabel={onFill ? `Fill ${a.email}` : `Share ${a.email}`}>
              <View style={{ flex: 1 }}>
                <Text style={f.rowTitle} numberOfLines={1}>{a.email}</Text>
                {!!a.note && <Text style={f.rowSub} numberOfLines={1}>{a.note}</Text>}
              </View>
              <PText style={{ fontSize: 7, color: a.active ? C.teal : C.muted }}>{onFill ? 'FILL' : a.active ? 'ON' : 'OFF'}</PText>
            </Pressable>
          ))}
        </>
      )}
      {!!error && <Text style={[f.note, { color: C.pink }]}>{error}</Text>}
    </ScreenFrame>
  )
}
