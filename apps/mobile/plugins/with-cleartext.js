// Expo config plugin: lets the browser open plain http:// sites.
//
// Android blocks unencrypted (http://) page loads in apps by default
// (net::ERR_CLEARTEXT_NOT_PERMITTED). A browser has to be able to open them,
// like Chrome and Brave do; the address bar marks them "not secure".

const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withCleartext(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0]
    if (app) app.$['android:usesCleartextTraffic'] = 'true'
    return cfg
  })
}
