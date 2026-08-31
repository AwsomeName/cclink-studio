import { contextBridge, ipcRenderer } from 'electron'
import {
  authIpc,
  authIpcEvents,
  parseAuthSessionEvent,
  type AuthApiContract,
} from '../shared/ipc/auth'
import {
  cclinkIpc,
  cclinkIpcEvents,
  parseCclinkImageUploadProgressEvent,
  parseCclinkRealtimeEvent,
  parseCclinkRealtimeStatusEvent,
  type CclinkApiContract,
} from '../shared/ipc/cclink'
import { remoteIpc, type RemoteApiContract } from '../shared/ipc/remote'
import { officialIpc } from '../shared/ipc/official'
import { diagnosticsIpc } from '../shared/ipc/diagnostics'
import { settingsIpc, type SettingsApiContract } from '../shared/ipc/settings'
import { credentialsIpc, type CredentialsApiContract } from '../shared/ipc/credentials'
import {
  parseTerminalConfirmationRequest,
  parseTerminalExecutionEvent,
  terminalIpc,
  terminalIpcEvents,
  type TerminalApiContract,
} from '../shared/ipc/terminal'
import {
  scheduledTasksIpc,
  scheduledTasksIpcEvents,
  parseScheduledTasksChangedEvent,
  type ScheduledTasksApiContract,
} from '../shared/scheduled-task/scheduled-task-contract'
import { agentApi } from './agent-api'
import { androidApi } from './android-api'
import { browserApi, reportWorkbenchBounds } from './browser-api'
import { dataSourceApi } from './data-source-api'
import { fsApi } from './fs-api'
import { gitApi } from './git-api'
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
import { articlePublishingApi } from './article-publishing-api'
import {
  runtimeComponentsIpc,
  type RuntimeComponentsApiContract,
} from '../shared/ipc/runtime-components'
import {
  mediaProjectsIpc,
  mediaProjectsIpcEvents,
  parseMediaProjectsChangedEvent,
  type MediaProjectsApiContract,
} from '../shared/media-production/media-project-contract'
import {
  mediaVideoIpc,
  type MediaVideoApiContract,
} from '../shared/media-production/video-generation-contract'
import {
  mediaRenderIpc,
  type MediaRenderApiContract,
} from '../shared/media-production/media-render-contract'
import {
  workbenchBrowserStateIpc,
  workbenchTabModelIpc,
  type WorkbenchTabStateApiContract,
} from '../shared/ipc/workbench-tab-model'
import {
  workbenchPlacementChangedSchema,
  workbenchTabDetachReleasedSchema,
  workbenchWindowIpc,
  workbenchWindowIpcEvents,
  workbenchWindowProjectionSchema,
  type WorkbenchMainWindowApiContract,
} from '../shared/ipc/workbench-window'

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
  probeCodexAcp: (path) => invokeIpcContract(settingsIpc.probeCodexAcp, path),
}

const authApi: AuthApiContract = {
  getServiceStatus: () => invokeIpcContract(authIpc.getServiceStatus),
  phoneSendCode: (phone) => invokeIpcContract(authIpc.phoneSendCode, phone),
  phoneLogin: (phone, code) => invokeIpcContract(authIpc.phoneLogin, phone, code),
  checkSession: () => invokeIpcContract(authIpc.checkSession),
  logout: () => invokeIpcContract(authIpc.logout),
  onSessionChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const session = parseAuthSessionEvent(value)
      if (session) callback(session)
    }
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
  cancelOpenWorkspace: (input) => invokeIpcContract(cclinkIpc.cancelOpenWorkspace, input),
  listSessions: (ref) => invokeIpcContract(cclinkIpc.listSessions, ref),
  createSession: (input) => invokeIpcContract(cclinkIpc.createSession, input),
  setSessionArchived: (input) => invokeIpcContract(cclinkIpc.setSessionArchived, input),
  listMessages: (sessionId) => invokeIpcContract(cclinkIpc.listMessages, sessionId),
  sendAgentMessage: (input) => invokeIpcContract(cclinkIpc.sendAgentMessage, input),
  cancelAgentImageUpload: (input) => invokeIpcContract(cclinkIpc.cancelAgentImageUpload, input),
  stopTrackingAgentRun: (input) => invokeIpcContract(cclinkIpc.stopTrackingAgentRun, input),
  resolveToolApproval: (input) => invokeIpcContract(cclinkIpc.resolveToolApproval, input),
  answerQuestion: (input) => invokeIpcContract(cclinkIpc.answerQuestion, input),
  respondPermission: (input) => invokeIpcContract(cclinkIpc.respondPermission, input),
  onRealtimeStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const status = parseCclinkRealtimeStatusEvent(value)
      if (status) callback(status)
    }
    ipcRenderer.on(cclinkIpcEvents.realtimeStatus, listener)
    return () => ipcRenderer.removeListener(cclinkIpcEvents.realtimeStatus, listener)
  },
  onRealtimeEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const realtimeEvent = parseCclinkRealtimeEvent(value)
      if (realtimeEvent) callback(realtimeEvent)
    }
    ipcRenderer.on(cclinkIpcEvents.realtimeEvent, listener)
    return () => ipcRenderer.removeListener(cclinkIpcEvents.realtimeEvent, listener)
  },
  onImageUploadProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const progress = parseCclinkImageUploadProgressEvent(value)
      if (progress) callback(progress)
    }
    ipcRenderer.on(cclinkIpcEvents.imageUploadProgress, listener)
    return () => ipcRenderer.removeListener(cclinkIpcEvents.imageUploadProgress, listener)
  },
}

