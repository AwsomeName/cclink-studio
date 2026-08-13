import { contextBridge, ipcRenderer } from 'electron'
import { authIpc, authIpcEvents, type AuthApiContract } from '../shared/ipc/auth'
import { cclinkIpc, cclinkIpcEvents, type CclinkApiContract } from '../shared/ipc/cclink'
import { remoteIpc, type RemoteApiContract } from '../shared/ipc/remote'
import { officialIpc } from '../shared/ipc/official'
import { diagnosticsIpc } from '../shared/ipc/diagnostics'
import { settingsIpc, type SettingsApiContract } from '../shared/ipc/settings'
import { credentialsIpc, type CredentialsApiContract } from '../shared/ipc/credentials'
import {
  scheduledTasksIpc,
  scheduledTasksIpcEvents,
  type ScheduledTasksApiContract,
} from '../shared/scheduled-task/scheduled-task-contract'
import { agentApi } from './agent-api'
import { androidApi } from './android-api'
import { browserApi, reportWorkbenchBounds } from './browser-api'
import { dataSourceApi } from './data-source-api'
import { fsApi } from './fs-api'
import {
  cadApi,
  gitBackupApi,
  hardwareApi,
  projectOpsApi,
  workspaceStateApi,
} from './local-ops-api'
import {
  dialogApi,
  editorApi,
  identityApi,
  updateApi,
  wechatApi,
  windowApi,
} from './renderer-support-api'
import { invokeIpcContract } from './ipc-contract-client'
import { webResourcesApi } from './web-resources-api'
import { webAffairsApi } from './web-affairs-api'
import {
  runtimeComponentsIpc,
  type RuntimeComponentsApiContract,
} from '../shared/ipc/runtime-components'

const settingsApi: SettingsApiContract = {
  getAll: () => invokeIpcContract(settingsIpc.getAll),
  getSecretStatus: () => invokeIpcContract(settingsIpc.getSecretStatus),
  set: (updates) => invokeIpcContract(settingsIpc.set, updates),
  setSecret: (key, value) => invokeIpcContract(settingsIpc.setSecret, key, value),
  clearSecret: (key) => invokeIpcContract(settingsIpc.clearSecret, key),
  reset: () => invokeIpcContract(settingsIpc.reset),
  resetKey: (key) => invokeIpcContract(settingsIpc.resetKey, key),
  detectClaudeCode: () => invokeIpcContract(settingsIpc.detectClaudeCode),
  getClaudeRuntimeStatus: () => invokeIpcContract(settingsIpc.getClaudeRuntimeStatus),
  probeClaudeRuntime: (selection) => invokeIpcContract(settingsIpc.probeClaudeRuntime, selection),
  testClaudeModelConnection: (selection) =>
    invokeIpcContract(settingsIpc.testClaudeModelConnection, selection),
}

const authApi: AuthApiContract = {
  getServiceStatus: () => invokeIpcContract(authIpc.getServiceStatus),
  phoneSendCode: (phone) => invokeIpcContract(authIpc.phoneSendCode, phone),
  phoneLogin: (phone, code) => invokeIpcContract(authIpc.phoneLogin, phone, code),
  checkSession: () => invokeIpcContract(authIpc.checkSession),
  logout: () => invokeIpcContract(authIpc.logout),
  onSessionChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      session: Parameters<typeof callback>[0],
    ): void => callback(session)
    ipcRenderer.on(authIpcEvents.sessionChanged, listener)
    return () => ipcRenderer.removeListener(authIpcEvents.sessionChanged, listener)
  },
}

const cclinkApi: CclinkApiContract = {
  listServers: () => invokeIpcContract(cclinkIpc.listServers),
  connectRealtime: () => invokeIpcContract(cclinkIpc.connectRealtime),
  getRealtimeStatus: () => invokeIpcContract(cclinkIpc.getRealtimeStatus),
  browseDirectory: (input) => invokeIpcContract(cclinkIpc.browseDirectory, input),
  openWorkspace: (input) => invokeIpcContract(cclinkIpc.openWorkspace, input),
  onRealtimeStatus: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: Parameters<typeof callback>[0],
    ): void => callback(status)
    ipcRenderer.on(cclinkIpcEvents.realtimeStatus, listener)
    return () => ipcRenderer.removeListener(cclinkIpcEvents.realtimeStatus, listener)
  },
}

const remoteApi: RemoteApiContract = {
  getStatus: (ref) => invokeIpcContract(remoteIpc.getStatus, ref),
  listFileTree: (request) => invokeIpcContract(remoteIpc.listFileTree, request),
  readFile: (request) => invokeIpcContract(remoteIpc.readFile, request),
}

