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

  // ---------- pop-up windows (Sign in with Google, Apple, Microsoft…) ----------
  //
  // Sign-in buttons open a pop-up that reports back to the page through
  // window.opener and then closes. react-native-webview can't keep that link,
  // so sign-in pop-ups open here: a real child WebView in a full-screen dialog,
  // attached with WebViewTransport so window.opener works. Ordinary new-window
  // links are handed to the app to open as a normal tab instead.
  @Volatile var openTabListener: ((String) -> Unit)? = null

  private val AUTH_HOSTS = Regex(
    "(^|\\.)(accounts\\.google\\.com|accounts\\.youtube\\.com|appleid\\.apple\\.com|idmsa\\.apple\\.com|login\\.microsoftonline\\.com|login\\.live\\.com|login\\.microsoft\\.com|github\\.com|facebook\\.com|instagram\\.com|twitter\\.com|x\\.com|discord\\.com|slack\\.com|auth0\\.com|okta\\.com|onelogin\\.com|claude\\.ai|anthropic\\.com|openai\\.com|chatgpt\\.com|paypal\\.com|stripe\\.com|shopify\\.com|amazon\\.[a-z.]+|linkedin\\.com|yahoo\\.com|dropbox\\.com|zoom\\.us|notion\\.so)$",
    RegexOption.IGNORE_CASE
  )

  // Files (labels, invoices, PDFs) opened in a new window are downloads, not sign-ins.
  private val FILE_URL = Regex("\\.(pdf|zip|csv|xlsx?|docx?|png|jpe?g|gif|apk)([?#]|$)|/download|/label|[?&](download|attachment)=|amazonaws\\.com/", RegexOption.IGNORE_CASE)

  private fun isSignIn(url: String?): Boolean {
    if (url.isNullOrBlank() || url == "about:blank") return true
    if (FILE_URL.containsMatchIn(url)) return false
    val host = try { android.net.Uri.parse(url).host ?: "" } catch (e: Throwable) { "" }
    return AUTH_HOSTS.containsMatchIn(host) || Regex("oauth|/authorize|/signin|/login|/auth/", RegexOption.IGNORE_CASE).containsMatchIn(url)
  }

  @JvmStatic
  fun onCreateWindow(parent: WebView, resultMsg: android.os.Message): Boolean {
    val ctx = parent.context
    val child = WebView(ctx)
    val ps = parent.settings
    child.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      userAgentString = ps.userAgentString
      javaScriptCanOpenWindowsAutomatically = true
      setSupportMultipleWindows(true)
      loadWithOverviewMode = true
      useWideViewPort = true
    }
    try { android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(child, true) } catch (e: Throwable) {}
    BitMedia.enablePasskeys(child) // "Sign in with a passkey" inside sign-in pop-ups
    // Private tabs keep their own cookie jar; so does their pop-up.
    try {
      if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
        val name = WebViewCompat.getProfile(parent).name
        if (name != "Default") WebViewCompat.setProfile(child, name)
      }
    } catch (e: Throwable) {}

    val dialog = android.app.Dialog(ctx, android.R.style.Theme_DeviceDefault_NoActionBar)
    val dp = ctx.resources.displayMetrics.density
    val title = android.widget.TextView(ctx).apply {
      setTextColor(android.graphics.Color.parseColor("#f4f1ff"))
      textSize = 14f
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
      setPadding((14 * dp).toInt(), 0, (8 * dp).toInt(), 0)
      text = "Sign in"
    }
    val close = android.widget.Button(ctx).apply {
      text = "CLOSE"
      setTextColor(android.graphics.Color.parseColor("#0b0b16"))
      setBackgroundColor(android.graphics.Color.parseColor("#2dd4bf"))
      setOnClickListener { dialog.dismiss() }
    }
    val header = android.widget.LinearLayout(ctx).apply {
      orientation = android.widget.LinearLayout.HORIZONTAL
      gravity = android.view.Gravity.CENTER_VERTICAL
      setBackgroundColor(android.graphics.Color.parseColor("#141428"))
      setPadding(0, (6 * dp).toInt(), (8 * dp).toInt(), (6 * dp).toInt())
      addView(title, android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
      addView(close)
    }
    val root = android.widget.LinearLayout(ctx).apply {
      orientation = android.widget.LinearLayout.VERTICAL
      setBackgroundColor(android.graphics.Color.parseColor("#141428"))
      fitsSystemWindows = true
      addView(header, android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT))
      addView(child, android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    }
    dialog.setContentView(root)
    dialog.setOnDismissListener {
      try { android.webkit.CookieManager.getInstance().flush() } catch (e: Throwable) {}
      try { child.stopLoading(); child.destroy() } catch (e: Throwable) {}
    }

    var first = true
    var shown = false
    val showIt = { if (!shown) { shown = true; try { dialog.show() } catch (e: Throwable) {} } }
    child.webViewClient = object : android.webkit.WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = decide(request.url.toString())

      @Deprecated("old API") override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = decide(url)

      fun decide(url: String): Boolean {
        if (first) {
          first = false
          if (!isSignIn(url) && openTabListener != null) {
            // An ordinary "open in new window" link: make it a normal tab.
            openTabListener?.invoke(url)
            dialog.dismiss()
            return true
          }
          showIt()
        }
        if (!url.startsWith("http") && !url.startsWith("about:") && !url.startsWith("data:") && !url.startsWith("blob:")) return true
        return false
      }

      override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        if (first) { first = false; if (!isSignIn(url) && openTabListener != null && url != null) { openTabListener?.invoke(url); dialog.dismiss(); return } }
        showIt()
        title.text = try { android.net.Uri.parse(url).host ?: "Sign in" } catch (e: Throwable) { "Sign in" }
      }
    }
    // A pop-up that turns out to be a file (a label PDF, an invoice): hand it to
    // the app like any other download, which opens PDFs in the viewer.
    child.setDownloadListener { url, userAgent, contentDisposition, mimetype, contentLength ->
      val taken = try { onDownload(parent, url, userAgent, contentDisposition, mimetype, contentLength) } catch (e: Throwable) { false }
      if (!taken) openTabListener?.invoke(url)
      dialog.dismiss()
    }
    child.webChromeClient = object : android.webkit.WebChromeClient() {
      override fun onCloseWindow(window: WebView) { dialog.dismiss() }
    }
    dialog.setOnKeyListener { _, keyCode, event ->
      if (keyCode == android.view.KeyEvent.KEYCODE_BACK && event.action == android.view.KeyEvent.ACTION_UP) {
        if (child.canGoBack()) child.goBack() else dialog.dismiss()
        true
      } else false
    }

    val transport = resultMsg.obj as WebView.WebViewTransport
    transport.webView = child
    resultMsg.sendToTarget()
    return true
  }

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

  /**
   * Bit Browser was closed (swiped away or exited): stop every page's audio and
   * video so nothing keeps playing in the background after the app is gone.
   */
  fun silenceAll() {
    val pause = "document.querySelectorAll('video,audio').forEach(function(m){try{m.pause()}catch(e){}});"
    val run = Runnable {
      synchronized(views) { views.keys.toList() }.forEach { v ->
        try { v.evaluateJavascript(pause, null); v.onPause() } catch (e: Throwable) {}
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) run.run() else main.post(run)
  }

  @JvmStatic
  fun onWebViewCreated(view: WebView) {
    views[view] = null
    applyDocStart(view)
    BitMedia.enablePasskeys(view)
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
