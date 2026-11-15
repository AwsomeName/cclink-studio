import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { remoteWorkspaceRef } from '@shared/workspace-ref'
import { useCommandStore } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createShellContextCommands } from '../context-actions/domains/shell-context-actions'
import { openBoundCompany } from '../workspace-open/fixed-spaces-store'
import { createCompanyWorkspaceCommands, openCompanyWorkspace } from './company-workspace-commands'

vi.mock('../workspace-open/fixed-spaces-store', () => ({
  openBoundCompany: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(openBoundCompany).mockResolvedValue(true)
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
    vi.mocked(openBoundCompany).mockImplementation(async () => {
      expect(useTabStore.getState().tabs).toHaveLength(0)
      const ref = { kind: 'local' as const, path: '/tmp/default-company' }
      useWorkspaceStore.setState({ activeWorkspaceRef: ref })
      return true
    })

    await expect(
      useCommandStore.getState().executeCommand('company.overview', { source: 'toolbar' }),
    ).resolves.toEqual({ ok: true })
    expect(openBoundCompany).toHaveBeenCalledOnce()
    expect(useTabStore.getState().getActiveTab()).toMatchObject({
      type: 'company-workspace',
      workspaceRef: { kind: 'local', path: '/tmp/default-company' },
    })
    expect(useUIStore.getState()).toMatchObject({
      activePanel: 'company-workspace',
      sidebarVisible: true,
    })
  })

  it('resolves the fixed company even from an existing local workspace', async () => {
    await useCommandStore.getState().executeCommand('company.projects', { source: 'toolbar' })
    expect(openBoundCompany).toHaveBeenCalledWith('projects')
    expect(useTabStore.getState().getActiveTab()).toMatchObject({
      workspaceRef: { kind: 'local', path: '/tmp/company-a' },
      companyWorkspace: { section: 'projects' },
    })
  })

  it('reports initialization failure without opening a company or changing the layout', async () => {
    useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'global' } })
    vi.mocked(openBoundCompany).mockRejectedValue(new Error('默认工作空间已丢失'))
    await expect(
      useCommandStore.getState().executeCommand('company.overview', { source: 'toolbar' }),
    ).resolves.toMatchObject({ ok: false, message: '默认工作空间已丢失' })
    expect(useTabStore.getState().tabs).toHaveLength(0)
    expect(useUIStore.getState()).toMatchObject({ activePanel: 'files', sidebarVisible: false })
  })

  it('does not open a company tab when setup or a later transition cancels entry', async () => {
    vi.mocked(openBoundCompany).mockResolvedValue(false)
    await useCommandStore.getState().executeCommand('company.overview', { source: 'toolbar' })
    expect(useTabStore.getState().tabs).toHaveLength(0)
  })
  it('allows leaving remote through the same fixed local entry', async () => {
    useWorkspaceStore.setState({
      activeWorkspaceRef: remoteWorkspaceRef({
        endpointId: 'remote',
        workspaceId: 'workspace',
        path: '/remote',
      }),
    })
    vi.mocked(openBoundCompany).mockImplementation(async () => {
      useWorkspaceStore.setState({
        activeWorkspaceRef: { kind: 'local', path: '/tmp/fixed-company' },
      })
      return true
    })
    await expect(
      useCommandStore.getState().executeCommand('company.overview', { source: 'toolbar' }),
    ).resolves.toEqual({ ok: true })
    expect(useTabStore.getState().getActiveTab()?.workspaceRef).toEqual({
      kind: 'local',
      path: '/tmp/fixed-company',
    })
  })

  it('awaits default workspace errors from the activity context entry', async () => {
    useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'global' } })
    vi.mocked(openBoundCompany).mockRejectedValue(new Error('默认目录不可写'))
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
