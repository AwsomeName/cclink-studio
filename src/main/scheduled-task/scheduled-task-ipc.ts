import { scheduledTasksIpcContracts as scheduledTasksIpc } from '../../shared/scheduled-task/scheduled-task-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { ScheduledTaskService } from './scheduled-task-service'
import type { BrowserWindow } from 'electron'
import { scheduledTasksIpcEvents } from '../../shared/scheduled-task/scheduled-task-contract'

export function registerScheduledTaskIpc(
  service: ScheduledTaskService,
  trustedRendererGuard: TrustedRendererGuard,
  mainWindow?: BrowserWindow,
): void {
  registerTrustedIpcContract(
    scheduledTasksIpc.list,
    trustedRendererGuard,
    (_event, workspacePath) => service.list(workspacePath),
  )
  registerTrustedIpcContract(
    scheduledTasksIpc.get,
    trustedRendererGuard,
    (_event, workspacePath, taskId) => service.get(workspacePath, taskId),
  )
  registerTrustedIpcContract(scheduledTasksIpc.save, trustedRendererGuard, (_event, input) =>
    service.save(input),
  )
  registerTrustedIpcContract(scheduledTasksIpc.setEnabled, trustedRendererGuard, (_event, input) =>
    service.setEnabled(input),
  )
  registerTrustedIpcContract(scheduledTasksIpc.runNow, trustedRendererGuard, (_event, input) =>
    service.runNow(input),
  )
  registerTrustedIpcContract(scheduledTasksIpc.cancelRun, trustedRendererGuard, (_event, input) =>
    service.cancelRun(input),
  )
  registerTrustedIpcContract(
    scheduledTasksIpc.listRuns,
    trustedRendererGuard,
    (_event, workspacePath, taskId) => service.listRuns(workspacePath, taskId),
  )
  registerTrustedIpcContract(scheduledTasksIpc.getRuntimeStatus, trustedRendererGuard, () =>
    service.getRuntimeStatus(),
  )
  if (mainWindow) {
    service.onChanged((workspacePath) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(scheduledTasksIpcEvents.changed, workspacePath)
      }
    })
  }
}
