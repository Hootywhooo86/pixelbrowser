// YouTube backup layer. The uBlock Origin scriptlets from the filter lists do
// the real work (they strip ads out of the player data before it plays).
// This adds what works even when those lists haven't downloaded yet or
// YouTube changes something: strip ad fields from player data, skip any
// video ad that still starts, and hide ad slots in the feed. Runs inside
// the page (it's spliced into the page script, so `report` exists).

export const YOUTUBE_JS = String.raw`
if (/(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)$/.test(host)) (function(){
  var AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  function strip(o){
    if (!o || typeof o !== 'object') return false;
    var hit = false;
    for (var i=0;i<AD_KEYS.length;i++) if (AD_KEYS[i] in o) { try { delete o[AD_KEYS[i]]; hit = true } catch(e){} }
    if (o.playerResponse && strip(o.playerResponse)) hit = true;
    return hit;
  }
  // Player data set by the page itself.
  ['ytInitialPlayerResponse', 'playerResponse'].forEach(function(name){
    try {
      var value = window[name];
      Object.defineProperty(window, name, { configurable: true, get: function(){ return value }, set: function(v){ if (strip(v)) report(1); value = v } });
    } catch(e){}
  });
  // Player data from the network (JSON.parse covers XHR, Response.json covers fetch).
  try {
    var parse = JSON.parse;
    JSON.parse = function(){ var r = parse.apply(this, arguments); try { if (r && typeof r === 'object' && (r.adPlacements || r.playerAds || r.adSlots || (r.playerResponse && r.playerResponse.adPlacements))) { if (strip(r)) report(1) } } catch(e){} return r };
    var rjson = Response.prototype.json;
    Response.prototype.json = function(){ return rjson.apply(this, arguments).then(function(r){ try { if (strip(r)) report(1) } catch(e){} return r }) };
  } catch(e){}
  // Skip any video ad that still plays, and press "Skip".
  var YT_CSS = 'ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer,ytd-display-ad-renderer,ytd-banner-promo-renderer,ytd-statement-banner-renderer,ytd-companion-slot-renderer,ytd-player-legacy-desktop-watch-ads-renderer,#masthead-ad,#player-ads,.ytp-ad-overlay-container,.ytp-ad-image-overlay,ytm-promoted-sparkles-web-renderer,ytm-promoted-video-renderer,ytm-companion-ad-renderer,ytm-companion-slot,ytm-ad-slot-renderer,ad-slot-renderer,ytm-in-feed-ad-layout-renderer,ytm-promoted-sparkles-text-search-renderer,.ytm-promoted-sparkles-web-renderer{display:none!important}';
  function addCss(){ if (document.querySelector('style[data-bit-yt]')) return; var s=document.createElement('style'); s.setAttribute('data-bit-yt',''); s.textContent=YT_CSS; (document.head||document.documentElement).appendChild(s) }
  if (document.documentElement) addCss(); else document.addEventListener('readystatechange', addCss, { once: true });
  var lastSkip = 0;
  setInterval(function(){
    try {
      var player = document.querySelector('.ad-showing, .ad-interrupting');
      if (!player) return;
      var v = player.querySelector('video');
      if (v && isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.2) { v.currentTime = v.duration; }
      var b = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytm-skip-ad-button, button[class*="skip-button"]');
      if (b) b.click();
      if (Date.now() - lastSkip > 5000) { lastSkip = Date.now(); report(1) }
    } catch(e){}
  }, 300);
})();
`
