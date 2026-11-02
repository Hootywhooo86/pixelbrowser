// Catches file downloads inside web pages. The phone's web view can't save
// blob:/data: files or "download" links by itself, so this script fetches
// them inside the page (with the page's own sign-in cookies) and hands the
// bytes to the app in chunks. Files on other sites that the page can't read
// are handed back to the app as a link to download natively.
//
// Messages posted to the app:
//   { __bitFile: { id, name, mime, size, index, total, chunk } }   base64 chunks
//   { __bitDownload: { url, filename, needsNative: true, cookie, referer, userAgent } }
//   { __bitDownloadError: { url, message } }

const SCRIPT = String.raw`(function(){
  if (window.__bitDl) return; window.__bitDl = true;
  var CHUNK = 256 * 1024;

  // Many sites (insurance documents, shipping labels…) build the file in the
  // page, open it with a blob: link and revoke that link right away. Keep each
  // Blob the page makes so it can still be saved after the link is revoked,
  // and let revoked links live a minute longer.
  var blobs = {}, made = [];
  try {
    var create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = function(obj){
      var u = create.apply(URL, arguments);
      try { if (obj instanceof Blob) { blobs[u] = obj; made.push(u); if (made.length > 30) delete blobs[made.shift()]; maybePdf(obj, u, 'blob') } } catch (e) {}
      return u;
    };
    URL.revokeObjectURL = function(u){ var args = arguments; setTimeout(function(){ try { revoke.apply(URL, args) } catch (e) {} }, 60000) };
  } catch (e) {}
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)) } catch (e) {} }
  function log(what, url){ post({ __bitDlLog: { what: what, url: String(url || '').slice(0, 160), page: location.host } }) }

  // Safety net for "Download label"-style buttons: if the page makes or loads a
  // PDF right after you tap something and no other path saved it, save it and
  // open it in the viewer. Sites do this many ways (blob links, pop-ups,
  // previews in an iframe, fetch + FileSaver); this catches the PDF itself.
  var lastSend = 0, lastTap = 0, saved = typeof WeakSet === 'function' ? new WeakSet() : null, savedUrls = {};
  ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'].forEach(function(t){ document.addEventListener(t, function(){ lastTap = Date.now() }, true) });
  function recentTap(ms){ return Date.now() - lastTap < (ms || 5000) }
  // A JSON answer right after a tap that contains a file link (Shippo's
  // label_regen returns the label's address): if nothing else saves the file
  // within a moment, save it from that link.
  function fileLinksIn(text){
    var out = [], re = /https?:\\?\/\\?\/[^"'\s<>]+/g, m;
    while ((m = re.exec(text)) && out.length < 10) {
      var u = m[0].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
      if (/\.(pdf|png|zpl)(?:[?#]|$)/i.test(u) || /amazonaws\.com\/|storage\.googleapis\.com\/|deliver\.goshippo\.com|shippo-delivery|\/labels?\//i.test(u)) out.push(u);
    }
    return out;
  }
  function checkJson(text, from){
    if (!recentTap(10000) || !text || text.length > 2000000) return;
    var links = fileLinksIn(text); if (!links.length) return;
    var pdf = links.filter(function(u){ return /\.pdf(?:[?#]|$)/i.test(u) })[0] || links[0];
    log('file link in ' + from, pdf);
    var at = Date.now();
    setTimeout(function(){ if (lastSend > at) return; log('saving from link', pdf); grab(pdf) }, 1500);
  }
  addEventListener('error', function(e){ if (recentTap(15000)) log('page error: ' + String(e.message || '').slice(0, 90), e.filename || '') }, true);
  addEventListener('unhandledrejection', function(e){ if (recentTap(15000)) log('page error: ' + String(e.reason && (e.reason.message || e.reason) || '').slice(0, 90), '') });
  function isPdfBlob(b, cb){
    if (!b) return cb(false);
    if (/pdf/i.test(b.type || '')) return cb(true);
    if (b.type && !/octet-stream|binary|download/i.test(b.type)) return cb(false);
    try { var r = new FileReader(); r.onload = function(){ cb(String(r.result || '').indexOf('%PDF') === 0) }; r.onerror = function(){ cb(false) }; r.readAsText(b.slice(0, 5)) } catch (e) { cb(false) }
  }
  function maybePdf(b, url, how){
    if (!recentTap(5000) || (saved && saved.has(b))) return;
    isPdfBlob(b, function(yes){
      if (!yes) return;
      log('pdf made (' + how + ')', url);
      // Give the normal paths a moment; save it ourselves if none did.
      setTimeout(function(){ if ((saved && saved.has(b)) || Date.now() - lastSend < 2000) return; if (saved) saved.add(b); send(b, nameFor(url || '', '', '', 'application/pdf'), 'application/pdf') }, 1200);
    });
  }
  try {
    var ofetch = window.fetch;
    if (ofetch) window.fetch = function(){
      var p = ofetch.apply(this, arguments);
      try { p.then(function(r){ var ct = r.headers.get('content-type') || ''; if (recentTap(15000)) log('fetch ' + r.status + ' ' + ct.split(';')[0], r.url); if (/json|text\/plain/i.test(ct) && recentTap(10000)) r.clone().text().then(function(t){ checkJson(t, 'answer') }).catch(function(){}); if (/application\/pdf/i.test(ct) && recentTap(8000)) r.clone().blob().then(function(b){ maybePdf(b, r.url, 'fetch') }).catch(function(){}) }).catch(function(){}) } catch (e) {}
      return p;
    };
    var xopen = XMLHttpRequest.prototype.open, xsend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m, u){ this.__bitUrl = u; return xopen.apply(this, arguments) };
    XMLHttpRequest.prototype.send = function(){
      var x = this;
      try { x.addEventListener('load', function(){ try { var ct = x.getResponseHeader('content-type') || ''; if (recentTap(15000)) log('xhr ' + x.status + ' ' + ct.split(';')[0], abs(x.__bitUrl)); if (/json|text\/plain/i.test(ct) && recentTap(10000)) { try { checkJson(x.responseType === 'json' ? JSON.stringify(x.response) : (!x.responseType || x.responseType === 'text') ? x.responseText : '', 'answer') } catch (e) {} } if (!/application\/pdf/i.test(ct) || !recentTap(8000)) return; var b = x.response instanceof Blob ? x.response : x.response instanceof ArrayBuffer ? new Blob([x.response], { type: 'application/pdf' }) : null; if (b) maybePdf(b, abs(x.__bitUrl), 'xhr') } catch (e) {} }) } catch (e) {}
      return xsend.apply(this, arguments);
    };
  } catch (e) {}
  // PDFs shown in an iframe/embed/object preview (the phone can't display those).
  function checkFrame(el){
    try {
      var src = el.getAttribute('src') || el.getAttribute('data') || '';
      if (!src || savedUrls[src] || !recentTap(8000)) return;
      var url = abs(src);
      if (/^blob:/i.test(url) || /^data:application\/pdf/i.test(url) || /\.pdf(?:[?#]|$)/i.test(url)) { savedUrls[src] = 1; log('pdf preview', url); grab(url) }
    } catch (e) {}
  }
  try {
    new MutationObserver(function(list){
      list.forEach(function(m){
        if (m.type === 'attributes') { if (/^(IFRAME|EMBED|OBJECT)$/.test(m.target.tagName)) checkFrame(m.target); return }
        m.addedNodes && m.addedNodes.forEach(function(n){ if (!n.tagName) return; if (/^(IFRAME|EMBED|OBJECT)$/.test(n.tagName)) checkFrame(n); else if (n.querySelectorAll) n.querySelectorAll('iframe,embed,object').forEach(checkFrame) });
      });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data'] });
  } catch (e) {}
  function abs(u){ try { return new URL(u, location.href).href } catch (e) { return String(u || '') } }
  function pathOf(u){ try { return new URL(u).pathname } catch (e) { return String(u || '').split(/[?#]/)[0] } }
  function cleanName(n){ return String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120) }
  var EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/csv': 'csv', 'application/zip': 'zip', 'text/plain': 'txt' };
  function nameFor(url, given, cd, mime){
    var n = cleanName(given);
    if (!n && cd) {
      var star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd), plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
      try { if (star) n = cleanName(decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))) } catch (e) {}
      if (!n && plain) n = cleanName(plain[1].trim());
    }
    if (!n && /^https?:/i.test(url)) { var last = pathOf(url).split('/').filter(Boolean).pop() || ''; try { n = cleanName(decodeURIComponent(last)) } catch (e) { n = cleanName(last) } }
    if (!n) n = 'download';
    var ext = EXT[String(mime || '').split(';')[0].trim()];
    if (ext && !/\.[A-Za-z0-9]{1,5}$/.test(n)) n += '.' + ext;
    return n;
  }
  var isFileUrl = function(u){ return /^(blob|data):/i.test(u) };
  function wants(a){
    if (!a || !a.getAttribute) return false;
    var href = a.getAttribute('href'); if (!href) return false;
    var url = abs(href);
    if (isFileUrl(url)) return true;
    return a.hasAttribute('download') && /^https?:/i.test(url);
  }
  function send(blob, name, mime){
    lastSend = Date.now();
    try { if (saved) saved.add(blob) } catch (e) {}
    log('saving ' + (mime || ''), name);
    var reader = new FileReader();
    reader.onload = function(){
      var s = String(reader.result || ''), b64 = s.slice(s.indexOf(',') + 1);
      var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var total = Math.max(1, Math.ceil(b64.length / CHUNK));
      for (var i = 0; i < total; i++) post({ __bitFile: { id: id, name: name, mime: mime, size: blob.size, index: i, total: total, chunk: b64.slice(i * CHUNK, (i + 1) * CHUNK) } });
    };
    reader.onerror = function(){ post({ __bitDownloadError: { url: '', message: 'Could not read the file.' } }) };
    reader.readAsDataURL(blob);
  }
  function native(url, filename){
    post({ __bitDownload: { url: url, filename: filename || '', needsNative: true, cookie: document.cookie || '', referer: location.href, userAgent: navigator.userAgent } });
  }
  var busy = {};
  function grab(url, filename){
    url = abs(url);
    if (busy[url] && Date.now() - busy[url] < 1500) return; busy[url] = Date.now();
    log('grab', url);
    var kept = blobs[url];
    if (kept) return send(kept, nameFor(url, filename, '', kept.type), kept.type || 'application/octet-stream');
    var cross = false;
    try { cross = /^https?:/i.test(url) && new URL(url).origin !== location.origin } catch (e) {}
    (ofetch || fetch).call(window, url, { credentials: cross ? "omit" : "include" }).then(function(r){
      if (!r.ok) throw new Error('The site said ' + r.status + '.');
      var cd = r.headers.get('content-disposition'), mime = (r.headers.get('content-type') || '').split(';')[0].trim();
      return r.blob().then(function(b){ send(b, nameFor(url, filename, cd, mime || b.type), mime || b.type || 'application/octet-stream') });
    }).catch(function(e){
      if (/^https?:/i.test(url)) native(url, filename);
      else post({ __bitDownloadError: { url: url.slice(0, 80), message: 'The site took the file back before Bit Browser could save it. Tap the download again.' } });
    });
  }
  window.__bitGrab = grab;

  // Taps on download / blob: / data: links.
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !wants(a) || e.defaultPrevented) return;
    e.preventDefault(); e.stopImmediatePropagation();
    grab(a.getAttribute('href'), a.getAttribute('download'));
  }, true);

  // Scripts that build a link and click it without adding it to the page.
  var aClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){
    if (!this.isConnected && wants(this)) return grab(this.getAttribute('href'), this.getAttribute('download'));
    return aClick.apply(this, arguments);
  };
  var dispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function(ev){
    if (ev && ev.type === 'click' && this instanceof HTMLAnchorElement && !this.isConnected && wants(this)) { grab(this.getAttribute('href'), this.getAttribute('download')); return false }
    return dispatch.apply(this, arguments);
  };

  // window.open(blobUrl), or window.open('') and then setting its location.
  var open = window.open;
  // A page that opened a blank window and then fills it (Shippo's "Download
  // label" does this). The app shows one page per tab, so instead of a real
  // pop-up the page gets a hidden same-site frame that behaves like one: it can
  // write into it, add a PDF frame or image to it, send it to a link, or ask it
  // to print. Whatever file ends up in it is saved and opened in the viewer.
  var PDFISH = /^blob:|^data:application\/pdf|\.pdf(?:[?#]|$)/i;
  // Where label/file services keep files (Shippo, S3, Google storage…).
  var FILEISH = /amazonaws\.com\/|storage\.googleapis\.com\/|blob\.core\.windows\.net\/|deliver\.goshippo\.com|shippo-delivery|\/labels?\/|\/download/i;
  function fakeWindow(){
    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0';
    frame.setAttribute('aria-hidden', 'true');
    (document.body || document.documentElement).appendChild(frame);
    var fw = frame.contentWindow, closed = false, done = false, seen = {};
    var doc = function(){ try { return frame.contentWindow.document } catch (e) { return null } };
    var finish = function(){ done = true };
    // A real pop-up for a page that sends this window to an ordinary link
    // (often a sign-in), so it keeps window.opener.
    var go = function(u){
      u = abs(u); log('pop-up sent to', u);
      if (isFileUrl(u) || PDFISH.test(u) || FILEISH.test(u) || blobs[u]) { finish(); return grab(u) }
      closed = true; finish(); open.call(window, u);
    };
    function scan(){
      var d = doc(); if (!d || done) return;
      var els = d.querySelectorAll('iframe,embed,object,a[href],img');
      for (var i = 0; i < els.length; i++) {
        var el = els[i], raw = el.getAttribute('src') || el.getAttribute('data') || el.getAttribute('href') || '';
        if (!raw || seen[raw]) continue; seen[raw] = 1;
        var u = abs(raw);
        if (PDFISH.test(u) || blobs[u]) { log('pop-up shows a file', u); finish(); return grab(u) }
      }
    }
    var timer = setInterval(function(){ if (done || closed) return clearInterval(timer); scan() }, 300);
    setTimeout(function(){ clearInterval(timer) }, 30000);
    function print(){
      scan(); if (done) return;
      // A label drawn as a web page (an image or HTML): print it as a PDF.
      var d = doc(); var html = d && d.documentElement ? d.documentElement.outerHTML : '';
      log('pop-up asks to print', (html || '').slice(0, 80));
      if (html && html.length > 40) { finish(); post({ __bitPrintHtml: { html: html.slice(0, 4000000), base: location.href } }) }
    }
    var asked = {};
    var loc = { assign: go, replace: go, reload: function(){}, toString: function(){ return 'about:blank' } };
    Object.defineProperty(loc, 'href', { get: function(){ return 'about:blank' }, set: go });
    var handler = {
      get: function(t, prop){
        if (typeof prop === 'string' && !asked['g' + prop] && Object.keys(asked).length < 40) { asked['g' + prop] = 1; log('pop-up read ' + prop, '') }
        if (prop === 'location') return loc;
        if (prop === 'closed') return closed;
        if (prop === 'close') return function(){ closed = true; setTimeout(function(){ if (!done) scan(); try { frame.remove() } catch (e) {} }, 1500) };
        if (prop === 'print') return print;
        if (prop === 'opener') return window;
        // pop-up.open(url, '_self'): Shippo sends the label to its pop-up this way.
        if (prop === 'open') return function(u){ log('pop-up opens', u || '(blank)'); if (u && u !== 'about:blank') go(u); return self };
        if (prop === 'focus' || prop === 'blur' || prop === 'moveTo' || prop === 'resizeTo') return function(){};
        if (prop === 'document') { var d = doc(); if (!asked.doc) { asked.doc = 1; log('pop-up document used', '') } setTimeout(scan, 50); return d }
        var v; try { v = frame.contentWindow[prop] } catch (e) { return undefined }
        return typeof v === 'function' ? v.bind(frame.contentWindow) : v;
      },
      set: function(t, prop, value){
        log('pop-up set ' + String(prop), String(value).slice(0, 120));
        if (prop === 'location') { go(value); return true }
        try { frame.contentWindow[prop] = value } catch (e) {}
        return true;
      },
    };
    var self;
    try { return (self = new Proxy({}, handler)) } catch (e) {
      return { closed: false, opener: window, close: function(){}, focus: function(){}, print: print, document: doc(), location: loc };
    }
  }
  window.open = function(u){
    var url = u ? abs(u) : '';
    log('window.open ' + [arguments[1], arguments[2]].filter(Boolean).join(' '), url || '(blank)');
    if (url && isFileUrl(url)) { grab(url); return fakeWindow() }
    // The app shows one page per tab, so a blank pop-up can't exist; hand back
    // a stand-in that catches the file the page then sends to it.
    if (!url || url === 'about:blank') return fakeWindow();
    return open.apply(window, arguments);
  };
})();`

export const CAPTURE_DOWNLOADS_JS = `${SCRIPT}\ntrue;`

/** Fetch one file inside the page (blob:, data: or a signed-in link) and hand it to the app. */
export function fetchInPageJS(url, filename = '') {
  return `${SCRIPT}\n;window.__bitGrab(${JSON.stringify(String(url))}, ${JSON.stringify(String(filename || ''))});true;`
}
