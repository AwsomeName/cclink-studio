import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerScheduledTaskIpc } from './scheduled-task-ipc'

describe('registerScheduledTaskIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.handle.mockClear()
  })

  it('rejects an untrusted sender before reading task definitions', () => {
    const service = createService()
    registerScheduledTaskIpc(service as never, createGuard('trusted') as never)

    expect(() =>
      mockIpcMain.handlers.get('scheduledTasks:list')?.(
        { sender: 'other' },
        '/Users/example/project',
      ),
    ).toThrow('untrusted')
    expect(service.list).not.toHaveBeenCalled()
  })

  it('rejects traversal and malformed schedules before calling the service', async () => {
    const service = createService()
    registerScheduledTaskIpc(service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('scheduledTasks:save')?.(
        { sender: 'trusted' },
        {
          workspacePath: '/Users/example/project',
          title: '日报',
          instruction: '生成日报',
          schedule: { kind: 'daily', time: '25:90', timezone: 'Asia/Shanghai' },
          resources: [{ kind: 'workspace' }, { kind: 'file', path: '../secret' }],
          outputPolicy: {
            directory: '../outside',
            fileNameTemplate: 'report.md',
            mode: 'create-only',
          },
          enable: true,
        },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'SCHEDULED_TASK_INVALID', message: '执行时刻无效' },
    })
    expect(service.save).not.toHaveBeenCalled()
  })

  it('forwards a bounded valid save command', async () => {
    const service = createService()
    registerScheduledTaskIpc(service as never, createGuard('trusted') as never)
    const input = {
      workspacePath: '/Users/example/project',
      title: '日报',
      instruction: '读取资料并生成日报',
      schedule: { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' },
      resources: [{ kind: 'workspace' }],
      outputPolicy: {
        directory: 'docs/reports',
        fileNameTemplate: 'report-{date}.md',
        mode: 'create-only',
      },
      enable: true,
    }

    await mockIpcMain.handlers.get('scheduledTasks:save')?.({ sender: 'trusted' }, input)

    expect(service.save).toHaveBeenCalledWith(input)
  })
})

function createService() {
  return {
    list: vi.fn(async () => ({ success: true, tasks: [] })),
    get: vi.fn(async () => ({ success: true })),
    save: vi.fn(async () => ({ success: true })),
    setEnabled: vi.fn(async () => ({ success: true })),
  }
}

function createGuard(trustedSender: string) {
  return {
    assert: (event: { sender: string }) => {
      if (event.sender !== trustedSender) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: string }) => event.sender === trustedSender,
  }
}
