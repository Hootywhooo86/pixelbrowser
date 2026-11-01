// Bit Authenticator: 2FA codes. Unlock with fingerprint/face, add by scanning
// a site's QR code or typing its secret key, tap a code to copy it.

import { useEffect, useState } from 'react'
import { Modal, View, Text, Pressable, FlatList, StyleSheet, Alert, ToastAndroid, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import { unlock } from './passwords'
import { listTotp, addTotp, updateTotp, deleteTotp, codeFor, secondsLeft, useNow, useTotpIndex } from './totp'
import { PButton, PText, PCard, PHeader, PProgress, Field } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

const toast = (t) => (Platform.OS === 'android' ? ToastAndroid.show(t, ToastAndroid.SHORT) : Alert.alert(t))
const spaced = (code) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code)

export default function AuthenticatorScreen({ visible, onClose }) {
  const insets = useSafeAreaInsets()
  const index = useTotpIndex()
  const [open, setOpen] = useState(false) // unlocked
  const [entries, setEntries] = useState([])
  const [adding, setAdding] = useState(null) // null | 'menu' | 'scan' | 'manual'
  const [editing, setEditing] = useState(null)

  const load = () => listTotp().then(setEntries)
  useEffect(() => {
    if (!visible) {
      setOpen(false)
      setEntries([])
      setAdding(null)
      return
    }
    unlock('Show your 2FA codes').then((ok) => {
      if (!ok) return onClose()
      setOpen(true)
      load()
    })
  }, [visible])
  useEffect(() => {
    if (open) load()
  }, [index.length])

  const added = async (input) => {
    try {
      await addTotp(input)
      setAdding(null)
      await load()
      toast('2FA code added')
    } catch (e) {
      Alert.alert("Couldn't add that", String(e?.message || e))
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (adding ? setAdding(null) : onClose())} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <PixelIcon name="lock" size={16} color={C.teal} />
          <PText style={st.title}>2FA CODES</PText>
          {open && !adding && <PButton small hot icon="plus" label="ADD" onPress={() => setAdding('menu')} />}
          <PButton small label="DONE" onPress={onClose} />
        </View>

        {adding === 'scan' ? (
          <Scanner onCode={added} onCancel={() => setAdding(null)} insets={insets} />
        ) : (
          <FlatList
            data={open ? entries : []}
            keyExtractor={(e) => e.id}
            contentContainerStyle={st.body}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <>
                {adding === 'menu' && (
                  <PCard style={st.card}>
                    <PHeader>ADD A 2FA CODE</PHeader>
                    <Text style={st.muted}>On the site, turn on two-factor sign-in and choose "authenticator app". It shows a QR code and a secret key.</Text>
                    <View style={st.row}>
                      <PButton hot label="SCAN QR CODE" onPress={() => setAdding('scan')} />
                      <PButton label="TYPE THE KEY" onPress={() => setAdding('manual')} />
                      <PButton label="CANCEL" onPress={() => setAdding(null)} />
                    </View>
                  </PCard>
                )}
                {adding === 'manual' && <ManualForm onSave={added} onCancel={() => setAdding(null)} />}
                {open && !entries.length && !adding && (
                  <Text style={st.empty}>No 2FA codes yet. Tap ADD to scan a site's QR code. Codes stay encrypted on this phone, and sync only if "Sync passwords" is on.</Text>
                )}
              </>
            }
            renderItem={({ item }) => <CodeRow entry={item} onEdit={() => setEditing(item)} />}
          />
        )}

        {editing && (
          <EditSheet
            entry={editing}
            onClose={() => setEditing(null)}
            onSave={async (patch) => {
              await updateTotp(editing.id, patch)
              setEditing(null)
              load()
            }}
            onDelete={() =>
              Alert.alert('Delete this 2FA code?', "Make sure you've turned off two-factor on the site or have another way in, or you could lock yourself out.", [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    await deleteTotp(editing.id)
                    setEditing(null)
                    load()
                  },
                },
              ])
            }
          />
        )}
      </View>
    </Modal>
  )
}

