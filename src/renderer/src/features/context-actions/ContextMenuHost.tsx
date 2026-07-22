import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useCommandStore } from '../../stores/command-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { IconCheck } from '../../components/common/Icons'
import { useToastStore } from '../../components/common/Toast'
import { useContextMenuStore } from './context-menu-store'
import { useMenuContributionRegistry } from './menu-contribution-registry'
import { findBoundaryEnabledIndex, findNextEnabledIndex, fitMenuPosition } from './menu-position'
import { targetMatchesWorkspace, type CommandContext } from './context-target'
import { resolveContextMenu, type ResolvedContextMenuItem } from './resolve-context-menu'
import { useContextActionDiagnosticsStore } from './context-action-diagnostics'

export function ContextMenuHost(): React.ReactElement | null {
  const open = useContextMenuStore((state) => state.open)
  const menuId = useContextMenuStore((state) => state.menuId)
  const x = useContextMenuStore((state) => state.x)
  const y = useContextMenuStore((state) => state.y)
  const target = useContextMenuStore((state) => state.target)
  const editingContributionId = useContextMenuStore((state) => state.editingContributionId)
  const inputValue = useContextMenuStore((state) => state.inputValue)
  const workspaceKeyAtOpen = useContextMenuStore((state) => state.workspaceKeyAtOpen)
  const hide = useContextMenuStore((state) => state.hide)
  const beginInlineEdit = useContextMenuStore((state) => state.beginInlineEdit)
  const setInputValue = useContextMenuStore((state) => state.setInputValue)
  const cancelInlineEdit = useContextMenuStore((state) => state.cancelInlineEdit)
  const commands = useCommandStore((state) => state.commands)
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const contributions = useMenuContributionRegistry((state) => state.contributions)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [selectedIndex, setSelectedIndex] = useState(0)

  const context = useMemo<CommandContext | null>(
    () => (target ? { source: 'context-menu', target } : null),
    [target],
  )

  const resolution = useMemo(() => {
    if (!context) return { items: [], failures: [] }
    return resolveContextMenu({ contributions, commands, context })
  }, [commands, context, contributions])
  const items = resolution.items

  useEffect(() => {
    if (!open || !target) return
    resolution.failures.forEach((failure) => {
      useContextActionDiagnosticsStore.getState().record({
        kind: 'menu-build-failed',
        commandId: failure.commandId,
        contributionId: failure.contributionId,
        targetKind: target.kind,
        message: failure.message,
      })
    })
  }, [menuId, open, resolution.failures, target])

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    setPosition(
      fitMenuPosition({
        x,
        y,
        menuWidth: rect.width,
        menuHeight: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    )
  }, [editingContributionId, items.length, menuId, open, x, y])

  useLayoutEffect(() => {
    if (!open || editingContributionId) return
    const firstEnabled = items.findIndex((item) => item.enabled)
    setSelectedIndex(firstEnabled >= 0 ? firstEnabled : 0)
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus()
  }, [editingContributionId, items, menuId, open])

  useEffect(() => {
    if (!open) return
    const currentWorkspaceKey = workspaceRefKey(activeWorkspaceRef)
    if (
      currentWorkspaceKey !== workspaceKeyAtOpen ||
      (target && !targetMatchesWorkspace(target, currentWorkspaceKey))
    ) {
      hide('workspace-switch')
      return
    }
  }, [activeWorkspaceRef, hide, open, target, workspaceKeyAtOpen])

  useEffect(() => {
    if (editingContributionId) requestAnimationFrame(() => inputRef.current?.select())
  }, [editingContributionId])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) hide('outside')
    }
    const handleBlur = (): void => hide('blur')
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('blur', handleBlur)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('blur', handleBlur)
    }
  }, [hide, open])

  useEffect(() => {
    if (!open || editingContributionId) return
    const handleGlobalEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      hide('escape')
    }
    document.addEventListener('keydown', handleGlobalEscape, true)
    return () => document.removeEventListener('keydown', handleGlobalEscape, true)
  }, [editingContributionId, hide, open])

  if (!open || !context || !target || items.length === 0) return null

  const execute = async (item: ResolvedContextMenuItem, value?: string): Promise<void> => {
    if (!item.enabled) return
    hide('execute')
    const result = await executeCommand(item.commandId, {
      ...context,
      inputValue: value,
    })
    if (!result.ok) {
      useToastStore.getState().show(result.message ?? '操作无法完成', 'error')
    }
  }

  const moveSelection = (direction: 1 | -1): void => {
    const menuItems = menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')
    const focusedIndex = menuItems
      ? Array.from(menuItems).indexOf(document.activeElement as HTMLElement)
      : -1
    const next = findNextEnabledIndex(
      items.map((item) => item.enabled),
      focusedIndex >= 0 ? focusedIndex : selectedIndex,
      direction,
    )
    if (next < 0) return
    setSelectedIndex(next)
    menuItems?.[next]?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (editingContributionId) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancelInlineEdit()
        requestAnimationFrame(() => {
          menuRef.current
            ?.querySelectorAll<HTMLElement>('[role^="menuitem"]')
            [selectedIndex]?.focus()
        })
      }
      return
    }
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        hide('escape')
        break
      case 'ArrowDown':
        event.preventDefault()
        moveSelection(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveSelection(-1)
        break
      case 'Tab':
        event.preventDefault()
        moveSelection(event.shiftKey ? -1 : 1)
        break
      case 'Home': {
        event.preventDefault()
        const index = findBoundaryEnabledIndex(
          items.map((item) => item.enabled),
          'start',
        )
        if (index >= 0) {
          setSelectedIndex(index)
          menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')[index]?.focus()
        }
        break
      }
      case 'End': {
        event.preventDefault()
        const index = findBoundaryEnabledIndex(
          items.map((item) => item.enabled),
          'end',
        )
        if (index >= 0) {
          setSelectedIndex(index)
          menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')[index]?.focus()
        }
        break
      }
      case 'Enter': {
        event.preventDefault()
        const item = items[selectedIndex]
        if (!item?.enabled) break
        if (item.contribution.inlineInput) {
          beginInlineEdit(item.contribution.id, item.contribution.inlineInput.initialValue(context))
        } else {
          void execute(item)
        }
        break
      }
      case ' ': {
        event.preventDefault()
        const item = items[selectedIndex]
        if (!item?.enabled) break
        if (item.contribution.inlineInput) {
          beginInlineEdit(item.contribution.id, item.contribution.inlineInput.initialValue(context))
        } else {
          void execute(item)
        }
        break
      }
    }
  }

  let previousGroup: string | null = null
  return (
    <div
      ref={menuRef}
      className={`context-menu unified-context-menu ${editingContributionId ? 'renaming' : ''}`}
      role="menu"
      aria-label="上下文菜单"
      style={{ position: 'fixed', left: position.left, top: position.top, zIndex: 10000 }}
      onKeyDown={handleKeyDown}
    >
      <div className="context-menu-items">
        {items.map((item, index) => {
          const separator = previousGroup !== null && previousGroup !== item.contribution.group
          previousGroup = item.contribution.group
          const editing = editingContributionId === item.contribution.id
          return (
            <div key={item.contribution.id}>
              {separator && <div className="context-menu-separator" role="separator" />}
              {editing ? (
                <form
                  className="tab-context-rename"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (inputValue.trim()) void execute(item, inputValue)
                  }}
                >
                  <input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    aria-label={item.contribution.inlineInput?.ariaLabel}
                  />
                  <button type="submit" title="确认重命名" disabled={!inputValue.trim()}>
                    <IconCheck size={14} />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={item.checked}
                  aria-disabled={!item.enabled}
                  aria-keyshortcuts={item.shortcut}
                  aria-label={
                    !item.enabled && item.disabledReason
                      ? `${item.label}，不可用：${item.disabledReason}`
                      : item.label
                  }
                  data-context-action={item.contribution.id}
                  className={`context-menu-item ${index === selectedIndex ? 'selected' : ''} ${item.risk === 'destructive' ? 'danger' : ''}`}
                  disabled={!item.enabled}
                  title={item.disabledReason}
                  onFocus={() => setSelectedIndex(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    if (item.contribution.inlineInput) {
                      beginInlineEdit(
                        item.contribution.id,
                        item.contribution.inlineInput.initialValue(context),
                      )
                    } else {
                      void execute(item)
                    }
                  }}
                >
                  {item.contribution.icon && (
                    <span className="context-menu-icon">{item.contribution.icon}</span>
                  )}
                  <span className="context-menu-label">
                    <span>{item.label}</span>
                    {!item.enabled && item.disabledReason && (
                      <span className="context-menu-disabled-reason">{item.disabledReason}</span>
                    )}
                  </span>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
