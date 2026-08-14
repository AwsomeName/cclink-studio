import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { authIpc, authIpcEvents } from '../../shared/ipc/auth'
import { cclinkIpc, cclinkIpcEvents } from '../../shared/ipc/cclink'
import { remoteIpc } from '../../shared/ipc/remote'
import { CCLINK_UNCONFIGURED_MESSAGE } from './service-config'
import { bindIpcParser } from '../../shared/ipc/contract'
import {
  remoteWorkspacePathSchema,
  remoteWorkspaceRefSchema,
} from '../../shared/ipc/workspace-ref-schema'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { CclinkRemoteService } from './cclink-remote-service'
import { RemoteFileDraftStore } from '../remote/remote-file-draft-store'

const phoneSchema = z.string().regex(/^1[3-9]\d{9}$/u, '请输入有效的手机号')
const codeSchema = z.string().regex(/^\d{4,8}$/u, '请输入有效的短信验证码')
const idSchema = z.string().trim().min(1).max(256)
export const cclinkRemotePathSchema = remoteWorkspacePathSchema
export const cclinkRemoteRefSchema = remoteWorkspaceRefSchema

const noArgs = <T>(definition: { channel: string }) =>
  bindIpcParser<[], T>(definition, (args) => z.tuple([]).parse(args))

