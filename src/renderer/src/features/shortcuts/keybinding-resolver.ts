import type { KeyChord, KeybindingOverride } from '@shared/keybindings'
import { keyChordId, normalizeKeyChord } from '@shared/keybindings'
import type { Command } from '../../stores/command-store'

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
  const chordId = keyChordId(chord)
  return commands.filter(
    (candidate) =>
      candidate.id !== commandId &&
      candidate.shortcutPolicy?.scope === command.shortcutPolicy?.scope &&
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
