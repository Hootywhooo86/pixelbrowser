// Clean links: take tracking tags out of web addresses before a page opens,
// skip Google AMP copies, and jump straight past "redirect" tracking links
// (google.com/url?q=…, l.facebook.com/l.php?u=…). Brave calls these query
// filtering, De-AMP and debouncing. Pure functions, shared by phone and computer.

// Parameters removed everywhere. Only ones used purely for tracking: removing
// them never changes what the page shows.
const ALWAYS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'li_fat_id', 'igshid', 'igsh', 'mc_eid', 'mkt_tok', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp',
  'hsctatracking', 'oly_anon_id', 'oly_enc_id', '_openstat', 'vero_id', 'vero_conv', 'wickedid',
  'rb_clickid', 's_cid', 'ck_subscriber_id', 'epik', 'gad_source', 'gad_campaignid', 'srsltid',
  '_branch_match_id', '_branch_referrer', 'ml_subscriber', 'ml_subscriber_hash', 'rdt_cid', 'irclickid',
  'ss_email_id', 'bsft_clkid', 'bsft_uid', 'guce_referrer', 'guce_referrer_sig', '_kx', 'sc_cid',
])
const PREFIXES = ['utm_', 'pk_', 'hsa_', 'mtm_']

// Parameters that are tracking only on certain sites.
const PER_SITE = [
  [/(^|\.)youtube\.com$|^youtu\.be$/, ['si', 'pp', 'feature']],
  [/(^|\.)(twitter|x)\.com$/, ['s', 't', 'ref_src', 'ref_url']],
  [/(^|\.)instagram\.com$/, ['igshid', 'igsh', 'img_index']],
  [/(^|\.)spotify\.com$/, ['si', 'nd', 'context']],
  [/(^|\.)tiktok\.com$/, ['_r', '_t', 'is_from_webapp', 'sender_device', 'sender_web_id']],
  [/(^|\.)amazon\.[a-z.]+$/, ['ref_', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_p', 'pf_rd_r', 'pd_rd_i', 'psc', 'content-id', 'qid', 'sr', 'sprefix', 'crid', 'dib', 'dib_tag']],
  [/(^|\.)linkedin\.com$/, ['trk', 'trackingid', 'lipi', 'refid']],
  [/(^|\.)reddit\.com$/, ['share_id', 'utm_name', 'ref', 'ref_source']],
  [/(^|\.)ebay\.[a-z.]+$/, ['_trkparms', '_trksid', 'amdata', 'mkcid', 'mkrid', 'campid', 'toolid', 'mkevt']],
  [/(^|\.)aliexpress\.com$/, ['spm', 'scm', 'pvid', 'algo_pvid', 'algo_exp_id', 'aff_platform', 'aff_trace_key', 'sk']],
]

// Redirect trackers: the real address is in a parameter. [host test, path test, param names]
const REDIRECTS = [
  [/^(www\.)?google\.[a-z.]+$/, /^\/url$/, ['q', 'url']],
  [/^(l|lm)\.facebook\.com$/, /^\/l\.php$/, ['u']],
  [/^l\.instagram\.com$/, /^\/$/, ['u']],
  [/^(www\.)?youtube\.com$/, /^\/redirect$/, ['q']],
  [/^out\.reddit\.com$/, /.*/, ['url']],
  [/^(www\.)?linkedin\.com$/, /^\/redir\/redirect/, ['url']],
  [/^disq\.us$/, /^\/url$/, ['url']],
  [/^steamcommunity\.com$/, /^\/linkfilter\/?$/, ['url', 'u']],
  [/^(www\.)?deviantart\.com$/, /^\/users\/outgoing$/, []], // address is the whole query
  [/^slack-redir\.net$/, /^\/link$/, ['url']],
  [/^(www\.)?bing\.com$/, /^\/ck\/a$/, ['u']], // base64 "a1" + address
  [/^click\.linksynergy\.com$/, /.*/, ['murl', 'RD_PARM1']],
  [/^(www\.)?awin1\.com$/, /^\/cread\.php$/, ['ued', 'p']],
  [/^go\.redirectingat\.com$/, /.*/, ['url']],
  [/^(www\.)?anrdoezrs\.net|^(www\.)?dpbolvw\.net|^(www\.)?jdoqocy\.com|^(www\.)?kqzyfj\.com|^(www\.)?tkqlhce\.com$/, /^\/click/, ['url']],
]

// Sign-in, payment and checkout flows can sign their addresses: never touch those.
const HANDS_OFF = /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|paypal\.com|stripe\.com|checkout\.shopify\.com|auth0\.com|okta\.com|claude\.ai|anthropic\.com)$/

const lower = (s) => String(s || '').toLowerCase()

function stripTracking(u) {
  const host = lower(u.hostname)
  if (HANDS_OFF.test(host) || !u.search) return false
  const site = PER_SITE.filter(([re]) => re.test(host)).flatMap(([, names]) => names)
  let changed = false
  for (const key of [...u.searchParams.keys()]) {
    const k = lower(key)
    if (ALWAYS.has(k) || PREFIXES.some((p) => k.startsWith(p)) || site.includes(k)) {
      u.searchParams.delete(key)
      changed = true
    }
  }
  return changed
}

function toUrl(s) {
  try {
    const u = new URL(s)
    return /^https?:$/.test(u.protocol) ? u : null
  } catch {
    return null
  }
}

function bingTarget(v) {
  // Bing: u=a1aHR0cHM6Ly9... (base64url of the address after "a1")
  if (!/^a1/.test(v)) return null
  try {
    const b = v.slice(2).replace(/-/g, '+').replace(/_/g, '/')
    const text = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('utf8')
    return text
  } catch {
    return null
  }
}

/** The real address behind a redirect-tracking link, or null. */
export function unwrapRedirect(url) {
  const u = toUrl(url)
  if (!u) return null
  const host = lower(u.hostname)
  for (const [h, p, names] of REDIRECTS) {
    if (!h.test(host) || !p.test(u.pathname)) continue
    if (!names.length) {
      const raw = decodeURIComponent(u.search.slice(1))
      return toUrl(raw) ? raw : null
    }
    for (const n of names) {
      let v = u.searchParams.get(n)
      if (!v) continue
      if (/bing\.com$/.test(host)) v = bingTarget(v)
      if (v && toUrl(v)) return v
    }
  }
  return null
}

/** The publisher's own page for a Google AMP copy, or null. */
export function deAmp(url) {
  const u = toUrl(url)
  if (!u) return null
  const host = lower(u.hostname)
  // https://www.google.com/amp/s/example.com/story  ->  https://example.com/story
  let m = /^(www\.)?google\.[a-z.]+$/.test(host) && u.pathname.match(/^\/amp\/(s\/)?(.+)$/)
  if (m) return toUrl(`${m[1] ? 'https' : 'http'}://${m[2]}${u.search}`)?.href || null
  // https://example-com.cdn.ampproject.org/c/s/example.com/story  ->  https://example.com/story
  m = /\.cdn\.ampproject\.org$/.test(host) && u.pathname.match(/^\/[a-z]\/(s\/)?(.+)$/)
  if (m) return toUrl(`${m[1] ? 'https' : 'http'}://${m[2]}${u.search}`)?.href || null
  return null
}

/**
 * Cleans a link: follows redirect trackers and AMP copies to the real page
 * (up to 3 hops), then removes tracking tags. Returns the cleaned address, or
 * the same string when there's nothing to clean.
 */
export function cleanUrl(url) {
  let cur = String(url || '')
  for (let i = 0; i < 3; i++) {
    const next = unwrapRedirect(cur) || deAmp(cur)
    if (!next || next === cur) break
    cur = next
  }
  const u = toUrl(cur)
  if (!u) return cur
  if (!stripTracking(u)) return cur
  // Keep "?" off when every parameter went.
  return u.href.replace(/\?(#|$)/, '$1')
}

/**
 * Page script for AMP pages served by the publisher: <html amp> or <html ⚡>
 * with a normal version linked as canonical. Opens the normal version instead.
 */
export const DE_AMP_JS = `(function(){try{
var d=document.documentElement;if(!d||!(d.hasAttribute('amp')||d.hasAttribute('\\u26A1')))return;
var go=function(){var l=document.querySelector('link[rel="canonical"]');if(!l||!l.href)return;
var c=new URL(l.href,location.href);if(c.href===location.href||!/^https?:$/.test(c.protocol))return;
if(sessionStorage.getItem('bit-deamp')===location.href)return;sessionStorage.setItem('bit-deamp',location.href);
location.replace(c.href)};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go,{once:true});else go();
}catch(e){}})();true;`
