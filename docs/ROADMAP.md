# Bit Browser roadmap

**Goal:** a Comet-style AI browser that's private like Brave, pixel-branded,
on desktop and phone, with everything synced between your devices.

## What's built

| Area | Desktop (Win/Mac/Linux) | Phone (iOS/Android) |
|---|---|---|
| Engine | Chromium via Electron | WKWebView / Android WebView via Expo |
| Pixel shell, tabs, private tabs | ✅ | ✅ |
| Chrome extensions | ✅ Chrome Web Store | ❌ (see below) |
| Ad and tracker blocking (Bit Shields) | ✅ uBlock/EasyList lists, YouTube | ✅ native blocking on Android, page-level on iPhone |
| AI sidebar/panel: ask about the page | ✅ | ✅ |
| Ask across several tabs | ✅ | ✅ |
| AI answers from the address bar | ✅ | ✅ |
| Agent mode (clicks, types, navigates) | ✅ real mouse and keyboard events | ✅ in-page events, "Let Bitter take over" with a STOP button |
| Full-screen video | ✅ | ✅ turns sideways |
| Default browser | ✅ | ✅ Android |
| Password manager | ❌ not yet | ✅ |
| Any AI: Claude, ChatGPT, Gemini, Grok, Mistral, DeepSeek, Groq, OpenRouter, Perplexity, Ollama, LM Studio, custom | ✅ | ✅ |
| AI web apps in the sidebar (ChatGPT, Claude, Gemini, Perplexity, Copilot, Grok…) + Share Page | ✅ | ✅ |
| Search engine choice (DuckDuckGo, Brave, Startpage, Mojeek, Qwant, Kagi, Ecosia, Google, Bing, custom) | ✅ Settings window | ✅ Settings |
| Memory | ✅ | ✅ |
| Encrypted sync (memory, history, open tabs, AI settings, optional keys) | ✅ shows QR code | ✅ scans QR code |

## How it fits together

```
apps/desktop      Electron app (main.js, ai-host.js, sync-host.js, ui/)
apps/mobile       Expo app (App.js, src/)
packages/ai-core  Shared assistant: providers, agent loop, page scripts, safety
packages/sync-core  Shared sync: 24-word codes, encryption, merge, syncOnce()
packages/sync-server  Zero-knowledge server for the encrypted blobs
```

**Any AI.** Claude goes through the official Anthropic SDK. Every other
provider uses the OpenAI-compatible chat API, which almost all of them
offer. Users bring their own key, or run a local model with Ollama or
LM Studio so nothing leaves their computer. No key at all? The AI apps
panel opens ChatGPT, Claude, Gemini and others with the user's own account.

**Privacy rules for the AI**
- An **AI slider** in the toolbar (desktop) and top bar (phone) turns all AI off. When it's off, nothing is sent to any AI, a running agent stops, AI apps close, and searches use DuckDuckGo's no-AI site. It's a per-device setting and is never synced.
- The AI reads a page only when you ask. It's off in private windows and tabs.
- Banking, health, password and login pages need your OK before the AI reads them.
- Agent mode asks before buying, paying, sending, posting, deleting, logging in or typing secrets.
- Web content goes to the model marked as untrusted data, and the model is told never to follow instructions found in pages. This is the defense against prompt injection, the main way AI browsers get attacked.

**Sync.** The first device makes a 24-word sync code. Other devices join by
scanning its QR code or typing the words. Everything is encrypted on the
device (XChaCha20-Poly1305) before upload, and the server only stores
blobs it can't read.

## What's left to add

### Must-do before anyone else uses it
- [x] **Installers.** `electron-builder` makes .exe, .dmg, .AppImage and .deb files, and the Android build makes an .apk and .aab. A `v*` tag builds all of them (see [RELEASING.md](RELEASING.md)).
- [x] **Auto-update.** Desktop updates itself from GitHub Releases. Android APK users get an update notice.
- [ ] **Code signing.** The hooks are ready. Add an Apple Developer ID, a Windows certificate and an Android upload key as GitHub secrets.
- [ ] **Host the sync server** behind HTTPS and make it the default address.
- [ ] **Real-world testing.** Run the phone app on real iPhones and Android phones, and try each AI provider with real keys.
- [x] **App icon and splash screen** (`scripts/make-icons.py`).
- [ ] **Store screenshots and feature graphics.**
- [ ] **License decision.** GPL-3.0 open source, or buy the `electron-chrome-extensions` commercial license.
- [ ] **Privacy policy and store listings.** Say what goes to the AI the user picks, and that sync is end-to-end encrypted.

### Everyday browser basics (people expect these)
- [ ] Bookmarks and a bookmarks bar (synced)
- [ ] History page with search
- [x] Downloads manager (phone: Menu → Downloads)
- [ ] Reopen tabs after restart (session restore) and reopen closed tab (Ctrl+Shift+T)
- [ ] Find in page, zoom, print
- [ ] Site permission prompts (camera, mic, location, notifications are currently always denied)
- [x] Passwords: Bit Password Manager on the phone (encrypted, biometric unlock, optional E2E sync). Desktop still to do.
- [ ] Pixel new-tab page (shortcuts, synced tabs, search box)
- [ ] Pinned tabs and tab groups (tab search and a Brave-style tab grid are done on the phone)
- [ ] Reader mode

### Privacy and security
- [ ] HTTPS-only mode, fingerprinting protection, and blocking third-party cookies by default on desktop
- [x] Ad and tracker blocking on the phone (Android request filtering; iPhone page-level. Full iOS content rules still to do)
- [ ] A per-site "never let AI read this site" list
- [ ] An outside security review of the agent and the sync code before launch
- [ ] Opt-in crash reports

### Phone
- [ ] Android extensions through GeckoView (uBlock Origin, Dark Reader…)
- [x] Downloads and file sharing
- [ ] Share sheet: "Ask Bitter about this link" from other apps

### AI polish
- [ ] Streaming answers (text appears as it's written)
- [ ] Voice input
- [ ] Show which model answered and roughly what it cost
- [ ] Saved agent tasks ("every morning, check these 3 sites")

### 128bit family
- [x] XP, levels, streaks and badges on device (quests need a 128bit server)
- [x] Pixel themes and tab-bar skins (paid skins later)

## Things to know

- **License:** `electron-chrome-extensions` is GPL-3.0 unless you buy its commercial license. Open-source Bit Browser under GPL-3.0, or buy the license before shipping closed-source.
- **Security updates:** a browser has to ship Chromium updates quickly, so bump Electron on every stable release.
- **App stores:** Apple requires WebKit (alternative engines only in the EU). The phone app's AI uses the user's own keys, so there's no AI bill for you, but say clearly in the listing which data goes to the AI the user picks.
- **Costs:** an Apple Developer account ($99/yr), Google Play ($25 once), a Windows signing certificate, and a small server for sync.
