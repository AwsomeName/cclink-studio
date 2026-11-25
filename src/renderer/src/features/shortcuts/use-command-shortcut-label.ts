import { formatKeyChord, isMacPlatform } from '@shared/keybindings'
import { useCommandStore } from '../../stores/command-store'
import { useSettingsStore } from '../../stores/settings-store'
import { effectiveBindingsForCommand } from './keybinding-resolver'

/** The first effective chord of a command as shown to the user (e.g. "⌘L"), honouring overrides. */
export function useCommandShortcutLabel(commandId: string): string | null {
  const command = useCommandStore((state) => state.commands.find((item) => item.id === commandId))
  const overrides = useSettingsStore((state) => state.settings.keybindingOverrides)
  if (!command) return null
  const [chord] = effectiveBindingsForCommand(command, overrides)
  return chord ? formatKeyChord(chord, isMacPlatform(navigator.platform)) : null
}
