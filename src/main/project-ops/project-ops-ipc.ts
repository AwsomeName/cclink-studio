import { ipcMain } from 'electron'
import type {
  ProjectOpsCreateDraftInput,
  ProjectOpsPublicationRecordInput,
} from '../../shared/ipc/project-ops'
import type { ProjectOpsService } from './project-ops-service'

export function registerProjectOpsIpc(projectOpsService: ProjectOpsService): void {
  ipcMain.handle('projectOps:getAccounts', (_event, workspacePath: string) =>
    projectOpsService.getAccounts(workspacePath),
  )

  ipcMain.handle('projectOps:createAccountsTemplate', (_event, workspacePath: string) =>
    projectOpsService.createAccountsTemplate(workspacePath),
  )

  ipcMain.handle(
    'projectOps:createCopyDraft',
    (_event, workspacePath: string, input?: ProjectOpsCreateDraftInput) =>
      projectOpsService.createCopyDraft(workspacePath, input),
  )

  ipcMain.handle(
    'projectOps:appendPublicationRecord',
    (_event, workspacePath: string, input: ProjectOpsPublicationRecordInput) =>
      projectOpsService.appendPublicationRecord(workspacePath, input),
  )
}
