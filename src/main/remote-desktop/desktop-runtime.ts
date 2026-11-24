import { app, clipboard, type Input } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createConnection, type Socket } from 'node:net'
import { join } from 'node:path'
import { desktopIpc, type RemoteDesktopDevice } from '../../shared/ipc/remote-desktop'
import {
  registerTrustedIpcContract,
  TrustedIpcRegistrationScope,
} from '../ipc/trusted-renderer-guard'
import type { CclinkStudioRuntimeState } from '../runtime/app-runtime'
import type { RuntimeService } from '../runtime/service-registry'
import { packClipboardImage } from './apple-image-clipboard'
import { RemoteDesktopDeviceStore, type StoredDesktopDevice } from './device-store'

// Electron exposes pasteboard contents but not NSPasteboard.changeCount. Read only
// the generation, asynchronously, without opening another app or copying any contents.
const run = promisify(execFile)
async function pasteboardRevision(): Promise<number | null> {
  try {
    const { stdout } = await run(
      '/usr/bin/osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        "ObjC.import('AppKit'); Number($.NSPasteboard.generalPasteboard.changeCount)",
      ],
      { timeout: 2000, maxBuffer: 128 },
    )
    return /^\d+$/.test(stdout.trim()) ? Number(stdout.trim()) : null
  } catch {
    return null
  }
}

interface Session {
  remoteCopy?: { sequence: number; expires: number; baseline: Promise<number | null> }

  socket: Socket
  chunks: AsyncIterator<Buffer>
  workspaceKey: string | null
  ownerKey: string | null
  appleViewer: boolean
  sendingImage: boolean
  pendingImageBytes: number
  tabId: string
  deviceId: string
  verified: boolean
  reading: boolean
  senderId: number
  savedCredentialUsed: boolean
}

export const remoteDesktopCredentialId = (deviceId: string): string => `remote-desktop:${deviceId}`

