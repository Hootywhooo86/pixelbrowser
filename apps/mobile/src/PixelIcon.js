// Pixel icon set (scripts/make-pixel-icons.py): 16x16 pixel art drawn white,
// tinted here with any color so icons follow the theme.
import { Image } from 'react-native'
import { C } from './theme'

const ICONS = {
  'back': require('../assets/icons/back.png'),
  'bitter': require('../assets/icons/bitter.png'),
  'bookmark': require('../assets/icons/bookmark.png'),
  'close': require('../assets/icons/close.png'),
  'download': require('../assets/icons/download.png'),
  'forward': require('../assets/icons/forward.png'),
  'home': require('../assets/icons/home.png'),
  'lock': require('../assets/icons/lock.png'),
  'menu': require('../assets/icons/menu.png'),
  'panic': require('../assets/icons/panic.png'),
  'pdf': require('../assets/icons/pdf.png'),
  'plus': require('../assets/icons/plus.png'),
  'print': require('../assets/icons/print.png'),
  'reload': require('../assets/icons/reload.png'),
  'search': require('../assets/icons/search.png'),
  'settings': require('../assets/icons/settings.png'),
  'share': require('../assets/icons/share.png'),
  'shield': require('../assets/icons/shield.png'),
  'shield-off': require('../assets/icons/shield-off.png'),
  'space': require('../assets/icons/space.png'),
  'star': require('../assets/icons/star.png'),
  'stop': require('../assets/icons/stop.png'),
  'tabs': require('../assets/icons/tabs.png'),
  'unlock': require('../assets/icons/unlock.png'),
  'xp': require('../assets/icons/xp.png'),
}

export const ICON_NAMES = Object.keys(ICONS)

/** <PixelIcon name="back" size={24} color={C.ink} /> — size in dp (multiples of 16 look crispest). */
export default function PixelIcon({ name, size = 24, color = C.ink, style }) {
  const source = ICONS[name]
  if (!source) return null
  return (
    <Image
      source={source}
      fadeDuration={0}
      resizeMode="stretch"
      style={[{ width: size, height: size, tintColor: color }, style]}
      accessibilityIgnoresInvertColors
    />
  )
}
