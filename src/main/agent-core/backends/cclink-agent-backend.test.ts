import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CclinkAgentBackend } from './cclink-agent-backend'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

describe('CclinkAgentBackend', () => {
  it('streams two turns and sends the first runtime session id on turn two', async () => {
    const requests: Array<Record<string, unknown>> = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        requests.push(JSON.parse(body) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('event: text\ndata: {"type":"text","delta":"第')
        response.write(
          requests.length === 1
            ? '一","runtime_session_id":"runtime-session-1"}\n\n'
            : '二","runtime_session_id":"runtime-session-1"}\n\n',
        )
        response.end('event: done\ndata: {"ok":true,"done":true}\n\n')
      })
    })
    const baseUrl = await listen(server)
    const backend = new CclinkAgentBackend({
      baseUrl,
      token: 'mock:test:runtime:run:/tmp',
      runtimeId: 'claude_code',
    })
    const events: Array<{ type: string; data: unknown }> = []
    backend.onEvent((type, data) => events.push({ type, data }))

    await backend.sendMessage('第一轮', {
      conversationId: 'conversation-1',
      runId: 'run-1',
      workspacePath: '/tmp',
    })
    await vi.waitFor(() => expect(events.some((event) => event.type === 'complete')).toBe(true))
    expect(backend.getSessionId()).toBe('runtime-session-1')
    expect(requests[0]).toMatchObject({ runtime_session_id: '', request_id: 'run-1' })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'system',
          data: expect.objectContaining({ session_id: 'runtime-session-1' }),
        }),
        expect.objectContaining({
          type: 'stream',
          data: expect.objectContaining({
            protocol: 'studio-agent-event-v1',
            event: expect.objectContaining({ type: 'text-delta', text: '第一' }),
          }),
        }),
      ]),
    )

    events.length = 0
    await backend.sendMessage('第二轮', {
      conversationId: 'conversation-1',
      runId: 'run-2',
      workspacePath: '/tmp',
    })
    await vi.waitFor(() => expect(events.some((event) => event.type === 'complete')).toBe(true))
    expect(requests[1]).toMatchObject({
      runtime_session_id: 'runtime-session-1',
      request_id: 'run-2',
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'stream',
          data: expect.objectContaining({
            event: expect.objectContaining({ text: '第二' }),
          }),
        }),
      ]),
    )
    await backend.destroy()
  })

  it('fails closed when a completed first turn has no runtime session id', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        'event: text\ndata: {"type":"text","delta":"partial"}\n\n' +
          'event: done\ndata: {"ok":true,"done":true}\n\n',
      )
    })
    const baseUrl = await listen(server)
    const backend = new CclinkAgentBackend({
      baseUrl,
      token: 'mock:test:runtime:run:/tmp',
      runtimeId: 'claude_code',
    })
    const errors: unknown[] = []
    backend.onEvent((type, data) => {
      if (type === 'error') errors.push(data)
    })

    await backend.sendMessage('hello', {
      conversationId: 'conversation-1',
      runId: 'run-1',
      workspacePath: '/tmp',
    })
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toMatchObject({ code: 'cclink_agent_session_id_missing' })
    expect(backend.getSessionId()).toBeNull()
    await backend.destroy()
  })

  it('declares exact cancellation unavailable instead of aborting the SSE transport', async () => {
    const backend = new CclinkAgentBackend({
      baseUrl: 'http://127.0.0.1:17374',
      token: 'mock:test:runtime:run:/tmp',
      runtimeId: 'claude_code',
    })

    expect(backend.exactCancellationSupported).toBe(false)
    await expect(backend.abort()).rejects.toThrow('尚无按 request_id 精确取消接口')
  })
})

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no TCP address')
  return `http://127.0.0.1:${address.port}`
}