export function createDesktopRuntime(runtime: CclinkStudioRuntimeState): RuntimeService {
  const sessions = new Map<string, Session>()
  let store: RemoteDesktopDeviceStore | undefined
  let dispose: (() => void) | undefined
  const close = (id: string): void => {
    sessions.get(id)?.socket.destroy()
    sessions.delete(id)
  }
  const clear = (): void => {
    for (const id of sessions.keys()) close(id)
  }
  const credentials = () => {
    const service = runtime.credentialService
    return service && service.getStatus().status === 'ready' ? service : null
  }
  const project = (device: StoredDesktopDevice): RemoteDesktopDevice => {
    let savedCredential = false
    try {
      savedCredential = Boolean(
        credentials()?.resolveCredential(remoteDesktopCredentialId(device.id))?.password,
      )
    } catch {
      /* credential file unavailable: report as not saved */
    }
    return {
      id: device.id,
      name: device.name,
      host: device.host,
      port: device.port,
      savedCredential,
      updatedAt: device.updatedAt,
    }
  }
  return {
    name: 'remote-desktop',
    start() {
      const trusted = runtime.trustedRendererGuard
      const wc = runtime.mainWindow?.webContents
      if (!trusted || !wc) return
      const devices = (store ??= new RemoteDesktopDeviceStore(
        join(app.getPath('userData'), 'remote-desktop'),
      ))
      const registrations = new TrustedIpcRegistrationScope()
      const guard = {
        assert: trusted.assert.bind(trusted),
        isTrusted: trusted.isTrusted.bind(trusted),
        ipcRegistrations: registrations,
      }
      let generation = 0
      // Renderer code alone cannot trigger a read of the system pasteboard.
      let pasteGestureUntil = 0
      let copyGestureUntil = 0
      let focusRevision = 0
      const invalidateGesture = (): void => {
        pasteGestureUntil = 0
        copyGestureUntil = 0
        focusRevision++
      }
      const beforeInput = (_event: Electron.Event, input: Input): void => {
        if (input.type !== 'keyDown' || input.isAutoRepeat) return
        copyGestureUntil =
          (input.code === 'KeyC' || input.code === 'KeyX') &&
          input.meta &&
          !input.shift &&
          !input.alt &&
          !input.control
            ? Date.now() + 1000
            : 0
        pasteGestureUntil =
          input.code === 'KeyV' && input.meta && !input.shift && !input.alt && !input.control
            ? Date.now() + 1000
            : 0
      }
      wc.on('before-input-event', beforeInput)
      wc.on('blur', invalidateGesture)
      const reset = (): void => {
        invalidateGesture()
        generation++
        clear()
      }
      wc.on('did-start-loading', reset)
      wc.on('render-process-gone', reset)
      wc.on('destroyed', reset)
      dispose = () => {
        reset()
        wc.removeListener('before-input-event', beforeInput)
        wc.removeListener('blur', invalidateGesture)
        wc.removeListener('did-start-loading', reset)
        wc.removeListener('render-process-gone', reset)
        wc.removeListener('destroyed', reset)
        registrations.dispose()
      }
      registerTrustedIpcContract(desktopIpc.listDevices, guard, async () =>
        (await devices.list()).sort((a, b) => b.updatedAt - a.updatedAt).map(project),
      )
      registerTrustedIpcContract(desktopIpc.saveDevice, guard, async (_event, input) =>
        project(await devices.save(input)),
      )
      registerTrustedIpcContract(desktopIpc.forgetCredential, guard, async (_event, deviceId) => {
        const device = await devices.get(deviceId)
        if (!device) return null
        await credentials()?.removeCredential(remoteDesktopCredentialId(deviceId))
        return project(device)
      })
      registerTrustedIpcContract(desktopIpc.open, guard, async (event, input) => {
        const revision = generation
        const projection = await runtime.workbenchTabModel?.getProjection(
          input.workspaceKey,
          input.ownerKey,
        )
        const tab = projection?.tabs.find(
          (t) => t.id === input.tabId && t.type === 'remote-desktop',
        )
        const target = tab?.desktopTarget
        if (
          generation !== revision ||
          projection?.activeTabId !== input.tabId ||
          !target ||
          typeof target !== 'object' ||
          Array.isArray(target) ||
          target.deviceId !== input.deviceId
        )
          return { ok: false, reason: 'tab-mismatch' } as const
        const device = await devices.get(input.deviceId)
        if (!device) return { ok: false, reason: 'device-missing' } as const
        if (
          generation !== revision ||
          sessions.has(input.sessionId) ||
          sessions.size >= 8 ||
          [...sessions.values()].some((s) => s.tabId === input.tabId)
        )
          return { ok: false, reason: 'busy' } as const
        const socket = createConnection({ host: device.host, port: device.port })
        socket.setNoDelay(true)
        socket.setTimeout(12000, () => socket.destroy())
        socket.on('error', () => socket.destroy())
        const session: Session = {
          socket,
          chunks: socket[Symbol.asyncIterator](),
          workspaceKey: input.workspaceKey,
          ownerKey: input.ownerKey,
          appleViewer: false,
          sendingImage: false,
          pendingImageBytes: 0,
          tabId: input.tabId,
          deviceId: device.id,
          verified: false,
          reading: false,
          senderId: event.sender.id,
          savedCredentialUsed: false,
        }
        socket.once('close', () => {
          if (sessions.get(input.sessionId) === session) sessions.delete(input.sessionId)
        })
        sessions.set(input.sessionId, session)
        return { ok: true, host: device.host, port: device.port } as const
      })
      registerTrustedIpcContract(desktopIpc.savedCredential, guard, (event, id) => {
        const session = sessions.get(id)
        // Only for an open RFB session of this sender, and only once: a failed autofill falls
        // back to manual entry instead of retrying the same password.
        if (!session?.verified || session.senderId !== event.sender.id) return null
        if (session.savedCredentialUsed) return null
        session.savedCredentialUsed = true
        try {
          const fields = credentials()?.resolveCredential(
            remoteDesktopCredentialId(session.deviceId),
          )
          return fields?.username && fields.password
            ? { username: fields.username, password: fields.password }
            : null
        } catch {
          return null
        }
      })
      registerTrustedIpcContract(desktopIpc.rememberCredential, guard, async (event, id, input) => {
        const session = sessions.get(id)
        const service = credentials()
        if (!session?.verified || session.senderId !== event.sender.id || !service) return false
        await service.setCredential({
          id: remoteDesktopCredentialId(session.deviceId),
          kind: 'basic',
          fields: { username: input.username, password: input.password },
        })
        return true
      })
      registerTrustedIpcContract(desktopIpc.read, guard, async (event, id) => {
        const session = sessions.get(id)
        if (!session || session.senderId !== event.sender.id || session.reading) return null
        session.reading = true
        try {
          let chunk = await session.chunks.next()
          if (!session.verified && !chunk.done) {
            let banner = chunk.value
            while (banner.length < 12) {
              chunk = await session.chunks.next()
              if (chunk.done) {
                close(id)
                return null
              }
              banner = Buffer.concat([banner, chunk.value])
            }
            if (!/^RFB \d{3}\.\d{3}\n$/.test(banner.subarray(0, 12).toString('ascii'))) {
              close(id)
              return null
            }
            session.appleViewer = banner.subarray(0, 12).toString('ascii') === 'RFB 003.889\n'
            session.verified = true
            session.socket.setTimeout(0)
            return new Uint8Array(banner)
          }
          if (!chunk.done) return new Uint8Array(chunk.value)
        } catch {
          /* socket ended or was closed by the Tab */
        } finally {
          session.reading = false
        }
        close(id)
        return null
      })
      registerTrustedIpcContract(desktopIpc.copyText, guard, async (event, id, sequence, text) => {
        const s = sessions.get(id)
        if (!s?.appleViewer || !s.verified || s.senderId !== event.sender.id) return false
        if (text === null) {
          if (Date.now() > copyGestureUntil || !wc.isFocused()) return false
          copyGestureUntil = 0
          s.remoteCopy = { sequence, expires: Date.now() + 8000, baseline: pasteboardRevision() }
          return true
        }
        const copy = s.remoteCopy
        if (!copy || copy.sequence !== sequence || Date.now() > copy.expires) return false
        copy.expires = 0 // consume this gesture before awaiting validation
        const original = await copy.baseline
        if (original === null) return false
        const [current, revision] = await Promise.all([
          runtime.workbenchTabModel?.getProjection(s.workspaceKey, s.ownerKey),
          pasteboardRevision(),
        ])
        if (
          s.remoteCopy !== copy ||
          sessions.get(id) !== s ||
          current?.activeTabId !== s.tabId ||
          original !== revision
        )
          return false
        clipboard.writeText(text)
        // Writing text replaces the old image. Any subsequent local image is new.
        s.remoteCopy = undefined
        return true
      })
      registerTrustedIpcContract(desktopIpc.pasteImage, guard, async (event, id, supported) => {
        const s = sessions.get(id)
        if (
          !s?.appleViewer ||
          s.senderId !== event.sender.id ||
          s.sendingImage ||
          Date.now() > pasteGestureUntil
        )
          return 'cancelled'
        pasteGestureUntil = 0
        const revision = focusRevision
        const isCurrent = async (): Promise<boolean> => {
          const view = await runtime.workbenchTabModel?.getProjection(s.workspaceKey, s.ownerKey)
          return (
            sessions.get(id) === s &&
            !s.socket.destroyed &&
            wc.isFocused() &&
            focusRevision === revision &&
            view?.activeTabId === s.tabId
          )
        }
        s.sendingImage = true
        try {
          if (!(await isCurrent())) return 'cancelled'
          const formats = clipboard.availableFormats()
          if (
            !formats.some(
              (format) =>
                format.startsWith('image/') || format === 'public.png' || format === 'public.tiff',
            )
          )
            return 'no-image'
          const copy = s.remoteCopy
          if (copy) {
            const [atCopy, now] = await Promise.all([copy.baseline, pasteboardRevision()])
            // The reply may have replaced the local image with remote text during the read.
            if (!s.remoteCopy) return 'no-image'
            if (s.remoteCopy !== copy) return 'cancelled'
            if (atCopy === null || now === null || atCopy === now) return 'no-image'
          }
          if (!supported) return 'unsupported'
          const image = clipboard.readImage()
          if (image.isEmpty()) return 'failed'
          const content = await packClipboardImage(image)
          if (!content) return 'failed'
          if (!(await isCurrent()) || s.remoteCopy !== copy) return 'cancelled'
          // One socket write keeps input packets out of the compressed body.
          s.pendingImageBytes = content.packet.length
          await new Promise<void>((resolve, reject) =>
            s.socket.write(content.packet, (error) => (error ? reject(error) : resolve())),
          )
          return content.scaled ? 'sent-scaled' : 'sent'
        } catch {
          return 'failed'
        } finally {
          s.pendingImageBytes = 0
          s.sendingImage = false
        }
      })
      registerTrustedIpcContract(desktopIpc.write, guard, (event, id, bytes) => {
        const s = sessions.get(id)
        if (!s?.verified || s.senderId !== event.sender.id || s.socket.destroyed) return false
        if (s.socket.writableLength > s.pendingImageBytes + 1024 * 1024) {
          close(id)
          return false
        }
        s.socket.write(bytes)
        return true
      })
      registerTrustedIpcContract(desktopIpc.close, guard, (event, id) => {
        if (sessions.get(id)?.senderId === event.sender.id) close(id)
      })
    },
    stop() {
      dispose?.()
      dispose = undefined
    },
  }
}
