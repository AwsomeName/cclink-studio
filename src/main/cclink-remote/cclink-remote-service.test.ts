import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createCclinkEnvelope,
  type CclinkProtocolMessage,
  type CclinkRemoteMessage,
  type CclinkRemoteSession,
  type CclinkServer,
} from '../../shared/cclink'
import type { RemoteStatus } from '../../shared/remote-protocol'
import { CclinkRemoteService } from './cclink-remote-service'
import {
  CclinkRequestError,
  type CclinkTransport,
  type CclinkTransportEvent,
  type ImageUploadOptions,
} from './request-router'
import { TimTransport, type TimAdapter } from './tim-transport'

class ReceivingTransport implements CclinkTransport {
  readonly sent: Array<{ serverId: string; message: CclinkProtocolMessage }> = []
  readonly uploadedImages: Array<{ serverId: string; imageId: string }> = []
  private readonly listeners = new Set<(event: CclinkTransportEvent) => void>()

  async sendMessage(serverId: string, message: CclinkProtocolMessage): Promise<void> {
    this.sent.push({ serverId, message })
  }

  async uploadImage(
    serverId: string,
    image: { id: string; size: number },
    options: ImageUploadOptions = {},
  ): Promise<string> {
    this.uploadedImages.push({ serverId, imageId: image.id })
    options.onProgress?.(image.size, image.size)
    return `https://cos.example/${image.id}.png`
  }

  onMessage(listener: (event: CclinkTransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  receive(serverId: string, message: CclinkProtocolMessage): void {
    for (const listener of this.listeners) listener({ serverId, message })
  }
}

const storedSession = {
  id: 'session-1',
  name: '保留的会话',
  workspaceId: 'workspace-1',
  workspacePath: '/srv/project',
  serverId: 'agent-1',
  status: 'idle' as const,
  createdAt: 1,
  updatedAt: 1,
  messageCount: 0,
  contextUsage: 0,
}

function createService(
  loadedState: {
    version: 1
    sessions: CclinkRemoteSession[]
    messages: Record<string, CclinkRemoteMessage[]>
  } = { version: 1, sessions: [storedSession], messages: {} },
) {
  const store = {
    load: vi.fn(async () => loadedState),
    save: vi.fn(async () => undefined),
  }
  const service = new CclinkRemoteService({} as never, null, store as never)
  const handle = (message: CclinkProtocolMessage) =>
    (
      service as unknown as {
        handleProtocolMessage(serverId: string, message: CclinkProtocolMessage): Promise<void>
      }
    ).handleProtocolMessage('agent-1', message)
  return { service, store, handle }
}

describe('CclinkRemoteService runtime protocol', () => {
  it('fully disposes a partially initialized Tencent transport when login fails', async () => {
    const unsubscribeMessage = vi.fn()
    const unsubscribeStatus = vi.fn()
    const logout = vi.fn().mockResolvedValue(undefined)
    const foreignError = { name: 'ReferenceError', message: 'navigator is not defined' }
    const adapter: TimAdapter = {
      login: vi.fn().mockRejectedValue(foreignError),
      logout,
      sendCustomMessage: vi.fn().mockResolvedValue(undefined),
      onCustomMessage: vi.fn().mockReturnValue(unsubscribeMessage),
      onStatus: vi.fn().mockReturnValue(unsubscribeStatus),
    }
    const transport = new TimTransport(adapter)
    const auth = {
      ensureIdentity: vi.fn().mockResolvedValue({
        accountUserId: 'user-1',
        imUserId: 'user-1',
        clientImUserId: 'client-1',
        imUserSig: 'memory-only',
        authToken: 'memory-only',
        sdkAppId: 1,
        deviceId: 'device-1',
        deviceName: 'Studio',
        updatedAt: Date.now(),
      }),
    }
    const service = new CclinkRemoteService(auth as never, null, undefined, () => transport)

    await expect(service.connect()).resolves.toEqual({
      state: 'error',
      error: 'navigator is not defined',
    })
    expect(logout).toHaveBeenCalledOnce()
    expect(unsubscribeMessage).toHaveBeenCalledOnce()
    expect(unsubscribeStatus).toHaveBeenCalledOnce()
  })

  it('backfills generated session names from the first persisted user message', async () => {
    const { service, store } = createService({
      version: 1 as const,
      sessions: [{ ...storedSession, name: '远程会话 292188' }],
      messages: {
        'session-1': [
          {
            type: 'user' as const,
            id: 'message-1',
            content: '检查发布流程是否完整',
            timestamp: 2,
          },
        ],
      },
    })

    await service.initialize()

    const sessions = (service as unknown as { sessions: Map<string, typeof storedSession> })
      .sessions
    expect(sessions.get('session-1')?.name).toBe('检查发布流程是否完整')
    expect(store.save).toHaveBeenCalledOnce()
  })

  it('uses the Agent-owned opaque workspace_id when opening and validating a workspace', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('file_tree_response'),
      workspace_id: 'ws_agent_canonical',
      path: '/srv/project',
      items: [],
    })

    await expect(service.openWorkspace('agent-1', '/srv/project')).resolves.toEqual({
      id: 'ws_agent_canonical',
      path: '/srv/project',
      name: 'project',
      serverId: 'agent-1',
      kind: 'directory',
      exists: true,
    })

    const validation = (
      service as unknown as {
        validateWorkspace(ref: typeof remoteRef, path: string): unknown
      }
    ).validateWorkspace(
      { ...remoteRef, workspaceId: 'ws_agent_canonical' },
      '/srv/project/README.md',
    )
    expect(validation).toBeNull()

    const wrongIdentity = (
      service as unknown as {
        validateWorkspace(ref: typeof remoteRef, path: string): unknown
      }
    ).validateWorkspace(
      { ...remoteRef, workspaceId: 'studio_local_hash' },
      '/srv/project/README.md',
    )
    expect(wrongIdentity).toMatchObject({
      success: false,
      remoteError: { code: 'REMOTE_WORKSPACE_NOT_FOUND' },
    })
  })

