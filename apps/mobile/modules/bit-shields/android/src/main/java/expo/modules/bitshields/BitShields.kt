package expo.modules.bitshields

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Bit Shields request blocking for the app's WebViews.
 *
 * react-native-webview calls into this (through BitShieldsHook, which
 * plugins/with-shields.js adds to it) for every sub-resource request, every
 * page start and every new WebView. Rules are host sets the JS side compiles
 * from the filter lists and writes to files; matching is a few HashSet
 * lookups per request.
 */
object BitShields {
  private const val TAG = "BitShields"

  @Volatile var enabled = true
  @Volatile private var block: Set<String> = emptySet()
  @Volatile private var block3p: Set<String> = emptySet()
  @Volatile private var allow: Set<String> = emptySet()
  @Volatile private var pageAllow: Set<String> = emptySet()
  @Volatile private var trackers: Set<String> = emptySet()
  @Volatile private var siteOff: Set<String> = emptySet()
  // Path rules: ||host/path (by host) and host-less rules (by URL word), with exceptions.
  @Volatile private var paths: Map<String, List<Rule>> = emptyMap()
  @Volatile private var allowPaths: Map<String, List<Rule>> = emptyMap()
  @Volatile private var generic: Map<String, List<Rule>> = emptyMap()
  @Volatile private var allowGeneric: Map<String, List<Rule>> = emptyMap()

  class Rule(val parts: Array<String>, val thirdParty: Boolean, val domains: Array<String>?)
  @Volatile private var docStart: String? = null

  // Current page per WebView (keyed by identity; written on the UI thread,
  // read on network threads).
  private val pageOf = ConcurrentHashMap<Int, String>()
  private val counts = ConcurrentHashMap<String, AtomicInteger>() // page URL -> blocked
  private val latestForHost = ConcurrentHashMap<String, String>() // host -> latest page URL
  private val newAds = AtomicLong()
  private val newTrackers = AtomicLong()

  // WebViews and their document-start script (UI thread only).
  private val views = Collections.synchronizedMap(WeakHashMap<WebView, ScriptHandler?>())
  private val main = Handler(Looper.getMainLooper())
  private val empty = ByteArray(0)

  // ---------- called from react-native-webview ----------

  // Files the web view can't show itself (PDFs, attachments). When the app
  // is listening, it saves and opens them (PDF viewer) instead of Android's
  // download manager, which can't show them in the app.
  @Volatile var downloadListener: ((Map<String, Any?>) -> Unit)? = null

  @JvmStatic
  fun onDownload(view: WebView, url: String, userAgent: String?, contentDisposition: String?, mimetype: String?, contentLength: Long): Boolean {
    val listener = downloadListener ?: return false
    if (!url.startsWith("http://") && !url.startsWith("https://")) return false
    val cookie = try { android.webkit.CookieManager.getInstance().getCookie(url) } catch (e: Throwable) { null }
    listener(
      mapOf(
        "url" to url,
        "userAgent" to (userAgent ?: ""),
        "contentDisposition" to (contentDisposition ?: ""),
        "mimetype" to (mimetype ?: ""),
        "contentLength" to contentLength.toDouble(),
        "cookie" to (cookie ?: ""),
        "pageUrl" to (view.url ?: "")
      )
    )
    return true
  }

  @JvmStatic
  fun onWebViewCreated(view: WebView) {
    views[view] = null
    applyDocStart(view)
  }

  @JvmStatic
  fun onPageStarted(view: WebView, url: String?) {
    val page = strip(url ?: return)
    pageOf[System.identityHashCode(view)] = page
    counts[page] = AtomicInteger(0)
    hostOf(page)?.let { latestForHost[it] = page }
    if (counts.size > 300) counts.keys.take(100).forEach { counts.remove(it) }
  }

