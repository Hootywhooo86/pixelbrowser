import './src/polyfills'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { registerRootComponent } from 'expo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { applyThemeToC, THEME_KEY, C } from './src/theme'

// Every screen builds its styles when its file first loads, so the saved
// pixel theme is copied into the color tokens BEFORE App (and everything it
// imports) is required. Changing the theme reloads the app.
let App = null

function Root() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((raw) => raw && applyThemeToC(JSON.parse(raw)))
      .catch(() => {})
      .finally(() => {
        App = require('./App').default
        setReady(true)
      })
  }, [])
  if (!ready) return <View style={{ flex: 1, backgroundColor: C.bg }} />
  return <App />
}

registerRootComponent(Root)

import './src/find'
import './src/FindBar'
import './src/site-settings'
import './src/SiteSettingsSheet'
import './src/formfill'
import './src/page-tools'
import './src/crash'