export function registerCclinkRemoteIpc(
  mainWindow: BrowserWindow,
  service: CclinkRemoteService,
  guard: TrustedRendererGuard,
): () => void {
  const draftStore = new RemoteFileDraftStore(
    join(app.getPath('userData'), 'remote-workspaces', 'file-drafts.json'),
  )
  const sendSession = (session: {
    loggedIn: boolean
    user: ReturnType<typeof service.auth.getUser>
    offline?: boolean
  }): void => {
    if (!mainWindow.isDestroyed())
      mainWindow.webContents.send(authIpcEvents.sessionChanged, session)
  }
  const unsubscribeStatus = service.onStatus((status) => {
    if (!mainWindow.isDestroyed())
      mainWindow.webContents.send(cclinkIpcEvents.realtimeStatus, status)
  })
  const unsubscribeRealtime = service.onRealtimeEvent((event) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(cclinkIpcEvents.realtimeEvent, event)
  })

  registerTrustedIpcContract(noArgs(authIpc.getServiceStatus), guard, () => ({
    configured: service.auth.isConfigured(),
    message: service.auth.isConfigured() ? undefined : CCLINK_UNCONFIGURED_MESSAGE,
  }))
  registerTrustedIpcContract(
    bindIpcParser(authIpc.phoneSendCode, (args) => z.tuple([phoneSchema]).parse(args)),
    guard,
    (_event, phone) => service.auth.sendSmsCode(phone),
  )
  registerTrustedIpcContract(
    bindIpcParser(authIpc.phoneLogin, (args) => z.tuple([phoneSchema, codeSchema]).parse(args)),
    guard,
    async (_event, phone, code) => {
      try {
        const user = await service.auth.login(phone, code)
        const session = { loggedIn: true, user }
        sendSession(session)
        return { success: true, user }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '登录失败' }
      }
    },
  )
  registerTrustedIpcContract(noArgs(authIpc.checkSession), guard, async () => {
    const session = await service.auth.restoreSession()
    sendSession(session)
    return session
  })
  registerTrustedIpcContract(noArgs(authIpc.logout), guard, async () => {
    await service.disconnect()
    service.auth.logout()
    sendSession({ loggedIn: false, user: null })
  })

  registerTrustedIpcContract(noArgs(cclinkIpc.getRealtimeStatus), guard, () =>
    service.getRealtimeStatus(),
  )
  registerTrustedIpcContract(noArgs(cclinkIpc.connectRealtime), guard, () => service.connect())
  registerTrustedIpcContract(noArgs(cclinkIpc.listServers), guard, () => service.listServers())
  const serverPathSchema = z.object({ serverId: idSchema, path: cclinkRemotePathSchema }).strict()
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.browseDirectory, (args) => z.tuple([serverPathSchema]).parse(args)),
    guard,
    (_event, input) => service.browseDirectory(input.serverId, input.path),
  )
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.openWorkspace, (args) => z.tuple([serverPathSchema]).parse(args)),
    guard,
    (_event, input) => service.openWorkspace(input.serverId, input.path),
  )
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.listSessions, (args) => z.tuple([cclinkRemoteRefSchema]).parse(args)),
    guard,
    (_event, ref) => service.listSessions(ref),
  )
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.createSession, (args) =>
      z
        .tuple([
          z
            .object({
              ref: cclinkRemoteRefSchema,
              name: z.string().trim().min(1).max(200).optional(),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, input) => service.createSession(input.ref, input.name),
  )
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.listMessages, (args) => z.tuple([idSchema]).parse(args)),
    guard,
    (_event, sessionId) => service.listMessages(sessionId),
  )
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.setSessionArchived, (args) =>
      z.tuple([z.object({ sessionId: idSchema, archived: z.boolean() }).strict()]).parse(args),
    ),
    guard,
    (_event, input) => service.setSessionArchived(input.sessionId, input.archived),
  )
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.sendAgentMessage, (args) =>
      z
        .tuple([
          z
            .object({
              ref: cclinkRemoteRefSchema,
              sessionId: idSchema,
              content: z.string().trim().min(1).max(8_192),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, input) => service.sendAgentMessage(input.ref, input.sessionId, input.content),
  )
  const controlBase = {
    ref: cclinkRemoteRefSchema,
    sessionId: idSchema,
    requestId: idSchema,
    toolUseId: idSchema,
  }
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.resolveToolApproval, (args) =>
      z.tuple([z.object({ ...controlBase, approved: z.boolean() }).strict()]).parse(args),
    ),
    guard,
    (_event, input) => service.resolveToolApproval(input),
  )
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.answerQuestion, (args) =>
      z
        .tuple([
          z
            .object({
              ...controlBase,
              answers: z.record(z.string().min(1).max(256), z.string().max(4_096)),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, input) => service.answerQuestion(input),
  )
  registerTrustedIpcContract(
    bindIpcParser(cclinkIpc.respondPermission, (args) =>
      z
        .tuple([
          z
            .object({
              serverId: idSchema,
              requestId: idSchema,
              approved: z.boolean(),
              remember: z.boolean().optional(),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, input) => service.respondPermission(input),
  )

  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.getStatus, (args) => z.tuple([cclinkRemoteRefSchema]).parse(args)),
    guard,
    (_event, ref) => service.getStatus(ref),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.diagnose, (args) => z.tuple([cclinkRemoteRefSchema]).parse(args)),
    guard,
    (_event, ref) => service.diagnose(ref),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.listFileTree, (args) =>
      z
        .tuple([
          z
            .object({
              ref: cclinkRemoteRefSchema,
              path: cclinkRemotePathSchema.optional(),
              depth: z.number().int().min(0).max(3).optional(),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, request) => service.listFileTree(request),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.readFile, (args) =>
      z
        .tuple([
          z
            .object({
              ref: cclinkRemoteRefSchema,
              path: cclinkRemotePathSchema,
              startLine: z.number().int().min(1).max(10_000_000).optional(),
              endLine: z.number().int().min(1).max(10_000_000).optional(),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, request) => service.readFile(request),
  )
  const mutationBase = {
    ref: cclinkRemoteRefSchema,
    sessionId: idSchema,
    operationId: idSchema,
    operationCreatedAt: z.number().int().nonnegative(),
    operationExpiresAt: z.number().int().positive(),
  }
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.writeFile, (args) =>
      z
        .tuple([
          z
            .object({
              ...mutationBase,
              path: cclinkRemotePathSchema,
              content: z.string().max(2 * 1024 * 1024),
              expectedSha256: z.string().regex(/^[a-f0-9]{64}$/iu),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, request) => service.writeFile(request),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.createFile, (args) =>
      z
        .tuple([
          z
            .object({
              ...mutationBase,
              path: cclinkRemotePathSchema,
              type: z.enum(['file', 'directory']),
              content: z
                .string()
                .max(2 * 1024 * 1024)
                .optional(),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, request) => service.createFile(request),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.renameFile, (args) =>
      z
        .tuple([
          z
            .object({
              ...mutationBase,
              oldPath: cclinkRemotePathSchema,
              newPath: cclinkRemotePathSchema,
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, request) => service.renameFile(request),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.deleteFile, (args) =>
      z
        .tuple([
          z
            .object({
              ...mutationBase,
              path: cclinkRemotePathSchema,
              recursive: z.boolean().optional(),
              expectedSha256: z
                .string()
                .regex(/^[a-f0-9]{64}$/iu)
                .optional(),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, request) => service.deleteFile(request),
  )
  const draftIdentitySchema = z
    .object({ ref: cclinkRemoteRefSchema, path: cclinkRemotePathSchema })
    .strict()
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.getDraft, (args) => z.tuple([draftIdentitySchema]).parse(args)),
    guard,
    (_event, input) => draftStore.get(input.ref, input.path),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.saveDraft, (args) =>
      z
        .tuple([
          z
            .object({
              ref: cclinkRemoteRefSchema,
              path: cclinkRemotePathSchema,
              content: z.string().max(2 * 1024 * 1024),
              savedContent: z.string().max(2 * 1024 * 1024),
              sha256: z.string().regex(/^[a-f0-9]{64}$/iu),
              updatedAt: z.number().int().nonnegative(),
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, draft) => draftStore.save(draft),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.deleteDraft, (args) => z.tuple([draftIdentitySchema]).parse(args)),
    guard,
    (_event, input) => draftStore.delete(input.ref, input.path),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.deleteDraftPrefix, (args) =>
      z
        .tuple([
          z.object({ ref: cclinkRemoteRefSchema, pathPrefix: cclinkRemotePathSchema }).strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, input) => draftStore.deletePrefix(input.ref, input.pathPrefix),
  )
  registerTrustedIpcContract(
    bindIpcParser(remoteIpc.rebaseDraftPrefix, (args) =>
      z
        .tuple([
          z
            .object({
              ref: cclinkRemoteRefSchema,
              oldPrefix: cclinkRemotePathSchema,
              newPrefix: cclinkRemotePathSchema,
            })
            .strict(),
        ])
        .parse(args),
    ),
    guard,
    (_event, input) => draftStore.rebasePrefix(input.ref, input.oldPrefix, input.newPrefix),
  )

  return () => {
    unsubscribeStatus()
    unsubscribeRealtime()
  }
}
