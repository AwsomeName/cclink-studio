import { z } from 'zod'
import type { IpcInvokeDefinition } from './contract'
import { bindIpcParser, bindNoArgsIpc, ipcArgs } from './contract'
import { absolutePathSchema, boundedIdentifierSchema } from './input-schema'
import {
  agentIpc,
  agentMcpIpc,
  type AgentCommandResult,
  type AgentSendMessageArgs,
  type AgentSendMessageInput,
  type AgentSetScopeArgs,
  type ExternalMcpServer,
} from './agent'
import {
  agentCompactPayloadSchema,
  agentConversationConfigurationSchema,
  agentConfirmationIdSchema,
  agentConversationIdSchema,
  agentPermissionModeSchema,
  agentRoleDraftSchema,
  agentRoleRefSchema,
  agentScopeSchema,
  agentRuntimeBindingSchema,
  agentSkillRefsSchema,
  agentSendMessageInputSchema,
  agentToolModuleIdSchema,
  mcpServerNameSchema,
  mcpServerSchema,
  mcpServerUpdatesSchema,
  nullableAgentSessionIdSchema,
  nullableAgentSessionCompatibilityFingerprintSchema,
  optionalAgentConversationIdSchema,
} from './agent-schema'

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

function bindOptionalConversation<Result>(
  definition: IpcInvokeDefinition<[conversationId?: string], Result>,
) {
  return bindIpcParser(definition, (args) => {
    if (args.length > 1) throw new Error(`IPC ${definition.channel} 最多接受 1 个参数`)
    return ipcArgs(optionalAgentConversationIdSchema.parse(args[0]))
  })
}

function bindConversation<Result>(
  definition: IpcInvokeDefinition<[conversationId: string], Result>,
) {
  return bindIpcParser(definition, (args) => {
    requireArgs(args, 1, definition.channel)
    return ipcArgs(agentConversationIdSchema.parse(args[0]))
  })
}