  it('fails closed when file_tree_response omits the canonical workspace_id', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('file_tree_response'),
      path: '/srv/project',
      items: [],
    })

    await expect(service.openWorkspace('agent-1', '/srv/project')).rejects.toThrow(
      '远程 Agent 未返回规范 workspace_id',
    )
  })

  it('cancels an open-workspace request without updating remembered workspaces', async () => {
    const { service } = createService()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)

    const opening = service.openWorkspace('agent-1', '/srv/project', 'open-request-1')
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))

    expect(service.cancelOpenWorkspace('open-request-1')).toBe(true)
    expect(service.cancelOpenWorkspace('missing-request')).toBe(false)
    await expect(opening).rejects.toThrow('远程请求已取消')
    expect(
      (service as unknown as { servers: Map<string, CclinkServer> }).servers.get('agent-1')
        ?.workspaces,
    ).toEqual([])
    service.getRequestRouter().detach()
  })

  it('maps the latest Agent capability response and preserves probe diagnostics', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      agentVersion: '0.8.41',
      protocolVersion: 2,
      runtime: 'claude_code',
      runtime_probe: {
        version: 1,
        refresh_state: 'refreshing',
        checked_at: 123,
        stale: false,
        count: 2,
        env_source: 'legacy-capability-payload',
        env_file: '/private/runtime.env',
      } as never,
      capabilities: {
        file: { write: true },
        agent: { runtime_select: true, stream_json_input: true },
        session: { streaming: false },
      },
      capability_map: { runtime_select: true, stream_json_input: true, image_input: true },
      capability_list: ['runtime_select', 'stream_json_input', 'image_input'],
    })

    const status = await service.getStatus(remoteRef)
    expect(status).toMatchObject({
      state: 'online',
      agentVersion: '0.8.41',
      protocolVersion: '2',
      runtime: 'claude_code',
      capabilityProbe: {
        state: 'refreshing',
        checkedAt: '123',
        stale: false,
        response: expect.objectContaining({
          cc_type: 'capability_probe_response',
          agentVersion: '0.8.41',
          capability_list: ['runtime_select', 'stream_json_input', 'image_input'],
        }),
      },
      capabilities: {
        file: { write: true },
        agent: { session: true, stream: true, imageInput: true },
      },
    })
    expect(status.remoteError).toBeUndefined()
    expect(status.capabilityProbe?.response.runtime_probe).toEqual({
      version: 1,
      refresh_state: 'refreshing',
      checked_at: 123,
      stale: false,
      count: 2,
    })
    expect(
      (
        service as unknown as {
          servers: Map<string, CclinkServer>
        }
      ).servers.get('agent-1')?.capabilities?.file_write,
    ).toBe(true)
  })

  it('uploads remote images before sending their URLs in user_text', async () => {
    const { service } = createService()
    await service.initialize()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)
    vi.spyOn(service, 'getStatus').mockResolvedValue({
      ...onlineStatus,
      capabilities: {
        ...onlineStatus.capabilities,
        agent: { session: true, stream: true, imageInput: true },
      },
    })
    const image = {
      id: 'image-1',
      name: 'screen.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }
    const progress: Array<{ phase: string; percent: number }> = []
    service.onImageUploadProgress((event) =>
      progress.push({ phase: event.phase, percent: event.percent }),
    )

    await expect(
      service.sendAgentMessage(
        remoteRef,
        'session-1',
        '',
        [image],
        '6e168c6e-82d8-4c8c-8092-1a3666704368',
      ),
    ).resolves.toEqual({ success: true })

    expect(transport.uploadedImages).toEqual([{ serverId: 'agent-1', imageId: 'image-1' }])
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.message).toMatchObject({
      cc_type: 'user_text',
      session_id: 'session-1',
      content: '',
      images: ['https://cos.example/image-1.png'],
    })
    expect(service.listMessages('session-1').at(-1)).toMatchObject({
      type: 'user',
      content: '图片消息（1 张）',
    })
    expect(progress).toEqual([
      { phase: 'preparing', percent: 0 },
      { phase: 'uploading', percent: 100 },
      { phase: 'sending', percent: 100 },
      { phase: 'completed', percent: 100 },
    ])
    service.getRequestRouter().detach()
  })

  it('aborts the active image request and never sends user_text after cancellation', async () => {
    const { service } = createService()
    await service.initialize()
    installOnlineServer(service)
    vi.spyOn(service, 'getStatus').mockResolvedValue({
      ...onlineStatus,
      capabilities: {
        ...onlineStatus.capabilities,
        agent: { session: true, stream: true, imageInput: true },
      },
    })
    const router = service.getRequestRouter()
    let signal: AbortSignal | undefined
    let markUploadStarted!: () => void
    const uploadStarted = new Promise<void>((resolve) => {
      markUploadStarted = resolve
    })
    vi.spyOn(router, 'uploadImage').mockImplementation(async (_serverId, _image, options) => {
      signal = options?.signal
      markUploadStarted()
      await new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
      return 'https://cos.example/unreachable.png'
    })
    const send = vi.spyOn(router, 'send')
    const progress = vi.fn()
    service.onImageUploadProgress(progress)
    const uploadId = 'a0169001-5981-4a0c-bc93-d35ab73777bb'
    const sending = service.sendAgentMessage(
      remoteRef,
      'session-1',
      '',
      [{ id: 'image-1', name: 'screen.png', mediaType: 'image/png', data: 'AQID', size: 3 }],
      uploadId,
    )

    await uploadStarted
    expect(signal?.aborted).toBe(false)
    expect(service.cancelAgentImageUpload(uploadId)).toBe(true)
    await expect(sending).resolves.toEqual({ success: false, error: '图片上传已取消' })

    expect(signal?.aborted).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(service.listMessages('session-1')).toEqual([])
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ uploadId, phase: 'cancelled', error: '图片上传已取消' }),
    )
    expect(service.cancelAgentImageUpload(uploadId)).toBe(false)
  })

  it('stops local tracking without claiming remote cancellation and ignores late stopped events', async () => {
    const { service, handle } = createService()
    await service.initialize()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)
    vi.spyOn(service, 'getStatus').mockResolvedValue(onlineStatus)

    await expect(service.sendAgentMessage(remoteRef, 'session-1', '执行长任务')).resolves.toEqual({
      success: true,
    })
    const requestId = transport.sent[0]?.message.request_id
    expect(requestId).toBeTruthy()

    expect(service.stopTrackingAgentRun(remoteRef, 'session-1')).toEqual({ success: true })
    expect(transport.sent).toHaveLength(1)
    expect(
      (
        service as unknown as {
          sessions: Map<string, typeof storedSession>
        }
      ).sessions.get('session-1')?.status,
    ).toBe('idle')
    expect(service.listMessages('session-1').at(-1)).toMatchObject({
      type: 'system',
      content: expect.stringContaining('不代表远端已取消'),
    })

    await handle({
      ...createCclinkEnvelope('stream_start', { request_id: requestId, trace_id: requestId }),
      session_id: 'session-1',
      msg_id: 'late-message',
    })
    await handle({
      ...createCclinkEnvelope('stream_end', { request_id: requestId, trace_id: requestId }),
      session_id: 'session-1',
      msg_id: 'late-message',
      final_text: '迟到结果不应重新关联',
    })

    expect(
      (
        service as unknown as {
          sessions: Map<string, typeof storedSession>
        }
      ).sessions.get('session-1')?.status,
    ).toBe('idle')
    expect(service.listMessages('session-1')).not.toContainEqual(
      expect.objectContaining({ content: '迟到结果不应重新关联' }),
    )
    service.getRequestRouter().detach()
  })

  it('reconciles a persisted active session after Studio loses runtime ownership', async () => {
    const { service, store } = createService({
      version: 1 as const,
      sessions: [{ ...storedSession, status: 'active' as const }],
      messages: {},
    })

    await service.initialize()

    expect(
      (
        service as unknown as {
          sessions: Map<string, typeof storedSession>
        }
      ).sessions.get('session-1')?.status,
    ).toBe('idle')
    expect(service.listMessages('session-1').at(-1)).toMatchObject({
      type: 'system',
      content: expect.stringContaining('重启后停止跟踪'),
    })
    expect(store.save).toHaveBeenCalledOnce()
  })

  it('does not send a partial user_text or append history when image upload fails', async () => {
    const { service } = createService()
    await service.initialize()
    installOnlineServer(service)
    vi.spyOn(service, 'getStatus').mockResolvedValue({
      ...onlineStatus,
      capabilities: {
        ...onlineStatus.capabilities,
        agent: { session: true, stream: true, imageInput: true },
      },
    })
    const router = service.getRequestRouter()
    vi.spyOn(router, 'uploadImage').mockRejectedValue(new Error('COS upload failed'))
    const send = vi.spyOn(router, 'send')

    await expect(
      service.sendAgentMessage(
        remoteRef,
        'session-1',
        '分析截图',
        [
          {
            id: 'image-1',
            name: 'screen.png',
            mediaType: 'image/png',
            data: 'AQID',
            size: 3,
          },
        ],
        '6c26020a-1e3f-41f2-a00d-4e6623ad5514',
      ),
    ).resolves.toEqual({ success: false, error: 'COS upload failed' })

    expect(send).not.toHaveBeenCalled()
    expect(service.listMessages('session-1')).toEqual([])
  })

  it('preserves the capability probe transport failure instead of reporting missing capability', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockRejectedValue(
      new CclinkRequestError('发送能力探测失败', {
        layer: 'transport',
        code: 'REMOTE_TRANSPORT_SEND_FAILED',
        message: '发送能力探测失败',
        retryable: true,
      }),
    )

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      state: 'online',
      remoteError: {
        layer: 'transport',
        code: 'REMOTE_TRANSPORT_SEND_FAILED',
        message: '发送能力探测失败',
        retryable: true,
        context: { endpointId: 'agent-1', operation: 'capability.probe' },
      },
    })
  })

  it('accepts a namespaced capability_map streaming signal', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      agent_version: '0.8.41',
      capability_map: { 'agent.stream_json_input': true },
      capability_list: [],
    })

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      capabilities: { agent: { session: true, stream: true } },
    })
  })

  it('uses capability signals and version metadata retained in the sender envelope', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      sender: {
        kind: 'agent',
        version: '0.8.41',
        protocol_version: 2,
        min_protocol_version: 2,
        capabilities: ['file_tree', 'file_read', 'stream_json_input', 'runtime_select'],
      },
      payload_truncated: true,
    })

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      state: 'online',
      agentVersion: '0.8.41',
      protocolVersion: '2',
      compatibility: 'compatible',
      capabilities: {
        file: { tree: true, read: true },
        agent: { session: true, stream: true },
      },
      capabilityProbe: {
        response: expect.objectContaining({
          sender: expect.objectContaining({
            version: '0.8.41',
            capabilities: expect.arrayContaining(['file_tree', 'stream_json_input']),
          }),
        }),
      },
    })
    expect((await service.getStatus(remoteRef)).remoteError).toBeUndefined()
  })

  it('opens the remote file tree when file_tree survives only in sender capabilities', async () => {
    const { service } = createService()
    installOnlineServer(service, [
      {
        id: remoteRef.workspaceId,
        path: remoteRef.path,
        name: 'project',
        serverId: remoteRef.endpointId,
        kind: 'directory',
        exists: true,
      },
    ])
    vi.spyOn(service.getRequestRouter(), 'request')
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('capability_probe_response'),
        sender: {
          kind: 'agent',
          version: '0.8.41',
          capabilities: ['file_tree', 'stream_json_input'],
        },
        payload_truncated: true,
      })
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('file_tree_response'),
        workspace_id: remoteRef.workspaceId,
        path: remoteRef.path,
        items: [{ name: 'README.md', type: 'file' }],
      })

    await expect(
      service.listFileTree({ ref: remoteRef, path: remoteRef.path, depth: 1 }),
    ).resolves.toMatchObject({
      success: true,
      workspaceId: remoteRef.workspaceId,
      tree: {
        path: remoteRef.path,
        children: [expect.objectContaining({ name: 'README.md', type: 'file' })],
      },
    })
  })

  it('reads every remote file page before returning editable content', async () => {
    const { service } = createService()
    installOnlineServer(service, [remoteWorkspace])
    const lines = Array.from({ length: 101 }, (_, index) => `line ${index + 1}`)
    const content = lines.join('\n')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const request = vi
      .spyOn(service.getRequestRouter(), 'request')
      .mockResolvedValueOnce(readCapabilityResponse())
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('file_read_response'),
        path: remoteFilePath,
        content: lines.slice(0, 100).join('\n'),
        total_lines: lines.length,
        start_line: 1,
        end_line: 100,
        has_more: true,
        content_sha256: sha256,
      })
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('file_read_response'),
        path: remoteFilePath,
        content: lines[100],
        total_lines: lines.length,
        start_line: 101,
        end_line: 101,
        has_more: false,
        content_sha256: sha256,
      })

    await expect(service.readFile({ ref: remoteRef, path: remoteFilePath })).resolves.toEqual({
      success: true,
      file: {
        path: remoteFilePath,
        content,
        totalLines: 101,
        complete: true,
        sha256,
      },
    })
    expect(request).toHaveBeenNthCalledWith(
      2,
      'agent-1',
      expect.objectContaining({ start_line: 1, end_line: 100 }),
      ['file_read_response'],
    )
    expect(request).toHaveBeenNthCalledWith(
      3,
      'agent-1',
      expect.objectContaining({ start_line: 101, end_line: 200 }),
      ['file_read_response'],
    )
  })

  it('retries a transport-truncated file page with a smaller line window', async () => {
    const { service } = createService()
    installOnlineServer(service, [remoteWorkspace])
    const lines = Array.from({ length: 101 }, (_, index) => `line ${index + 1}`)
    const content = lines.join('\n')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const request = vi
      .spyOn(service.getRequestRouter(), 'request')
      .mockResolvedValueOnce(readCapabilityResponse())
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('file_read_response'),
        path: remoteFilePath,
        content: 'partial transport payload',
        content_truncated: true,
        total_lines: lines.length,
        start_line: 1,
        end_line: 100,
        has_more: true,
        content_sha256: sha256,
      })
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('file_read_response'),
        path: remoteFilePath,
        content: lines.slice(0, 50).join('\n'),
        total_lines: lines.length,
        start_line: 1,
        end_line: 50,
        has_more: true,
        content_sha256: sha256,
      })
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('file_read_response'),
        path: remoteFilePath,
        content: lines.slice(50).join('\n'),
        total_lines: lines.length,
        start_line: 51,
        end_line: 101,
        has_more: false,
        content_sha256: sha256,
      })

    await expect(service.readFile({ ref: remoteRef, path: remoteFilePath })).resolves.toMatchObject(
      {
        success: true,
        file: { content, complete: true, sha256 },
      },
    )
    expect(request).toHaveBeenNthCalledWith(
      3,
      'agent-1',
      expect.objectContaining({ start_line: 1, end_line: 50 }),
      ['file_read_response'],
    )
  })

  it('fails closed when the remote file changes between pages', async () => {
    const { service } = createService()
    installOnlineServer(service, [remoteWorkspace])
    const request = vi.spyOn(service.getRequestRouter(), 'request')
    request
      .mockResolvedValueOnce(readCapabilityResponse())
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('file_read_response'),
        path: remoteFilePath,
        content: 'first page',
        total_lines: 101,
        start_line: 1,
        end_line: 100,
        has_more: true,
        content_sha256: 'a'.repeat(64),
      })
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('file_read_response'),
        path: remoteFilePath,
        content: 'changed page',
        total_lines: 101,
        start_line: 101,
        end_line: 101,
        has_more: false,
        content_sha256: 'b'.repeat(64),
      })

    await expect(service.readFile({ ref: remoteRef, path: remoteFilePath })).resolves.toMatchObject(
      {
        success: false,
        unavailable: false,
        remoteError: {
          layer: 'file-provider',
          code: 'REMOTE_FILE_CHANGED_DURING_READ',
          retryable: true,
        },
      },
    )
  })

  it('only reports missing Agent capability after a clean probe response has no supported signal', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      agent_version: '0.8.41',
      runtime: 'claude_code',
      runtime_probe: { refresh_state: 'ready', checked_at: 456, stale: false },
      capabilities: { agent: {}, session: { streaming: false } },
      capability_map: {},
      capability_list: [],
    })

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      state: 'online',
      remoteError: {
        layer: 'remote-agent',
        code: 'REMOTE_CAPABILITY_UNAVAILABLE',
        retryable: false,
      },
    })
  })

  it('does not turn a truncated probe with no capability evidence into an unsupported verdict', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      payload_truncated: true,
      payload_truncation_reason: 'emergency_minimal',
    })

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      state: 'online',
      remoteError: {
        layer: 'remote-agent',
        code: 'REMOTE_CAPABILITY_PROBE_INCOMPLETE',
        retryable: true,
        context: {
          payloadTruncated: true,
          truncationReason: 'emergency_minimal',
        },
      },
    })
  })

  it('correlates a capability response at the real transport receiver', async () => {
    const { service } = createService()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)

    const pending = service.getStatus(remoteRef)
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const requestId = transport.sent[0]?.message.request_id

    transport.receive('agent-1', {
      ...createCclinkEnvelope('capability_probe_response'),
      request_id: 'unrelated-request',
      capability_probe_complete: true,
      capability_map: { file_read: false },
    })
    transport.receive('agent-1', {
      ...createCclinkEnvelope('capability_probe_response'),
      request_id: requestId,
      capability_probe_complete: true,
      capability_map: { file_read: true, stream_json_input: true },
    })

    await expect(pending).resolves.toMatchObject({
      capabilities: {
        file: { read: true },
        agent: { session: true, stream: true },
      },
      capabilityProbe: {
        response: { request_id: requestId },
      },
    })
    service.getRequestRouter().detach()
  })

  it('preserves a correlated Agent failure response at the real transport receiver', async () => {
    const { service } = createService()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)

    const pending = service.getStatus(remoteRef)
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const requestId = transport.sent[0]?.message.request_id
    transport.receive('agent-1', {
      ...createCclinkEnvelope('error'),
      request_id: requestId,
      code: 'RUNTIME_PROBE_FAILED',
      message: 'runtime probe failed',
      retryable: false,
    })

    await expect(pending).resolves.toMatchObject({
      remoteError: {
        layer: 'remote-agent',
        code: 'RUNTIME_PROBE_FAILED',
        message: 'runtime probe failed',
        retryable: false,
        context: { endpointId: 'agent-1', operation: 'capability.probe' },
      },
    })
    service.getRequestRouter().detach()
  })

  it('does not overwrite PTY, file, or Markdown capability caches with an incomplete response', async () => {
    const { service } = createService()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)

    const initial = service.getStatus(remoteRef)
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const initialRequestId = transport.sent[0]?.message.request_id
    transport.receive('agent-1', {
      ...createCclinkEnvelope('capability_probe_response'),
      request_id: initialRequestId,
      capability_probe_complete: true,
      capability_map: {
        file_read: true,
        file_write: true,
        file_markdown_open_v3: true,
        file_markdown_save_v3: true,
        terminal_workspace_pty: true,
        stream_json_input: true,
      },
      capability_list: [
        'file_read',
        'file_write',
        'file_markdown_open_v3',
        'file_markdown_save_v3',
        'terminal_workspace_pty',
        'stream_json_input',
      ],
    })
    await expect(initial).resolves.toMatchObject({
      capabilities: {
        file: { read: true, write: true },
        shell: { pty: true },
      },
    })

    const internals = service as unknown as {
      capabilityProbes: Map<string, { response: CclinkProtocolMessage | null; expiresAt: number }>
      servers: Map<string, CclinkServer>
    }
    const validCache = internals.capabilityProbes.get('agent-1')
    expect(validCache?.response?.request_id).toBe(initialRequestId)
    if (validCache) validCache.expiresAt = 0

    const refresh = service.getStatus(remoteRef)
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
    const refreshRequestId = transport.sent[1]?.message.request_id
    transport.receive('agent-1', {
      ...createCclinkEnvelope('capability_probe_response'),
      request_id: refreshRequestId,
      capability_probe_complete: false,
      status: 'error',
      code: 'CAPABILITY_PROBE_INCOMPLETE',
    })

    await expect(refresh).resolves.toMatchObject({
      capabilities: {
        file: { read: true, write: true },
        shell: { pty: true },
        agent: { session: true, stream: true },
      },
      capabilityProbe: { response: { request_id: initialRequestId } },
      remoteError: {
        code: 'REMOTE_CAPABILITY_PROBE_INCOMPLETE',
        retryable: true,
        context: { capabilityProbeComplete: false },
      },
    })
    expect(internals.capabilityProbes.get('agent-1')).toBe(validCache)
    expect(internals.capabilityProbes.get('agent-1')?.response?.request_id).toBe(initialRequestId)
    expect(internals.servers.get('agent-1')?.capabilities).toMatchObject({
      file_read: true,
      file_write: true,
      file_markdown_open_v3: true,
      file_markdown_save_v3: true,
      terminal_workspace_pty: true,
    })
    service.getRequestRouter().detach()
  })

  it('保留 Agent 审批字段并把主动问题送到会话 UI', async () => {
    const { service, handle } = createService()
    await service.initialize()

    await handle({
      ...createCclinkEnvelope('agent_tool', { request_id: 'request-1' }),
      session_id: 'session-1',
      msg_id: 'message-1',
      tool: 'Bash',
      tool_use_id: 'tool-1',
      state: 'pending',
      requires_approval: true,
      approval_reason: '将修改项目文件',
    })
    await handle({
      ...createCclinkEnvelope('user_question', { request_id: 'request-2' }),
      session_id: 'session-1',
      msg_id: 'message-2',
      tool_use_id: 'tool-2',
      questions: [{ id: 'choice', question: '选择部署环境', options: [{ label: '测试' }] }],
    })

    expect(service.listMessages('session-1')).toEqual([
      expect.objectContaining({
        type: 'agentTool',
        tool: expect.objectContaining({
          id: 'tool-1',
          requiresApproval: true,
          requestId: 'request-1',
        }),
      }),
      expect.objectContaining({
        type: 'userQuestion',
        requestId: 'request-2',
        toolUseId: 'tool-2',
      }),
    ])
  })

  it('执行中事件未明确撤销时保留同一工具的待审批状态', async () => {
    const { service, handle } = createService()
    await service.initialize()

    await handle({
      ...createCclinkEnvelope('agent_tool', { request_id: 'approval-request' }),
      session_id: 'session-1',
      msg_id: 'message-approval',
      tool: 'ExitPlanMode',
      tool_use_id: 'tool-approval',
      state: 'pending',
      requires_approval: true,
      approval_reason: '需要确认实施计划',
      expires_at: 123456,
    })
    await handle({
      ...createCclinkEnvelope('agent_tool'),
      session_id: 'session-1',
      msg_id: 'message-approval',
      tool: 'ExitPlanMode',
      tool_use_id: 'tool-approval',
      state: 'executing',
    })

    expect(service.listMessages('session-1')).toEqual([
      expect.objectContaining({
        type: 'agentTool',
        tool: expect.objectContaining({
          id: 'tool-approval',
          state: 'executing',
          requiresApproval: true,
          requestId: 'approval-request',
          approvalReason: '需要确认实施计划',
          expiresAt: 123456,
        }),
      }),
    ])
  })

  it('明确撤销或工具进入终态后不再保留待审批状态', async () => {
    const createPendingTool = () => ({
      ...createCclinkEnvelope('agent_tool', { request_id: 'approval-request' }),
      session_id: 'session-1',
      msg_id: 'message-approval',
      tool: 'ExitPlanMode',
      tool_use_id: 'tool-approval',
      state: 'pending' as const,
      requires_approval: true,
    })

    const explicitRevocation = createService()
    await explicitRevocation.service.initialize()
    await explicitRevocation.handle(createPendingTool())
    await explicitRevocation.handle({
      ...createPendingTool(),
      state: 'executing',
      requires_approval: false,
    })
    expect(explicitRevocation.service.listMessages('session-1')[0]).toMatchObject({
      type: 'agentTool',
      tool: { state: 'executing', requiresApproval: false },
    })

    const completedTool = createService()
    await completedTool.service.initialize()
    await completedTool.handle(createPendingTool())
    await completedTool.handle({
      ...createPendingTool(),
      state: 'completed',
      requires_approval: undefined,
    })
    expect(completedTool.service.listMessages('session-1')[0]).toMatchObject({
      type: 'agentTool',
      tool: { state: 'completed', requiresApproval: false },
    })
  })

  it('为远程会话保留有界协议终态诊断并合并到诊断报告', async () => {
    const { service, handle } = createService()
    await service.initialize()
    vi.spyOn(service, 'getStatus').mockResolvedValue(onlineStatus)

    await handle({
      ...createCclinkEnvelope('stream_start', {
        request_id: 'request-1',
        trace_id: 'trace-1',
      }),
      session_id: 'session-1',
      msg_id: 'message-1',
    })
    await handle({
      ...createCclinkEnvelope('stream_chunk'),
      session_id: 'session-1',
      msg_id: 'message-1',
      delta: '第一段',
    })
    await handle({
      ...createCclinkEnvelope('stream_chunk'),
      session_id: 'session-1',
      msg_id: 'message-1',
      delta: '第二段',
    })
    await handle({
      ...createCclinkEnvelope('stream_end', { request_id: 'request-1', trace_id: 'trace-1' }),
      session_id: 'session-1',
      msg_id: 'message-1',
      exit_code: 0,
      final_state: 'missing_final_diagnostic',
    })

    await expect(service.diagnose(remoteRef, 'session-1')).resolves.toMatchObject({
      agentSession: {
        session: { id: 'session-1', status: 'idle' },
        messageLimit: 100,
        eventLimit: 100,
        processLocalOnly: true,
        events: [
          expect.objectContaining({
            direction: 'inbound',
            type: 'stream_start',
            requestId: 'request-1',
            traceId: 'trace-1',
          }),
          expect.objectContaining({ type: 'stream_chunk', count: 2 }),
          expect.objectContaining({
            type: 'stream_end',
            exitCode: 0,
            finalState: 'missing_final_diagnostic',
          }),
        ],
      },
    })
  })

  it('不会把 agent_text 的最终结论和 stream_end.final_text 保存两遍', async () => {
    const { service, handle } = createService()
    await service.initialize()

    await handle({
      ...createCclinkEnvelope('agent_text', {
        request_id: 'request-1',
        trace_id: 'trace-1',
      }),
      session_id: 'session-1',
      msg_id: 'message-1-seg199',
      content: '全部任务完成。',
    })
    const streamEnd = {
      ...createCclinkEnvelope('stream_end', {
        request_id: 'request-1',
        trace_id: 'trace-1',
      }),
      session_id: 'session-1',
      msg_id: 'message-1',
      final_text: '全部任务完成。',
    }
    await handle(streamEnd)
    await handle(streamEnd)

    expect(service.listMessages('session-1')).toEqual([
      expect.objectContaining({
        type: 'agentText',
        id: 'remote-agent-message-1-seg199',
        content: '全部任务完成。',
      }),
    ])
  })

  it('保留过程消息和两次独立请求中相同的回答', async () => {
    const { service, handle } = createService()
    await service.initialize()

    for (const message of [
      {
        ...createCclinkEnvelope('agent_text'),
        session_id: 'session-1',
        msg_id: 'message-1-seg198',
        content: '正在收尾。',
      },
      {
        ...createCclinkEnvelope('agent_text'),
        session_id: 'session-1',
        msg_id: 'message-1-seg199',
        content: '全部任务完成。',
      },
      {
        ...createCclinkEnvelope('stream_end'),
        session_id: 'session-1',
        msg_id: 'message-1',
        final_text: '全部任务完成。',
      },
      {
        ...createCclinkEnvelope('agent_text'),
        session_id: 'session-1',
        msg_id: 'message-2-seg1',
        content: '全部任务完成。',
      },
      {
        ...createCclinkEnvelope('stream_end'),
        session_id: 'session-1',
        msg_id: 'message-2',
        final_text: '全部任务完成。',
      },
    ]) {
      await handle(message)
    }

    expect(
      service
        .listMessages('session-1')
        .filter((message) => message.type === 'agentText')
        .map((message) => message.content),
    ).toEqual(['正在收尾。', '全部任务完成。', '全部任务完成。'])
  })

  it('只在 Agent ACK 后提交审批状态，并保留被拒绝的待审批操作', async () => {
    const { service, handle } = createService()
    await service.initialize()
    await handle({
      ...createCclinkEnvelope('agent_tool', { request_id: 'approval-request' }),
      session_id: 'session-1',
      msg_id: 'message-approval',
      tool: 'Bash',
      tool_use_id: 'tool-approval',
      state: 'pending',
      requires_approval: true,
    })
    vi.spyOn(service, 'connect').mockResolvedValue({ state: 'online' })
    vi.spyOn(service, 'getStatus').mockResolvedValue(onlineStatus)
    const request = vi.spyOn(service.getRequestRouter(), 'request')
    request.mockRejectedValueOnce(new Error('CONTROL_NOT_PENDING'))

    await expect(
      service.resolveToolApproval({
        ref: remoteRef,
        sessionId: 'session-1',
        requestId: 'approval-request',
        toolUseId: 'tool-approval',
        approved: true,
      }),
    ).resolves.toMatchObject({ success: false })
    expect(service.listMessages('session-1')[0]).toMatchObject({
      type: 'agentTool',
      tool: { state: 'pending', requiresApproval: true },
    })

    request.mockResolvedValueOnce({
      ...createCclinkEnvelope('tool_approval_ack'),
      request_id: 'approval-request',
      session_id: 'session-1',
      tool_use_id: 'tool-approval',
      approved: true,
      status: 'accepted',
    })
    await expect(
      service.resolveToolApproval({
        ref: remoteRef,
        sessionId: 'session-1',
        requestId: 'approval-request',
        toolUseId: 'tool-approval',
        approved: true,
      }),
    ).resolves.toEqual({ success: true })
    expect(service.listMessages('session-1')[0]).toMatchObject({
      type: 'agentTool',
      tool: { state: 'executing', requiresApproval: false },
    })
  })

  it('同一任务的多张审批卡使用独立控制 request_id', async () => {
    const { service, handle } = createService()
    await service.initialize()
    for (const [msgId, toolUseId] of [
      ['message-approval-1', 'tool-approval-1'],
      ['message-approval-2', 'tool-approval-2'],
    ]) {
      await handle({
        ...createCclinkEnvelope('agent_tool', { request_id: 'shared-run-request' }),
        session_id: 'session-1',
        msg_id: msgId,
        tool: 'WebSearch',
        tool_use_id: toolUseId,
        state: 'pending',
        requires_approval: true,
      })
    }
    vi.spyOn(service, 'connect').mockResolvedValue({ state: 'online' })
    vi.spyOn(service, 'getStatus').mockResolvedValue(onlineStatus)
    const request = vi
      .spyOn(service.getRequestRouter(), 'request')
      .mockImplementation(async (_serverId, message) => ({
        ...createCclinkEnvelope('tool_approval_ack'),
        request_id: message.request_id,
        session_id: 'session-1',
        tool_use_id: String((message as { tool_use_id?: string }).tool_use_id),
        approved: true,
        status: 'accepted',
      }))

    await expect(
      Promise.all(
        ['tool-approval-1', 'tool-approval-2'].map((toolUseId) =>
          service.resolveToolApproval({
            ref: remoteRef,
            sessionId: 'session-1',
            requestId: 'shared-run-request',
            toolUseId,
            approved: true,
          }),
        ),
      ),
    ).resolves.toEqual([{ success: true }, { success: true }])

    const outbound = request.mock.calls.map((call) => call[1])
    expect(outbound.map((message) => message.request_id)).toEqual([
      expect.any(String),
      expect.any(String),
    ])
    expect(outbound[0]?.request_id).not.toBe(outbound[1]?.request_id)
    expect(outbound.map((message) => message.trace_id)).toEqual([
      'shared-run-request',
      'shared-run-request',
    ])
  })

  it('真实 transport 能乱序完成同一任务的多张审批卡', async () => {
    const { service, handle } = createService()
    await service.initialize()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)
    vi.spyOn(service, 'getStatus').mockResolvedValue(onlineStatus)

    for (const [msgId, toolUseId] of [
      ['message-transport-1', 'tool-transport-1'],
      ['message-transport-2', 'tool-transport-2'],
    ]) {
      await handle({
        ...createCclinkEnvelope('agent_tool', { request_id: 'shared-transport-run' }),
        session_id: 'session-1',
        msg_id: msgId,
        tool: 'WebSearch',
        tool_use_id: toolUseId,
        state: 'pending',
        requires_approval: true,
      })
    }

    const approvals = Promise.all(
      ['tool-transport-1', 'tool-transport-2'].map((toolUseId) =>
        service.resolveToolApproval({
          ref: remoteRef,
          sessionId: 'session-1',
          requestId: 'shared-transport-run',
          toolUseId,
          approved: true,
        }),
      ),
    )
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2))

    const outbound = transport.sent.map(({ message }) => ({
      requestId: message.request_id,
      traceId: message.trace_id,
      toolUseId: String((message as { tool_use_id?: string }).tool_use_id),
    }))
    expect(new Set(outbound.map((message) => message.requestId)).size).toBe(2)
    expect(outbound.map((message) => message.traceId)).toEqual([
      'shared-transport-run',
      'shared-transport-run',
    ])

    for (const message of outbound.reverse()) {
      transport.receive('agent-1', {
        ...createCclinkEnvelope('tool_approval_ack'),
        request_id: message.requestId,
        session_id: 'session-1',
        tool_use_id: message.toolUseId,
        approved: true,
        status: 'accepted',
      })
    }

    await expect(approvals).resolves.toEqual([{ success: true }, { success: true }])
    expect(service.listMessages('session-1')).toEqual([
      expect.objectContaining({
        type: 'agentTool',
        tool: expect.objectContaining({ state: 'executing', requiresApproval: false }),
      }),
      expect.objectContaining({
        type: 'agentTool',
        tool: expect.objectContaining({ state: 'executing', requiresApproval: false }),
      }),
    ])
    service.getRequestRouter().detach()
  })

  it('按问题文本发送多选答案且只在 ACK 后标记已回答', async () => {
    const { service, handle } = createService()
    await service.initialize()
    await handle({
      ...createCclinkEnvelope('user_question', { request_id: 'question-request' }),
      session_id: 'session-1',
      msg_id: 'message-question',
      tool_use_id: 'tool-question',
      questions: [
        {
          id: 'features',
          question: '启用哪些功能？',
          multiSelect: true,
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    })
    vi.spyOn(service, 'connect').mockResolvedValue({ state: 'online' })
    vi.spyOn(service, 'getStatus').mockResolvedValue(onlineStatus)
    const request = vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('question_answer_ack'),
      request_id: 'question-request',
      session_id: 'session-1',
      tool_use_id: 'tool-question',
      status: 'accepted',
    })

    await expect(
      service.answerQuestion({
        ref: remoteRef,
        sessionId: 'session-1',
        requestId: 'question-request',
        toolUseId: 'tool-question',
        answers: { features: 'A, B' },
      }),
    ).resolves.toEqual({ success: true })
    expect(request).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        answers: { '启用哪些功能？': 'A, B' },
        request_id: expect.not.stringMatching(/^question-request$/u),
        trace_id: 'question-request',
      }),
      ['question_answer_ack'],
      15_000,
    )
    expect(service.listMessages('session-1')[0]).toMatchObject({
      type: 'userQuestion',
      answered: true,
      questions: [expect.objectContaining({ multiSelect: true })],
    })
  })

  it('远端同步快照缺项时不删除本地导入历史', async () => {
    const { service, handle, store } = createService()
    await service.initialize()
    await handle({
      ...createCclinkEnvelope('session_sync_response'),
      sessions: [],
    })

    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ sessions: [expect.objectContaining({ id: 'session-1' })] }),
    )
  })
})

