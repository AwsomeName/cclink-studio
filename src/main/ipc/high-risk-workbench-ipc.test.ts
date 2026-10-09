import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerCadIpc } from '../cad/cad-ipc'
import { registerGitBackupIpc } from '../git-backup/git-backup-ipc'
import { registerHardwareIpc } from '../hardware/hardware-ipc'
import { registerProjectOpsIpc } from '../project-ops/project-ops-ipc'

describe('high-risk workbench IPC boundaries', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
  })

  it('checks sender trust before project writes', () => {
    const projectOps = { createAccountsTemplate: vi.fn() }
    registerProjectOpsIpc(projectOps as never, createGuard('trusted') as never)

    expect(() =>
      mockIpcMain.handlers.get('projectOps:createAccountsTemplate')?.(
        { sender: 'other' },
        '/tmp/project',
      ),
    ).toThrow('untrusted')
    expect(projectOps.createAccountsTemplate).not.toHaveBeenCalled()
  })

  it('rejects relative paths before project, Git, CAD, or hardware services run', () => {
    const projectOps = { getAccounts: vi.fn() }
    const gitBackup = { getProjectStatus: vi.fn() }
    const cad = { inspectModel: vi.fn() }
    const hardware = { scanWorkspace: vi.fn() }
    const guard = createGuard('trusted')
    registerProjectOpsIpc(projectOps as never, guard as never)
    registerGitBackupIpc(gitBackup as never, guard as never)
    registerCadIpc(cad as never, {} as never, guard as never)
    registerHardwareIpc(hardware as never, guard as never)

    const event = { sender: 'trusted' }
    expect(() =>
      mockIpcMain.handlers.get('projectOps:getAccounts')?.(event, '../project'),
    ).toThrow()
    expect(() =>
      mockIpcMain.handlers.get('gitBackup:getProjectStatus')?.(event, '../project'),
    ).toThrow()
    expect(() => mockIpcMain.handlers.get('cad:inspectModel')?.(event, 'part.step')).toThrow()
    expect(() => mockIpcMain.handlers.get('hardware:scanWorkspace')?.(event, 'project')).toThrow()

    expect(projectOps.getAccounts).not.toHaveBeenCalled()
    expect(gitBackup.getProjectStatus).not.toHaveBeenCalled()
    expect(cad.inspectModel).not.toHaveBeenCalled()
    expect(hardware.scanWorkspace).not.toHaveBeenCalled()
  })

  it('rejects Gerber archive traversal before reading package content', () => {
    const hardware = { readGerberLayerPreview: vi.fn() }
    registerHardwareIpc(hardware as never, createGuard('trusted') as never)

    expect(() =>
      mockIpcMain.handlers.get('hardware:readGerberLayerPreview')?.(
        { sender: 'trusted' },
        '/tmp/project',
        '/tmp/project/gerber.zip',
        '../../secret.txt',
      ),
    ).toThrow('路径穿越')
    expect(hardware.readGerberLayerPreview).not.toHaveBeenCalled()
  })
})

function createGuard(trustedSender: string) {
  return {
    assert: (event: { sender: string }) => {
      if (event.sender !== trustedSender) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: string }) => event.sender === trustedSender,
  }
}
