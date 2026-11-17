import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  conversations: {},
  tabs: { activeTabId: 'web', tabs: [{ id: 'web', type: 'browser', title: 'Article' }] },
  open: true,
  activeView: vi.fn(),
  activeWorkspaceRef: { kind: 'local', path: '/a' },
}))
vi.mock('../../stores/workspace-store', () => ({
  useWorkspaceStore: { getState: () => ({ activeWorkspaceRef: mocks.activeWorkspaceRef }) },
}))
vi.mock('../../stores/agent-store', () => ({
  useAgentStore: { getState: () => ({ conversations: mocks.conversations }) },
}))
vi.mock('../../stores/tab-store', () => ({ useTabStore: { getState: () => mocks.tabs } }))
vi.mock('../../stores/editor-store', () => ({ useEditorStore: { getState: vi.fn() } }))
vi.mock('../../stores/command-store', () => ({ useCommandStore: { getState: vi.fn() } }))
vi.mock('../../components/common/Toast', () => ({ useToastStore: { getState: vi.fn() } }))
vi.mock('../context-actions/editor-context-surface', () => ({ getEditorContextSurface: vi.fn() }))
vi.mock('./tts-controller', () => ({
  startTts: mocks.start,
  useTtsStore: { getState: () => ({ open: mocks.open }), setState: vi.fn() },
}))
import { createTtsCommands } from './tts-commands'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.tabs.activeTabId = 'web'
  mocks.open = true
  vi.stubGlobal('window', { cclinkStudio: { browser: { getActiveViewId: mocks.activeView } } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
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
  it('still rejects a message snapshot from a workspace that was switched away', async () => {
    const read = createTtsCommands().find((c) => c.id === 'tts.read')!
    await expect(
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
    ).rejects.toThrow('工作空间已切换')
    expect(mocks.start).not.toHaveBeenCalled()
  })
})

describe('bottom player browser restoration', () => {
  it('waits for the native view to return before starting selection speech', async () => {
    vi.useFakeTimers()
    mocks.activeView.mockResolvedValueOnce(null).mockResolvedValue('web')
    const pending = createTtsCommands()
      .find((c) => c.id === 'tts.readSelection')!
      .action()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    await pending
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ tabId: 'web', selection: true }),
      }),
    )
  })
  it('rejects a tab change while waiting for the native reply', async () => {
    mocks.activeView.mockImplementationOnce(async () => {
      mocks.tabs.activeTabId = 'other'
      return 'web'
    })
    await expect(
      createTtsCommands()
        .find((c) => c.id === 'tts.read')!
        .action(),
    ).rejects.toThrow('已切换')
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('times out without starting speech when the view stays hidden', async () => {
    vi.useFakeTimers()
    mocks.activeView.mockResolvedValue(null)
    const pending = expect(
      createTtsCommands()
        .find((c) => c.id === 'tts.read')!
        .action(),
    ).rejects.toThrow('尚未恢复显示')
    await vi.advanceTimersByTimeAsync(2500)
    await pending
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
