import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeState } from './app-runtime'

const lifecycle = vi.hoisted(() => ({
  calls: [] as string[],
  failAt: null as string | null,
  step(name: string): void {
    this.calls.push(name)
    if (this.failAt === name) throw new Error(`${name} failed`)
  },
}))

vi.mock('./core-services', () => ({
  bootstrapStateServices: () => lifecycle.step('start:state'),
  shutdownStateServices: () => lifecycle.step('stop:state'),
  bootstrapMainProcessServices: () => lifecycle.step('start:main'),
  shutdownMainProcessServices: () => lifecycle.step('stop:main'),
}))

vi.mock('../company-workspace/company-workspace-runtime', () => ({
  createCompanyWorkspaceRuntime: () => ({
    name: 'company-workspace',
    start: () => lifecycle.step('start:company'),
    stop: () => lifecycle.step('stop:company'),
  }),
}))

vi.mock('./window-runtime', () => ({
  createWindowRuntime: () => lifecycle.step('start:window'),
  destroyWindowRuntime: () => lifecycle.step('stop:window'),
}))

vi.mock('./automation-runtime', () => ({
  bootstrapAutomationRuntime: () => lifecycle.step('start:automation'),
  shutdownAutomationRuntime: () => lifecycle.step('stop:automation'),
}))

vi.mock('./agent-runtime', () => ({
  bootstrapAgentRuntime: () => lifecycle.step('start:agent'),
  shutdownAgentRuntime: () => lifecycle.step('stop:agent'),
}))

import { bootstrapRuntime, rebuildRuntime } from './bootstrap-runtime'
import { shutdownRuntime } from './shutdown-runtime'

const windowOptions = {
  preloadPath: '/tmp/preload.js',
  rendererHtmlPath: '/tmp/index.html',
}

describe('runtime lifecycle registry', () => {
  beforeEach(() => {
    lifecycle.calls.length = 0
    lifecycle.failAt = null
  })

  it('uses the same declarations for startup, rebuild, and shutdown', async () => {
    const runtime = createRuntimeState(true)

    await bootstrapRuntime(runtime, windowOptions)
    await rebuildRuntime(runtime)
    await shutdownRuntime(runtime)

    expect(lifecycle.calls).toEqual([
      'start:state',
      'start:window',
      'start:main',
      'start:company',
      'start:automation',
      'start:agent',
      'stop:agent',
      'stop:automation',
      'stop:company',
      'stop:main',
      'stop:window',
      'stop:state',
      'start:state',
      'start:window',
      'start:main',
      'start:company',
      'start:automation',
      'start:agent',
      'stop:agent',
      'stop:automation',
      'stop:company',
      'stop:main',
      'stop:window',
      'stop:state',
    ])
    expect(runtime.serviceRegistry?.getState()).toBe('idle')
  })

  it('rolls back a partially started runtime through the same declarations', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const runtime = createRuntimeState(true)
    lifecycle.failAt = 'start:automation'

    await expect(bootstrapRuntime(runtime, windowOptions)).rejects.toThrow(
      'start:automation failed',
    )

    expect(lifecycle.calls).toEqual([
      'start:state',
      'start:window',
      'start:main',
      'start:company',
      'start:automation',
      'stop:automation',
      'stop:company',
      'stop:main',
      'stop:window',
      'stop:state',
    ])
    expect(runtime.serviceRegistry?.getState()).toBe('idle')
    error.mockRestore()
  })
})
