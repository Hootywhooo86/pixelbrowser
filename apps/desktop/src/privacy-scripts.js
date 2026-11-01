// Page scripts for 0.5 privacy: cookie banners answered "no" (autoconsent)
// and fingerprinting protection (farbling). Ported from the phone app
// (apps/mobile/src/autoconsent.js, fingerprint.js); keep them in step.
// On the computer the page reports back through console messages that
// main.js reads, since tabs have no ReactNativeWebView bridge.

const AUTOCONSENT_JS = String.raw`(function(){
  if (window.__bitConsent) return; window.__bitConsent = true;
  var done = false, started = Date.now();
  function post(cmp, action){
    if (done) return; done = true;
    try { console.log('__bitConsent:' + JSON.stringify({ cmp: cmp, action: action })) } catch (e) {}
  }
  function vis(el){
    if (!el || !el.isConnected) return false;
    var st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function q(sel, root){ try { return (root || document).querySelector(sel) } catch (e) { return null } }
  function qa(sel, root){ try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) } catch (e) { return [] } }
  function firstVisible(sel, root){ var all = qa(sel, root); for (var i = 0; i < all.length; i++) if (vis(all[i])) return all[i]; return null }
  function click(el){ try { el.click(); return true } catch (e) { return false } }
  function hide(sel){
    qa(sel).forEach(function(el){ el.style.setProperty('display', 'none', 'important') });
    [document.documentElement, document.body].forEach(function(el){
      if (!el) return;
      el.style.removeProperty('overflow');
      if (getComputedStyle(el).overflow === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
      el.classList.remove('ot-sdk-show-settings', 'didomi-popup-open', 'qc-cmp-showing', 'cmplz-blocked', 'sp-message-open');
    });
  }
  function uncheckAll(root){
    qa('input[type=checkbox]:checked', root).forEach(function(cb){ if (!cb.disabled) click(cb) });
    qa('[role=switch][aria-checked=true],[role=checkbox][aria-checked=true]', root).forEach(function(sw){ if (sw.getAttribute('aria-disabled') !== 'true') click(sw) });
  }

  // Reject wording in English, French, German, Spanish, Italian, Dutch,
  // Portuguese, Polish, Swedish, Danish/Norwegian, Finnish.
  var REJECT = /^\s*(reject|decline|deny|refuse|disagree)(\s+(all|cookies|all cookies|optional cookies|non-essential( cookies)?|additional cookies))?\s*$|^\s*(i\s+)?do\s+not\s+(agree|accept)\s*$|(only|just)\s+(use\s+)?(necessary|essential|required|strictly necessary)(\s+cookies)?|^\s*(necessary|essential|required)\s+(cookies\s+)?only\s*$|continue\s+without\s+(accepting|agreeing|consent)|^\s*no,?\s+thanks?\s*$|tout\s+refuser|^\s*refuser|continuer\s+sans\s+accepter|alle\s+ablehnen|^\s*ablehnen|nur\s+(notwendige|erforderliche|essenzielle)|rechazar(\s+todo|\s+todas)?|solo\s+(necesarias|esenciales)|rifiuta(\s+tutto|\s+tutti)?|solo\s+necessari|alles\s+weigeren|^\s*weigeren|alleen\s+noodzakelijke|recusar(\s+tudo|\s+todos)?|apenas\s+(necessários|essenciais)|odrzuć(\s+wszystkie)?|tylko\s+niezbędne|avvisa(\s+alla)?|endast\s+nödvändiga|afvis(\s+alle)?|kun\s+nødvendige|avvis(\s+alle)?|hylkää(\s+kaikki)?/i;
  var SAVE = /^\s*(save|confirm|submit)(\s+(my\s+)?(choices|preferences|settings|selection))?\s*$|enregistrer|speichern|guardar|salva|opslaan|salvar|zapisz|spara|gem\s|tallenna/i;
  var ACCEPT = /accept|agree|allow|got\s*it|ok(ay)?\b|akzeptieren|zustimmen|accepter|aceptar|accetta|akkoord|aceitar|akceptuj|godkänn|tillad|hyväksy/i;
  function label(el){ return ((el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '') + '').replace(/\s+/g, ' ').trim() }
  function buttons(root){ return qa('button,[role=button],input[type=button],input[type=submit],a[role=button],a.button,a[class*=btn],a[class*=button]', root).filter(vis) }
  function findReject(root){
    var list = buttons(root);
    for (var i = 0; i < list.length; i++) {
      var t = label(list[i]);
      if (t && t.length < 60 && REJECT.test(t) && !/accept\s+all/i.test(t)) return list[i];
    }
    return null;
  }

  var RULES = [
    { cmp: 'onetrust', detect: '#onetrust-banner-sdk,#onetrust-consent-sdk #onetrust-pc-sdk', reject: '#onetrust-reject-all-handler,.ot-pc-refuse-all-handler,#onetrust-pc-sdk .ot-pc-refuse-all-handler',
      settings: '#onetrust-pc-btn-handler,.ot-sdk-show-settings', panel: '#onetrust-pc-sdk', save: '.save-preference-btn-handler,#accept-recommended-btn-handler.save-preference-btn-handler', hide: '#onetrust-consent-sdk,.onetrust-pc-dark-filter' },
    { cmp: 'cookiebot', detect: '#CybotCookiebotDialog', reject: '#CybotCookiebotDialogBodyButtonDecline,#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
      api: function(){ if (window.Cookiebot && window.Cookiebot.dialog && typeof window.Cookiebot.dialog.submitDecline === 'function') { window.Cookiebot.dialog.submitDecline(); return true } },
      panel: '#CybotCookiebotDialog', save: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection,#CybotCookiebotDialogBodyButtonAcceptSelected', hide: '#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay' },
    { cmp: 'didomi', detect: '#didomi-host,#didomi-notice,#didomi-popup', reject: '#didomi-notice-disagree-button,.didomi-continue-without-agreeing,#didomi-popup .didomi-components-button--color-secondary',
      api: function(){ if (window.Didomi && typeof window.Didomi.setUserDisagreeToAll === 'function') { window.Didomi.setUserDisagreeToAll(); return true } },
      hide: '#didomi-host,.didomi-popup-backdrop' },
    { cmp: 'quantcast', detect: '.qc-cmp2-container,#qc-cmp2-ui', reject: '.qc-cmp2-summary-buttons button[mode=secondary],#qc-cmp2-ui button[mode=secondary]',
      settings: '.qc-cmp2-summary-buttons button[mode=link]', panel: '#qc-cmp2-ui', save: '.qc-cmp2-footer button[mode=primary]', hide: '.qc-cmp2-container' },
    { cmp: 'trustarc', detect: '#truste-consent-track,.truste_box_overlay,#truste-consent-content', reject: '#truste-consent-required,.truste-consent-required', hide: '#truste-consent-track,.truste_box_overlay,.truste_overlay' },
    { cmp: 'usercentrics', detect: '#usercentrics-root,#usercentrics-cmp-ui,#uc-center-container',
      api: function(){
        var u = window.UC_UI || window.__ucCmp;
        if (u && typeof u.denyAllConsents === 'function') { try { u.denyAllConsents(); if (typeof u.closeCMP === 'function') u.closeCMP(); if (typeof u.saveConsents === 'function') u.saveConsents() } catch (e) {} return true }
        var host = q('#usercentrics-root,#usercentrics-cmp-ui'); var r = host && host.shadowRoot;
        var b = r && (r.querySelector('[data-testid=uc-deny-all-button]') || r.querySelector('[data-action-type=deny]'));
        if (b) { b.click(); return true }
      }, hide: '#usercentrics-root,#usercentrics-cmp-ui' },
    { cmp: 'sourcepoint', detect: 'iframe[id^=sp_message_iframe],div[id^=sp_message_container]', inFrame: /sourcepoint|privacy-mgmt|sp-prod|cmp\.|consent\./i,
      reject: 'button.sp_choice_type_13,button[title="Reject All"],button[title="Reject all"],button.sp_choice_type_REJECT_ALL', hide: 'div[id^=sp_message_container]' },
    { cmp: 'osano', detect: '.osano-cm-window,.osano-cm-dialog', reject: '.osano-cm-denyAll,.osano-cm-deny', hide: '.osano-cm-window' },
    { cmp: 'cookieyes', detect: '.cky-consent-container,.cky-consent-bar', reject: '.cky-btn-reject', settings: '.cky-btn-customize', panel: '.cky-preference-center', save: '.cky-btn-preferences', hide: '.cky-consent-container,.cky-overlay' },
    { cmp: 'complianz', detect: '#cmplz-cookiebanner-container,.cmplz-cookiebanner', reject: '.cmplz-deny,.cmplz-btn.cmplz-deny', hide: '#cmplz-cookiebanner-container,.cmplz-cookiebanner' },
    { cmp: 'termly', detect: '#termly-code-snippet-support,[data-tid=banner-decline]', reject: 'button[data-tid=banner-decline]', hide: '#termly-code-snippet-support' },
  ];

  var settingsOpened = {};
  function tryRule(r){
    if (!q(r.detect)) return false;
    if (r.api) { try { if (r.api()) { setTimeout(function(){ hide(r.hide || r.detect) }, 400); post(r.cmp, 'rejected'); return true } } catch (e) {} }
    var rej = r.reject && firstVisible(r.reject);
    if (rej) { click(rej); post(r.cmp, 'rejected'); setTimeout(function(){ if (q(r.detect) && vis(q(r.detect))) hide(r.hide || r.detect) }, 1500); return true }
    if (!vis(q(r.detect)) && !(r.panel && vis(q(r.panel)))) return false;
    var generic = findReject(q(r.detect)) || (r.panel && findReject(q(r.panel)));
    if (generic) { click(generic); post(r.cmp, 'rejected'); return true }
    if (r.settings && !settingsOpened[r.cmp]) {
      var set = firstVisible(r.settings);
      if (set) { settingsOpened[r.cmp] = true; click(set); return false } // the panel opens; next pass saves
    }
    if (r.panel && settingsOpened[r.cmp] && vis(q(r.panel))) {
      uncheckAll(q(r.panel));
      var save = firstVisible(r.save, q(r.panel)) || buttons(q(r.panel)).filter(function(b){ return SAVE.test(label(b)) && !ACCEPT.test(label(b)) })[0];
      if (save) { click(save); post(r.cmp, 'saved'); return true }
    }
    if (Date.now() - started > 4000) { hide(r.hide || r.detect); post(r.cmp, 'hidden'); return true }
    return false;
  }

  // Banners from tools not listed above: containers that look like consent
  // notices, then their "reject" button.
  var BANNER = '[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=gdpr i],[class*=gdpr i],[aria-label*=cookie i],[aria-label*=consent i],[role=dialog],[role=alertdialog]';
  function tryGeneric(){
    var boxes = qa(BANNER).filter(function(el){ return vis(el) && /cookie|consent|gdpr|privacy|datenschutz|cookies|tracking/i.test((el.innerText || '').slice(0, 2000)) });
    for (var i = 0; i < boxes.length; i++) {
      var b = findReject(boxes[i]);
      if (b) { click(b); post('generic', 'rejected'); return true }
    }
    // Inside a consent tool's own frame (e.g. Sourcepoint), the whole page is the banner.
    if (window !== window.top && /consent|privacy|cmp|sourcepoint|cookie/i.test(location.href)) {
      var fb = firstVisible('button.sp_choice_type_13,button[title="Reject All"],button[title="Reject all"]') || findReject(document);
      if (fb) { click(fb); post('frame', 'rejected'); return true }
    }
    return false;
  }

  function pass(){
    if (done || Date.now() - started > 20000) return stop();
    for (var i = 0; i < RULES.length; i++) if (tryRule(RULES[i])) return;
    tryGeneric();
  }
  var timer = null, mo = null;
  function schedule(){ clearTimeout(timer); timer = setTimeout(pass, 250) }
  function stop(){ clearTimeout(timer); if (mo) { try { mo.disconnect() } catch (e) {} mo = null } }
  function start(){
    pass();
    try { mo = new MutationObserver(schedule); mo.observe(document.documentElement, { childList: true, subtree: true }) } catch (e) {}
    setTimeout(pass, 1200); setTimeout(pass, 3000); setTimeout(pass, 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`


