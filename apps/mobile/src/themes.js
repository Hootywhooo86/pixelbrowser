// Pixel themes. Each theme fills the same keys as C in theme.js, so every
// screen picks it up. A theme is applied before the app's styles are built
// (see index.js); changing it reloads the app.

const BASE = { pink: '#ff5d8f', purple: '#c084fc', purpleDark: '#3d1f63' }

function make(id, label, p, extra = {}) {
  return {
    id,
    label,
    light: !!extra.light,
    colors: { ...BASE, bg: p.bg, panel: p.panel, edge: p.edge, teal: p.accent, tealDark: p.accentDark, orange: p.orange, ink: p.ink, muted: p.muted, ...(extra.colors || {}) },
  }
}

export const THEMES = {
  bit: make('bit', 'Bit (default)', { bg: '#0b0b16', panel: '#141428', edge: '#26264a', accent: '#2dd4bf', accentDark: '#0e7c6f', ink: '#f4f1ff', muted: '#9a97b8', orange: '#ff9f1c' }),
  gameboy: make('gameboy', 'Game Boy', { bg: '#0f380f', panel: '#1e4d1e', edge: '#306230', accent: '#9bbc0f', accentDark: '#5a7a0a', ink: '#e0f8d0', muted: '#8bac0f', orange: '#c4e05a' }, { colors: { purple: '#c4e05a', purpleDark: '#24451a' } }),
  arcade: make('arcade', 'Arcade neon', { bg: '#0a0014', panel: '#1a0633', edge: '#3a0f66', accent: '#ff2bd6', accentDark: '#9a0f80', ink: '#fff0ff', muted: '#b48ad8', orange: '#00f0ff' }, { colors: { pink: '#ffe14d' } }),
  sunset: make('sunset', 'Sunset', { bg: '#1a0b14', panel: '#2b1220', edge: '#4a1d33', accent: '#ff7b54', accentDark: '#a8452a', ink: '#fff1e6', muted: '#c99a9a', orange: '#ffd23f' }),
  mono: make('mono', 'Mono (high contrast)', { bg: '#000000', panel: '#111111', edge: '#ffffff', accent: '#ffffff', accentDark: '#888888', ink: '#ffffff', muted: '#cccccc', orange: '#ffff00' }, { colors: { pink: '#ff4d4d', purple: '#ffffff', purpleDark: '#333333' } }),
  light: make('light', 'Light', { bg: '#f4f1ff', panel: '#ffffff', edge: '#c9c4e6', accent: '#0e9f8c', accentDark: '#0b6f62', ink: '#141428', muted: '#5c5a7a', orange: '#d97706' }, { light: true, colors: { pink: '#d6336c', purple: '#7c3aed', purpleDark: '#ede4ff' } }),
}

// Swatches for the custom theme builder: a small pixel palette.
export const SWATCHES = [
  '#000000', '#0b0b16', '#0a0014', '#0f380f', '#1a0b14', '#141428', '#1a0633', '#1e4d1e', '#2b1220', '#26264a',
  '#3a0f66', '#306230', '#4a1d33', '#5c5a7a', '#9a97b8', '#c9c4e6', '#f4f1ff', '#ffffff', '#2dd4bf', '#0e9f8c',
  '#9bbc0f', '#4ade80', '#38bdf8', '#3b82f6', '#a78bfa', '#ff2bd6', '#ff5d8f', '#ff7b54', '#ff9f1c', '#ffd23f',
]

/** Is a hex color light? (for picking readable text and the status bar style) */
export function isLightColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 150
}

/** Darken a hex color (used for the custom theme's accent shadow). */
export function darken(hex, amount = 0.45) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const f = (v) => Math.round(v * (1 - amount)).toString(16).padStart(2, '0')
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`
}

/** Colors for a saved choice { id, custom }. Unknown ids fall back to Bit. */
export function themeColors(choice) {
  const id = choice?.id || 'bit'
  if (id === 'custom' && choice.custom) {
    const c = choice.custom
    const bit = THEMES.bit.colors
    const bg = c.bg || bit.bg
    const light = isLightColor(bg)
    return {
      light,
      colors: {
        ...bit,
        bg,
        panel: c.panel || bit.panel,
        edge: c.edge || (light ? '#c9c4e6' : bit.edge),
        teal: c.accent || bit.teal,
        tealDark: darken(c.accent || bit.teal),
        ink: c.ink || (light ? '#141428' : bit.ink),
        muted: light ? '#5c5a7a' : bit.muted,
      },
    }
  }
  const t = THEMES[id] || THEMES.bit
  return { light: t.light, colors: t.colors }
}
