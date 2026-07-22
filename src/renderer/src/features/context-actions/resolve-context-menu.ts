import type { Command, CommandAvailability, CommandRisk } from '../../stores/command-store'
import type { CommandContext } from './context-target'
import { resolveMenuContributionResult, type MenuContribution } from './menu-contribution-registry'

export interface ResolvedContextMenuItem {
  contribution: MenuContribution
  commandId: string
  label: string
  enabled: boolean
  disabledReason?: string
  risk?: CommandRisk
  checked?: boolean
  shortcut?: string
}

export interface ContextMenuBuildFailure {
  contributionId: string
  commandId?: string
  message: string
}

function resolveAvailability(value: CommandAvailability | undefined): {
  enabled: boolean
  reason?: string
} {
  if (value === undefined) return { enabled: true }
  if (typeof value === 'boolean') return { enabled: value }
  return { enabled: value.enabled, reason: value.reason }
}

export function resolveContextMenu(input: {
  contributions: MenuContribution[]
  commands: Command[]
  context: CommandContext
}): { items: ResolvedContextMenuItem[]; failures: ContextMenuBuildFailure[] } {
  const contributionResult = resolveMenuContributionResult(input.contributions, input.context)
  const failures: ContextMenuBuildFailure[] = contributionResult.failures.map((failure) => ({
    contributionId: failure.contributionId,
    message: failure.message,
  }))
  const items = contributionResult.contributions.flatMap((contribution) => {
    const command = input.commands.find((item) => item.id === contribution.commandId)
    if (!command) {
      failures.push({
        contributionId: contribution.id,
        commandId: contribution.commandId,
        message: 'Contribution 引用了未注册命令',
      })
      return []
    }
    try {
      if (command.visible && !command.visible(input.context)) return []
      const availability = resolveAvailability(command.enabled?.(input.context))
      return [
        {
          contribution,
          commandId: command.id,
          label: command.contextLabel?.(input.context) ?? command.label,
          enabled: availability.enabled,
          disabledReason: availability.reason,
          risk: command.risk,
          checked: command.checked?.(input.context),
          shortcut: command.shortcut,
        },
      ]
    } catch (error) {
      failures.push({
        contributionId: contribution.id,
        commandId: command.id,
        message: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  })
  return { items, failures }
}
