// Media tools for web pages: background play, video speed, sleep timer,
// picture-in-picture, and saving videos/images from a page.
//
// Page scripts post these messages to the app:
//   { __bitMedia: { playing, title, site, video, w, h } }   media started/stopped
//   { __bitImage: { src, alt } }                             long-press on an image
//   { __bitSleepEnded: true }                                "end of video" timer fired

import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { getState } from './store'
import { getSite, setSite } from './site-settings'
import { startDownload, guessFilename } from './downloads'

const native = Platform.OS === 'android' ? requireOptionalNativeModule('BitShields') : null

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/** Background play is on unless the user turned it off (Settings → Media). */
export const backgroundPlayOn = () => getState()?.backgroundPlay !== false

// Pages pause their media when they think they're hidden (YouTube does). While
// background play is on, the page always sees itself as visible.
export const BACKGROUND_PLAY_JS = `(function(){
  if (window.__bitBgPlay) return; window.__bitBgPlay = true;
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: function(){ return false } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return 'visible' } });
    Object.defineProperty(document, 'webkitHidden', { configurable: true, get: function(){ return false } });
  } catch (e) {}
  ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'blur'].forEach(function(t){
    window.addEventListener(t, function(e){ if (t !== 'blur' || e.target === window) e.stopImmediatePropagation() }, true);
    document.addEventListener(t, function(e){ e.stopImmediatePropagation() }, true);
  });
})();`

// Tells the app when media plays or stops (for the notification, PiP and
// background play), and remembers the media for the notification's controls.
export const MEDIA_STATE_JS = `(function(){
  if (window.__bitMediaState) return; window.__bitMediaState = true;
  var last = '', timer = null;
  function post(){
    clearTimeout(timer);
    timer = setTimeout(function(){
      try {
        var list = Array.prototype.slice.call(document.querySelectorAll('video,audio'));
        var on = list.filter(function(m){ return !m.paused && !m.ended && m.readyState > 1 && !m.muted && m.volume > 0 });
        var m = on[0] || window.__bitLastMedia;
        var playing = on.length > 0, isVideo = !!(m && m.tagName === 'VIDEO');
        var msg = { playing: playing, title: (navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title) || document.title || '', site: location.host, video: isVideo, w: isVideo ? (m.videoWidth || 16) : 0, h: isVideo ? (m.videoHeight || 9) : 0 };
        var key = JSON.stringify(msg); if (key === last) return; last = key;
        window.ReactNativeWebView.postMessage(JSON.stringify({ __bitMedia: msg }));
      } catch (e) {}
    }, 250);
  }
  ['play', 'playing', 'pause', 'ended', 'emptied', 'volumechange'].forEach(function(t){
    document.addEventListener(t, function(e){ if (e.target && /^(VIDEO|AUDIO)$/.test(e.target.tagName)) { if (t === 'play' || t === 'playing') window.__bitLastMedia = e.target; post() } }, true);
  });
})();`

/** JS to set every video's speed on the page (and newly added ones). */
export function speedJS(rate) {
  const r = Number(rate) || 1
  return `(function(){
  window.__bitSpeed = ${r};
  function apply(){ document.querySelectorAll('video,audio').forEach(function(m){ if (m.playbackRate !== window.__bitSpeed) m.playbackRate = window.__bitSpeed }) }
  apply();
  if (!window.__bitSpeedHook) {
    window.__bitSpeedHook = true;
    document.addEventListener('play', function(e){ if (e.target && e.target.playbackRate !== undefined && window.__bitSpeed) e.target.playbackRate = window.__bitSpeed }, true);
  }
})();true;`
}

/** The saved speed for a site (1 = normal). */
export const speedFor = (url) => Number(getSite(url)?.speed) || 1

/** Remember a speed for this site and get the JS that applies it now. */
export function setSpeed(url, rate) {
  setSite(url, { speed: rate === 1 ? 0 : rate })
  return speedJS(rate)
}

/** Script injected on load: re-applies the site's saved speed. */
export const siteSpeedJS = (url) => (speedFor(url) !== 1 ? speedJS(speedFor(url)) : '')

export const PAUSE_ALL_JS = `document.querySelectorAll('video,audio').forEach(function(m){ try { m.pause() } catch (e) {} });true;`

// Notification "Play": resume the media that was playing last.
export const RESUME_JS = `(function(){ var m = window.__bitLastMedia || document.querySelector('video,audio'); if (m) { try { m.play() } catch (e) {} } })();true;`

