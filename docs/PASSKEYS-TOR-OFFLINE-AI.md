# Passkeys, Tor and offline AI: what's possible in Bit Browser

These notes come from what I know about these platform APIs as of late 2026. I wrote them without testing on a device, so check each item against current docs before building on it.

## Offline AI (a model running on the phone)

**Shipped in 0.5:** "AI on my computer over Wi-Fi" (`apps/mobile/src/offline-ai.js`, `OfflineAIForm`). Bitter uses Ollama or LM Studio on the user's own computer through their OpenAI-compatible `/v1` API. It's private, free and fast on any phone, and works because plain-http local addresses are allowed since 0.4.2. Setup:
- **Ollama:** set `OLLAMA_HOST=0.0.0.0` on the computer so other devices can reach it.
- **LM Studio:** turn on "Serve on Local Network".

**A model on the phone itself.** Options:

| Option | What it is | Fit for Bit Browser |
|---|---|---|
| `llama.rn` (llama.cpp bindings for React Native) | Runs GGUF models (e.g. Llama 3.2 1B/3B, Qwen2.5 1.5B, Gemma 3 1B) on CPU/GPU | Most mature for Expo/RN, and works with a config plugin and a dev build. Models are 0.7–2 GB and usable on phones with 6 GB+ RAM. |
| MLC LLM (`mlc-llm` React Native / Android SDK) | Compiles models for the phone's GPU (Vulkan/OpenCL/Metal) | Fast, but a heavy native build and per-model compilation. |
| ExecuTorch (`react-native-executorch`) | PyTorch's on-device runtime | Llama 3.2 1B/3B are supported. Newer, and has a good RN wrapper. |
| Android AICore / Gemini Nano | Google's system model on recent Pixels and Samsung phones | Tiny API surface, only on some phones, and access is through the ML Kit GenAI APIs. |

**Recommendation for a later release:**
- Add `llama.rn` behind a "Download offline model (≈1 GB)" button.
- Ship Qwen2.5-1.5B-Instruct Q4 or Llama-3.2-1B-Instruct Q4 for summaries and translations only. Leave the agent on the computer or cloud models, since small models can't drive tool use reliably.
- Download over Wi-Fi only, into app storage.
- Register it as a provider kind `local` in `packages/ai-core/src/providers.js`.

It needs a custom dev build (native code, which we already have), and it adds about 5–10 MB to the APK before the model itself.

## Passkeys (WebAuthn) in the phone app

- **Android WebView:** WebAuthn in WebView arrived through `androidx.webkit` as `WebSettingsCompat.setWebAuthenticationSupport(settings, WEB_AUTHENTICATION_SUPPORT_FOR_APP)` (feature flag `WebViewFeature.WEB_AUTHENTICATION`). It needs:
  - a recent Android System WebView
  - Google Play services' Credential Manager
  - the app's package and certificate listed in the site's Digital Asset Links, or the browser-style mode `WEB_AUTHENTICATION_SUPPORT_FOR_BROWSER`, which is only available to apps that hold the browser role and are allow-listed.

  So a third-party browser can turn it on, but sites only accept it when Android recognises Bit Browser as a browser. Implement the call in `modules/bit-shields` (`onWebViewCreated`), guarded by `WebViewFeature.isFeatureSupported`, and test it on a real phone with webauthn.io.
- **When it doesn't work:** sites fall back to password or one-time code sign-in, and Bit Browser's password manager and 2FA codes cover that.
- **iOS WKWebView:** passkeys work in WKWebView only for the app's own associated domains, not arbitrary sites. A general-purpose browser needs Apple's browser entitlement (`com.apple.developer.web-browser`).
- **Desktop (Electron/Chromium):** WebAuthn goes through the operating system:
  - Windows Hello on Windows
  - security keys and Touch ID on macOS, with some limitations in Electron
  - security keys on Linux

## Private tabs over Tor

- **Embedding Tor:**
  - `tor-android` (Guardian Project) or Arti (Tor's Rust implementation, with mobile bindings in progress) can run a Tor client inside the app as a local SOCKS proxy.
  - That's about 10–20 MB of native libraries plus a background service, and Tor Project guidance warns that a WebView over Tor still leaks fingerprinting data. Tor Browser hardens far more than a proxy does.
- **Routing WebView traffic:**
  - `androidx.webkit.ProxyController.setProxyOverride()` (feature `PROXY_OVERRIDE`) sends all WebView traffic in the app through a proxy, for example Orbot's SOCKS port 9050 or HTTP port 8118. It applies app-wide, not per tab.
  - "Tor for private tabs only" therefore needs either per-profile proxying (not available in WebView), or switching the override while only private tabs are open.
- **Practical plan:**
  1. "Use Orbot" mode: detect Orbot (`org.torproject.android`), ask it to start, and set `ProxyController` to `socks://127.0.0.1:9050` while the user turns on "Private browsing over Tor". All tabs go through Tor during that time, and the address bar shows it.
  2. Desktop: point the private session at a Tor SOCKS proxy with `session.setProxy({ proxyRules: 'socks5://127.0.0.1:9050' })`. The user runs Tor Browser or the tor service, or a bundled tor binary from the Tor Expert Bundle is added later.
- Always tell users that for real anonymity they should use Tor Browser.
