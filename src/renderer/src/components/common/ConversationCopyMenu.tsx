import { useEffect, useRef, useState } from 'react'
import { copyCurrentSelection, copyTextToClipboard } from '../../utils/clipboard'
import { IconClipboard } from './Icons'
import { useToastStore } from './Toast'

interface SelectionMenuState {
  text: string
  x: number
  y: number
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, [contenteditable="true"]'))
}

function closestCopySurface(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest('.conversation-copy-surface') ?? null
}

function getConversationSelection(): string | null {
  const selection = window.getSelection()
  const text = selection?.toString() ?? ''
  if (!selection || !text.trim() || !selection.anchorNode || !selection.focusNode) return null

  const anchorSurface = closestCopySurface(selection.anchorNode)
  const focusSurface = closestCopySurface(selection.focusNode)
  if (!anchorSurface || anchorSurface !== focusSurface) return null
  return text
}

export function ConversationCopyMenu(): React.ReactElement | null {
  const [menu, setMenu] = useState<SelectionMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent): void => {
      if (isEditableTarget(event.target)) return
      const text = getConversationSelection()
      if (!text) {
        setMenu(null)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setMenu({ text, x: event.clientX, y: event.clientY })
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenu(null)
        return
      }
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'c' ||
        isEditableTarget(event.target)
      ) {
        return
      }
      const text = getConversationSelection()
      if (!text) return
      event.preventDefault()
      void copyCurrentSelection(text).catch((error) => {
        useToastStore.getState().show(`复制失败: ${String(error)}`, 'error')
      })
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenu(null)
    }
    const handleBlur = (): void => setMenu(null)

    document.addEventListener('contextmenu', handleContextMenu, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  if (!menu) return null

  const handleCopy = async (): Promise<void> => {
    try {
      await copyTextToClipboard(menu.text)
      useToastStore.getState().show('已复制选中文本', 'success')
    } catch (error) {
      useToastStore.getState().show(`复制失败: ${String(error)}`, 'error')
    } finally {
      setMenu(null)
    }
  }

  return (
    <div
      ref={menuRef}
      className="context-menu conversation-copy-menu"
      role="menu"
      style={{
        left: Math.min(menu.x, window.innerWidth - 170),
        top: Math.min(menu.y, window.innerHeight - 56),
      }}
    >
      <div className="context-menu-items">
        <button
          type="button"
          className="context-menu-item conversation-copy-menu-action"
          role="menuitem"
          onClick={() => void handleCopy()}
        >
          <span className="context-menu-icon">
            <IconClipboard size={13} />
          </span>
          <span>复制</span>
        </button>
      </div>
    </div>
  )
}
