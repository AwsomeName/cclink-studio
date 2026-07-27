import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileService } from './file-service'
import type { SettingsService } from '../settings/settings-service'

const mockIpcMain = vi.hoisted(() => ({
  handle: vi.fn(),
}))
const trustedRendererGuard = {
  assert: vi.fn(),
  isTrusted: vi.fn(() => true),
}

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  shell: { openPath: vi.fn() },
}))

import { registerFsIpc } from './fs-ipc'

function getHandler(channel: string): (...args: any[]) => any {
  const registration = mockIpcMain.handle.mock.calls.find(([name]) => name === channel)
  if (!registration) throw new Error(`Missing IPC handler: ${channel}`)
  return registration[1]
}

function createSender(): EventEmitter & {
  isDestroyed: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
} {
  return Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  })
}

describe('registerFsIpc directory watcher lifecycle', () => {
  beforeEach(() => {
    mockIpcMain.handle.mockReset()
    trustedRendererGuard.assert.mockReset()
    trustedRendererGuard.isTrusted.mockReset()
    trustedRendererGuard.isTrusted.mockReturnValue(true)
  })

  it('rejects an untrusted sender before reading a path', () => {
    const fs = { readFile: vi.fn() } as unknown as FileService
    const settings = { getAll: vi.fn() } as unknown as SettingsService
    trustedRendererGuard.assert.mockImplementationOnce(() => {
      throw new Error('untrusted')
    })
    registerFsIpc(fs, settings, trustedRendererGuard as never)

    expect(() => getHandler('fs:readFile')({ sender: {} }, '/tmp/project/file.md')).toThrow(
      'untrusted',
    )
    expect(fs.readFile).not.toHaveBeenCalled()
  })

  it('rejects malformed paths before invoking the file service', () => {
    const fs = { readFile: vi.fn() } as unknown as FileService
    const settings = { getAll: vi.fn() } as unknown as SettingsService
    registerFsIpc(fs, settings, trustedRendererGuard as never)

    expect(() => getHandler('fs:readFile')({ sender: {} }, '/tmp/bad\0path')).toThrow()
    expect(fs.readFile).not.toHaveBeenCalled()
  })

  it('validates and forwards a scoped file copy transaction', async () => {
    const copyEntry = vi.fn().mockResolvedValue({
      sourcePath: '/tmp/project/note.md',
      destinationPath: '/tmp/project/archive/note.md',
    })
    const fs = { copyEntry } as unknown as FileService
    const settings = { getAll: vi.fn() } as unknown as SettingsService
    registerFsIpc(fs, settings, trustedRendererGuard as never)

    const input = {
      sourceWorkspacePath: '/tmp/project',
      sourcePath: '/tmp/project/note.md',
      targetWorkspacePath: '/tmp/project',
      targetDirectory: '/tmp/project/archive',
    }
    await expect(getHandler('fs:copyEntry')({ sender: {} }, input)).resolves.toEqual({
      sourcePath: input.sourcePath,
      destinationPath: '/tmp/project/archive/note.md',
    })
    expect(copyEntry).toHaveBeenCalledWith(input)

    expect(() =>
      getHandler('fs:copyEntry')(
        { sender: {} },
        { ...input, sourcePath: '/tmp/project/bad\0path' },
      ),
    ).toThrow()
  })

  it('removes the sender destroyed listener when a watcher stops normally', () => {
    const stop = vi.fn()
    const fs = {
      watchDir: vi.fn(() => ({ stop })),
    } as unknown as FileService
    const settings = {
      getAll: vi.fn(() => ({ showHiddenFiles: false })),
    } as unknown as SettingsService
    const sender = createSender()

    registerFsIpc(fs, settings, trustedRendererGuard as never)
    const start = getHandler('fs:watchDirStart')
    const stopWatching = getHandler('fs:watchDirStop')

    for (let index = 0; index < 12; index += 1) {
      const watchId = start({ sender }, `/tmp/project-${index}`)
      expect(sender.listenerCount('destroyed')).toBe(1)
      expect(stopWatching({}, watchId)).toBe(true)
      expect(sender.listenerCount('destroyed')).toBe(0)
    }

    expect(stop).toHaveBeenCalledTimes(12)
  })

  it('stops the watcher when its sender is destroyed', () => {
    const stop = vi.fn()
    const fs = {
      watchDir: vi.fn(() => ({ stop })),
    } as unknown as FileService
    const settings = {
      getAll: vi.fn(() => ({ showHiddenFiles: false })),
    } as unknown as SettingsService
    const sender = createSender()

    registerFsIpc(fs, settings, trustedRendererGuard as never)
    const start = getHandler('fs:watchDirStart')
    const stopWatching = getHandler('fs:watchDirStop')
    const watchId = start({ sender }, '/tmp/project')

    sender.emit('destroyed')

    expect(stop).toHaveBeenCalledOnce()
    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(stopWatching({}, watchId)).toBe(false)
  })
})
