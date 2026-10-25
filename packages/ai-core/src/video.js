// YouTube video summaries from the video's own captions.

export function isYouTubeWatch(url) {
  try {
    const u = new URL(url)
    const host = u.host.replace(/^(www|m|music)\./, '')
    if (host === 'youtu.be') return u.pathname.length > 1
    return host === 'youtube.com' && (u.pathname === '/watch' && u.searchParams.has('v') || u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/live/'))
  } catch {
    return false
  }
}

/** Caption JSON (fmt=json3) -> plain text. */
export function parseJson3(data, maxChars = 60000) {
  const events = data?.events || []
  const lines = []
  for (const e of events) {
    if (!e.segs) continue
    const line = e.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim()
    if (line && line !== lines[lines.length - 1]) lines.push(line)
  }
  const text = lines.join(' ')
  return text.length > maxChars ? `${text.slice(0, maxChars)} [transcript truncated]` : text
}

/** Pick the best caption track: the user's language, then English, then the first. Prefers human captions over auto-generated. */
export function pickTrack(tracks = [], lang = 'en') {
  if (!tracks.length) return null
  const base = String(lang || 'en').toLowerCase().split('-')[0]
  const score = (t) => {
    const code = String(t.languageCode || '').toLowerCase()
    let s = 0
    if (code.split('-')[0] === base) s += 4
    else if (code.startsWith('en')) s += 2
    if (t.kind !== 'asr') s += 1
    return s
  }
  return [...tracks].sort((a, b) => score(b) - score(a))[0]
}

// Runs in the page. Finds the caption tracks, fetches one as json3 from the
// page's own origin, and returns { ok, title, channel, lang, json3 } or
// { ok:false, reason, title, description }. Parsing happens in ai-core.
export const VIDEO_TRANSCRIPT = `(async () => {
  const lang = (navigator.language || 'en');
  function playerResponse() {
    try { if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails) return window.ytInitialPlayerResponse } catch (e) {}
    try { const p = document.querySelector('#movie_player'); if (p && p.getPlayerResponse) return p.getPlayerResponse() } catch (e) {}
    for (const s of document.querySelectorAll('script')) {
      const t = s.textContent || '';
      const i = t.indexOf('ytInitialPlayerResponse = ');
      if (i < 0) continue;
      const start = t.indexOf('{', i);
      let depth = 0, inStr = false, esc = false;
      for (let j = start; j < t.length; j++) {
        const c = t[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\\\') esc = true; else if (c === '"') inStr = false; continue }
        if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(start, j + 1)) } catch (e) { break } } }
      }
    }
    return null;
  }
  const pr = playerResponse();
  const details = (pr && pr.videoDetails) || {};
  const title = details.title || document.title;
  const channel = details.author || '';
  const description = String(details.shortDescription || '').slice(0, 4000);
  const tracks = (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
  if (!tracks.length) return { ok: false, reason: 'no-captions', title, channel, description };
  const base = lang.toLowerCase().split('-')[0];
  const score = (t) => ((String(t.languageCode || '').toLowerCase().split('-')[0] === base) ? 4 : String(t.languageCode || '').startsWith('en') ? 2 : 0) + (t.kind !== 'asr' ? 1 : 0);
  const track = tracks.slice().sort((a, b) => score(b) - score(a))[0];
  try {
    const res = await fetch(track.baseUrl + '&fmt=json3', { credentials: 'include' });
    const json3 = await res.json();
    return { ok: true, title, channel, description, lang: track.languageCode, json3: { events: (json3.events || []).filter((e) => e.segs).map((e) => ({ segs: e.segs.map((s) => ({ utf8: s.utf8 })) })) } };
  } catch (e) {
    return { ok: false, reason: 'fetch-failed', title, channel, description };
  }
})()`

/** Turn the page script's result into a block for the model. */
export function transcriptBlock(result) {
  if (!result) return '<video_transcript unavailable="true">Could not read this video.</video_transcript>'
  const esc = (s) => String(s || '').replace(/"/g, '&quot;').slice(0, 300)
  if (!result.ok) {
    return `<video_transcript title="${esc(result.title)}" channel="${esc(result.channel)}" captions="none">\nThis video has no captions Bitter can read. Description:\n${result.description || '(none)'}\n</video_transcript>\nTell the user: "This video has no captions, so I summarized the page and description instead."`
  }
  return `<video_transcript title="${esc(result.title)}" channel="${esc(result.channel)}" lang="${esc(result.lang)}">\n${parseJson3(result.json3)}\n</video_transcript>`
}
