import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      mocks.handlers.set(channel, handler)
    }),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
}))

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain, dialog: mocks.dialog }))

import { registerDialogIpc } from './dialog-ipc'
import { registerEditorIpc } from './editor-ipc'

describe('renderer response IPC boundaries', () => {
  beforeEach(() => {
    mocks.handlers.clear()
  })

  it('rejects untrusted dialog callers before opening native UI', () => {
    registerDialogIpc(createWindow() as never, createGuard('trusted') as never)

    expect(() => mocks.handlers.get('dialog:showOpenDialog')?.({ sender: 'other' }, {})).toThrow(
      'untrusted',
    )
    expect(mocks.dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('passes a validated default directory to the native open dialog', async () => {
    const mainWindow = createWindow()
    mocks.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    registerDialogIpc(mainWindow as never, createGuard('trusted') as never)

    await mocks.handlers.get('dialog:showOpenDialog')?.(
      { sender: 'trusted' },
      { title: '选择 Markdown', defaultPath: '/workspace/project' },
    )

    expect(mocks.dialog.showOpenDialog).toHaveBeenCalledWith(mainWindow, {
      title: '选择 Markdown',
      defaultPath: '/workspace/project',
      properties: ['openFile'],
      filters: undefined,
    })
  })

  it('rejects oversized editor responses before resolving an Agent operation', () => {
    const editor = { resolveOperation: vi.fn(), rejectOperation: vi.fn() }
    registerEditorIpc(editor as never, createGuard('trusted') as never)

    expect(() =>
      mocks.handlers.get('editor:readResponse')?.(
        { sender: 'trusted' },
        'operation-1',
        'x'.repeat(5 * 1024 * 1024 + 1),
      ),
    ).toThrow()
    expect(editor.resolveOperation).not.toHaveBeenCalled()
  })
})

function createWindow() {
  return { isDestroyed: () => false }
}

function createGuard(trustedSender: string) {
  return {
    assert: (event: { sender: string }) => {
      if (event.sender !== trustedSender) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: string }) => event.sender === trustedSender,
  }
}
