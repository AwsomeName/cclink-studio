import { create } from 'zustand'
import type { ContextTargetKind } from './context-target'

export type ContextActionDiagnosticKind =
  | 'menu-build-failed'
  | 'stale-target'
  | 'permission-denied'
  | 'domain-execution-failed'

export interface ContextActionDiagnosticEvent {
  id: string
  timestamp: string
  kind: ContextActionDiagnosticKind
  commandId?: string
  contributionId?: string
  targetKind?: ContextTargetKind
  message: string
}

interface ContextActionDiagnosticInput {
  kind: ContextActionDiagnosticKind
  commandId?: string
  contributionId?: string
  targetKind?: ContextTargetKind
  message?: string
}

interface ContextActionDiagnosticsState {
  events: ContextActionDiagnosticEvent[]
  record: (input: ContextActionDiagnosticInput) => void
  clear: () => void
}

const MAX_EVENTS = 50
let nextEventId = 1

export function sanitizeContextActionDiagnosticMessage(value: string): string {
  return value
    .replace(
      /\b(password|passwd|token|secret|api[-_ ]?key|authorization|cookie)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    )
    .replace(/https?:\/\/[^\s)]+/gi, '[URL]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

export const useContextActionDiagnosticsStore = create<ContextActionDiagnosticsState>((set) => ({
  events: [],
  record: (input) =>
    set((state) => ({
      events: [
        ...state.events,
        {
          id: `context-action-${nextEventId++}`,
          timestamp: new Date().toISOString(),
          kind: input.kind,
          commandId: input.commandId,
          contributionId: input.contributionId,
          targetKind: input.targetKind,
          message: sanitizeContextActionDiagnosticMessage(input.message || input.kind),
        },
      ].slice(-MAX_EVENTS),
    })),
  clear: () => set({ events: [] }),
}))

export function classifyContextActionCommandFailure(input: {
  reason?: string
  message?: string
}): ContextActionDiagnosticKind | null {
  if (input.reason === 'stale-target') return 'stale-target'
  if (/权限|拒绝|permission|unauthori[sz]ed|forbidden/i.test(input.message ?? '')) {
    return 'permission-denied'
  }
  if (input.reason === 'missing-command' || input.reason === 'hidden') return 'menu-build-failed'
  if (input.reason === 'failed') return 'domain-execution-failed'
  return null
}

export function formatContextActionDiagnosticsMarkdown(
  events: ContextActionDiagnosticEvent[],
): string {
  const lines = ['', '## 上下文操作']
  if (events.length === 0) {
    lines.push('- 最近无失败记录')
    return lines.join('\n')
  }
  const counts = new Map<ContextActionDiagnosticKind, number>()
  events.forEach((event) => counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1))
  lines.push(
    `- 失败分类：${[...counts.entries()].map(([kind, count]) => `${kind}=${count}`).join(' · ')}`,
  )
  events.slice(-10).forEach((event) => {
    const owner = event.commandId || event.contributionId || event.targetKind || 'unknown'
    lines.push(`- ${event.timestamp} · ${event.kind} · ${owner} · ${event.message}`)
  })
  return lines.join('\n')
}
