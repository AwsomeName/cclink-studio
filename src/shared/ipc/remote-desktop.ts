import { z } from 'zod'
import { defineIpcInvoke, ipcArgs } from './contract'

const id = z.uuid()
const connection = z
  .object({
    sessionId: id,
    tabId: z.string().min(1).max(200),
    workspaceKey: z.string().max(4096).nullable(),
    ownerKey: z.string().max(512).nullable(),
    host: z.union([z.hostname(), z.ipv4(), z.ipv6()]),
    port: z.number().int().min(5900).max(5999),
  })
  .strict()
export type DesktopConnection = z.infer<typeof connection>
export type DesktopRead = Uint8Array | null
export const desktopIpc = {
  open: defineIpcInvoke<[DesktopConnection], boolean>('remoteDesktop:open', (args) =>
    ipcArgs(connection.parse(args[0])),
  ),
  read: defineIpcInvoke<[string], DesktopRead>('remoteDesktop:read', (args) =>
    ipcArgs(id.parse(args[0])),
  ),
  write: defineIpcInvoke<[string, Uint8Array], boolean>('remoteDesktop:write', (args) =>
    ipcArgs(
      id.parse(args[0]),
      z
        .instanceof(Uint8Array)
        .refine((b) => b.byteLength > 0 && b.byteLength <= 65536)
        .parse(args[1]),
    ),
  ),
  close: defineIpcInvoke<[string], void>('remoteDesktop:close', (args) =>
    ipcArgs(id.parse(args[0])),
  ),
}
export interface DesktopApi {
  open(input: DesktopConnection): Promise<boolean>
  read(sessionId: string): Promise<DesktopRead>
  write(sessionId: string, bytes: Uint8Array): Promise<boolean>
  close(sessionId: string): Promise<void>
}
