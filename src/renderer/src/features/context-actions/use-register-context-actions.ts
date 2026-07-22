import { useEffect } from 'react'
import { useCommandStore } from '../../stores/command-store'
import { useMenuContributionRegistry } from './menu-contribution-registry'
import {
  contextActionCommands,
  contextActionContributions,
  contextActionExternalCommandIds,
} from './context-action-catalog'
import { validateContextActionCatalog } from './context-action-catalog-validation'
import { useContextActionDiagnosticsStore } from './context-action-diagnostics'

export function useRegisterContextActions(): void {
  const registerCommands = useCommandStore((state) => state.registerCommands)
  const unregisterCommand = useCommandStore((state) => state.unregisterCommand)
  const registerContributions = useMenuContributionRegistry((state) => state.registerContributions)
  const unregisterContributions = useMenuContributionRegistry(
    (state) => state.unregisterContributions,
  )

  useEffect(() => {
    const issues = validateContextActionCatalog({
      commands: contextActionCommands,
      contributions: contextActionContributions,
      externalCommandIds: contextActionExternalCommandIds,
    })
    issues.forEach((issue) => {
      useContextActionDiagnosticsStore.getState().record({
        kind: 'menu-build-failed',
        contributionId: issue.id,
        message: `${issue.code}: ${issue.message}`,
      })
    })
    if (issues.length > 0) console.error('[ContextActions] Catalog 校验失败', issues)
    registerCommands(contextActionCommands)
    registerContributions(contextActionContributions)
    return () => {
      contextActionCommands.forEach((command) => unregisterCommand(command.id))
      unregisterContributions(contextActionContributions.map((item) => item.id))
    }
  }, [registerCommands, registerContributions, unregisterCommand, unregisterContributions])
}
