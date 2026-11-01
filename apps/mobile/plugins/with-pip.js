// Expo config plugin: picture-in-picture for full-screen videos on Android.
//
// Lets MainActivity shrink into a floating window (BitMedia.enterPip /
// setAutoPip in modules/bit-shields) without restarting when it resizes.

const { withAndroidManifest } = require('expo/config-plugins')

const NEEDED = ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation']

module.exports = function withPip(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0]
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity')
    if (main) {
      main.$['android:supportsPictureInPicture'] = 'true'
      main.$['android:resizeableActivity'] = 'true'
      const have = String(main.$['android:configChanges'] || '').split('|').filter(Boolean)
      main.$['android:configChanges'] = [...new Set([...have, ...NEEDED])].join('|')
    }
    return cfg
  })
}
