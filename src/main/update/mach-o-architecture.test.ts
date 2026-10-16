import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyPureArm64Executable } from './mach-o-architecture'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function thin(cpu = 0x0100000c, subtype = 0, little = true): Buffer {
  const header = Buffer.alloc(32)
  const write = little ? header.writeUInt32LE.bind(header) : header.writeUInt32BE.bind(header)
  write(0xfeedfacf, 0)
  write(cpu, 4)
  write(subtype, 8)
  write(2, 12)
  return header
}

function fat(wide = false, slice = thin()): Buffer {
  const buffer = Buffer.alloc(256 + slice.length)
  buffer.writeUInt32BE(wide ? 0xcafebabf : 0xcafebabe, 0)
  buffer.writeUInt32BE(1, 4)
  buffer.writeUInt32BE(slice.readUInt32LE(4), 8)
  buffer.writeUInt32BE(slice.readUInt32LE(8), 12)
  if (wide) {
    buffer.writeBigUInt64BE(256n, 16)
    buffer.writeBigUInt64BE(BigInt(slice.length), 24)
  } else {
    buffer.writeUInt32BE(256, 16)
    buffer.writeUInt32BE(slice.length, 20)
  }
  slice.copy(buffer, 256)
  return buffer
}

async function fixture(bytes: Buffer): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'cclink-mach-o-'))
  roots.push(root)
  const path = join(root, 'executable')
  await fs.writeFile(path, bytes)
  return path
}

describe('bounded arm64 architecture inspection', () => {
  it.each([
    ['little endian thin', thin()],
    ['big endian thin', thin(0x0100000c, 0, false)],
    ['capability bits', thin(0x0100000c, 0x80000000)],
    ['single arm64 FAT32', fat()],
    ['single arm64 FAT64', fat(true)],
  ])('accepts %s without developer tools', async (_name, bytes) => {
    await expect(verifyPureArm64Executable(await fixture(bytes))).resolves.toBeUndefined()
  })

  it.each([
    ['x64', thin(0x01000007, 3)],
    ['arm64e', thin(0x0100000c, 2)],
    ['arm64v8', thin(0x0100000c, 1)],
    ['unknown subtype', thin(0x0100000c, 42)],
    ['fat arm64e', fat(false, thin(0x0100000c, 2))],
    [
      'hidden second ARM64 slice',
      (() => {
        const b = fat()
        b.writeUInt32BE(0x0100000c, 28)
        b.writeUInt32BE(2, 32)
        return b
      })(),
    ],
    [
      'universal',
      (() => {
        const b = fat()
        b.writeUInt32BE(2, 4)
        return b
      })(),
    ],
  ])('rejects %s', async (_name, bytes) => {
    await expect(verifyPureArm64Executable(await fixture(bytes))).rejects.toMatchObject({
      code: 'unsupported_arch',
    })
  })

  it.each([
    ['empty', Buffer.alloc(0)],
    ['short header', thin().subarray(0, 31)],
    ['unknown magic', Buffer.alloc(32)],
    [
      'empty fat',
      (() => {
        const b = fat()
        b.writeUInt32BE(0, 4)
        return b
      })(),
    ],
    ['short fat entry', fat().subarray(0, 24)],
    [
      'oversized alignment',
      (() => {
        const b = fat()
        b.writeUInt32BE(16, 24)
        return b
      })(),
    ],
    [
      'misaligned slice',
      (() => {
        const b = fat()
        b.writeUInt32BE(9, 24)
        return b
      })(),
    ],
    [
      'overflowing offset',
      (() => {
        const b = fat(true)
        b.writeBigUInt64BE(2n ** 63n, 16)
        return b
      })(),
    ],
    [
      'slice outside file',
      (() => {
        const b = fat()
        b.writeUInt32BE(9999, 20)
        return b
      })(),
    ],
    [
      'slice overlaps table',
      (() => {
        const b = fat()
        b.writeUInt32BE(8, 16)
        return b
      })(),
    ],
    [
      'inconsistent slice',
      (() => {
        const b = fat()
        thin(0x01000007, 3).copy(b, 256)
        return b
      })(),
    ],
  ])('blocks malformed %s', async (_name, bytes) => {
    await expect(verifyPureArm64Executable(await fixture(bytes))).rejects.toMatchObject({
      code: expect.stringMatching(/release_invalid|unsupported_arch/),
    })
  })

  it('closes its file handle when a bounded read fails', async () => {
    const path = await fixture(thin())
    const original = fs.open.bind(fs)
    const handle = await original(path, 'r')
    const close = vi.spyOn(handle, 'close')
    vi.spyOn(handle, 'read').mockRejectedValueOnce(
      Object.assign(new Error('I/O failure'), { code: 'EIO' }),
    )
    vi.spyOn(fs, 'open').mockResolvedValueOnce(handle)
    await expect(verifyPureArm64Executable(path)).rejects.toMatchObject({
      code: 'verification_failed',
    })
    expect(close).toHaveBeenCalledOnce()
  })
})
