import { afterEach, expect, it, vi } from 'vitest'
import type { Affair } from './affair'
import { freshResearch } from './research-model'
import {
  keepUnacknowledged,
  retryDirectory,
  hasDirectoryConflict,
  useSavedDirectory,
  useOwners,
} from './owner-store'

afterEach(() => vi.unstubAllGlobals())

it.each([false, true])(
  'recovers a lost IPC reply when the save already committed is %s',
  async (committed) => {
    const id = crypto.randomUUID()
    const candidate: Affair = {
      id,
      title: 'Ibex',
      goal: 'RTL',
      confirmed: true,
      sources: [],
      updated: 1,
      attempt: null,
      run: null,
      issue: '',
      result: null,
      method: null,
      research: {
        ...freshResearch(),
        phase: 'done',
        report: {
          conclusion: '# 入门卡',
          items: [{ repo: 'lowRISC/ibex', quote: 'q <= d;', finding: '寄存器采样' }],
        },
      },
      directory: { path: '/example', revision: 4, files: [] },
    }
    const final = { ...candidate, updated: 2, directory: { ...candidate.directory!, revision: 5 } }
    const old = {
      ...candidate,
      research: { ...candidate.research!, phase: 'checking', report: null },
    }
    const save = vi.fn().mockResolvedValue(final)
    const api = { retry: vi.fn().mockResolvedValue(committed ? final : old), save }
    vi.stubGlobal('window', { cclinkStudio: { ownerDirectories: api } })
    expect(keepUnacknowledged(candidate, '失去回执').research).toEqual(candidate.research)
    expect(await retryDirectory(id)).toEqual(final)
    expect(save).toHaveBeenCalledTimes(committed ? 0 : 1)
    if (!committed) expect(save).toHaveBeenCalledWith(candidate, 4)
  },
)

it('keeps divergent writes until the user chooses the committed directory version', async () => {
  const id = crypto.randomUUID()
  const draft: Affair = {
    id,
    title: 'Ibex',
    goal: '查 RTL',
    sources: [],
    confirmed: false,
    updated: 1,
    attempt: null,
    run: null,
    issue: '',
    result: null,
    method: null,
    research: freshResearch(),
    directory: { path: '/sample', revision: 1, files: [] },
  }
  const latest = { ...draft, goal: '新版本', directory: { ...draft.directory!, revision: 2 } }
  const save = vi.fn()
  vi.stubGlobal('window', {
    cclinkStudio: {
      ownerDirectories: {
        save,
        retry: async () => latest,
        list: async () => ({ items: [latest], errors: [] }),
      },
    },
  })
  keepUnacknowledged(draft, '保存回执丢失')
  await expect(retryDirectory(id)).rejects.toThrow('另一版本')
  expect(hasDirectoryConflict(id)).toBe(true)
  expect(useOwners.getState().items.find((a) => a.id === id)?.goal).toBe('查 RTL')
  expect(await useSavedDirectory(id)).toEqual(latest)
  expect(hasDirectoryConflict(id)).toBe(false)
  expect(save).not.toHaveBeenCalled()
})
