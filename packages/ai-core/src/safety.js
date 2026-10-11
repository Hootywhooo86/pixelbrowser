// Guard rails for the assistant: when to ask before reading a page, and
// which agent actions need the user's OK first.

const SENSITIVE_HOSTS =
  /(^|\.)(paypal|venmo|chase|wellsfargo|bankofamerica|citi|capitalone|americanexpress|amex|schwab|fidelity|vanguard|coinbase|robinhood|kraken|binance|mychart|healthcare|irs|ssa|1password|bitwarden|lastpass|dashlane)\.|bank|banking|patient|medical|health/i

const RISKY_WORDS =
  /\b(buy|purchase|pay|payment|place order|checkout|check out|order now|confirm|submit|send|post|publish|tweet|reply|delete|remove|cancel (my )?(account|subscription)|transfer|withdraw|deposit|subscribe|sign up|book now|reserve|donate|accept|agree|authori[sz]e|log ?in|sign ?in|unsubscribe)\b/i

const SECRET_FIELDS = /(password|passcode|pin|cvv|cvc|card|cc-|ssn|social|security code|iban|routing|account number)/i

export function isSensitivePage(page = {}) {
  if (page.hasPassword) return 'This page has a password field.'
  let host = ''
  try {
    host = new URL(page.url).hostname
  } catch {
    return null
  }
  if (SENSITIVE_HOSTS.test(host)) return `${host} looks like a banking, health or password site.`
  return null
}

/** Returns a reason string if the action should be confirmed, else null. */
export function riskyActionReason(action, element) {
  if (!element) return null
  const label = [element.label, element.name, element.autocomplete].filter(Boolean).join(' ')
  if (action.kind === 'type') {
    if (element.type === 'password' || SECRET_FIELDS.test(label)) return `Typing into a sensitive field (${element.label || element.name || element.type}).`
    // Pressing Enter in a message box sends it; in a search box it just searches.
    if (action.submit && (element.tag === 'textarea' || element.type === 'contenteditable' || RISKY_WORDS.test(label))) {
      return `Typing and sending "${String(action.text).slice(0, 60)}".`
    }
  }
  if ((action.kind === 'click' || action.kind === 'press') && RISKY_WORDS.test(element.label || '')) {
    return `Clicking "${element.label}".`
  }
  return null
}

export function isAllowedUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}
