export interface TerminalReplayDisposable {
  dispose(): void
}

export interface TerminalReplayPort {
  write(data: string, callback?: () => void): void
  onData(listener: (data: string) => void): TerminalReplayDisposable
}

/**
 * Historical terminal output can contain device queries. Parse it before wiring
 * onData so xterm's generated replies are not sent back to the live PTY.
 */
export function subscribeTerminalInputAfterReplay(
  terminal: TerminalReplayPort,
  replay: string,
  forwardInput: (data: string) => void,
): TerminalReplayDisposable {
  let disposed = false
  let inputSubscription: TerminalReplayDisposable | null = null

  const subscribe = (): void => {
    if (disposed) return
    inputSubscription = terminal.onData(forwardInput)
  }

  if (replay) {
    terminal.write(replay, subscribe)
  } else {
    subscribe()
  }

  return {
    dispose: () => {
      disposed = true
      inputSubscription?.dispose()
      inputSubscription = null
    },
  }
}
