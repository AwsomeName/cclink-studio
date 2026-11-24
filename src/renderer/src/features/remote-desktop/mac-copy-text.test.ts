import { describe, expect, it } from 'vitest'
import { unpackMacText } from './mac-copy-text'

function word(value: number) {
  const result = Buffer.alloc(4)
  result.writeUInt32BE(value)
  return result
}
function field(data: Buffer) {
  return Buffer.concat([word(data.length), data])
}
function item(type: string, data: Buffer) {
  return Buffer.concat([word(1), field(Buffer.from(type)), word(0), word(0), field(data)])
}

describe('Apple packed pasteboard text', () => {
  it('preserves Unicode, newlines and multiple items while ignoring images', () => {
    const bytes = Buffer.concat([
      item('public.png', Buffer.from([1, 2])),
      item('public.utf8-plain-text', Buffer.from('第一行\n🙂')),
      item('public.utf16-plain-text', Buffer.from('\ufeff第二行', 'utf16le')),
    ])
    expect(unpackMacText(bytes)).toBe('第一行\n🙂\n第二行')
    expect(unpackMacText(bytes.subarray(0, -1))).toBeNull()
  })

  it('ignores non-text instead of clearing the local clipboard', () => {
    expect(unpackMacText(item('public.png', Buffer.from('image')))).toBeNull()
  })
})
