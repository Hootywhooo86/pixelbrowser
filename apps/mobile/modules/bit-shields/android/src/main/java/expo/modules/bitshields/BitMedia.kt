package expo.modules.bitshields

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.webkit.WebView
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Media, picture-in-picture, Tor (Orbot proxy) and passkeys for Bit Browser.
 * BitShieldsModule exposes these to JS.
 */
object BitMedia {
  // ---------- passkeys ----------

  /** Lets sites use passkeys / security keys (WebAuthn) where this WebView supports it. */
  fun enablePasskeys(view: WebView) {
    try {
      if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
        // FOR_APP: credentials for sites the app is linked to through Digital
        // Asset Links, plus security keys. FOR_BROWSER needs Google to list the
        // app as a privileged browser, which only Play-distributed browsers get.
        WebSettingsCompat.setWebAuthenticationSupport(view.settings, WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP)
      }
    } catch (e: Throwable) {}
  }

  fun passkeysSupported(): Boolean = try { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION) } catch (e: Throwable) { false }

  // ---------- background play ----------

  @Volatile var backgroundPlay = true
  @Volatile var controlListener: ((String) -> Unit)? = null

  /** The page says media started or stopped; keep the app alive while it plays. */
  fun mediaState(ctx: Context, playing: Boolean, title: String, site: String) {
    if (!backgroundPlay && playing) return
    val intent = Intent(ctx, BitMediaService::class.java)
      .setAction(if (playing) BitMediaService.ACTION_SHOW_PLAYING else BitMediaService.ACTION_SHOW_PAUSED)
      .putExtra("title", title)
      .putExtra("site", site)
    try {
      if (playing && Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else if (BitMediaService.running) ctx.startService(intent)
    } catch (e: Throwable) {}
  }

  fun stopMedia(ctx: Context) {
    try { ctx.stopService(Intent(ctx, BitMediaService::class.java)) } catch (e: Throwable) {}
  }

  // ---------- picture-in-picture ----------

  @Volatile var pipListener: ((Boolean) -> Unit)? = null
  @Volatile private var autoPip = false
  @Volatile private var aspect = Rational(16, 9)
  private val main = Handler(Looper.getMainLooper())

  fun pipSupported(activity: Activity?): Boolean =
    Build.VERSION.SDK_INT >= 26 && activity?.packageManager?.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE) == true

  private fun params(): PictureInPictureParams {
    val b = PictureInPictureParams.Builder().setAspectRatio(aspect)
    if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(autoPip).setSeamlessResizeEnabled(true)
    return b.build()
  }

  private fun ratio(w: Int, h: Int): Rational {
    // Android only accepts ratios between 1:2.39 and 2.39:1.
    if (w <= 0 || h <= 0) return Rational(16, 9)
    val r = w.toDouble() / h
    return when {
      r > 2.39 -> Rational(239, 100)
      r < 1 / 2.39 -> Rational(100, 239)
      else -> Rational(w, h)
    }
  }

  fun enterPip(activity: Activity?, w: Int, h: Int): Boolean {
    if (!pipSupported(activity) || activity == null) return false
    aspect = ratio(w, h)
    var ok = false
    try { ok = activity.enterPictureInPictureMode(params()) } catch (e: Throwable) {}
    if (ok) watchPip(activity)
    return ok
  }

  /** While a video is full screen, going Home turns it into a small floating window. */
  fun setAutoPip(activity: Activity?, on: Boolean, w: Int, h: Int) {
    autoPip = on
    aspect = ratio(w, h)
    if (Build.VERSION.SDK_INT >= 26 && pipSupported(activity)) main.post { try { activity?.setPictureInPictureParams(params()) } catch (e: Throwable) {} }
  }

  /** Android below 12: the activity tells us the user is leaving (Home). */
  fun onUserLeave(activity: Activity?) {
    if (autoPip && Build.VERSION.SDK_INT in 26..30) enterPip(activity, aspect.numerator, aspect.denominator)
    else if (autoPip && activity != null) watchPip(activity)
  }

  private var watching = false

  /** Report entering/leaving PiP (Android has no callback for modules; check twice a second). */
  private fun watchPip(activity: Activity) {
    if (watching) return
    watching = true
    var was = false
    var waited = 0
    val tick = object : Runnable {
      override fun run() {
        val now = try { Build.VERSION.SDK_INT >= 24 && activity.isInPictureInPictureMode } catch (e: Throwable) { false }
        if (now != was) { was = now; pipListener?.invoke(now) }
        waited += 500
        // Keep checking while in PiP; give it up to 5 s to enter.
        if (now || (!was && waited < 5000)) main.postDelayed(this, 500) else watching = false
      }
    }
    main.postDelayed(tick, 300)
  }

  // ---------- Tor (through Orbot) ----------

  const val ORBOT = "org.torproject.android"

  fun orbotInstalled(ctx: Context): Boolean = try { ctx.packageManager.getPackageInfo(ORBOT, 0); true } catch (e: Throwable) { false }

  /** Ask Orbot to start Tor (Orbot shows its own notification). */
  fun startOrbot(ctx: Context) {
    try {
      val i = Intent("org.torproject.android.intent.action.START").setPackage(ORBOT)
        .putExtra("org.torproject.android.intent.extra.PACKAGE_NAME", ctx.packageName)
      ctx.sendBroadcast(i)
    } catch (e: Throwable) {}
  }

  fun openOrbot(ctx: Context): Boolean = try {
    val i = ctx.packageManager.getLaunchIntentForPackage(ORBOT)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (i != null) { ctx.startActivity(i); true } else false
  } catch (e: Throwable) { false }

  /** Is something listening on 127.0.0.1:port (Orbot's SOCKS or HTTP port)? */
  fun portOpen(port: Int): Boolean = try {
    Socket().use { it.connect(InetSocketAddress("127.0.0.1", port), 800); true }
  } catch (e: Throwable) { false }

  fun proxySupported(): Boolean = try { WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE) } catch (e: Throwable) { false }

  /**
   * Send every WebView request through the given proxies, in order, with no
   * fallback to a direct connection (so nothing leaks if Tor stops).
   */
  fun setProxy(rules: List<String>, done: (Boolean, String?) -> Unit) {
    if (!proxySupported()) return done(false, "This phone's Android System WebView can't use a proxy. Update it from the Play Store.")
    try {
      val b = ProxyConfig.Builder()
      for (r in rules) b.addProxyRule(r)
      ProxyController.getInstance().setProxyOverride(b.build(), { it.run() }) { done(true, null) }
    } catch (e: Throwable) { done(false, e.message) }
  }

  fun clearProxy(done: (Boolean) -> Unit) {
    if (!proxySupported()) return done(true)
    try { ProxyController.getInstance().clearProxyOverride({ it.run() }) { done(true) } } catch (e: Throwable) { done(false) }
  }
}
