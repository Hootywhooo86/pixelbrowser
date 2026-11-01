// Password health: strength, reuse, and breach checks.
//
// Breach checks use Have I Been Pwned's k-anonymity range API: only the first
// 5 characters of the password's SHA-1 hash ever leave the device, and the
// response is padded so its size doesn't give anything away either.

// The most common leaked passwords (a short built-in list; enough to flag the
// worst ones without a download).
const COMMON = new Set(
  (
    '123456 123456789 12345 qwerty password 12345678 111111 123123 1234567890 1234567 qwerty123 000000 1q2w3e aa12345678 abc123 password1 1234 qwertyuiop 123321 password123 ' +
    '654321 666666 987654321 123 7777777 1qaz2wsx 121212 qwe123 iloveyou 112233 123qwe dragon monkey letmein football baseball welcome admin login master sunshine ' +
    'princess shadow superman michael charlie donald freedom whatever trustno1 passw0rd starwars hello hello123 asdfgh asdfghjkl zxcvbnm zaq12wsx 1q2w3e4r 1q2w3e4r5t ' +
    'qazwsx 159753 987654 999999 888888 555555 444444 333333 222222 11111111 00000000 abcd1234 a123456 123abc 1234qwer qwer1234 q1w2e3r4 google computer internet ' +
    'mustang jordan jennifer hunter killer soccer hockey batman thomas tigger buster pepper ginger summer flower cookie chocolate hannah daniel jessica ashley andrew ' +
    'michelle nicole matthew joshua amanda love loveme lovely angel angels babygirl secret access pass 1password password! changeme default guest test test123 demo ' +
    'samsung apple iphone android canada toronto hockey1 maple qwerty1 qwerty12 abc12345 123456a 123456q 123654 147258 147258369 258456 789456 789456123 159357 ' +
    'aaaaaa asd123 asdf asdf1234 zxcv1234 1qazxsw2 qwaszx 7654321 654321a password12 password2 welcome1 welcome123 admin123 root toor letmein1 monkey1 dragon1'
  ).split(' ')
)

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '01234567890', '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p']

/** Strength 0–4 (0 = very weak … 4 = strong) with plain-language advice. */
export function passwordStrength(pw) {
  const s = String(pw || '')
  const lower = s.toLowerCase()
  const tips = []
  if (!s) return { score: 0, label: 'Empty', tips: ['Type a password.'] }
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[!1.]+$/, ''))) return { score: 0, label: 'Very weak', tips: ['This is one of the most common passwords. Pick something unique.'] }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length
  let bits = s.length * Math.log2([0, 26, 52, 62, 94][classes] || 26)
  // Penalties for patterns guessers try first.
  if (/(.)\1{2,}/.test(s)) (bits *= 0.7), tips.push('Avoid repeated characters.')
  for (const seq of SEQUENCES) for (let i = 0; i + 4 <= seq.length; i++) if (lower.includes(seq.slice(i, i + 4))) {
    bits *= 0.75
    tips.push('Avoid keyboard runs and sequences like "abcd" or "1234".')
    i = seq.length
  }
  if (/^(19|20)\d{2}$|(19|20)\d{2}$/.test(s)) (bits *= 0.85), tips.push('Years are easy to guess.')
  if (s.length < 8) tips.push('Use at least 12 characters.')
  else if (s.length < 12) tips.push('Longer is stronger: 12+ characters, or a few random words.')
  if (classes < 3 && s.length < 16) tips.push('Mix letters, numbers and symbols, or use a longer passphrase.')
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4
  return { score, label: ['Very weak', 'Weak', 'Okay', 'Good', 'Strong'][score], tips: [...new Set(tips)] }
}

/** Logins sharing a password: [{ password, items: [login…] }] (2+ items each). */
export function findReused(logins) {
  const by = new Map()
  for (const l of logins || []) {
    if (!l?.password) continue
    if (!by.has(l.password)) by.set(l.password, [])
    by.get(l.password).push(l)
  }
  return [...by.entries()].filter(([, items]) => items.length > 1).map(([password, items]) => ({ password, items }))
}

/** Parse a range response ("SUFFIX:COUNT" lines) into a Map. */
export function parseHibpRange(text) {
  const map = new Map()
  for (const line of String(text || '').split(/\r?\n/)) {
    const [suffix, count] = line.trim().split(':')
    if (suffix && count && Number(count) > 0) map.set(suffix.toUpperCase(), Number(count))
  }
  return map
}

/**
 * How many times a password (given as its SHA-1 hex) appears in known breaches.
 * fetchFn(url, init) is fetch. Only the 5-character prefix is sent.
 */
export async function hibpRangeCheck(sha1Hex, fetchFn = globalThis.fetch) {
  const hex = String(sha1Hex || '').toUpperCase()
  if (!/^[0-9A-F]{40}$/.test(hex)) throw new Error('Expected a SHA-1 hex digest.')
  const res = await fetchFn(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } })
  if (!res.ok) throw new Error(`The breach check service answered ${res.status}.`)
  return parseHibpRange(await res.text()).get(hex.slice(5)) || 0
}
