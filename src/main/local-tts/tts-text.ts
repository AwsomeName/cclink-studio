import MarkdownIt from 'markdown-it'
import { TTS_MAX_TEXT } from '../../shared/local-tts'

const markdown = new MarkdownIt({ html: false, linkify: false })

/** Parse formatting rather than deleting Markdown with overlapping regular expressions. */
export function speechText(text: string, format: 'markdown' | 'plain'): string {
  if (text.length > TTS_MAX_TEXT) throw new Error('内容过长，请选中一部分后朗读')
  if (format === 'plain') return text.replaceAll('\0', '').trim()
  const tokens = markdown.parse(text, {})
  return tokens
    .flatMap((token) => {
      if (token.type === 'fence' || token.type === 'code_block') return ['此处为代码块。\n\n']
      if (token.type === 'inline')
        return [
          (token.children ?? [])
            .map((child) => {
              if (child.type === 'text' || child.type === 'code_inline') return child.content
              if (child.type === 'image') return child.content ? `图片：${child.content}。` : ''
              if (child.type === 'softbreak' || child.type === 'hardbreak') return '\n'
              return ''
            })
            .join(''),
        ]
      if (['paragraph_close', 'heading_close', 'tr_close', 'list_item_close'].includes(token.type))
        return ['\n\n']
      if (token.type === 'th_close' || token.type === 'td_close') return ['，']
      return []
    })
    .join('')
    .replaceAll('\0', '')
    .trim()
}

/** Bound inference cost by splitting at sentence boundaries, then at Unicode characters. */
export function speechSegments(text: string): string[] {
  const result: string[] = []
  for (const paragraph of text.split(/\n\s*\n/)) {
    let current = ''
    for (const sentence of paragraph.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/gu) ?? []) {
      const pieces = Array.from(sentence.trim())
      while (pieces.length) {
        const piece = pieces.splice(0, 180).join('')
        if (current.length + piece.length > 220) {
          if (current.trim()) result.push(current.trim())
          current = ''
        }
        current += piece
      }
    }
    if (current.trim()) result.push(current.trim())
  }
  if (!result.length) throw new Error('没有可朗读文字，请选择正文后重试')
  if (result.length > 1500) throw new Error('内容段落过多，请选中一部分后朗读')
  return result
}
