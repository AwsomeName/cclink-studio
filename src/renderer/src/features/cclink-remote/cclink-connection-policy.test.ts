import { afterEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef, remoteWorkspaceRef } from '@shared/workspace-ref'
import { useCclinkStore } from '../../stores/cclink-store'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  restoreCclinkConnectionForOpenProjects,
  shouldAutoConnectCclink,
} from './cclink-connection-policy'

const local = localWorkspaceRef('/workspace/local')
const remote = remoteWorkspaceRef({
  endpointId: 'agent-1',
  workspaceId: 'workspace-1',
  path: '/workspace/remote',
})

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useOpenProjectsStore.setState(useOpenProjectsStore.getInitialState(), true)
  useCclinkStore.setState(useCclinkStore.getInitialState(), true)
})

describe('CCLink connection policy', () => {
  it('does not auto-connect for a local workspace with no open remote projects', async () => {
    const connectRealtime = vi.fn().mockResolvedValue(true)
    useWorkspaceStore.setState({ activeWorkspaceRef: local })
    useCclinkStore.setState({ connectRealtime })

    await expect(restoreCclinkConnectionForOpenProjects()).resolves.toBe(false)
    expect(connectRealtime).not.toHaveBeenCalled()
  })

  it('restores the connection when a remote project remains open in the background', async () => {
    const connectRealtime = vi.fn().mockResolvedValue(true)
    useWorkspaceStore.setState({ activeWorkspaceRef: local })
    useOpenProjectsStore.setState({ openRemoteWorkspaceRefs: [remote] })
    useCclinkStore.setState({ connectRealtime })

    await expect(restoreCclinkConnectionForOpenProjects()).resolves.toBe(true)
    expect(connectRealtime).toHaveBeenCalledOnce()
  })

  it('connects for the active remote workspace even before the project strip is restored', () => {
    expect(shouldAutoConnectCclink(remote, [])).toBe(true)
  })
})
