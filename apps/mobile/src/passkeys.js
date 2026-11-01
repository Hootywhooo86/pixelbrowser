// Passkeys and security keys (WebAuthn) in web pages.
//
// Android: turned on in every tab and sign-in pop-up when the phone's Android
// System WebView supports it (BitMedia.enablePasskeys). WebView only offers
// "app" mode to apps that aren't listed by Google as privileged browsers, so
// passkeys work on sites that support security keys or hybrid sign-in ("use a
// phone"); some sites still fall back to a password. iPhone: WKWebView handles
// passkeys for associated domains only.

import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

const native = Platform.OS === 'android' ? requireOptionalNativeModule('BitShields') : null

export function isPasskeySupported() {
  try {
    return !!native?.passkeysSupported?.()
  } catch {
    return false
  }
}
