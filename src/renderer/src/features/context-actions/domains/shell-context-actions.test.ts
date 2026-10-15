import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../../../stores/ui-store'
import { useTabStore } from '../../../stores/tab-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { localWorkspaceRef } from '@shared/workspace-ref'
import { createShellContextCommands } from './shell-context-actions'

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true)
  useTabStore.setState(useTabStore.getInitialState(), true)
  useWorkspaceStore.getState().commitActiveWorkspace(localWorkspaceRef('/workspace/activity-test'))
})

describe('shell context commands', () => {
  it.each([
    'company-workspace',
    'files',
    'sessions',
    'browser',
    'terminal',
    'agent-roles',
    'operations',
    'data-sources',
    'company-accounts',
    'cclink',
    'article-publishing',
    'affairs',
    'scheduled-tasks',
    'video-creation',
    'production',
  ])('opens the valid %s activity idempotently', async (activityId) => {
    const command = createShellContextCommands().find((item) => item.id === 'activity.open')!
    const context = {
      source: 'context-menu' as const,
      target: { kind: 'activity' as const, activityId },
    }
    await command.action(context)
    await command.action(context)
    expect(useUIStore.getState()).toMatchObject({ activePanel: activityId, sidebarVisible: true })
    if (activityId === 'company-accounts' || activityId === 'company-workspace') {
      expect(useTabStore.getState().getActiveTab()?.type).toBe(activityId)
      expect(useTabStore.getState().tabs.filter((tab) => tab.type === activityId)).toHaveLength(1)
    }
    if (activityId === 'browser') expect(useUIStore.getState().agentPanelMode).toBe('right')
  })

  it('opens settings without adding an activity and rejects unknown and inherited keys', async () => {
    const command = createShellContextCommands().find((item) => item.id === 'activity.open')!
    await command.action({
      source: 'context-menu',
      target: { kind: 'activity', activityId: 'settings' },
    })
    expect(useTabStore.getState().getActiveTab()?.type).toBe('settings')
    expect(useUIStore.getState()).toMatchObject({ activePanel: 'files', sidebarVisible: false })
    for (const activityId of ['unknown', 'toString'])
      expect(() =>
        command.action({ source: 'context-menu', target: { kind: 'activity', activityId } }),
      ).toThrow('活动入口不可用')
  })
  it('opens an activity without toggling an already hidden sidebar back off', async () => {
    useUIStore.setState({ activePanel: 'files', sidebarVisible: false })
    const command = createShellContextCommands().find((item) => item.id === 'activity.open')!

    await command.action({
      source: 'context-menu',
      target: { kind: 'activity', activityId: 'browser' },
    })

    expect(useUIStore.getState()).toMatchObject({
      activePanel: 'browser',
      sidebarVisible: true,
    })
  })

  it.each([
    ['video-creation', 'video-creation'],
    ['production', 'production'],
  ] as const)('opens the separated %s activity', async (activityId, activePanel) => {
    const command = createShellContextCommands().find((item) => item.id === 'activity.open')!

    await command.action({
      source: 'context-menu',
      target: { kind: 'activity', activityId },
    })

    expect(useUIStore.getState()).toMatchObject({ activePanel, sidebarVisible: true })
  })

  it('resets and hides only the layout region named by the target', async () => {
    useUIStore.setState({ sidebarWidth: 420, agentPanelWidth: 520, sidebarVisible: true })
    const commands = createShellContextCommands()
    const reset = commands.find((item) => item.id === 'layout.resetSize')!
    const hide = commands.find((item) => item.id === 'layout.hideRegion')!
    const context = {
      source: 'context-menu' as const,
      target: { kind: 'layout' as const, workspaceKey: null, area: 'sidebar' as const },
    }

    await reset.action(context)
    await hide.action(context)

    expect(useUIStore.getState()).toMatchObject({
      sidebarWidth: 250,
      agentPanelWidth: 520,
      sidebarVisible: false,
    })
  })
})
