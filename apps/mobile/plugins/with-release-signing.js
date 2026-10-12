// Expo config plugin: sign Android release builds with your upload key.
// The key never lives in the repo. Point these environment variables at it
// (CI decodes it from GitHub secrets, see docs/RELEASING.md):
//   PIXEL_UPLOAD_STORE_FILE, PIXEL_UPLOAD_STORE_PASSWORD,
//   PIXEL_UPLOAD_KEY_ALIAS, PIXEL_UPLOAD_KEY_PASSWORD
// Without them, release builds fall back to the debug key (fine for testing,
// not accepted by Google Play).
const { withAppBuildGradle } = require('expo/config-plugins')

const MARK = '// pixelbrowser-release-signing'

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents
    if (gradle.includes(MARK)) return cfg

    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        ${MARK}
        release {
            if (System.getenv("PIXEL_UPLOAD_STORE_FILE")) {
                storeFile file(System.getenv("PIXEL_UPLOAD_STORE_FILE"))
                storePassword System.getenv("PIXEL_UPLOAD_STORE_PASSWORD")
                keyAlias System.getenv("PIXEL_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("PIXEL_UPLOAD_KEY_PASSWORD")
            }
        }`
    )
    // In buildTypes.release, use the upload key when it's configured.
    const types = gradle.indexOf('buildTypes {')
    const rel = types === -1 ? -1 : gradle.indexOf('release {', types)
    const line = rel === -1 ? -1 : gradle.indexOf('signingConfig signingConfigs.debug', rel)
    if (line !== -1) {
      gradle =
        gradle.slice(0, line) +
        'signingConfig System.getenv("PIXEL_UPLOAD_STORE_FILE") ? signingConfigs.release : signingConfigs.debug' +
        gradle.slice(line + 'signingConfig signingConfigs.debug'.length)
    }
    cfg.modResults.contents = gradle
    return cfg
  })
}
