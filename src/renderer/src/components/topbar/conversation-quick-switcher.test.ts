import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { QuickThreadSummary } from '../../features/agent-conversations/view-model'
import { useAgentStore } from '../../stores/agent-store'
import { ConversationQuickSwitcher } from './ConversationQuickSwitcher'
import {
  formatQuickSwitcherTitle,
  partitionQuickSwitcherThreads,
  QUICK_SWITCHER_TITLE_LIMIT,
  quickSwitcherVisibleCount,
  selectQuickSwitcherThreads,
} from './conversation-quick-switcher'

function conversation(id: string, createdAt: number, isActive = false): QuickThreadSummary {
  return {
    id,
    title: id,
    statusKind: 'idle',
    statusLabel: '空闲',
    detail: '',
    workspaceLabel: 'workspace',
    messageCount: 0,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    surface: 'assistant-panel',
    workspaceKey: '/workspace',
    isActive,
  }
}

describe('conversation quick switcher', () => {
  it('shows at most ten Unicode characters from a conversation title', () => {
    expect(formatQuickSwitcherTitle('人物调研')).toBe('人物调研')
    expect(formatQuickSwitcherTitle('一二三四五六七八九十')).toBe('一二三四五六七八九十')
    expect(formatQuickSwitcherTitle('一二三四五六七八九十一')).toBe('一二三四五六七八九十…')
    expect(formatQuickSwitcherTitle('😀一二三四五六七八九十')).toBe('😀一二三四五六七八九…')
    expect(QUICK_SWITCHER_TITLE_LIMIT).toBe(10)
  })

  it('keeps the active conversation within the five-item quick list', () => {
    const conversations = Array.from({ length: 7 }, (_, index) =>
      conversation(`thread-${index}`, 100 - index, index === 6),
    )

    expect(selectQuickSwitcherThreads(conversations).map((item) => item.id)).toEqual([
      'thread-0',
      'thread-1',
      'thread-2',
      'thread-3',
      'thread-6',
    ])
  })

  it('pins the active conversation when the panel only fits a subset', () => {
    const conversations = [
      conversation('newest', 3),
      conversation('middle', 2),
      conversation('active', 1, true),
    ]

    expect(partitionQuickSwitcherThreads(conversations, 2)).toEqual({
      visible: [conversations[0], conversations[2]],
      overflow: [conversations[1]],
    })
  })

  it('adapts visible items to the side panel width and collapses outside right mode', () => {
    expect(quickSwitcherVisibleCount('right', 560)).toBe(5)
    expect(quickSwitcherVisibleCount('right', 460)).toBe(4)
    expect(quickSwitcherVisibleCount('right', 360)).toBe(3)
    expect(quickSwitcherVisibleCount('right', 320)).toBe(2)
    expect(quickSwitcherVisibleCount('hidden', 900)).toBe(1)
    expect(quickSwitcherVisibleCount('center', 900)).toBe(1)
  })

  it('keeps the new-conversation button visible when the workspace has no conversations', () => {
    const originalState = useAgentStore.getState()
    useAgentStore.setState({
      conversations: {},
      conversationOrder: [],
      activeConversationId: '',
      pendingConfirmations: [],
    })

    try {
      const markup = renderToStaticMarkup(
        createElement(ConversationQuickSwitcher, { panelMode: 'right', panelWidth: 560 }),
      )
      expect(markup).toContain('class="conversation-quick-new-button"')
      expect(markup).toContain('aria-label="新建会话"')
    } finally {
      useAgentStore.setState(originalState, true)
    }
  })
})
