// TEMPORARY web preview harness for H2 screens (deleted after screenshots).
import './src/polyfills'
import { useEffect, useState } from 'react'
import { View, Text } from 'react-native'
import { registerRootComponent } from 'expo'
import { useFonts } from 'expo-font'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { C, PIXEL_FONT } from './src/theme'

function Root() {
  const [ready, setReady] = useState(false)
  const [fonts] = useFonts({ [PIXEL_FONT]: require('./assets/fonts/PressStart2P-Regular.ttf') })
  const [mods, setMods] = useState(null)
  useEffect(() => {
    const store = require('./src/store')
    store.loadStore().then(() => {
      const { addPackage } = require('./src/packages')
      const { addNote } = require('./src/notes')
      const { putRecord } = store
      addPackage({ number: '1Z999AA10123456784', label: 'Blue lamp for Sam' })
      addPackage({ number: '449044304137821' })
      addPackage({ number: 'AA473124829CA', label: 'Mug order' })
      addNote({ text: 'Policy 502862103 renews Dec 20. Call agent about the deductible.', url: 'https://account.ratesinsurance.ca/documents', title: 'Documents' })
      addNote({ text: 'Shippo: use 4x6 labels for small boxes.', space: 'work' })
      putRecord('readlater', 'r1', { url: 'https://example.com/a', title: 'How pixel art came back', siteName: 'Example Mag', addedAt: Date.now(), readAt: 0, hasArticle: true })
      putRecord('readlater', 'r2', { url: 'https://news.example.org/b', title: 'Ten tips for faster shipping', siteName: '', addedAt: Date.now() - 9e6, readAt: Date.now(), hasArticle: false })
      putRecord('bookmarks', 'b1', { url: 'https://goshippo.com', title: 'Shippo', folder: 'Bookmarks', createdAt: 1 })
      store.update((s) => (s.tabGroups = { personal: [{ id: 'g1', name: 'Shipping', color: '#ff9f1c', collapsed: false }, { id: 'g2', name: 'Insurance', color: '#c084fc', collapsed: true }] }))
      setMods({
        PackagesScreen: require('./src/PackagesScreen').default,
        NotesScreen: require('./src/NotesScreen').default,
        ReadingListScreen: require('./src/ReadingListScreen').default,
        CommandBar: require('./src/CommandBar').default,
        TabsScreen: require('./src/TabsScreen').default,
      })
      setReady(true)
    })
  }, [])
  if (!ready || !fonts || !mods) return <View style={{ flex: 1, backgroundColor: C.bg }} />
  const screen = new URLSearchParams(window.location.search).get('s') || 'packages'
  const tabs = [
    { id: 1, url: 'https://goshippo.com/', title: 'Shippo', group: 'g1' },
    { id: 2, url: 'https://www.ups.com/track', title: 'UPS tracking', group: 'g1', pinned: true },
    { id: 3, url: 'https://account.ratesinsurance.ca/documents', title: 'Documents', group: 'g2' },
    { id: 4, url: 'https://github.com/', title: 'GitHub' },
  ]
  const noop = () => {}
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {screen === 'packages' && <mods.PackagesScreen visible onClose={noop} onOpen={noop} onAsk={noop} />}
        {screen === 'notes' && <mods.NotesScreen visible onClose={noop} onOpen={noop} />}
        {screen === 'reading' && <mods.ReadingListScreen visible onClose={noop} onOpen={noop} />}
        {screen === 'command' && (
          <View style={{ flex: 1, paddingTop: 70 }}>
            <Text style={{ color: C.ink, padding: 12 }}>address: {'>'} pri</Text>
            <View style={{ flex: 1 }}>
              <mods.CommandBar query="> pri" tabs={tabs} onAction={noop} onClose={noop} />
            </View>
          </View>
        )}
        {screen === 'tabs' && <mods.TabsScreen visible tabs={tabs} activeId={1} onSelect={noop} onCloseTab={noop} onCloseAll={noop} onNewTab={noop} onOpenUrl={noop} onClose={noop} onSwitchSpace={noop} onTogglePin={noop} onGroupChange={noop} />}
      </View>
    </SafeAreaProvider>
  )
}

registerRootComponent(Root)
