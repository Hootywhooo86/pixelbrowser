// Kids mode: safe search forced on, an allow-list or block-list of sites, a
// daily screen-time limit, and no private tabs or Bitter agent. Turning it
// off or changing it needs the parent's PIN.
//
// state.kids = { on, mode: 'block' | 'allow', allow: [], block: [], limitMinutes, usage: { day, minutes } }
// The PIN is stored hashed in secure storage (kids:pin).

import { useEffect, useState } from 'react'
import { View, Text, AppState } from 'react-native'
import * as Crypto from 'expo-crypto'
import { getState, update, getSecret, setSecret, useStore } from './store'
import { safeSearchUrl as safeCore, kidsAllows } from './web-tools-core'
import { PButton, PText, Field } from './ui'
import { C, px } from './theme'

const PIN = 'kids:pin'
const today = () => new Date().toISOString().slice(0, 10)
const kids = () => getState()?.kids || {}

export const isKidsMode = () => !!kids().on

async function hashPin(pin) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `bit-kids:${getState().deviceId}:${pin}`)
}

export async function verifyPin(pin) {
  const saved = await getSecret(PIN)
  return !!saved && saved === (await hashPin(String(pin || '')))
}

/** Turn kids mode on with a new PIN (4–8 digits). */
export async function enableKids(pin, settings = {}) {
  if (!/^\d{4,8}$/.test(String(pin))) throw new Error('Pick a PIN of 4 to 8 digits.')
  await setSecret(PIN, await hashPin(pin))
  update((s) => (s.kids = { mode: 'block', allow: [], block: [], limitMinutes: 0, ...s.kids, ...settings, on: true }))
}

/** Change kids settings (needs the PIN). */
export async function changeKids(pin, patch) {
  if (!(await verifyPin(pin))) throw new Error('Wrong PIN.')
  update((s) => (s.kids = { ...s.kids, ...patch }))
}

export async function disableKids(pin) {
  if (!(await verifyPin(pin))) throw new Error('Wrong PIN.')
  update((s) => (s.kids = { ...s.kids, on: false }))
}

/** Add this many minutes of screen time today, e.g. extra time granted with the PIN. */
export async function grantMinutes(pin, minutes) {
  if (!(await verifyPin(pin))) throw new Error('Wrong PIN.')
  update((s) => {
    const k = s.kids || {}
    const used = k.usage?.day === today() ? k.usage.minutes : 0
    s.kids = { ...k, usage: { day: today(), minutes: Math.max(0, used - minutes) } }
  })
}

/** Is this address allowed for kids (or kids mode is off)? */
export function isAllowed(url) {
  if (!isKidsMode()) return true
  return kidsAllows(url, kids())
}

/** Same URL with strict safe search, or null if no change is needed (kids mode only). */
export function safeSearchUrl(url) {
  if (!isKidsMode()) return null
  return safeCore(url)
}

/**
 * Decide a top-frame navigation. { allow: true } | { allow: false, redirect } | { allow: false, blocked: true }
 * App: call from onShouldStartLoadWithRequest; navigate to `redirect`, or show the blocked page.
 */
export function kidsCheck(url) {
  if (!isKidsMode()) return { allow: true }
  if (!isAllowed(url)) return { allow: false, blocked: true }
  const safe = safeCore(url)
  if (safe) return { allow: false, redirect: safe }
  return { allow: true }
}

/** Page script for YouTube: turns on Restricted Mode (kids mode only). */
export const KIDS_YOUTUBE_JS = `(function(){try{if(!/(^|\\.)youtube\\.com$/.test(location.hostname))return;var c=document.cookie.match(/PREF=([^;]*)/);var p=c?c[1]:'';if(!/f2=8000000/.test(p)){document.cookie='PREF='+(p?p.replace(/&?f2=[^&]*/,'')+'&':'')+'f2=8000000; domain=.youtube.com; path=/; max-age=31536000';location.reload()}}catch(e){}})();true;`

export function minutesLeft() {
  const k = kids()
  if (!k.on || !k.limitMinutes) return Infinity
  const used = k.usage?.day === today() ? k.usage.minutes : 0
  return Math.max(0, k.limitMinutes - used)
}

/** Counts screen time while the app is open (call once from App). Returns a stop function. */
export function startScreenTime() {
  const tick = () => {
    if (!isKidsMode() || AppState.currentState !== 'active') return
    update((s) => {
      const k = s.kids || {}
      const used = k.usage?.day === today() ? k.usage.minutes : 0
      s.kids = { ...k, usage: { day: today(), minutes: used + 1 } }
    })
  }
  const t = setInterval(tick, 60000)
  return () => clearInterval(t)
}

/** React hook: { on, locked, minutesLeft } — locked when today's time is used up. */
export function useKids() {
  const k = useStore((s) => s.kids) || {}
  const left = minutesLeft()
  return { on: !!k.on, locked: !!k.on && left <= 0, minutesLeft: left }
}

/**
 * Full-screen lock shown over the browser when screen time is up or a page
 * is blocked. Props: reason: 'time' | 'blocked', host, onBack (for blocked).
 */
export function KidsLock({ reason = 'time', host = '', onBack }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => setErr(''), [pin])
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
      <PText style={{ ...px(14), color: C.orange, textAlign: 'center' }}>{reason === 'time' ? "TIME'S UP!" : 'NOT FOR KIDS'}</PText>
      <Text style={{ color: C.ink, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>
        {reason === 'time' ? 'Screen time for today is used up. Come back tomorrow, or ask a grown-up for more time.' : `${host || 'This site'} isn't allowed in kids mode.`}
      </Text>
      {reason === 'blocked' && onBack && <PButton hot label="GO BACK" onPress={onBack} />}
      <Field value={pin} onChangeText={setPin} placeholder="Grown-up PIN" keyboardType="number-pad" secureTextEntry maxLength={8} style={{ width: 200, textAlign: 'center' }} accessibilityLabel="Parent PIN" />
      <PButton
        small
        label={reason === 'time' ? '+30 MINUTES' : 'ALLOW THIS SITE'}
        disabled={pin.length < 4}
        onPress={async () => {
          try {
            if (reason === 'time') await grantMinutes(pin, 30)
            else
              await changeKids(pin, kids().mode === 'allow' ? { allow: [...(kids().allow || []), host] } : { block: (kids().block || []).filter((h) => h !== host && !host.endsWith(`.${h}`)) })
            setPin('')
            if (reason === 'blocked') onBack?.(true)
          } catch (e) {
            setErr(e.message)
          }
        }}
      />
      {!!err && <Text style={{ color: C.pink }}>{err}</Text>}
    </View>
  )
}