// Sleep timer "end of this video": pause when the current media ends and
// stop autoplay moving on to the next one.
export const PAUSE_AT_END_JS = `(function(){
  window.__bitSleepAtEnd = true;
  if (window.__bitSleepEndHook) return; window.__bitSleepEndHook = true;
  document.addEventListener('ended', function(e){
    if (!window.__bitSleepAtEnd) return;
    window.__bitSleepAtEnd = false;
    document.querySelectorAll('video,audio').forEach(function(m){ try { m.pause() } catch (x) {} });
    setTimeout(function(){ document.querySelectorAll('video,audio').forEach(function(m){ try { m.pause() } catch (x) {} }) }, 1500);
    window.ReactNativeWebView.postMessage(JSON.stringify({ __bitSleepEnded: true }));
  }, true);
})();true;`

export const CANCEL_PAUSE_AT_END_JS = `window.__bitSleepAtEnd = false;true;`

// ---------- sleep timer (pauses media in every tab) ----------

let sleep = { timer: null, endsAt: 0, atEnd: false }
const sleepListeners = new Set()
const tellSleep = () => sleepListeners.forEach((fn) => fn({ endsAt: sleep.endsAt, atEnd: sleep.atEnd }))

export function onSleepChange(fn) {
  sleepListeners.add(fn)
  fn({ endsAt: sleep.endsAt, atEnd: sleep.atEnd })
  return () => sleepListeners.delete(fn)
}

/**
 * choice: minutes (15/30/60…), 'end' (end of the current video) or null to cancel.
 * pauseAll(js) must inject the given JS into every open tab.
 */
export function setSleepTimer(choice, pauseAll) {
  clearTimeout(sleep.timer)
  if (sleep.atEnd) pauseAll(CANCEL_PAUSE_AT_END_JS)
  sleep = { timer: null, endsAt: 0, atEnd: false }
  if (choice === 'end') {
    sleep.atEnd = true
    pauseAll(PAUSE_AT_END_JS)
  } else if (Number(choice) > 0) {
    sleep.endsAt = Date.now() + Number(choice) * 60000
    sleep.timer = setTimeout(() => {
      pauseAll(PAUSE_ALL_JS)
      sleep = { timer: null, endsAt: 0, atEnd: false }
      native?.stopMedia?.()
      tellSleep()
    }, Number(choice) * 60000)
  }
  tellSleep()
}

/** Call when a page reports { __bitSleepEnded }. */
export function sleepEnded() {
  sleep = { timer: null, endsAt: 0, atEnd: false }
  native?.stopMedia?.()
  tellSleep()
}

// ---------- background play + notification ----------

/** Call with the page's { __bitMedia } message (active or background tab). */
export function reportMedia(msg) {
  if (!native?.mediaState) return
  if (msg.playing && !backgroundPlayOn()) return
  try {
    native.mediaState(!!msg.playing, String(msg.title || '').slice(0, 120), String(msg.site || ''))
  } catch {}
}

export function setBackgroundPlay(on) {
  try {
    native?.setBackgroundPlay?.(!!on)
  } catch {}
}

/** Notification / headphone buttons: fn('play' | 'pause'). Returns an unsubscribe. */
export function onMediaControl(fn) {
  const sub = native?.addListener?.('onMediaControl', (e) => fn(e?.action))
  return () => sub?.remove?.()
}

export const stopMediaNotification = () => {
  try {
    native?.stopMedia?.()
  } catch {}
}

// ---------- picture-in-picture (Android) ----------

export const isPipSupported = () => {
  try {
    return !!native?.isPipSupported?.()
  } catch {
    return false
  }
}

export const enterPip = (w = 16, h = 9) => {
  try {
    return !!native?.enterPip?.(Math.round(w) || 16, Math.round(h) || 9)
  } catch {
    return false
  }
}

/** While a video is full screen, pressing Home turns it into a floating window. */
export const setAutoPip = (on, w = 16, h = 9) => {
  try {
    native?.setAutoPip?.(!!on, Math.round(w) || 16, Math.round(h) || 9)
  } catch {}
}

/** fn(true) when the app shrinks into PiP, fn(false) when it comes back. */
export function onPipChanged(fn) {
  const sub = native?.addListener?.('onPipChanged', (e) => fn(!!e?.pip))
  return () => sub?.remove?.()
}

