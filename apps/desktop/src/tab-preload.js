// Runs at the start of every web page and frame (registered on each session
// in v05.js). Asks the app which privacy scripts this site gets — the
// fingerprinting protection must run before the page's own scripts — and
// runs them in the page. Nothing is exposed to the page.
const { ipcRenderer, webFrame } = require('electron')

try {
  if (/^https?:/.test(location.href)) {
    const cfg = ipcRenderer.sendSync('bit:page-config', location.href)
    if (cfg?.fingerprint) webFrame.executeJavaScript(cfg.fingerprint)
    if (cfg?.autoconsent) webFrame.executeJavaScript(cfg.autoconsent)
  }
} catch {}