  @JvmStatic
  fun intercept(view: WebView, request: WebResourceRequest): WebResourceResponse? {
    if (!enabled || request.isForMainFrame) return null
    val url = request.url?.toString() ?: return null
    if (!url.startsWith("http")) return null
    val page = pageOf[System.identityHashCode(view)]
    val hit = match(url, page) ?: return null
    if (page != null) counts.getOrPut(page) { AtomicInteger(0) }.incrementAndGet()
    if (trackers.contains(hit)) newTrackers.incrementAndGet() else newAds.incrementAndGet()
    return WebResourceResponse("text/plain", "utf-8", 200, "OK", mapOf("Access-Control-Allow-Origin" to "*"), ByteArrayInputStream(empty))
  }

  // ---------- called from JS (BitShieldsModule) ----------

  /** Loads rule files from `dir` (written by src/shields.js). Returns rule counts. */
  fun load(dir: String): Map<String, Int> {
    val base = File(dir.removePrefix("file://"))
    block = readSet(File(base, "block.txt"))
    block3p = readSet(File(base, "block3p.txt"))
    allow = readSet(File(base, "allow.txt"))
    pageAllow = readSet(File(base, "pageallow.txt"))
    trackers = readSet(File(base, "trackers.txt"))
    readPaths(File(base, "paths.json"))
    val script = File(base, "docstart.js")
    docStart = if (script.exists()) script.readText() else null
    main.post { synchronized(views) { views.keys.toList() }.forEach { applyDocStart(it) } }
    return mapOf("block" to block.size, "block3p" to block3p.size, "allow" to allow.size)
  }

  fun setSiteOff(hosts: List<String>) {
    siteOff = hosts.map { it.lowercase() }.toHashSet()
  }

  /** Blocked requests on the page at `url` (falls back to the latest page on that host). */
  fun blockedOn(url: String): Int {
    val page = strip(url)
    counts[page]?.let { return it.get() }
    val latest = hostOf(page)?.let { latestForHost[it] } ?: return 0
    return counts[latest]?.get() ?: 0
  }

  /** Blocks since the last call, for the running totals: [ads, trackers]. */
  fun takeTotals(): List<Long> = listOf(newAds.getAndSet(0), newTrackers.getAndSet(0))

  fun documentStartSupported(): Boolean = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

  // ---------- matching ----------

  /** The rule host that blocks `url` on `page`, or null. */
  fun match(url: String, page: String?): String? {
    val host = hostOf(url) ?: return null
    val pageHost = page?.let { hostOf(it) }
    if (pageHost != null && (find(pageAllow, pageHost) != null || find(siteOff, pageHost) != null)) return null
    val third = pageHost == null || siteOf(host) != siteOf(pageHost)
    var hit = find(block, host)
    if (hit == null && block3p.isNotEmpty() && third) hit = find(block3p, host)
    if (hit == null) hit = pathHit(paths, host, url, third, pageHost)
    val lower = url.lowercase()
    if (hit == null && genericHit(generic, lower, third, pageHost)) hit = host
    if (hit == null) return null
    if (find(allow, host) != null || pathHit(allowPaths, host, url, true, pageHost) != null || genericHit(allowGeneric, lower, true, pageHost)) return null
    return hit
  }

  private fun onPage(r: Rule, pageHost: String?): Boolean {
    val d = r.domains ?: return true
    if (pageHost == null) return false
    return d.any { pageHost == it || pageHost.endsWith(".$it") }
  }

  private fun inOrder(text: String, parts: Array<String>): Boolean {
    var at = 0
    for (part in parts) {
      val i = text.indexOf(part, at)
      if (i < 0) return false
      at = i + part.length
    }
    return true
  }

  private fun pathHit(map: Map<String, List<Rule>>, host: String, url: String, third: Boolean, pageHost: String?): String? {
    if (map.isEmpty()) return null
    var rest: String? = null
    var h = host
    while (true) {
      val rules = map[h]
      if (rules != null) {
        if (rest == null) {
          val start = url.indexOf(host, url.indexOf("://") + 3)
          rest = url.substring(start + host.length).lowercase()
        }
        for (r in rules) if ((!r.thirdParty || third) && onPage(r, pageHost) && inOrder(rest, r.parts)) return h
      }
      val dot = h.indexOf('.')
      if (dot < 0) return null
      h = h.substring(dot + 1)
    }
  }

