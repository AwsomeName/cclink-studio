import { describe, expect, it } from 'vitest'
import {
  parseAgentCompleteEvent,
  parseAgentConfirmationRequest,
  parseAgentErrorEvent,
  parseAgentRunStatusEvent,
  parseAgentStreamEvent,
} from './agent'
import { parseAuthSessionEvent } from './auth'
import {
  parseBrowserActionLogChangedPayload,
  parseBrowserContextAgentRequest,
  parseBrowserDownloadChangedPayload,
  parseBrowserFindResultPayload,
  parseBrowserFindShortcutTriggeredPayload,
  parseBrowserNativeContextMenuOpenedPayload,
  parseBrowserOpenTabRequest,
  parseBrowserPageMetaChangedPayload,
  parseBrowserPopupCreatedPayload,
  parseBrowserRuntimeTabClosedPayload,
  parseBrowserTaskChangedPayload,
  parseBrowserUrlChangedPayload,
  parseBrowserViewStateChangedPayload,
} from './browser'
import { isBoundedIpcEventPayload } from './event-payload'

describe('preload event payload parsers', () => {
  it('bounds nested event structures without copying payloads', () => {
    const payload = { nested: { value: 'ok' } }
    expect(isBoundedIpcEventPayload(payload)).toBe(true)
    expect(isBoundedIpcEventPayload({ value: 'x'.repeat(101) }, { maxStringLength: 100 })).toBe(
      false,
    )
    expect(isBoundedIpcEventPayload({ value: Number.POSITIVE_INFINITY })).toBe(false)
  })

  it('accepts valid Auth sessions and rejects malformed or oversized users', () => {
    const session = {
      loggedIn: true,
      user: {
        id: 'user-1',
        nickname: 'User',
        avatarUrl: '',
        phone: null,
        loginMethod: 'phone' as const,
        lastLoginAt: 1,
      },
    }
    expect(parseAuthSessionEvent(session)).toBe(session)
    expect(parseAuthSessionEvent({ loggedIn: true, user: { id: 'user-1' } })).toBeNull()
    expect(
      parseAuthSessionEvent({ ...session, user: { ...session.user, nickname: 'x'.repeat(513) } }),
    ).toBeNull()
  })

  it('checks the core discriminants and bounds for every Agent event', () => {
    const stream = { type: 'assistant', conversationId: 'conversation-1' }
    const complete = {
      subtype: 'success',
      is_error: false,
      duration_ms: 1,
      session_id: 'session-1',
      total_cost_usd: 0,
    }
    const error = { message: 'failed', operation: 'message' as const }
    const run = {
      conversationId: 'conversation-1',
      runId: 'run-1',
      status: 'running' as const,
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 1,
      completedAt: null,
    }
    const confirmation = {
      id: 'confirmation-1',
      toolName: 'terminal.execute',
      params: { command: 'pwd' },
      riskLevel: 'write' as const,
    }
    expect(parseAgentStreamEvent(stream)).toBe(stream)
    expect(parseAgentCompleteEvent(complete)).toBe(complete)
    expect(parseAgentErrorEvent(error)).toBe(error)
    expect(parseAgentRunStatusEvent(run)).toBe(run)
    expect(parseAgentConfirmationRequest(confirmation)).toBe(confirmation)
    expect(parseAgentStreamEvent({ type: 'x', nested: 'x'.repeat(1_000_001) })).toBeNull()
    expect(parseAgentCompleteEvent({ subtype: 'success' })).toBeNull()
    expect(parseAgentErrorEvent({ message: 42 })).toBeNull()
    expect(parseAgentRunStatusEvent({ ...run, status: 'unknown' })).toBeNull()
    expect(parseAgentConfirmationRequest({ ...confirmation, params: null })).toBeNull()
  })

  it('checks all Browser events exposed by the main and auxiliary preload bridges', () => {
    const runtimeIdentity = {
      tabId: 'tab-1',
      workspaceKey: null,
      runtimeGeneration: 1,
    }
    const validPayloads = [
      [
        parseBrowserFindShortcutTriggeredPayload,
        { ...runtimeIdentity, commandId: 'workbench.find', configVersion: 1, triggerSequence: 1 },
      ],
      [
        parseBrowserFindResultPayload,
        {
          ...runtimeIdentity,
          requestToken: 'request-1',
          matches: 2,
          activeMatchOrdinal: 1,
          finalUpdate: true,
        },
      ],
      [parseBrowserUrlChangedPayload, { tabId: 'tab-1', url: 'https://example.com' }],
      [parseBrowserPageMetaChangedPayload, { tabId: 'tab-1', title: 'Example' }],
      [parseBrowserOpenTabRequest, { workspaceKey: null, initialUrl: 'about:blank' }],
      [
        parseBrowserPopupCreatedPayload,
        {
          tabId: 'popup-1',
          sourceTabId: 'tab-1',
          url: 'https://example.com',
          workspaceKey: null,
          profileId: null,
          disposition: 'foreground-tab',
          activate: true,
        },
      ],
      [parseBrowserRuntimeTabClosedPayload, { tabId: 'tab-1', workspaceKey: null }],
      [
        parseBrowserNativeContextMenuOpenedPayload,
        { workspaceKey: null, tabId: 'tab-1', profileId: null },
      ],
      [
        parseBrowserContextAgentRequest,
        {
          workspaceKey: null,
          tabId: 'tab-1',
          profileId: null,
          source: 'page',
          pageUrl: 'https://example.com',
        },
      ],
      [
        parseBrowserTaskChangedPayload,
        {
          task: {
            id: 'task-1',
            tabId: 'tab-1',
            goal: 'Inspect page',
            status: 'running',
            startedAt: 1,
            downloadIds: [],
          },
        },
      ],
      [
        parseBrowserActionLogChangedPayload,
        {
          log: {
            id: 'log-1',
            taskRunId: 'task-1',
            tabId: 'tab-1',
            action: 'click',
            paramsSummary: '',
            status: 'started',
            startedAt: 1,
          },
        },
      ],
      [
        parseBrowserDownloadChangedPayload,
        {
          download: {
            id: 'download-1',
            trigger: 'user',
            retention: 'temporary',
            tabId: 'tab-1',
            workspaceKey: null,
            sourceUrl: 'https://example.com/file',
            suggestedFilename: 'file.txt',
            status: 'pending',
            createdAt: 1,
          },
        },
      ],
      [
        parseBrowserViewStateChangedPayload,
        {
          tabId: 'tab-1',
          viewMode: 'desktop',
          zoomMode: 'fit',
          zoomFactor: 1,
        },
      ],
    ] as const

    for (const [parser, payload] of validPayloads) {
      expect(parser(payload)).toBe(payload)
      expect(parser({})).toBeNull()
    }
    expect(
      parseBrowserUrlChangedPayload({
        tabId: 'tab-1',
        url: 'https://example.com',
        extra: 'x'.repeat(1_000_001),
      }),
    ).toBeNull()
  })
})
