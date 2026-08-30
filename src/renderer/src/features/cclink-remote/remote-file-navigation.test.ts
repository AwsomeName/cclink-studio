import { beforeEach, describe, expect, it } from 'vitest'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import {
  openRemoteFileFromConversation,
  resolveRemoteWorkspaceFilePath,
} from './remote-file-navigation'

const workspaceRef: RemoteWorkspaceRef = {
  kind: 'remote',
  transport: 'cclink',
  endpointId: 'agent-1',
  workspaceId: 'workspace-1',
  path: '/home/lc/argus',
}

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null })
})

describe('remote file navigation', () => {
  it('resolves a relative conversation path inside the remote workspace', () => {
    expect(resolveRemoteWorkspaceFilePath(workspaceRef, 'docs/design/需求描述.md')).toBe(
      '/home/lc/argus/docs/design/需求描述.md',
    )
  })

  it('rejects paths that escape the remote workspace', () => {
    expect(resolveRemoteWorkspaceFilePath(workspaceRef, '../secrets.md')).toBeNull()
    expect(resolveRemoteWorkspaceFilePath(workspaceRef, '/etc/passwd')).toBeNull()
    expect(resolveRemoteWorkspaceFilePath(workspaceRef, 'https://example.com/readme.md')).toBeNull()
  })

  it('supports a remote workspace rooted at the filesystem root', () => {
    expect(resolveRemoteWorkspaceFilePath({ ...workspaceRef, path: '/' }, 'docs/readme.md')).toBe(
      '/docs/readme.md',
    )
  })

  it('normalizes Windows paths and keeps them scoped to the workspace', () => {
    const windowsRef = { ...workspaceRef, path: 'C:\\project' }
    expect(resolveRemoteWorkspaceFilePath(windowsRef, 'docs/readme.md')).toBe(
      'C:\\project\\docs\\readme.md',
    )
    expect(resolveRemoteWorkspaceFilePath(windowsRef, 'C:\\other\\readme.md')).toBeNull()
  })

  it('opens a remote-file tab with the current remote workspace identity', () => {
    expect(openRemoteFileFromConversation(workspaceRef, 'docs/readme.md')).toBe(true)

    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({
        type: 'remote-file',
        title: 'readme.md',
        filePath: '/home/lc/argus/docs/readme.md',
        workspaceRef,
        remoteFile: {
          serverId: 'agent-1',
          workspaceId: 'workspace-1',
          workspacePath: '/home/lc/argus',
          path: '/home/lc/argus/docs/readme.md',
        },
      }),
    ])
  })
})
