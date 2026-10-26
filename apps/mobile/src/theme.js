// Pixel design tokens. C starts as the Bit theme; index.js swaps in the
// saved theme (src/themes.js) before any screen builds its styles.
import { themeColors } from './themes'

export const C = {
  bg: '#0b0b16',
  panel: '#141428',
  edge: '#26264a',
  teal: '#2dd4bf',
  tealDark: '#0e7c6f',
  orange: '#ff9f1c',
  pink: '#ff5d8f',
  ink: '#f4f1ff',
  muted: '#9a97b8',
  purple: '#c084fc',
  purpleDark: '#3d1f63',
}

export const PIXEL_FONT = 'PressStart2P'

/**
 * Pixel-font text style. Press Start 2P has tall ascenders and Android adds
 * extra font padding, so letters overlap borders unless the line box is
 * ~1.5x the size and the padding is off. Use this for every pixel label.
 */
export function px(fontSize, lineScale = 1.5) {
  return {
    fontFamily: PIXEL_FONT,
    fontSize,
    lineHeight: Math.round(fontSize * lineScale),
    includeFontPadding: false,
    textAlignVertical: 'center',
  }
}

let light = false

/** Copy a saved theme choice { id, custom } into C. Call before styles are built. */
export function applyThemeToC(choice) {
  const t = themeColors(choice)
  Object.assign(C, t.colors)
  light = t.light
}

/** True when the current theme has a light background (use a dark status bar). */
export function isLightTheme() {
  return light
}

// ---------- saving and syncing the choice ----------

export const THEME_KEY = 'pixel-theme-v1'

/**
 * Save a theme choice { id, custom }, sync it, and reload the app so every
 * screen redraws in the new colors. Returns false if the app couldn't reload
 * (then the theme applies on the next start).
 */
export async function setTheme(choice, { sync = true, reload = true } = {}) {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default
  const { update, putRecord } = require('./store')
  const clean = { id: choice?.id || 'bit', custom: choice?.id === 'custom' ? choice.custom || null : null }
  update((s) => {
    s.theme = clean.id
    s.customTheme = clean.custom
  })
  if (sync) putRecord('settings', 'theme', clean)
  await AsyncStorage.setItem(THEME_KEY, JSON.stringify(clean)).catch(() => {})
  if (!reload) return false
  try {
    const { reloadAppAsync } = require('expo')
    await reloadAppAsync('Theme changed')
    return true
  } catch {
    return false
  }
}

/**
 * Apply a theme chosen on another device (call after sync pulls records).
 * It's saved and shows the next time the app opens, so browsing is never interrupted.
 */
export async function applyRemoteTheme() {
  const { getState } = require('./store')
  const rec = getState()?.records?.settings?.theme
  if (!rec || rec.deleted || !rec.data || rec.deviceId === getState().deviceId) return false
  const s = getState()
  const same = rec.data.id === s.theme && JSON.stringify(rec.data.custom || null) === JSON.stringify(s.customTheme || null)
  if (same) return false
  return setTheme(rec.data, { sync: false, reload: false })
}
