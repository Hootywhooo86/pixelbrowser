// Crash reports (opt-in, Settings → Support). When on, app errors are written
// to a small log on this phone. Nothing is sent anywhere: there's no crash
// server. You can share the log yourself (email, messages…) when asking for help.

import { View, Text, Share, StyleSheet, ScrollView } from 'react-native'
import Constants from 'expo-constants'
import { getState, update, useStore } from './store'
import { PButton } from './ui'
import { C, px } from './theme'

const LIMIT = 20
let installed = false

/** Call once at startup. Chains to React Native's own handler. */
export function installCrashHandler() {
  if (installed || typeof ErrorUtils === 'undefined') return
  installed = true
  const previous = ErrorUtils.getGlobalHandler?.()
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    try {
      recordError(error, isFatal)
    } catch {}
    previous?.(error, isFatal)
  })
}

/** Add an error to the log (only when crash reports are on). */
export function recordError(error, isFatal = false) {
  const s = getState()
  if (!s?.crashReports) return
  const entry = {
    at: Date.now(),
    fatal: !!isFatal,
    message: String(error?.message || error || 'Unknown error').slice(0, 500),
    stack: String(error?.stack || '').slice(0, 3000),
    version: Constants.expoConfig?.version || '?',
  }
  update((st) => (st.crashLog = [...(st.crashLog || []), entry].slice(-LIMIT)))
}

export function clearCrashLog() {
  update((s) => (s.crashLog = []))
}

function reportText(log) {
  const lines = [`Bit Browser crash report (${log.length} error${log.length === 1 ? '' : 's'})`, `Phone: ${require('react-native').Platform.OS} ${require('react-native').Platform.Version}`, '']
  for (const e of log) lines.push(`[${new Date(e.at).toISOString()}] v${e.version}${e.fatal ? ' FATAL' : ''}: ${e.message}`, e.stack, '')
  return lines.join('\n')
}

/** Open the share sheet with the log as text. */
export async function shareCrashReport() {
  const log = getState()?.crashLog || []
  if (!log.length) return false
  await Share.share({ message: reportText(log), title: 'Bit Browser crash report' })
  return true
}

/** Settings view: the switch lives in Settings; this shows the log. */
export function CrashLogView() {
  const log = useStore((s) => s.crashLog || [])
  const on = useStore((s) => !!s.crashReports)
  return (
    <View style={st.wrap}>
      <Text style={st.note}>
        {on
          ? 'Errors are saved on this phone only. Nothing is sent anywhere. Share the report yourself if you want help.'
          : 'Crash reports are off. Turn them on to keep a log of errors on this phone (nothing is sent anywhere).'}
      </Text>
      {!log.length ? (
        <Text style={st.empty}>NO ERRORS LOGGED</Text>
      ) : (
        <ScrollView style={st.list} nestedScrollEnabled>
          {[...log].reverse().map((e, i) => (
            <View key={`${e.at}-${i}`} style={st.item}>
              <Text style={st.when}>{new Date(e.at).toLocaleString()} · v{e.version}{e.fatal ? ' · CRASH' : ''}</Text>
              <Text style={st.msg} numberOfLines={3}>{e.message}</Text>
            </View>
          ))}
        </ScrollView>
      )}
      <View style={st.row}>
        <PButton small icon="share" label="SHARE REPORT" disabled={!log.length} onPress={() => shareCrashReport().catch(() => {})} />
        <PButton small icon="close" label="CLEAR" disabled={!log.length} onPress={clearCrashLog} />
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { gap: 10 },
  note: { color: C.muted, fontSize: 13, lineHeight: 19 },
  empty: { ...px(8), color: C.muted, paddingVertical: 10 },
  list: { maxHeight: 260 },
  item: { borderLeftWidth: 3, borderLeftColor: C.pink, paddingLeft: 8, paddingVertical: 4, marginBottom: 8 },
  when: { color: C.muted, fontSize: 11 },
  msg: { color: C.ink, fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
})
