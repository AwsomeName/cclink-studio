import { describe, expect, it } from 'vitest'
import type { BrowserTaskRun } from '@shared/ipc/browser'
import {
  selectBrowserTabConversationTask,
  selectConversationBrowserTask,
} from './browser-task-binding'

function task(
  id: string,
  input: {
    tabId: string
    conversationId: string
    workspaceKey?: string | null
    status?: BrowserTaskRun['status']
    startedAt?: number
  },
): BrowserTaskRun {
  return {
    id,
    tabId: input.tabId,
    goal: id,
    correlation: {
      workspaceKey: input.workspaceKey ?? '/workspace',
      conversationId: input.conversationId,
      agentRunId: null,
      agentSessionRef: null,
      profileId: null,
      affairId: 'affair-1',
    },
    status: input.status ?? 'running',
    startedAt: input.startedAt ?? 1,
    downloadIds: [],
  }
}

describe('Agent and Browser task projection binding', () => {
  it('shows a publishing BrowserTask by conversation even when Agent scope is not browser', () => {
    const publishing = task('publishing', {
      tabId: 'csdn-tab',
      conversationId: 'article-publishing-affair-1',
    })
    expect(
      selectConversationBrowserTask({
        tasks: [publishing],
        conversationId: 'article-publishing-affair-1',
        workspaceKey: '/workspace',
      }),
    ).toBe(publishing)
  })

  it('restores the owning Agent when its visible Browser Tab becomes active', () => {
    const older = task('older', {
      tabId: 'csdn-tab',
      conversationId: 'article-publishing-old',
      status: 'completed',
      startedAt: 1,
    })
    const current = task('current', {
      tabId: 'csdn-tab',
      conversationId: 'article-publishing-current',
      status: 'paused',
      startedAt: 2,
    })
    expect(
      selectBrowserTabConversationTask({
        tasks: [older, current],
        tabId: 'csdn-tab',
        workspaceKey: '/workspace',
      }),
    ).toBe(current)
  })

  it('never crosses workspace or Browser Tab boundaries', () => {
    expect(
      selectBrowserTabConversationTask({
        tasks: [
          task('other-tab', { tabId: 'other-tab', conversationId: 'conversation-a' }),
          task('other-workspace', {
            tabId: 'csdn-tab',
            conversationId: 'conversation-b',
            workspaceKey: '/other',
          }),
        ],
        tabId: 'csdn-tab',
        workspaceKey: '/workspace',
      }),
    ).toBeNull()
  })

  it('does not let an ordinary Browser task take over the selected Agent', () => {
    const ordinary = task('ordinary', {
      tabId: 'browser-tab',
      conversationId: 'ordinary-conversation',
    })
    delete ordinary.correlation?.affairId
    expect(
      selectBrowserTabConversationTask({
        tasks: [ordinary],
        tabId: 'browser-tab',
        workspaceKey: '/workspace',
      }),
    ).toBeNull()
  })
})
