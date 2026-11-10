import { describe, expect, it, vi } from 'vitest'
import { CclinkRemoteService } from './cclink-remote-service'
import {
  createCclinkEnvelope,
  type CclinkProtocolMessage,
  type CclinkRemoteSession,
} from '../../shared/cclink'

const ref = {
  kind: 'remote' as const,
  transport: 'cclink' as const,
  endpointId: 'agent',
  workspaceId: 'workspace',
  path: '/project',
}
const session: CclinkRemoteSession = {
  id: 'session',
  serverId: 'agent',
  workspaceId: 'workspace',
  workspacePath: '/project',
  name: '会话',
  status: 'idle',
  createdAt: 1,
  updatedAt: 1,
  messageCount: 1,
  contextUsage: 0,
}
const remote = {
  session_id: 'session',
  workspace_id: 'workspace',
  workspace_path: '/project',
  active_turn: null,
}
async function fixture() {
  const save = vi.fn(async () => {})
  const service = new CclinkRemoteService({} as never, null, {
    load: async () => ({
      version: 1,
      sessions: [session],
      messages: { session: [{ type: 'user', id: 'message', content: '保留历史', timestamp: 1 }] },
    }),
    save,
  } as never)
  await service.initialize()
  const state = service as unknown as {
    activeAgentRequests: Map<string, string>
    sessions: Map<string, CclinkRemoteSession>
    requireOnline(): Promise<void>
    handleProtocolMessage(serverId: string, message: CclinkProtocolMessage): Promise<void>
  }
  vi.spyOn(state, 'requireOnline').mockResolvedValue()
  const request = vi.spyOn(service.getRequestRouter(), 'request')
  const send = vi.spyOn(service.getRequestRouter(), 'send').mockResolvedValue()
  const sync = (sessions: unknown[]) =>
    ({ ...createCclinkEnvelope('session_sync_response'), sessions }) as CclinkProtocolMessage
  return { service, state, request, send, save, sync }
}

describe('remote session controls', () => {
  it('targets the restored remote turn and keeps it active after acceptance until a terminal event', async () => {
    const { service, state, request, sync } = await fixture()
    request
      .mockResolvedValueOnce(
        sync([{ ...remote, active_turn: { request_id: 'turn', status: 'running' } }]),
      )
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('cancel_generation_ack'),
        session_id: 'session',
        target_request_id: 'turn',
        status: 'accepted',
      })
    expect(await service.stopAgentRun(ref, 'session')).toEqual({ success: true })
    expect(request).toHaveBeenLastCalledWith(
      'agent',
      expect.objectContaining({
        cc_type: 'cancel_generation',
        session_id: 'session',
        target_request_id: 'turn',
      }),
      ['cancel_generation_ack'],
    )
    expect(state.sessions.get('session')?.status).toBe('active')
    await state.handleProtocolMessage('agent', {
      ...createCclinkEnvelope('agent_status', { request_id: 'turn' }),
      session_id: 'session',
      status: 'stopped',
    })
    expect(state.sessions.get('session')?.status).toBe('idle')
  })

  it('retains activity and history on a mismatched acknowledgement or timeout', async () => {
    const { service, state, request } = await fixture()
    state.activeAgentRequests.set('session', 'turn')
    state.sessions.set('session', { ...session, status: 'active' })
    request.mockResolvedValueOnce({
      ...createCclinkEnvelope('cancel_generation_ack'),
      session_id: 'other',
      target_request_id: 'turn',
      status: 'accepted',
    })
    expect((await service.stopAgentRun(ref, 'session')).success).toBe(false)
    request.mockRejectedValueOnce(new Error('响应超时'))
    expect(await service.stopAgentRun(ref, 'session')).toEqual({
      success: false,
      error: '响应超时',
    })
    expect(state.sessions.get('session')?.status).toBe('active')
    expect(service.listMessages('session')).toHaveLength(1)
  })

  it('does not overwrite a newer turn with an older sync snapshot', async () => {
    const { service, state, request, sync } = await fixture()
    let resolve!: (value: CclinkProtocolMessage) => void
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const syncing = (
      service as unknown as { syncSessions(serverId: string): Promise<unknown> }
    ).syncSessions('agent')
    state.activeAgentRequests.set('session', 'new-turn')
    state.sessions.set('session', { ...session, status: 'active' })
    resolve(sync([remote]))
    await syncing
    expect(state.activeAgentRequests.get('session')).toBe('new-turn')
    expect(state.sessions.get('session')?.status).toBe('active')
  })

  it('does not treat a rejected cancellation as a terminal event', async () => {
    const { service, state } = await fixture()
    state.sessions.set('session', { ...session, status: 'active' })
    await state.handleProtocolMessage('agent', {
      ...createCclinkEnvelope('error'),
      session_id: 'session',
      type: 'cancel_generation_failed',
      code: 'CONTROL_NOT_PENDING',
      message: 'control rejected',
    } as CclinkProtocolMessage)
    expect(state.sessions.get('session')?.status).toBe('active')
    expect(service.listMessages('session')).toHaveLength(1)
  })

  it('rejects a workspace mismatch before sending control traffic', async () => {
    const { service, request, send } = await fixture()
    expect((await service.stopAgentRun({ ...ref, workspaceId: 'other' }, 'session')).success).toBe(
      false,
    )
    expect((await service.deleteSession({ ...ref, workspaceId: 'other' }, 'session')).success).toBe(
      false,
    )
    expect(request).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('prevents deleting an active remote turn even when local history was idle', async () => {
    const { service, request, send, sync } = await fixture()
    request.mockResolvedValue(sync([{ ...remote, active_turn: { request_id: 'turn' } }]))
    expect((await service.deleteSession(ref, 'session')).success).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(service.listMessages('session')).toHaveLength(1)
  })

  it('persists removal only after remote sync confirms it and ignores stale history/events', async () => {
    const { service, state, request, send, save, sync } = await fixture()
    request.mockResolvedValueOnce(sync([remote])).mockResolvedValueOnce(sync([]))
    expect(await service.deleteSession(ref, 'session')).toEqual({ success: true })
    expect(send).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({ cc_type: 'session_delete', session_id: 'session' }),
    )
    expect(save).toHaveBeenLastCalledWith({ version: 1, sessions: [], messages: {} })
    await state.handleProtocolMessage('agent', sync([remote]))
    await state.handleProtocolMessage('agent', {
      ...createCclinkEnvelope('user_text'),
      agent_id: 'agent',
      session_id: 'session',
      workspace_id: 'workspace',
      workspace_path: '/project',
      project_mode: 'remote_workspace',
      content: 'late',
    })
    expect(state.sessions.has('session')).toBe(false)
    expect(service.listMessages('session')).toEqual([])
  })

  it('preserves local history when remote deletion cannot be verified', async () => {
    const { service, state, request, sync } = await fixture()
    request.mockResolvedValueOnce(sync([remote])).mockRejectedValueOnce(new Error('断线'))
    expect(await service.deleteSession(ref, 'session')).toEqual({ success: false, error: '断线' })
    expect(state.sessions.has('session')).toBe(true)
    expect(service.listMessages('session')).toHaveLength(1)
  })

  it('removes retained offline history only after an online snapshot proves the session is absent', async () => {
    const { service, request, send, sync } = await fixture()
    request.mockResolvedValueOnce(sync([]))
    expect(await service.deleteSession(ref, 'session')).toEqual({ success: true })
    expect(send).not.toHaveBeenCalled()
  })
})
