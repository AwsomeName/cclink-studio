import { useEffect, useMemo } from 'react'
import { isMacPlatform, keyChordFromKeyboardEvent, keyChordId } from '@shared/keybindings'
import { useCommandStore } from '../../stores/command-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTabStore } from '../../stores/tab-store'
import { getEditorContextSurface } from '../context-actions/editor-context-surface'
import { useContextMenuStore } from '../context-actions/context-menu-store'
import { isAnyFloatingSurfaceOpen } from '../../components/common/floating-surface-registry'
import { resolveEffectiveKeybindings } from './keybinding-resolver'
import type { EffectiveKeybinding } from './keybinding-resolver'
import { consumeShortcutCaptureEvent } from './shortcut-capture'
import { recordRendererDiagnosticLog } from '../diagnostics/renderer-diagnostic-log'

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  )
}

function activeShortcutScopes(): Set<string> {
  const tab = useTabStore.getState().getActiveTab()
  const scopes = new Set<string>(['global'])
  if (!tab) return scopes
  scopes.add('workbench')
  if (tab.type === 'editor') {
    scopes.add('editor')
    if (getEditorContextSurface(tab.id)?.runMarkdownAction) scopes.add('markdown')
  }
  if (tab.type === 'terminal') scopes.add('terminal')
  if (tab.type === 'browser') scopes.add('browser')
  return scopes
}

const SCOPE_PRIORITY: Record<string, number> = {
  markdown: 60,
  terminal: 50,
  browser: 50,
  editor: 40,
  workbench: 30,
  global: 20,
}

export function selectShortcutBinding(
  bindings: EffectiveKeybinding[],
  chordId: string,
  activeScopes: ReadonlySet<string>,
  editing: boolean,
): EffectiveKeybinding | undefined {
  return bindings
    .filter(
      (candidate) =>
        keyChordId(candidate.chord) === chordId &&
        activeScopes.has(candidate.scope) &&
        (!editing || candidate.inputPolicy === 'allow'),
    )
    .sort((left, right) => SCOPE_PRIORITY[right.scope] - SCOPE_PRIORITY[left.scope])[0]
}

export function shouldSuppressShortcutForUi(input: {
  commandId: string
  paletteOpen: boolean
  contextMenuOpen: boolean
  floatingSurfaceOpen: boolean
  dialogOpen: boolean
}): boolean {
  if (input.paletteOpen && input.commandId !== 'workbench.showCommands') return true
  return input.contextMenuOpen || input.floatingSurfaceOpen || input.dialogOpen
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
      const binding = selectShortcutBinding(bindings, chordId, activeShortcutScopes(), editing)
      if (!binding) return
      const commandState = useCommandStore.getState()
      if (
        shouldSuppressShortcutForUi({
          commandId: binding.commandId,
          paletteOpen: commandState.paletteOpen,
          contextMenuOpen: useContextMenuStore.getState().open,
          floatingSurfaceOpen: isAnyFloatingSurfaceOpen(),
          dialogOpen: Boolean(document.querySelector('[role="dialog"], [aria-modal="true"]')),
        })
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      void executeCommand(binding.commandId, { source: 'shortcut' }).then((result) => {
        if (result.ok) return
        recordRendererDiagnosticLog('warn', [
          '[ShortcutRouter]',
          binding.commandId,
          binding.scope,
          chordId,
          result.reason ?? 'failed',
        ])
      })
    }
    window.addEventListener('keydown', route, true)
    return () => window.removeEventListener('keydown', route, true)
  }, [bindings, executeCommand])
}
