import { describe, expect, it } from 'vitest'
import { decodePdfBase64 } from './pdf-preview-data'

describe('decodePdfBase64', () => {
  it('decodes binary PDF bytes without treating them as text', () => {
    const source = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a])
    const content = Buffer.from(source).toString('base64')

    expect(decodePdfBase64(content)).toEqual(source)
  })
})
