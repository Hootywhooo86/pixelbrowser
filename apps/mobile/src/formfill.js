// Business details form fill: your company name, contact and address go into
// shipping and checkout forms with one tap. Saved in state.businessProfile
// (on this phone; synced only as part of normal encrypted sync if you add it).

import { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useStore, update } from './store'
import { PButton, Field } from './ui'
import { C, px } from './theme'

export const BUSINESS_FIELDS = [
  ['company', 'Company'],
  ['name', 'Contact name'],
  ['street', 'Street address'],
  ['street2', 'Apt, suite, unit'],
  ['city', 'City'],
  ['region', 'Province / state'],
  ['postal', 'Postal / ZIP code'],
  ['country', 'Country'],
  ['phone', 'Phone'],
  ['email', 'Email'],
]

/**
 * Page script: fills the visible form fields it recognises (by autocomplete,
 * name/id, placeholder, aria-label or <label>) from the profile and posts
 * { __bitFilled: n } with how many fields it filled.
 */
export function fillBusinessJS(profile) {
  const p = profile || {}
  const parts = String(p.name || '').trim().split(/\s+/)
  const data = {
    organization: p.company || '',
    name: p.name || '',
    given: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '',
    family: parts.length > 1 ? parts[parts.length - 1] : '',
    line1: p.street || '',
    line2: p.street2 || '',
    city: p.city || '',
    region: p.region || '',
    postal: p.postal || '',
    country: p.country || '',
    tel: p.phone || '',
    email: p.email || '',
  }
  return String.raw`(function(){
  var D = ${JSON.stringify(data)}, filled = 0;
  var AC = { 'organization': 'organization', 'name': 'name', 'given-name': 'given', 'family-name': 'family', 'address-line1': 'line1', 'street-address': 'line1', 'address-line2': 'line2', 'address-level2': 'city', 'address-level1': 'region', 'postal-code': 'postal', 'country': 'country', 'country-name': 'country', 'tel': 'tel', 'tel-national': 'tel', 'email': 'email' };
  var RULES = [
    ['email', /e-?mail/],
    ['tel', /phone|tel(?!l)|mobile|cell/],
    ['postal', /post(al)?[\s_-]*code|zip|postcode/],
    ['organization', /company|organi[sz]ation|business|firm|org[\s_-]?name/],
    ['given', /first[\s_-]*name|given|fname|forename/],
    ['family', /last[\s_-]*name|surname|family|lname/],
    ['line2', /address[\s_-]*(line)?[\s_-]*2|apt|suite|unit|street2|address2/],
    ['line1', /address[\s_-]*(line)?[\s_-]*1|street|address1|addr(ess)?$|^address/],
    ['city', /city|town|locality|suburb/],
    ['region', /province|state|region|county|prov\b/],
    ['country', /country/],
    ['name', /full[\s_-]*name|your[\s_-]*name|contact[\s_-]*name|^name$|recipient|attention|\bname\b/]
  ];
  function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden' }
  function labelOf(el){
    var t = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label')];
    if (el.id) { var l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'); if (l) t.push(l.textContent) }
    var wrap = el.closest('label'); if (wrap) t.push(wrap.textContent);
    return t.filter(Boolean).join(' ').toLowerCase();
  }
  function keyFor(el){
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).filter(function(x){ return AC[x] })[0];
    if (ac) return AC[ac];
    if (el.type === 'email') return 'email';
    if (el.type === 'tel') return 'tel';
    var text = labelOf(el);
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(text)) return RULES[i][0];
    return '';
  }
  function setValue(el, v){
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
  }
  function fire(el){ el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })) }
  function pick(sel, v){
    var want = String(v).toLowerCase(), opts = sel.options;
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i], t = (o.textContent || '').trim().toLowerCase(), val = String(o.value || '').toLowerCase();
      if (t === want || val === want || (want.length > 2 && (t.indexOf(want) === 0 || want.indexOf(t) === 0 && t.length > 2))) { sel.value = o.value; return true }
    }
    return false;
  }
  var els = document.querySelectorAll('input, select, textarea');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.disabled || el.readOnly || !visible(el)) continue;
    var t = (el.type || 'text').toLowerCase();
    if (/^(hidden|password|checkbox|radio|submit|button|file|image|reset|search|date|number|range|color)$/.test(t)) continue;
    if (el.tagName !== 'SELECT' && el.value) continue; // don't overwrite what's typed
    var k = keyFor(el), v = k && D[k];
    if (!v) continue;
    if (el.tagName === 'SELECT') { if (pick(el, v)) { fire(el); filled++ } continue }
    el.focus && el.focus(); setValue(el, v); fire(el); filled++;
  }
  try { window.ReactNativeWebView.postMessage(JSON.stringify({ __bitFilled: filled })) } catch (e) {}
})();true;`
}

/** Settings editor for the business details. */
export function BusinessProfileForm() {
  const saved = useStore((s) => s.businessProfile) || {}
  const [draft, setDraft] = useState(saved)
  const [done, setDone] = useState(false)
  const set = (k, v) => {
    setDone(false)
    setDraft((d) => ({ ...d, [k]: v }))
  }
  const save = () => {
    const clean = {}
    for (const [k] of BUSINESS_FIELDS) if (String(draft[k] || '').trim()) clean[k] = String(draft[k]).trim().slice(0, 200)
    update((s) => (s.businessProfile = Object.keys(clean).length ? clean : null))
    setDone(true)
  }
  return (
    <View style={st.wrap}>
      <Text style={st.note}>Used by Menu → Fill business details on shipping and checkout forms. Stored on this phone.</Text>
      {BUSINESS_FIELDS.map(([k, label]) => (
        <View key={k} style={st.field}>
          <Text style={st.label}>{label}</Text>
          <Field
            value={draft[k] || ''}
            onChangeText={(v) => set(k, v)}
            placeholder={label}
            accessibilityLabel={label}
            keyboardType={k === 'email' ? 'email-address' : k === 'phone' ? 'phone-pad' : 'default'}
            autoCapitalize={k === 'email' ? 'none' : 'words'}
          />
        </View>
      ))}
      <View style={st.row}>
        <PButton hot icon="star" label="SAVE" onPress={save} />
        {done && <Text style={st.ok}>SAVED</Text>}
        {!!Object.keys(saved).length && (
          <PButton
            small
            label="CLEAR"
            onPress={() => {
              update((s) => (s.businessProfile = null))
              setDraft({})
              setDone(false)
            }}
          />
        )}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { gap: 10 },
  note: { color: C.muted, fontSize: 13, lineHeight: 19 },
  field: { gap: 4 },
  label: { color: C.ink, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  ok: { ...px(8), color: C.teal },
})
