// Bitter panel: slides up over the bottom of the page (so you can watch
// the agent work above it), or sits beside the page on tablets (`side`).
// Chat with Ask/Agent modes, tab context, page and video summaries, source
// chips, and AI web apps (ChatGPT, Claude, Gemini…) with your own account.

import { useEffect, useRef, useState } from 'react'
import { View, ScrollView, TextInput, Pressable, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { WebView } from 'react-native-webview'
import { WEB_APPS, EXTRACT_PAGE, isYouTubeWatch } from '@pixelbrowser/ai-core'
import { ask, session, answerConfirm } from './ai'
import { useStore } from './store'
import { PButton, PText } from './ui'
import Mascot from './Mascot'
import { Markdown } from './markdown'
import { C, PIXEL_FONT, px } from './theme'

const TOOL_TEXT = {
  list_tabs: () => 'checking your tabs',
  read_tab: (i) => `reading tab ${i.tab_id ?? ''}`,
  web_search: (i) => `searching: ${i.query}`,
  open_tab: (i) => `opening ${i.url}`,
  remember: (i) => `remembering: ${i.fact}`,
  forget: (i) => `forgetting: ${i.fact}`,
  look: () => 'looking at the page',
  click: (i) => `tapping #${i.ref}`,
  type: (i) => `typing "${String(i.text || '').slice(0, 40)}"`,
  select_option: (i) => `choosing ${i.value}`,
  press_key: (i) => `pressing ${i.key}`,
  scroll: (i) => `scrolling ${i.direction}`,
  navigate: (i) => `going to ${i.url}`,
  go_back: () => 'going back',
  switch_tab: (i) => `switching to tab ${i.tab_id}`,
  wait: () => 'waiting',
}

const SUGGEST = {
  ask: ['Summarize this page in 5 bullet points.', 'What are the key facts on this page?', 'Compare all my open tabs.', 'Explain this page simply.'],
  agent: ['Search this site for pixel art lamps and open the top result.', 'Go through the results and tell me the 3 cheapest.'],
}

export default function AIPanel({ browser, visible, side = false, request, onClose, onOpenSettings, onAgent, onStep, openUrl }) {
  const provider = useStore((s) => s.ai.provider)
  const space = useStore((s) => s.activeSpace)
  const spaceName = useStore((s) => (s.spaces || []).find((x) => x.id === s.activeSpace)?.name)
  const [talking, setTalking] = useState(false)
  const talkTimer = useRef(null)
  const model = useStore((s) => s.ai.providers[s.ai.provider]?.model)
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState('ask')
  const [input, setInput] = useState('')
  const [includePage, setIncludePage] = useState(true)
  const [picked, setPicked] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [view, setView] = useState('chat')
  const [app, setApp] = useState(null)
  const [tall, setTall] = useState(false)
  const scroller = useRef(null)
  const appView = useRef(null)

  const onEvent = (e) => {
    switch (e.type) {
      case 'user':
        return setItems((x) => [...x, { kind: 'user', text: e.text, mode: e.mode }])
      case 'text':
        clearTimeout(talkTimer.current)
        setTalking(true)
        talkTimer.current = setTimeout(() => setTalking(false), 1600)
        return setItems((x) => [...x, { kind: 'ai', text: e.text, sources: e.sources }])
      case 'tool': {
        const text = (TOOL_TEXT[e.name] || (() => e.name))(e.input || {})
        onStep?.(text)
        return setItems((x) => [...x, { kind: 'tool', text }])
      }
      case 'tool_done':
        return setItems((x) => {
          const copy = [...x]
          for (let i = copy.length - 1; i >= 0; i--) if (copy[i].kind === 'tool' && copy[i].ok === undefined) {
            copy[i] = { ...copy[i], ok: e.ok }
            break
          }
          return copy
        })
      case 'confirm':
        return setItems((x) => [...x, { kind: 'confirm', id: e.id, reason: e.reason, url: e.url, read: e.kind === 'read', budget: e.kind === 'budget' }])
      case 'error':
        return setItems((x) => [...x, { kind: 'error', text: e.message, openSettings: e.openSettings }])
      case 'notice':
        return setItems((x) => [...x, { kind: 'notice', text: e.text }])
      case 'status':
        return setStatus(e.text)
      case 'busy':
        setBusy(e.busy)
        if (!e.busy) setStatus('')
        return
      case 'agent':
        return onAgent?.(e.active)
    }
  }

  const send = (text, extra = {}) => {
    const q = (text ?? input).trim()
    if (!q) return
    setInput('')
    setView('chat')
    ask({ browser, input: q, mode: extra.mode || mode, tabIds: picked.length ? picked : undefined, includePage, ...extra, onEvent })
  }

  // Questions typed in the address bar arrive here.
  useEffect(() => {
    if (!request) return
    // "Let Bitter take over" switches to Agent mode and waits for the task.
    if (request.mode === 'agent' && !request.input) return setMode('agent')
    send(request.input, { search: request.search, includePage: request.includePage, video: request.video, mode: request.mode || 'ask' })
  }, [request?.nonce])

  // Each Space has its own chat.
  useEffect(() => {
    setItems([])
  }, [space])

  useEffect(() => {
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50)
  }, [items.length])

  const answer = (item, ok) => {
    answerConfirm(item.id, ok)
    setItems((x) => x.map((i) => (i === item ? { ...i, answered: ok ? 'ALLOWED' : 'DECLINED' } : i)))
  }

  const sharePage = async () => {
    const page = await browser.run(browser.activeId(), EXTRACT_PAGE).catch(() => null)
    if (!page || !appView.current) return
    const text = `Here is the page I'm looking at.\nTitle: ${page.title}\nURL: ${page.url}\n\n${(page.selection || page.text).slice(0, 8000)}\n\n`
    appView.current.injectJavaScript(`(function(){var t=${JSON.stringify(text)};var el=document.querySelector('textarea,[contenteditable="true"],[contenteditable=""],input[type=text]');if(!el)return;el.focus();if(el.isContentEditable){document.execCommand('insertText',false,t)}else{var p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,(el.value||'')+t);el.dispatchEvent(new Event('input',{bubbles:true}))}})();true;`)
  }

  const tabs = browser.tabs().filter((t) => !t.private)
  const active = browser.tabs().find((t) => t.id === browser.activeId())
  const privateTab = !!active?.private
  const onVideo = !!active && isYouTubeWatch(active.url)
  const summarizePage = () => send('Summarize this page in 5 short bullet points, then one line on why it matters.', { mode: 'ask', includePage: true, tabIds: undefined })
  const summarizeVideo = () => send('Summarize this video: the main points in order, then a one-line takeaway.', { mode: 'ask', includePage: false, tabIds: undefined, video: true })
  const selectTab = (id) => {
    if (browser.tabs().some((t) => t.id === id)) browser.selectTab(id)
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[side ? st.side : [st.panel, { height: tall || app ? '88%' : '58%' }], !visible && { display: 'none' }]}
    >
      {/* header */}
      <View style={[st.head, side && { paddingTop: 8 }]}>
        {!side && <Pressable onPress={() => setTall(!tall)} style={st.grip} accessibilityLabel={tall ? 'Make the panel smaller' : 'Make the panel taller'} hitSlop={10} />}
        {app ? (
          <>
            <PButton small icon="back" label="BITTER" onPress={() => setApp(null)} />
            <PText style={{ flex: 1 }} numberOfLines={1}>{WEB_APPS[app]?.label.toUpperCase()}</PText>
            <PButton small hot icon="share" label="SHARE PAGE" onPress={sharePage} />
          </>
        ) : (
          <>
            <Mascot state={busy ? 'thinking' : talking ? 'talking' : 'idle'} size={28} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <PText numberOfLines={1}>BITTER</PText>
              {space && space !== 'personal' && <Text style={st.space} numberOfLines={1}>{(spaceName || space).toUpperCase()}</Text>}
            </View>
            <PButton small label={view === 'apps' ? 'CHAT' : 'APPS'} onPress={() => setView(view === 'apps' ? 'chat' : 'apps')} />
            <PButton small icon="plus" label="NEW" onPress={() => { session.newChat(); setItems([]) }} />
          </>
        )}
        <PButton small icon="close" accessibilityLabel="Close Bitter" onPress={onClose} />
      </View>

      {app ? (
        <WebView ref={appView} source={{ uri: WEB_APPS[app].url }} style={{ flex: 1, backgroundColor: C.bg }} setSupportMultipleWindows={false} />
      ) : view === 'apps' ? (
        <ScrollView contentContainerStyle={st.apps}>
          <Text style={st.muted}>Use any AI with your own account. Tap SHARE PAGE to paste the page into it.</Text>
          <View style={st.grid}>
            {Object.entries(WEB_APPS).map(([id, a]) => (
              <PButton key={id} label={a.label.toUpperCase()} onPress={() => setApp(id)} style={{ width: '47%' }} />
            ))}
          </View>
        </ScrollView>
      ) : privateTab ? (
        <View style={st.apps}>
          <Text style={st.muted}>Bitter is off in private tabs, so nothing you do there leaves this phone.</Text>
        </View>
      ) : (
        <>
          <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={st.list}>
            {items.length === 0 && (
              <View style={{ gap: 8 }}>
                <Text style={st.muted}>Hi! I'm Bitter. I can read this page, compare tabs and search the web. In AGENT mode I can tap and type for you.</Text>
                {SUGGEST[mode].map((q) => (
                  <Pressable key={q} style={st.suggest} onPress={() => send(q, q.includes('open tabs') ? { tabIds: tabs.map((t) => t.id) } : {})}>
                    <Text style={st.suggestText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {items.map((item, i) => (
              <Item key={i} item={item} onAnswer={answer} onLink={openUrl} onTab={selectTab} onOpenSettings={onOpenSettings} />
            ))}
          </ScrollView>
          {!!status && <Text style={st.status} numberOfLines={2}>{'> '}{status}</Text>}

          {/* composer */}
          <View style={[st.composer, side && { paddingBottom: 10 }]}>
            <View style={[st.row, { flexWrap: 'wrap' }]}>
              <Chip label="SUMMARIZE PAGE" onPress={() => !busy && summarizePage()} bright />
              {onVideo && <Chip label="SUMMARIZE VIDEO" onPress={() => !busy && summarizeVideo()} bright color={C.orange} />}
            </View>
            <View style={st.row}>
              {picked.length ? (
                <Chip on label={`${picked.length} TAB${picked.length > 1 ? 'S' : ''} ×`} onPress={() => setPicked([])} />
              ) : (
                <Chip on={includePage} label={includePage ? `THIS TAB: ${(active?.title || 'New tab').slice(0, 18)}` : 'NO PAGE'} onPress={() => setIncludePage(!includePage)} />
              )}
              <Chip label="+ TABS" onPress={() => setShowPicker(!showPicker)} />
              <Text style={[st.muted, { marginLeft: 'auto', fontSize: 11 }]} numberOfLines={1}>{provider} · {model || 'default'}</Text>
            </View>
            {showPicker && (
              <View style={st.picker}>
                {tabs.map((t) => {
                  const on = picked.includes(t.id)
                  return (
                    <Pressable key={t.id} onPress={() => setPicked(on ? picked.filter((x) => x !== t.id) : [...picked, t.id])}>
                      <Text style={{ color: on ? C.teal : C.ink, paddingVertical: 4 }} numberOfLines={1}>{on ? '[x] ' : '[ ] '}{t.title}</Text>
                    </Pressable>
                  )
                })}
              </View>
            )}
            <View style={st.row}>
              {['ask', 'agent'].map((m) => (
                <Pressable key={m} onPress={() => setMode(m)} style={[st.mode, mode === m && { backgroundColor: m === 'agent' ? C.pink : C.teal, borderColor: m === 'agent' ? '#a02a55' : C.tealDark }]}>
                  <Text style={[st.modeText, mode === m && { color: C.bg }]}>{m.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>
            <View style={[st.row, { alignItems: 'stretch' }]}>
              <TextInput
                style={st.input}
                value={input}
                onChangeText={setInput}
                placeholder={mode === 'agent' ? 'Tell Bitter what to do on this page…' : 'Ask about this page…'}
                placeholderTextColor={C.muted}
                multiline
              />
              <PButton hot={!busy} label={busy ? 'STOP' : 'SEND'} onPress={() => (busy ? session.stop() : send())} style={{ height: 'auto' }} />
            </View>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  )
}

function Chip({ label, on, onPress, bright, color }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [st.chip, on && { borderColor: C.teal }, color && { borderColor: color }, pressed && { backgroundColor: C.edge }]}
    >
      <Text style={[st.chipText, (on || bright) && { color: C.ink }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

/** Source chips under an answer: a link opens in a new tab; "TAB 3" switches to that tab. */
function Sources({ sources, onLink, onTab }) {
  if (!sources?.length) return null
  return (
    <View style={st.sources}>
      <Text style={st.sourcesLabel}>SOURCES</Text>
      {sources.map((s, i) =>
        s.type === 'tab' ? (
          <Pressable key={i} onPress={() => onTab(s.tabId)} style={[st.src, { borderColor: C.orange }]} accessibilityLabel={`Switch to tab ${s.tabId}`}>
            <Text style={[st.srcText, { color: C.orange }]}>TAB {s.tabId}</Text>
          </Pressable>
        ) : (
          <Pressable key={i} onPress={() => onLink(s.url)} style={st.src} accessibilityLabel={`Open ${s.title}`}>
            <Text style={st.srcText} numberOfLines={1}>{(s.host || s.title).slice(0, 26)}</Text>
          </Pressable>
        )
      )}
    </View>
  )
}

function Item({ item, onAnswer, onLink, onTab, onOpenSettings }) {
  switch (item.kind) {
    case 'user':
      return (
        <View style={st.user}>
          <Text style={st.userTag}>{item.mode === 'agent' ? 'AGENT' : 'ASK'}</Text>
          <Text style={{ color: C.bg, fontSize: 15 }}>{item.text}</Text>
        </View>
      )
    case 'ai':
      return (
        <View style={st.ai}>
          <Markdown text={item.text} onLink={onLink} onTab={onTab} />
          <Sources sources={item.sources} onLink={onLink} onTab={onTab} />
        </View>
      )
    case 'tool':
      return <Text style={[st.tool, { borderLeftColor: item.ok === undefined ? C.edge : item.ok ? C.teal : C.pink }]}>{'> '}{item.text}</Text>
    case 'confirm':
      return (
        <View style={st.confirm}>
          <PText style={{ color: C.orange, fontSize: 8 }}>{item.answered || (item.budget ? 'SPENDING CAP REACHED' : item.read ? 'SHARE THIS PAGE?' : 'ALLOW THIS STEP?')}</PText>
          <Text style={{ color: C.ink, marginTop: 6 }}>{item.reason}</Text>
          {!!item.url && <Text style={[st.muted, { fontSize: 11 }]}>{item.url}</Text>}
          {!item.answered && (
            <View style={st.row}>
              <PButton hot color={C.orange} label={item.budget ? 'CONTINUE' : 'ALLOW'} onPress={() => onAnswer(item, true)} />
              <PButton label={item.budget ? 'STOP' : 'NO'} onPress={() => onAnswer(item, false)} />
            </View>
          )}
        </View>
      )
    case 'error':
      return (
        <View style={[st.ai, { borderColor: C.pink }]}>
          <Text style={{ color: C.ink }}>{item.text}</Text>
          {item.openSettings && <PButton hot label="OPEN SETTINGS" onPress={onOpenSettings} style={{ marginTop: 8, alignSelf: 'flex-start' }} />}
        </View>
      )
    case 'notice':
      return <Text style={[st.muted, { textAlign: 'center' }]}>{item.text}</Text>
    default:
      return null
  }
}

const st = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.bg, borderTopWidth: 3, borderTopColor: C.teal },
  side: { flex: 1, backgroundColor: C.bg, borderLeftWidth: 3, borderLeftColor: C.teal },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 52, paddingHorizontal: 10, paddingTop: 14, paddingBottom: 8, backgroundColor: C.panel, borderBottomWidth: 3, borderBottomColor: C.edge },
  grip: { position: 'absolute', top: 4, left: '42%', width: '16%', height: 5, backgroundColor: C.edge },
  space: { ...px(6), color: C.orange, marginTop: 3 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.edge },
  sourcesLabel: { ...px(6), color: C.muted, marginRight: 2 },
  src: { borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg, paddingHorizontal: 6, paddingVertical: 5, maxWidth: 170 },
  srcText: { ...px(7), color: C.teal },
  list: { padding: 12, gap: 10 },
  apps: { padding: 12, gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  muted: { color: C.muted, fontSize: 13 },
  suggest: { borderWidth: 3, borderRightWidth: 5, borderBottomWidth: 5, borderColor: C.edge, borderRightColor: '#05050f', borderBottomColor: '#05050f', backgroundColor: C.panel, padding: 10 },
  suggestText: { color: C.ink, ...px(8) },
  user: { alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: C.teal, padding: 10, borderRightWidth: 4, borderBottomWidth: 4, borderColor: C.tealDark },
  userTag: { ...px(7), color: C.bg, opacity: 0.7, marginBottom: 4 },
  ai: { backgroundColor: C.panel, borderWidth: 3, borderColor: C.edge, padding: 10 },
  tool: { ...px(7), color: C.muted, borderLeftWidth: 3, paddingLeft: 8, paddingVertical: 2 },
  confirm: { borderWidth: 3, borderColor: C.orange, backgroundColor: '#2a1a05', padding: 10 },
  status: { ...px(8), color: C.orange, paddingHorizontal: 12, paddingVertical: 6 },
  composer: { padding: 10, gap: 8, backgroundColor: C.panel, borderTopWidth: 3, borderTopColor: C.edge, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: { borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg, paddingHorizontal: 7, minHeight: 26, justifyContent: 'center', maxWidth: '60%' },
  chipText: { ...px(7), color: C.muted },
  picker: { borderWidth: 2, borderColor: C.edge, backgroundColor: C.bg, paddingHorizontal: 8, maxHeight: 140 },
  mode: { borderWidth: 3, borderColor: C.edge, backgroundColor: C.bg, paddingHorizontal: 12, height: 32, justifyContent: 'center' },
  modeText: { ...px(8), color: C.muted },
  input: { flex: 1, minHeight: 44, maxHeight: 110, backgroundColor: C.bg, borderWidth: 3, borderColor: C.edge, color: C.ink, paddingHorizontal: 10, paddingVertical: 10, fontSize: 15, textAlignVertical: 'top' },
})
