import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectWorkspaceWork } from './workspace-work'
afterEach(() => vi.unstubAllGlobals())
describe('workspace work projection', () => {
  it('retains waiting and interrupted work, excludes completed and other workspace terminals', async () => {
    vi.stubGlobal('window', {
      cclinkStudio: {
        scheduledTasks: {
          inspect: vi.fn().mockResolvedValue({
            success: true,
            tasks: [
              {
                definition: { id: 'interrupted' },
                activation: { enabled: false },
                latestRun: { status: 'interrupted' },
              },
              {
                definition: { id: 'completed' },
                activation: { enabled: false },
                latestRun: { status: 'succeeded' },
              },
            ],
          }),
        },
        webAffairs: {
          getSnapshot: vi.fn().mockResolvedValue({
            success: true,
            data: {
              affairs: [
                { id: 'waiting', status: 'needs-attention' },
                { id: 'done', status: 'completed' },
              ],
            },
          }),
        },
        terminal: {
          listSessions: vi.fn().mockResolvedValue([
            {
              sessionId: 'here',
              runtime: { workspaceRef: { kind: 'local', path: '/a' } },
              status: 'running',
            },
            {
              sessionId: 'elsewhere',
              runtime: { workspaceRef: { kind: 'local', path: '/b' } },
              status: 'running',
            },
          ]),
        },
      },
    })
    const work = await inspectWorkspaceWork('/a')
    expect(work.tasks.map((t) => t.definition.id)).toEqual(['interrupted'])
    expect(work.affairs.map((a) => a.id)).toEqual(['waiting'])
    expect(work.terminals.map((t) => t.sessionId)).toEqual(['here'])
    expect(work.errors).toEqual([])
  })
  it('reports each unavailable owner instead of declaring idle', async () => {
    vi.stubGlobal('window', {
      cclinkStudio: {
        scheduledTasks: { inspect: vi.fn().mockRejectedValue(new Error('offline')) },
        webAffairs: { getSnapshot: vi.fn().mockResolvedValue({ success: false }) },
        terminal: { listSessions: vi.fn().mockRejectedValue(new Error('offline')) },
      },
    })
    expect((await inspectWorkspaceWork('/a')).errors).toHaveLength(3)
  })
})
