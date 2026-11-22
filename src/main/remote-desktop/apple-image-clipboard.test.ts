import { randomBytes } from 'node:crypto'
import { constants, inflateSync } from 'node:zlib'
import type { NativeImage } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { packClipboardImage } from './apple-image-clipboard'

function fixture(data: Buffer, width: number, height: number) {
  return {
    toPNG: () => data,
    getSize: () => ({ width, height }),
    resize: vi.fn(),
  }
}

describe('Apple image clipboard', () => {
  it('frames one complete public.png flavor and a sync-flushed stream', async () => {
    const png = randomBytes(160_000)
    const image = fixture(png, 320, 200)
    const result = await packClipboardImage(image as unknown as NativeImage)
    expect(result?.scaled).toBe(false)
    const packet = result!.packet
    expect(packet[0]).toBe(31)
    expect(packet.readUInt32BE(12)).toBe(packet.length - 16)
    const raw = inflateSync(packet.subarray(16), { finishFlush: constants.Z_SYNC_FLUSH })
    expect(packet.readUInt32BE(8)).toBe(raw.length)
    expect(raw.readUInt32BE(0)).toBe(1)
    expect(raw.readUInt32BE(4)).toBe(10)
    expect(raw.toString('ascii', 8, 18)).toBe('public.png')
    expect(raw.subarray(18, 26)).toEqual(Buffer.alloc(8))
    expect(raw.readUInt32BE(26)).toBe(png.length)
    expect(raw.subarray(30).equals(png)).toBe(true)
  })

  it('resizes an oversized image before sending and retains an image flavor', async () => {
    const image = fixture(randomBytes(8 * 1024 * 1024), 2560, 1440)
    const reduced = fixture(randomBytes(80_000), 1920, 1080)
    image.resize.mockReturnValue(reduced)
    const result = await packClipboardImage(image as unknown as NativeImage)
    expect(result?.scaled).toBe(true)
    expect(image.resize).toHaveBeenCalledOnce()
    const raw = inflateSync(result!.packet.subarray(16), { finishFlush: constants.Z_SYNC_FLUSH })
    expect(raw.subarray(30).equals(reduced.toPNG())).toBe(true)
  })
})
