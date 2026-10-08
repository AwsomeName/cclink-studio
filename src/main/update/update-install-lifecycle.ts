import { app, BrowserWindow } from 'electron'
import type { UpdateInstallImpact } from '../../shared/update'
import type { CclinkStudioRuntimeState } from '../runtime/app-runtime'
import type { UpdateInstallLifecycle } from './update-installer'

export function createUpdateInstallLifecycle(
  runtime: CclinkStudioRuntimeState,
): UpdateInstallLifecycle {
  return {
    inspect: async () => {
      const acknowledgement = await runtime.rendererWorkspaceStateFlush?.requestInstallReadiness()
      if (!acknowledgement?.success || !acknowledgement.updateInstallImpacts)
        throw new Error('Renderer readiness unavailable')
      return [...acknowledgement.updateInstallImpacts, ...inspectMainUpdateImpacts(runtime)]
    },
    acquire: () => {
      const agent = runtime.agentBridge
      if (agent && !agent.beginConfigurationChange()) throw new Error('Agent became active')
      const resumeScheduler = runtime.scheduledTaskService?.pauseForUpdate()
      if (runtime.scheduledTaskService && !resumeScheduler) {
        agent?.endConfigurationChange()
        throw new Error('Scheduled task became active')
      }
      return () => {
        agent?.endConfigurationChange()
        resumeScheduler?.()
      }
    },
    flush: async () => {
      if ((await runtime.rendererWorkspaceStateFlush?.requestFlush()) !== 'flushed')
        throw new Error('Workspace flush failed')
      // Installation is fail-closed; normal shutdown's best-effort wrappers are deliberately not used here.
      await runtime.workspaceStateService?.flush()
      await runtime.agentRuntimeStateStore?.flush()
      await runtime.scheduledTaskService?.flush()
      await runtime.mediaProjectService?.flush()
      await runtime.mediaAssetService?.flush()
      await runtime.videoGenerationService?.flush()
      await runtime.mediaRenderService?.flush()
      await runtime.webAffairService?.flush()
      await runtime.webResourceService?.flush()
    },
    quit: () => app.quit(),
  }
}

export function inspectMainUpdateImpacts(runtime: CclinkStudioRuntimeState): UpdateInstallImpact[] {
  const impacts: UpdateInstallImpact[] = []
  const block = (kind: UpdateInstallImpact['kind'], label: string, detail: string): void => {
    impacts.push({ kind, severity: 'blocked', label, detail })
  }
  if (BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length > 1)
    block('editor', '还有独立工作台或辅助窗口', '请先保存并关闭其他窗口，避免遗失工作现场。')
  if (runtime.agentRuntimeStateStore?.hasActiveRuns())
    block('agent', 'Agent 仍在运行', '请等待或自行停止所有 Agent 任务。')
  if (runtime.cclinkRemoteService?.hasActiveWork())
    block('agent', '远程任务或上传尚未结束', '请等待远程操作结束后再安装。')
  if (
    runtime.terminalSessionRegistry
      ?.list()
      .some((session) => session.status !== 'exited' && session.status !== 'error')
  )
    block('terminal', '终端会话尚未关闭', '请先结束命令并关闭终端；安装不会强制终止会话。')
  if (
    runtime.browserTaskRuntime
      ?.listTasks()
      .some((task) => !['completed', 'failed', 'cancelled'].includes(task.status))
  )
    block('browser', '浏览器任务尚未结束', '请先完成或取消浏览器任务。')
  if (
    runtime.browserDownloadStore
      ?.listDownloads()
      .some((download) => ['pending', 'downloading'].includes(download.status))
  )
    block('browser', '浏览器正在下载文件', '请等待下载完成，或自行取消。')
  const scheduled = runtime.scheduledTaskService?.getRuntimeStatus()
  if (scheduled?.runningRunId || scheduled?.queuedCount)
    block('long_task', '定时任务正在执行或排队', '请等任务结束后重试。')
  if (
    runtime.mediaProjectService?.hasActiveWork() ||
    runtime.mediaRenderService?.hasActiveWork() ||
    runtime.videoGenerationService?.hasActiveWork() ||
    runtime.imageGenerationService?.hasActiveWork()
  )
    block('long_task', '生成或渲染任务尚未结束', '请等待任务完成后再安装。')
  return impacts
}
