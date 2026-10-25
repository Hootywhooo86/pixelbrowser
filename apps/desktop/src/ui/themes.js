// Pixel themes. Same palettes as the phone app (apps/mobile/src/themes.js),
// so a theme picked on one device looks the same on the other.
// Works in the main process (require) and in pages (window.BIT_THEMES).
;(function (root) {
  const THEMES = {
    bit: { label: 'Bit', bg: '#0b0b16', panel: '#141428', edge: '#26264a', accent: '#2dd4bf', accentDark: '#0e7c6f', ink: '#f4f1ff', muted: '#9a97b8', orange: '#ff9f1c' },
    gameboy: { label: 'Game Boy', bg: '#0f380f', panel: '#1e4d1e', edge: '#306230', accent: '#9bbc0f', accentDark: '#5a7a0a', ink: '#e0f8d0', muted: '#8bac0f', orange: '#c4e05a' },
    arcade: { label: 'Arcade', bg: '#0a0014', panel: '#1a0633', edge: '#3a0f66', accent: '#ff2bd6', accentDark: '#9a0f80', ink: '#fff0ff', muted: '#b48ad8', orange: '#00f0ff' },
    sunset: { label: 'Sunset', bg: '#1a0b14', panel: '#2b1220', edge: '#4a1d33', accent: '#ff7b54', accentDark: '#a8452a', ink: '#fff1e6', muted: '#c99a9a', orange: '#ffd23f' },
    mono: { label: 'Mono (high contrast)', bg: '#000000', panel: '#111111', edge: '#ffffff', accent: '#ffffff', accentDark: '#888888', ink: '#ffffff', muted: '#cccccc', orange: '#ffff00' },
    light: { label: 'Light', bg: '#f4f1ff', panel: '#ffffff', edge: '#c9c4e6', accent: '#0e9f8c', accentDark: '#0b6f62', ink: '#141428', muted: '#5c5a7a', orange: '#d97706' },
  }

  const hex = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim())
    return m ? m[1] : null
  }
  const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
  const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t))

  /** A full palette from the four colors people pick in the custom theme. */
  function customPalette(c = {}) {
    const base = THEMES.bit
    const accent = hex(c.accent) || base.accent.slice(1)
    const bg = hex(c.bg) || base.bg.slice(1)
    const panel = hex(c.panel) || base.panel.slice(1)
    const ink = hex(c.ink) || base.ink.slice(1)
    return {
      label: 'Custom',
      bg: '#' + bg,
      panel: '#' + panel,
      edge: mix(panel, ink, 0.18),
      accent: '#' + accent,
      accentDark: mix(accent, '000000', 0.45),
      ink: '#' + ink,
      muted: mix(ink, bg, 0.4),
      orange: base.orange,
    }
  }

  function paletteFor(theme = {}) {
    if (theme.id === 'custom') return customPalette(theme.custom || {})
    return THEMES[theme.id] || THEMES.bit
  }

  /** CSS that overrides the design tokens in tokens.css. */
  function themeCss(theme) {
    const p = paletteFor(theme)
    return `:root:root{--bg:${p.bg};--panel:${p.panel};--edge:${p.edge};--teal:${p.accent};--teal-dark:${p.accentDark};--ink:${p.ink};--muted:${p.muted};--orange:${p.orange};color-scheme:${theme.id === 'light' ? 'light' : 'dark'}}`
  }

  const api = { THEMES, paletteFor, customPalette, themeCss }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.BIT_THEMES = api
})(typeof window !== 'undefined' ? window : globalThis)
