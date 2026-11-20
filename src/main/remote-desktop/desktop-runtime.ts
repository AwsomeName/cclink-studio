import { createConnection, type Socket } from 'node:net'
import { desktopIpc } from '../../shared/ipc/remote-desktop'
import {
  registerTrustedIpcContract,
  TrustedIpcRegistrationScope,
} from '../ipc/trusted-renderer-guard'
import type { CclinkStudioRuntimeState } from '../runtime/app-runtime'
import type { RuntimeService } from '../runtime/service-registry'

interface Session {
  socket: Socket
  chunks: AsyncIterator<Buffer>
  tabId: string
  verified: boolean
  reading: boolean
  senderId: number
}

export function createDesktopRuntime(runtime: CclinkStudioRuntimeState): RuntimeService {
  const sessions = new Map<string, Session>()
  let dispose: (() => void) | undefined
  const close = (id: string): void => {
    sessions.get(id)?.socket.destroy()
    sessions.delete(id)
  }
  const clear = (): void => {
    for (const id of sessions.keys()) close(id)
  }
  return {
    name: 'remote-desktop',
    start() {
      const trusted = runtime.trustedRendererGuard
      const wc = runtime.mainWindow?.webContents
      if (!trusted || !wc) return
      const registrations = new TrustedIpcRegistrationScope()
      const guard = {
        assert: trusted.assert.bind(trusted),
        isTrusted: trusted.isTrusted.bind(trusted),
        ipcRegistrations: registrations,
      }
      let generation = 0
      const reset = (): void => {
        generation++
        clear()
      }
      wc.on('did-start-loading', reset)
      wc.on('render-process-gone', reset)
      wc.on('destroyed', reset)
      dispose = () => {
        reset()
        wc.removeListener('did-start-loading', reset)
        wc.removeListener('render-process-gone', reset)
        wc.removeListener('destroyed', reset)
        registrations.dispose()
      }
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
          target.host !== input.host ||
          target.port !== input.port
        )
          return false
        if (
          sessions.has(input.sessionId) ||
          sessions.size >= 8 ||
          [...sessions.values()].some((s) => s.tabId === input.tabId)
        )
          return false
        const socket = createConnection({ host: input.host, port: input.port })
        socket.setNoDelay(true)
        socket.setTimeout(12000, () => socket.destroy())
        socket.on('error', () => socket.destroy())
        const session: Session = {
          socket,
          chunks: socket[Symbol.asyncIterator](),
          tabId: input.tabId,
          verified: false,
          reading: false,
          senderId: event.sender.id,
        }
        socket.once('close', () => {
          if (sessions.get(input.sessionId) === session) sessions.delete(input.sessionId)
        })
        sessions.set(input.sessionId, session)
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
      registerTrustedIpcContract(desktopIpc.write, guard, (event, id, bytes) => {
        const s = sessions.get(id)
        if (!s?.verified || s.senderId !== event.sender.id || s.socket.destroyed) return false
        if (s.socket.writableLength > 1024 * 1024) {
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
