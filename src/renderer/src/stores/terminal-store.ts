import { create } from 'zustand'
import type { TerminalCommandConfirmationRequest } from '../types'
import type { TerminalExecutionEvent } from '@shared/terminal'

export interface TerminalOutputLine {
  id: string
  sessionId: string
  kind: 'command' | 'stdout' | 'stderr' | 'system' | 'error'
  text: string
  timestamp: number
}

interface TerminalState {
  pendingConfirmations: TerminalCommandConfirmationRequest[]
  outputBySessionId: Record<string, TerminalOutputLine[]>
  addPendingConfirmation: (request: TerminalCommandConfirmationRequest) => void
  removePendingConfirmation: (id: string) => void
  clearPendingConfirmations: () => void
  appendOutputLine: (line: Omit<TerminalOutputLine, 'id'>) => void
  appendExecutionEvent: (event: TerminalExecutionEvent) => void
  clearOutput: (sessionId: string) => void
}

const MAX_OUTPUT_LINES_PER_SESSION = 1000

export const useTerminalStore = create<TerminalState>((set) => ({
  pendingConfirmations: [],
  outputBySessionId: {},

  addPendingConfirmation: (request) =>
    set((state) => {
      const existing = state.pendingConfirmations.find((item) => item.id === request.id)
      if (existing) {
        return {
          pendingConfirmations: state.pendingConfirmations.map((item) =>
            item.id === request.id ? request : item,
          ),
        }
      }
      return {
        pendingConfirmations: [...state.pendingConfirmations, request],
      }
    }),

  removePendingConfirmation: (id) =>
    set((state) => ({
      pendingConfirmations: state.pendingConfirmations.filter((request) => request.id !== id),
    })),

  clearPendingConfirmations: () => set({ pendingConfirmations: [] }),

  appendOutputLine: (line) =>
    set((state) => {
      const current = state.outputBySessionId[line.sessionId] ?? []
      const next = [
        ...current,
        {
          ...line,
          id: `terminal-output-${line.timestamp}-${current.length}-${Math.random().toString(36).slice(2, 8)}`,
        },
      ].slice(-MAX_OUTPUT_LINES_PER_SESSION)
      return {
        outputBySessionId: {
          ...state.outputBySessionId,
          [line.sessionId]: next,
        },
      }
    }),

  appendExecutionEvent: (event) => {
    if (event.kind === 'output') {
      useTerminalStore.getState().appendOutputLine({
        sessionId: event.sessionId,
        kind: event.stream,
        text: event.data,
        timestamp: event.timestamp,
      })
      return
    }
    if (event.kind === 'started') {
      useTerminalStore.getState().appendOutputLine({
        sessionId: event.sessionId,
        kind: 'system',
        text: `Terminal 进程已启动${event.processId ? `：${event.processId}` : ''}\n`,
        timestamp: event.timestamp,
      })
      return
    }
    if (event.kind === 'exit') {
      useTerminalStore.getState().appendOutputLine({
        sessionId: event.sessionId,
        kind: 'system',
        text: `\nTerminal 进程已退出${typeof event.exitCode === 'number' ? `，退出码 ${event.exitCode}` : ''}${event.signal ? `，信号 ${event.signal}` : ''}\n`,
        timestamp: event.timestamp,
      })
      return
    }
    if (event.kind === 'error') {
      useTerminalStore.getState().appendOutputLine({
        sessionId: event.sessionId,
        kind: 'error',
        text: `${event.message}\n`,
        timestamp: event.timestamp,
      })
    }
  },

  clearOutput: (sessionId) =>
    set((state) => {
      const next = { ...state.outputBySessionId }
      delete next[sessionId]
      return { outputBySessionId: next }
    }),
}))
