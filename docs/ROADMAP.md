# Pixelbrowser roadmap: phone + computer, extensions, private sync

The goal: one pixel-branded browser on desktop and phone, with extensions,
where everything syncs between your devices but stays private.
**Brave is the model:** a real engine with our own shell, blocking built in,
and end-to-end encrypted sync.

## The big decisions

### 1. Don't write an engine. Wrap one.

Nobody builds a rendering engine from scratch (Brave, Edge, Arc, Vivaldi and
Opera all use Chromium). We build the **shell**: the pixel UI, tabs,
privacy, sync and gamification. The engine does the HTML, CSS and JS.

| Platform | Engine | Extensions | Why |
|---|---|---|---|
| **Windows / macOS / Linux** | Chromium via **Electron** | Chrome Web Store (most MV3 extensions) via `electron-chrome-extensions` | Ships in weeks, not years. Same JS codebase on all 3 OSes. |
| **Android** | **GeckoView** (Firefox's engine as a library) | Real WebExtensions (uBlock Origin, Dark Reader, Bitwarden…) | The only embeddable mobile engine with full extension support. Chromium WebView has none. |
| **iOS** | **WKWebView** (Apple requires WebKit) | Our own "pixel packs": content scripts + CSS we inject | Apple doesn't let third-party browsers run Chrome or Firefox extensions. |

**Later, if we outgrow Electron:** fork Chromium itself, the way Brave does.
That gives full extension support and total control, but it needs a
dedicated team, 100+ GB builds and weekly security rebases. Don't start
there.

### 2. Private sync means end-to-end encrypted

"Saves all data" and "private" only fit together if **our server can't read
the data**:

```
device A ──encrypt──▶ [ ciphertext blobs ] ◀──decrypt── device B
   ▲                    sync server (dumb)                  ▲
   └──────── same key, shared by QR code / sync phrase ─────┘
```

- On the first device, generate a random key and show it as a **sync
  code** (24 words + QR code). No email or password needed, like Brave
  Sync.
- To add a phone, scan the QR code. The key never touches the server.
- Encrypt every record on the device (libsodium `secretbox` / XChaCha20-Poly1305)
  before upload. The server stores `{deviceId, collection, id, version, ciphertext}`
  and nothing else.
- Collections: `bookmarks`, `history`, `tabs` (open tabs on other devices),
  `readlater`, `settings`, `extensions` (list only), `passwords` (later,
  with an extra key).
- Merging: last-writer-wins per record with version clocks. Start simple.
- Backend: anything that stores blobs (a small Supabase table + row-level
  security works). Sync is **opt-in**; the browser works fully offline.

### 3. One brand, shared code

```
apps/
  desktop/        Electron app            ← started
  android/        Kotlin + GeckoView
  ios/            Swift + WKWebView
packages/
  sync-core/      Encryption + record format + merge (TypeScript; reused
                  on mobile via a small Kotlin/Swift port or a Rust core later)
  design/         Pixel tokens: colors, font, icons, tab/button specs
  blocklists/     Filter-list config shared by all platforms
```

The pixel look comes from `packages/design`: the same palette as the
landing page, the Press Start 2P font, chunky 3px borders, and hard drop
shadows.

## Build order

1. **Desktop MVP** ✅ (started): tabs, address bar, back/forward/reload,
   Chrome Web Store extensions + toolbar icons, built-in ad/tracker
   blocking with a counter, DNT + GPC headers, private windows (in-memory,
   no extensions).
2. **Desktop essentials:** bookmarks, history page, downloads, session
   restore, permission prompts, a settings page, find-in-page, a pixel
   new-tab page.
3. **sync-core:** key generation, sync code + QR, encrypt/decrypt, and a
   test suite. Then a tiny sync server.
4. **Desktop sync:** bookmarks → history → open tabs → read-later.
5. **Android app** (GeckoView): same pixel shell in Kotlin, extensions,
   sync via QR pairing.
6. **iOS app** (WKWebView): pixel shell, content blockers, pixel packs,
   sync.
7. **Polish + 128bit tie-in:** reader mode, XP/streak events (see
   README), themes, auto-update, code signing, store listings.

## Things to know up front

- **License:** `electron-chrome-extensions` is GPL-3.0 unless you buy its
  commercial (Patron) license. Either open-source Pixelbrowser under
  GPL-3.0 (Brave itself is MPL, so open source is normal for browsers) or
  buy the license before shipping closed-source.
- **Security updates:** a browser must ship Chromium updates fast. Plan for
  auto-update (`electron-updater`) from day one and bump Electron on every
  stable release.
- **Store rules:** Apple requires WebKit (alternative engines are allowed
  only in the EU). Google Play is fine with GeckoView.
- **Signing:** you'll need an Apple Developer account ($99/yr) and ideally
  a Windows code-signing certificate before public release.