function installOnlineServer(
  service: CclinkRemoteService,
  workspaces: CclinkServer['workspaces'] = [],
): void {
  const internals = service as unknown as {
    status: { state: 'online' }
    servers: Map<string, CclinkServer>
  }
  internals.status = { state: 'online' }
  internals.servers.set('agent-1', {
    id: 'agent-1',
    name: 'Agent 1',
    hostname: 'agent-1',
    os: 'Linux',
    status: 'online',
    agentVersion: '0.8.41',
    lastSeen: Date.now(),
    workspaces,
  })
}

const remoteRef = {
  kind: 'remote' as const,
  transport: 'cclink' as const,
  endpointId: 'agent-1',
  workspaceId: 'workspace-1',
  path: '/srv/project',
}

const remoteWorkspace = {
  id: remoteRef.workspaceId,
  path: remoteRef.path,
  name: 'project',
  serverId: remoteRef.endpointId,
  kind: 'directory',
  exists: true,
}

const remoteFilePath = '/srv/project/README.md'

function readCapabilityResponse(): CclinkProtocolMessage {
  return {
    ...createCclinkEnvelope('capability_probe_response'),
    capability_probe_complete: true,
    capability_map: { file_read: true, stream_json_input: true },
    capability_list: ['file_read', 'stream_json_input'],
  }
}

const onlineStatus: RemoteStatus = {
  ref: remoteRef,
  state: 'online',
  compatibility: 'compatible',
  workspacePath: '/srv/project',
  capabilities: {
    file: { tree: true, read: true, write: true, create: true, rename: true, delete: true },
    agent: { session: true, stream: true },
    shell: { pty: true },
  },
}
