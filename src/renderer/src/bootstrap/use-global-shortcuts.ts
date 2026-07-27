import { useEffect } from 'react'
import { useCommandStore, useTabStore } from '../stores'
import { useUIStore } from '../stores/ui-store'

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  )
}

/** 注册窗口级快捷键。 */
export function useGlobalShortcuts(): void {
  const togglePalette = useCommandStore((s) => s.togglePalette)
  const executeCommand = useCommandStore((s) => s.executeCommand)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const cmd = e.metaKey || e.ctrlKey
      const shift = e.shiftKey
      const key = e.key.toLowerCase()

      if (cmd && shift && key === 'p') {
        e.preventDefault()
        togglePalette()
        return
      }
      if (cmd && !shift && key === 'b') {
        if (isTextEditingTarget(e.target)) return
        e.preventDefault()
        void executeCommand('activity.toggleSidebar', { source: 'shortcut' })
        return
      }
      if (cmd && !shift && key === 'j') {
        e.preventDefault()
        useUIStore.getState().toggleAgentPanel()
        return
      }
      if (cmd && shift && key === 'j') {
        e.preventDefault()
        useUIStore.getState().setAgentPanelMode('center', 'user')
        return
      }
      if (cmd && !shift && e.key === ',') {
        e.preventDefault()
        useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })
        return
      }
      if (cmd && !shift && key === 'r') {
        e.preventDefault()
        window.cclinkStudio.window.reload()
        return
      }
      if (cmd && !shift && e.key === 'w') {
        e.preventDefault()
        void executeCommand('workbench.closeTab', { source: 'shortcut' })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [executeCommand, togglePalette])
}
