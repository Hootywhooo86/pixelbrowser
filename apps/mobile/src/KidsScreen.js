// Kids mode settings: turn on with a PIN, allow-list or block-list, daily
// screen-time limit. Everything after turning it on needs the PIN.

import { useState } from 'react'
import { View, Text, Alert } from 'react-native'
import { useStore } from './store'
import { enableKids, changeKids, disableKids, verifyPin, minutesLeft } from './kids'
import { KID_SAFE } from './web-tools-core'
import { PButton, Field, PCard } from './ui'
import ScreenFrame, { Note, Label, f } from './ScreenFrame'
import { C } from './theme'

const LIMITS = [0, 30, 60, 90, 120, 180]
const list = (text) => String(text).split(/[\s,]+/).map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean)

/** Props: visible, onClose (or modal={false} to embed in Settings). */
export default function KidsScreen({ visible = true, onClose, modal = true }) {
  const k = useStore((s) => s.kids) || {}
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [mode, setMode] = useState(k.mode || 'block')
  const [allow, setAllow] = useState((k.allow || []).join('\n'))
  const [block, setBlock] = useState((k.block || []).join('\n'))
  const [limit, setLimit] = useState(k.limitMinutes || 0)
  const [msg, setMsg] = useState('')

  const settings = () => ({ mode, allow: list(allow), block: list(block), limitMinutes: limit })
  const run = async (fn, ok) => {
    setMsg('')
    try {
      await fn()
      if (ok) setMsg(ok)
    } catch (e) {
      setMsg(e.message)
    }
  }
  const editable = !k.on || unlocked
  const left = minutesLeft()

  return (
    <ScreenFrame visible={visible} onClose={onClose} title="KIDS MODE" icon="lock" modal={modal}>
      <Note>
        {[
          'For a child using this phone:',
          '• Safe search is always on (Google, Bing, DuckDuckGo, Brave, Yahoo, Ecosia, Startpage), and YouTube uses Restricted Mode.',
          '• Only allowed sites open.',
          "• Private tabs and Bitter's agent are off.",
          "• An optional daily time limit locks the browser when it's used up.",
          'Changing anything needs your PIN.',
        ].join('\n')}
      </Note>
      {k.on && (
        <PCard color={C.orange}>
          <Text style={f.rowTitle}>Kids mode is ON</Text>
          <Text style={f.rowSub}>{k.limitMinutes ? `${left === Infinity ? k.limitMinutes : left} of ${k.limitMinutes} minutes left today` : 'No time limit'}</Text>
          {!unlocked && (
            <View style={[f.actions, { marginTop: 8 }]}>
              <Field value={pin} onChangeText={setPin} placeholder="PIN" keyboardType="number-pad" secureTextEntry maxLength={8} style={{ width: 140 }} accessibilityLabel="Kids mode PIN" />
              <PButton small hot label="UNLOCK SETTINGS" disabled={pin.length < 4} onPress={() => run(async () => { if (!(await verifyPin(pin))) throw new Error('Wrong PIN.'); setUnlocked(true) })} />
            </View>
          )}
        </PCard>
      )}
      {editable && (
        <>
          <Label>SITES</Label>
          <View style={f.actions}>
            <PButton small hot={mode === 'block'} label="BLOCK SOME SITES" onPress={() => setMode('block')} />
            <PButton small hot={mode === 'allow'} label="ONLY ALLOWED SITES" onPress={() => setMode('allow')} />
          </View>
          {mode === 'allow' ? (
            <>
              <Note>Only these sites open (one per line), plus always-safe ones: {KID_SAFE.join(', ')}.</Note>
              <Field value={allow} onChangeText={setAllow} multiline placeholder={'khanacademy.org\nscratch.mit.edu'} accessibilityLabel="Allowed sites" />
            </>
          ) : (
            <>
              <Note>Everything opens except these (one per line). Adult and gambling sites are always blocked.</Note>
              <Field value={block} onChangeText={setBlock} multiline placeholder={'tiktok.com\nreddit.com'} accessibilityLabel="Blocked sites" />
            </>
          )}
          <Label>DAILY TIME LIMIT</Label>
          <View style={f.actions}>
            {LIMITS.map((m) => (
              <PButton key={m} small hot={limit === m} label={m ? `${m} MIN` : 'NO LIMIT'} onPress={() => setLimit(m)} />
            ))}
          </View>
          {!k.on ? (
            <PCard>
              <Label>CHOOSE A PIN</Label>
              <Field value={pin} onChangeText={setPin} placeholder="4–8 digits" keyboardType="number-pad" secureTextEntry maxLength={8} accessibilityLabel="New PIN" />
              <PButton style={{ marginTop: 8 }} hot label="TURN ON KIDS MODE" disabled={pin.length < 4} onPress={() => run(() => enableKids(pin, settings()), 'Kids mode is on.')} />
            </PCard>
          ) : (
            <View style={f.actions}>
              <PButton hot label="SAVE" onPress={() => run(() => changeKids(pin, settings()), 'Saved.')} />
              <PButton label="TURN OFF" onPress={() => Alert.alert('Turn off kids mode?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn off', style: 'destructive', onPress: () => run(() => disableKids(pin).then(() => setUnlocked(false)), 'Kids mode is off.') }])} />
            </View>
          )}
        </>
      )}
      {!!msg && <Text style={[f.note, { color: /Wrong|Pick/.test(msg) ? C.pink : C.teal }]}>{msg}</Text>}
    </ScreenFrame>
  )
}
