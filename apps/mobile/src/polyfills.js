// The shared crypto code expects a few web APIs that React Native may lack.
import * as Crypto from 'expo-crypto'

if (!globalThis.crypto) globalThis.crypto = {}
if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = (array) => Crypto.getRandomValues(array)
}

if (typeof globalThis.TextDecoder === 'undefined') {
  // Minimal UTF-8 decoder (enough for synced JSON records).
  globalThis.TextDecoder = class {
    decode(bytes) {
      let out = ''
      for (let i = 0; i < bytes.length; ) {
        const b = bytes[i++]
        let cp
        if (b < 0x80) cp = b
        else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f)
        else if (b < 0xf0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
        else cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
        out += String.fromCodePoint(cp)
      }
      return out
    }
  }
}
