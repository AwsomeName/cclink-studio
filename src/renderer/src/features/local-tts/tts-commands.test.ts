import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  conversations: {},
  activeWorkspaceRef: { kind: 'local', path: '/a' },
}))
vi.mock('../../stores/workspace-store', () => ({
  useWorkspaceStore: { getState: () => ({ activeWorkspaceRef: mocks.activeWorkspaceRef }) },
}))
vi.mock('../../stores/agent-store', () => ({
  useAgentStore: { getState: () => ({ conversations: mocks.conversations }) },
}))
vi.mock('../../stores/tab-store', () => ({ useTabStore: { getState: vi.fn() } }))
vi.mock('../../stores/editor-store', () => ({ useEditorStore: { getState: vi.fn() } }))
vi.mock('../../stores/command-store', () => ({ useCommandStore: { getState: vi.fn() } }))
vi.mock('../../components/common/Toast', () => ({ useToastStore: { getState: vi.fn() } }))
vi.mock('../context-actions/editor-context-surface', () => ({ getEditorContextSurface: vi.fn() }))
vi.mock('./tts-controller', () => ({ startTts: mocks.start, useTtsStore: { setState: vi.fn() } }))
import { createTtsCommands } from './tts-commands'
beforeEach(() => vi.clearAllMocks())
describe('displayed message speech', () => {
  it('reads a completed message snapshot even when absent from the local store', async () => {
    const read = createTtsCommands().find((c) => c.id === 'tts.read')!
    await read.action({
      source: 'toolbar',
      inputValue: '远程消息的可见正文',
      target: {
        kind: 'message',
        workspaceKey: '/a',
        conversationId: 'remote-session',
        messageId: 'm',
      },
    })
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '远程消息的可见正文',
        source: expect.objectContaining({ kind: 'message', workspaceKey: '/a', messageId: 'm' }),
      }),
    )
  })
  it('still rejects a message snapshot from a workspace that was switched away', () => {
    const read = createTtsCommands().find((c) => c.id === 'tts.read')!
    expect(() =>
      read.action({
        source: 'toolbar',
        inputValue: '旧正文',
        target: {
          kind: 'message',
          workspaceKey: '/old',
          conversationId: 'remote-session',
          messageId: 'm',
        },
      }),
    ).toThrow('工作空间已切换')
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
