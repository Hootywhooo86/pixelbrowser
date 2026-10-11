# Pixelbrowser Desktop

Chromium (via Electron) running inside the pixel shell, with a Comet-style
AI sidebar. It supports Chrome Web Store extensions and blocks ads and
trackers out of the box.

```bash
npm install        # at the repo root
npm run desktop
```

- **AI** (Ctrl/Cmd+J) opens the Pixel AI sidebar. **ASK** asks about the current page,
  **AGENT** lets Pixel click, type and navigate for you. **+ TABS** chooses which tabs it can read.
- Type a question in the address bar (or press Shift+Enter) for a Comet-style answer:
  search results in the tab, an AI answer in the sidebar. Or right-click selected text → Ask Pixel AI.
- **APPS** opens ChatGPT, Claude, Gemini, Perplexity and other AI sites in the sidebar,
  signed in with your account. **SHARE PAGE** pastes the current page into them.
- **SET**: pick any AI (Claude, ChatGPT, Gemini, Grok, Mistral, DeepSeek, Groq, OpenRouter,
  Perplexity, Ollama, LM Studio or a custom URL), memory, and encrypted sync.

- **EXT** opens the Chrome Web Store. Click "Add to Chrome" to install an
  extension. Its icon then appears in the toolbar.
- **PVT** opens a private window: in-memory only, no extensions, purple theme.
- The orange badge counts ads and trackers blocked in the window.
- Shortcuts: Ctrl/Cmd+T new tab, Ctrl/Cmd+W close tab, Ctrl/Cmd+Shift+N
  private window, F12 devtools for the current tab.

Code map:
- `src/main.js`: windows, tabs, privacy, extensions, sidebar layout
- `src/ai-host.js`: AI settings and the driver the shared agent uses to reach tabs
- `src/sync-host.js`: encrypted sync of memory, history, open tabs and AI settings
- `src/store.js`: local data (API keys and the sync code are encrypted by the OS keychain)
- `src/ui/`: the pixel tab strip, toolbar and AI sidebar

The next steps are in [`docs/ROADMAP.md`](../../docs/ROADMAP.md).
