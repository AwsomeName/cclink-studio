import { z } from 'zod'
import { defineIpcInvoke, defineNoArgsIpc, ipcArgs } from './contract'

const id = z.uuid()
const deviceName = z.string().trim().min(1).max(80)
const host = z.union([z.hostname(), z.ipv4(), z.ipv6()])
const port = z.number().int().min(5900).max(5999)

/**
 * A remote desktop device is a machine-local fact (LAN addresses differ per network), so the
 * catalog lives in Studio's userData. Workbench Tabs only keep `deviceId`; host, port and any
 * saved credential never enter project/workspace state.
 */
export interface RemoteDesktopDevice {
  id: string
  name: string
  host: string
  port: number
  /** Whether a username/password is saved in CredentialService; the values never leave main except for one bounded autofill per session. */
  savedCredential: boolean
  updatedAt: number
}

const saveDeviceInput = z
  .object({
    id: id.nullable(),
    name: deviceName,
    host,
    port,
  })
  .strict()
export type SaveRemoteDesktopDeviceInput = z.infer<typeof saveDeviceInput>

const connection = z
  .object({
    sessionId: id,
    tabId: z.string().min(1).max(200),
    workspaceKey: z.string().max(4096).nullable(),
    ownerKey: z.string().max(512).nullable(),
    deviceId: id,
  })
  .strict()
export type DesktopConnection = z.infer<typeof connection>

const credential = z
  .object({
    username: z.string().min(1).max(256),
    password: z.string().min(1).max(1024),
  })
  .strict()
export type DesktopCredential = z.infer<typeof credential>

export type DesktopRead = Uint8Array | null
export type DesktopOpenResult =
  | { ok: true; host: string; port: number }
  | { ok: false; reason: 'device-missing' | 'tab-mismatch' | 'busy' }

export type DesktopImagePasteResult =
  | 'sent'
  | 'sent-scaled'
  | 'no-image'
  | 'unsupported'
  | 'cancelled'
  | 'failed'

export const desktopIpc = {
  listDevices: defineNoArgsIpc<RemoteDesktopDevice[]>('remoteDesktop:listDevices'),
  saveDevice: defineIpcInvoke<[SaveRemoteDesktopDeviceInput], RemoteDesktopDevice>(
    'remoteDesktop:saveDevice',
    (args) => ipcArgs(saveDeviceInput.parse(args[0])),
  ),
  forgetCredential: defineIpcInvoke<[string], RemoteDesktopDevice | null>(
    'remoteDesktop:forgetCredential',
    (args) => ipcArgs(id.parse(args[0])),
  ),
  open: defineIpcInvoke<[DesktopConnection], DesktopOpenResult>('remoteDesktop:open', (args) =>
    ipcArgs(connection.parse(args[0])),
  ),
  /** Saved credential for the device of this open session; at most once per session. */
  savedCredential: defineIpcInvoke<[string], DesktopCredential | null>(
    'remoteDesktop:savedCredential',
    (args) => ipcArgs(id.parse(args[0])),
  ),
  /** Save credentials that just authenticated this session (only after RFB connect). */
  rememberCredential: defineIpcInvoke<[string, DesktopCredential], boolean>(
    'remoteDesktop:rememberCredential',
    (args) => ipcArgs(id.parse(args[0]), credential.parse(args[1])),
  ),
  copyText: defineIpcInvoke<[string, number, string | null], boolean>(
    'remoteDesktop:copyText',
    (args) =>
      ipcArgs(
        id.parse(args[0]),
        z.number().int().positive().max(0xffffffff).parse(args[1]),
        z
          .string()
          .min(1)
          .max(1024 * 1024)
          .nullable()
          .parse(args[2]),
      ),
  ),
  pasteImage: defineIpcInvoke<[string, boolean], DesktopImagePasteResult>(
    'remoteDesktop:pasteImage',
    (args) => ipcArgs(id.parse(args[0]), z.boolean().parse(args[1])),
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
  listDevices(): Promise<RemoteDesktopDevice[]>
  saveDevice(input: SaveRemoteDesktopDeviceInput): Promise<RemoteDesktopDevice>
  forgetCredential(deviceId: string): Promise<RemoteDesktopDevice | null>
  open(input: DesktopConnection): Promise<DesktopOpenResult>
  savedCredential(sessionId: string): Promise<DesktopCredential | null>
  rememberCredential(sessionId: string, credential: DesktopCredential): Promise<boolean>
  copyText(sessionId: string, sequence: number, text: string | null): Promise<boolean>
  pasteImage(sessionId: string, serverSupportsImage: boolean): Promise<DesktopImagePasteResult>
  read(sessionId: string): Promise<DesktopRead>
  write(sessionId: string, bytes: Uint8Array): Promise<boolean>
  close(sessionId: string): Promise<void>
}
