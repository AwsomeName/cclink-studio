import { describe, expect, it, vi } from 'vitest'
import { createLocalAgentConversationProvider } from './conversation-runtime-provider'

describe('conversation-runtime-provider', () => {
  it('本地 Agent provider 发送消息时写入用户消息并调用后端', async () => {
    const setInput = vi.fn()
    const addUserMessage = vi.fn()
    const addSystemMessage = vi.fn()
    const sendMessage = vi.fn().mockResolvedValue({ ok: true })
    const provider = createLocalAgentConversationProvider({
      conversationId: 'agent-1',
      isBusy: () => false,
      setInput,
      addUserMessage,
      addSystemMessage,
      cancelStreaming: vi.fn(),
      sendMessage,
      abortMessage: vi.fn(),
    })

    await expect(provider.send('  你好  ')).resolves.toBe(true)
    expect(setInput).toHaveBeenCalledWith('', 'agent-1')
    expect(addUserMessage).toHaveBeenCalledWith('你好', 'agent-1')
    expect(sendMessage).toHaveBeenCalledWith('agent-1', '你好')
    expect(addSystemMessage).not.toHaveBeenCalled()
  })

  it('本地 Agent provider 忙碌或空消息时跳过发送', async () => {
    const sendMessage = vi.fn()
    const provider = createLocalAgentConversationProvider({
      conversationId: 'agent-1',
      isBusy: () => true,
      setInput: vi.fn(),
      addUserMessage: vi.fn(),
      addSystemMessage: vi.fn(),
      cancelStreaming: vi.fn(),
      sendMessage,
      abortMessage: vi.fn(),
    })

    await expect(provider.send('hello')).resolves.toBe(false)
    await expect(provider.send('   ')).resolves.toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('本地 Agent provider 发送失败时写系统消息', async () => {
    const addSystemMessage = vi.fn()
    const provider = createLocalAgentConversationProvider({
      conversationId: 'agent-1',
      isBusy: () => false,
      setInput: vi.fn(),
      addUserMessage: vi.fn(),
      addSystemMessage,
      cancelStreaming: vi.fn(),
      sendMessage: vi.fn().mockRejectedValue(new Error('boom')),
      abortMessage: vi.fn(),
    })

    await expect(provider.send('hello')).resolves.toBe(false)
    expect(addSystemMessage).toHaveBeenCalledWith('发送失败: Error: boom', 'agent-1')
  })

  it('本地 Agent provider 中止时调用后端并写系统消息', async () => {
    const cancelStreaming = vi.fn()
    const addSystemMessage = vi.fn()
    const abortMessage = vi.fn().mockResolvedValue(undefined)
    const provider = createLocalAgentConversationProvider({
      conversationId: 'agent-1',
      isBusy: () => false,
      setInput: vi.fn(),
      addUserMessage: vi.fn(),
      addSystemMessage,
      cancelStreaming,
      sendMessage: vi.fn(),
      abortMessage,
    })

    await expect(provider.abort?.()).resolves.toBe(true)
    expect(abortMessage).toHaveBeenCalledWith('agent-1')
    expect(cancelStreaming).toHaveBeenCalledWith('agent-1')
    expect(addSystemMessage).toHaveBeenCalledWith('已手动中止当前任务', 'agent-1')
  })

})
