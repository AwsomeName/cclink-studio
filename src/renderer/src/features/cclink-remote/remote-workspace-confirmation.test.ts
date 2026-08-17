import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  confirmRemoteWorkspaceRef,
  remoteWorkspaceRefFromAgent,
} from './remote-workspace-confirmation'

describe('remote workspace confirmation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds the renderer reference from the opaque Agent workspace identity', () => {
    expect(
      remoteWorkspaceRefFromAgent(
        {
          id: 'ws_agent_canonical',
          path: '/srv/project',
          name: 'project',
          serverId: 'agent-1',
        },
        'Agent 1',
      ),
    ).toEqual({
      kind: 'remote',
      transport: 'cclink',
      endpointId: 'agent-1',
      workspaceId: 'ws_agent_canonical',
      path: '/srv/project',
      label: 'project',
      endpointName: 'Agent 1',
    })
  })

  it('reconfirms a restored reference instead of retaining its historical local hash', async () => {
    const openWorkspace = vi.fn().mockResolvedValue({
      id: 'ws_agent_canonical',
      path: '/srv/project',
      name: 'project',
      serverId: 'agent-1',
    })
    vi.stubGlobal('window', { cclinkStudio: { cclink: { openWorkspace } } })

    await expect(
      confirmRemoteWorkspaceRef(
        {
          kind: 'remote',
          transport: 'cclink',
          endpointId: 'agent-1',
          workspaceId: 'studio-local-hash',
          path: '/srv/project',
          endpointName: 'Agent 1',
        },
        'open-request-1',
      ),
    ).resolves.toMatchObject({ workspaceId: 'ws_agent_canonical' })
    expect(openWorkspace).toHaveBeenCalledWith({
      serverId: 'agent-1',
      path: '/srv/project',
      requestId: 'open-request-1',
    })
  })
})
