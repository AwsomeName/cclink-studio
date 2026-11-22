import type { DesktopConnection, DesktopOpenResult } from '@shared/ipc/remote-desktop'

// noVNC accepts a WebSocket-shaped binary channel. The bounded IPC bridge avoids
// an externally reachable listener and keeps the renderer's network CSP intact.
export class DesktopChannel {
  binaryType = 'arraybuffer'
  protocol = ''
  readyState: 'connecting' | 'open' | 'closed' = 'connecting'
  onopen: (() => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: { data: Uint8Array }) => void) | null = null
  onerror: (() => void) | null = null
  /** Called when main refuses to open (unknown device, tab mismatch, busy). */
  onrefused: ((reason: Extract<DesktopOpenResult, { ok: false }>['reason']) => void) | null = null
  private readonly api = window.cclinkStudio.remoteDesktop
  private pointerMessages?: Uint8Array[]
  constructor(private readonly input: DesktopConnection) {}
  async start(): Promise<void> {
    const id = this.input.sessionId
    try {
      const opened = await this.api.open(this.input)
      if (!opened.ok) {
        this.onrefused?.(opened.reason)
        throw new Error(`open refused: ${opened.reason}`)
      }
      if (this.readyState === 'closed') {
        await this.api.close(id)
        return
      }
      this.readyState = 'open'
      this.onopen?.()
      while (this.readyState === 'open') {
        const bytes = await this.api.read(id)
        if (!bytes) break
        if (this.readyState === 'open') this.onmessage?.({ data: bytes })
      }
    } catch (error) {
      console.warn('[RemoteDesktop] channel error', String(error))
      this.onerror?.()
    }
    this.close()
  }
  send(bytes: Uint8Array): void {
    if (this.readyState !== 'open') return
    if (this.pointerMessages) {
      // noVNC reuses its send buffer immediately after send() returns.
      this.pointerMessages.push(bytes.slice())
      return
    }
    void this.api
      .write(this.input.sessionId, bytes)
      .then((ok) => {
        if (ok) return
        console.warn('[RemoteDesktop] write rejected by main process; closing channel')
        this.close()
      })
      .catch((error) => {
        console.warn('[RemoteDesktop] write failed; closing channel', String(error))
        this.close()
      })
  }
  /** One wheel event produces a bounded burst of RFB presses and releases in the same JS turn. */
  batchPointerInput(emit: () => void): void {
    const messages: Uint8Array[] = []
    this.pointerMessages = messages
    try {
      emit()
    } finally {
      this.pointerMessages = undefined
      if (messages.length) {
        const packet = new Uint8Array(messages.reduce((total, bytes) => total + bytes.length, 0))
        let offset = 0
        for (const bytes of messages) {
          packet.set(bytes, offset)
          offset += bytes.length
        }
        this.send(packet)
      }
    }
  }
  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    void this.api.close(this.input.sessionId).catch(() => {})
    queueMicrotask(() => this.onclose?.(new CloseEvent('close')))
  }
}
