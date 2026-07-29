import { describe, expect, it } from 'vitest'
import { createRuntimeState } from './app-runtime'
import { getAgentCapabilities, getAgentToolModules } from './agent-capabilities'

describe('getAgentCapabilities', () => {
  it('returns the structured runtime state and derives available from ready only', () => {
    const runtime = createRuntimeState(true)
    runtime.capabilities.ready('agent-backend')
    runtime.capabilities.degraded('browser', 'Browser 工具未注册')
    runtime.capabilities.failed('meshy', new Error('API initialization failed'))

    const capabilities = getAgentCapabilities(runtime)

    expect(capabilities.find((item) => item.name === 'agent-backend')).toMatchObject({
      state: 'ready',
      available: true,
    })
    expect(capabilities.find((item) => item.name === 'browser')).toMatchObject({
      state: 'degraded',
      available: false,
      reason: 'Browser 工具未注册',
    })
    expect(capabilities.find((item) => item.name === 'meshy')).toMatchObject({
      state: 'failed',
      available: false,
      reason: 'API initialization failed',
    })
  })

  it('reports a missing Android device as unavailable without hiding initialization failure', () => {
    const runtime = createRuntimeState(true)
    runtime.activeDeviceManager = { getSource: () => null } as never
    runtime.capabilities.ready('android')

    expect(getAgentCapabilities(runtime).find((item) => item.name === 'android')).toMatchObject({
      state: 'unavailable',
      reason: '未连接用户真机',
    })

    runtime.capabilities.failed('android', new Error('adb bootstrap failed'))
    expect(getAgentCapabilities(runtime).find((item) => item.name === 'android')).toMatchObject({
      state: 'failed',
      reason: 'adb bootstrap failed',
    })
  })

  it('makes Markdown illustration available when any image provider is configured', () => {
    const runtime = createRuntimeState(true)
    runtime.toolHost = {
      getRegisteredModules: () => [
        {
          name: 'image-generation',
          enabled: true,
          tools: [],
        },
      ],
    } as never
    runtime.imageGenerationService = {
      getStatus: () => [
        { id: 'meshy', configured: false, models: [], reason: 'Meshy 未配置' },
        { id: 'jimeng', configured: true, models: ['jimeng-4.0'] },
      ],
    } as never

    expect(getAgentToolModules(runtime)[0]).toMatchObject({
      id: 'image-generation',
      available: true,
    })
  })
})
