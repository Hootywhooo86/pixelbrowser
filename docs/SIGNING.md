# Code signing: stop the "unknown app" warnings

Bit Browser builds and runs without signing, but:

- **Windows** shows "Windows protected your PC" (SmartScreen).
- **Mac** says it "can't check the app for malicious software", needs right-click → Open the first time, and **can't auto-update**.
- **Android** APKs are signed with a test key, and **Google Play won't accept** them.

Each platform needs its own certificate. You get them once (Apple and Windows certificates are renewed yearly) and add them as **GitHub secrets**. The Release workflow (`.github/workflows/release.yml`) uses each one automatically as soon as it's set. Nothing else changes.

Add secrets at **GitHub → Hootywhooo86/pixelbrowser → Settings → Secrets and variables → Actions → New repository secret**.

To turn a file into the base64 text a secret needs: `base64 -w0 file` (Linux), `base64 -i file` (Mac), or in PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes("file"))`.

## Costs at a glance

| What | Cost | Needed for |
|---|---|---|
| Android upload key | Free | Google Play, trusted updates |
| Google Play developer account | $25 once | Publishing on Google Play |
| Apple Developer Program | $99 / year | Mac signing and notarization, iPhone App Store |
| Windows: Azure Trusted Signing | about $10 / month | Signing Windows installers (cheapest modern option) |
| Windows: OV certificate | about $200–400 / year, plus a hardware token or cloud key | Alternative |
| Windows: EV certificate | about $300–600 / year | Alternative; used to skip SmartScreen right away |

## 1. Android (free)

1. Make the upload key once, following **[RELEASING.md → Make the Android upload key](RELEASING.md#make-the-android-upload-key-once-keep-it-safe-forever)**. Back it up somewhere safe (a password manager). If you lose it, Google can reset it, but it's slow.
2. Add these secrets:

   | Secret | Value |
   |---|---|
   | `ANDROID_UPLOAD_KEYSTORE_BASE64` | the `.keystore` file, base64 |
   | `ANDROID_UPLOAD_STORE_PASSWORD` | the keystore password |
   | `ANDROID_UPLOAD_KEY_ALIAS` | the alias (`pixelbrowser` if you used the command as written) |
   | `ANDROID_UPLOAD_KEY_PASSWORD` | the key password |

3. Turn on **Play App Signing** when you create the app in Play Console (it's the default).

**One-time effect:** APKs from earlier releases were signed with a different (test) key, so Android won't install the new one over the old one. Uninstall the old app once (your synced data comes back through sync), then install the new one. Updates after that install normally.

## 2. Mac ($99/year)

1. Join the **Apple Developer Program** at <https://developer.apple.com/programs/> (individual or organization; an organization needs a D-U-N-S number).
2. On a Mac, open **Xcode → Settings → Accounts**, add your Apple ID, then **Manage Certificates → + → Developer ID Application**. (Or create it at developer.apple.com → Certificates.)
3. In **Keychain Access**, find "Developer ID Application: …", right-click → **Export** as a `.p12` with a password.
4. Make an **app-specific password** at <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords (used for notarization).
5. Find your **Team ID** at developer.apple.com → Membership (10 characters).
6. Add these secrets:

   | Secret | Value |
   |---|---|
   | `MAC_CERT_P12_BASE64` | the `.p12`, base64 |
   | `MAC_CERT_PASSWORD` | the `.p12` export password |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | your Team ID |

The next release is signed and notarized, and **Mac auto-update starts working**.

## 3. Windows

### Recommended: Azure Trusted Signing (about $10/month)

Microsoft's own signing service. No hardware token, and it's trusted by SmartScreen.

1. Create an Azure account and a **Trusted Signing account** (Azure portal → "Trusted Signing Accounts").
2. Complete **identity validation** (individual or organization). This takes a few days.
3. Create a **certificate profile** (Public Trust).
4. Create an app registration (service principal) with the "Trusted Signing Certificate Profile Signer" role, and note its tenant ID, client ID and client secret.

**This needs a small workflow change:** the release workflow currently expects a `.pfx` certificate (below). electron-builder 26 supports Azure Trusted Signing through `win.azureSignOptions` in `apps/desktop/electron-builder.yml` (endpoint, account name, certificate profile name) plus the `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` environment variables. Ask for this to be wired up once your account is validated.

### Alternative: a certificate file (.pfx)

1. Buy an **OV** or **EV** code-signing certificate from a certificate authority (Sectigo, DigiCert, SSL.com…).
   - **OV** is cheaper. SmartScreen warnings fade as more people install the app.
   - **EV** costs more and gains SmartScreen trust faster.
   - Since 2023, new certificates come on a hardware token or in a cloud signing service. A plain `.pfx` file is only possible with a provider that offers cloud keys exportable for CI, so check this before you buy. Otherwise use Azure Trusted Signing.
2. If you have a `.pfx`, add these secrets:

   | Secret | Value |
   |---|---|
   | `WIN_CERT_PFX_BASE64` | the `.pfx`, base64 |
   | `WIN_CERT_PASSWORD` | its password |

## 4. iPhone (later)

The same Apple Developer membership covers the App Store. The iPhone build uses EAS (`npx eas-cli@latest build --platform ios`), which creates and stores the iOS certificates for you. See `apps/mobile/eas.json` and `docs/store-listing.md`.

## Check it worked

After the next release:

- **Windows:** right-click the installer → Properties → Digital Signatures shows your name.
- **Mac:** `spctl -a -vv "/Applications/Bit Browser.app"` says "accepted, source=Notarized Developer ID".
- **Android:** `apksigner verify --print-certs BitBrowser-x.y.z-android.apk` shows your certificate, not "Android Debug".
