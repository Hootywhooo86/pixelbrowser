// Password check: weak, reused and breached passwords, with a way to fix each.

import { useState } from 'react'
import { Modal, View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { runSecurityCheck, useSecurityReport, setBreachCheck } from './breach'
import { unlock } from './passwords'
import { useStore } from './store'
import { PButton, PText, PCard, PHeader, PProgress, PSwitch } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

const hostOf = (o) => String(o || '').replace(/^https?:\/\//, '')

export default function SecurityCheckScreen({ visible, onClose, onOpen }) {
  const insets = useSafeAreaInsets()
  const report = useSecurityReport()
  const breachOn = useStore((s) => s.breachCheck === true)
  const count = useStore((s) => (s.passwordIndex || []).length)
  const [busy, setBusy] = useState(null)

  const check = async () => {
    if (!(await unlock('Check your passwords'))) return
    setBusy({ done: 0, total: count })
    try {
      const r = await runSecurityCheck({ breaches: breachOn, onProgress: (done, total) => setBusy({ done, total }) })
      if (r.error) Alert.alert('Breach check', r.error)
    } finally {
      setBusy(null)
    }
  }

  const fix = (origin) => {
    onClose()
    onOpen?.(origin)
  }

  const issues = report ? report.breached.length + report.weak.length + report.reused.reduce((n, g) => n + g.length, 0) : 0

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="shield" size={16} color={C.teal} />
          <PText style={st.title}>PASSWORD CHECK</PText>
          <PButton small label="DONE" onPress={onClose} disabled={!!busy} />
        </View>
        <ScrollView contentContainerStyle={st.body}>
          <PCard style={st.card}>
            <View style={st.rowCenter}>
              <View style={{ flex: 1 }}>
                <Text style={st.text}>Breach alerts</Text>
                <Text style={st.muted}>Check your passwords against known data leaks, now and once a week. Only the first 5 characters of a scrambled (SHA-1) copy of each password are sent to Have I Been Pwned. Your passwords never leave the phone.</Text>
              </View>
              <PSwitch value={breachOn} onChange={setBreachCheck} label="ON" accessibilityLabel={breachOn ? 'Breach alerts on' : 'Breach alerts off'} />
            </View>
          </PCard>

          {busy ? (
            <PCard style={st.card}>
              <PHeader>CHECKING…</PHeader>
              <PProgress value={busy.total ? busy.done / busy.total : 0} />
            </PCard>
          ) : (
            <PButton hot icon="shield" label={report ? 'CHECK AGAIN' : 'CHECK MY PASSWORDS'} onPress={check} disabled={!count} style={{ alignSelf: 'flex-start' }} />
          )}
          {!count && <Text style={st.muted}>No saved passwords yet.</Text>}

          {report && !busy && (
            <>
              <PCard style={st.card} color={issues ? C.orange : C.teal}>
                <PHeader color={issues ? C.orange : C.teal}>{issues ? `${issues} THING${issues === 1 ? '' : 'S'} TO FIX` : 'ALL GOOD'}</PHeader>
                <Text style={st.muted}>
                  Checked {report.total} password{report.total === 1 ? '' : 's'} on {new Date(report.at).toLocaleString()}.
                  {report.checkedBreaches ? '' : ' Breach check was off.'}
                </Text>
              </PCard>

              {!!report.breached.length && <Section title="FOUND IN DATA BREACHES" color={C.pink} note="Change these first, on every site where you used them." items={report.breached.map((b) => ({ ...b, extra: `Seen ${b.count.toLocaleString()} times in leaks` }))} onFix={fix} />}
              {!!report.reused.length && (
                <View style={{ gap: 6 }}>
                  <PHeader color={C.orange}>REUSED PASSWORDS</PHeader>
                  <Text style={st.muted}>If one of these sites leaks, the others are at risk. Give each its own password.</Text>
                  {report.reused.map((g, i) => (
                    <PCard key={i} style={st.card}>
                      <Text style={st.muted}>Same password on {g.length} sites</Text>
                      {g.map((l) => (
                        <Item key={l.id} item={l} onFix={fix} />
                      ))}
                    </PCard>
                  ))}
                </View>
              )}
              {!!report.weak.length && <Section title="WEAK PASSWORDS" color={C.orange} note="Easy to guess. Use 12+ characters or a few random words." items={report.weak.map((w) => ({ ...w, extra: w.label }))} onFix={fix} />}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

function Section({ title, color, note, items, onFix }) {
  return (
    <View style={{ gap: 6 }}>
      <PHeader color={color}>{title}</PHeader>
      <Text style={st.muted}>{note}</Text>
      {items.map((it) => (
        <Item key={it.id} item={it} onFix={onFix} />
      ))}
    </View>
  )
}

function Item({ item, onFix }) {
  return (
    <View style={st.item}>
      <View style={{ flex: 1 }}>
        <Text style={st.text} numberOfLines={1}>{hostOf(item.origin)}</Text>
        <Text style={st.muted} numberOfLines={1}>{[item.username, item.extra].filter(Boolean).join(' · ')}</Text>
      </View>
      <PButton small label="CHANGE" onPress={() => onFix(item.origin)} accessibilityLabel={`Change password on ${hostOf(item.origin)}`} />
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  body: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { gap: 6 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { color: C.ink, fontSize: 15, lineHeight: 20, includeFontPadding: false },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 2, borderColor: C.edge, backgroundColor: C.panel },
})