function mapCommandParseError(error: unknown): AgentCommandResult {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

export const agentIpcContracts = {
  sendMessage: bindIpcParser(
    agentIpc.sendMessage,
    (args): AgentSendMessageArgs => {
      if (args.length === 1) {
        return [agentSendMessageInputSchema.parse(args[0]) as AgentSendMessageInput]
      }
      if (args.length === 2) {
        return [
          agentConversationIdSchema.parse(args[0]),
          agentSendMessageInputSchema.parse(args[1]) as AgentSendMessageInput,
        ]
      }
      throw new Error(`IPC ${agentIpc.sendMessage.channel} 需要 1 或 2 个参数`)
    },
    (error) => Promise.reject(error),
  ),
  abort: bindOptionalConversation(agentIpc.abort),
  getStatus: bindOptionalConversation(agentIpc.getStatus),
  getContextUsage: bindOptionalConversation(agentIpc.getContextUsage),
  compactConversation: bindIpcParser(agentIpc.compactConversation, (args) => {
    requireArgs(args, 2, agentIpc.compactConversation.channel)
    return ipcArgs(
      agentConversationIdSchema.parse(args[0]),
      agentCompactPayloadSchema.parse(args[1]),
    )
  }),
  setScope: bindIpcParser(agentIpc.setScope, (args): AgentSetScopeArgs => {
    if (args.length === 1) return [agentScopeSchema.parse(args[0])]
    if (args.length === 2) {
      return [agentConversationIdSchema.parse(args[0]), agentScopeSchema.parse(args[1])]
    }
    throw new Error(`IPC ${agentIpc.setScope.channel} 需要 1 或 2 个参数`)
  }),
  getScope: bindOptionalConversation(agentIpc.getScope),
  resetSession: bindOptionalConversation(agentIpc.resetSession),
  restoreConversation: bindIpcParser(agentIpc.restoreConversation, (args) => {
    if (args.length < 3 || args.length > 6) {
      throw new Error(`IPC ${agentIpc.restoreConversation.channel} 需要 3 至 6 个参数`)
    }
    return ipcArgs(
      agentConversationIdSchema.parse(args[0]),
      nullableAgentSessionIdSchema.parse(args[1]),
      agentConversationConfigurationSchema.parse(args[2]),
      args.length >= 4
        ? nullableAgentSessionCompatibilityFingerprintSchema.parse(args[3])
        : undefined,
      args.length >= 5 ? agentSkillRefsSchema.parse(args[4]) : undefined,
      args.length === 6 ? agentRuntimeBindingSchema.parse(args[5]) : undefined,
    )
  }),
  listRoles: bindNoArgsIpc(agentIpc.listRoles),
  createRole: bindIpcParser(agentIpc.createRole, (args) => {
    requireArgs(args, 1, agentIpc.createRole.channel)
    return ipcArgs(agentRoleDraftSchema.parse(args[0]))
  }),
  updateRole: bindIpcParser(agentIpc.updateRole, (args) => {
    requireArgs(args, 3, agentIpc.updateRole.channel)
    return ipcArgs(
      boundedIdentifierSchema().parse(args[0]),
      z.number().int().positive().max(1_000_000).parse(args[1]),
      agentRoleDraftSchema.parse(args[2]),
    )
  }),
  copyRole: bindIpcParser(agentIpc.copyRole, (args) => {
    requireArgs(args, 1, agentIpc.copyRole.channel)
    return ipcArgs(agentRoleRefSchema.parse(args[0]))
  }),
  setRoleArchived: bindIpcParser(agentIpc.setRoleArchived, (args) => {
    requireArgs(args, 2, agentIpc.setRoleArchived.channel)
    return ipcArgs(boundedIdentifierSchema().parse(args[0]), z.boolean().parse(args[1]))
  }),
  exportRole: bindIpcParser(agentIpc.exportRole, (args) => {
    requireArgs(args, 2, agentIpc.exportRole.channel)
    return ipcArgs(agentRoleRefSchema.parse(args[0]), absolutePathSchema.parse(args[1]))
  }),
  previewImportRole: bindIpcParser(agentIpc.previewImportRole, (args) => {
    requireArgs(args, 1, agentIpc.previewImportRole.channel)
    return ipcArgs(absolutePathSchema.parse(args[0]))
  }),
  commitImportRole: bindIpcParser(agentIpc.commitImportRole, (args) => {
    requireArgs(args, 2, agentIpc.commitImportRole.channel)
    return ipcArgs(
      boundedIdentifierSchema().parse(args[0]),
      z.enum(['update', 'copy']).parse(args[1]),
    )
  }),
  listSkills: bindNoArgsIpc(agentIpc.listSkills),
  closeConversation: bindConversation(agentIpc.closeConversation),
  getCapabilities: bindNoArgsIpc(agentIpc.getCapabilities),
  listToolModules: bindNoArgsIpc(agentIpc.listToolModules),
  setToolModuleEnabled: bindIpcParser(agentIpc.setToolModuleEnabled, (args) => {
    requireArgs(args, 2, agentIpc.setToolModuleEnabled.channel)
    return ipcArgs(agentToolModuleIdSchema.parse(args[0]), z.boolean().parse(args[1]))
  }),
  resolveToolConfirmation: bindIpcParser(agentIpc.resolveToolConfirmation, (args) => {
    if (args.length < 2 || args.length > 3) {
      throw new Error(`IPC ${agentIpc.resolveToolConfirmation.channel} 需要 2 或 3 个参数`)
    }
    return ipcArgs(
      agentConfirmationIdSchema.parse(args[0]),
      z.boolean().parse(args[1]),
      z.boolean().optional().parse(args[2]),
    )
  }),
  getPermissionMode: bindNoArgsIpc(agentIpc.getPermissionMode),
  setPermissionMode: bindIpcParser(agentIpc.setPermissionMode, (args) => {
    requireArgs(args, 1, agentIpc.setPermissionMode.channel)
    return ipcArgs(agentPermissionModeSchema.parse(args[0]))
  }),
} as const

export const agentMcpIpcContracts = {
  listServers: bindNoArgsIpc(agentMcpIpc.listServers),
  addServer: bindIpcParser(
    agentMcpIpc.addServer,
    (args) => {
      requireArgs(args, 1, agentMcpIpc.addServer.channel)
      return ipcArgs(mcpServerSchema.parse(args[0]) as ExternalMcpServer)
    },
    mapCommandParseError,
  ),
  removeServer: bindIpcParser(agentMcpIpc.removeServer, (args) => {
    requireArgs(args, 1, agentMcpIpc.removeServer.channel)
    return ipcArgs(mcpServerNameSchema.parse(args[0]))
  }),
  updateServer: bindIpcParser(agentMcpIpc.updateServer, (args) => {
    requireArgs(args, 2, agentMcpIpc.updateServer.channel)
    return ipcArgs(
      mcpServerNameSchema.parse(args[0]),
      mcpServerUpdatesSchema.parse(args[1]) as Partial<ExternalMcpServer>,
    )
  }),
  reloadConfig: bindNoArgsIpc(agentMcpIpc.reloadConfig),
} as const
