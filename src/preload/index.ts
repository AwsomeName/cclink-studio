import { contextBridge, ipcRenderer } from 'electron'
import { officialIpc } from '../shared/ipc/official'
import { settingsIpc, type SettingsApiContract } from '../shared/ipc/settings'
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

contextBridge.exposeInMainWorld('cclinkStudio', {
  reportWorkbenchBounds,

  window: windowApi,

  browser: browserApi,

  identity: identityApi,

  official: {
    getStatus: () => invokeIpcContract(officialIpc.getStatus),
  },

  // Agent
  agent: agentApi,

  fs: fsApi,

  projectOps: projectOpsApi,

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

  workspaceState: workspaceStateApi,

  update: updateApi,
})
