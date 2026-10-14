import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createShellContextCommands } from '../context-actions/domains/shell-context-actions'
import { openCompanyWorkspace } from './company-workspace-commands'

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null })
  useUIStore.setState({ activePanel: 'files', sidebarVisible: false })
  useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'local', path: '/tmp/company-a' } })
})

afterEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null })
  useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'global' } })
})

describe('company workspace navigation', () => {
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
