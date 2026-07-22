import type { Command } from '../../stores/command-store'
import { CONTEXT_TARGET_KINDS, type ContextTargetKind } from './context-target'
import type { MenuContribution } from './menu-contribution-registry'

export type ContextActionCatalogIssueCode =
  | 'duplicate-command-id'
  | 'duplicate-contribution-id'
  | 'orphan-contribution'
  | 'unowned-context-command'
  | 'uncovered-target-kind'
  | 'invalid-contribution'

export interface ContextActionCatalogIssue {
  code: ContextActionCatalogIssueCode
  id: string
  message: string
}

function duplicateIds(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  })
  return [...duplicates].sort()
}

export function validateContextActionCatalog(input: {
  commands: Command[]
  contributions: MenuContribution[]
  externalCommandIds?: ReadonlySet<string>
  targetKinds?: readonly ContextTargetKind[]
}): ContextActionCatalogIssue[] {
  const externalCommandIds = input.externalCommandIds ?? new Set<string>()
  const targetKinds = input.targetKinds ?? CONTEXT_TARGET_KINDS
  const issues: ContextActionCatalogIssue[] = []

  duplicateIds(input.commands.map((command) => command.id)).forEach((id) =>
    issues.push({ code: 'duplicate-command-id', id, message: `重复 commandId：${id}` }),
  )
  duplicateIds(input.contributions.map((item) => item.id)).forEach((id) =>
    issues.push({ code: 'duplicate-contribution-id', id, message: `重复 contributionId：${id}` }),
  )

  const commandIds = new Set(input.commands.map((command) => command.id))
  const ownedCommandIds = new Set(input.contributions.map((item) => item.commandId))
  input.contributions.forEach((item) => {
    if (!commandIds.has(item.commandId) && !externalCommandIds.has(item.commandId)) {
      issues.push({
        code: 'orphan-contribution',
        id: item.id,
        message: `Contribution ${item.id} 引用了未注册命令 ${item.commandId}`,
      })
    }
    if (
      item.targetKinds.length === 0 ||
      !/^\d{2}[.-]/.test(item.group) ||
      !Number.isFinite(item.order)
    ) {
      issues.push({
        code: 'invalid-contribution',
        id: item.id,
        message: `Contribution ${item.id} 缺少目标、稳定分组或有效顺序`,
      })
    }
  })

  input.commands.forEach((command) => {
    if (command.contextOnly && !ownedCommandIds.has(command.id)) {
      issues.push({
        code: 'unowned-context-command',
        id: command.id,
        message: `上下文命令 ${command.id} 没有 contribution owner`,
      })
    }
  })

  const coveredKinds = new Set(input.contributions.flatMap((item) => item.targetKinds))
  targetKinds.forEach((kind) => {
    if (!coveredKinds.has(kind)) {
      issues.push({
        code: 'uncovered-target-kind',
        id: kind,
        message: `ContextTarget ${kind} 没有菜单 contribution`,
      })
    }
  })
  return issues
}
