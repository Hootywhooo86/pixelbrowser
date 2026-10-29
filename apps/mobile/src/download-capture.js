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
      try { if (obj instanceof Blob) { blobs[u] = obj; made.push(u); if (made.length > 30) delete blobs[made.shift()] } } catch (e) {}
      return u;
    };
    URL.revokeObjectURL = function(u){ var args = arguments; setTimeout(function(){ try { revoke.apply(URL, args) } catch (e) {} }, 60000) };
  } catch (e) {}
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)) } catch (e) {} }
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
    var kept = blobs[url];
    if (kept) return send(kept, nameFor(url, filename, '', kept.type), kept.type || 'application/octet-stream');
    var cross = false;
    try { cross = /^https?:/i.test(url) && new URL(url).origin !== location.origin } catch (e) {}
    fetch(url, { credentials: cross ? 'omit' : 'include' }).then(function(r){
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
  function fakeWindow(){
    var w = { closed: false, opener: window, close: function(){ w.closed = true }, focus: function(){}, blur: function(){}, print: function(){},
      document: { write: function(){}, writeln: function(){}, close: function(){}, open: function(){}, body: null, title: '' } };
    var go = function(u){ u = abs(u); if (isFileUrl(u) || /\.pdf(?:[?#]|$)/i.test(u)) grab(u); else location.href = u };
    var loc = { assign: go, replace: go, reload: function(){}, toString: function(){ return 'about:blank' } };
    Object.defineProperty(loc, 'href', { get: function(){ return 'about:blank' }, set: go });
    Object.defineProperty(w, 'location', { get: function(){ return loc }, set: go });
    return w;
  }
  window.open = function(u){
    var url = u ? abs(u) : '';
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
