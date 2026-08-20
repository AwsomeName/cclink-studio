interface DevToolsDebuggerClient {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, commandParams?: unknown): Promise<unknown>
}

export interface VisualPageScaleResetResult {
  before: number | null
  after: number | null
}

const resetQueues = new WeakMap<object, Promise<VisualPageScaleResetResult>>()

function readScale(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null
  const value = (result as { result?: { value?: unknown } }).result?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function readVisualPageScale(client: DevToolsDebuggerClient): Promise<number | null> {
  return readScale(
    await client.sendCommand('Runtime.evaluate', {
      expression: 'globalThis.visualViewport?.scale ?? 1',
      returnByValue: true,
    }),
  )
}

async function performReset(client: DevToolsDebuggerClient): Promise<VisualPageScaleResetResult> {
  const attachedHere = !client.isAttached()
  if (attachedHere) client.attach('1.3')
  try {
    const before = await readVisualPageScale(client)
    await client.sendCommand('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    const after = await readVisualPageScale(client)
    return { before, after }
  } finally {
    if (attachedHere && client.isAttached()) client.detach()
  }
}

/**
 * Electron page zoom and Chromium visual/pinch zoom are independent. Serialize CDP resets per
 * WebContents so overlapping activation/bounds requests cannot race debugger attach/detach.
 */
export function resetVisualPageScale(
  client: DevToolsDebuggerClient,
): Promise<VisualPageScaleResetResult> {
  const previous = resetQueues.get(client as object)
  const current = (
    previous ? previous.catch(() => ({ before: null, after: null })) : Promise.resolve()
  ).then(() => performReset(client))
  resetQueues.set(client as object, current)
  const cleanup = (): void => {
    if (resetQueues.get(client as object) === current) resetQueues.delete(client as object)
  }
  void current.then(cleanup, cleanup)
  return current
}
