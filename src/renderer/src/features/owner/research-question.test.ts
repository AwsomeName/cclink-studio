import { afterEach, expect, it, vi } from 'vitest'
import { askOwner, research } from './research-work'
import { freshResearch } from './research-model'
import type { Affair } from './affair'

const { items, send, messages } = vi.hoisted(() => ({
  items: [] as Affair[],
  send: vi.fn(),
  messages: [] as { role: string; content: { type: string; text: string }[] }[],
}))
vi.mock('./owner-store', () => ({
  useOwners: {
    getState: () => ({
      items,
      save: (a: Affair) => {
        items[0] = a
        return true
      },
    }),
  },
}))
vi.mock('./owner-agent', () => ({ ensureSession: (_a: Affair, mode: string) => mode }))
vi.mock('../agent-conversations/conversation-run-controller', () => ({
  createConversationRunController: () => ({ send }),
}))
vi.mock('../../stores/agent-store', () => ({
  useAgentStore: { getState: () => ({ conversations: { main: { messages } } }) },
}))

function setup() {
  items.push({
    id: 'affair',
    title: '芯片',
    goal: '读 RTL',
    sources: [],
    confirmed: true,
    updated: 1,
    issue: '还缺源码',
    run: 'worker-run',
    attempt: null,
    method: null,
    result: null,
    research: {
      ...freshResearch(),
      phase: 'error',
      plan: { repos: ['lowRISC/ibex'], scope: '阅读', output: '入门卡' },
    },
  })
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    cclinkStudio: {
      agent: {
        getRunStatus: async (conversationId: string, runId: string) => ({
          conversationId,
          runId,
          status: 'succeeded',
        }),
      },
    },
  })
}
function respond(task: string, data: Record<string, string>) {
  const ticket = /ticket="([^"]+)"/.exec(task)?.[1]
  messages.push({
    role: 'assistant',
    content: [{ type: 'text', text: JSON.stringify({ ...data, ticket }) }],
  })
  return { status: 'accepted', runId: 'main-run' }
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  items.length = messages.length = 0
  send.mockReset()
})

it('keeps a failed question on its message and retries without changing the affair or A', async () => {
  setup()
  send.mockResolvedValueOnce({ status: 'failed', error: '答疑断线' })
  await askOwner('affair', '为什么要补查？')
  const first = items[0].research!.chat[0]
  expect(first.answerError).toContain('答疑断线')
  send.mockImplementationOnce((task) => respond(task, { reply: '需要定位赋值语句。' }))
  const retry = askOwner('affair', first.text, first.questionId)
  await askOwner('affair', first.text, first.questionId)
  await vi.advanceTimersByTimeAsync(800)
  await retry
  expect(items[0]).toMatchObject({
    run: 'worker-run',
    issue: '还缺源码',
    research: {
      phase: 'error',
      chat: [{ questionId: first.questionId, answer: '需要定位赋值语句。' }],
    },
  })
  expect(items[0].research!.chat[0].answerError).toBeUndefined()
  expect(send).toHaveBeenCalledTimes(2)
})

it('serializes a question with an in-flight Owner decision and keeps both receipts', async () => {
  setup()
  send.mockImplementationOnce((task) =>
    respond(task, { action: 'blocked', reason: '官方资料缺少时序定义' }),
  )
  send.mockImplementationOnce((task) => respond(task, { reply: '还需要时序依据。' }))
  const job = research('affair')
  await vi.advanceTimersByTimeAsync(1)
  const question = askOwner('affair', '当前依据是什么？')
  expect(send).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(2000)
  await Promise.all([job, question])
  expect(send).toHaveBeenCalledTimes(2)
  expect(items[0]).toMatchObject({
    issue: '官方资料缺少时序定义',
    research: {
      phase: 'error',
      chat: [{ answer: '还需要时序依据。' }],
    },
  })
})
