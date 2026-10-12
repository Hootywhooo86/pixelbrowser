// Android update notice for people who installed the APK from GitHub
// (Google Play and the App Store update the app themselves). It only asks
// GitHub for the newest version number; nothing about you is sent.

import { Platform } from 'react-native'
import Constants from 'expo-constants'

const LATEST = 'https://api.github.com/repos/Hootywhooo86/pixelbrowser/releases/latest'

/** True if version a is newer than b (simple x.y.z compare). */
export function isNewer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

export async function checkForAppUpdate() {
  if (Platform.OS !== 'android') return null
  const current = Constants.expoConfig?.version || '0.0.0'
  try {
    const res = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const release = await res.json()
    const latest = String(release.tag_name || '').replace(/^v/, '')
    if (!latest || !isNewer(latest, current)) return null
    const apk = (release.assets || []).find((a) => a.name.endsWith('.apk'))
    return { version: latest, url: apk?.browser_download_url || release.html_url }
  } catch {
    return null
  }
}
