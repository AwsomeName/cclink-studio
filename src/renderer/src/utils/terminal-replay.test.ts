import { describe, expect, it, vi } from 'vitest'
import { subscribeTerminalInputAfterReplay, type TerminalReplayDisposable } from './terminal-replay'

class FakeTerminal {
  private replayCallback: (() => void) | undefined
  private listeners = new Set<(data: string) => void>()

  write(_data: string, callback?: () => void): void {
    this.replayCallback = callback
  }

  onData(listener: (data: string) => void): TerminalReplayDisposable {
    this.listeners.add(listener)
    return {
      dispose: () => this.listeners.delete(listener),
    }
  }

  emitData(data: string): void {
    for (const listener of this.listeners) listener(data)
  }

  completeReplay(): void {
    this.replayCallback?.()
  }
}

describe('subscribeTerminalInputAfterReplay', () => {
  it('does not forward device replies generated while historical output is replayed', () => {
    const terminal = new FakeTerminal()
    const forwardInput = vi.fn()

    const subscription = subscribeTerminalInputAfterReplay(
      terminal,
      '\u001b]10;?\u0007',
      forwardInput,
    )
    terminal.emitData('\u001b]10;rgb:d4d4/d4d4/d4d4\u001b\\')
    expect(forwardInput).not.toHaveBeenCalled()

    terminal.completeReplay()
    terminal.emitData('pwd\r')
    expect(forwardInput).toHaveBeenCalledWith('pwd\r')

    subscription.dispose()
    terminal.emitData('ignored')
    expect(forwardInput).toHaveBeenCalledTimes(1)
  })

  it('subscribes immediately when there is no historical output', () => {
    const terminal = new FakeTerminal()
    const forwardInput = vi.fn()

    subscribeTerminalInputAfterReplay(terminal, '', forwardInput)
    terminal.emitData('ls\r')

    expect(forwardInput).toHaveBeenCalledWith('ls\r')
  })

  it('does not subscribe when the view unmounts before replay completes', () => {
    const terminal = new FakeTerminal()
    const forwardInput = vi.fn()

    const subscription = subscribeTerminalInputAfterReplay(terminal, 'history', forwardInput)
    subscription.dispose()
    terminal.completeReplay()
    terminal.emitData('ignored')

    expect(forwardInput).not.toHaveBeenCalled()
  })
})
