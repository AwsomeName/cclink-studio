import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerTerminalIpc: vi.fn(),
}))

vi.mock('../ipc/terminal-ipc', () => ({ registerTerminalIpc: mocks.registerTerminalIpc }))

import { createRuntimeState } from './app-runtime'
import {
  bootstrapOptionalMainServices,
  type OptionalMainServiceBootstrappers,
} from './optional-main-services'

describe('bootstrapOptionalMainServices', () => {
  beforeEach(() => {
    mocks.registerTerminalIpc.mockReset()
    mocks.registerTerminalIpc.mockReturnValue(vi.fn())
  })

  it('continues later capabilities after one optional service fails', async () => {
    const runtime = createReadyRuntime()
    const starts: string[] = []
    const bootstrappers = createBootstrappers(starts)
    bootstrappers['data-source'] = (state) => {
      starts.push('data-source')
      state.dataSourceService = { partial: true } as never
      throw new Error('data source load failed')
    }

    await bootstrapOptionalMainServices(runtime, bootstrappers)

    expect(starts).toEqual([
      'cad',
      'hardware',
      'data-source',
      'meshy',
      'image-generation',
      'terminal',
    ])
    expect(runtime.capabilities.get('data-source')).toMatchObject({
      state: 'failed',
      reason: 'data source load failed',
    })
    expect(runtime.dataSourceService).toBeNull()
    expect(runtime.capabilities.get('meshy').state).toBe('ready')
    expect(runtime.capabilities.get('terminal').state).toBe('ready')
    expect(mocks.registerTerminalIpc).toHaveBeenCalledOnce()
    expect(runtime.terminalExecutionEventUnsubscribe).toEqual(expect.any(Function))
  })

  it('cleans partial terminal state and still registers degraded IPC handlers', async () => {
    const runtime = createReadyRuntime()
    const starts: string[] = []
    const bootstrappers = createBootstrappers(starts)
    const destroy = vi.fn()
    bootstrappers.terminal = (state) => {
      starts.push('terminal')
      state.terminalConfirmationService = { destroy } as never
      state.terminalSessionRegistry = { partial: true } as never
      throw new Error('pty bootstrap failed')
    }

    await bootstrapOptionalMainServices(runtime, bootstrappers)

    expect(destroy).toHaveBeenCalledOnce()
    expect(runtime.terminalConfirmationService).toBeNull()
    expect(runtime.terminalSessionRegistry).toBeNull()
    expect(runtime.capabilities.get('terminal')).toMatchObject({
      state: 'failed',
      reason: 'pty bootstrap failed',
    })
    expect(mocks.registerTerminalIpc).toHaveBeenCalledWith(
      null,
      runtime.trustedRendererGuard,
      undefined,
      undefined,
      undefined,
      undefined,
      runtime.mainWindow?.webContents,
      undefined,
    )
  })
})

function createReadyRuntime() {
  const runtime = createRuntimeState(true)
  runtime.mainWindow = { webContents: {} } as never
  runtime.settingsService = {} as never
  runtime.trustedRendererGuard = {} as never
  return runtime
}

function createBootstrappers(starts: string[]): OptionalMainServiceBootstrappers {
  return {
    cad: () => {
      starts.push('cad')
    },
    hardware: () => {
      starts.push('hardware')
    },
    'data-source': () => {
      starts.push('data-source')
    },
    meshy: () => {
      starts.push('meshy')
    },
    'image-generation': () => {
      starts.push('image-generation')
    },
    terminal: () => {
      starts.push('terminal')
    },
  }
}
