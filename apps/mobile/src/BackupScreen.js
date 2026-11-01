// Back up everything to one encrypted file, or restore from one.

import { useState } from 'react'
import { Modal, View, Text, ScrollView, StyleSheet, Alert, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { passwordStrength } from '@pixelbrowser/tools-core'
import { createBackupFile, shareBackupFile, saveBackupToFolder, discardBackupFile, pickBackupFile, openBackup, restoreBackup, backupSummary, noteBackupMade } from './backup'
import { unlock } from './passwords'
import { useStore } from './store'
import { PButton, PText, PCard, PHeader, PProgress, Field } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

const LINES = [
  ['tabs', 'tabs'], ['bookmarks', 'bookmarks'], ['logins', 'passwords'], ['totp', '2FA codes'], ['notes', 'notes'],
  ['readlater', 'reading list'], ['packages', 'packages'], ['addresses', 'addresses'], ['cards', 'cards'], ['history', 'history pages'],
]
const describe = (sum) => LINES.filter(([k]) => sum[k]).map(([k, label]) => `${sum[k].toLocaleString()} ${label}`).join(' · ') || 'Settings only'

export default function BackupScreen({ visible, onClose }) {
  const insets = useSafeAreaInsets()
  const lastBackupAt = useStore((s) => s.lastBackupAt)
  const [mode, setMode] = useState(null) // 'backup' | 'restore'
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState('')
  const [file, setFile] = useState(null) // made backup
  const [text, setText] = useState(null) // picked backup file
  const [opened, setOpened] = useState(null) // decrypted backup
  const [restored, setRestored] = useState(null)

  const reset = () => {
    setMode(null)
    setPass('')
    setPass2('')
    setBusy('')
    if (file) discardBackupFile(file)
    setFile(null)
    setText(null)
    setOpened(null)
    setRestored(null)
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const strength = passwordStrength(pass)
  const canMake = pass.length >= 8 && pass === pass2 && strength.score >= 2

  const make = async () => {
    if (!(await unlock('Back up your passwords'))) return
    setBusy('Encrypting…')
    try {
      const f = await createBackupFile(pass)
      setFile(f)
      setPass('')
      setPass2('')
    } catch (e) {
      Alert.alert("Couldn't make the backup", String(e?.message || e))
    } finally {
      setBusy('')
    }
  }

  const save = async (how) => {
    try {
      const ok = how === 'folder' ? await saveBackupToFolder(file) : await shareBackupFile(file)
      if (ok !== false) noteBackupMade()
    } catch (e) {
      Alert.alert("Couldn't save the backup", String(e?.message || e))
    }
  }

  const pick = async () => {
    try {
      const t = await pickBackupFile()
      if (t) setText(t)
    } catch (e) {
      Alert.alert("Couldn't open that file", String(e?.message || e))
    }
  }

  const unlockFile = async () => {
    setBusy('Unlocking…')
    try {
      setOpened(await openBackup(text, pass))
      setPass('')
    } catch (e) {
      Alert.alert("Couldn't open the backup", String(e?.message || e))
    } finally {
      setBusy('')
    }
  }

  const restore = async () => {
    setBusy('Restoring…')
    try {
      setRestored(await restoreBackup(opened))
      setOpened(null)
      setText(null)
    } catch (e) {
      Alert.alert('Restore stopped', String(e?.message || e))
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="lock" size={16} color={C.teal} />
          <PText style={st.title}>BACKUP</PText>
          <PButton small label="DONE" onPress={close} disabled={!!busy} />
        </View>
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <Text style={st.lead}>
            One file with your tabs, bookmarks, passwords, 2FA codes, notes, reading list, packages and settings, locked with a passphrase only you know. Keep it on Google Drive or your computer, and restore it on a new phone.
          </Text>
          <Text style={st.muted}>{lastBackupAt ? `Last backup: ${new Date(lastBackupAt).toLocaleString()}` : 'No backup saved yet.'}</Text>

          {!mode && (
            <View style={st.row}>
              <PButton hot icon="lock" label="BACK UP NOW" onPress={() => setMode('backup')} />
              <PButton icon="download" label="RESTORE" onPress={() => setMode('restore')} />
            </View>
          )}

          {mode === 'backup' && !file && (
            <PCard style={st.card}>
              <PHeader>CHOOSE A PASSPHRASE</PHeader>
              <Text style={st.muted}>You'll need it to restore. Nobody, including us, can open the backup without it, so write it down somewhere safe.</Text>
              <Field value={pass} onChangeText={setPass} placeholder="Passphrase (a few random words works well)" secureTextEntry autoCapitalize="none" accessibilityLabel="Passphrase" />
              <PProgress value={(strength.score + 1) / 5} segments={10} color={strength.score >= 3 ? C.teal : strength.score >= 2 ? C.orange : C.pink} />
              <Text style={st.muted}>{pass ? `${strength.label}. ${strength.tips[0] || ''}` : 'At least 8 characters.'}</Text>
              <Field value={pass2} onChangeText={setPass2} placeholder="Type it again" secureTextEntry autoCapitalize="none" accessibilityLabel="Repeat passphrase" />
              {!!pass2 && pass !== pass2 && <Text style={st.warn}>The two don't match.</Text>}
              <View style={st.row}>
                <PButton hot label={busy || 'MAKE BACKUP'} onPress={make} disabled={!canMake || !!busy} />
                <PButton label="CANCEL" onPress={reset} disabled={!!busy} />
              </View>
            </PCard>
          )}

          {file && (
            <PCard style={st.card} color={C.teal}>
              <PHeader color={C.teal}>BACKUP READY</PHeader>
              <Text style={st.text}>{describe(file.summary)}</Text>
              <Text style={st.muted} numberOfLines={1}>{file.name}</Text>
              <View style={st.row}>
                <PButton hot icon="share" label="SAVE TO DRIVE…" onPress={() => save('share')} />
                {Platform.OS === 'android' && <PButton icon="download" label="SAVE TO FOLDER" onPress={() => save('folder')} />}
              </View>
              <PButton small label="FINISHED" onPress={reset} style={{ alignSelf: 'flex-start' }} />
            </PCard>
          )}

          {mode === 'restore' && !text && !restored && (
            <PCard style={st.card}>
              <PHeader>RESTORE</PHeader>
              <Text style={st.muted}>Pick a .bitbackup file. What's in it is added to this phone. Nothing here is deleted or replaced.</Text>
              <View style={st.row}>
                <PButton hot icon="download" label="PICK BACKUP FILE" onPress={pick} />
                <PButton label="CANCEL" onPress={reset} />
              </View>
            </PCard>
          )}

          {text && !opened && (
            <PCard style={st.card}>
              <PHeader>ENTER THE PASSPHRASE</PHeader>
              <Field value={pass} onChangeText={setPass} placeholder="Backup passphrase" secureTextEntry autoCapitalize="none" accessibilityLabel="Backup passphrase" onSubmitEditing={unlockFile} />
              <View style={st.row}>
                <PButton hot label={busy || 'UNLOCK'} onPress={unlockFile} disabled={pass.length < 8 || !!busy} />
                <PButton label="CANCEL" onPress={reset} disabled={!!busy} />
              </View>
            </PCard>
          )}

          {opened && (
            <PCard style={st.card}>
              <PHeader color={C.orange}>IN THIS BACKUP</PHeader>
              <Text style={st.text}>{describe(backupSummary(opened))}</Text>
              <Text style={st.muted}>Made {opened.createdAt ? new Date(opened.createdAt).toLocaleString() : ''}{opened.version ? ` with Bit Browser ${opened.version}` : ''}.</Text>
              <View style={st.row}>
                <PButton hot label={busy || 'RESTORE'} onPress={restore} disabled={!!busy} />
                <PButton label="CANCEL" onPress={reset} disabled={!!busy} />
              </View>
            </PCard>
          )}

          {restored && (
            <PCard style={st.card} color={C.teal}>
              <PHeader color={C.teal}>RESTORED</PHeader>
              <Text style={st.text}>
                Added{' '}
                {[
                  restored.tabs && `${restored.tabs} tabs`,
                  restored.bookmarks && `${restored.bookmarks} bookmarks`,
                  restored.logins && `${restored.logins} passwords`,
                  restored.totp && `${restored.totp} 2FA codes`,
                  restored.notes && `${restored.notes} notes`,
                  restored.readlater && `${restored.readlater} reading list items`,
                  restored.packages && `${restored.packages} packages`,
                  restored.addresses && `${restored.addresses} addresses`,
                  restored.cards && `${restored.cards} cards`,
                ]
                  .filter(Boolean)
                  .join(', ') || 'nothing new (you already had it all)'}
                .
              </Text>
              {!!restored.tabs && <Text style={st.muted}>Restored tabs open the next time you start Bit Browser.</Text>}
              <PButton small label="FINISHED" onPress={reset} style={{ alignSelf: 'flex-start' }} />
            </PCard>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  body: { padding: 16, paddingBottom: 40, gap: 12 },
  lead: { color: C.ink, fontSize: 15, lineHeight: 22 },
  card: { gap: 8 },
  text: { color: C.ink, fontSize: 15, lineHeight: 21 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  warn: { color: C.pink, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
})
