// Full-screen warning for phishing and malware sites, like Chrome's red page.
// Shown over the tab before the site loads.

import { useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { PButton, PText } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'

export default function DangerScreen({ host, list, url, onBack, onContinue }) {
  const [more, setMore] = useState(false)
  return (
    <View style={st.wrap} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={st.body}>
        <View style={st.badge}>
          <PixelIcon name="shield" size={40} color={C.bg} />
        </View>
        <PText style={st.title}>DANGEROUS SITE AHEAD</PText>
        <Text style={st.host} numberOfLines={2}>{host}</Text>
        <Text style={st.text}>
          This site is on the {list} list of phishing and malware sites. It may pretend to be a site you trust to steal your passwords,
          card numbers or sign-ins, or try to install harmful apps.
        </Text>
        <Text style={st.text}>Bit Shields stopped it before anything loaded.</Text>
        <PButton hot color={C.teal} label="GET ME OUT OF HERE" onPress={onBack} style={{ alignSelf: 'stretch', marginTop: 8 }} />
        <Pressable onPress={() => setMore((m) => !m)} style={st.more} accessibilityRole="button">
          <Text style={st.moreText}>{more ? 'Hide details' : 'Details'}</Text>
        </Pressable>
        {more && (
          <View style={st.details}>
            <Text style={st.small} numberOfLines={4}>{url}</Text>
            <Text style={st.small}>
              The list is downloaded to your phone and checked here, so the sites you visit are never sent anywhere. If you're sure this site is
              safe, you can open it until you close Bit Browser.
            </Text>
            <PButton small label="OPEN ANYWAY (UNSAFE)" color={C.pink} onPress={onContinue} style={{ alignSelf: 'flex-start' }} />
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const RED = '#d8314a'
const st = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#2a0710', zIndex: 50 },
  body: { padding: 24, gap: 14, alignItems: 'center', paddingTop: 48 },
  badge: { width: 76, height: 76, backgroundColor: RED, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#ff8a9b' },
  title: { ...px(14), color: '#ff8a9b', textAlign: 'center' },
  host: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  text: { color: '#f3dde1', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  more: { paddingVertical: 10 },
  moreText: { color: '#f3dde1', textDecorationLine: 'underline', fontSize: 14 },
  details: { alignSelf: 'stretch', gap: 10, borderWidth: 2, borderColor: '#6b1a28', padding: 12 },
  small: { color: '#d9b8be', fontSize: 13, lineHeight: 19 },
})
