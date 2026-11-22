declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      channel: import('./desktop-channel').DesktopChannel,
      options?: { shared: boolean; appleClipboard?: boolean },
    )
    scaleViewport: boolean
    readonly capabilities: { appleImageClipboard?: boolean }
    sendKey(keysym: number, code: string, down?: boolean): void
    viewOnly: boolean
    showDotCursor: boolean
    disconnect(): void
    blur(): void
    focus(options?: FocusOptions): void
    sendCredentials(credentials: { username?: string; password: string }): void
  }
}
