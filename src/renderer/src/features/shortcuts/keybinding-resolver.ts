import type { KeyChord, KeybindingOverride } from '@shared/keybindings'
import { keyChordId, normalizeKeyChord } from '@shared/keybindings'
import type { Command } from '../../stores/command-store'

function shortcutScopesOverlap(left: string, right: string): boolean {
  if (left === right) return true
  // Global commands deliberately coexist with a more specific command. The router
  // selects the specific scope first (for example Markdown bold before sidebar toggle).
  if (left === 'global' || right === 'global') return false
  if (left === 'workbench' || right === 'workbench') return true
  return (left === 'editor' && right === 'markdown') || (left === 'markdown' && right === 'editor')
}

export interface EffectiveKeybinding {
  commandId: string
  chord: KeyChord
  scope: NonNullable<Command['shortcutPolicy']>['scope']
  inputPolicy: NonNullable<Command['shortcutPolicy']>['inputPolicy']
}

export function effectiveBindingsForCommand(
  command: Command,
  overrides: KeybindingOverride[],
): KeyChord[] {
  const policy = command.shortcutPolicy
  if (!policy) return []
  const override = overrides.find((candidate) => candidate.commandId === command.id)
  return (override?.bindings ?? policy.defaultBindings).map(normalizeKeyChord)
}

export function resolveEffectiveKeybindings(
  commands: Command[],
  overrides: KeybindingOverride[],
): EffectiveKeybinding[] {
  return commands.flatMap((command) => {
    const policy = command.shortcutPolicy
    if (!policy) return []
    return effectiveBindingsForCommand(command, overrides).map((chord) => ({
      commandId: command.id,
      chord,
      scope: policy.scope,
      inputPolicy: policy.inputPolicy,
    }))
  })
}

export function findKeybindingConflicts(
  commands: Command[],
  overrides: KeybindingOverride[],
  commandId: string,
  chord: KeyChord,
): Command[] {
  const command = commands.find((candidate) => candidate.id === commandId)
  if (!command?.shortcutPolicy) return []
  const commandScope = command.shortcutPolicy.scope
  const chordId = keyChordId(chord)
  return commands.filter(
    (candidate) =>
      candidate.id !== commandId &&
      candidate.shortcutPolicy &&
      shortcutScopesOverlap(candidate.shortcutPolicy.scope, commandScope) &&
      effectiveBindingsForCommand(candidate, overrides).some(
        (binding) => keyChordId(binding) === chordId,
      ),
  )
}

export function setKeybindingOverride(
  overrides: KeybindingOverride[],
  commandId: string,
  bindings: KeyChord[],
): KeybindingOverride[] {
  return [
    ...overrides.filter((candidate) => candidate.commandId !== commandId),
    { commandId, bindings: bindings.map(normalizeKeyChord) },
  ]
}

export function clearKeybindingOverride(
  overrides: KeybindingOverride[],
  commandId: string,
): KeybindingOverride[] {
  return overrides.filter((candidate) => candidate.commandId !== commandId)
}
