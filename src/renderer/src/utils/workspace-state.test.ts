import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getWorkspaceStateKey,
  getWorkspaceStateOwnerKey,
  getWorkspaceStatePath,
  beginWorkspaceStateRestore,
  endWorkspaceStateRestore,
  isWorkspaceStateRestoring,
  persistWorkspaceSection,
  persistWorkspaceSectionNow,
  setWorkspaceStateOwnerKey,
  setWorkspaceStatePath,
  setWorkspaceStateRef,
} from './workspace-state'

afterEach(() => {
  vi.unstubAllGlobals()
  setWorkspaceStatePath(null)
  setWorkspaceStateOwnerKey(null)
  while (isWorkspaceStateRestoring()) endWorkspaceStateRestore()
})

describe('workspace-state utils', () => {
  it('默认使用当前工作区路径持久化 section', () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

    setWorkspaceStatePath('/workspace/a')
    persistWorkspaceSection('layout', { sidebarVisible: false })

    expect(getWorkspaceStatePath()).toBe('/workspace/a')
    expect(getWorkspaceStateKey()).toBe('/workspace/a')
    expect(setSection).toHaveBeenCalledWith(
      '/workspace/a',
      'layout',
      { sidebarVisible: false },
      null,
    )
  })

  it('显式传入 workspacePath 时覆盖默认路径', () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

    setWorkspaceStatePath('/workspace/a')
    persistWorkspaceSection('fileTree', { selectedPath: '/workspace/b/file.md' }, '/workspace/b')

    expect(setSection).toHaveBeenCalledWith(
      '/workspace/b',
      'fileTree',
      {
        selectedPath: '/workspace/b/file.md',
      },
      null,
    )
  })

  it('默认携带当前本机身份 ownerKey', () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

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

  it('支持通过 WorkspaceRef 设置本地工作空间状态 key', () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

    setWorkspaceStateRef({ kind: 'local', path: '/Users/app/project' })
    persistWorkspaceSection('tabs', { tabs: [] })

    expect(getWorkspaceStateKey()).toBe('/Users/app/project')
    expect(setSection).toHaveBeenCalledWith(
      '/Users/app/project',
      'tabs',
      {
        tabs: [],
      },
      null,
    )
  })

  it('恢复事务期间跳过 section 持久化', () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

    beginWorkspaceStateRestore()
    persistWorkspaceSection('tabs', { tabs: [] })
    endWorkspaceStateRestore()

    expect(setSection).not.toHaveBeenCalled()
  })

  it('同一项目的同一 section 严格按调用顺序提交', async () => {
    const completions: Array<(value: { success: boolean }) => void> = []
    const setSection = vi.fn(
      (
        _workspaceKey: string | null | undefined,
        _section: string,
        _value: unknown,
        _ownerKey?: string | null,
      ) =>
        new Promise<{ success: boolean }>((resolve) => {
          completions.push(resolve)
        }),
    )
    vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

    const first = persistWorkspaceSectionNow('agentConversations', { revision: 1 }, '/workspace/a')
    const second = persistWorkspaceSectionNow('agentConversations', { revision: 2 }, '/workspace/a')

    await vi.waitFor(() => expect(setSection).toHaveBeenCalledTimes(1))
    expect(setSection.mock.calls[0]?.[2]).toEqual({ revision: 1 })

    completions[0]({ success: true })
    await first
    await vi.waitFor(() => expect(setSection).toHaveBeenCalledTimes(2))
    expect(setSection.mock.calls[1]?.[2]).toEqual({ revision: 2 })
    completions[1]({ success: true })
    await second
  })

  it('写入前按 JSON 语义移除运行态对象里的 undefined 可选字段', async () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

    await persistWorkspaceSectionNow(
      'tabs',
      {
        tabs: [{ id: 'browser-a', title: 'A', optional: undefined }],
        activeTabId: 'browser-a',
      },
      '/workspace/a',
    )

    expect(setSection).toHaveBeenCalledWith(
      '/workspace/a',
      'tabs',
      {
        tabs: [{ id: 'browser-a', title: 'A' }],
        activeTabId: 'browser-a',
      },
      null,
    )
  })

  it('拒绝无法表示为 JSON 的顶层工作空间状态', async () => {
    const setSection = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

    await expect(persistWorkspaceSectionNow('tabs', undefined, '/workspace/a')).rejects.toThrow(
      '可序列化 JSON',
    )
    expect(setSection).not.toHaveBeenCalled()
  })
})
