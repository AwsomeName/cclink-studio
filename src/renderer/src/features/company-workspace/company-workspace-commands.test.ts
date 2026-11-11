import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { remoteWorkspaceRef } from '@shared/workspace-ref'
import { useCommandStore } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createShellContextCommands } from '../context-actions/domains/shell-context-actions'
import { openDefaultWorkspace } from '../workspace-open/workspace-open-controller'
import { createCompanyWorkspaceCommands, openCompanyWorkspace } from './company-workspace-commands'

vi.mock('../workspace-open/workspace-open-controller', () => ({
  openDefaultWorkspace: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  useCommandStore.setState({ commands: createCompanyWorkspaceCommands() })
  useTabStore.setState({ tabs: [], activeTabId: null })
  useUIStore.setState({ activePanel: 'files', sidebarVisible: false })
  useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'local', path: '/tmp/company-a' } })
})

afterEach(() => {
  useCommandStore.setState({ commands: [] })
  useTabStore.setState({ tabs: [], activeTabId: null })
  useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'global' } })
})

describe('company workspace navigation', () => {
  it('opens the default workspace from unfiled before opening the company page', async () => {
    useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'global' } })
    vi.mocked(openDefaultWorkspace).mockImplementation(async () => {
      expect(useTabStore.getState().tabs).toHaveLength(0)
      const ref = { kind: 'local' as const, path: '/tmp/default-company' }
      useWorkspaceStore.setState({ activeWorkspaceRef: ref })
      return ref
    })

    await expect(
      useCommandStore.getState().executeCommand('company.overview', { source: 'toolbar' }),
    ).resolves.toEqual({ ok: true })
    expect(openDefaultWorkspace).toHaveBeenCalledOnce()
    expect(useTabStore.getState().getActiveTab()).toMatchObject({
      type: 'company-workspace',
      workspaceRef: { kind: 'local', path: '/tmp/default-company' },
    })
    expect(useUIStore.getState()).toMatchObject({
      activePanel: 'company-workspace',
      sidebarVisible: true,
    })
  })

  it('keeps the current local company instead of switching to the default', async () => {
    await useCommandStore.getState().executeCommand('company.projects', { source: 'toolbar' })
    expect(openDefaultWorkspace).not.toHaveBeenCalled()
    expect(useTabStore.getState().getActiveTab()).toMatchObject({
      workspaceRef: { kind: 'local', path: '/tmp/company-a' },
      companyWorkspace: { section: 'projects' },
    })
  })

  it('reports initialization failure without opening a company or changing the layout', async () => {
    useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'global' } })
    vi.mocked(openDefaultWorkspace).mockRejectedValue(new Error('默认工作空间已丢失'))
    await expect(
      useCommandStore.getState().executeCommand('company.overview', { source: 'toolbar' }),
    ).resolves.toMatchObject({ ok: false, message: '默认工作空间已丢失' })
    expect(useTabStore.getState().tabs).toHaveLength(0)
    expect(useUIStore.getState()).toMatchObject({ activePanel: 'files', sidebarVisible: false })
  })

  it.each([null, { kind: 'local' as const, path: '/tmp/default-company' }])(
    'does not open a company in another workspace when the pending entry loses its target (%j)',
    async (result) => {
      useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'global' } })
      vi.mocked(openDefaultWorkspace).mockImplementation(async () => {
        useWorkspaceStore.setState({
          activeWorkspaceRef: { kind: 'local', path: '/tmp/other-company' },
        })
        return result
      })
      await expect(
        useCommandStore.getState().executeCommand('company.overview', { source: 'toolbar' }),
      ).resolves.toMatchObject({ ok: false, message: '工作空间已发生变化，请重新打开公司经营' })
      expect(useTabStore.getState().tabs).toHaveLength(0)
    },
  )

  it('keeps the remote boundary without switching to a local default', async () => {
    useWorkspaceStore.setState({
      activeWorkspaceRef: remoteWorkspaceRef({
        endpointId: 'remote',
        workspaceId: 'workspace',
        path: '/remote',
      }),
    })
    await expect(
      useCommandStore.getState().executeCommand('company.overview', { source: 'toolbar' }),
    ).resolves.toMatchObject({ ok: false, reason: 'disabled' })
    expect(openDefaultWorkspace).not.toHaveBeenCalled()
  })

  it('awaits default workspace errors from the activity context entry', async () => {
    useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'global' } })
    vi.mocked(openDefaultWorkspace).mockRejectedValue(new Error('默认目录不可写'))
    const command = createShellContextCommands().find((item) => item.id === 'activity.open')!
    await expect(
      command.action({
        source: 'context-menu',
        target: { kind: 'activity', activityId: 'company-workspace' },
      }),
    ).rejects.toThrow('默认目录不可写')
    expect(useTabStore.getState().tabs).toHaveLength(0)
  })

  it('keeps the sidebar visible across routes and preserves the selected month', () => {
    openCompanyWorkspace('overview', undefined, '2026-09')
    const tabId = useTabStore.getState().activeTabId
    openCompanyWorkspace('projects', 'business-1')
    openCompanyWorkspace('knowledge')

    expect(useUIStore.getState()).toMatchObject({
      activePanel: 'company-workspace',
      sidebarVisible: true,
    })
    expect(useTabStore.getState().tabs).toHaveLength(1)
    expect(useTabStore.getState().getActiveTab()).toMatchObject({
      id: tabId,
      companyWorkspace: { section: 'knowledge', month: '2026-09' },
    })
    openCompanyWorkspace('finance')
    expect(useTabStore.getState().getActiveTab()).toMatchObject({
      type: 'company-accounts',
      companyAccounts: { month: '2026-09', projectId: null },
    })
  })

  it('uses the same company entry from the existing activity context command', async () => {
    const command = createShellContextCommands().find((item) => item.id === 'activity.open')!
    await command.action({
      source: 'context-menu',
      target: { kind: 'activity', activityId: 'company-workspace' },
    })
    expect(useTabStore.getState().getActiveTab()).toMatchObject({
      type: 'company-workspace',
      workspaceRef: { kind: 'local', path: '/tmp/company-a' },
    })
    expect(useUIStore.getState().sidebarVisible).toBe(true)
  })

  it('rejects non-local roots before changing the current layout', () => {
    useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'global' } })
    expect(() => openCompanyWorkspace()).toThrow('请先打开本地工作空间')
    expect(useTabStore.getState().tabs).toHaveLength(0)
    expect(useUIStore.getState()).toMatchObject({ activePanel: 'files', sidebarVisible: false })
  })
})
