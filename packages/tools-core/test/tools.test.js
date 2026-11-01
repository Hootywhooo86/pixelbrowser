import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha1 } from '@noble/hashes/legacy.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  parseBookmarksHtml, parseChromeBookmarksJson, parseCsv, parsePasswordsCsv,
  base32Decode, base32Encode, hotp, totp, parseOtpauth, secondsLeft,
  passwordStrength, findReused, hibpRangeCheck, parseHibpRange,
} from '../src/index.js'

const ascii = (s) => utf8ToBytes(s)

test('bookmarks HTML: folders, roots, entities, dedupe, non-http skipped', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://goshippo.com/" ADD_DATE="1700000000">Shippo &amp; labels</A>
    <DT><H3>Work</H3>
    <DL><p>
      <DT><A HREF="https://github.com/">GitHub</A>
      <DT><A HREF="javascript:alert(1)">Bad</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="https://goshippo.com/">dupe</A>
  <DT><A HREF='https://example.org/a?b=1&amp;c=2'><b>Ex</b></A>
</DL><p>`
  const list = parseBookmarksHtml(html)
  assert.equal(list.length, 3)
  assert.deepEqual(list[0], { url: 'https://goshippo.com/', title: 'Shippo & labels', folder: 'Bookmarks', addedAt: 1700000000000 })
  assert.equal(list[1].folder, 'Work')
  assert.equal(list[2].url, 'https://example.org/a?b=1&c=2')
  assert.equal(list[2].title, 'Ex')
})

test('Chrome Bookmarks JSON', () => {
  const json = { roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
    { type: 'url', name: 'Shippo', url: 'https://goshippo.com', date_added: '13340000000000000' },
    { type: 'folder', name: 'Insurance', children: [{ type: 'url', name: 'Rates', url: 'https://account.ratesinsurance.ca' }] },
  ] }, other: { type: 'folder', name: 'Other bookmarks', children: [{ type: 'url', name: 'chrome', url: 'chrome://settings' }] } }, version: 1 }
  const list = parseChromeBookmarksJson(JSON.stringify(json))
  assert.equal(list.length, 2)
  assert.equal(list[0].folder, 'Bookmarks')
  assert.ok(list[0].addedAt > Date.UTC(2020, 0, 1))
  assert.equal(list[1].folder, 'Insurance')
})

test('CSV parser: quotes, commas, newlines, BOM, CRLF', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","multi\nline"\r\n,,\n1,2,3')
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'multi\nline'], ['1', '2', '3']])
})

test('password CSV formats', () => {
  const chrome = parsePasswordsCsv('name,url,username,password,note\nShippo,https://apps.goshippo.com/login,me@x.com,"p,ass",\nbad,,u,p,\nnopw,https://a.com,u,,')
  assert.equal(chrome.format, 'chrome')
  assert.deepEqual(chrome.logins, [{ url: 'https://apps.goshippo.com/login', username: 'me@x.com', password: 'p,ass', note: '', name: 'Shippo' }])
  assert.equal(chrome.skipped, 2)
  const bw = parsePasswordsCsv('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,G,,,0,https://accounts.google.com,a@b.c,secret1,')
  assert.equal(bw.format, 'bitwarden')
  assert.equal(bw.logins[0].password, 'secret1')
  const ff = parsePasswordsCsv('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://x.org","u","pw",,"https://x.org","{1}","1","1","1"')
  assert.equal(ff.format, 'firefox')
  assert.equal(ff.logins.length, 1)
  const lp = parsePasswordsCsv('url,username,password,totp,extra,name,grouping,fav\nexample.com,u,pw,,,Ex,,0')
  assert.equal(lp.format, 'lastpass')
  assert.equal(lp.logins[0].url, 'https://example.com')
  assert.equal(parsePasswordsCsv('a,b\n1,2').logins.length, 0)
})

test('base32 round trip and errors', () => {
  const bytes = ascii('12345678901234567890')
  assert.equal(base32Encode(bytes), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  assert.deepEqual(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq'), bytes)
  assert.throws(() => base32Decode('ABC1'))
  assert.throws(() => base32Decode(''))
})

test('HOTP RFC 4226 vectors', () => {
  const key = ascii('12345678901234567890')
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
  want.forEach((code, i) => assert.equal(hotp(key, i), code))
})

test('TOTP RFC 6238 vectors (SHA1/256/512, 8 digits)', () => {
  const keys = {
    SHA1: ascii('12345678901234567890'),
    SHA256: ascii('12345678901234567890123456789012'),
    SHA512: ascii('1234567890123456789012345678901234567890123456789012345678901234'),
  }
  const vectors = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ]
  for (const [t, a, b, c] of vectors) {
    assert.equal(totp(keys.SHA1, { time: t * 1000, digits: 8 }), a)
    assert.equal(totp(keys.SHA256, { time: t * 1000, digits: 8, algorithm: 'SHA256' }), b)
    assert.equal(totp(keys.SHA512, { time: t * 1000, digits: 8, algorithm: 'SHA512' }), c)
  }
  assert.equal(secondsLeft(30, 59000), 1)
})

test('otpauth URIs', () => {
  const a = parseOtpauth('otpauth://totp/Shippo:me%40x.com?secret=JBSWY3DPEHPK3PXP&issuer=Shippo')
  assert.deepEqual(a, { secret: 'JBSWY3DPEHPK3PXP', issuer: 'Shippo', account: 'me@x.com', digits: 6, period: 30, algorithm: 'SHA1' })
  const b = parseOtpauth('otpauth://totp/alice?secret=jbsw y3dp&digits=8&period=60&algorithm=SHA256')
  assert.equal(b.issuer, '')
  assert.equal(b.account, 'alice')
  assert.equal(b.digits, 8)
  assert.equal(b.period, 60)
  assert.throws(() => parseOtpauth('otpauth://hotp/x?secret=JBSWY3DP'))
  assert.throws(() => parseOtpauth('https://example.com'))
  assert.throws(() => parseOtpauth('otpauth://totp/x?secret=!!!'))
})

test('password strength', () => {
  assert.equal(passwordStrength('password').score, 0)
  assert.equal(passwordStrength('Password1').score, 0)
  assert.ok(passwordStrength('abcd1234').score <= 1)
  assert.ok(passwordStrength('aaaaaaaa').score <= 1)
  assert.ok(passwordStrength('Tr0ub4dor&3').score >= 2)
  assert.equal(passwordStrength('correct horse battery staple pixel').score, 4)
  assert.equal(passwordStrength('').score, 0)
})

test('reused passwords', () => {
  const r = findReused([{ id: 1, password: 'a' }, { id: 2, password: 'b' }, { id: 3, password: 'a' }, { id: 4, password: '' }])
  assert.equal(r.length, 1)
  assert.deepEqual(r[0].items.map((x) => x.id), [1, 3])
})

test('HIBP k-anonymity: only the prefix is sent, padding header set', async () => {
  const hex = bytesToHex(sha1(ascii('password'))).toUpperCase() // 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  let asked
  const fake = async (url, init) => {
    asked = { url, init }
    return { ok: true, text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9659365\r\n0000000000000000000000000000000000A:0\r\nFFFFF:3' }
  }
  assert.equal(await hibpRangeCheck(hex, fake), 9659365)
  assert.equal(asked.url, 'https://api.pwnedpasswords.com/range/5BAA6')
  assert.equal(asked.init.headers['Add-Padding'], 'true')
  assert.ok(!asked.url.includes(hex.slice(5)))
  const other = bytesToHex(sha1(ascii('not in the list'))).toUpperCase()
  assert.equal(await hibpRangeCheck(other, fake), 0)
  assert.equal(parseHibpRange('ABC:0\nDEF:2').size, 1)
  await assert.rejects(() => hibpRangeCheck('xyz', fake))
  await assert.rejects(() => hibpRangeCheck(hex, async () => ({ ok: false, status: 503 })))
})
