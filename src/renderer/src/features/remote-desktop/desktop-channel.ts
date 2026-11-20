import type { DesktopConnection } from '@shared/ipc/remote-desktop'

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
  private readonly api = window.cclinkStudio.remoteDesktop
  constructor(private readonly input: DesktopConnection) {}
  async start(): Promise<void> {
    const id = this.input.sessionId
    try {
      if (!(await this.api.open(this.input))) throw new Error('open')
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
    } catch {
      this.onerror?.()
    }
    this.close()
  }
  send(bytes: Uint8Array): void {
    if (this.readyState !== 'open') return
    void this.api
      .write(this.input.sessionId, bytes)
      .then((ok) => {
        if (!ok) this.close()
      })
      .catch(() => this.close())
  }
  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    void this.api.close(this.input.sessionId).catch(() => {})
    queueMicrotask(() => this.onclose?.(new CloseEvent('close')))
  }
}
