// Bitter, the pixel robot mascot (frames drawn by scripts/make-mascot.py).

import { useEffect, useState } from 'react'
import { Image } from 'react-native'

const FRAMES = {
  idle: [require('../assets/bitter/bitter-idle1-128.png'), require('../assets/bitter/bitter-idle2-128.png')],
  thinking: [require('../assets/bitter/bitter-think1-128.png'), require('../assets/bitter/bitter-think2-128.png')],
  talking: [require('../assets/bitter/bitter-talk1-128.png'), require('../assets/bitter/bitter-talk2-128.png')],
}
// Idle mostly holds still and blinks now and then; the others loop quickly.
const TIMING = { idle: [2600, 160], thinking: [380, 380], talking: [180, 180] }

export default function Mascot({ state = 'idle', size = 32, style }) {
  const frames = FRAMES[state] || FRAMES.idle
  const timing = TIMING[state] || TIMING.idle
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0)
    let n = 0
    let t
    const tick = () => {
      t = setTimeout(() => {
        n = (n + 1) % frames.length
        setI(n)
        tick()
      }, timing[n] || 300)
    }
    tick()
    return () => clearTimeout(t)
  }, [state])
  return <Image source={frames[i] || frames[0]} style={[{ width: size, height: size }, style]} resizeMode="contain" fadeDuration={0} accessibilityLabel="Bitter" />
}
