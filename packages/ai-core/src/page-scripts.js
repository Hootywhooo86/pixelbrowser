// JavaScript that runs inside web pages to read them and act on them.
// These are plain source strings (not functions) because the mobile JS
// engine (Hermes) can't turn compiled functions back into source.
// Each script is an expression that evaluates to a JSON-serializable value.

const MAX_PAGE_CHARS = 24000

export const EXTRACT_PAGE = `(() => {
  const pick = document.querySelector('article, main, [role=main]');
  let root = pick && (pick.innerText || '').trim().length > 400 ? pick : document.body;
  const text = ((root && root.innerText) || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  const sel = String(window.getSelection ? window.getSelection() : '');
  return {
    title: document.title,
    url: location.href,
    text: text.slice(0, ${MAX_PAGE_CHARS}),
    truncated: text.length > ${MAX_PAGE_CHARS},
    selection: sel.slice(0, 4000),
    hasPassword: !!document.querySelector('input[type=password]'),
  };
})()`

// Numbers every visible interactive element (data-pixel-ref) so the agent
// can say "click 12". Elements in the viewport come first.
export const SNAPSHOT_PAGE = `(() => {
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [role=option], [role=combobox], [contenteditable=""], [contenteditable=true], [onclick]';
  const vh = window.innerHeight, vw = window.innerWidth;
  const items = [];
  document.querySelectorAll('[data-pixel-ref]').forEach((el) => el.removeAttribute('data-pixel-ref'));
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
    if (el.disabled) continue;
    const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    items.push({ el, r, inView });
  }
  items.sort((a, b) => (b.inView - a.inView) || (a.r.top - b.r.top));
  const out = [];
  let n = 0;
  for (const { el, inView } of items.slice(0, 180)) {
    n += 1;
    el.setAttribute('data-pixel-ref', String(n));
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.alt || el.name || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    out.push({
      ref: n,
      tag,
      type: el.isContentEditable ? 'contenteditable' : (el.type || el.getAttribute('role') || undefined),
      label,
      href: tag === 'a' ? (el.getAttribute('href') || '').slice(0, 120) : undefined,
      value: (tag === 'input' || tag === 'textarea' || tag === 'select') && el.type !== 'password' ? String(el.value || '').slice(0, 60) : undefined,
      autocomplete: el.getAttribute('autocomplete') || undefined,
      name: el.name || undefined,
      inView,
    });
  }
  const text = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 3000);
  return { title: document.title, url: location.href, scrollY: Math.round(scrollY), pageHeight: document.body.scrollHeight, elements: out, text };
})()`

const FIND = (ref) => `document.querySelector('[data-pixel-ref="' + ${JSON.stringify(String(ref))} + '"]')`

const FLASH = `(el) => {
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ff9f1c;box-shadow:0 0 0 3px #0b0b16;left:' + (r.left - 4) + 'px;top:' + (r.top - 4) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px';
  document.documentElement.appendChild(box);
  setTimeout(() => box.remove(), 900);
}`

/** Scroll an element into view and return its center (for real mouse clicks on desktop). */
export function locateScript(ref) {
  return `(() => {
    const el = ${FIND(ref)};
    if (!el) return { ok: false, message: 'Element ${ref} is gone. Call look again.' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    (${FLASH})(el);
    return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`
}

/** Focus an element (desktop then types with real key events). */
export function focusScript(ref, { clear = true } = {}) {
  return `(() => {
    const el = ${FIND(ref)};
    if (!el) return { ok: false, message: 'Element ${ref} is gone. Call look again.' };
    el.scrollIntoView({ block: 'center' });
    (${FLASH})(el);
    el.focus();
    if (${clear}) {
      if ('value' in el && el.tagName !== 'SELECT') { el.select && el.select(); }
      else if (el.isContentEditable) { document.execCommand('selectAll'); }
    }
    return { ok: true };
  })()`
}

/**
 * Do an action with synthetic DOM events. Used on mobile, and on desktop for
 * actions that don't need real input (select, scroll).
 * action: { kind: 'click'|'type'|'select'|'scroll'|'press', ref?, text?, submit?, value?, direction?, key? }
 */
export function actScript(action) {
  return `(() => {
    const a = ${JSON.stringify(action)};
    const flash = ${FLASH};
    if (a.kind === 'scroll') {
      const dy = (a.direction === 'up' ? -1 : 1) * window.innerHeight * 0.8;
      window.scrollBy({ top: dy, behavior: 'instant' });
      return { ok: true, message: 'Scrolled ' + (a.direction || 'down') + '. Now at ' + Math.round(scrollY) + ' of ' + document.body.scrollHeight + 'px.' };
    }
    if (a.kind === 'press') {
      const t = document.activeElement || document.body;
      const opts = { key: a.key, code: a.key, bubbles: true, cancelable: true };
      t.dispatchEvent(new KeyboardEvent('keydown', opts));
      if (a.key === 'Enter' && t.form && t.form.requestSubmit) t.form.requestSubmit();
      t.dispatchEvent(new KeyboardEvent('keyup', opts));
      return { ok: true, message: 'Pressed ' + a.key + '.' };
    }
    const el = document.querySelector('[data-pixel-ref="' + a.ref + '"]');
    if (!el) return { ok: false, message: 'Element ' + a.ref + ' is gone. Call look again.' };
    el.scrollIntoView({ block: 'center' });
    flash(el);
    if (a.kind === 'click') {
      el.focus && el.focus();
      el.click();
      return { ok: true, message: 'Clicked ' + a.ref + '.' };
    }
    if (a.kind === 'select') {
      const opt = Array.from(el.options || []).find((o) => o.value === a.value || o.text.trim() === a.value);
      if (!opt) return { ok: false, message: 'No option "' + a.value + '".' };
      el.value = opt.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, message: 'Selected "' + opt.text.trim() + '".' };
    }
    if (a.kind === 'type') {
      el.focus();
      if (el.isContentEditable) {
        document.execCommand('selectAll');
        document.execCommand('insertText', false, a.text);
      } else {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, a.text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (a.submit) {
        const opts = { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        if (el.form && el.form.requestSubmit) el.form.requestSubmit();
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
      }
      return { ok: true, message: 'Typed into ' + a.ref + (a.submit ? ' and submitted.' : '.') };
    }
    return { ok: false, message: 'Unknown action ' + a.kind };
  })()`
}
