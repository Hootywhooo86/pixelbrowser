// "Media" sheet for the page you're on: video speed, sleep timer,
// picture-in-picture, background play, and saving the page's videos/images.

import { useEffect, useState } from 'react'
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Image, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStore, update } from './store'
import { PButton, PSwitch } from './ui'
import PixelIcon from './PixelIcon'
import { C, px } from './theme'
import { SPEEDS, speedFor, cantSave, saveMedia, onSleepChange, isPipSupported, setBackgroundPlay } from './media'

const SLEEP = [
  [15, '15 MIN'],
  [30, '30 MIN'],
  [60, '1 HOUR'],
  ['end', 'END OF VIDEO'],
]

const left = (endsAt) => {
  const m = Math.max(0, Math.ceil((endsAt - Date.now()) / 60000))
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

/**
 * Props:
 *   url               the page
 *   getMedia()        → Promise<{ videos, images }> (run MEDIA_LIST_JS in the tab)
 *   onSpeed(rate)     apply a speed to the page (App injects setSpeed(url, rate))
 *   onSleep(choice)   15 | 30 | 60 | 'end' | null (App calls setSleepTimer)
 *   onPip()           enter picture-in-picture (Android; hidden when unsupported)
 *   onSaved(item)     a download finished (App opens it / shows a toast)
 */
export default function MediaSheet({ visible, url, onClose, getMedia, onSpeed, onSleep, onPip, onSaved }) {
  const insets = useSafeAreaInsets()
  const bgPlay = useStore((s) => s.backgroundPlay !== false)
  const [speed, setSpeedState] = useState(1)
  const [sleep, setSleep] = useState({ endsAt: 0, atEnd: false })
  const [media, setMedia] = useState(null) // { videos, images } once scanned
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => onSleepChange(setSleep), [])
  useEffect(() => {
    if (!visible) return
    setSpeedState(speedFor(url))
    setMedia(null)
    const t = setInterval(() => tick((n) => n + 1), 30000) // refresh "minutes left"
    return () => clearInterval(t)
  }, [visible, url])

  if (!visible) return null
  const web = /^https?:/i.test(url || '')

  const scan = async () => {
    setBusy(true)
    try {
      setMedia((await getMedia?.()) || { videos: [], images: [] })
    } catch {
      setMedia({ videos: [], images: [] })
    }
    setBusy(false)
  }

  const save = async (item) => {
    const why = cantSave(item.src, url)
    if (why) return Alert.alert("Can't save this", why)
    const done = await saveMedia(item, url)
    if (done?.status === 'failed') Alert.alert('Download failed', done.error)
    else if (done?.status === 'done') onSaved?.(done)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close media" />
      <View style={[st.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={st.head}>
          <PixelIcon name="star" size={16} color={C.teal} />
          <Text style={st.title}>MEDIA</Text>
          <PButton small label="DONE" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={st.body}>
          <Text style={st.h}>VIDEO SPEED</Text>
          <View style={st.wrapRow}>
            {SPEEDS.map((r) => (
              <Pressable
                key={r}
                onPress={() => {
                  setSpeedState(r)
                  onSpeed?.(r)
                }}
                disabled={!web}
                accessibilityRole="button"
                accessibilityState={{ selected: speed === r }}
                style={[st.chip, speed === r && st.chipOn, !web && { opacity: 0.4 }]}
              >
                <Text style={[st.chipText, speed === r && { color: C.bg }]}>{r}x</Text>
              </Pressable>
            ))}
          </View>
          <Text style={st.note}>Remembered for this site.</Text>

          <Text style={st.h}>SLEEP TIMER</Text>
          <View style={st.wrapRow}>
            {SLEEP.map(([v, label]) => {
              const on = v === 'end' && sleep.atEnd
              return (
                <Pressable key={label} onPress={() => onSleep?.(v)} accessibilityRole="button" style={[st.chip, on && st.chipOn]}>
                  <Text style={[st.chipText, on && { color: C.bg }]}>{label}</Text>
                </Pressable>
              )
            })}
          </View>
          {(sleep.endsAt > 0 || sleep.atEnd) && (
            <View style={st.row}>
              <Text style={[st.label, { flex: 1 }]}>{sleep.atEnd ? 'Pausing at the end of this video' : `Pausing everything in ${left(sleep.endsAt)}`}</Text>
              <PButton small label="CANCEL" onPress={() => onSleep?.(null)} />
            </View>
          )}

          {isPipSupported() && onPip && (
            <PButton icon="tabs" label="PICTURE IN PICTURE" onPress={onPip} disabled={!web} style={{ alignSelf: 'flex-start' }} />
          )}

          <View style={st.row}>
            <View style={{ flex: 1 }}>
              <Text style={st.label}>Keep playing in the background</Text>
              <Text style={st.sub}>Music and videos keep going with the screen off or in another app.</Text>
            </View>
            <PSwitch
              label="ON"
              value={bgPlay}
              accessibilityLabel="Background play"
              onChange={(v) => {
                update((s) => (s.backgroundPlay = v))
                setBackgroundPlay(v)
              }}
            />
          </View>

          <Text style={st.h}>SAVE FROM THIS PAGE</Text>
          {!media && <PButton label={busy ? 'LOOKING…' : 'FIND VIDEOS AND IMAGES'} onPress={scan} disabled={!web || busy} style={{ alignSelf: 'flex-start' }} />}
          {media && !media.videos.length && !media.images.length && <Text style={st.note}>No videos or images to save on this page.</Text>}
          {media?.videos.map((v) => {
            const why = cantSave(v.src, url)
            return (
              <View key={v.src} style={st.item}>
                <PixelIcon name="download" size={16} color={why ? C.muted : C.teal} />
                <View style={{ flex: 1 }}>
                  <Text style={st.label} numberOfLines={1}>{decodeURIComponent(v.src.split(/[?#]/)[0].split('/').pop() || 'video')}</Text>
                  <Text style={st.sub} numberOfLines={2}>{why || `${v.kind === 'audio' ? 'Audio' : 'Video'}${v.duration ? ` · ${Math.round(v.duration / 60)} min` : ''}`}</Text>
                </View>
                {!why && <PButton small label="SAVE" onPress={() => save(v)} />}
              </View>
            )
          })}
          {media?.images.length > 0 && (
            <View style={st.grid}>
              {media.images.map((i) => (
                <Pressable key={i.src} onPress={() => save(i)} accessibilityLabel={`Save image ${i.alt || ''}`} style={st.thumb}>
                  <Image source={{ uri: i.src }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                </Pressable>
              ))}
            </View>
          )}
          {media?.images.length > 0 && <Text style={st.note}>Tap an image to save it. You can also long-press any image on a page.</Text>}
        </ScrollView>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(5,5,15,0.6)' },
  sheet: { maxHeight: '85%', backgroundColor: C.panel, borderTopWidth: 3, borderTopColor: C.teal },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: C.edge },
  title: { flex: 1, ...px(9), color: C.ink },
  body: { padding: 14, gap: 10 },
  h: { ...px(8), color: C.teal, marginTop: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 34, paddingHorizontal: 10, borderWidth: 3, borderColor: C.edge, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: C.teal, borderColor: C.tealDark },
  chipText: { ...px(7), color: C.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  label: { color: C.ink, fontSize: 15 },
  sub: { color: C.muted, fontSize: 12, marginTop: 2 },
  note: { color: C.muted, fontSize: 12, lineHeight: 18 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: C.edge },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: { width: 96, height: 96, borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg },
})
