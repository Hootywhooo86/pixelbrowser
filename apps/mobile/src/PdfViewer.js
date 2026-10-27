// PDF viewer. Android's web view can't show PDFs, so downloaded PDFs
// (shipping labels, invoices, tickets…) open here: pdf.js draws each page,
// you can pinch to zoom, and PRINT sends the real PDF to the phone's print
// service so labels come out at their true size.

import { useEffect, useRef, useState } from 'react'
import { Modal, View, Text, StyleSheet, Alert, ScrollView } from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { readDownloadBase64, printDownload, shareDownload, saveDownloadCopy, openDownload, formatSize } from './downloads'
import { PButton, PText } from './ui'
import { C } from './theme'

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174'
const CHUNK = 512 * 1024

// The page inside the viewer. It asks for the PDF once pdf.js has loaded,
// receives it in base64 chunks, then draws every page to a canvas.
export const VIEWER_HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes">
<style>
  html,body{margin:0;background:${C.bg};}
  #pages{display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px 8px 40px}
  canvas{background:#fff;box-shadow:4px 4px 0 #05050f;max-width:100%;height:auto}
  #msg{color:${C.muted};font:14px sans-serif;text-align:center;padding:24px}
</style></head><body>
<div id="msg">Opening PDF…</div><div id="pages"></div>
<script>
  function post(o){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(o)) }catch(e){} }
  var parts = [];
  window.__pdfPart = function(c){ parts.push(c) };
  window.__pdfDone = function(){
    var b64 = parts.join(''); parts = [];
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    render(bytes);
  };
  function fail(text){ document.getElementById('msg').textContent = text; post({ error: text }) }
  function render(bytes){
    pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise.then(function(pdf){
      document.getElementById('msg').style.display = 'none';
      post({ pages: pdf.numPages });
      var box = document.getElementById('pages');
      var width = Math.min(document.documentElement.clientWidth - 16, 900);
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var chain = Promise.resolve();
      for (var n = 1; n <= pdf.numPages; n++) (function(n){
        chain = chain.then(function(){ return pdf.getPage(n) }).then(function(page){
          var base = page.getViewport({ scale: 1 });
          var vp = page.getViewport({ scale: (width / base.width) * dpr });
          var c = document.createElement('canvas');
          c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
          c.style.width = Math.floor(vp.width / dpr) + 'px';
          box.appendChild(c);
          return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        });
      })(n);
      return chain.then(function(){ post({ rendered: true }) });
    }).catch(function(e){ fail("Couldn't show this PDF: " + (e && e.message || e)) });
  }
  function start(){
    // A same-origin copy of the worker so pdf.js can run it off the main thread.
    fetch('${PDFJS}/pdf.worker.min.js').then(function(r){ return r.text() }).then(function(t){
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([t], { type: 'text/javascript' }));
    }).catch(function(){ pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.js' }).then(function(){ post({ ready: true }) });
  }
</script>
<script src="${PDFJS}/pdf.min.js" onload="start()" onerror="fail('Showing PDFs needs an internet connection the first time. You can still PRINT, SAVE or OPEN WITH another app.')"></script>
</body></html>`

export default function PdfViewer({ item, visible, onClose }) {
  const insets = useSafeAreaInsets()
  const view = useRef(null)
  const [pages, setPages] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    setPages(0)
    setError('')
  }, [item?.id, visible])

  const run = (fn) => () => fn().catch((e) => Alert.alert("Couldn't do that", String(e?.message || e)))

  // pdf.js is ready: send the file over in pieces.
  const sendPdf = async () => {
    try {
      const b64 = await readDownloadBase64(item)
      for (let i = 0; i < b64.length; i += CHUNK) view.current?.injectJavaScript(`window.__pdfPart(${JSON.stringify(b64.slice(i, i + CHUNK))});true;`)
      view.current?.injectJavaScript('window.__pdfDone();true;')
    } catch (e) {
      setError(`Couldn't read the file: ${e?.message || e}`)
    }
  }

  const onMessage = (e) => {
    let m
    try {
      m = JSON.parse(e.nativeEvent.data)
    } catch {
      return
    }
    if (m.ready) sendPdf()
    else if (m.pages) setPages(m.pages)
    else if (m.error) setError(m.error)
  }

  if (!item) return null
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={st.head}>
          <View style={{ flex: 1 }}>
            <PText style={st.title} numberOfLines={1}>{item.filename}</PText>
            <Text style={st.sub} numberOfLines={1}>
              {[pages ? `${pages} page${pages === 1 ? '' : 's'}` : '', formatSize(item.size)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <PButton small label="DONE" onPress={onClose} />
        </View>
        <ScrollView horizontal style={st.actionsBar} contentContainerStyle={st.actions} showsHorizontalScrollIndicator={false}>
          <PButton small hot label="PRINT" onPress={run(() => printDownload(item))} />
          <PButton small label="SAVE" onPress={run(async () => (await saveDownloadCopy(item)) && Alert.alert('Saved', `${item.filename} was saved.`))} />
          <PButton small label="SHARE" onPress={run(() => shareDownload(item))} />
          <PButton small label="OPEN WITH" onPress={run(() => openDownload(item))} />
        </ScrollView>
        {!!error && <Text style={st.error}>{error}</Text>}
        {visible && (
          <WebView
            ref={view}
            style={{ flex: 1, backgroundColor: C.bg }}
            originWhitelist={['*']}
            source={{ html: VIEWER_HTML, baseUrl: 'https://pdf.bitbrowser.invalid/' }}
            onMessage={onMessage}
            setSupportMultipleWindows={false}
            setBuiltInZoomControls
            setDisplayZoomControls={false}
            // Not incognito: on Android that erases every site's cookies (sign-ins) app-wide.
            cacheEnabled={false}
          />
        )}
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  title: { fontSize: 10, lineHeight: 16, color: C.ink },
  sub: { color: C.muted, fontSize: 12, marginTop: 2 },
  actionsBar: { flexGrow: 0, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  error: { color: C.pink, fontSize: 13, padding: 12, backgroundColor: C.panel },
})
