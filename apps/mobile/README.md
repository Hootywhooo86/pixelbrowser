# Pixelbrowser Mobile (iPhone + Android)

The pixel browser for phones, built with Expo. It runs the same AI
assistant, agent and encrypted sync code as the desktop app.

```bash
npm install          # at the repo root
cd apps/mobile
npx expo run:ios     # or: npx expo run:android  (needs Xcode / Android Studio)
```

The app uses native modules (camera, secure storage, WebView), so it needs a
development build rather than Expo Go. To build in the cloud without Xcode:
`npx eas-cli@latest build --profile development`.

- The **AI slider** in the top bar turns all AI off for private browsing.
- **AI** opens the Pixel AI panel. You can still watch the page above it while the agent works.
- Type a question in the address bar for a Comet-style answer.
- **SET**: choose your search engine, any AI and add its key, memory, and sync (scan the QR code shown by the desktop app).
- **Tabs** (the number button): your tabs, private tabs, and tabs open on your other devices.

`npm run bundle` builds the iOS and Android JavaScript bundles, which is a quick way to check for errors.

Release builds (signed APK + Play Store bundle) are made on GitHub when you push a version tag.
See [`docs/RELEASING.md`](../../docs/RELEASING.md).