// ---------- saving media ----------

// Sites whose videos can't be saved: their terms forbid it, and their video
// files are streamed in pieces anyway.
const NO_SAVE = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com|netflix\.com|nflxvideo\.net|disneyplus\.com|primevideo\.com|hulu\.com|max\.com|spotify\.com|tiktok\.com|tiktokcdn\.com|instagram\.com|cdninstagram\.com|fbcdn\.net|twitch\.tv)$/i

const hostOf = (u) => {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}

/** null if it can be saved, or a short reason why not. */
export function cantSave(url, pageUrl) {
  if (!/^https?:/i.test(url || '')) return url?.startsWith('blob:') ? 'This video streams in pieces, so there is no single file to save.' : "This file can't be saved."
  if (NO_SAVE.test(hostOf(url)) || NO_SAVE.test(hostOf(pageUrl))) return "This site doesn't allow saving its videos (their terms forbid it, and the video streams in pieces)."
  return null
}

// Lists the page's direct video/audio files and its images.
export const MEDIA_LIST_JS = `(function(){
  function abs(u){ try { return new URL(u, location.href).href } catch (e) { return '' } }
  var seen = {}, videos = [], images = [];
  document.querySelectorAll('video,audio').forEach(function(m){
    var srcs = [m.currentSrc || m.src].concat(Array.prototype.map.call(m.querySelectorAll('source'), function(s){ return s.src }));
    srcs.forEach(function(s){ s = abs(s); if (s && !seen[s]) { seen[s] = 1; videos.push({ src: s, kind: m.tagName.toLowerCase(), poster: m.poster ? abs(m.poster) : '', duration: isFinite(m.duration) ? Math.round(m.duration) : 0 }) } });
  });
  Array.prototype.slice.call(document.images).forEach(function(i){
    var s = abs(i.currentSrc || i.src);
    if (!s || seen[s] || /^data:/.test(s) || i.naturalWidth < 120 || i.naturalHeight < 120) return;
    seen[s] = 1; images.push({ src: s, w: i.naturalWidth, h: i.naturalHeight, alt: (i.alt || '').slice(0, 80) });
  });
  return { videos: videos.slice(0, 30), images: images.slice(0, 60) };
})()`

// Long-press (or right-click) an image: ask the app to offer "Save image".
export const LONG_PRESS_IMAGE_JS = `(function(){
  if (window.__bitImgHook) return; window.__bitImgHook = true;
  var t = null, sx = 0, sy = 0;
  function img(el){ while (el && el !== document) { if (el.tagName === 'IMG') return el; el = el.parentNode } return null }
  function send(i){ var s = i.currentSrc || i.src; if (!s || /^data:/.test(s) && s.length > 200000) return; window.ReactNativeWebView.postMessage(JSON.stringify({ __bitImage: { src: s, alt: (i.alt || '').slice(0, 80) } })) }
  document.addEventListener('touchstart', function(e){
    var i = img(e.target); if (!i || e.touches.length > 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    clearTimeout(t); t = setTimeout(function(){ t = null; send(i) }, 650);
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', function(e){ if (t && (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10)) { clearTimeout(t); t = null } }, { capture: true, passive: true });
  ['touchend', 'touchcancel', 'scroll'].forEach(function(n){ document.addEventListener(n, function(){ clearTimeout(t); t = null }, { capture: true, passive: true }) });
  document.addEventListener('contextmenu', function(e){ var i = img(e.target); if (i) { e.preventDefault(); send(i) } }, true);
})();`

/** All media page scripts, for injectedJavaScript (background play only when on). */
export const mediaPageJS = () => `${backgroundPlayOn() ? BACKGROUND_PLAY_JS : ''}\n${MEDIA_STATE_JS}\n${LONG_PRESS_IMAGE_JS}`

/**
 * Save a video/audio file or image found on the page.
 * Returns the download item, or { status: 'failed', error } when not allowed.
 */
export function saveMedia(item, pageUrl) {
  const why = cantSave(item.src, pageUrl)
  if (why) return Promise.resolve({ status: 'failed', error: why })
  if (/^data:image\//.test(item.src)) return Promise.resolve({ status: 'failed', error: 'This image is built into the page; take a screenshot instead.' })
  return startDownload({ url: item.src, filename: guessFilename(item.src), referer: pageUrl })
}
