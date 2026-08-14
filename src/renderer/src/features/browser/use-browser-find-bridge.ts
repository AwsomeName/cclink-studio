import { useEffect, useMemo, useRef } from 'react'
import { keyChordId } from '@shared/keybindings'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useCommandStore } from '../../stores/command-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTabStore } from '../../stores/tab-store'
import { effectiveBindingsForCommand } from '../shortcuts/keybinding-resolver'
import { useBrowserFindStore } from './browser-find-store'
import { recordRendererDiagnosticLog } from '../diagnostics/renderer-diagnostic-log'

let nextShortcutConfigVersion = Date.now()

export function useBrowserFindBridge(): void {
  const commands = useCommandStore((state) => state.commands)
  const overrides = useSettingsStore((state) => state.settings.keybindingOverrides)
  const syncRevision = useBrowserFindStore((state) => state.shortcutSyncRevision)
  const findCommand = commands.find((command) => command.id === 'workbench.find')
  const bindings = useMemo(
    () => (findCommand ? effectiveBindingsForCommand(findCommand, overrides) : []),
    [findCommand, overrides],
  )
  const bindingKey = bindings.map(keyChordId).join('|')
  const appliedConfigVersionRef = useRef<number | null>(null)

  useEffect(() => {
    if (!findCommand) return
    const configVersion = ++nextShortcutConfigVersion
    let cancelled = false
    useBrowserFindStore.getState().setShortcutSync({
      status: 'pending',
      configVersion,
      message: null,
    })
    void window.cclinkStudio.browser
      .syncFindShortcut({ configVersion, bindings })
      .then((result) => {
        if (cancelled) return
        if (result.appliedConfigVersion !== configVersion) {
          throw new Error('主进程未确认当前快捷键版本')
        }
        appliedConfigVersionRef.current = configVersion
        useBrowserFindStore.getState().setShortcutSync({
          status: 'synced',
          configVersion,
          message: null,
        })
      })
      .catch((error) => {
        if (cancelled) return
        recordRendererDiagnosticLog('warn', [
          '[BrowserShortcut]',
          'workbench.find',
          'browser-sync-failed',
          configVersion,
        ])
        useBrowserFindStore.getState().setShortcutSync({
          status: 'error',
          configVersion,
          message: error instanceof Error ? error.message : '浏览器快捷键同步失败',
        })
      })
    return () => {
      cancelled = true
    }
  }, [bindingKey, findCommand, syncRevision])

  useEffect(() => {
    return window.cclinkStudio.browser.onFindShortcutTriggered((payload) => {
      if (
        payload.commandId !== 'workbench.find' ||
        payload.configVersion !== appliedConfigVersionRef.current
      ) {
        return
      }
      const state = useTabStore.getState()
      const tab = state.tabs.find((candidate) => candidate.id === payload.tabId)
      if (
        state.activeTabId !== payload.tabId ||
        tab?.type !== 'browser' ||
        !tab.workspaceRef ||
        workspaceRefKey(tab.workspaceRef) !== payload.workspaceKey
      ) {
        return
      }
      void window.cclinkStudio.browser.getRuntimeIdentity(payload.tabId).then((identity) => {
        if (
          !identity ||
          identity.runtimeGeneration !== payload.runtimeGeneration ||
          identity.workspaceKey !== payload.workspaceKey ||
          useTabStore.getState().activeTabId !== payload.tabId
        ) {
          return
        }
        void useCommandStore.getState().executeCommand('workbench.find', { source: 'shortcut' })
      })
    })
  }, [])

  useEffect(() => {
    return window.cclinkStudio.browser.onFindResult((payload) => {
      const state = useTabStore.getState()
      const tab = state.tabs.find((candidate) => candidate.id === payload.tabId)
      if (
        state.activeTabId !== payload.tabId ||
        tab?.type !== 'browser' ||
        !tab.workspaceRef ||
        workspaceRefKey(tab.workspaceRef) !== payload.workspaceKey
      ) {
        return
      }
      useBrowserFindStore.getState().applyResult(payload.tabId, payload)
    })
  }, [])
}