  private val wordSplit = Regex("[^a-z0-9%]+")

  private fun genericHit(map: Map<String, List<Rule>>, lowerUrl: String, third: Boolean, pageHost: String?): Boolean {
    if (map.isEmpty()) return false
    for (word in lowerUrl.split(wordSplit)) {
      if (word.length < 2) continue
      val rules = map[word] ?: continue
      for (r in rules) if ((!r.thirdParty || third) && onPage(r, pageHost) && inOrder(lowerUrl, r.parts)) return true
    }
    return false
  }

  private fun readPaths(file: File) {
    if (!file.exists()) {
      paths = emptyMap(); allowPaths = emptyMap(); generic = emptyMap(); allowGeneric = emptyMap()
      return
    }
    try {
      val json = JSONObject(file.readText())
      paths = rules(json.optJSONObject("paths"))
      allowPaths = rules(json.optJSONObject("allowPaths"))
      generic = rules(json.optJSONObject("generic"))
      allowGeneric = rules(json.optJSONObject("allowGeneric"))
    } catch (e: Throwable) {
      Log.w(TAG, "couldn't read path rules", e)
    }
  }

  private fun rules(obj: JSONObject?): Map<String, List<Rule>> {
    if (obj == null) return emptyMap()
    val out = HashMap<String, List<Rule>>(obj.length() * 2)
    val keys = obj.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      val arr = obj.optJSONArray(key) ?: continue
      val list = ArrayList<Rule>(arr.length())
      for (i in 0 until arr.length()) {
        val r = arr.optJSONObject(i) ?: continue
        val p = r.optJSONArray("p") ?: continue
        val parts = Array(p.length()) { p.optString(it) }
        val d = r.optJSONArray("d")
        list.add(Rule(parts, r.optInt("t", 0) == 1, d?.let { a -> Array(a.length()) { a.optString(it) } }))
      }
      out[key] = list
    }
    return out
  }

  private fun find(set: Set<String>, host: String): String? {
    if (set.isEmpty()) return null
    var h = host
    while (true) {
      if (set.contains(h)) return h
      val dot = h.indexOf('.')
      if (dot < 0) return null
      h = h.substring(dot + 1)
    }
  }

  private fun siteOf(host: String): String {
    val parts = host.split('.')
    if (parts.size <= 2) return host
    val take = if (parts.last().length == 2 && parts[parts.size - 2].length <= 3) 3 else 2
    return parts.takeLast(take).joinToString(".")
  }

  private fun hostOf(url: String): String? {
    val start = url.indexOf("://")
    if (start < 0) return null
    var end = url.length
    for (i in start + 3 until url.length) {
      val c = url[i]
      if (c == '/' || c == '?' || c == '#') { end = i; break }
    }
    var host = url.substring(start + 3, end)
    val at = host.lastIndexOf('@')
    if (at >= 0) host = host.substring(at + 1)
    if (host.startsWith("[")) return host.lowercase()
    val colon = host.indexOf(':')
    if (colon >= 0) host = host.substring(0, colon)
    return host.lowercase().trimEnd('.').ifEmpty { null }
  }

  private fun strip(url: String): String {
    val hash = url.indexOf('#')
    return if (hash >= 0) url.substring(0, hash) else url
  }

  private fun readSet(file: File): Set<String> {
    if (!file.exists()) return emptySet()
    val out = HashSet<String>()
    file.forEachLine { line -> if (line.isNotBlank()) out.add(line.trim()) }
    return out
  }

  // ---------- document-start script ----------

  private fun applyDocStart(view: WebView) {
    if (!documentStartSupported()) return
    try {
      views[view]?.remove()
      val script = docStart
      views[view] = if (script.isNullOrEmpty()) null else WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*"))
    } catch (e: Throwable) {
      Log.w(TAG, "document-start script failed", e)
    }
  }
}
