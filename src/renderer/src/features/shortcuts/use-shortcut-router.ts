import { useEffect, useMemo } from 'react'
import { isMacPlatform, keyChordFromKeyboardEvent, keyChordId } from '@shared/keybindings'
import { useCommandStore } from '../../stores/command-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTabStore } from '../../stores/tab-store'
import { isHtmlFilePath } from '../../utils/html-files'
import { resolveEffectiveKeybindings } from './keybinding-resolver'
import { consumeShortcutCaptureEvent } from './shortcut-capture'

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  )
}

function scopeIsActive(scope: string): boolean {
  const tab = useTabStore.getState().getActiveTab()
  if (scope === 'global') return true
  if (!tab) return false
  if (scope === 'workbench') return true
  if (scope === 'editor') return tab.type === 'editor'
  if (scope === 'markdown') {
    return tab.type === 'editor' && (!tab.filePath || !isHtmlFilePath(tab.filePath))
  }
  if (scope === 'terminal') return tab.type === 'terminal'
  if (scope === 'browser') return tab.type === 'browser'
  return false
}

export function useShortcutRouter(): void {
  const commands = useCommandStore((state) => state.commands)
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const overrides = useSettingsStore((state) => state.settings.keybindingOverrides)
  const bindings = useMemo(
    () => resolveEffectiveKeybindings(commands, overrides),
    [commands, overrides],
  )

  useEffect(() => {
    const route = (event: KeyboardEvent): void => {
      if (consumeShortcutCaptureEvent(event)) return
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      const chord = keyChordFromKeyboardEvent(event, isMacPlatform(navigator.platform))
      if (!chord) return
      const chordId = keyChordId(chord)
      const editing = isTextEditingTarget(event.target)
      const binding = bindings.find(
        (candidate) =>
          keyChordId(candidate.chord) === chordId &&
          scopeIsActive(candidate.scope) &&
          (!editing || candidate.inputPolicy === 'allow'),
      )
      if (!binding) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      void executeCommand(binding.commandId, { source: 'shortcut' })
    }
    window.addEventListener('keydown', route, true)
    return () => window.removeEventListener('keydown', route, true)
  }, [bindings, executeCommand])
}
