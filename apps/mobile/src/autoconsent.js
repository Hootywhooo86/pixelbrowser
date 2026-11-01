// Cookie banners, answered "no" automatically.
//
// AUTOCONSENT_JS runs in every page (at document start and again after load)
// and handles the common consent tools: OneTrust, Cookiebot, Didomi,
// Quantcast, TrustArc, Usercentrics, Sourcepoint, Osano, CookieYes,
// Complianz, Termly, plus a generic "Reject all / Only necessary / Decline"
// button finder in several languages. For each banner it:
//   1. clicks the tool's own reject button (or calls its reject API),
//   2. else opens its settings, switches everything off and saves,
//   3. else hides the banner.
// It never clicks "accept". It tells the app what it did with
// { __bitConsent: { cmp, action } } (action: 'rejected' | 'saved' | 'hidden').
//
// On by default (state.autoconsent !== false); a site can be excluded with
// setSite(host, { autoconsent: false }) from ./site-settings.

export const AUTOCONSENT_JS = String.raw`(function(){
  if (window.__bitConsent) return; window.__bitConsent = true;
  var done = false, started = Date.now();
  function post(cmp, action){
    if (done) return; done = true;
    try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ __bitConsent: { cmp: cmp, action: action, host: location.hostname } })) } catch (e) {}
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

/** The script for a page, or '' when auto-reject is off globally or for this site. */
export function autoconsentFor(site, state) {
  if (state?.autoconsent === false || site?.autoconsent === false) return ''
  return AUTOCONSENT_JS
}