function CodeRow({ entry, onEdit }) {
  const now = useNow()
  const code = codeFor(entry, now)
  const left = secondsLeft(entry.period, now)
  const copy = async () => {
    await Clipboard.setStringAsync(code)
    toast('Code copied')
  }
  return (
    <Pressable onPress={copy} onLongPress={onEdit} style={({ pressed }) => [st.item, pressed && { backgroundColor: C.edge }]} accessibilityRole="button" accessibilityLabel={`${entry.issuer || 'Code'} ${entry.account}, ${code.split('').join(' ')}, ${left} seconds left`} accessibilityHint="Tap to copy, long-press to edit">
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={st.issuer} numberOfLines={1}>{entry.issuer || 'Unnamed'}</Text>
        {!!entry.account && <Text style={st.muted} numberOfLines={1}>{entry.account}</Text>}
        <Text style={[st.code, left <= 5 && { color: C.pink }]}>{spaced(code)}</Text>
        <PProgress value={left / entry.period} segments={10} color={left <= 5 ? C.pink : C.teal} />
      </View>
      <Pressable onPress={onEdit} hitSlop={10} accessibilityLabel={`Edit ${entry.issuer}`} style={st.more}>
        <PixelIcon name="menu" size={12} color={C.muted} />
      </Pressable>
    </Pressable>
  )
}

function Scanner({ onCode, onCancel, insets }) {
  const [perm, requestPerm] = useCameraPermissions()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) requestPerm()
  }, [perm?.granted])
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {perm?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={done ? undefined : ({ data }) => {
            if (!/^otpauth:/i.test(data)) return
            setDone(true)
            onCode(data)
          }}
        />
      ) : (
        <Text style={[st.empty, { color: C.ink }]}>Bit Browser needs the camera to scan the QR code. You can also type the key instead.</Text>
      )}
      <PText style={[st.scanLabel, { top: 16 }]}>SCAN THE SITE'S 2FA QR CODE</PText>
      <PButton label="CANCEL" onPress={onCancel} style={{ position: 'absolute', bottom: insets.bottom + 24, alignSelf: 'center' }} />
    </View>
  )
}

function ManualForm({ onSave, onCancel }) {
  const [issuer, setIssuer] = useState('')
  const [account, setAccount] = useState('')
  const [secret, setSecret] = useState('')
  return (
    <PCard style={st.card}>
      <PHeader>TYPE THE SECRET KEY</PHeader>
      <Field value={issuer} onChangeText={setIssuer} placeholder="Site or app (e.g. Shippo)" accessibilityLabel="Site or app name" />
      <Field value={account} onChangeText={setAccount} placeholder="Your account (optional)" autoCapitalize="none" accessibilityLabel="Account" />
      <Field value={secret} onChangeText={setSecret} placeholder="Secret key (letters A–Z and 2–7)" autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Secret key" />
      <View style={st.row}>
        <PButton hot label="SAVE" disabled={secret.replace(/\s/g, '').length < 8} onPress={() => onSave({ issuer, account, secret })} />
        <PButton label="CANCEL" onPress={onCancel} />
      </View>
    </PCard>
  )
}

function EditSheet({ entry, onClose, onSave, onDelete }) {
  const [issuer, setIssuer] = useState(entry.issuer)
  const [account, setAccount] = useState(entry.account)
  const [site, setSite] = useState(entry.site || '')
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={st.scrim} onPress={onClose}>
        <Pressable style={st.sheet} onPress={() => {}}>
          <PHeader>EDIT</PHeader>
          <Field value={issuer} onChangeText={setIssuer} placeholder="Site or app" accessibilityLabel="Site or app name" />
          <Field value={account} onChangeText={setAccount} placeholder="Account" autoCapitalize="none" accessibilityLabel="Account" />
          <Field value={site} onChangeText={setSite} placeholder="Sign-in page (so Bit Browser can offer the code)" autoCapitalize="none" keyboardType="url" accessibilityLabel="Sign-in page address" />
          <View style={st.row}>
            <PButton hot label="SAVE" onPress={() => onSave({ issuer, account, site })} />
            <PButton label="DELETE" onPress={onDelete} />
            <PButton label="CANCEL" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { flex: 1, ...px(10) },
  body: { padding: 14, paddingBottom: 40, gap: 8 },
  card: { gap: 8, marginBottom: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 3, borderColor: C.edge, borderRightColor: '#05050f', borderBottomColor: '#05050f', backgroundColor: C.panel },
  issuer: { color: C.ink, fontSize: 15, fontWeight: '700', lineHeight: 20, includeFontPadding: false },
  code: { ...px(18), color: C.teal, letterSpacing: 2, marginVertical: 2 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 18, includeFontPadding: false },
  more: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 40, paddingHorizontal: 16, lineHeight: 20 },
  scanLabel: { position: 'absolute', alignSelf: 'center', color: C.ink, backgroundColor: C.bg, padding: 8 },
  scrim: { flex: 1, backgroundColor: 'rgba(5,5,15,0.7)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, padding: 16, gap: 8 },
})
