import { ipcRenderer } from 'electron'
import {
  agentIpc,
  agentIpcEvents,
  agentMcpIpc,
  type AgentApiContract,
  type AgentCommandResult,
  type AgentScope,
  type AgentSendMessageInput,
} from '../shared/ipc/agent'
import { invokeIpcContract } from './ipc-contract-client'

function sendMessage(message: AgentSendMessageInput): Promise<AgentCommandResult>
function sendMessage(
  conversationId: string,
  message: AgentSendMessageInput,
): Promise<AgentCommandResult>
function sendMessage(
  conversationIdOrMessage: string | AgentSendMessageInput,
  maybeMessage?: AgentSendMessageInput,
): Promise<AgentCommandResult> {
  return maybeMessage === undefined
    ? invokeIpcContract(agentIpc.sendMessage, conversationIdOrMessage)
    : invokeIpcContract(agentIpc.sendMessage, conversationIdOrMessage as string, maybeMessage)
}

function setScope(scope: AgentScope): Promise<boolean>
function setScope(conversationId: string, scope: AgentScope): Promise<boolean>
function setScope(
  conversationIdOrScope: string | AgentScope,
  maybeScope?: AgentScope,
): Promise<boolean> {
  return maybeScope === undefined
    ? invokeIpcContract(agentIpc.setScope, conversationIdOrScope as AgentScope)
    : invokeIpcContract(agentIpc.setScope, conversationIdOrScope as string, maybeScope)
}

export const agentApi: AgentApiContract = {
  sendMessage,
  abort: (conversationId) => invokeIpcContract(agentIpc.abort, conversationId),
  getStatus: (conversationId) => invokeIpcContract(agentIpc.getStatus, conversationId),
  getContextUsage: (conversationId?: string) =>
    invokeIpcContract(agentIpc.getContextUsage, conversationId),
  compactConversation: (conversationId, payload) =>
    invokeIpcContract(agentIpc.compactConversation, conversationId, payload),
  setScope,
  getScope: (conversationId) => invokeIpcContract(agentIpc.getScope, conversationId),
  resetSession: (conversationId) => invokeIpcContract(agentIpc.resetSession, conversationId),
  restoreConversation: (conversationId, sessionId, configuration, sessionCompatibilityFingerprint) =>
    invokeIpcContract(
      agentIpc.restoreConversation,
      conversationId,
      sessionId,
      configuration,
      sessionCompatibilityFingerprint,
    ),
  listRoles: () => invokeIpcContract(agentIpc.listRoles),
  closeConversation: (conversationId) =>
    invokeIpcContract(agentIpc.closeConversation, conversationId),
  onStreamEvent: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: Parameters<typeof callback>[0],
    ): void => callback(data)
    ipcRenderer.on(agentIpcEvents.stream, listener)
    return () => ipcRenderer.removeListener(agentIpcEvents.stream, listener)
  },
  onComplete: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: Parameters<typeof callback>[0],
    ): void => callback(data)
    ipcRenderer.on(agentIpcEvents.complete, listener)
    return () => ipcRenderer.removeListener(agentIpcEvents.complete, listener)
  },
  onError: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: Parameters<typeof callback>[0],
    ): void => callback(data)
    ipcRenderer.on(agentIpcEvents.error, listener)
    return () => ipcRenderer.removeListener(agentIpcEvents.error, listener)
  },
  getCapabilities: () => invokeIpcContract(agentIpc.getCapabilities),
  listToolModules: () => invokeIpcContract(agentIpc.listToolModules),
  setToolModuleEnabled: (moduleId, enabled) =>
    invokeIpcContract(agentIpc.setToolModuleEnabled, moduleId, enabled),
  onRequestConfirmation: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: Parameters<typeof callback>[0],
    ): void => callback(data)
    ipcRenderer.on(agentIpcEvents.requestConfirmation, listener)
    return () => ipcRenderer.removeListener(agentIpcEvents.requestConfirmation, listener)
  },
  resolveToolConfirmation: (id, approved, alwaysAllow) =>
    invokeIpcContract(agentIpc.resolveToolConfirmation, id, approved, alwaysAllow),
  getPermissionMode: () => invokeIpcContract(agentIpc.getPermissionMode),
  setPermissionMode: (mode) => invokeIpcContract(agentIpc.setPermissionMode, mode),
  listMcpServers: () => invokeIpcContract(agentMcpIpc.listServers),
  addMcpServer: (server) => invokeIpcContract(agentMcpIpc.addServer, server),
  removeMcpServer: (name) => invokeIpcContract(agentMcpIpc.removeServer, name),
  updateMcpServer: (name, updates) => invokeIpcContract(agentMcpIpc.updateServer, name, updates),
  reloadMcpConfig: () => invokeIpcContract(agentMcpIpc.reloadConfig),
}