const remoteApi: RemoteApiContract = {
  getStatus: (ref) => invokeIpcContract(remoteIpc.getStatus, ref),
  diagnose: (ref, sessionId) => invokeIpcContract(remoteIpc.diagnose, ref, sessionId),
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
  delete: (input) => invokeIpcContract(scheduledTasksIpc.delete, input),
  setEnabled: (input) => invokeIpcContract(scheduledTasksIpc.setEnabled, input),
  runNow: (input) => invokeIpcContract(scheduledTasksIpc.runNow, input),
  cancelRun: (input) => invokeIpcContract(scheduledTasksIpc.cancelRun, input),
  listRuns: (workspacePath, taskId) =>
    invokeIpcContract(scheduledTasksIpc.listRuns, workspacePath, taskId),
  getRuntimeStatus: () => invokeIpcContract(scheduledTasksIpc.getRuntimeStatus),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const workspacePath = parseScheduledTasksChangedEvent(value)
      if (workspacePath) callback(workspacePath)
    }
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
  importAsset: (input) => invokeIpcContract(mediaProjectsIpc.importAsset, input),
  getImageProviders: () => invokeIpcContract(mediaProjectsIpc.getImageProviders),
  generateSceneImage: (input) => invokeIpcContract(mediaProjectsIpc.generateSceneImage, input),
  searchAssets: (input) => invokeIpcContract(mediaProjectsIpc.searchAssets, input),
  addSearchCandidate: (input) => invokeIpcContract(mediaProjectsIpc.addSearchCandidate, input),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const workspacePath = parseMediaProjectsChangedEvent(value)
      if (workspacePath) callback(workspacePath)
    }
    ipcRenderer.on(mediaProjectsIpcEvents.changed, handler)
    return () => ipcRenderer.removeListener(mediaProjectsIpcEvents.changed, handler)
  },
}

const mediaVideoApi: MediaVideoApiContract = {
  getProviders: () => invokeIpcContract(mediaVideoIpc.getProviders),
  createTask: (input) => invokeIpcContract(mediaVideoIpc.createTask, input),
  listTasks: (workspacePath, projectId) =>
    invokeIpcContract(mediaVideoIpc.listTasks, workspacePath, projectId),
  retryTask: (workspacePath, taskId) =>
    invokeIpcContract(mediaVideoIpc.retryTask, workspacePath, taskId),
}

const mediaRenderApi: MediaRenderApiContract = {
  getRuntimeStatus: () => invokeIpcContract(mediaRenderIpc.getRuntimeStatus),
  createTask: (input) => invokeIpcContract(mediaRenderIpc.createTask, input),
  listTasks: (workspacePath, projectId) =>
    invokeIpcContract(mediaRenderIpc.listTasks, workspacePath, projectId),
  retryTask: (workspacePath, taskId) =>
    invokeIpcContract(mediaRenderIpc.retryTask, workspacePath, taskId),
}

const workbenchTabsApi: WorkbenchTabStateApiContract = {
  getProjection: (input) => invokeIpcContract(workbenchTabModelIpc.getProjection, input),
  applyDelta: (input) => invokeIpcContract(workbenchTabModelIpc.applyDelta, input),
  getBrowserProjection: (input) =>
    invokeIpcContract(workbenchBrowserStateIpc.getBrowserProjection, input),
  applyBrowserDelta: (input) =>
    invokeIpcContract(workbenchBrowserStateIpc.applyBrowserDelta, input),
  getBookmarks: (input) => invokeIpcContract(workbenchBrowserStateIpc.getBookmarks, input),
  replaceBookmarks: (input) => invokeIpcContract(workbenchBrowserStateIpc.replaceBookmarks, input),
}

