import { afterEach, expect, it, vi } from 'vitest'
import { research } from './research-work'
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
  prepareSession: async (_a: Affair, mode: string) => ({ id: mode }),
  session: (a: Affair, mode: string) => 'owner-' + a.id + '-' + mode,
}))
vi.mock('../agent-conversations/conversation-run-controller', () => ({
  createConversationRunController: () => ({ send }),
}))
vi.mock('../../stores/agent-store', () => ({
  useAgentStore: {
    getState: () => ({ conversations: { main: { messages }, a: { messages } } }),
  },
}))

const id = '66666666-6666-4666-8666-666666666666'
const pulse = 'https://github.com/lowRISC/ibex/pulse'
const forum = 'https://forum.example.org/t/ibex-vs-picorv32'
const quote = '过去一个月合并了 23 个拉取请求'

function setup() {
  items.push({
    id,
    title: '对比 Ibex 和 PicoRV32',
    goal: '对比 Ibex 和 PicoRV32 的社区评价和维护状况',
    sources: [],
    confirmed: true,
    updated: 1,
    issue: '',
    run: null,
    attempt: null,
    method: null,
    result: null,
    research: {
      ...freshResearch(),
      phase: 'checking',
      plan: {
        repos: [],
        scope: '维护活跃度与社区评价',
        output: '对比简报',
        web: { limit: 2 },
      },
    },
  })
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    cclinkStudio: {
      ownerResearch: { readFile: vi.fn(), findPaths: vi.fn() },
      ownerSources: { find: vi.fn(), excerpt: vi.fn(), requestFile: vi.fn() },
      ownerWeb: {
        status: vi.fn(async () => ({ ready: true })),
        search: vi.fn(async () => ({
          ok: true,
          hits: [
            { url: pulse, title: 'lowRISC/ibex · Pulse', snippet: '活跃度' },
            { url: forum, title: 'Ibex vs PicoRV32', snippet: '讨论' },
          ],
        })),
        fetch: vi.fn(async () => ({
          ok: true,
          repo: 'web',
          url: pulse,
          title: 'lowRISC/ibex · Pulse',
          sha: 'd'.repeat(64),
          text: '本月概况：\n' + quote + '，关闭了 17 个问题。',
          startLine: 1,
          chars: 40,
          truncated: false,
          at: 3,
        })),
        more: vi.fn(async () => 'timeout'),
      },
      agent: {
        getStatus: async () => ({ busy: false }),
        getRunStatus: async (conversationId: string, runId: string) => ({
          conversationId,
          runId,
          status: 'succeeded',
        }),
      },
    },
  })
}
function respond(task: string, data: Record<string, unknown>) {
  const ticket = /ticket="([^"]+)"/.exec(task)?.[1]
  messages.push({
    role: 'assistant',
    content: [{ type: 'text', text: JSON.stringify({ ...data, ticket }) }],
  })
  return { status: 'accepted', runId: 'run-' + messages.length }
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  items.length = messages.length = 0
  send.mockReset()
})

it('searches and archives pages through Studio, stops at the cap without an answer, and cites the snapshot', async () => {
  setup()
  send.mockImplementationOnce((task) => {
    expect(task).toContain('"webBudget":2')
    return respond(task, {
      action: 'read',
      reason: '先看维护活跃度',
      requests: [{ repo: 'web', terms: ['Ibex', 'maintenance'] }],
      worker: { new: '查两项目的网页资料' },
      workerReason: '独立的问题',
      ask: 'Ibex 最近是否活跃',
      deliverable: '带出处的活跃度说明',
      doneWhen: '有一条存档网页说明近期合并情况',
    })
  })
  send.mockImplementationOnce((task) => {
    expect(task).toContain('webResults')
    return respond(task, {
      files: [
        { repo: 'web', path: pulse, anchor: '合并', purpose: '近期合并' },
        { repo: 'web', path: forum, anchor: '', purpose: '社区评价' },
      ],
    })
  })
  send.mockImplementationOnce((task) => {
    expect(task).toContain('"webBudget":0')
    return respond(task, {
      action: 'deliver',
      reason: '活跃度有存档网页支持',
      conclusion: '# 对比',
      verdict: { met: true, note: '有存档网页' },
      items: [{ repo: 'web', url: pulse, finding: 'Ibex 近期活跃', quote }],
    })
  })
  const job = research(id)
  await vi.advanceTimersByTimeAsync(5000)
  await job
  const web = vi.mocked(window.cclinkStudio.ownerWeb)
  expect(web.search).toHaveBeenCalledWith(id, 'Ibex maintenance')
  expect(web.fetch).toHaveBeenCalledTimes(1)
  expect(web.more).toHaveBeenCalledWith(id, 'owner-' + id + '-a', 2, 2)
  const r = items[0].research!
  expect(r.web).toMatchObject({ used: 2, extra: 0, stopped: true })
  expect(r.web?.searches).toMatchObject([{ q: 'Ibex maintenance', hits: 2 }])
  expect(r.web?.pages).toMatchObject([{ url: pulse, sha: 'd'.repeat(64) }])
  expect(r.docs).toMatchObject([{ repo: 'web', path: 'github.com/lowRISC/ibex/pulse', url: pulse }])
  expect(r.log.some((l) => l.includes('60 秒无回应') && l.includes('停止联网'))).toBe(true)
  expect(r.phase).toBe('done')
  expect(r.report?.items).toMatchObject([{ repo: 'web', url: pulse, line: 2 }])
})
