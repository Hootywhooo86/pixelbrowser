package expo.modules.bitshields

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS side: requireOptionalNativeModule('BitShields') in src/shields.js. */
class BitShieldsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BitShields")

    AsyncFunction("load") { dir: String -> BitShields.load(dir) }

    Function("setEnabled") { on: Boolean -> BitShields.enabled = on }

    Function("setSiteOff") { hosts: List<String> -> BitShields.setSiteOff(hosts) }

    Function("blockedOn") { url: String -> BitShields.blockedOn(url) }

    Function("takeTotals") { BitShields.takeTotals() }

    Function("documentStartSupported") { BitShields.documentStartSupported() }

    Function("isBlocked") { url: String, page: String? -> BitShields.match(url, page) != null }

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
