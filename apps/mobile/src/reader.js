// Reader mode: pull the main article out of a page (a small Readability-style
// heuristic) so it can be shown clean in ReaderView.

// Runs inside the page via browser.run(); returns
// { title, byline, siteName, html, textLength } or null.
export const READER_JS = `(function(){
  try {
    var BAD = /(^|[\\s_-])(nav|menu|footer|header|sidebar|aside|comment|share|social|promo|advert|ads?|sponsor|related|newsletter|subscribe|cookie|banner|popup|modal|breadcrumb|toolbar|widget)([\\s_-]|$)/i;
    function bad(el){ var id = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : ''); return BAD.test(id) || /^(NAV|ASIDE|FOOTER|HEADER|FORM|BUTTON|SCRIPT|STYLE|NOSCRIPT|IFRAME|SVG)$/.test(el.tagName) || el.getAttribute('role') === 'navigation' || el.getAttribute('aria-hidden') === 'true'; }
    function textLen(el){ return (el.textContent || '').replace(/\\s+/g, ' ').trim().length; }
    // Score each block by the paragraph text directly inside it.
    var best = null, bestScore = 0, scores = new Map();
    document.querySelectorAll('p, pre, blockquote').forEach(function(p){
      var len = textLen(p); if (len < 40) return;
      var parent = p.parentElement; if (!parent) return;
      for (var el = p; el; el = el.parentElement) if (bad(el)) return;
      var s = 1 + Math.min(len / 100, 3) + (p.textContent.split(',').length - 1) * 0.3;
      scores.set(parent, (scores.get(parent) || 0) + s);
      if (parent.parentElement) scores.set(parent.parentElement, (scores.get(parent.parentElement) || 0) + s / 2);
    });
    scores.forEach(function(s, el){
      var links = 0; el.querySelectorAll('a').forEach(function(a){ links += textLen(a) });
      var total = textLen(el) || 1, adj = s * (1 - links / total);
      if (adj > bestScore) { bestScore = adj; best = el; }
    });
    var article = document.querySelector('article');
    if (article && textLen(article) > (best ? textLen(best) * 0.7 : 0)) best = article;
    if (!best) return null;
    var keep = /^(P|H1|H2|H3|H4|H5|H6|UL|OL|LI|BLOCKQUOTE|PRE|CODE|FIGURE|FIGCAPTION|IMG|EM|STRONG|B|I|A|BR|TABLE|THEAD|TBODY|TR|TD|TH|SPAN|SUP|SUB|HR)$/;
    function clean(node){
      var out = document.createDocumentFragment();
      node.childNodes.forEach(function(c){
        if (c.nodeType === 3) { out.appendChild(document.createTextNode(c.textContent)); return; }
        if (c.nodeType !== 1 || bad(c)) return;
        if (c.tagName === 'IMG') {
          var src = c.currentSrc || c.getAttribute('src') || c.getAttribute('data-src') || '';
          if (!src || /^data:/.test(src) || (c.width && c.width < 60)) return;
          var img = document.createElement('img'); img.src = new URL(src, location.href).href; img.alt = c.alt || ''; out.appendChild(img); return;
        }
        if (!keep.test(c.tagName)) { out.appendChild(clean(c)); return; }
        var el = document.createElement(c.tagName === 'SPAN' ? 'span' : c.tagName.toLowerCase());
        if (c.tagName === 'A' && c.getAttribute('href')) { try { el.href = new URL(c.getAttribute('href'), location.href).href } catch (e) {} }
        el.appendChild(clean(c)); out.appendChild(el);
      });
      return out;
    }
    var box = document.createElement('div'); box.appendChild(clean(best));
    var meta = function(n){ var m = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]'); return m ? m.getAttribute('content') || '' : '' };
    var h1 = document.querySelector('h1');
    var title = meta('og:title') || (h1 && h1.textContent.trim()) || document.title;
    // Don't repeat the title as the first heading.
    var first = box.querySelector('h1'); if (first && first.textContent.trim() === String(title).trim()) first.remove();
    return {
      title: String(title).trim().slice(0, 300),
      byline: (meta('author') || meta('article:author') || ((document.querySelector('[rel=author],.byline,.author') || {}).textContent || '')).trim().slice(0, 120),
      siteName: (meta('og:site_name') || location.hostname.replace(/^www\\./, '')).slice(0, 80),
      url: location.href,
      html: box.innerHTML,
      textLength: textLen(box)
    };
  } catch (e) { return null; }
})()`

/** Worth showing in reader mode? */
export function isReadable(article) {
  return !!article && (article.textLength || 0) > 600
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** The reader page for an article, in the theme colors C. */
export function readerHtml(article, { size = 18, serif = true } = {}, C) {
  const font = serif ? 'Georgia, "Noto Serif", "Times New Roman", serif' : 'system-ui, -apple-system, Roboto, "Segoe UI", sans-serif'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline'">
<style>
  html, body { background: ${C.bg}; color: ${C.ink}; margin: 0; }
  body { font: ${size}px/1.65 ${font}; padding: 20px 18px 60px; overflow-wrap: break-word; }
  .site { color: ${C.teal}; font: 12px/1.4 ${font}; letter-spacing: .08em; text-transform: uppercase; }
  h1.title { font-size: 1.55em; line-height: 1.25; margin: 8px 0 6px; }
  .by { color: ${C.muted}; font-size: .85em; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 3px dashed ${C.edge}; }
  h1, h2, h3, h4 { line-height: 1.3; }
  a { color: ${C.teal}; }
  img { max-width: 100%; height: auto; display: block; margin: 14px auto; border: 3px solid ${C.edge}; }
  blockquote { margin: 1em 0; padding: .2em 1em; border-left: 4px solid ${C.orange}; color: ${C.muted}; }
  pre, code { font-family: ui-monospace, monospace; font-size: .85em; background: ${C.panel}; }
  pre { padding: 10px; overflow-x: auto; }
  table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; }
  td, th { border: 1px solid ${C.edge}; padding: 4px 8px; }
  hr { border: 0; border-top: 3px dashed ${C.edge}; }
</style></head><body>
<div class="site">${esc(article.siteName)}</div>
<h1 class="title">${esc(article.title)}</h1>
${article.byline ? `<div class="by">${esc(article.byline)}</div>` : '<div class="by"></div>'}
${article.html}
</body></html>`
}

