import type { NativeImage } from 'electron'
import { promisify } from 'node:util'
import { constants, deflate } from 'node:zlib'

const compress = promisify(deflate)
const MAX_COMPRESSED = 7 * 1024 * 1024
const PNG_TYPE = Buffer.from('public.png')

// Apple packed scrap (command 31): one pasteboard item with one UTI flavor.
// The native viewer ends its zlib stream at a sync-flush boundary. Wire reference:
// https://github.com/kitknox/rootshell-vnc/blob/v0.1.49/Sources/RFBTransport/Session/AppleClipboardProtocol.swift
async function packPng(png: Buffer): Promise<Buffer> {
  const header = Buffer.alloc(20 + PNG_TYPE.length)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(PNG_TYPE.length, 4)
  PNG_TYPE.copy(header, 8)
  // Flavor flags and UTI tag count are both zero.
  header.writeUInt32BE(png.length, 16 + PNG_TYPE.length)
  const scrap = Buffer.concat([header, png])
  const zipped = await compress(scrap, { level: 1, finishFlush: constants.Z_SYNC_FLUSH })
  const envelope = Buffer.alloc(16)
  envelope[0] = 31
  envelope.writeUInt32BE(scrap.length, 8)
  envelope.writeUInt32BE(zipped.length, 12)
  return Buffer.concat([envelope, zipped])
}

export async function packClipboardImage(source: NativeImage) {
  let image = source
  let scaled = false
  for (let attempt = 0; attempt < 5; attempt++) {
    const { width, height } = image.getSize()
    if (!width || !height) return null
    // Bound the first PNG encode for unusually large Retina screenshots.
    let ratio = Math.min(1, Math.sqrt(16_000_000 / (width * height)))
    if (ratio === 1) {
      const png = image.toPNG()
      if (!png.length) return null
      const packet = await packPng(png)
      if (packet.length - 16 <= MAX_COMPRESSED) return { packet, scaled }
      ratio = Math.sqrt(MAX_COMPRESSED / (packet.length - 16)) * 0.9
    }
    image = image.resize({
      width: Math.max(1, Math.floor(width * ratio)),
      height: Math.max(1, Math.floor(height * ratio)),
      quality: 'best',
    })
    scaled = true
  }
  return null
}
