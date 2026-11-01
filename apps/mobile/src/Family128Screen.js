// 128bit family account: sign in with an emailed code, see family XP and
// quests. Until a 128bit server exists this shows "coming soon".

import { useState } from 'react'
import { View, Text } from 'react-native'
import { useStore } from './store'
import { familyReady, setFamilyServer, startSignIn, finishSignIn, signOut, syncFamily } from './family128'
import { PButton, Field, PCard, PProgress } from './ui'
import ScreenFrame, { Note, Label, f } from './ScreenFrame'
import { C } from './theme'

/** Props: visible, onClose (or modal={false} to embed in Settings). */
export default function Family128Screen({ visible = true, onClose, modal = true }) {
  const fam = useStore((s) => s.family) || {}
  const [server, setServer] = useState(fam.server || '')
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const ready = familyReady()

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

  return (
    <ScreenFrame visible={visible} onClose={onClose} title="128BIT ACCOUNT" icon="xp" modal={modal}>
      {!ready && (
        <PCard>
          <Label color={C.orange}>COMING SOON</Label>
          <Note>One 128bit account will connect Bit Browser, 128bitlife, BitCaller and 128bittracker, so your XP, streaks and quests follow you across the family apps. The 128bit server isn't live yet. Your XP and quests keep working on this device in the meantime, and nothing is sent anywhere.</Note>
          <Note style={{ marginTop: 8 }}>Testing your own 128bit server? Enter its address:</Note>
          <Field style={{ marginTop: 6 }} value={server} onChangeText={setServer} placeholder="https://api.128bit.example" keyboardType="url" accessibilityLabel="128bit server address" />
          <PButton style={{ marginTop: 8 }} small label="SAVE SERVER" disabled={!/^https?:\/\//i.test(server.trim())} onPress={() => setFamilyServer(server)} />
        </PCard>
      )}
      {ready && !fam.connected && (
        <PCard>
          <Label>SIGN IN</Label>
          {!challenge ? (
            <>
              <Note>We'll email you a 6-digit code. No password needed.</Note>
              <Field style={{ marginTop: 6 }} value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" accessibilityLabel="Email" />
              <PButton style={{ marginTop: 8 }} hot label={busy ? 'SENDING…' : 'EMAIL ME A CODE'} disabled={busy} onPress={() => run(async () => setChallenge(await startSignIn(email)))} />
            </>
          ) : (
            <>
              <Note>Enter the code sent to {email}.</Note>
              <Field style={{ marginTop: 6 }} value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad" maxLength={8} accessibilityLabel="Sign-in code" />
              <View style={[f.actions, { marginTop: 8 }]}>
                <PButton hot label={busy ? 'CHECKING…' : 'SIGN IN'} disabled={busy || code.trim().length < 4} onPress={() => run(async () => (await finishSignIn(challenge, code), setChallenge(null), setCode('')))} />
                <PButton small label="BACK" onPress={() => setChallenge(null)} />
              </View>
            </>
          )}
          <PButton style={{ marginTop: 8 }} small label="CHANGE SERVER" onPress={() => setFamilyServer('')} />
        </PCard>
      )}
      {ready && fam.connected && (
        <>
          <PCard>
            <Text style={f.rowTitle}>{fam.account?.name || fam.account?.email || 'Signed in'}</Text>
            {fam.level != null && <Text style={[f.rowSub, { marginTop: 4 }]}>Level {fam.level} · {fam.xp || 0} XP · {fam.streak || 0}-day streak</Text>}
            <View style={[f.actions, { marginTop: 8 }]}>
              <PButton small icon="reload" label={busy ? 'SYNCING…' : 'SYNC NOW'} disabled={busy} onPress={() => run(syncFamily)} />
              <PButton small label="SIGN OUT" onPress={() => run(signOut)} />
            </View>
          </PCard>
          {(fam.quests || []).length > 0 && <Label>FAMILY QUESTS</Label>}
          {(fam.quests || []).map((q) => (
            <View key={q.id} style={[f.row, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
              <Text style={f.rowTitle}>{q.title}</Text>
              <PProgress value={q.goal ? Math.min(1, (q.progress || 0) / q.goal) : 0} color={q.done ? C.orange : C.teal} />
              <Text style={f.rowSub}>{q.done ? 'Done!' : `${q.progress || 0} / ${q.goal}`} · +{q.xp || 0} XP</Text>
            </View>
          ))}
          <Note>Choose which browsing events are shared in Settings → 128bit family. Only those are sent; never the pages you visit.</Note>
        </>
      )}
      {!!msg && <Text style={[f.note, { color: C.pink }]}>{msg}</Text>}
    </ScreenFrame>
  )
}
