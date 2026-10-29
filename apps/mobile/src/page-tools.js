// Page tools: translate (with Bitter, or Google Translate without AI), save
// the page as a PDF, and print the page.

import { Platform, NativeModules } from 'react-native'
import { addLocalFile, openPdf } from './downloads'

const NAMES = {
  en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish',
  ru: 'Russian', uk: 'Ukrainian', tr: 'Turkish', ar: 'Arabic', hi: 'Hindi', bn: 'Bengali', pa: 'Punjabi', ur: 'Urdu',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', ms: 'Malay', tl: 'Filipino',
  sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', el: 'Greek', he: 'Hebrew', cs: 'Czech', ro: 'Romanian', hu: 'Hungarian', fa: 'Persian',
}

/** The phone's language code, like "en" or "fr". */
export function phoneLanguage() {
  let tag = ''
  try {
    tag = Intl.DateTimeFormat().resolvedOptions().locale || ''
  } catch {}
  if (!tag) {
    const s = NativeModules.SettingsManager?.settings
    tag = Platform.OS === 'ios' ? s?.AppleLocale || s?.AppleLanguages?.[0] || '' : NativeModules.I18nManager?.localeIdentifier || ''
  }
  return (tag.split(/[-_]/)[0] || 'en').toLowerCase()
}

/** "French", "English"… for a language code (defaults to the phone's language). */
export function languageName(code = phoneLanguage()) {
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(code)
    if (n && n !== code) return n
  } catch {}
  return NAMES[code] || code
}

/** A Bitter request that translates the current page (pass to AIPanel). */
export function translateRequest(langName = languageName()) {
  return {
    input: `Translate this page into ${langName}. Keep the headings and lists, and translate everything readable on the page, not a summary. If it's already in ${langName}, say so in one line.`,
    mode: 'ask',
    includePage: true,
    nonce: Date.now(),
  }
}

/** No-AI translate: the page through Google Translate. */
export function translateUrl(url, lang = phoneLanguage()) {
  return `https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(lang)}&u=${encodeURIComponent(url)}`
}

/**
 * Page script for browser.run(tabId, GET_HTML_SCRIPT): the page's HTML, title
 * and address, with a <base> so images and styles still load when printed.
 */
export const GET_HTML_SCRIPT = `(function(){
  var doc = document.documentElement.cloneNode(true);
  doc.querySelectorAll('script,noscript,iframe,mark[data-bit-find]').forEach(function(e){ if (e.tagName === 'MARK') e.replaceWith(document.createTextNode(e.textContent)); else e.remove() });
  var head = doc.querySelector('head');
  if (head && !head.querySelector('base')) { var b = document.createElement('base'); b.href = location.href; head.insertBefore(b, head.firstChild) }
  return { html: '<!doctype html>' + doc.outerHTML, title: document.title, url: location.href };
})()`

function safeName(title, url) {
  let n = String(title || '').trim()
  if (!n) {
    try {
      n = new URL(url).hostname
    } catch {
      n = 'page'
    }
  }
  return `${n.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80)}.pdf`
}

/**
 * Save the page as a PDF in Downloads and open it in the PDF viewer.
 * getHtml: async () => ({ html, title, url }), e.g. () => browser.run(tabId, GET_HTML_SCRIPT).
 * Returns the Downloads item.
 */
export async function savePageAsPdf(getHtml) {
  const Print = require('expo-print')
  const page = await getHtml()
  if (!page?.html) throw new Error("Couldn't read this page.")
  const { uri } = await Print.printToFileAsync({ html: page.html })
  const item = await addLocalFile({ path: uri, filename: safeName(page.title, page.url), mime: 'application/pdf' })
  openPdf(item)
  return item
}

/** Print the page (the system print screen also offers "Save as PDF"). */
export async function printPage(getHtml) {
  const Print = require('expo-print')
  const page = await getHtml()
  if (!page?.html) throw new Error("Couldn't read this page.")
  await Print.printAsync({ html: page.html })
}
