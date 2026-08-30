export const REMOTE_MUTATION_TTL_MS = 24 * 60 * 60 * 1_000
export const REMOTE_MUTATION_CLOCK_SKEW_MS = 5 * 60 * 1_000

export const remoteMutationOperationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export interface RemoteMutationIdentity {
  operationId: string
  operationCreatedAt: number
  operationExpiresAt: number
}

export interface RemoteFilePendingMutation extends RemoteMutationIdentity {
  sessionId: string
  expectedSha256: string
}

export function createRemoteMutationIdentity(
  now: number = Date.now(),
  randomBytes?: Uint8Array,
): RemoteMutationIdentity {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new Error('远程文件操作创建时间超出 UUIDv7 可表示范围')
  }
  const bytes = randomBytes ? Uint8Array.from(randomBytes) : randomUuidBytes()
  if (bytes.length !== 16) throw new Error('UUIDv7 随机源必须提供 16 字节')

  let timestamp = now
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256
    timestamp = Math.floor(timestamp / 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  return {
    operationId: formatUuid(bytes),
    operationCreatedAt: now,
    operationExpiresAt: now + REMOTE_MUTATION_TTL_MS,
  }
}

export function remoteMutationIdentityError(
  identity: RemoteMutationIdentity,
  now: number = Date.now(),
): string | null {
  if (!remoteMutationOperationIdPattern.test(identity.operationId)) {
    return 'operationId 必须是规范小写 UUIDv7'
  }
  if (!Number.isSafeInteger(identity.operationCreatedAt) || identity.operationCreatedAt < 0) {
    return 'operationCreatedAt 必须是非负安全整数'
  }
  if (uuidV7Timestamp(identity.operationId) !== identity.operationCreatedAt) {
    return 'operationCreatedAt 必须等于 UUIDv7 内嵌时间戳'
  }
  if (
    !Number.isSafeInteger(identity.operationExpiresAt) ||
    identity.operationExpiresAt !== identity.operationCreatedAt + REMOTE_MUTATION_TTL_MS
  ) {
    return 'operationExpiresAt 必须恰好是创建时间后 24 小时'
  }
  if (Number.isFinite(now) && identity.operationCreatedAt > now + REMOTE_MUTATION_CLOCK_SKEW_MS) {
    return 'operationCreatedAt 超出五分钟时钟偏差范围'
  }
  return null
}

export function uuidV7Timestamp(operationId: string): number | null {
  if (!remoteMutationOperationIdPattern.test(operationId)) return null
  return Number.parseInt(operationId.replaceAll('-', '').slice(0, 12), 16)
}

export function isRemoteMutationIdentityReusable(
  identity: RemoteMutationIdentity,
  now: number = Date.now(),
): boolean {
  return remoteMutationIdentityError(identity, now) === null && now <= identity.operationExpiresAt
}

export function isRemoteFilePendingMutationReusable(
  pending: RemoteFilePendingMutation | null | undefined,
  sessionId: string,
  expectedSha256: string,
  now: number = Date.now(),
): pending is RemoteFilePendingMutation {
  return Boolean(
    pending &&
    pending.sessionId === sessionId &&
    pending.expectedSha256 === expectedSha256 &&
    isRemoteMutationIdentityReusable(pending, now),
  )
}

function randomUuidBytes(): Uint8Array {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
