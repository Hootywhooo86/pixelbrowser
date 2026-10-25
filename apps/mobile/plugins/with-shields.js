// Expo config plugin: lets Bit Shields block ad and tracker requests inside
// react-native-webview on Android.
//
// react-native-webview has no hook for sub-resource requests, so at prebuild
// this adds three small calls to its Android source (in node_modules):
//   RNCWebView()                    -> BitShieldsHook.created(view)
//   RNCWebViewClient.onPageStarted  -> BitShieldsHook.pageStarted(view, url)
//   RNCWebViewClient.shouldInterceptRequest (new) -> BitShieldsHook.intercept(...)
// BitShieldsHook reaches the blocker in modules/bit-shields by reflection, so
// the webview library doesn't need a build dependency on it, and it does
// nothing if that module is missing. Patching is idempotent.
//
// If a react-native-webview update moves these spots, prebuild fails with a
// clear message instead of shipping a browser that silently stops blocking.

const fs = require('fs')
const path = require('path')
const { withDangerousMod } = require('expo/config-plugins')

const MARK = '// Bit Shields (plugins/with-shields.js)'

const HOOK = `package com.reactnativecommunity.webview;

${MARK}
// Forwards to expo.modules.bitshields.BitShields if the app includes it.

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import java.lang.reflect.Method;

final class BitShieldsHook {
  private static boolean looked = false;
  private static Method created, pageStarted, intercept;

  private static synchronized void lookUp() {
    if (looked) return;
    looked = true;
    try {
      Class<?> c = Class.forName("expo.modules.bitshields.BitShields");
      created = c.getMethod("onWebViewCreated", WebView.class);
      pageStarted = c.getMethod("onPageStarted", WebView.class, String.class);
      intercept = c.getMethod("intercept", WebView.class, WebResourceRequest.class);
    } catch (Throwable ignored) {
      created = pageStarted = intercept = null;
    }
  }

  static void created(WebView view) {
    lookUp();
    if (created == null) return;
    try { created.invoke(null, view); } catch (Throwable ignored) {}
  }

  static void pageStarted(WebView view, String url) {
    lookUp();
    if (pageStarted == null) return;
    try { pageStarted.invoke(null, view, url); } catch (Throwable ignored) {}
  }

  static WebResourceResponse intercept(WebView view, WebResourceRequest request) {
    lookUp();
    if (intercept == null) return null;
    try { return (WebResourceResponse) intercept.invoke(null, view, request); } catch (Throwable ignored) { return null; }
  }
}
`

function patch(file, edits) {
  let src = fs.readFileSync(file, 'utf8')
  if (src.includes(MARK)) return
  for (const [find, replace] of edits) {
    if (!src.includes(find)) throw new Error(`with-shields: couldn't find the spot to patch in ${path.basename(file)} ("${find.trim().slice(0, 60)}"). react-native-webview may have changed; update plugins/with-shields.js.`)
    src = src.replace(find, replace)
  }
  fs.writeFileSync(file, src)
}

function patchWebView(projectRoot) {
  const pkg = require.resolve('react-native-webview/package.json', { paths: [projectRoot] })
  const dir = path.join(path.dirname(pkg), 'android/src/main/java/com/reactnativecommunity/webview')
  fs.writeFileSync(path.join(dir, 'BitShieldsHook.java'), HOOK)

  patch(path.join(dir, 'RNCWebView.java'), [
    [
      'progressChangedFilter = new ProgressChangedFilter();\n    }',
      `progressChangedFilter = new ProgressChangedFilter();\n        ${MARK}\n        BitShieldsHook.created(this);\n    }`,
    ],
  ])

  patch(path.join(dir, 'RNCWebViewClient.java'), [
    [
      'super.onPageStarted(webView, url, favicon);',
      `super.onPageStarted(webView, url, favicon);\n      ${MARK}\n      BitShieldsHook.pageStarted(webView, url);`,
    ],
    [
      '    @Override\n    public boolean shouldOverrideUrlLoading(WebView view, String url) {',
      `    ${MARK}\n    @Override\n    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {\n        WebResourceResponse blocked = BitShieldsHook.intercept(view, request);\n        return blocked != null ? blocked : super.shouldInterceptRequest(view, request);\n    }\n\n    @Override\n    public boolean shouldOverrideUrlLoading(WebView view, String url) {`,
    ],
  ])
}

module.exports = function withShields(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      patchWebView(cfg.modRequest.projectRoot)
      return cfg
    },
  ])
}
module.exports.patchWebView = patchWebView
