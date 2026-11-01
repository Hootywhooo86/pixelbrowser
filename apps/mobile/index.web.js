import { registerRootComponent } from 'expo'
import { useEffect, useState } from 'react'
import { View, Text } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import { loadStore, update } from './src/store'
import ImportScreen from './src/ImportScreen'
import BackupScreen from './src/BackupScreen'
import SecurityCheckScreen from './src/SecurityCheckScreen'
import { PIXEL_FONT } from './src/theme'

function Root() {
  const [ok, setOk] = useState(false)
  const [fonts] = useFonts({ [PIXEL_FONT]: require('./assets/fonts/PressStart2P-Regular.ttf') })
  useEffect(() => {
    loadStore().then(() => {
      update((s) => {
        s.passwordIndex = [{ id: 'a', origin: 'https://apps.goshippo.com', username: 'me@x.com' }, { id: 'b', origin: 'https://accounts.google.com', username: 'me@gmail.com' }, { id: 'c', origin: 'https://forum.example.org', username: 'pixelfan' }]
        s.securityReport = {
          at: Date.now(), total: 3, checkedBreaches: true, error: '',
          breached: [{ id: 'c', origin: 'https://forum.example.org', username: 'pixelfan', count: 2412 }],
          reused: [[{ id: 'a', origin: 'https://apps.goshippo.com', username: 'me@x.com' }, { id: 'c', origin: 'https://forum.example.org', username: 'pixelfan' }]],
          weak: [{ id: 'c', origin: 'https://forum.example.org', username: 'pixelfan', score: 0, label: 'Very weak' }],
        }
        s.breachCheck = true
        s.lastBackupAt = Date.now() - 86400000 * 3
      })
      setOk(true)
    })
  }, [])
  const which = (typeof location !== 'undefined' && location.hash.slice(1)) || 'import'
  if (!ok || !fonts) return <Text>loading</Text>
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1 }}>
        {which === 'import' && <ImportScreen visible onClose={() => {}} />}
        {which === 'backup' && <BackupScreen visible onClose={() => {}} />}
        {which === 'security' && <SecurityCheckScreen visible onClose={() => {}} />}
      </View>
    </SafeAreaProvider>
  )
}
registerRootComponent(Root)
