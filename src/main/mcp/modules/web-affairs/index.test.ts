import { describe, expect, it, vi } from 'vitest'
import { WebAffairToolModule } from '.'

describe('WebAffairToolModule', () => {
  it('projects one affair without exposing another state owner', async () => {
    const service = {
      getProjectSnapshot: vi.fn(() => ({
        success: true,
        data: {
          schemaVersion: 3,
          revision: 1,
          workspaceId: 'workspace-a-id',
          unassignedAffairCount: 0,
          affairs: [{ id: 'affair-1', title: '目标事务' }],
        },
      })),
    }
    const module = new WebAffairToolModule(service as never, async () => 'workspace-a-id')

    await expect(
      module.execute('web_affair_get', { affairId: 'affair-1' }, { workspaceKey: '/workspace/a' }),
    ).resolves.toEqual({ success: true, data: { id: 'affair-1', title: '目标事务' } })
    expect(service.getProjectSnapshot).toHaveBeenCalledWith('workspace-a-id')
  })

  it('stores AI flow changes as pending proposals instead of applying them directly', async () => {
    const proposeFlowDiff = vi.fn(async () => ({ success: true, data: { id: 'affair-1' } }))
    const module = new WebAffairToolModule(
      { proposeFlowDiff } as never,
      async () => 'workspace-a-id',
    )
    const operations = [
      {
        kind: 'add-node',
        tempId: 'extra',
        title: '补正',
        nodeType: 'human-task',
        executor: 'user',
      },
    ]

    await module.execute(
      'web_affair_propose_flow_diff',
      {
        affairId: '11111111-1111-4111-8111-111111111111',
        baseVersion: 2,
        reason: '网页出现补正要求',
        operations,
        impacts: ['新增人工步骤'],
      },
      { workspaceKey: '/workspace/a' },
    )

    expect(proposeFlowDiff).toHaveBeenCalledWith(
      {
        workspaceRef: { kind: 'local', path: '/workspace/a' },
        affairId: '11111111-1111-4111-8111-111111111111',
        baseVersion: 2,
        reason: '网页出现补正要求',
        operations,
        impacts: ['新增人工步骤'],
        proposedBy: 'ai',
      },
      'workspace-a-id',
    )
  })

  it('rejects affair access when the Agent session has no local workspace', async () => {
    const getProjectSnapshot = vi.fn()
    const module = new WebAffairToolModule({ getProjectSnapshot } as never, async () => null)

    await expect(module.execute('web_affair_get', { affairId: 'affair-1' })).resolves.toMatchObject(
      {
        success: false,
        error: { code: 'WORKSPACE_REQUIRED' },
      },
    )
    expect(getProjectSnapshot).not.toHaveBeenCalled()
  })
})
