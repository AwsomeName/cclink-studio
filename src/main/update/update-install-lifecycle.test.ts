import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ windows: [{ isDestroyed: () => false }], quit: vi.fn() }))
vi.mock('electron', () => ({
  app: { quit: electron.quit },
  BrowserWindow: { getAllWindows: () => electron.windows },
}))
import { createUpdateInstallLifecycle, inspectMainUpdateImpacts } from './update-install-lifecycle'
import { createRuntimeState } from '../runtime/app-runtime'

describe('update installation work protection', () => {
  it('blocks live terminals, browser downloads and background tasks rather than cancelling them', () => {
    const runtime = createRuntimeState(false)
    runtime.terminalSessionRegistry = { list: () => [{ status: 'idle' }] } as never
    runtime.browserDownloadStore = { listDownloads: () => [{ status: 'downloading' }] } as never
    runtime.mediaRenderService = { hasActiveWork: () => true } as never
    expect(inspectMainUpdateImpacts(runtime).map((impact) => impact.kind)).toEqual([
      'terminal',
      'browser',
      'long_task',
    ])
  })

  it('refuses unavailable renderer evidence and persistence failure', async () => {
    const runtime = createRuntimeState(false)
    const lifecycle = createUpdateInstallLifecycle(runtime)
    await expect(lifecycle.inspect()).rejects.toThrow('Renderer readiness')
    await expect(lifecycle.flush()).rejects.toThrow('Workspace flush')
    expect(electron.quit).not.toHaveBeenCalled()
  })

  it('reuses the existing Agent configuration guard and resumes scheduler on abort', () => {
    const runtime = createRuntimeState(false)
    const endConfigurationChange = vi.fn()
    const resume = vi.fn()
    runtime.agentBridge = { beginConfigurationChange: () => true, endConfigurationChange } as never
    runtime.scheduledTaskService = { pauseForUpdate: () => resume } as never
    createUpdateInstallLifecycle(runtime).acquire!()()
    expect(endConfigurationChange).toHaveBeenCalledOnce()
    expect(resume).toHaveBeenCalledOnce()
  })
})
