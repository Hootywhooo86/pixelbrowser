// Small scripts Bit Browser runs inside web pages: reader mode (find the
// article, rebuild it as a clean pixel page), business-details form filling
// and picture-in-picture. Each returns plain data to main.js.

/** True when the page looks like an article worth a reader view. */
const READERABLE_JS = `(function(){
  try {
    if (!/^https?:/.test(location.href)) return false;
    var text = 0;
    var ps = document.querySelectorAll('article p, main p, [role=main] p, p');
    for (var i = 0; i < ps.length && i < 400; i++) { var t = (ps[i].textContent || '').trim(); if (t.length > 80) text += t.length; }
    return text > 1400;
  } catch (e) { return false }
})()`

/**
 * Readability-style extraction: pick the element with the most paragraph text
 * (bonus for <article>/<main>, penalty for nav/aside/comments), then copy only
 * safe content tags out of it. Returns { title, byline, site, html, words }.
 */
const EXTRACT_ARTICLE_JS = `(function(){
  var BAD = /comment|footer|footnote|sidebar|sponsor|promo|related|share|social|subscribe|newsletter|cookie|banner|nav|menu|breadcrumb|popup|modal|advert|\\bad\\b|ads/i;
  var KEEP = { P:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, UL:1, OL:1, LI:1, BLOCKQUOTE:1, PRE:1, CODE:1, EM:1, I:1, STRONG:1, B:1, A:1, IMG:1, FIGURE:1, FIGCAPTION:1, BR:1, HR:1, TABLE:1, THEAD:1, TBODY:1, TR:1, TD:1, TH:1, SUP:1, SUB:1, SPAN:1, DIV:1, SECTION:1, ARTICLE:1, MAIN:1 };
  function score(el){
    var s = 0, ps = el.querySelectorAll('p');
    for (var i = 0; i < ps.length; i++) { var t = (ps[i].textContent || '').trim().length; if (t > 40) s += t; }
    var tag = el.tagName, cls = (el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + (el.id || '');
    if (tag === 'ARTICLE') s *= 1.5;
    if (tag === 'MAIN' || el.getAttribute('role') === 'main') s *= 1.2;
    if (BAD.test(cls)) s *= 0.3;
    var links = 0, la = el.querySelectorAll('a'); for (var j = 0; j < la.length; j++) links += (la[j].textContent || '').length;
    var all = (el.textContent || '').length || 1;
    s *= Math.max(0.1, 1 - links / all);
    return s;
  }
  var best = document.body, bestScore = 0;
  var cands = document.querySelectorAll('article, main, [role=main], section, div');
  for (var i = 0; i < cands.length && i < 3000; i++) { var sc = score(cands[i]); if (sc > bestScore) { bestScore = sc; best = cands[i]; } }
  function copy(node, out, depth){
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out.appendChild(document.createTextNode(c.textContent)); continue; }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName;
      var cls = (typeof c.className === 'string' ? c.className : '') + ' ' + (c.id || '');
      if (!KEEP[tag] || (depth > 0 && BAD.test(cls) && tag !== 'P')) continue;
      try { var cs = getComputedStyle(c); if (cs.display === 'none' || cs.visibility === 'hidden') continue; } catch (e) {}
      var el;
      if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'SPAN') { el = document.createElement(tag === 'SPAN' ? 'span' : 'div'); }
      else el = document.createElement(tag.toLowerCase());
      if (tag === 'A') { var h = c.href || ''; if (/^https?:/i.test(h)) el.setAttribute('href', h); }
      if (tag === 'IMG') {
        var src = c.currentSrc || c.src || c.getAttribute('data-src') || '';
        if (!/^https?:/i.test(src)) continue;
        el.setAttribute('src', src); if (c.alt) el.setAttribute('alt', c.alt);
        out.appendChild(el); continue;
      }
      copy(c, el, depth + 1);
      if (tag !== 'BR' && tag !== 'HR' && !el.textContent.trim() && !el.querySelector('img')) continue;
      out.appendChild(el);
    }
  }
  var box = document.createElement('div');
  copy(best, box, 0);
  var h1 = document.querySelector('h1');
  var title = (document.querySelector('meta[property="og:title"]') || {}).content || (h1 && h1.textContent.trim()) || document.title;
  var byline = (document.querySelector('meta[name=author]') || {}).content || ((document.querySelector('[rel=author], .byline, .author') || {}).textContent || '').trim();
  var site = (document.querySelector('meta[property="og:site_name"]') || {}).content || location.hostname.replace(/^www\\./, '');
  // The page's own h1 usually repeats the title.
  var first = box.querySelector('h1'); if (first && first.textContent.trim() === String(title).trim()) first.remove();
  var words = (box.textContent || '').trim().split(/\\s+/).length;
  return { title: String(title).slice(0, 300), byline: String(byline).slice(0, 200), site: String(site).slice(0, 100), html: box.innerHTML.slice(0, 600000), words: words };
})()`

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * The reader page (loaded as a data: URL). The article HTML was rebuilt from
 * an allow-list of tags with only href/src/alt attributes, and the page's CSP
 * only runs our own script (by nonce), so nothing from the site can run.
 */
