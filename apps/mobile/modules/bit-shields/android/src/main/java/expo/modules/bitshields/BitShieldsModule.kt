package expo.modules.bitshields

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS side: requireOptionalNativeModule('BitShields') in src/shields.js. */
class BitShieldsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BitShields")

    Events("onDownload", "onOpenTab", "onMediaControl", "onPipChanged")

    OnStartObserving("onMediaControl") { BitMedia.controlListener = { action -> sendEvent("onMediaControl", mapOf("action" to action)) } }

    OnStopObserving("onMediaControl") { BitMedia.controlListener = null }

    OnStartObserving("onPipChanged") { BitMedia.pipListener = { on -> sendEvent("onPipChanged", mapOf("pip" to on)) } }

    OnStopObserving("onPipChanged") { BitMedia.pipListener = null }

    // Home pressed while a video is full screen (Android below 12) -> PiP.
    OnUserLeavesActivity { BitMedia.onUserLeave(appContext.currentActivity) }

    // ---------- background play ----------

    Function("setBackgroundPlay") { on: Boolean ->
      BitMedia.backgroundPlay = on
      if (!on) appContext.reactContext?.let { BitMedia.stopMedia(it) }
    }

    Function("mediaState") { playing: Boolean, title: String, site: String ->
      appContext.reactContext?.let { BitMedia.mediaState(it, playing, title, site) }
    }

    Function("stopMedia") { appContext.reactContext?.let { BitMedia.stopMedia(it) } }

    // ---------- picture-in-picture ----------

    Function("isPipSupported") { BitMedia.pipSupported(appContext.currentActivity) }

    Function("enterPip") { w: Int, h: Int -> BitMedia.enterPip(appContext.currentActivity, w, h) }

    Function("setAutoPip") { on: Boolean, w: Int, h: Int -> BitMedia.setAutoPip(appContext.currentActivity, on, w, h) }

    // ---------- Tor through Orbot ----------

    Function("orbotInstalled") { appContext.reactContext?.let { BitMedia.orbotInstalled(it) } ?: false }

    Function("startOrbot") { appContext.reactContext?.let { BitMedia.startOrbot(it) } }

    Function("openOrbot") { appContext.reactContext?.let { BitMedia.openOrbot(it) } ?: false }

    AsyncFunction("portOpen") { port: Int -> BitMedia.portOpen(port) }

    Function("proxySupported") { BitMedia.proxySupported() }

    AsyncFunction("setProxy") { rules: List<String>, promise: expo.modules.kotlin.Promise ->
      BitMedia.setProxy(rules) { ok, err -> if (ok) promise.resolve(true) else promise.reject("ERR_PROXY", err ?: "Couldn't set the proxy", null) }
    }

    AsyncFunction("clearProxy") { promise: expo.modules.kotlin.Promise -> BitMedia.clearProxy { promise.resolve(it) } }

    // ---------- passkeys ----------

    Function("passkeysSupported") { BitMedia.passkeysSupported() }

    OnStartObserving("onOpenTab") { BitShields.openTabListener = { url -> sendEvent("onOpenTab", mapOf("url" to url)) } }

    OnStopObserving("onOpenTab") { BitShields.openTabListener = null }

    OnStartObserving("onDownload") { BitShields.downloadListener = { sendEvent("onDownload", it) } }

    OnStopObserving("onDownload") { BitShields.downloadListener = null }

    AsyncFunction("load") { dir: String -> BitShields.load(dir) }

    Function("setEnabled") { on: Boolean -> BitShields.enabled = on }

    Function("setSiteOff") { hosts: List<String> -> BitShields.setSiteOff(hosts) }

    Function("blockedOn") { url: String -> BitShields.blockedOn(url) }

    Function("takeTotals") { BitShields.takeTotals() }

    Function("documentStartSupported") { BitShields.documentStartSupported() }

    Function("isBlocked") { url: String, page: String? -> BitShields.match(url, page) != null }

    // Forget everything from private tabs (their own WebView profile): on app
    // start, after Close all private tabs, and from the panic button.
    Function("clearPrivateData") {
      try {
        if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.MULTI_PROFILE)) {
          val p = androidx.webkit.ProfileStore.getInstance().getProfile("bit-private")
          p?.cookieManager?.removeAllCookies(null)
          p?.webStorage?.deleteAllData()
          true
        } else false
      } catch (e: Throwable) { false }
    }

    // Can private tabs have their own cookie jar on this phone?
    Function("privateProfileSupported") {
      try { androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.MULTI_PROFILE) } catch (e: Throwable) { false }
    }

    // Keep sign-ins: write cookies to disk now instead of whenever WebView gets
    // around to it, so closing the app right after logging in doesn't lose them.
    Function("flushCookies") { android.webkit.CookieManager.getInstance().flush() }

    // The system WebView's user agent, so JS can drop the "; wv" WebView marker
    // that makes sites like Google treat Bit Browser as an embedded app.
    Function("defaultUserAgent") {
      val ctx = appContext.reactContext ?: return@Function ""
      android.webkit.WebSettings.getDefaultUserAgent(ctx)
    }
  }
}
