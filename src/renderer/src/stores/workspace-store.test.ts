import { beforeEach, describe, expect, it } from 'vitest'
import { globalWorkspaceRef, localWorkspaceRef, remoteWorkspaceRef } from '@shared/workspace-ref'
import {
  captureActiveWorkspaceTarget,
  isWorkspaceTargetCurrent,
  useWorkspaceStore,
} from './workspace-store'

describe('workspace command target generation', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activeWorkspaceRef: globalWorkspaceRef(), generation: 0 })
  })

  it('keeps a captured target current until the workspace projection commits again', () => {
    useWorkspaceStore.getState().commitActiveWorkspace(localWorkspaceRef('/workspace/a'))
    const target = captureActiveWorkspaceTarget()

    expect(target).toEqual({ ref: localWorkspaceRef('/workspace/a'), generation: 1 })
    expect(isWorkspaceTargetCurrent(target)).toBe(true)

    useWorkspaceStore.getState().commitActiveWorkspace(localWorkspaceRef('/workspace/b'))
    expect(isWorkspaceTargetCurrent(target)).toBe(false)
  })

  it('invalidates an old target even when the same workspace identity becomes active again', () => {
    const remote = remoteWorkspaceRef({
      endpointId: 'endpoint-1',
      workspaceId: 'workspace-1',
      path: '/workspace',
    })
    useWorkspaceStore.getState().commitActiveWorkspace(remote)
    const firstActivation = captureActiveWorkspaceTarget()

    useWorkspaceStore.getState().commitActiveWorkspace(globalWorkspaceRef())
    useWorkspaceStore.getState().commitActiveWorkspace(remote)

    expect(isWorkspaceTargetCurrent(firstActivation)).toBe(false)
    expect(captureActiveWorkspaceTarget().generation).toBe(3)
  })
})
