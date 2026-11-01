// Fingerprinting protection ("farbling", like Brave).
//
// Sites can identify a phone without cookies by reading tiny differences in
// how it draws graphics, plays audio and what hardware it reports.
// FINGERPRINT_JS runs before page scripts and:
//   - adds invisible noise to canvas reads (toDataURL, toBlob, getImageData)
//   - reports a generic WebGL vendor/renderer
//   - adds tiny noise to audio analysis reads
//   - rounds CPU cores and memory, and buckets the screen size
//   - empties plugins/mimeTypes, removes the Battery API
//   - lists at most one camera, microphone and speaker, without labels
// The noise comes from a seed per site and per app session, so a site sees
// the same values for the whole visit (pages keep working) but can't match
// them with another site or tomorrow's visit.
//
// On by default (state.fingerprintProtection !== false); a site can be
// excluded with setSite(host, { fingerprint: false }).

const SESSION_SEED = Math.floor(Math.random() * 0x7fffffff)

function seedFor(host) {
  let h = SESSION_SEED ^ 0x9e3779b9
  const s = String(host || '')
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0
  return h >>> 0
}

/** The page script, seeded for this host. '' when protection is off. */
export function fingerprintFor(url, site, state) {
  if (state?.fingerprintProtection === false || site?.fingerprint === false) return ''
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {}
  return fingerprintJS(seedFor(host))
}

/** FINGERPRINT_JS with an explicit seed (tests). */
export function fingerprintJS(seed) {
  return String.raw`(function(){
  if (window.__bitFarble) return; window.__bitFarble = true;
  var SEED = ${Number(seed) >>> 0};
  function rng(n){ var x = (SEED ^ n) >>> 0; return function(){ x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 } }
  function def(obj, prop, get){ try { Object.defineProperty(obj, prop, { get: get, configurable: true }) } catch (e) {} }
  function wrap(proto, name, make){ try { var orig = proto[name]; if (typeof orig !== 'function') return; var w = make(orig); try { Object.defineProperty(w, 'toString', { value: function(){ return 'function ' + name + '() { [native code] }' } }) } catch (e) {} proto[name] = w } catch (e) {} }

  // --- canvas: flip the lowest bit of a few pixels, same pixels every time for this site
  function noisify(data, w, h){
    var r = rng(w * 31 + h), n = Math.max(4, Math.min(64, Math.floor(data.length / 4 / 500)));
    for (var i = 0; i < n; i++) { var p = Math.floor(r() * (data.length / 4)) * 4; var c = Math.floor(r() * 3); data[p + c] = data[p + c] ^ 1 }
  }
  function noisyCopy(canvas){
    try {
      var w = canvas.width, h = canvas.height; if (!w || !h || w * h > 4000000) return null;
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d'); ctx.drawImage(canvas, 0, 0);
      var img = origGetImageData.call(ctx, 0, 0, w, h); noisify(img.data, w, h); ctx.putImageData(img, 0, 0);
      return c;
    } catch (e) { return null }
  }
  var C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  var origGetImageData = C2D && C2D.getImageData;
  if (C2D) wrap(C2D, 'getImageData', function(orig){ return function(x, y, w, h){ var img = orig.apply(this, arguments); try { noisify(img.data, w, h) } catch (e) {} return img } });
  var HC = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  if (HC && origGetImageData) {
    wrap(HC, 'toDataURL', function(orig){ return function(){ var c = noisyCopy(this); return orig.apply(c || this, arguments) } });
    wrap(HC, 'toBlob', function(orig){ return function(){ var c = noisyCopy(this); return orig.apply(c || this, arguments) } });
  }

  // --- WebGL: generic vendor and renderer
  [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function(GL){
    if (!GL) return;
    wrap(GL.prototype, 'getParameter', function(orig){ return function(p){
      if (p === 0x9245 || p === 0x1F00) return 'Google Inc.';           // UNMASKED_VENDOR_WEBGL / VENDOR
      if (p === 0x9246 || p === 0x1F01) return 'Generic GPU';           // UNMASKED_RENDERER_WEBGL / RENDERER
      return orig.apply(this, arguments);
    } });
  });

  // --- audio: tiny noise on analyser and rendered buffer reads
  var AN = window.AnalyserNode && AnalyserNode.prototype;
  if (AN) wrap(AN, 'getFloatFrequencyData', function(orig){ return function(arr){ orig.apply(this, arguments); var r = rng(7); for (var i = 0; i < arr.length; i += 97) arr[i] += (r() - 0.5) * 0.0001 } });
  var AB = window.AudioBuffer && AudioBuffer.prototype;
  if (AB) wrap(AB, 'getChannelData', function(orig){ return function(){ var d = orig.apply(this, arguments); if (!d.__bitFarbled) { var r = rng(13); for (var i = 0; i < d.length; i += 101) d[i] += (r() - 0.5) * 1e-7; try { d.__bitFarbled = true } catch (e) {} } return d } });

  // --- hardware and screen
  var N = Navigator.prototype;
  var cores = navigator.hardwareConcurrency || 4;
  def(N, 'hardwareConcurrency', function(){ return cores >= 8 ? 8 : cores >= 4 ? 4 : 2 });
  if ('deviceMemory' in navigator) def(N, 'deviceMemory', function(){ return 4 });
  def(N, 'plugins', function(){ return Object.create(PluginArray.prototype, { length: { value: 0 } }) });
  def(N, 'mimeTypes', function(){ return Object.create(MimeTypeArray.prototype, { length: { value: 0 } }) });
  if ('getBattery' in N) { try { delete N.getBattery } catch (e) {} def(N, 'getBattery', function(){ return undefined }) }
  var bucket = function(v, step){ return Math.max(step, Math.round(v / step) * step) };
  var S = Screen.prototype, sw = screen.width, sh = screen.height;
  def(S, 'width', function(){ return bucket(sw, 20) });
  def(S, 'height', function(){ return bucket(sh, 20) });
  def(S, 'availWidth', function(){ return bucket(sw, 20) });
  def(S, 'availHeight', function(){ return bucket(sh, 20) });

  // --- devices: one of each kind, no labels or ids
  var MD = window.MediaDevices && MediaDevices.prototype;
  if (MD) wrap(MD, 'enumerateDevices', function(orig){ return function(){ return orig.apply(this, arguments).then(function(list){
    var seen = {}, out = [];
    list.forEach(function(d){ if (seen[d.kind]) return; seen[d.kind] = true; out.push({ kind: d.kind, label: '', deviceId: '', groupId: '', toJSON: function(){ return { kind: d.kind, label: '', deviceId: '', groupId: '' } } }) });
    return out;
  }) } });
})();`
}
