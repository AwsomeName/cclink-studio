import { useEffect } from 'react'
import { useTerminalStore } from '../stores/terminal-store'
import { useTabStore } from '../stores/tab-store'
import type { TerminalCommandConfirmationRequest } from '../types'
import type { TerminalExecutionEvent, TerminalTabRef } from '@shared/terminal'

export function useTerminalEvents(): void {
  useEffect(() => {
    const offConfirmation = window.deepink.terminal.onRequestCommandConfirmation(
      (request: TerminalCommandConfirmationRequest) => {
        useTerminalStore.getState().addPendingConfirmation(request)
      },
    )
    const offExecutionEvent = window.deepink.terminal.onExecutionEvent(
      (event: TerminalExecutionEvent) => {
        useTerminalStore.getState().appendExecutionEvent(event)
        updateTerminalTabFromExecutionEvent(event)
      },
    )

    return () => {
      offConfirmation()
      offExecutionEvent()
    }
  }, [])
}

function updateTerminalTabFromExecutionEvent(event: TerminalExecutionEvent): void {
  const tabStore = useTabStore.getState()
  const tab = tabStore.tabs.find((item) => item.terminal?.sessionId === event.sessionId)
  if (!tab?.terminal) return

  const terminal = patchTerminalFromExecutionEvent(tab.terminal, event)
  tabStore.updateTabTerminal(tab.id, terminal)
}

function patchTerminalFromExecutionEvent(
  terminal: TerminalTabRef,
  event: TerminalExecutionEvent,
): TerminalTabRef {
  if (event.kind === 'started') {
    return {
      ...terminal,
      status: 'running',
      processId: event.processId,
    }
  }
  if (event.kind === 'exit') {
    return {
      ...terminal,
      status: 'exited',
    }
  }
  if (event.kind === 'error') {
    return {
      ...terminal,
      status: 'error',
    }
  }
  return terminal
}
