import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearRemoteFileDraft,
  clearRemoteFileDraftPaths,
  flushRemoteFileDrafts,
  rebaseRemoteFileDraftPaths,
  rememberRemoteFileDraft,
} from './remote-file-draft-registry'
import { createRemoteMutationIdentity } from '@shared/remote-mutation-identity'

const refA = {
  kind: 'remote' as const,
  transport: 'cclink' as const,
  endpointId: 'agent-a',
  workspaceId: 'workspace-a',
  path: '/srv/project',
}
const refB = { ...refA, endpointId: 'agent-b', workspaceId: 'workspace-b' }

afterEach(() => {
  clearRemoteFileDraft('tab-a')
  clearRemoteFileDraft('tab-b')
  vi.unstubAllGlobals()
})

describe('remote file draft registry', () => {
  it('flush 会立即持久化尚在 debounce 窗口内的草稿', async () => {
    const saveDraft = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      cclinkStudio: { remote: { saveDraft, deleteDraft: vi.fn().mockResolvedValue(undefined) } },
    })
    rememberRemoteFileDraft('tab-a', {
      ref: refA,
      path: '/srv/project/a.ts',
      content: 'changed',
      savedContent: 'saved',
      sha256: 'a'.repeat(64),
      pendingMutation: {
        ...createRemoteMutationIdentity(),
        sessionId: 'session-a',
        expectedSha256: 'a'.repeat(64),
      },
    })

    await flushRemoteFileDrafts()

    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: refA,
        path: '/srv/project/a.ts',
        content: 'changed',
        pendingMutation: expect.objectContaining({ sessionId: 'session-a' }),
      }),
    )
  })

  it('目录重命名和删除不会改动另一个 Workspace 的同路径草稿', async () => {
    const saveDraft = vi.fn().mockResolvedValue(undefined)
    const rebaseDraftPrefix = vi.fn().mockResolvedValue(undefined)
    const deleteDraftPrefix = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      cclinkStudio: {
        remote: {
          saveDraft,
          deleteDraft: vi.fn().mockResolvedValue(undefined),
          rebaseDraftPrefix,
          deleteDraftPrefix,
        },
      },
    })
    rememberRemoteFileDraft('tab-a', {
      ref: refA,
      path: '/srv/project/src/a.ts',
      content: 'a',
      savedContent: '',
      sha256: 'a'.repeat(64),
    })
    rememberRemoteFileDraft('tab-b', {
      ref: refB,
      path: '/srv/project/src/b.ts',
      content: 'b',
      savedContent: '',
      sha256: 'b'.repeat(64),
    })

    rebaseRemoteFileDraftPaths(refA, '/srv/project/src', '/srv/project/lib')
    clearRemoteFileDraftPaths(refA, '/srv/project/lib')
    await flushRemoteFileDrafts()

    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ ref: refB, content: 'b' }))
    expect(rebaseDraftPrefix).toHaveBeenCalledWith({
      ref: refA,
      oldPrefix: '/srv/project/src',
      newPrefix: '/srv/project/lib',
    })
    expect(deleteDraftPrefix).toHaveBeenCalledWith({ ref: refA, pathPrefix: '/srv/project/lib' })
  })
})
