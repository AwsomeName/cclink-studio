import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ManagedClaudeInstallProgress } from '../../shared/ipc/runtime-components'
import { RuntimeComponentInstallError } from './runtime-install-error'

const MAX_DOWNLOAD_BYTES = 160 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const ALLOWED_DOWNLOAD_HOSTS = new Set(['registry.npmjs.org'])

export async function downloadPackage(
  urlValue: string,
  destination: string,
  expectedIntegrity: string,
  onProgress: (progress: ManagedClaudeInstallProgress) => void,
): Promise<void> {
  const url = new URL(urlValue)
  if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new RuntimeComponentInstallError('DOWNLOAD_FAILED', '下载地址不在允许列表')
  }
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { 'user-agent': 'CCLink-Studio-Runtime-Installer/1' },
  })
  if (!response.ok || !response.body) {
    throw new RuntimeComponentInstallError(
      'DOWNLOAD_FAILED',
      `npm 包下载失败：HTTP ${response.status}`,
    )
  }
  const declaredLength = parseContentLength(response.headers.get('content-length'))
  if (declaredLength !== null && declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new RuntimeComponentInstallError('DOWNLOAD_TOO_LARGE', 'npm 包超过允许大小')
  }

  const expectedDigest = parseSha512Integrity(expectedIntegrity)
  const hash = createHash('sha512')
  let receivedBytes = 0
  const tracker = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length
      if (receivedBytes > MAX_DOWNLOAD_BYTES) {
        callback(new RuntimeComponentInstallError('DOWNLOAD_TOO_LARGE', 'npm 包超过允许大小'))
        return
      }
      hash.update(chunk)
      onProgress({
        receivedBytes,
        totalBytes: declaredLength,
        percent:
          declaredLength && declaredLength > 0
            ? Math.min(100, Math.round((receivedBytes / declaredLength) * 100))
            : null,
      })
      callback(null, chunk)
    },
  })

  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      tracker,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    )
  } catch (error) {
    await rm(destination, { force: true })
    if (error instanceof RuntimeComponentInstallError) throw error
    throw new RuntimeComponentInstallError(
      'DOWNLOAD_FAILED',
      `npm 包下载失败：${describeError(error)}`,
    )
  }

  if (!hash.digest().equals(expectedDigest)) {
    await rm(destination, { force: true })
    throw new RuntimeComponentInstallError('PACKAGE_INTEGRITY_FAILED', 'npm 包 integrity 校验失败')
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function parseSha512Integrity(value: string): Buffer {
  if (!value.startsWith('sha512-')) {
    throw new RuntimeComponentInstallError(
      'PACKAGE_INTEGRITY_FAILED',
      '允许目录缺少 SHA-512 integrity',
    )
  }
  const digest = Buffer.from(value.slice('sha512-'.length), 'base64')
  if (digest.length !== 64) {
    throw new RuntimeComponentInstallError('PACKAGE_INTEGRITY_FAILED', 'SHA-512 integrity 无效')
  }
  return digest
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : String(error)
}
