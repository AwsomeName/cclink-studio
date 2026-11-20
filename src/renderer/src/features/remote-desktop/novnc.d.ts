declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      channel: import('./desktop-channel').DesktopChannel,
      options?: { shared: boolean },
    )
    scaleViewport: boolean
    viewOnly: boolean
    disconnect(): void
    blur(): void
    sendCredentials(credentials: { username?: string; password: string }): void
  }
}
