import { afterEach, expect, it, vi } from 'vitest'
import { grantSkip, research } from './research-work'
import { folderKey, freshResearch, localSourceUrl } from './research-model'
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
  useAgentStore: { getState: () => ({ conversations: { main: { messages } } }) },
}))

const id = '44444444-4444-4444-8444-444444444444'
const grant = '33333333-3333-4333-8333-333333333333'
const fileGrant = '55555555-5555-4555-8555-555555555555'
const notes = folderKey(grant)
const repo = 'lowRISC/ibex'
const gh = 'https://github.com/lowRISC/ibex/blob/' + '1'.repeat(40) + '/rtl/ibex_if_stage.sv'
const decoder = '~/docs/ibex-review/decoder.md'

function setup() {
  items.push({
    id,
    title: '对比设计笔记和 Ibex',
    goal: '对比我本地的设计笔记和 Ibex 的实现',
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
        repos: [repo],
        folders: [{ key: notes, label: 'chip-notes' }],
        scope: '笔记中的设计假设',
        output: '对比简报',
        outcomes: [{ text: '每条设计假设都对照到实现', required: true }],
      },
      docs: [
        {
          repo: notes,
          path: 'pipeline.md',
          startLine: 1,
          text: '取指使用两级预取缓冲。\n译码细节见 ~/docs/ibex-review/decoder.md',
          url: localSourceUrl(grant, 'pipeline.md'),
          sha: 'b'.repeat(64),
          at: 1,
        },
        {
          repo,
          path: 'rtl/ibex_if_stage.sv',
          startLine: 200,
          text: 'ibex_prefetch_buffer prefetch_buffer_i (',
          url: gh,
          sha: 'a'.repeat(40),
          at: 1,
        },
      ],
    },
  })
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    cclinkStudio: {
      ownerResearch: { readFile: vi.fn(), findPaths: vi.fn() },
      ownerSources: {
        find: vi.fn(),
        excerpt: vi.fn(),
        requestFile: vi.fn(async () => ({
          ok: false,
          outcome: 'timeout',
          label: decoder,
          error: '60 秒无回应，已跳过',
        })),
        grantFile: vi.fn(async () => ({ ok: true, key: 'file:' + fileGrant, label: decoder })),
        fileExcerpt: vi.fn(async () => ({
          ok: true,
          repo: 'file:' + fileGrant,
          url: localSourceUrl(fileGrant, 'decoder.md'),
          sha: 'c'.repeat(64),
          at: 2,
          startLine: 1,
          text: '译码器在单个周期内完成。',
        })),
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
  return { status: 'accepted', runId: 'main-run-' + messages.length }
}
const base = [
  { repo: notes, finding: '笔记假设两级预取', quote: '取指使用两级预取缓冲' },
  { repo, url: gh, finding: '实现有预取缓冲', quote: 'ibex_prefetch_buffer prefetch_buffer_i' },
]
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  items.length = messages.length = 0
  send.mockReset()
})

it('skips an unanswered file request, keeps going and holds delivery while it is required', async () => {
  setup()
  send.mockImplementationOnce((task) =>
    respond(task, { action: 'read', reason: '笔记引用了译码文档', files: [decoder] }),
  )
  send.mockImplementationOnce((task) => {
    const skip = /"skipped":\[\{"id":"([^"]+)"/.exec(task)?.[1]
    return respond(task, {
      action: 'deliver',
      reason: '假设 1–3 已核对',
      conclusion: '# 对比',
      items: base,
      skips: [{ id: skip, required: true, affects: '假设 4、5' }],
    })
  })
  const job = research(id)
  await vi.advanceTimersByTimeAsync(3000)
  await job
  const sources = vi.mocked(window.cclinkStudio.ownerSources)
  expect(sources.requestFile).toHaveBeenCalledWith(id, 'owner-' + id + '-a', decoder)
  const r = items[0].research!
  expect(items[0].issue).toBe('')
  expect(r.phase).toBe('decide')
  expect(r.report).toBeNull()
  expect(r.draft?.items).toHaveLength(2)
  expect(r.skips).toMatchObject([
    { path: decoder, why: 'timeout', status: 'skipped', required: true, affects: '假设 4、5' },
  ])
  expect(r.log.some((l) => l.includes('已跳过读取') && l.includes('其余步骤继续'))).toBe(true)
  expect(r.decisions?.some((d) => d.kind === 'deliver')).toBe(false)

  // The user allows that one file afterwards: only the skipped read runs, then Owner re-checks.
  send.mockImplementationOnce((task) => {
    expect(task).toContain('这是补查')
    return respond(task, {
      action: 'deliver',
      reason: '五条假设都有依据',
      conclusion: '# 对比',
      items: [
        ...base,
        { repo: 'file:' + fileGrant, finding: '笔记说译码单周期', quote: '译码器在单个周期内完成' },
      ],
    })
  })
  const rerun = grantSkip(id, r.skips![0].id)
  await vi.advanceTimersByTimeAsync(3000)
  await rerun
  expect(sources.grantFile).toHaveBeenCalledWith(id, decoder)
  expect(sources.fileExcerpt).toHaveBeenCalledTimes(1)
  expect(sources.requestFile).toHaveBeenCalledTimes(1)
  expect(sources.find).not.toHaveBeenCalled()
  expect(sources.excerpt).not.toHaveBeenCalled()
  expect(window.cclinkStudio.ownerResearch.readFile).not.toHaveBeenCalled()
  expect(send).toHaveBeenCalledTimes(3)
  const done = items[0].research!
  expect(done.phase).toBe('done')
  expect(done.draft).toBeNull()
  expect(done.report?.items).toHaveLength(3)
  expect(done.report?.items[2]).toMatchObject({ repo: 'file:' + fileGrant, line: 1 })
  expect(done.skips).toMatchObject([{ status: 'read' }])
  expect(done.files).toEqual([{ key: 'file:' + fileGrant, label: decoder }])
  expect(done.docs).toHaveLength(3)
})

it('delivers with an optional skip and refuses delivery until every new skip is judged', async () => {
  setup()
  items[0].research!.plan!.outcomes = [
    { text: '每条设计假设都对照到实现', required: true },
    { text: '附上历史笔记背景', required: false },
  ]
  send.mockImplementationOnce((task) =>
    respond(task, { action: 'read', reason: '旧笔记', files: [decoder] }),
  )
  send.mockImplementationOnce((task) =>
    respond(task, { action: 'deliver', reason: '够了', conclusion: '# 对比', items: base }),
  )
  send.mockImplementationOnce((task) => {
    expect(task).toContain('交付前须对每个被跳过的步骤给出 skips 判断')
    const skip = /"skipped":\[\{"id":"([^"]+)"/.exec(task)?.[1]
    return respond(task, {
      action: 'deliver',
      reason: '够了',
      conclusion: '# 对比',
      items: base,
      skips: [{ id: skip, required: false, affects: '历史背景' }],
    })
  })
  const job = research(id)
  await vi.advanceTimersByTimeAsync(4000)
  await job
  const r = items[0].research!
  expect(r.phase).toBe('done')
  expect(r.skips).toMatchObject([{ status: 'skipped', required: false }])
})
