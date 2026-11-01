// In-app updates for the Android APK from GitHub: download the new APK with
// progress, then hand it to Android's installer (it asks you to confirm).
// Google Play installs update themselves; this is only for the GitHub APK.

import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'

let running = null

/**
 * update: { version, url, apkUrl } from checkForAppUpdate().
 * onProgress(fraction 0–1). Resolves when the installer screen opens.
 */
export function downloadAndInstallUpdate(update, onProgress) {
  if (Platform.OS !== 'android') return Promise.reject(new Error('Updates on this device come from the app store.'))
  const url = update?.apkUrl || (/\.apk(\?|$)/i.test(update?.url || '') ? update.url : '')
  if (!url) return Promise.reject(new Error("This release doesn't have an APK yet. Try again in a few minutes."))
  if (running) return running
  running = (async () => {
    const path = `${FileSystem.cacheDirectory}BitBrowser-${String(update.version || 'update').replace(/[^\w.-]/g, '')}.apk`
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {})
    const task = FileSystem.createDownloadResumable(url, path, { headers: { Accept: 'application/octet-stream' } }, (p) => {
      if (p.totalBytesExpectedToWrite > 0) onProgress?.(p.totalBytesWritten / p.totalBytesExpectedToWrite)
    })
    const res = await task.downloadAsync()
    if (!res || (res.status && res.status >= 400)) throw new Error(`The download failed (${res?.status || 'no response'}).`)
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists || info.size < 1024 * 1024) throw new Error('The downloaded update looks incomplete. Try again.')
    onProgress?.(1)
    const data = await FileSystem.getContentUriAsync(path)
    // FLAG_GRANT_READ_URI_PERMISSION; Android shows "Do you want to update this app?"
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data, flags: 1, type: 'application/vnd.android.package-archive' })
  })().finally(() => {
    running = null
  })
  return running
}
