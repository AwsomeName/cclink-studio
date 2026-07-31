import { describe, expect, it } from 'vitest'
import { webAffairsIpcContracts } from './web-affair-contract'

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
})

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected action to throw')
}
