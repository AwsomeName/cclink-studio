import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore } from '../../stores/agent-store'
import { useTabStore } from '../../stores/tab-store'
import { renameWorkbenchTab } from './TabContextMenu'

beforeEach(() => {
  useTabStore.setState(useTabStore.getInitialState(), true)
  useAgentStore.setState(useAgentStore.getInitialState(), true)
})

describe('renameWorkbenchTab', () => {
  it('renames browser tabs', () => {
    useTabStore.getState().openTab({
      type: 'browser',
      title: '浏览器',
      icon: '🌐',
      forceNew: true,
    })
    const tab = useTabStore.getState().tabs[0]

    expect(renameWorkbenchTab(tab.id, '  知乎工作台  ')).toBe(true)
    expect(useTabStore.getState().tabs[0].title).toBe('知乎工作台')
  })

  it('keeps the current title when the new title is empty or cancelled', () => {
    useTabStore.getState().openTab({
      type: 'settings',
      title: '设置',
      icon: '⚙️',
    })
    const tab = useTabStore.getState().tabs[0]

    expect(renameWorkbenchTab(tab.id, '   ')).toBe(false)
    expect(renameWorkbenchTab(tab.id, null)).toBe(false)
    expect(useTabStore.getState().tabs[0].title).toBe('设置')
  })

  it('keeps conversation tabs and their backing conversations in sync', () => {
    const conversationId = useAgentStore.getState().createConversation({
      surface: 'workbench-tab',
      activate: false,
    })
    useTabStore.getState().openTab({
      type: 'conversation',
      title: '新工作会话',
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: useAgentStore.getState().conversations[conversationId].runtime,
        sessionId: conversationId,
      },
    })
    const tab = useTabStore.getState().tabs[0]

    expect(renameWorkbenchTab(tab.id, '设计复盘')).toBe(true)
    expect(useTabStore.getState().tabs[0].title).toBe('设计复盘')
    expect(useAgentStore.getState().conversations[conversationId].title).toBe('设计复盘')
  })
})
