// Tiny markdown renderer for AI answers: paragraphs, lists, **bold**, `code`, links.
import { Text, View } from 'react-native'
import { C } from './theme'

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g

function inline(text, onLink, keyBase) {
  return text.split(TOKEN).filter(Boolean).map((part, i) => {
    const key = `${keyBase}-${i}`
    if (part.startsWith('**')) return <Text key={key} style={{ fontWeight: '700' }}>{part.slice(2, -2)}</Text>
    if (part.startsWith('`')) return <Text key={key} style={{ fontFamily: 'Courier', backgroundColor: C.bg }}>{part.slice(1, -1)}</Text>
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
    if (link || /^https?:\/\//.test(part)) {
      const url = link ? link[2] : part
      return (
        <Text key={key} style={{ color: C.teal, textDecorationLine: 'underline' }} onPress={() => onLink(url)}>
          {link ? link[1] : part}
        </Text>
      )
    }
    return part
  })
}

export function Markdown({ text, onLink, color = C.ink }) {
  const lines = String(text).replace(/```[a-z]*\n?/g, '').split('\n')
  return (
    <View style={{ gap: 4 }}>
      {lines.map((line, i) => {
        if (!line.trim()) return null
        const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/)
        const heading = line.match(/^#{1,4}\s+(.*)/)
        const body = item ? item[1] : heading ? heading[1] : line
        return (
          <Text key={i} style={{ color, fontSize: 15, lineHeight: 21, fontWeight: heading ? '700' : '400' }}>
            {item ? '•  ' : ''}
            {inline(body, onLink, i)}
          </Text>
        )
      })}
    </View>
  )
}
