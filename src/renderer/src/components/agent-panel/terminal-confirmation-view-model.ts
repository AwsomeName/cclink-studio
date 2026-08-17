import { useMemo, useState } from 'react'
import { useTerminalStore } from '../../stores/terminal-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { workspaceRefKey } from '@shared/workspace-ref'
import { isTerminalConfirmationVisible } from '../../utils/workspace-resource-visibility'
import {
  formatTerminalExpiresIn,
  formatTerminalRuntime,
  TERMINAL_ACTOR_LABEL,
  TERMINAL_RISK_LABEL,
} from '../../utils/terminal-confirmation'
import type { AgentPanelPermissionModel } from './agent-panel-view'

export function useTerminalConfirmationViewModels(): AgentPanelPermissionModel[] {
  const allPendingConfirmations = useTerminalStore((state) => state.pendingConfirmations)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const removePendingConfirmation = useTerminalStore((state) => state.removePendingConfirmation)
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set())
  const activeWorkspaceKey = workspaceRefKey(activeWorkspaceRef)
  const pendingConfirmations = useMemo(
    () =>
      allPendingConfirmations.filter((request) =>
        isTerminalConfirmationVisible(request, activeWorkspaceKey),
      ),
    [activeWorkspaceKey, allPendingConfirmations],
  )

  const resolveConfirmation = async (id: string, approved: boolean): Promise<void> => {
    setResolvingIds((current) => new Set(current).add(id))
    try {
      await window.cclinkStudio.terminal.resolveCommandConfirmation(id, approved)
    } finally {
      removePendingConfirmation(id)
      setResolvingIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  return pendingConfirmations.map((request) => {
    const resolving = resolvingIds.has(request.id)
    return {
      id: `terminal:${request.id}`,
      title: 'Terminal 命令确认',
      tone: 'warning',
      rows: [
        { label: '命令', value: request.command, monospace: true },
        { label: '位置', value: formatTerminalRuntime(request.runtime) },
        ...(request.cwd ? [{ label: '目录', value: request.cwd, monospace: true }] : []),
        { label: '来源', value: TERMINAL_ACTOR_LABEL[request.actor] },
        { label: '风险', value: TERMINAL_RISK_LABEL[request.risk], tone: 'warning' },
        { label: '原因', value: request.reason },
        { label: '有效', value: formatTerminalExpiresIn(request) },
      ],
      actions: [
        {
          id: 'approve',
          label: '允许一次',
          tone: 'approve',
          disabled: resolving,
          onInvoke: () => void resolveConfirmation(request.id, true),
        },
        {
          id: 'reject',
          label: '拒绝',
          tone: 'reject',
          disabled: resolving,
          onInvoke: () => void resolveConfirmation(request.id, false),
        },
      ],
    }
  })
}
