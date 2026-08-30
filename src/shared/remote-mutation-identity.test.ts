import { describe, expect, it } from 'vitest'
import {
  createRemoteMutationIdentity,
  isRemoteFilePendingMutationReusable,
  isRemoteMutationIdentityReusable,
  REMOTE_MUTATION_TTL_MS,
  remoteMutationIdentityError,
  uuidV7Timestamp,
} from './remote-mutation-identity'

const now = 1_774_347_609_972

describe('remote mutation identity', () => {
  it('生成与 Agent 契约一致的规范 UUIDv7 和 24 小时生命周期', () => {
    const identity = createRemoteMutationIdentity(now, new Uint8Array(16).fill(0xff))

    expect(identity).toEqual({
      operationId: '019d1f5b-e774-7fff-bfff-ffffffffffff',
      operationCreatedAt: now,
      operationExpiresAt: now + REMOTE_MUTATION_TTL_MS,
    })
    expect(uuidV7Timestamp(identity.operationId)).toBe(now)
    expect(remoteMutationIdentityError(identity, now)).toBeNull()
    expect(isRemoteMutationIdentityReusable(identity, now)).toBe(true)
    expect(isRemoteMutationIdentityReusable(identity, identity.operationExpiresAt + 1)).toBe(false)
  })

  it.each([
    [
      'UUIDv4',
      {
        operationId: '11111111-1111-4111-8111-111111111111',
        operationCreatedAt: now,
        operationExpiresAt: now + REMOTE_MUTATION_TTL_MS,
      },
    ],
    [
      '不匹配的创建时间',
      {
        operationId: '019d1f5b-e774-7fe2-8588-54f70ea92ff0',
        operationCreatedAt: now + 1,
        operationExpiresAt: now + 1 + REMOTE_MUTATION_TTL_MS,
      },
    ],
    [
      '五分钟生命周期',
      {
        operationId: '019d1f5b-e774-7fe2-8588-54f70ea92ff0',
        operationCreatedAt: now,
        operationExpiresAt: now + 5 * 60_000,
      },
    ],
  ])('拒绝%s', (_label, identity) => {
    expect(remoteMutationIdentityError(identity, now)).not.toBeNull()
  })

  it('只对同一 Session、文件版本和未过期操作复用身份', () => {
    const pending = {
      ...createRemoteMutationIdentity(now, new Uint8Array(16).fill(0xaa)),
      sessionId: 'session-1',
      expectedSha256: 'a'.repeat(64),
    }

    expect(isRemoteFilePendingMutationReusable(pending, 'session-1', 'a'.repeat(64), now)).toBe(
      true,
    )
    expect(isRemoteFilePendingMutationReusable(pending, 'session-2', 'a'.repeat(64), now)).toBe(
      false,
    )
    expect(isRemoteFilePendingMutationReusable(pending, 'session-1', 'b'.repeat(64), now)).toBe(
      false,
    )
    expect(
      isRemoteFilePendingMutationReusable(
        pending,
        'session-1',
        'a'.repeat(64),
        pending.operationExpiresAt + 1,
      ),
    ).toBe(false)
  })
})
