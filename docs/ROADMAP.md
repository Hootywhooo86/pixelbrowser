# Pixelbrowser roadmap

**Goal:** a Comet-style AI browser that's private like Brave, pixel-branded,
on desktop and phone, with everything synced between your devices.

## What's built

| Area | Desktop (Win/Mac/Linux) | Phone (iOS/Android) |
|---|---|---|
| Engine | Chromium via Electron | WKWebView / Android WebView via Expo |
| Pixel shell, tabs, private tabs | ✅ | ✅ |
| Chrome extensions | ✅ Chrome Web Store | ❌ (see below) |
| Ad and tracker blocking | ✅ Ghostery filter lists | ❌ not yet |
| AI sidebar/panel: ask about the page | ✅ | ✅ |
| Ask across several tabs | ✅ | ✅ |
| AI answers from the address bar | ✅ | ✅ |
| Agent mode (clicks, types, navigates) | ✅ real mouse and keyboard events | ✅ in-page events |
| Any AI: Claude, ChatGPT, Gemini, Grok, Mistral, DeepSeek, Groq, OpenRouter, Perplexity, Ollama, LM Studio, custom | ✅ | ✅ |
| AI web apps in the sidebar (ChatGPT, Claude, Gemini, Perplexity, Copilot, Grok…) + Share Page | ✅ | ✅ |
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

## Next steps

1. **Host a sync server.** Run `packages/sync-server` behind HTTPS (Fly.io, Render, or a small VPS) and make it the default address.
2. **Phone privacy.** Content blockers: iOS WKContentRuleList and Android request filtering through a small native module.
3. **Phone extensions.** Switch Android to GeckoView for real WebExtensions (uBlock Origin, Dark Reader…). iOS can't run them, so offer built-in "pixel packs" instead.
4. **Desktop essentials.** Bookmarks, a history page, downloads, session restore, site permission prompts.
5. **Streaming answers** (show text as it's written) and voice input.
6. **Release.** Auto-update (`electron-updater`), code signing, EAS builds, and App Store and Play Store listings.
7. **128bit tie-in.** XP and streak events (see the README).

## Things to know

- **License:** `electron-chrome-extensions` is GPL-3.0 unless you buy its commercial license. Open-source Pixelbrowser under GPL-3.0, or buy the license before shipping closed-source.
- **Security updates:** a browser has to ship Chromium updates quickly, so bump Electron on every stable release.
- **App stores:** Apple requires WebKit (alternative engines only in the EU). The phone app's AI uses the user's own keys, so there's no AI bill for you, but say clearly in the listing which data goes to the AI the user picks.
- **Costs:** an Apple Developer account ($99/yr), Google Play ($25 once), a Windows signing certificate, and a small server for sync.
