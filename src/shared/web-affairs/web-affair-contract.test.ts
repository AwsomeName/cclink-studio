import { describe, expect, it } from 'vitest'
import { webAffairsIpcContracts } from './web-affair-contract'
import { parseWebAffairSnapshot } from './web-affair-schema'

describe('web affairs IPC contract', () => {
  it('normalizes a bounded affair creation request', () => {
    expect(
      webAffairsIpcContracts.createAffair.parseArgs([
        {
          title: ' App 上架 ',
          objective: ' 提交审核并取得结果 ',
          principalId: '11111111-1111-4111-8111-111111111111',
          accountIds: [
            '22222222-2222-4222-8222-222222222222',
            '22222222-2222-4222-8222-222222222222',
          ],
          materialPaths: ['/tmp/license.png', '/tmp/license.png'],
          nodeTitles: [' 准备材料 ', ' 提交审核 '],
          workspaceRef: { kind: 'local', path: '/tmp/workspace' },
        },
      ]),
    ).toEqual([
      {
        title: 'App 上架',
        objective: '提交审核并取得结果',
        principalId: '11111111-1111-4111-8111-111111111111',
        accountIds: ['22222222-2222-4222-8222-222222222222'],
        materialPaths: ['/tmp/license.png'],
        nodeTitles: ['准备材料', '提交审核'],
        workspaceRef: { kind: 'local', path: '/tmp/workspace' },
      },
    ])
  })

  it('requires a result note when marking a node complete', async () => {
    const error = captureError(() =>
      webAffairsIpcContracts.updateNode.parseArgs([
        {
          affairId: '11111111-1111-4111-8111-111111111111',
          nodeId: '22222222-2222-4222-8222-222222222222',
          status: 'completed',
        },
      ]),
    )
    await expect(webAffairsIpcContracts.updateNode.mapParseError?.(error)).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_INPUT' },
    })
  })

  it('rejects extra arguments on every channel', () => {
    expect(() => webAffairsIpcContracts.getSnapshot.parseArgs(['extra'])).toThrow()
    expect(() => webAffairsIpcContracts.createAffair.parseArgs([])).toThrow()
    expect(() => webAffairsIpcContracts.updateNode.parseArgs([])).toThrow()
  })

  it('migrates a v1 snapshot without discarding affairs or historical nodes', () => {
    const now = new Date().toISOString()
    const migrated = parseWebAffairSnapshot({
      schemaVersion: 1,
      revision: 3,
      affairs: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: '旧事务',
          objective: '保留历史',
          status: 'active',
          principalId: '22222222-2222-4222-8222-222222222222',
          websiteIds: [],
          accountIds: [],
          materials: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              path: '/tmp/legacy.pdf',
              name: 'legacy.pdf',
              addedAt: now,
            },
          ],
          flow: {
            version: 1,
            nodes: [
              {
                id: '44444444-4444-4444-8444-444444444444',
                type: 'web-task',
                title: '旧节点',
                status: 'ready',
                executor: 'user',
                accountIds: [],
                materialIds: ['33333333-3333-4333-8333-333333333333'],
                successCriteria: ['有结果'],
                availableTransitions: ['completed'],
                createdAt: now,
                updatedAt: now,
              },
            ],
            edges: [],
          },
          events: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              type: 'created',
              summary: '已创建',
              occurredAt: now,
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    expect(migrated).toMatchObject({
      schemaVersion: 2,
      revision: 3,
      affairs: [
        {
          title: '旧事务',
          materials: [{ state: 'unchecked' }],
          attempts: [],
          waitPlans: [],
          flowProposals: [],
        },
      ],
    })
  })
})

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected action to throw')
}
