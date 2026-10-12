#!/usr/bin/env node
// Set one version number everywhere before a release:
//   node scripts/set-version.mjs 0.2.0
// Updates the desktop and mobile package.json files and the mobile app.json
// (version, Android versionCode, iOS buildNumber). Then commit, tag v0.2.0
// and push the tag to build installers (see docs/RELEASING.md).
import fs from 'node:fs'
import path from 'node:path'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node scripts/set-version.mjs <major.minor.patch>   e.g. 0.2.0')
  process.exit(1)
}
const [major, minor, patch] = version.split('.').map(Number)
if (minor > 99 || patch > 99) {
  console.error('Keep minor and patch under 100 so the Android versionCode keeps increasing.')
  process.exit(1)
}
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname))
const edit = (rel, fn) => {
  const file = path.join(root, rel)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  fn(data)
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  console.log('updated', rel)
}

edit('apps/desktop/package.json', (p) => (p.version = version))
edit('apps/mobile/package.json', (p) => (p.version = version))
edit('apps/mobile/app.json', (a) => {
  a.expo.version = version
  // Must go up with every Play Store upload: 0.2.0 -> 200, 1.4.12 -> 10412.
  a.expo.android.versionCode = major * 10000 + minor * 100 + patch
  a.expo.ios.buildNumber = String(a.expo.android.versionCode)
})
console.log(`\nNext: git commit -am "Release v${version}" && git tag v${version} && git push --follow-tags`)
