import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getWorkspaceStateKey,
  getWorkspaceStateOwnerKey,
  getWorkspaceStatePath,
  persistWorkspaceSection,
  setWorkspaceStateOwnerKey,
  setWorkspaceStatePath,
  setWorkspaceStateRef,
} from './workspace-state'
import { remoteWorkspaceRef } from '../../../shared/workspace-ref'

afterEach(() => {
  vi.unstubAllGlobals()
  setWorkspaceStatePath(null)
  setWorkspaceStateOwnerKey(null)
})

describe('workspace-state utils', () => {
  it('默认使用当前工作区路径持久化 section', () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { deepink: { workspaceState: { setSection } } })

    setWorkspaceStatePath('/workspace/a')
    persistWorkspaceSection('layout', { sidebarVisible: false })

    expect(getWorkspaceStatePath()).toBe('/workspace/a')
    expect(getWorkspaceStateKey()).toBe('/workspace/a')
    expect(setSection).toHaveBeenCalledWith('/workspace/a', 'layout', { sidebarVisible: false }, null)
  })

  it('显式传入 workspacePath 时覆盖默认路径', () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { deepink: { workspaceState: { setSection } } })

    setWorkspaceStatePath('/workspace/a')
    persistWorkspaceSection('fileTree', { selectedPath: '/workspace/b/file.md' }, '/workspace/b')

    expect(setSection).toHaveBeenCalledWith('/workspace/b', 'fileTree', {
      selectedPath: '/workspace/b/file.md',
    }, null)
  })

  it('默认携带当前本机身份 ownerKey', () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { deepink: { workspaceState: { setSection } } })

    setWorkspaceStateOwnerKey('local:abc')
    persistWorkspaceSection('layout', { agentPanelMode: 'right' })

    expect(getWorkspaceStateOwnerKey()).toBe('local:abc')
    expect(setSection).toHaveBeenCalledWith(
      null,
      'layout',
      { agentPanelMode: 'right' },
      'local:abc',
    )
  })

  it('支持通过 WorkspaceRef 设置远程工作空间状态 key', () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { deepink: { workspaceState: { setSection } } })

    setWorkspaceStateRef(
      remoteWorkspaceRef({
        endpointId: 'mac-mini',
        workspaceId: '/Users/app/project',
        path: '/Users/app/project',
        label: 'project',
        endpointName: 'Mac mini',
      }),
    )
    persistWorkspaceSection('tabs', { tabs: [] })

    expect(getWorkspaceStateKey()).toBe('cclink://mac-mini/%2FUsers%2Fapp%2Fproject')
    expect(setSection).toHaveBeenCalledWith('cclink://mac-mini/%2FUsers%2Fapp%2Fproject', 'tabs', {
      tabs: [],
    }, null)
  })

  it('支持直连 Remote 工作空间状态 key', () => {
    setWorkspaceStateRef({
      kind: 'remote',
      transport: 'direct',
      endpointId: 'server-1',
      workspaceId: 'project-a',
      path: '/data/project-a',
      label: 'project-a',
      endpointName: 'server-1',
    })

    expect(getWorkspaceStateKey()).toBe('direct://server-1/project-a')
  })
})
