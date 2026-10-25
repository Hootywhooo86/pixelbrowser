// Retro sound effects (off by default; Settings → Display → Appearance).

import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { getState } from './store'

const FILES = {
  tab: require('../assets/sounds/tab.wav'),
  block: require('../assets/sounds/block.wav'),
  levelup: require('../assets/sounds/levelup.wav'),
  click: require('../assets/sounds/click.wav'),
}
const MIN_GAP = { block: 2000 } // ms between repeats; ad blocks can fire in bursts

const players = {}
const lastPlayed = {}
let modeSet = false

/** Play a sound effect: 'tab' | 'block' | 'levelup' | 'click'. Does nothing while sounds are off. */
export function play(name) {
  if (!getState()?.sounds || !FILES[name]) return
  const now = Date.now()
  if (now - (lastPlayed[name] || 0) < (MIN_GAP[name] || 80)) return
  lastPlayed[name] = now
  try {
    if (!modeSet) {
      modeSet = true
      // Mix with whatever else is playing, and stay quiet in silent mode.
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {})
    }
    const p = players[name] || (players[name] = createAudioPlayer(FILES[name]))
    p.seekTo(0)
    p.play()
  } catch {}
}
