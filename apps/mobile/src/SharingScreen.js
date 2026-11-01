// Family sharing: start a share (bookmarks folder, chosen passwords, a
// Space's tabs), invite family with its code, join a share, see what's shared.

import { useState } from 'react'
import { View, Text, Pressable, Alert, Share, StyleSheet } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useStore } from './store'
import { loginIndex } from './passwords'
import { SHARE_TYPES, createShare, joinShare, leaveShare, shareInvite, syncOneShare, sharedTabs, setShareItems } from './sharing'
import { PButton, PText, Field, PCard } from './ui'
import ScreenFrame, { Note, Label, f } from './ScreenFrame'
import { C } from './theme'

const inviteText = (label, qr) =>
  `Join my Bit Browser share "${label}": open Bit Browser → Settings → Family sharing → Join, and paste this:\n\n${qr}\n\nKeep it private: anyone with it can see what's in the share.`

/** Props: visible, onClose, onOpen(url). */
export default function SharingScreen({ visible, onClose, onOpen }) {
  const shares = useStore((s) => s.shares) || []
  useStore((s) => s.shareRecords)
  const spaces = useStore((s) => s.spaces) || []
  const syncOn = useStore((s) => !!(s.sync?.enabled && s.sync?.server))
  const [mode, setMode] = useState(null) // 'new' | 'join' | 'scan'
  const [kind, setKind] = useState('bookmarks')
  const [label, setLabel] = useState('')
  const [space, setSpace] = useState(spaces[0]?.id || 'personal')
  const [picked, setPicked] = useState([])
  const [joinText, setJoinText] = useState('')
  const [joinKind, setJoinKind] = useState('bookmarks')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [perm, requestPerm] = useCameraPermissions()
  const logins = kind === 'passwords' ? loginIndex() : []

  const run = async (fn) => {
    setBusy(true)
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      const name = label.trim() || (kind === 'space' ? spaces.find((s) => s.id === space)?.name : '') || SHARE_TYPES[kind].label
      const r = await createShare(kind, { label: name, folder: name, space, items: picked })
      setMode(null)
      setLabel('')
      setPicked([])
      await Share.share({ message: inviteText(name, r.qr) })
    })

  const join = (text) =>
    run(async () => {
      await joinShare(text, { kind: joinKind })
      setMode(null)
      setJoinText('')
      setMsg('Joined. Shared items are syncing now.')
    })

  if (mode === 'scan') {
    return (
      <ScreenFrame visible={visible} onClose={() => setMode('join')} title="SCAN SHARE CODE" icon="share">
        {!perm?.granted ? (
          <PButton hot label="ALLOW CAMERA" onPress={requestPerm} />
        ) : (
          <View style={{ height: 360, borderWidth: 3, borderColor: C.edge }}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={busy ? undefined : ({ data }) => join(data)} />
          </View>
        )}
        <PButton label="BACK" onPress={() => setMode('join')} />
      </ScreenFrame>
    )
  }

  return (
    <ScreenFrame visible={visible} onClose={onClose} title="FAMILY SHARING" icon="share">
      <Note>Share bookmarks, passwords or a Space's tabs with family. Each share is end-to-end encrypted with its own code, separate from your own sync, so family members only see what's in the share.</Note>
      {!syncOn && <Note style={{ color: C.orange }}>Set up Sync first (Settings → Sync). Shares travel through the same sync server, still encrypted.</Note>}
      <View style={f.actions}>
        <PButton hot={mode === 'new'} icon="plus" label="NEW SHARE" disabled={!syncOn} onPress={() => setMode(mode === 'new' ? null : 'new')} />
        <PButton hot={mode === 'join'} label="JOIN A SHARE" onPress={() => setMode(mode === 'join' ? null : 'join')} />
      </View>

      {mode === 'new' && (
        <PCard>
          <Label>WHAT TO SHARE</Label>
          <View style={[f.actions, { marginTop: 6 }]}>
            {Object.entries(SHARE_TYPES).map(([id, t]) => (
              <PButton key={id} small hot={kind === id} label={t.label.toUpperCase()} onPress={() => setKind(id)} />
            ))}
          </View>
          <Note style={{ marginTop: 6 }}>{SHARE_TYPES[kind].note}</Note>
          {kind === 'bookmarks' && <Field style={{ marginTop: 6 }} value={label} onChangeText={setLabel} placeholder="Folder name, e.g. Family" accessibilityLabel="Folder name" />}
          {kind === 'space' && (
            <View style={[f.actions, { marginTop: 6 }]}>
              {spaces.map((s) => (
                <PButton key={s.id} small hot={space === s.id} label={s.name.toUpperCase()} onPress={() => setSpace(s.id)} />
              ))}
            </View>
          )}
          {kind === 'passwords' && (
            <View style={{ marginTop: 6, gap: 6 }}>
              {!logins.length && <Note>No saved passwords yet.</Note>}
              {logins.slice(0, 60).map((l) => {
                const on = picked.includes(l.id)
                return (
                  <Pressable key={l.id} onPress={() => setPicked((p) => (on ? p.filter((x) => x !== l.id) : [...p, l.id]))} style={[f.row, on && { borderColor: C.teal }]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <PText style={{ fontSize: 8, color: on ? C.teal : C.muted }}>{on ? '[X]' : '[ ]'}</PText>
                    <Text style={[f.rowTitle, { flex: 1 }]} numberOfLines={1}>{l.origin.replace(/^https?:\/\//, '')} · {l.username || 'no username'}</Text>
                  </Pressable>
                )
              })}
              <Field value={label} onChangeText={setLabel} placeholder="Share name, e.g. Family streaming" accessibilityLabel="Share name" />
            </View>
          )}
          <PButton style={{ marginTop: 10 }} hot label={busy ? 'STARTING…' : 'START + SEND INVITE'} disabled={busy || (kind === 'passwords' && !picked.length)} onPress={start} />
        </PCard>
      )}

      {mode === 'join' && (
        <PCard>
          <Label>JOIN</Label>
          <Note>Paste the invite a family member sent you, or scan its QR code.</Note>
          <Field style={{ marginTop: 6 }} value={joinText} onChangeText={setJoinText} placeholder="bitshare:… or the 24 words" multiline accessibilityLabel="Share code" />
          {!/bitshare:/.test(joinText) && joinText.trim().split(/\s+/).length >= 12 && (
            <View style={[f.actions, { marginTop: 6 }]}>
              {Object.entries(SHARE_TYPES).map(([id, t]) => (
                <PButton key={id} small hot={joinKind === id} label={t.label.toUpperCase()} onPress={() => setJoinKind(id)} />
              ))}
            </View>
          )}
          <View style={[f.actions, { marginTop: 8 }]}>
            <PButton hot label={busy ? 'JOINING…' : 'JOIN'} disabled={busy || !joinText.trim()} onPress={() => join(joinText.replace(/^[\s\S]*?(bitshare:\S+)[\s\S]*$/, '$1'))} />
            <PButton small label="SCAN QR" onPress={() => setMode('scan')} />
          </View>
        </PCard>
      )}

      <Label>YOUR SHARES ({shares.length})</Label>
      {!shares.length && <Note>No shares yet.</Note>}
      {shares.map((s) => (
        <PCard key={s.id}>
          <Text style={f.rowTitle} numberOfLines={1}>{s.label}</Text>
          <Text style={[f.rowSub, s.error && { color: C.pink }]} numberOfLines={2}>
            {s.error || `${SHARE_TYPES[s.kind]?.label}${s.kind === 'bookmarks' ? ` · folder "${s.folder}"` : ''} · ${s.lastSync ? `synced ${new Date(s.lastSync).toLocaleTimeString()}` : 'not synced yet'}`}
          </Text>
          {s.kind === 'space' &&
            sharedTabs(s.id).slice(0, 20).map((t) => (
              <Pressable key={t.url} onPress={() => onOpen?.(t.url)} style={[f.row, { marginTop: 6 }]} accessibilityRole="button">
                <Text style={[f.rowTitle, { flex: 1 }]} numberOfLines={1}>{t.title}</Text>
              </Pressable>
            ))}
          <View style={[f.actions, { marginTop: 8 }]}>
            <PButton small icon="reload" label="SYNC" disabled={busy} onPress={() => run(() => syncOneShare(s.id))} />
            <PButton small icon="share" label="INVITE" onPress={() => run(async () => Share.share({ message: inviteText(s.label, (await shareInvite(s.id)).qr) }))} />
            {s.kind === 'space' && !s.space && spaces.length > 0 && <PButton small label="SHARE MY TABS TOO" onPress={() => setShareItems(s.id, { space: spaces[0].id })} />}
            <PButton small label="LEAVE" onPress={() => Alert.alert('Leave this share?', 'It stops syncing on this phone. Others keep what was shared.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => leaveShare(s.id) }])} />
          </View>
        </PCard>
      ))}
      {!!msg && <Text style={[f.note, { color: /Joined/.test(msg) ? C.teal : C.pink }]}>{msg}</Text>}
    </ScreenFrame>
  )
}
