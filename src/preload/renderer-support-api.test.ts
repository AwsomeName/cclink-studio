import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  return {
    listeners,
    invoke: vi.fn(),
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      const channelListeners = listeners.get(channel) ?? new Set()
      channelListeners.add(listener)
      listeners.set(channel, channelListeners)
    }),
    removeListener: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      listeners.get(channel)?.delete(listener)
    }),
    removeAllListeners: vi.fn((channel: string) => listeners.delete(channel)),
  }
})

vi.mock('electron', () => ({ ipcRenderer: ipc }))

import { editorApi } from './renderer-support-api'

describe('editor preload listener ownership', () => {
  beforeEach(() => {
    ipc.listeners.clear()
    ipc.on.mockClear()
    ipc.removeListener.mockClear()
    ipc.removeAllListeners.mockClear()
  })

  it.each([
    ['editor:readRequest', editorApi.onReadRequest],
    ['editor:saveRequest', editorApi.onSaveRequest],
  ] as const)('keeps concurrent %s listeners isolated', (channel, subscribe) => {
    const externalListener = vi.fn()
    ipc.on(channel, externalListener)
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()
    const disposeFirst = subscribe(firstCallback)
    const disposeSecond = subscribe(secondCallback)

    for (const listener of ipc.listeners.get(channel) ?? []) {
      listener({ sender: 'renderer' }, { id: 'request-1' })
    }

    expect(ipc.removeAllListeners).not.toHaveBeenCalled()
    expect(externalListener).toHaveBeenCalledOnce()
    expect(firstCallback).toHaveBeenCalledOnce()
    expect(secondCallback).toHaveBeenCalledOnce()

    disposeFirst()
    expect(ipc.listeners.get(channel)?.has(externalListener)).toBe(true)
    expect(ipc.listeners.get(channel)?.size).toBe(2)
    disposeSecond()
    disposeSecond()
    expect(ipc.listeners.get(channel)?.has(externalListener)).toBe(true)
  })

  it('drops malformed Editor requests at the preload boundary', () => {
    const readCallback = vi.fn()
    const saveCallback = vi.fn()
    const disposeRead = editorApi.onReadRequest(readCallback)
    const disposeSave = editorApi.onSaveRequest(saveCallback)

    for (const listener of ipc.listeners.get('editor:readRequest') ?? []) {
      listener({}, { id: '' })
    }
    for (const listener of ipc.listeners.get('editor:saveRequest') ?? []) {
      listener({}, { id: 'request-1', filePath: `bad\0path` })
    }

    expect(readCallback).not.toHaveBeenCalled()
    expect(saveCallback).not.toHaveBeenCalled()
    disposeRead()
    disposeSave()
  })
})
