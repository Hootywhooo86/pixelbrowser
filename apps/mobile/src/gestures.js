// Bottom-bar gestures: swipe left/right on the bar to switch tabs, swipe up
// to open the tab grid. Taps on the buttons still work (the bar only takes
// over once the finger has clearly moved).

import { useMemo, useRef } from 'react'
import { Animated, PanResponder } from 'react-native'

/**
 * const { panHandlers, style } = useBottomBarGestures({ onPrevTab, onNextTab, onShowTabs })
 * <Animated.View {...panHandlers} style={[st.bottom, style]}>…buttons…</Animated.View>
 */
export function useBottomBarGestures({ onPrevTab, onNextTab, onShowTabs }) {
  const x = useRef(new Animated.Value(0)).current
  const cb = useRef({})
  cb.current = { onPrevTab, onNextTab, onShowTabs }

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 18 || g.dy < -18,
        onPanResponderMove: (_e, g) => {
          if (Math.abs(g.dx) > Math.abs(g.dy)) x.setValue(Math.max(-60, Math.min(60, g.dx / 3)))
        },
        onPanResponderRelease: (_e, g) => {
          Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 30, bounciness: 6 }).start()
          if (g.dy < -40 && Math.abs(g.dy) > Math.abs(g.dx)) return cb.current.onShowTabs?.()
          if (g.dx > 60 || g.vx > 0.8) return cb.current.onPrevTab?.()
          if (g.dx < -60 || g.vx < -0.8) return cb.current.onNextTab?.()
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
      }),
    []
  )

  return { panHandlers: pan.panHandlers, style: { transform: [{ translateX: x }] } }
}

/** Next/previous tab id within a list (wraps around). */
export function neighbourTab(list, activeId, dir) {
  if (!list.length) return null
  const i = list.findIndex((t) => t.id === activeId)
  return list[(i + dir + list.length) % list.length].id
}