const credentialsApi: CredentialsApiContract = {
  listMetadata: () => invokeIpcContract(credentialsIpc.listMetadata),
  getStatus: () => invokeIpcContract(credentialsIpc.getStatus),
  set: (input) => invokeIpcContract(credentialsIpc.set, input),
  revealField: (id, field) => invokeIpcContract(credentialsIpc.revealField, id, field),
  copyField: (id, field) => invokeIpcContract(credentialsIpc.copyField, id, field),
  remove: (id) => invokeIpcContract(credentialsIpc.remove, id),
  clearAll: () => invokeIpcContract(credentialsIpc.clearAll),
  removeLegacyFiles: () => invokeIpcContract(credentialsIpc.removeLegacyFiles),
  openDirectory: () => invokeIpcContract(credentialsIpc.openDirectory),
  reload: () => invokeIpcContract(credentialsIpc.reload),
}

const runtimeComponentsApi: RuntimeComponentsApiContract = {
  getManagedClaudeStatus: () => invokeIpcContract(runtimeComponentsIpc.getManagedClaudeStatus),
  installManagedClaude: () => invokeIpcContract(runtimeComponentsIpc.installManagedClaude),
  listRuntimeResources: () => invokeIpcContract(runtimeComponentsIpc.listRuntimeResources),
  installRuntimeResource: (componentId) =>
    invokeIpcContract(runtimeComponentsIpc.installRuntimeResource, componentId),
}

const scheduledTasksApi: ScheduledTasksApiContract = {
  list: (workspacePath) => invokeIpcContract(scheduledTasksIpc.list, workspacePath),
  get: (workspacePath, taskId) => invokeIpcContract(scheduledTasksIpc.get, workspacePath, taskId),
  save: (input) => invokeIpcContract(scheduledTasksIpc.save, input),
  setEnabled: (input) => invokeIpcContract(scheduledTasksIpc.setEnabled, input),
  runNow: (input) => invokeIpcContract(scheduledTasksIpc.runNow, input),
  cancelRun: (input) => invokeIpcContract(scheduledTasksIpc.cancelRun, input),
  listRuns: (workspacePath, taskId) =>
    invokeIpcContract(scheduledTasksIpc.listRuns, workspacePath, taskId),
  getRuntimeStatus: () => invokeIpcContract(scheduledTasksIpc.getRuntimeStatus),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, workspacePath: string): void =>
      callback(workspacePath)
    ipcRenderer.on(scheduledTasksIpcEvents.changed, handler)
    return () => ipcRenderer.removeListener(scheduledTasksIpcEvents.changed, handler)
  },
}

contextBridge.exposeInMainWorld('cclinkStudio', {
  reportWorkbenchBounds,

  window: windowApi,

  auth: authApi,

  cclink: cclinkApi,

  remote: remoteApi,

  browser: browserApi,

  identity: identityApi,

  official: {
    getStatus: () => invokeIpcContract(officialIpc.getStatus),
  },

  diagnostics: {
    getMainLogSnapshot: () => invokeIpcContract(diagnosticsIpc.getMainLogSnapshot),
  },

  // Agent
  agent: agentApi,

  credentials: credentialsApi,

  fs: fsApi,

  projectOps: projectOpsApi,

  webResources: webResourcesApi,

  webAffairs: webAffairsApi,

  gitBackup: gitBackupApi,

  hardware: hardwareApi,

  cad: cadApi,

  dialog: dialogApi,

  wechat: wechatApi,

  editor: editorApi,

  android: androidApi,

  dataSource: dataSourceApi,

  // Terminal 命令确认、执行事件与受限提交
  terminal: {
    onRequestCommandConfirmation: (callback: (request: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: any): void => callback(request)
      ipcRenderer.on('terminal:requestCommandConfirmation', handler)
      return () => ipcRenderer.removeListener('terminal:requestCommandConfirmation', handler)
    },
    onExecutionEvent: (callback: (event: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: any): void => callback(event)
      ipcRenderer.on('terminal:executionEvent', handler)
      return () => ipcRenderer.removeListener('terminal:executionEvent', handler)
    },
    resolveCommandConfirmation: (id: string, approved: boolean) =>
      ipcRenderer.invoke('terminal:resolveCommandConfirmation', id, approved),
    recordLifecycleEvent: (input: any) =>
      ipcRenderer.invoke('terminal:recordLifecycleEvent', input),
    submitCommand: (input: any) => ipcRenderer.invoke('terminal:submitCommand', input),
    startPty: (input: any) => ipcRenderer.invoke('terminal:startPty', input),
    writePty: (input: any) => ipcRenderer.invoke('terminal:writePty', input),
    resizePty: (input: any) => ipcRenderer.invoke('terminal:resizePty', input),
    terminatePty: (terminalSessionId: string) =>
      ipcRenderer.invoke('terminal:terminatePty', terminalSessionId),
    listSessions: () => ipcRenderer.invoke('terminal:listSessions'),
    listAuditEvents: (filter?: any) => ipcRenderer.invoke('terminal:listAuditEvents', filter),
    clearAuditSession: (terminalSessionId: string) =>
      ipcRenderer.invoke('terminal:clearAuditSession', terminalSessionId),
    clearAuditEvents: () => ipcRenderer.invoke('terminal:clearAuditEvents'),
  },

  // 应用设置
  settings: settingsApi,

  runtimeComponents: runtimeComponentsApi,

  workspaceState: workspaceStateApi,

  scheduledTasks: scheduledTasksApi,

  update: updateApi,
})
