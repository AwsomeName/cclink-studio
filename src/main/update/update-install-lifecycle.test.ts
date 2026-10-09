import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ windows: [{ isDestroyed: () => false }], quit: vi.fn() }))
vi.mock('electron', () => ({
  app: { quit: electron.quit },
  BrowserWindow: { getAllWindows: () => electron.windows },
}))
import { createUpdateInstallLifecycle, inspectMainUpdateImpacts } from './update-install-lifecycle'
import { UpdateInstallFlushError } from './update-installer'
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
    await expect(lifecycle.flush()).rejects.toEqual(
      new UpdateInstallFlushError('workspace_flush_failed'),
    )
    expect(electron.quit).not.toHaveBeenCalled()
  })

  it('preserves the oversized conversation classification from the trusted renderer', async () => {
    const runtime = createRuntimeState(false)
    runtime.rendererWorkspaceStateFlush = {
      requestFlush: async () => 'agent_conversations_too_large',
    } as never

    await expect(createUpdateInstallLifecycle(runtime).flush()).rejects.toEqual(
      new UpdateInstallFlushError('agent_conversations_too_large'),
    )
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
