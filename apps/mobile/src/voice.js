// Voice: speak a search or a question for Bitter, and have answers read aloud.
//
// Speech-to-text uses expo-speech-recognition (Android's and iOS's own
// recognisers). If that module isn't in this build, Android falls back to the
// system "speak now" screen via an intent. Read-aloud uses expo-speech.

import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Platform, Alert } from 'react-native'
import PixelIcon from './PixelIcon'
import { C } from './theme'

function recognizer() {
  try {
    return require('expo-speech-recognition').ExpoSpeechRecognitionModule || null
  } catch {
    return null
  }
}

const lang = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US'
  } catch {
    return 'en-US'
  }
}

let active = null // { stop() }

/**
 * Listen once. onResult(text, isFinal) is called with partial and final
 * transcripts; onError(message) if it fails. Returns { stop }.
 */
export async function startVoice({ onResult, onError, onEnd } = {}) {
  stopVoice()
  const Rec = recognizer()
  if (Rec?.start) {
    try {
      const perm = await Rec.requestPermissionsAsync()
      if (!perm?.granted) {
        onError?.('Bit Browser needs the microphone to hear you. Allow it in your phone settings.')
        return { stop() {} }
      }
      const subs = [
        Rec.addListener('result', (e) => {
          const text = e?.results?.[0]?.transcript || ''
          if (text) onResult?.(text, !!e.isFinal)
        }),
        Rec.addListener('error', (e) => {
          if (e?.error !== 'aborted' && e?.error !== 'no-speech') onError?.(e?.message || "Couldn't hear that.")
        }),
        Rec.addListener('end', () => {
          subs.forEach((s) => s?.remove?.())
          active = null
          onEnd?.()
        }),
      ]
      Rec.start({ lang: lang(), interimResults: true, continuous: false, addsPunctuation: true })
      active = { stop: () => Rec.stop() }
      return active
    } catch (e) {
      // fall through to the system screen
    }
  }
  if (Platform.OS === 'android') {
    try {
      const IntentLauncher = require('expo-intent-launcher')
      const res = await IntentLauncher.startActivityAsync('android.speech.action.RECOGNIZE_SPEECH', {
        extra: { 'android.speech.extra.LANGUAGE_MODEL': 'free_form', 'android.speech.extra.PROMPT': 'Speak now' },
      })
      const text = res?.extra?.['android.speech.extra.RESULTS']?.[0]
      if (text) onResult?.(text, true)
      onEnd?.()
    } catch {
      onError?.("Voice input isn't available on this phone.")
    }
    return { stop() {} }
  }
  onError?.("Voice input isn't available here.")
  return { stop() {} }
}

export function stopVoice() {
  try {
    active?.stop()
  } catch {}
  active = null
}

/** Read text aloud (Bitter's answers). Markdown and links are tidied first. */
export function speak(text, opts = {}) {
  try {
    const Speech = require('expo-speech')
    Speech.stop()
    const clean = String(text || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[#*_`>]/g, '')
      .slice(0, 4000)
    if (clean.trim()) Speech.speak(clean, { language: lang(), ...opts })
  } catch {}
}

export function stopSpeaking() {
  try {
    require('expo-speech').stop()
  } catch {}
}

/** Mic button: tap to talk. onText(text) gets the final transcript; onPartial(text) the live one. */
export function VoiceButton({ onText, onPartial, size = 18, color = C.muted, style, accessibilityLabel = 'Speak' }) {
  const [listening, setListening] = useState(false)
  const last = useRef('')
  useEffect(() => () => stopVoice(), [])
  const toggle = async () => {
    if (listening) {
      stopVoice()
      setListening(false)
      return
    }
    last.current = ''
    setListening(true)
    await startVoice({
      onResult: (text, final) => {
        last.current = text
        if (final) {
          setListening(false)
          onText?.(text)
        } else onPartial?.(text)
      },
      onError: (msg) => {
        setListening(false)
        Alert.alert('Voice', msg)
      },
      onEnd: () => setListening(false),
    })
  }
  return (
    <Pressable onPress={toggle} hitSlop={8} style={[st.btn, listening && st.on, style]} accessibilityRole="button" accessibilityLabel={listening ? 'Stop listening' : accessibilityLabel} accessibilityState={{ busy: listening }}>
      <PixelIcon name={listening ? 'stop' : 'search'} size={size} color={listening ? C.bg : color} />
    </Pressable>
  )
}

const st = StyleSheet.create({
  btn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: C.pink },
})
