import { contextBridge, ipcRenderer } from 'electron'
import { authIpc, authIpcEvents, type AuthApiContract } from '../shared/ipc/auth'
import { cclinkIpc, cclinkIpcEvents, type CclinkApiContract } from '../shared/ipc/cclink'
import { remoteIpc, type RemoteApiContract } from '../shared/ipc/remote'
import { officialIpc } from '../shared/ipc/official'
import { diagnosticsIpc } from '../shared/ipc/diagnostics'
import { settingsIpc, type SettingsApiContract } from '../shared/ipc/settings'
import { credentialsIpc, type CredentialsApiContract } from '../shared/ipc/credentials'
import type { TerminalApiContract } from '../shared/ipc/terminal'
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
import {
  mediaProjectsIpc,
  mediaProjectsIpcEvents,
  type MediaProjectsApiContract,
} from '../shared/media-production/media-project-contract'

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
  listSessions: (ref) => invokeIpcContract(cclinkIpc.listSessions, ref),
  createSession: (input) => invokeIpcContract(cclinkIpc.createSession, input),
  setSessionArchived: (input) => invokeIpcContract(cclinkIpc.setSessionArchived, input),
  listMessages: (sessionId) => invokeIpcContract(cclinkIpc.listMessages, sessionId),
  sendAgentMessage: (input) => invokeIpcContract(cclinkIpc.sendAgentMessage, input),
  resolveToolApproval: (input) => invokeIpcContract(cclinkIpc.resolveToolApproval, input),
  answerQuestion: (input) => invokeIpcContract(cclinkIpc.answerQuestion, input),
  respondPermission: (input) => invokeIpcContract(cclinkIpc.respondPermission, input),
  onRealtimeStatus: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: Parameters<typeof callback>[0],
    ): void => callback(status)
    ipcRenderer.on(cclinkIpcEvents.realtimeStatus, listener)
    return () => ipcRenderer.removeListener(cclinkIpcEvents.realtimeStatus, listener)
  },
  onRealtimeEvent: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      event: Parameters<typeof callback>[0],
    ): void => callback(event)
    ipcRenderer.on(cclinkIpcEvents.realtimeEvent, listener)
    return () => ipcRenderer.removeListener(cclinkIpcEvents.realtimeEvent, listener)
  },
}

const remoteApi: RemoteApiContract = {
  getStatus: (ref) => invokeIpcContract(remoteIpc.getStatus, ref),
  diagnose: (ref) => invokeIpcContract(remoteIpc.diagnose, ref),
  listFileTree: (request) => invokeIpcContract(remoteIpc.listFileTree, request),
  readFile: (request) => invokeIpcContract(remoteIpc.readFile, request),
  writeFile: (request) => invokeIpcContract(remoteIpc.writeFile, request),
  createFile: (request) => invokeIpcContract(remoteIpc.createFile, request),
  renameFile: (request) => invokeIpcContract(remoteIpc.renameFile, request),
  deleteFile: (request) => invokeIpcContract(remoteIpc.deleteFile, request),
  getDraft: (input) => invokeIpcContract(remoteIpc.getDraft, input),
  saveDraft: (draft) => invokeIpcContract(remoteIpc.saveDraft, draft),
  deleteDraft: (input) => invokeIpcContract(remoteIpc.deleteDraft, input),
  deleteDraftPrefix: (input) => invokeIpcContract(remoteIpc.deleteDraftPrefix, input),
  rebaseDraftPrefix: (input) => invokeIpcContract(remoteIpc.rebaseDraftPrefix, input),
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
  checkManagedClaude: () => invokeIpcContract(runtimeComponentsIpc.checkManagedClaude),
  installManagedClaude: () => invokeIpcContract(runtimeComponentsIpc.installManagedClaude),
  repairManagedClaude: () => invokeIpcContract(runtimeComponentsIpc.repairManagedClaude),
  uninstallManagedClaude: () => invokeIpcContract(runtimeComponentsIpc.uninstallManagedClaude),
  listRuntimeResources: () => invokeIpcContract(runtimeComponentsIpc.listRuntimeResources),
  checkRuntimeResource: (componentId) =>
    invokeIpcContract(runtimeComponentsIpc.checkRuntimeResource, componentId),
  installRuntimeResource: (componentId) =>
    invokeIpcContract(runtimeComponentsIpc.installRuntimeResource, componentId),
  repairRuntimeResource: (componentId) =>
    invokeIpcContract(runtimeComponentsIpc.repairRuntimeResource, componentId),
  uninstallRuntimeResource: (componentId) =>
    invokeIpcContract(runtimeComponentsIpc.uninstallRuntimeResource, componentId),
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

const mediaProjectsApi: MediaProjectsApiContract = {
  list: (workspacePath) => invokeIpcContract(mediaProjectsIpc.list, workspacePath),
  get: (workspacePath, projectId) =>
    invokeIpcContract(mediaProjectsIpc.get, workspacePath, projectId),
  create: (input) => invokeIpcContract(mediaProjectsIpc.create, input),
  save: (input) => invokeIpcContract(mediaProjectsIpc.save, input),
  proposeStoryboard: (input) => invokeIpcContract(mediaProjectsIpc.proposeStoryboard, input),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, workspacePath: string): void =>
      callback(workspacePath)
    ipcRenderer.on(mediaProjectsIpcEvents.changed, handler)
    return () => ipcRenderer.removeListener(mediaProjectsIpcEvents.changed, handler)
  },
}

const terminalApi: TerminalApiContract = {
  onRequestCommandConfirmation: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      request: Parameters<typeof callback>[0],
    ): void => callback(request)
    ipcRenderer.on('terminal:requestCommandConfirmation', handler)
    return () => ipcRenderer.removeListener('terminal:requestCommandConfirmation', handler)
  },
  onExecutionEvent: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      event: Parameters<typeof callback>[0],
    ): void => callback(event)
    ipcRenderer.on('terminal:executionEvent', handler)
    return () => ipcRenderer.removeListener('terminal:executionEvent', handler)
  },
  resolveCommandConfirmation: (id, approved) =>
    ipcRenderer.invoke('terminal:resolveCommandConfirmation', id, approved),
  recordLifecycleEvent: (input) => ipcRenderer.invoke('terminal:recordLifecycleEvent', input),
  submitCommand: (input) => ipcRenderer.invoke('terminal:submitCommand', input),
  startPty: (input) => ipcRenderer.invoke('terminal:startPty', input),
  writePty: (input) => ipcRenderer.invoke('terminal:writePty', input),
  resizePty: (input) => ipcRenderer.invoke('terminal:resizePty', input),
  terminatePty: (terminalSessionId) =>
    ipcRenderer.invoke('terminal:terminatePty', terminalSessionId),
  listSessions: () => ipcRenderer.invoke('terminal:listSessions'),
  listAuditEvents: (filter) => ipcRenderer.invoke('terminal:listAuditEvents', filter),
  clearAuditSession: (terminalSessionId) =>
    ipcRenderer.invoke('terminal:clearAuditSession', terminalSessionId),
  clearAuditEvents: () => ipcRenderer.invoke('terminal:clearAuditEvents'),
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
  terminal: terminalApi,

  // 应用设置
  settings: settingsApi,

  runtimeComponents: runtimeComponentsApi,

  workspaceState: workspaceStateApi,

  scheduledTasks: scheduledTasksApi,

  mediaProjects: mediaProjectsApi,

  update: updateApi,
})
