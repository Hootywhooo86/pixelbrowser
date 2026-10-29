// "This site" sheet: Shields, desktop site, camera/microphone/location,
// text size and always-translate for the page you're on.

import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { siteShieldsOn, setSiteShields } from './shields'
import { useSite, setSite, resetSite, hostKey } from './site-settings'
import { useStore } from './store'
import { PButton, PSwitch } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

const CHOICES = [
  ['ask', 'ASK'],
  ['allow', 'ALLOW'],
  ['block', 'BLOCK'],
]

/**
 * onChanged(what): 'shields' | 'desktop' | 'permissions' | 'textZoom' | 'translate'
 * so the app can reload the page or re-apply settings.
 */
export default function SiteSettingsSheet({ visible, url, onClose, onChanged }) {
  const insets = useSafeAreaInsets()
  const host = hostKey(url)
  const site = useSite(host)
  useStore((s) => s.shields) // re-render when Shields change
  const baseZoom = useStore((s) => s.textZoom || 100)
  if (!visible) return null
  const shieldsUp = siteShieldsOn(url)
  const zoom = site.textZoom || baseZoom
  const change = (patch, what) => {
    setSite(host, patch)
    onChanged?.(what)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close site settings" />
      <View style={[st.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={st.head}>
          <PixelIcon name="settings" size={16} color={C.teal} />
          <Text style={st.title} numberOfLines={1}>{host || 'THIS PAGE'}</Text>
          <PButton small icon="close" accessibilityLabel="Close" onPress={onClose} />
        </View>
        {!host ? (
          <Text style={st.note}>Site settings are for web pages. Open a website first.</Text>
        ) : (
          <ScrollView contentContainerStyle={st.body}>
            <Row icon={shieldsUp ? 'shield' : 'shield-off'} label="Bit Shields" note={shieldsUp ? 'Ads and trackers blocked here' : 'Shields are down for this site'}>
              <PSwitch label="ON" value={shieldsUp} onChange={(on) => setSiteShields(url, on).then(() => onChanged?.('shields'))} />
            </Row>
            <Row icon="home" label="Desktop site" note="Ask for the computer version of this site">
              <PSwitch label="PC" value={!!site.desktop} onChange={(v) => change({ desktop: v }, 'desktop')} />
            </Row>

            <Text style={st.h}>PERMISSIONS</Text>
            {[
              ['camera', 'Camera'],
              ['microphone', 'Microphone'],
              ['location', 'Location'],
            ].map(([key, label]) => (
              <View key={key} style={st.permRow}>
                <Text style={st.label}>{label}</Text>
                <View style={st.segment}>
                  {CHOICES.map(([value, text]) => {
                    const on = site[key] === value
                    return (
                      <Pressable
                        key={value}
                        onPress={() => change({ [key]: value }, 'permissions')}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${label}: ${text.toLowerCase()}`}
                        style={[st.seg, on && { backgroundColor: value === 'block' ? C.pink : C.teal }]}
                      >
                        <Text style={[st.segText, on && { color: C.bg }]}>{text}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ))}
            <Text style={st.note}>Notifications: websites can't send notifications in the phone app yet.</Text>

            <Text style={st.h}>TEXT SIZE</Text>
            <View style={st.zoomRow}>
              <PButton small label="A-" onPress={() => change({ textZoom: Math.max(50, zoom - 10) }, 'textZoom')} />
              <Text style={st.zoom}>{zoom}%</Text>
              <PButton small label="A+" onPress={() => change({ textZoom: Math.min(250, zoom + 10) }, 'textZoom')} />
              {!!site.textZoom && <PButton small label="RESET" onPress={() => change({ textZoom: 0 }, 'textZoom')} />}
            </View>

            <Row icon="bitter" label="Always translate" note="Translate this site into your language when it opens">
              <PSwitch label="ON" value={!!site.translate} onChange={(v) => change({ translate: v }, 'translate')} />
            </Row>

            <Text style={st.note}>
              Clearing one site's cookies isn't possible in the phone's web engine. To sign out, use the site's own sign-out, or Settings → Shields & privacy → clear data.
            </Text>
            <PButton small label="RESET THIS SITE" onPress={() => (resetSite(host), onChanged?.('permissions'))} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  )
}

function Row({ icon, label, note, children }) {
  return (
    <View style={st.row}>
      <PixelIcon name={icon} size={16} color={C.teal} />
      <View style={{ flex: 1 }}>
        <Text style={st.label}>{label}</Text>
        {!!note && <Text style={st.sub}>{note}</Text>}
      </View>
      {children}
    </View>
  )
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(5,5,15,0.6)' },
  sheet: { maxHeight: '80%', backgroundColor: C.panel, borderTopWidth: 3, borderTopColor: C.teal },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: C.edge },
  title: { flex: 1, ...px(9), color: C.ink },
  body: { padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  label: { color: C.ink, fontSize: 15 },
  sub: { color: C.muted, fontSize: 12, marginTop: 2 },
  h: { ...px(8), color: C.teal, marginTop: 8 },
  permRow: { gap: 6 },
  segment: { flexDirection: 'row', borderWidth: 3, borderColor: C.edge, backgroundColor: C.bg },
  seg: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' },
  segText: { ...px(7), color: C.muted },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  zoom: { ...px(10), color: C.ink, minWidth: 60, textAlign: 'center' },
  note: { color: C.muted, fontSize: 12, lineHeight: 18 },
})
