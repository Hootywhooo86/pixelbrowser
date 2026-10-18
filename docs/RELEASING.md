# Releasing Bit Browser

One tag builds everything: the Windows, Mac and Linux installers plus the
Android APK and Play Store bundle. They're published together as a
GitHub Release, and installed desktop apps update themselves from it.

## Make a release

```bash
node scripts/set-version.mjs 0.2.0      # same version on desktop + phone
git commit -am "Release v0.2.0"
git tag v0.2.0
git push --follow-tags
```

Then watch **Actions → Release** on GitHub. When it's done, the release page
has:

| File | For |
|---|---|
| `BitBrowser-Setup-0.2.0-x64.exe` (and `-arm64`) | Windows installer |
| `BitBrowser-0.2.0-universal.dmg` | Mac (Intel + Apple Silicon) |
| `BitBrowser-0.2.0-x86_64.AppImage`, `.deb` | Linux |
| `BitBrowser-0.2.0-android.apk` | Android, install directly |
| `BitBrowser-0.2.0-android.aab` | Upload to Google Play |
| `latest.yml`, `latest-mac.yml`, `latest-linux.yml` | Used by auto-update. Don't delete them. |

Or skip the tag: set the version, push to `main`, then go to **Actions → Release →
Run workflow** and tick **publish**. That creates the release and its tag for
you. Optional release notes go in `docs/release-notes/vX.Y.Z.md`.

To try a build without publishing anything, run the **Release** workflow by
hand (Actions → Release → Run workflow) and download the artifacts.

Build locally:
- **Desktop:** `cd apps/desktop && npm run dist` builds the installer for the OS you're on.
- **Android:** `cd apps/mobile && npx expo prebuild --platform android && cd android && ./gradlew assembleRelease`. This needs the Android SDK and JDK 17 or newer.

## How updates work

- **Desktop:** Bit Browser checks GitHub Releases when it starts and every
  4 hours. It downloads updates quietly, shows an orange **UPDATE** button
  when one is ready, and installs it on the next restart. Users can turn this
  off in Settings → Updates.
- **Android from GitHub (APK):** the app shows "Bit Browser X is out → GET IT",
  which opens the new APK. Android then asks the user to install it.
- **Android from Google Play:** Play updates the app. Upload the `.aab`.

The update check only asks GitHub for the newest version number.

## Secrets to add (GitHub → Settings → Secrets and variables → Actions)

Everything builds without these, but the builds are unsigned. Add them when you have them:

| Secret | What it is | Without it |
|---|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Your Android upload key, base64-encoded | APK is signed with a debug key, and Google Play rejects it |
| `ANDROID_UPLOAD_STORE_PASSWORD` | Keystore password | |
| `ANDROID_UPLOAD_KEY_ALIAS` | Key alias | |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Key password | |
| `MAC_CERT_P12_BASE64` | "Developer ID Application" certificate (.p12), base64 | Mac app is unsigned: users must right-click → Open, and **auto-update doesn't work on Mac** |
| `MAC_CERT_PASSWORD` | Password for that .p12 | |
| `APPLE_ID` | Apple ID email for notarization | macOS shows "can't check for malicious software" |
| `APPLE_APP_SPECIFIC_PASSWORD` | From appleid.apple.com → App-Specific Passwords | |
| `APPLE_TEAM_ID` | 10-character team ID from developer.apple.com | |
| `WIN_CERT_PFX_BASE64` | Windows code-signing certificate (.pfx), base64 | Windows SmartScreen warns "unknown publisher" |
| `WIN_CERT_PASSWORD` | Password for that .pfx | |

To base64 a file, run `base64 -w0 file` on Linux, or `base64 -i file` on a Mac.

### Make the Android upload key (once, keep it safe forever)

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore pixelbrowser-upload.keystore \
  -alias pixelbrowser -keyalg RSA -keysize 2048 -validity 10000
```

Back it up somewhere safe, like a password manager. Never commit it. If you
lose it, Google Play can reset it through Play App Signing, but that's slow.

## Google Play (first time)

1. Make a Google Play developer account ($25 once).
2. Create the app, with package `com.pixelbrowser.app`.
3. Turn on Play App Signing and upload the first `.aab` by hand.
4. Later releases: upload each new `.aab`. Or use `npx eas-cli@latest submit`, which `apps/mobile/eas.json` is already set up for.
