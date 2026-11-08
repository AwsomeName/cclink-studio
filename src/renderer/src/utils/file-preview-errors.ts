export function shouldUseLegacyReadFallback(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  // Electron prefixes every handler error with the channel name. The channel
  // alone is not evidence that the handler is missing.
  return /renderFile is not a function|No handler registered/i.test(message)
}
