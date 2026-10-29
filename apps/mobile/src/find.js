// Find in page. The web view has no find bar of its own, so these scripts mark
// every match with <mark data-bit-find>, scroll to the current one and report
// back { __bitFind: { index, total } } (index is 1-based, 0 when nothing matches).

const SCRIPT = String.raw`(function(){
  if (window.__bitFind) return;
  var state = { q: '', marks: [], i: -1 };
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)) } catch (e) {} }
  function clear(){
    var marks = document.querySelectorAll('mark[data-bit-find]');
    for (var k = 0; k < marks.length; k++) {
      var m = marks[k], p = m.parentNode; if (!p) continue;
      p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
    }
    state = { q: '', marks: [], i: -1 };
  }
  function visible(el){
    for (; el && el.nodeType === 1; el = el.parentElement) {
      var t = el.tagName; if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEXTAREA' || t === 'TEMPLATE') return false;
      var cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }
  function search(q){
    clear(); state.q = q;
    if (!q || !document.body) return;
    var needle = q.toLowerCase(), nodes = [];
    var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    for (var n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue && n.nodeValue.toLowerCase().indexOf(needle) >= 0 && visible(n.parentElement)) nodes.push(n);
    for (var j = 0; j < nodes.length && state.marks.length < 1000; j++) {
      var node = nodes[j];
      for (;;) {
        var at = node.nodeValue.toLowerCase().indexOf(needle); if (at < 0) break;
        var hit = node.splitText(at); node = hit.splitText(needle.length);
        var mark = document.createElement('mark'); mark.setAttribute('data-bit-find', '');
        mark.style.cssText = 'background:#ff9f1c;color:#0b0b16;padding:0;border-radius:0';
        hit.parentNode.replaceChild(mark, hit); mark.appendChild(hit);
        state.marks.push(mark);
      }
    }
  }
  function show(){
    for (var k = 0; k < state.marks.length; k++) state.marks[k].style.background = k === state.i ? '#2dd4bf' : '#ff9f1c';
    var cur = state.marks[state.i];
    if (cur) try { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch (e) { cur.scrollIntoView() }
    post({ __bitFind: { index: state.marks.length ? state.i + 1 : 0, total: state.marks.length } });
  }
  window.__bitFind = function(q, dir){
    q = String(q || '');
    if (q !== state.q || !state.marks.length || !document.contains(state.marks[0])) { search(q); state.i = state.marks.length ? 0 : -1 }
    else if (dir) state.i = (state.i + (dir < 0 ? -1 : 1) + state.marks.length) % state.marks.length;
    show();
  };
  window.__bitFindClear = clear;
})();`

/**
 * Find `query` on the page. direction: 0 = new search (or the same query again),
 * 1 = next match, -1 = previous match.
 */
export function findJS(query, direction = 0) {
  return `${SCRIPT}\n;window.__bitFind(${JSON.stringify(String(query || ''))}, ${Number(direction) || 0});true;`
}

/** Remove all find highlights. */
export const clearFindJS = `${SCRIPT}\n;window.__bitFindClear && window.__bitFindClear();true;`
