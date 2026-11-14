import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanUrl, deAmp, unwrapRedirect } from '../src/index.js'

test('removes tracking tags, keeps real parameters', () => {
  assert.equal(cleanUrl('https://shop.example.com/p?id=7&utm_source=x&utm_medium=y&fbclid=abc'), 'https://shop.example.com/p?id=7')
  assert.equal(cleanUrl('https://example.com/?gclid=1'), 'https://example.com/')
  assert.equal(cleanUrl('https://example.com/a?gclid=1#top'), 'https://example.com/a#top')
  assert.equal(cleanUrl('https://example.com/a?q=shoes'), 'https://example.com/a?q=shoes')
  assert.equal(cleanUrl('https://youtu.be/abc?si=XYZ&t=30'), 'https://youtu.be/abc?t=30')
  assert.equal(cleanUrl('https://example.com/a?si=keep'), 'https://example.com/a?si=keep')
})

test('leaves sign-in and payment pages alone', () => {
  const u = 'https://accounts.google.com/o/oauth2/auth?utm_source=x&state=1'
  assert.equal(cleanUrl(u), u)
})

test('leaves non-web addresses alone', () => {
  assert.equal(cleanUrl('about:blank'), 'about:blank')
  assert.equal(cleanUrl('blob:https://x/1'), 'blob:https://x/1')
})

test('skips redirect trackers', () => {
  assert.equal(unwrapRedirect('https://www.google.com/url?q=https://example.com/x&sa=D'), 'https://example.com/x')
  assert.equal(cleanUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fnews.example.com%2Fa%3Futm_source%3Dfb&h=AT0'), 'https://news.example.com/a')
  assert.equal(unwrapRedirect('https://www.google.com/search?q=cats'), null)
  assert.equal(unwrapRedirect('https://www.google.com/url?q=javascript:alert(1)'), null)
})

test('De-AMP', () => {
  assert.equal(deAmp('https://www.google.com/amp/s/www.example.com/story.amp'), 'https://www.example.com/story.amp')
  assert.equal(deAmp('https://www-example-com.cdn.ampproject.org/c/s/www.example.com/story'), 'https://www.example.com/story')
  assert.equal(deAmp('https://example.com/amp/x'), null)
})
