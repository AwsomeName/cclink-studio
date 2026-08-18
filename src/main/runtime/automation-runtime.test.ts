import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registered: [] as string[],
  meshyFails: false,
  discoverCdpPort: vi.fn<() => Promise<number>>(),
  start: vi.fn<() => Promise<number>>(),
  registerEditorIpc: vi.fn(),
}))

vi.mock('../cdp/cdp-port-discovery', () => ({
  discoverCdpPort: mocks.discoverCdpPort,
}))
vi.mock('../playwright/playwright-bridge', () => ({
  PlaywrightBridge: class PlaywrightBridge {},
}))
vi.mock('../ipc/editor-ipc', () => ({ registerEditorIpc: mocks.registerEditorIpc }))
vi.mock('../mcp/tool-host', () => ({
  McpToolHost: class McpToolHost {
    registerModule(module: { name: string }): void {
      mocks.registered.push(module.name)
    }
    setModuleEnabled(): boolean {
      return true
    }
    start(): Promise<number> {
      return mocks.start()
    }
  },
}))
vi.mock('../mcp/modules/browser', () => ({
  BrowserToolModule: class BrowserToolModule {
    name = 'browser'
  },
}))
vi.mock('../mcp/modules/editor', () => ({
  EditorToolModule: class EditorToolModule {
    name = 'editor'
  },
}))
vi.mock('../mcp/modules/meshy', () => ({
  MeshyToolModule: class MeshyToolModule {
    name = 'meshy'
    constructor() {
      if (mocks.meshyFails) throw new Error('meshy constructor failed')
    }
  },
}))
vi.mock('../mcp/modules/image-generation', () => ({
  ImageGenerationToolModule: class ImageGenerationToolModule {
    name = 'image-generation'
  },
}))
vi.mock('../mcp/modules/hardware', () => ({
  HardwareToolModule: class HardwareToolModule {
    name = 'hardware'
  },
}))
vi.mock('../mcp/modules/cad', () => ({
  CadToolModule: class CadToolModule {
    name = 'cad'
  },
}))
vi.mock('../mcp/modules/data-source', () => ({
  DataSourceToolModule: class DataSourceToolModule {
    name = 'data-source'
  },
}))
vi.mock('../mcp/modules/android', () => ({
  AndroidToolModule: class AndroidToolModule {
    name = 'android'
  },
}))
vi.mock('../mcp/modules/agent-device', () => ({
  AgentDeviceToolModule: class AgentDeviceToolModule {
    name = 'agent-device'
  },
}))
vi.mock('../mcp/modules/scheduled-task', () => ({
  ScheduledTaskToolModule: class ScheduledTaskToolModule {
    name = 'scheduled-task'
  },
}))
vi.mock('../android/agent-device-manager', () => ({
  AgentDeviceManager: class AgentDeviceManager {
    async init(): Promise<void> {}
    isAvailable(): boolean {
      return false
    }
    destroy(): void {}
  },
}))

import { createRuntimeState } from './app-runtime'
import { bootstrapAutomationRuntime } from './automation-runtime'

describe('bootstrapAutomationRuntime', () => {
  beforeEach(() => {
    mocks.registered.length = 0
    mocks.meshyFails = false
    mocks.discoverCdpPort.mockReset().mockRejectedValue(new Error('CDP unavailable'))
    mocks.start.mockReset().mockResolvedValue(43123)
    mocks.registerEditorIpc.mockClear()
  })

  it('keeps MCP and Editor ready when Playwright initialization fails', async () => {
    const runtime = createAutomationRuntime()

    await expect(bootstrapAutomationRuntime(runtime)).resolves.toBeUndefined()

    expect(runtime.capabilities.get('browser')).toMatchObject({
      state: 'failed',
      reason: 'CDP unavailable',
    })
    expect(runtime.capabilities.get('editor').state).toBe('ready')
    expect(runtime.capabilities.get('mcp').state).toBe('ready')
    expect(mocks.registered).toContain('editor')
    expect(mocks.registered).not.toContain('browser')
  })

  it('registers the read-only global web account catalog when the service is available', async () => {
    const runtime = createAutomationRuntime()
    runtime.webResourceService = { getSnapshot: vi.fn() } as never

    await bootstrapAutomationRuntime(runtime)

    expect(mocks.registered).toContain('web-resources')
  })

  it('continues registering later modules when one optional module fails', async () => {
    mocks.meshyFails = true
    const runtime = createAutomationRuntime()

    await bootstrapAutomationRuntime(runtime)

    expect(runtime.capabilities.get('meshy')).toMatchObject({
      state: 'failed',
      reason: 'meshy constructor failed',
    })
    expect(runtime.capabilities.get('data-source').state).toBe('ready')
    expect(runtime.capabilities.get('cad').state).toBe('ready')
    expect(runtime.capabilities.get('hardware').state).toBe('ready')
    expect(mocks.registered).toEqual(
      expect.arrayContaining([
        'editor',
        'scheduled-task',
        'hardware',
        'cad',
        'data-source',
        'android',
        'agent-device',
      ]),
    )
    expect(runtime.capabilities.get('mcp').state).toBe('ready')
  })

  it('preserves an earlier main-service failure instead of replacing its reason', async () => {
    const runtime = createAutomationRuntime()
    runtime.capabilities.failed('meshy', new Error('credential store unavailable'))

    await bootstrapAutomationRuntime(runtime)

    expect(mocks.registered).not.toContain('meshy')
    expect(runtime.capabilities.get('meshy')).toMatchObject({
      state: 'failed',
      reason: 'credential store unavailable',
    })
    expect(runtime.capabilities.get('hardware').state).toBe('ready')
    expect(runtime.capabilities.get('mcp').state).toBe('ready')
  })

  it('does not overwrite an earlier Browser window failure with CDP state', async () => {
    const runtime = createAutomationRuntime()
    runtime.capabilities.failed('browser', new Error('browser manager unavailable'))

    await bootstrapAutomationRuntime(runtime)

    expect(mocks.discoverCdpPort).not.toHaveBeenCalled()
    expect(runtime.playwrightBridge).toBeNull()
    expect(runtime.capabilities.get('browser')).toMatchObject({
      state: 'failed',
      reason: 'browser manager unavailable',
    })
    expect(runtime.capabilities.get('mcp').state).toBe('ready')
  })
})

function createAutomationRuntime() {
  const runtime = createRuntimeState(true)
  runtime.mainWindow = {} as never
  runtime.permissionManager = {} as never
  runtime.fileService = {} as never
  runtime.trustedRendererGuard = {} as never
  runtime.meshyService = {} as never
  runtime.markdownIllustrationService = {} as never
  runtime.hardwareService = {} as never
  runtime.cadConversionService = {} as never
  runtime.dataSourceService = {} as never
  runtime.adbBridge = {} as never
  runtime.scrcpyBridge = {} as never
  runtime.activeDeviceManager = {} as never
  runtime.settingsService = { getAll: () => ({ disabledAgentToolModules: [] }) } as never
  runtime.scheduledTaskService = {} as never
  return runtime
}