const SESSION_SEED = Math.floor(Math.random() * 0x7fffffff)

function seedFor(host) {
  let h = SESSION_SEED ^ 0x9e3779b9
  const s = String(host || '')
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0
  return h >>> 0
}

/** The farbling script for a host, seeded per host and per app session. */
function fingerprintForHost(host) {
  return fingerprintJS(seedFor(host))
}

function fingerprintJS(seed) {
  return String.raw`(function(){
  if (window.__bitFarble) return; window.__bitFarble = true;
  var SEED = ${Number(seed) >>> 0};
  function rng(n){ var x = (SEED ^ n) >>> 0; return function(){ x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 } }
  function def(obj, prop, get){ try { Object.defineProperty(obj, prop, { get: get, configurable: true }) } catch (e) {} }
  function wrap(proto, name, make){ try { var orig = proto[name]; if (typeof orig !== 'function') return; var w = make(orig); try { Object.defineProperty(w, 'toString', { value: function(){ return 'function ' + name + '() { [native code] }' } }) } catch (e) {} proto[name] = w } catch (e) {} }

  // --- canvas: flip the lowest bit of a few pixels, same pixels every time for this site
  function noisify(data, w, h){
    var r = rng(w * 31 + h), n = Math.max(4, Math.min(64, Math.floor(data.length / 4 / 500)));
    for (var i = 0; i < n; i++) { var p = Math.floor(r() * (data.length / 4)) * 4; var c = Math.floor(r() * 3); data[p + c] = data[p + c] ^ 1 }
  }
  function noisyCopy(canvas){
    try {
      var w = canvas.width, h = canvas.height; if (!w || !h || w * h > 4000000) return null;
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d'); ctx.drawImage(canvas, 0, 0);
      var img = origGetImageData.call(ctx, 0, 0, w, h); noisify(img.data, w, h); ctx.putImageData(img, 0, 0);
      return c;
    } catch (e) { return null }
  }
  var C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  var origGetImageData = C2D && C2D.getImageData;
  if (C2D) wrap(C2D, 'getImageData', function(orig){ return function(x, y, w, h){ var img = orig.apply(this, arguments); try { noisify(img.data, w, h) } catch (e) {} return img } });
  var HC = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  if (HC && origGetImageData) {
    wrap(HC, 'toDataURL', function(orig){ return function(){ var c = noisyCopy(this); return orig.apply(c || this, arguments) } });
    wrap(HC, 'toBlob', function(orig){ return function(){ var c = noisyCopy(this); return orig.apply(c || this, arguments) } });
  }

  // --- WebGL: generic vendor and renderer
  [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function(GL){
    if (!GL) return;
    wrap(GL.prototype, 'getParameter', function(orig){ return function(p){
      if (p === 0x9245 || p === 0x1F00) return 'Google Inc.';           // UNMASKED_VENDOR_WEBGL / VENDOR
      if (p === 0x9246 || p === 0x1F01) return 'Generic GPU';           // UNMASKED_RENDERER_WEBGL / RENDERER
      return orig.apply(this, arguments);
    } });
  });

  // --- audio: tiny noise on analyser and rendered buffer reads
  var AN = window.AnalyserNode && AnalyserNode.prototype;
  if (AN) wrap(AN, 'getFloatFrequencyData', function(orig){ return function(arr){ orig.apply(this, arguments); var r = rng(7); for (var i = 0; i < arr.length; i += 97) arr[i] += (r() - 0.5) * 0.0001 } });
  var AB = window.AudioBuffer && AudioBuffer.prototype;
  if (AB) wrap(AB, 'getChannelData', function(orig){ return function(){ var d = orig.apply(this, arguments); if (!d.__bitFarbled) { var r = rng(13); for (var i = 0; i < d.length; i += 101) d[i] += (r() - 0.5) * 1e-7; try { d.__bitFarbled = true } catch (e) {} } return d } });

  // --- hardware and screen
  var N = Navigator.prototype;
  var cores = navigator.hardwareConcurrency || 4;
  def(N, 'hardwareConcurrency', function(){ return cores >= 8 ? 8 : cores >= 4 ? 4 : 2 });
  if ('deviceMemory' in navigator) def(N, 'deviceMemory', function(){ return 4 });
  def(N, 'plugins', function(){ return Object.create(PluginArray.prototype, { length: { value: 0 } }) });
  def(N, 'mimeTypes', function(){ return Object.create(MimeTypeArray.prototype, { length: { value: 0 } }) });
  if ('getBattery' in N) { try { delete N.getBattery } catch (e) {} def(N, 'getBattery', function(){ return undefined }) }
  var bucket = function(v, step){ return Math.max(step, Math.round(v / step) * step) };
  var S = Screen.prototype, sw = screen.width, sh = screen.height;
  def(S, 'width', function(){ return bucket(sw, 20) });
  def(S, 'height', function(){ return bucket(sh, 20) });
  def(S, 'availWidth', function(){ return bucket(sw, 20) });
  def(S, 'availHeight', function(){ return bucket(sh, 20) });

  // --- devices: one of each kind, no labels or ids
  var MD = window.MediaDevices && MediaDevices.prototype;
  if (MD) wrap(MD, 'enumerateDevices', function(orig){ return function(){ return orig.apply(this, arguments).then(function(list){
    var seen = {}, out = [];
    list.forEach(function(d){ if (seen[d.kind]) return; seen[d.kind] = true; out.push({ kind: d.kind, label: '', deviceId: '', groupId: '', toJSON: function(){ return { kind: d.kind, label: '', deviceId: '', groupId: '' } } }) });
    return out;
  }) } });
})();`
}

module.exports = { AUTOCONSENT_JS, fingerprintJS, fingerprintForHost }
