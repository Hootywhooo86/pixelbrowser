package expo.modules.bitshields

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.webkit.CookieManager
import android.webkit.WebStorage
import java.net.HttpURLConnection
import java.net.URL

/** Per-site tools: forget one site's cookies and storage, and home-screen shortcuts. */
object BitSites {
  /**
   * Deletes the cookies and site storage for these hosts (and the site they
   * belong to), leaving every other site signed in. Android WebView has no
   * "delete cookies for one site" call, so each cookie is overwritten with an
   * expired copy, for each domain form it may have been set with.
   */
  fun forget(hosts: List<String>, site: String): Int {
    val cm = CookieManager.getInstance()
    val storage = WebStorage.getInstance()
    var n = 0
    val domains = linkedSetOf(site, ".$site")
    val all = linkedSetOf<String>()
    for (h in hosts + listOf(site, "www.$site")) if (h.isNotBlank()) all.add(h.lowercase())
    for (h in all) {
      domains.add(h)
      domains.add(".$h")
    }
    for (h in all) {
      for (scheme in listOf("https", "http")) {
        val url = "$scheme://$h/"
        val names = (cm.getCookie(url) ?: "").split(";").map { it.substringBefore("=").trim() }.filter { it.isNotEmpty() }
        for (name in names.distinct()) {
          val gone = "$name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"
          // __Host- cookies can't have a Domain; others may have been set on any of these.
          cm.setCookie(url, if (scheme == "https") "$gone; Secure" else gone)
          if (!name.startsWith("__Host-")) for (d in domains) {
            cm.setCookie(url, "$gone; Domain=$d")
            if (scheme == "https") cm.setCookie(url, "$gone; Domain=$d; Secure")
          }
          n++
        }
        try { storage.deleteOrigin("$scheme://$h") } catch (_: Throwable) {}
      }
    }
    cm.flush()
    return n
  }

  fun pinSupported(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    return try { ctx.getSystemService(ShortcutManager::class.java)?.isRequestPinShortcutSupported == true } catch (_: Throwable) { false }
  }

  /**
   * Asks the launcher to put a shortcut for `url` on the home screen. The icon
   * is the site's own icon (fetched straight from the site, scaled up with hard
   * pixel edges on a Bit Browser tile), or a pixel letter when it has none.
   */
  fun addToHomeScreen(ctx: Context, url: String, title: String, iconUrl: String?): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return "unsupported"
    val sm = ctx.getSystemService(ShortcutManager::class.java) ?: return "unsupported"
    if (!sm.isRequestPinShortcutSupported) return "unsupported"
    val label = title.ifBlank { Uri.parse(url).host ?: "Site" }.take(40)
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
      setPackage(ctx.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val icon = tile(fetchIcon(iconUrl), label)
    val info = ShortcutInfo.Builder(ctx, "site-" + url.hashCode())
      .setShortLabel(label.take(24))
      .setLongLabel(label)
      .setIcon(Icon.createWithAdaptiveBitmap(icon))
      .setIntent(intent)
      .build()
    return if (sm.requestPinShortcut(info, null)) "asked" else "failed"
  }

  private fun fetchIcon(iconUrl: String?): Bitmap? {
    if (iconUrl.isNullOrBlank() || !iconUrl.startsWith("http")) return null
    return try {
      val c = URL(iconUrl).openConnection() as HttpURLConnection
      c.connectTimeout = 4000
      c.readTimeout = 4000
      c.instanceFollowRedirects = true
      c.setRequestProperty("Accept", "image/png,image/*;q=0.8")
      c.inputStream.use { input ->
        val bytes = input.readBytes()
        if (bytes.size > 1_500_000) null else BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      }
    } catch (_: Throwable) { null }
  }

  // Adaptive icons are 108dp with the visible part in the middle 72dp (2/3).
  private fun tile(src: Bitmap?, label: String): Bitmap {
    val size = 432
    val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(out)
    c.drawColor(Color.parseColor("#0b0b16"))
    val inner = size * 2 / 3
    val o = (size - inner) / 2
    // Teal pixel frame.
    val frame = Paint().apply { color = Color.parseColor("#2ee6c8"); isAntiAlias = false }
    val b = 12
    c.drawRect(Rect(o, o, o + inner, o + b), frame)
    c.drawRect(Rect(o, o + inner - b, o + inner, o + inner), frame)
    c.drawRect(Rect(o, o, o + b, o + inner), frame)
    c.drawRect(Rect(o + inner - b, o, o + inner, o + inner), frame)
    if (src != null && src.width >= 8) {
      // Scale up with nearest-neighbour so small icons keep crisp pixels.
      val box = inner - b * 4
      val pad = o + b * 2
      val p = Paint().apply { isFilterBitmap = src.width >= box; isAntiAlias = false }
      c.drawBitmap(src, null, Rect(pad, pad, pad + box, pad + box), p)
    } else {
      val letter = label.trim().firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "B"
      val p = Paint().apply {
        color = Color.parseColor("#2ee6c8")
        textSize = inner * 0.55f
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        textAlign = Paint.Align.CENTER
        isAntiAlias = false
      }
      val y = size / 2f - (p.descent() + p.ascent()) / 2f
      c.drawText(letter, size / 2f, y, p)
    }
    return out
  }
}
