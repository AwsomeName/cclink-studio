export interface TerminalContextSurface {
  getSelectionText: () => string
  copy: () => void | Promise<void>
  paste: () => void | Promise<void>
  clear: () => void
  openFind: () => void
}

const surfaces = new Map<string, TerminalContextSurface>()

export function registerTerminalContextSurface(
  sessionId: string,
  surface: TerminalContextSurface,
): () => void {
  surfaces.set(sessionId, surface)
  return () => {
    if (surfaces.get(sessionId) === surface) surfaces.delete(sessionId)
  }
}

export function getTerminalContextSurface(sessionId: string): TerminalContextSurface | null {
  return surfaces.get(sessionId) ?? null
}

export async function pasteClipboardToTerminal(
  sessionId: string,
  readClipboard: () => Promise<string> = () => navigator.clipboard.readText(),
): Promise<void> {
  const text = await readClipboard()
  if (!text) return
  const result = await window.cclinkStudio.terminal.writePty({
    terminalSessionId: sessionId,
    data: text,
  })
  if (!result.success) throw new Error(result.error ?? 'Terminal 粘贴失败')
}
