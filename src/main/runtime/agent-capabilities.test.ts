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

  it('reports scheduled-task module and runtime degradation without a second status owner', () => {
    const runtime = createRuntimeState(true)
    runtime.toolHost = {
      getRegisteredModules: () => [
        {
          name: 'scheduled-task',
          enabled: true,
          tools: [
            {
              name: 'scheduled_task_list',
              description: 'list',
              annotations: { readOnlyHint: true, destructiveHint: false },
            },
          ],
        },
      ],
    } as never
    runtime.scheduledTaskService = {
      getRuntimeStatus: () => ({ state: 'ready' }),
    } as never
    runtime.capabilities.ready('scheduled-task')

    expect(getAgentToolModules(runtime)[0]).toMatchObject({
      id: 'scheduled-task',
      label: '定时任务',
      available: true,
      tools: [{ name: 'scheduled_task_list', risk: 'read' }],
    })
    expect(
      getAgentCapabilities(runtime).find((item) => item.name === 'scheduled-task'),
    ).toMatchObject({ state: 'ready', available: true })

    runtime.scheduledTaskService = {
      getRuntimeStatus: () => ({
        state: 'degraded',
        lastError: { message: '运行账本损坏' },
      }),
    } as never
    expect(
      getAgentCapabilities(runtime).find((item) => item.name === 'scheduled-task'),
    ).toMatchObject({ state: 'degraded', available: false, reason: '运行账本损坏' })
    expect(getAgentToolModules(runtime)[0]).toMatchObject({
      available: false,
      reason: '运行账本损坏',
    })
  })
})
