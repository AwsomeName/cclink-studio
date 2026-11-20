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
vi.mock('./owner-agent', () => ({
  ensureSession: (_a: Affair, mode: string) => mode,
  session: (_a: Affair, mode: string) => mode,
}))
vi.mock('../agent-conversations/conversation-run-controller', () => ({
  createConversationRunController: () => ({ send }),
}))
vi.mock('../../stores/agent-store', () => ({
  useAgentStore: { getState: () => ({ conversations: { main: { messages }, a: { messages } } }) },
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
      ownerResearch: { readFile: vi.fn(), findPaths: vi.fn() },
      agent: {
        getStatus: async () => ({ busy: true }),
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

it.each(['matching receipt', 'saved file selection'] as const)(
  'resumes the original A from its %s',
  async (stage) => {
    setup()
    const repo = 'lowRISC/ibex',
      ticket = crypto.randomUUID()
    const files = [{ repo, path: '@README', purpose: '查定位' }]
    const saved = stage === 'saved file selection'
    items[0].research!.decisions = [
      {
        kind: 'read',
        reason: '核对定位',
        requests: [{ repo, terms: [] }],
        workerRunId: 'original-A',
        workerTicket: ticket,
        ...(saved && {
          workerReturned: true,
          workerFiles: [{ repo, path: 'rtl/already.sv', purpose: '已处理' }, ...files],
          filesProcessed: 1,
        }),
      },
    ]
    if (!saved) {
      for (const reply of [
        { ticket, files },
        { ticket: crypto.randomUUID(), files: [] },
      ])
        messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify(reply) }],
        })
    }
    const read = vi.mocked(window.cclinkStudio.ownerResearch.readFile)
    read.mockResolvedValue({
      ok: true,
      repo,
      sha: '1'.repeat(40),
      at: 1,
      url: 'https://example.org/ibex',
      startLine: 1,
      text: 'Ibex CPU',
    })
    send.mockImplementationOnce((task) =>
      respond(task, { action: 'blocked', reason: '还缺判断依据' }),
    )
    const job = research('affair')
    await vi.advanceTimersByTimeAsync(2500)
    await job
    expect(read.mock.calls).toEqual([[repo, '@README', '', '']])
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toContain('你是本事务 Owner')
    expect(items[0].research!.docs[0].text).toBe('Ibex CPU')
    expect(items[0].research!.decisions).toMatchObject([
      { workerRunId: 'original-A', collectionClosed: true, filesProcessed: saved ? 2 : 1 },
    ])
  },
)

it('does not redispatch an unacknowledged A or allow reassignment while A is busy', async () => {
  setup()
  items[0].research!.decisions = [
    {
      kind: 'read',
      reason: '查原文',
      workerTicket: crypto.randomUUID(),
      requests: [{ repo: 'lowRISC/ibex', terms: [] }],
    },
  ]
  await research('affair')
  expect(items[0].issue).toContain('未重派')
  await research('affair', true)
  expect(items[0].issue).toContain('仍在执行')
  expect(items[0].research!.decisions![0].collectionClosed).toBeUndefined()
  expect(send).not.toHaveBeenCalled()
})

it('requires an explicit decision for an interrupted legacy order without a matching receipt key', async () => {
  setup()
  items[0].research!.decisions = [
    {
      kind: 'read',
      reason: '旧委托',
      workerReturned: true,
      workerRunId: 'legacy-A',
      requests: [{ repo: 'lowRISC/ibex', terms: [] }],
    },
  ]
  await research('affair')
  expect(items[0].issue).toContain('无法唯一核对')
  expect(send).not.toHaveBeenCalled()
})
