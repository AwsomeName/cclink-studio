import { describe, expect, it } from 'vitest'
import { createCclinkEnvelope, type CclinkProtocolMessage } from '../../shared/cclink'
import {
  CclinkRequestRouter,
  type CclinkTransport,
  type CclinkTransportEvent,
} from './request-router'

class FakeTransport implements CclinkTransport {
  sent: Array<{ serverId: string; message: CclinkProtocolMessage }> = []
  private listeners = new Set<(event: CclinkTransportEvent) => void>()

  async sendMessage(serverId: string, message: CclinkProtocolMessage): Promise<void> {
    this.sent.push({ serverId, message })
  }

  onMessage(listener: (event: CclinkTransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: CclinkTransportEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

describe('CclinkRequestRouter', () => {
  it('用唯一 request_id 在乱序响应中完成正确请求', async () => {
    const transport = new FakeTransport()
    const router = new CclinkRequestRouter()
    router.attach(transport)

    const first = router.request('agent-1', createCclinkEnvelope('file_read_request'), [
      'file_read_response',
    ])
    const second = router.request('agent-1', createCclinkEnvelope('file_tree_request'), [
      'file_tree_response',
    ])
    await Promise.resolve()
    const [firstSent, secondSent] = transport.sent
    expect(firstSent.message.request_id).toBeTruthy()
    expect(secondSent.message.request_id).toBeTruthy()
    expect(firstSent.message.request_id).not.toBe(secondSent.message.request_id)

    transport.emit({
      serverId: 'agent-1',
      message: {
        ...createCclinkEnvelope('file_tree_response'),
        request_id: secondSent.message.request_id,
      },
    })
    transport.emit({
      serverId: 'agent-1',
      message: {
        ...createCclinkEnvelope('file_read_response'),
        request_id: firstSent.message.request_id,
      },
    })

    await expect(first).resolves.toMatchObject({ cc_type: 'file_read_response' })
    await expect(second).resolves.toMatchObject({ cc_type: 'file_tree_response' })
    router.detach()
  })

  it('不会让其他设备的相同 request_id 完成等待请求', async () => {
    const transport = new FakeTransport()
    const router = new CclinkRequestRouter()
    router.attach(transport)
    const result = router.request(
      'agent-1',
      { ...createCclinkEnvelope('file_tree_request'), request_id: 'fixed' },
      ['file_tree_response'],
    )
    await Promise.resolve()
    transport.emit({
      serverId: 'agent-2',
      message: { ...createCclinkEnvelope('file_tree_response'), request_id: 'fixed' },
    })
    transport.emit({
      serverId: 'agent-1',
      message: { ...createCclinkEnvelope('file_tree_response'), request_id: 'fixed' },
    })
    await expect(result).resolves.toMatchObject({ request_id: 'fixed' })
    router.detach()
  })

  it('把无 request_id 的流式事件交给协议监听器', () => {
    const transport = new FakeTransport()
    const router = new CclinkRequestRouter()
    const received: CclinkTransportEvent[] = []
    router.onProtocolEvent((event) => received.push(event))
    router.attach(transport)

    transport.emit({
      serverId: 'agent-1',
      message: {
        ...createCclinkEnvelope('stream_chunk'),
        session_id: 'session-1',
        msg_id: 'message-1',
        delta: 'hello',
      },
    })

    expect(received).toHaveLength(1)
    expect(received[0]?.message.cc_type).toBe('stream_chunk')
    router.detach()
  })

  it('cancels a pending request immediately and ignores its late response', async () => {
    const transport = new FakeTransport()
    const router = new CclinkRequestRouter()
    router.attach(transport)
    const result = router.request(
      'agent-1',
      { ...createCclinkEnvelope('file_tree_request'), request_id: 'open-request-1' },
      ['file_tree_response'],
    )
    await Promise.resolve()

    expect(router.cancel('open-request-1')).toBe(true)
    expect(router.cancel('open-request-1')).toBe(false)
    await expect(result).rejects.toMatchObject({
      remoteError: { code: 'REMOTE_REQUEST_CANCELLED', retryable: false },
    })

    transport.emit({
      serverId: 'agent-1',
      message: {
        ...createCclinkEnvelope('file_tree_response'),
        request_id: 'open-request-1',
      },
    })
    router.detach()
  })
})
