import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAndroidIpc } from './android-ipc'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
  on: vi.fn((channel: string, listener: (...args: any[]) => any) => {
    mockIpcMain.listeners.set(channel, listener)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

describe('registerAndroidIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.listeners.clear()
  })

  it('rejects an untrusted sender before an APK install', () => {
    const runtime = createRuntime()
    register(runtime)

    expect(() =>
      mockIpcMain.handlers.get('android:installApk')?.({ sender: 'other' }, '/tmp/application.apk'),
    ).toThrow('untrusted')
    expect(runtime.adbBridge.installApk).not.toHaveBeenCalled()
  })

  it('rejects a relative or non-APK install path', async () => {
    const runtime = createRuntime()
    register(runtime)

    await expect(
      mockIpcMain.handlers.get('android:installApk')?.({ sender: 'trusted' }, '../payload.sh'),
    ).rejects.toThrow()
    expect(runtime.adbBridge.installApk).not.toHaveBeenCalled()
  })

  it('drops malformed and untrusted touch events', () => {
    const runtime = createRuntime()
    register(runtime)
    const listener = mockIpcMain.listeners.get('scrcpy:touch')

    listener?.({ sender: 'other' }, { action: 0, x: 1, y: 1, pressure: 1 })
    listener?.({ sender: 'trusted' }, { action: 9, x: 1, y: 1, pressure: 1 })
    expect(runtime.scrcpyBridge.injectTouch).not.toHaveBeenCalled()

    listener?.({ sender: 'trusted' }, { action: 0, x: 1, y: 1, pressure: 1 })
    expect(runtime.scrcpyBridge.injectTouch).toHaveBeenCalledWith(0, 1, 1, 1)
  })
})

function createRuntime() {
  return {
    adbBridge: {
      installApk: vi.fn(),
      getDeviceId: vi.fn(),
    },
    mainWindow: {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() },
    },
    scrcpyBridge: {
      injectTouch: vi.fn(async () => undefined),
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    activeDeviceManager: { getSerial: vi.fn() },
    physicalDeviceManager: { listPhysicalDevices: vi.fn(), connect: vi.fn(), disconnect: vi.fn() },
  }
}

function register(runtime: ReturnType<typeof createRuntime>): void {
  registerAndroidIpc(
    runtime.adbBridge as never,
    runtime.mainWindow as never,
    runtime.scrcpyBridge as never,
    runtime.activeDeviceManager as never,
    runtime.physicalDeviceManager as never,
    createGuard('trusted') as never,
  )
}

function createGuard(trustedSender: string) {
  return {
    assert: (event: { sender: string }) => {
      if (event.sender !== trustedSender) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: string }) => event.sender === trustedSender,
  }
}