function readerPage(article, { url, theme }) {
  const nonce = require('node:crypto').randomBytes(12).toString('base64')
  const t = theme || {}
  const minutes = Math.max(1, Math.round((article.words || 0) / 220))
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<title>${esc(article.title)}</title>
<style>
:root { --bg: ${t.bg || '#0b0b16'}; --panel: ${t.panel || '#141428'}; --edge: ${t.edge || '#26264a'}; --accent: ${t.accent || '#2dd4bf'}; --ink: ${t.ink || '#f4f1ff'}; --muted: ${t.muted || '#9a97b8'}; --orange: ${t.orange || '#ff9f1c'}; --size: 19px; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: var(--size)/1.7 Georgia, 'Iowan Old Style', serif; }
#bar { position: sticky; top: 0; display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: var(--panel); border-bottom: 3px solid var(--accent); font: 12px/1 ui-monospace, monospace; z-index: 2; }
#bar .tag { background: var(--accent); color: var(--bg); padding: 5px 7px; font-weight: bold; letter-spacing: 1px; }
#bar .grow { flex: 1; color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#bar button { font: 12px/1 ui-monospace, monospace; color: var(--ink); background: var(--bg); border: 3px solid var(--edge); box-shadow: 2px 2px 0 #05050f; height: 30px; min-width: 34px; cursor: pointer; }
#bar button:hover { border-color: var(--accent); }
main { max-width: 720px; margin: 0 auto; padding: 32px 22px 80px; }
h1.title { font: bold 1.7em/1.25 Georgia, serif; margin: 0 0 10px; }
.meta { color: var(--muted); font: 13px/1.4 ui-monospace, monospace; margin-bottom: 28px; padding-bottom: 14px; border-bottom: 3px dashed var(--edge); }
a { color: var(--accent); }
img { max-width: 100%; height: auto; display: block; margin: 18px auto; border: 3px solid var(--edge); }
blockquote { margin: 1em 0; padding: .2em 1em; border-left: 4px solid var(--orange); color: var(--muted); }
pre, code { font-family: ui-monospace, monospace; font-size: .85em; background: var(--panel); }
pre { padding: 12px; overflow: auto; border: 2px solid var(--edge); }
table { border-collapse: collapse; } td, th { border: 1px solid var(--edge); padding: 4px 8px; }
</style></head><body>
<div id="bar"><span class="tag">READER</span><span class="grow">${esc(article.site)} · ${minutes} min read</span>
<button id="smaller" title="Smaller text">A-</button><button id="bigger" title="Bigger text">A+</button><button id="exit" title="Back to the page (Esc)">EXIT</button></div>
<main><h1 class="title">${esc(article.title)}</h1><div class="meta">${article.byline ? esc(article.byline) + ' · ' : ''}<a href="${esc(url)}">${esc(url)}</a></div>
<article>${article.html}</article></main>
<script nonce="${nonce}">
(function(){
  var size = 19;
  try { size = Number(localStorage.getItem('size')) || 19 } catch (e) {}
  function apply(){ document.documentElement.style.setProperty('--size', size + 'px') }
  apply();
  document.getElementById('smaller').onclick = function(){ size = Math.max(13, size - 2); apply() };
  document.getElementById('bigger').onclick = function(){ size = Math.min(34, size + 2); apply() };
  function exit(){ location.href = 'https://reader.bitbrowser.invalid/exit' }
  document.getElementById('exit').onclick = exit;
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') exit() });
})();
</script></body></html>`
}

/** Fill a form with the saved business details (by autocomplete, name, id, label or placeholder). */
function fillBusinessJS(p) {
  return `(function(){
  var P = ${JSON.stringify(p || {})};
  var RULES = [
    ['company', /organi[sz]ation|company|business|firm/i, 'organization'],
    ['email', /e-?mail/i, 'email'],
    ['phone', /phone|tel|mobile/i, 'tel'],
    ['postal', /zip|postal|postcode/i, 'postal-code'],
    ['country', /country/i, 'country-name'],
    ['region', /state|province|region|county/i, 'address-level1'],
    ['city', /city|town|locality/i, 'address-level2'],
    ['street', /street|address(?!.*(2|line ?2))|addr1|address-?line-?1/i, 'street-address'],
    ['name', /full.?name|^name$|your.?name|contact.?name|recipient/i, 'name'],
  ];
  function labelOf(el){
    var l = el.labels && el.labels[0] ? el.labels[0].textContent : '';
    return [el.getAttribute('autocomplete'), el.name, el.id, el.placeholder, el.getAttribute('aria-label'), l].filter(Boolean).join(' ');
  }
  function set(el, v){
    if (el.tagName === 'SELECT') {
      for (var i = 0; i < el.options.length; i++) { var o = el.options[i]; if (o.value.toLowerCase() === v.toLowerCase() || o.text.toLowerCase() === v.toLowerCase()) { el.selectedIndex = i; break; } }
    } else {
      var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (d && d.set) d.set.call(el, v); else el.value = v;
    }
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var filled = 0;
  var fields = document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]), select, textarea');
  for (var i = 0; i < fields.length; i++) {
    var el = fields[i]; if (el.disabled || el.readOnly || (el.value && el.tagName !== 'SELECT')) continue;
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase(), text = labelOf(el);
    for (var r = 0; r < RULES.length; r++) {
      var key = RULES[r][0];
      if (!P[key]) continue;
      if (ac === RULES[r][2] || (ac.indexOf(RULES[r][2]) >= 0) || RULES[r][1].test(text)) { set(el, String(P[key])); filled++; break; }
    }
  }
  return filled;
})()`
}

/** Picture-in-picture for the video under the pointer (or the first playing one). */
function pipJS(x, y) {
  return `(function(){
  var v = null;
  try { v = document.elementsFromPoint(${Number(x) || 0}, ${Number(y) || 0}).find(function(e){ return e.tagName === 'VIDEO' }) } catch (e) {}
  if (!v) v = Array.prototype.find.call(document.querySelectorAll('video'), function(e){ return !e.paused }) || document.querySelector('video');
  if (!v) return false;
  if (document.pictureInPictureElement === v) return document.exitPictureInPicture().then(function(){ return true });
  return v.requestPictureInPicture().then(function(){ return true }, function(){ return false });
})()`
}

module.exports = { READERABLE_JS, EXTRACT_ARTICLE_JS, readerPage, fillBusinessJS, pipJS }
