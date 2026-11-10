import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCclinkStore } from '../../stores/cclink-store'
import { remoteAgentComposerKey } from './remote-message-queue-state'

const ref = {
  kind: 'remote' as const,
  transport: 'cclink' as const,
  endpointId: 'agent',
  workspaceId: 'workspace',
  path: '/project',
}
const session = {
  id: 'session',
  name: 'test',
  workspaceId: ref.workspaceId,
  workspacePath: ref.path,
  serverId: ref.endpointId,
  status: 'active' as const,
  createdAt: 1,
  updatedAt: 1,
  messageCount: 1,
  contextUsage: 0,
}
const key = remoteAgentComposerKey(ref, session.id)
const store = () => useCclinkStore.getState()
const api = { stopAgentRun: vi.fn(), deleteSession: vi.fn() }
beforeEach(() => {
  useCclinkStore.setState(useCclinkStore.getInitialState(), true)
  useCclinkStore.setState({
    sessions: [session],
    selectedSessionId: session.id,
    messages: { session: [{ type: 'user', id: 'message', content: '历史', timestamp: 1 }] },
    remoteAgentDrafts: { [key]: '草稿' },
  })
  vi.stubGlobal('window', { cclinkStudio: { cclink: api } })
  vi.resetAllMocks()
})
afterEach(() => vi.unstubAllGlobals())

describe('remote session control projection', () => {
  it('pauses queued follow-ups before cancellation and does not turn acceptance into idle', async () => {
    useCclinkStore.setState({
      remoteMessageQueues: {
        [key]: {
          ref,
          sessionId: session.id,
          items: [{ id: 'queued', content: '继续', pendingImages: [] }],
          pauseReason: null,
          dispatchId: null,
          awaitingCompletion: true,
        },
      },
    })
    api.stopAgentRun.mockImplementation(async () => {
      expect(store().remoteMessageQueues[key].pauseReason).toBeTruthy()
      return { success: true }
    })
    expect(await store().stopAgentRun(ref, session.id)).toBe(true)
    expect(store().sessions[0].status).toBe('active')
    expect(store().remoteMessageQueues[key].items).toHaveLength(1)
  })
  it('keeps history, selection and draft when deletion fails', async () => {
    api.deleteSession.mockResolvedValue({ success: false, error: 'offline' })
    expect(await store().deleteSession(ref, session.id)).toBe(false)
    expect(store().sessions).toEqual([session])
    expect(store().selectedSessionId).toBe(session.id)
    expect(store().messages.session).toHaveLength(1)
    expect(store().remoteAgentDrafts[key]).toBe('草稿')
  })
  it('clears only the deleted session after confirmation from main', async () => {
    useCclinkStore.setState({
      sessions: [session, { ...session, id: 'other', status: 'idle' }],
      remoteAgentDrafts: { [key]: '草稿', other: '保留' },
    })
    api.deleteSession.mockResolvedValue({ success: true })
    expect(await store().deleteSession(ref, session.id)).toBe(true)
    expect(store().sessions.map((s) => s.id)).toEqual(['other'])
    expect(store().selectedSessionId).toBe('other')
    expect(store().messages.session).toBeUndefined()
    expect(store().remoteAgentDrafts).toEqual({ other: '保留' })
  })
})
