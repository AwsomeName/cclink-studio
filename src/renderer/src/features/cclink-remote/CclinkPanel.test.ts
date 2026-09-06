import { describe, expect, it } from 'vitest'
import { resolveRemoteDirectoryInitialPath } from './CclinkPanel'

describe('CCLink remote directory picker', () => {
  it('starts from the Agent home directory when a fresh Agent has no known workspaces', () => {
    expect(resolveRemoteDirectoryInitialPath({ workspaces: [] })).toBe('~')
  })

  it('prefers the first existing Agent-confirmed workspace', () => {
    expect(
      resolveRemoteDirectoryInitialPath({
        workspaces: [
          {
            id: 'missing',
            path: '/missing',
            name: 'missing',
            serverId: 'agent-1',
            exists: false,
          },
          {
            id: 'workspace-1',
            path: '/Users/alice/project',
            name: 'project',
            serverId: 'agent-1',
            exists: true,
          },
        ],
      }),
    ).toBe('/Users/alice/project')
  })
})
