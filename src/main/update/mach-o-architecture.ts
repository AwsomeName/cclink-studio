import { constants, promises as fs } from 'node:fs'
import { UpdateAssetVerificationError, verificationFailure } from './update-verification-error'

const ARM64 = 0x0100000c
const SUBTYPE_MASK = 0x00ffffff
const HEADER_SIZE = 32

/** Architecture-only check; code signing and Gatekeeper remain separate mandatory gates. */
export async function verifyPureArm64Executable(
  path: string,
  step = '应用架构读取',
): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stats = await handle.stat()
    if (!stats.isFile() || !Number.isSafeInteger(stats.size)) invalid()
    const read = async (offset: number, length: number): Promise<Buffer> => {
      if (offset < 0 || offset > stats.size - length) invalid()
      const buffer = Buffer.alloc(length)
      let total = 0
      while (total < length) {
        const { bytesRead } = await handle!.read(buffer, total, length - total, offset + total)
        if (!bytesRead) invalid()
        total += bytesRead
      }
      return buffer
    }
    const prefix = await read(0, 8)
    const magic = prefix.readUInt32BE(0)
    if (magic === 0xcafebabe || magic === 0xcafebabf) {
      const count = prefix.readUInt32BE(4)
      if (!count) invalid()
      if (count !== 1) unsupported()
      const wide = magic === 0xcafebabf
      const entry = await read(8, wide ? 32 : 20)
      const cpu = entry.readUInt32BE(0)
      const subtype = entry.readUInt32BE(4)
      assertArm64(cpu, subtype)
      const offset = wide ? entry.readBigUInt64BE(8) : BigInt(entry.readUInt32BE(8))
      const size = wide ? entry.readBigUInt64BE(16) : BigInt(entry.readUInt32BE(12))
      if (
        offset < BigInt(8 + entry.length) ||
        size < BigInt(HEADER_SIZE) ||
        offset + size > BigInt(stats.size)
      )
        invalid()
      const alignment = entry.readUInt32BE(wide ? 24 : 16)
      if (alignment > 15 || offset % (1n << BigInt(alignment)) !== 0n) invalid()
      // cctools lipo also counts the legacy hidden ARM64 entry after a FAT32 table.
      if (!wide && offset >= 48n && stats.size >= 48) {
        const hidden = await read(28, 20)
        if (hidden.readUInt32BE(0) === ARM64) unsupported()
      }
      const header = await read(Number(offset), HEADER_SIZE)
      const slice = readThinArchitecture(header)
      if (slice.cpu !== cpu || (slice.subtype & SUBTYPE_MASK) !== (subtype & SUBTYPE_MASK))
        invalid()
    } else {
      readThinArchitecture(await read(0, HEADER_SIZE))
    }
  } catch (error) {
    throw verificationFailure(step, error)
  } finally {
    await handle?.close()
  }
}

function readThinArchitecture(header: Buffer): { cpu: number; subtype: number } {
  const magic = header.readUInt32BE(0)
  if (magic !== 0xcffaedfe && magic !== 0xfeedfacf) invalid()
  const read =
    magic === 0xcffaedfe ? header.readUInt32LE.bind(header) : header.readUInt32BE.bind(header)
  const cpu = read(4)
  const subtype = read(8)
  assertArm64(cpu, subtype)
  return { cpu, subtype }
}

function assertArm64(cpu: number, subtype: number): void {
  // lipo's arm64 name is ARM64_ALL, with capability bits masked, not arm64e/arm64v8.
  if (cpu !== ARM64 || (subtype & SUBTYPE_MASK) !== 0) unsupported()
}

function unsupported(): never {
  throw new UpdateAssetVerificationError(
    'unsupported_arch',
    '更新应用不是纯 Apple Silicon arm64 构建',
  )
}

function invalid(): never {
  throw new UpdateAssetVerificationError('release_invalid', '更新应用的可执行文件头无效')
}
