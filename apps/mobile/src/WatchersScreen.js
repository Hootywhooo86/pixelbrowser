// Watched pages and price tracking: add the current page, see the last
// check, check now, open or stop watching.

import { useState } from 'react'
import { View, Text, Pressable, Alert } from 'react-native'
import { useWatchers, addWatcher, removeWatcher, updateWatcher, checkWatcher, checkDue, EVERY } from './watchers'
import { PButton, PText, Field, PCard } from './ui'
import ScreenFrame, { Note, Label, f } from './ScreenFrame'
import { C } from './theme'

const ago = (t) => {
  if (!t) return 'not checked yet'
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

const price = (n, cur) => {
  if (n == null) return '—'
  try {
    return cur ? new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n) : `$${Number(n).toFixed(2)}`
  } catch {
    return `${n} ${cur || ''}`
  }
}

/** Props: visible, onClose, currentUrl, currentTitle, onOpen(url). */
export default function WatchersScreen({ visible, onClose, currentUrl = '', currentTitle = '', onOpen }) {
  const list = useWatchers()
  const [type, setType] = useState('change')
  const [every, setEvery] = useState(24)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState('')
  const canAdd = /^https?:/i.test(currentUrl)

  const add = async () => {
    setBusy('add')
    try {
      await addWatcher({ url: currentUrl, title: currentTitle, type, every, target: type === 'price' && parseFloat(target) > 0 ? parseFloat(target) : null })
      setTarget('')
    } catch (e) {
      Alert.alert('Watch this page', e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <ScreenFrame visible={visible} onClose={onClose} title="WATCHED PAGES" icon="star">
      <Note>Bit Browser checks these pages for you and sends a notification when they change or a price drops. Checks happen on this phone (no server), when you open the app and every few hours in the background.</Note>
      {canAdd && (
        <PCard>
          <Text style={f.rowTitle} numberOfLines={1}>{currentTitle || currentUrl}</Text>
          <View style={[f.actions, { marginTop: 8 }]}>
            <PButton small hot={type === 'change'} label="ANY CHANGE" onPress={() => setType('change')} />
            <PButton small hot={type === 'price'} label="PRICE DROP" onPress={() => setType('price')} />
          </View>
          <View style={[f.actions, { marginTop: 8 }]}>
            {EVERY.map((e) => (
              <PButton key={e.hours} small hot={every === e.hours} label={e.label.toUpperCase()} onPress={() => setEvery(e.hours)} />
            ))}
          </View>
          {type === 'price' && <Field style={{ marginTop: 8 }} value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="Tell me when it's at or below (optional)" accessibilityLabel="Target price" />}
          <PButton style={{ marginTop: 10 }} hot icon="plus" label={busy === 'add' ? 'ADDING…' : 'WATCH THIS PAGE'} disabled={!!busy} onPress={add} />
        </PCard>
      )}
      <View style={f.actions}>
        <Label>WATCHING ({list.length})</Label>
        {list.length > 0 && <PButton small icon="reload" label={busy === 'all' ? 'CHECKING…' : 'CHECK ALL'} disabled={!!busy} onPress={() => (setBusy('all'), checkDue({ force: true }).finally(() => setBusy('')))} />}
      </View>
      {!list.length && <Note>Nothing yet. Open a page (like a product or a news page) and use Menu → Watch this page.</Note>}
      {list.map((w) => (
        <Pressable key={w.id} onPress={() => onOpen?.(w.url)} style={[f.row, { alignItems: 'flex-start' }]} accessibilityRole="button" accessibilityLabel={`Open ${w.title}`}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={f.rowTitle} numberOfLines={1}>{w.title}</Text>
            {w.type === 'price' ? (
              <Text style={[f.rowSub, { color: C.orange }]}>
                {price(w.lastPrice, w.currency)}
                {w.previousPrice != null && w.previousPrice !== w.lastPrice ? `  (was ${price(w.previousPrice, w.currency)})` : ''}
                {w.target != null ? `  · alert at ${price(w.target, w.currency)}` : ''}
              </Text>
            ) : (
              !!w.lastSummary && <Text style={f.rowSub} numberOfLines={2}>{w.lastSummary}</Text>
            )}
            <Text style={[f.rowSub, w.error && { color: C.pink }]} numberOfLines={2}>
              {w.error ? w.error : `${EVERY.find((e) => e.hours === w.every)?.label || 'Every day'} · checked ${ago(w.lastCheck)}`}
            </Text>
          </View>
          <View style={{ gap: 6 }}>
            <PButton small label={busy === w.id ? '…' : 'CHECK'} disabled={!!busy} onPress={() => (setBusy(w.id), checkWatcher(w.id).then((r) => r.message && Alert.alert(w.title, r.message)).finally(() => setBusy('')))} />
            <PButton small label="STOP" onPress={() => Alert.alert('Stop watching?', w.title, [{ text: 'Cancel', style: 'cancel' }, { text: 'Stop', style: 'destructive', onPress: () => removeWatcher(w.id) }])} />
          </View>
        </Pressable>
      ))}
      {list.some((w) => w.type === 'change') && (
        <Pressable onPress={() => list.filter((w) => w.type === 'change').forEach((w) => updateWatcher(w.id, { summarize: w.summarize === false }))} accessibilityRole="button">
          <PText style={{ fontSize: 7, color: C.muted, marginTop: 8 }}>With AI on, Bitter writes a one-line summary of each change. Tap to turn that {list.find((w) => w.type === 'change')?.summarize === false ? 'on' : 'off'}.</PText>
        </Pressable>
      )}
    </ScreenFrame>
  )
}
