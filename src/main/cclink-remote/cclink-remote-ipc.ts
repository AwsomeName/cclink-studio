import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import { authIpc, authIpcEvents } from '../../shared/ipc/auth'
import { cclinkIpc, cclinkIpcEvents } from '../../shared/ipc/cclink'
import { remoteIpc } from '../../shared/ipc/remote'
import { CCLINK_UNCONFIGURED_MESSAGE } from './service-config'
import { bindIpcParser } from '../../shared/ipc/contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { CclinkRemoteService } from './cclink-remote-service'

const phoneSchema = z.string().regex(/^1[3-9]\d{9}$/u, '请输入有效的手机号')
const codeSchema = z.string().regex(/^\d{4,8}$/u, '请输入有效的短信验证码')
const idSchema = z.string().trim().min(1).max(256)
export const cclinkRemotePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), '路径包含空字符')
export const cclinkRemoteRefSchema = z
  .object({
    kind: z.literal('remote'),
    transport: z.literal('cclink'),
    endpointId: idSchema,
    workspaceId: idSchema,
    path: cclinkRemotePathSchema,
    label: z.string().max(256).optional(),
    endpointName: z.string().max(256).optional(),
  })
  .strict()

const noArgs = <T>(definition: { channel: string }) =>
  bindIpcParser<[], T>(definition, (args) => z.tuple([]).parse(args))

export function registerCclinkRemoteIpc(
  mainWindow: BrowserWindow,
  service: CclinkRemoteService,
  guard: TrustedRendererGuard,
): () => void {
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
    bindIpcParser(remoteIpc.getStatus, (args) => z.tuple([cclinkRemoteRefSchema]).parse(args)),
    guard,
    (_event, ref) => service.getStatus(ref),
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

  return unsubscribeStatus
}
