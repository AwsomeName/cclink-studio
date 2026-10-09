import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../../../stores/ui-store'
import { createShellContextCommands } from './shell-context-actions'

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true)
})

describe('shell context commands', () => {
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
