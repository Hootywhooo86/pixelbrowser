# Pixelbrowser Desktop

Chromium (via Electron) running inside the pixel shell. It supports Chrome Web Store
extensions and blocks ads and trackers out of the box.

```bash
cd apps/desktop
npm install
npm start
```

- **EXT** opens the Chrome Web Store. Click "Add to Chrome" to install an
  extension. Its icon then appears in the toolbar.
- **PVT** opens a private window: in-memory only, no extensions, purple theme.
- The orange badge counts ads and trackers blocked in the window.
- Shortcuts: Ctrl/Cmd+T new tab, Ctrl/Cmd+W close tab, Ctrl/Cmd+Shift+N
  private window, F12 devtools for the current tab.

Code map:
- `src/main.js`: windows, tabs, privacy, extensions
- `src/preload.js`: bridge between the shell UI and the main process
- `src/ui/`: the pixel tab strip and toolbar

The next steps are in [`docs/ROADMAP.md`](../../docs/ROADMAP.md).
