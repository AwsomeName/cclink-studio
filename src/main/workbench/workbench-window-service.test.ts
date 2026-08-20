import { describe, expect, it } from 'vitest'
import { WorkbenchWindowService, WorkbenchWindowTransitionError } from './workbench-window-service'

describe('WorkbenchWindowService', () => {
  it('keeps a ready window workspace current without changing its generation', () => {
    const service = new WorkbenchWindowService()
    const registered = service.registerWindow({
      windowId: 'main',
      role: 'main',
      workspaceKey: null,
      state: 'ready',
    })
    const updated = service.updateWindowWorkspace('main', '/workspace/a')
    expect(updated.workspaceKey).toBe('/workspace/a')
    expect(updated.generation).toBe(registered.generation)
  })

  it('commits one Browser placement through a ready target generation', () => {
    const service = setup()
    service.registerWindow({
      windowId: 'aux-1',
      role: 'auxiliary',
      workspaceKey: '/workspace-a',
    })
    const transfer = service.beginTransfer({
      tabId: 'browser-1',
      sourceWindowId: 'main',
      targetWindowId: 'aux-1',
      expectedGeneration: 1,
      direction: 'move',
    })

    expect(transfer.state).toBe('preparing')
    service.markWindowReady('aux-1')
    expect(service.getTransfer(transfer.transferId)?.state).toBe('target-ready')
    expect(service.commitTransfer(transfer.transferId)).toMatchObject({
      tabId: 'browser-1',
      windowId: 'aux-1',
      generation: 2,
      state: 'attached',
    })
    expect(service.getWindow('main')?.orderedTabIds).toEqual([])
    expect(service.getWindow('aux-1')?.orderedTabIds).toEqual(['browser-1'])
  })

  it('rolls back before commit without decreasing the generation', () => {
    const service = setup()
    service.registerWindow({
      windowId: 'aux-1',
      role: 'auxiliary',
      workspaceKey: '/workspace-a',
      state: 'ready',
    })
    const transfer = service.beginTransfer({
      tabId: 'browser-1',
      sourceWindowId: 'main',
      targetWindowId: 'aux-1',
      expectedGeneration: 1,
      direction: 'move',
    })

    expect(service.rollbackTransfer(transfer.transferId)).toMatchObject({
      windowId: 'main',
      generation: 2,
      state: 'attached',
    })
    expect(() =>
      service.beginTransfer({
        tabId: 'browser-1',
        sourceWindowId: 'main',
        targetWindowId: 'aux-1',
        expectedGeneration: 1,
        direction: 'move',
      }),
    ).toThrowError(WorkbenchWindowTransitionError)
  })

  it('requires a compensating transfer after commit', () => {
    const service = setup()
    service.registerWindow({
      windowId: 'aux-1',
      role: 'auxiliary',
      workspaceKey: '/workspace-a',
      state: 'ready',
    })
    const move = service.beginTransfer({
      tabId: 'browser-1',
      sourceWindowId: 'main',
      targetWindowId: 'aux-1',
      expectedGeneration: 1,
      direction: 'move',
    })
    service.commitTransfer(move.transferId)

    expect(() => service.rollbackTransfer(move.transferId)).toThrow(
      '已 commit 的迁移必须创建补偿 transaction',
    )
    const returning = service.beginTransfer({
      tabId: 'browser-1',
      sourceWindowId: 'aux-1',
      targetWindowId: 'main',
      expectedGeneration: 2,
      direction: 'return',
    })
    expect(service.commitTransfer(returning.transferId)).toMatchObject({
      windowId: 'main',
      generation: 3,
    })
  })

  it('enters an explicit recovery placement when source and target are unavailable', () => {
    const service = setup()
    service.registerWindow({
      windowId: 'aux-1',
      role: 'auxiliary',
      workspaceKey: '/workspace-a',
    })
    const transfer = service.beginTransfer({
      tabId: 'browser-1',
      sourceWindowId: 'main',
      targetWindowId: 'aux-1',
      expectedGeneration: 1,
      direction: 'move',
    })
    service.closeWindow('main', true)
    service.closeWindow('aux-1', true)

    expect(() => service.rollbackTransfer(transfer.transferId)).toThrow('窗口未就绪')
    expect(service.enterRecovery(transfer.transferId)).toMatchObject({
      windowId: 'recovery:browser-1',
      state: 'recovering',
      generation: 2,
    })
    service.registerWindow({
      windowId: 'main',
      role: 'main',
      workspaceKey: '/workspace-a',
      state: 'ready',
    })
    expect(service.restoreRecovery('browser-1', 'main')).toMatchObject({
      windowId: 'main',
      state: 'attached',
      generation: 3,
    })
  })

  it('recovers a committed placement after its auxiliary window is lost', () => {
    const service = setup()
    service.registerWindow({
      windowId: 'aux-1',
      role: 'auxiliary',
      workspaceKey: '/workspace-a',
      state: 'ready',
    })
    const move = service.beginTransfer({
      tabId: 'browser-1',
      sourceWindowId: 'main',
      targetWindowId: 'aux-1',
      expectedGeneration: 1,
      direction: 'move',
    })
    service.commitTransfer(move.transferId)
    service.closeWindow('aux-1', true)

    expect(service.recoverPlacementAfterWindowLoss('browser-1', 'aux-1')).toMatchObject({
      windowId: 'recovery:browser-1',
      state: 'recovering',
      generation: 3,
    })
    expect(service.restoreRecovery('browser-1', 'main')).toMatchObject({
      windowId: 'main',
      state: 'attached',
      generation: 4,
    })
  })

  it('rejects stale generations, wrong sources, and concurrent transfers', () => {
    const service = setup()
    service.registerWindow({
      windowId: 'aux-1',
      role: 'auxiliary',
      workspaceKey: '/workspace-a',
      state: 'ready',
    })
    expect(() =>
      service.beginTransfer({
        tabId: 'browser-1',
        sourceWindowId: 'aux-1',
        targetWindowId: 'main',
        expectedGeneration: 1,
        direction: 'move',
      }),
    ).toThrow('Tab 不属于 source window')
    expect(() =>
      service.beginTransfer({
        tabId: 'browser-1',
        sourceWindowId: 'main',
        targetWindowId: 'aux-1',
        expectedGeneration: 0,
        direction: 'move',
      }),
    ).toThrow('generation 已过期')
    service.beginTransfer({
      tabId: 'browser-1',
      sourceWindowId: 'main',
      targetWindowId: 'aux-1',
      expectedGeneration: 1,
      direction: 'move',
    })
    expect(() =>
      service.beginTransfer({
        tabId: 'browser-1',
        sourceWindowId: 'main',
        targetWindowId: 'aux-1',
        expectedGeneration: 2,
        direction: 'move',
      }),
    ).toThrow('Tab 正在迁移')
  })
})

function setup(): WorkbenchWindowService {
  const service = new WorkbenchWindowService()
  service.registerWindow({
    windowId: 'main',
    role: 'main',
    workspaceKey: '/workspace-a',
    state: 'ready',
  })
  service.seedPlacement({
    tabId: 'browser-1',
    workspaceKey: '/workspace-a',
    windowId: 'main',
    active: true,
  })
  return service
}
