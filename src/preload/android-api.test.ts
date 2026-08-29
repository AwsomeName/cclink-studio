import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  return {
    listeners,
    invoke: vi.fn(),
    send: vi.fn(),
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

import { androidApi } from './android-api'

describe('Android preload listener ownership', () => {
  beforeEach(() => {
    ipc.listeners.clear()
    ipc.on.mockClear()
    ipc.removeListener.mockClear()
    ipc.removeAllListeners.mockClear()
  })

  it.each([
    [
      'scrcpy:videoFrame',
      androidApi.onVideoFrame,
      { type: 'data', data: new ArrayBuffer(4), keyframe: true, pts: '1' },
    ],
    ['scrcpy:error', androidApi.onMirrorError, 'error'],
    ['scrcpy:disconnected', androidApi.onMirrorDisconnected, undefined],
  ] as const)('removes only the subscribed %s listener', (channel, subscribe, payload) => {
    const externalListener = vi.fn()
    ipc.on(channel, externalListener)
    const callback = vi.fn()
    const dispose = subscribe(callback as never)

    for (const listener of ipc.listeners.get(channel) ?? []) {
      listener({ sender: 'renderer' }, payload)
    }

    expect(externalListener).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledOnce()
    expect(ipc.removeAllListeners).not.toHaveBeenCalled()

    dispose()
    dispose()
    expect(ipc.listeners.get(channel)?.has(externalListener)).toBe(true)
  })

  it('drops malformed Android event payloads before invoking renderer callbacks', () => {
    const videoCallback = vi.fn()
    const errorCallback = vi.fn()
    const progressCallback = vi.fn()
    const disposers = [
      androidApi.onVideoFrame(videoCallback),
      androidApi.onMirrorError(errorCallback),
      androidApi.onStoreInstallProgress(progressCallback),
    ]

    for (const listener of ipc.listeners.get('scrcpy:videoFrame') ?? []) {
      listener({}, { type: 'data' })
      listener({}, { type: 'data', data: new ArrayBuffer(1), pts: 'not-a-number' })
    }
    for (const listener of ipc.listeners.get('scrcpy:error') ?? []) listener({}, { message: 'bad' })
    for (const listener of ipc.listeners.get('android:storeInstallProgress') ?? []) {
      listener({}, 'x'.repeat(10_001))
    }

    expect(videoCallback).not.toHaveBeenCalled()
    expect(errorCallback).not.toHaveBeenCalled()
    expect(progressCallback).not.toHaveBeenCalled()
    disposers.forEach((dispose) => dispose())
  })
})