const workbenchWindowApi: WorkbenchMainWindowApiContract = {
  getBootstrap: () => invokeIpcContract(workbenchWindowIpc.getBootstrap),
  getProjection: () => invokeIpcContract(workbenchWindowIpc.getProjection),
  beginTabDetachDrag: (input) => invokeIpcContract(workbenchWindowIpc.beginTabDetachDrag, input),
  finishTabDetachDrag: (input) => invokeIpcContract(workbenchWindowIpc.finishTabDetachDrag, input),
  cancelTabDetachDrag: (input) => invokeIpcContract(workbenchWindowIpc.cancelTabDetachDrag, input),
  moveTabToNewWindow: (input) => invokeIpcContract(workbenchWindowIpc.moveTabToNewWindow, input),
  returnTabToMain: (input) => invokeIpcContract(workbenchWindowIpc.returnTabToMain, input),
  auxiliaryReady: (input) => invokeIpcContract(workbenchWindowIpc.auxiliaryReady, input),
  updateBounds: (input) => invokeIpcContract(workbenchWindowIpc.updateBounds, input),
  browserCommand: (input) => invokeIpcContract(workbenchWindowIpc.browserCommand, input),
  onProjectionChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const parsed = workbenchWindowProjectionSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on(workbenchWindowIpcEvents.projectionChanged, handler)
    return () => ipcRenderer.removeListener(workbenchWindowIpcEvents.projectionChanged, handler)
  },
  onPlacementChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const parsed = workbenchPlacementChangedSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on(workbenchWindowIpcEvents.placementChanged, handler)
    return () => ipcRenderer.removeListener(workbenchWindowIpcEvents.placementChanged, handler)
  },
  onTabDetachReleased: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const parsed = workbenchTabDetachReleasedSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on(workbenchWindowIpcEvents.tabDetachReleased, handler)
    return () => ipcRenderer.removeListener(workbenchWindowIpcEvents.tabDetachReleased, handler)
  },
  onUrlChanged: browserApi.onUrlChanged,
  onPageMetaChanged: browserApi.onPageMetaChanged,
  onFindShortcutTriggered: browserApi.onFindShortcutTriggered,
  onFindResult: browserApi.onFindResult,
  onTaskChanged: browserApi.onTaskChanged,
  onDownloadChanged: browserApi.onDownloadChanged,
  onNativeContextMenuOpened: browserApi.onNativeContextMenuOpened,
}

const terminalApi: TerminalApiContract = {
  onRequestCommandConfirmation: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const request = parseTerminalConfirmationRequest(value)
      if (request) callback(request)
    }
    ipcRenderer.on(terminalIpcEvents.requestCommandConfirmation, handler)
    return () => ipcRenderer.removeListener(terminalIpcEvents.requestCommandConfirmation, handler)
  },
  onExecutionEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const event = parseTerminalExecutionEvent(value)
      if (event) callback(event)
    }
    ipcRenderer.on(terminalIpcEvents.executionEvent, handler)
    return () => ipcRenderer.removeListener(terminalIpcEvents.executionEvent, handler)
  },
  resolveCommandConfirmation: (id, approved) =>
    invokeIpcContract(terminalIpc.resolveCommandConfirmation, id, approved),
  recordLifecycleEvent: (input) => invokeIpcContract(terminalIpc.recordLifecycleEvent, input),
  submitCommand: (input) => invokeIpcContract(terminalIpc.submitCommand, input),
  startPty: (input) => invokeIpcContract(terminalIpc.startPty, input),
  writePty: (input) => invokeIpcContract(terminalIpc.writePty, input),
  resizePty: (input) => invokeIpcContract(terminalIpc.resizePty, input),
  terminatePty: (terminalSessionId) =>
    invokeIpcContract(terminalIpc.terminatePty, terminalSessionId),
  listSessions: () => invokeIpcContract(terminalIpc.listSessions),
  listAuditEvents: (filter) => invokeIpcContract(terminalIpc.listAuditEvents, filter),
  clearAuditSession: (terminalSessionId) =>
    invokeIpcContract(terminalIpc.clearAuditSession, terminalSessionId),
  clearAuditEvents: () => invokeIpcContract(terminalIpc.clearAuditEvents),
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

  git: gitApi,

  projectOps: projectOpsApi,

  webResources: webResourcesApi,

  webAffairs: webAffairsApi,

  articlePublishing: articlePublishingApi,

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

  workbenchTabs: workbenchTabsApi,

  workbenchWindow: workbenchWindowApi,

  scheduledTasks: scheduledTasksApi,

  mediaProjects: mediaProjectsApi,
  mediaVideo: mediaVideoApi,
  mediaRender: mediaRenderApi,

  update: updateApi,
})
