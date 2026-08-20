import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useCommandStore } from '../../stores/command-store'
import type { Command } from '../../stores/command-store'
import { IconSearch } from '../common/Icons'
import { useSettingsStore } from '../../stores/settings-store'
import { effectiveBindingsForCommand } from '../../features/shortcuts/keybinding-resolver'
import { formatKeyChord, isMacPlatform } from '@shared/keybindings'
import { useEscapeDismiss } from '../common/dismissable-layer'
import { useFloatingSurfaceRegistration } from '../common/floating-surface-registry'

export function CommandPalette(): React.ReactElement {
  const paletteOpen = useCommandStore((s) => s.paletteOpen)
  const query = useCommandStore((s) => s.query)
  const setQuery = useCommandStore((s) => s.setQuery)
  const closePalette = useCommandStore((s) => s.closePalette)
  const getFilteredCommands = useCommandStore((s) => s.getFilteredCommands)
  const executeCommand = useCommandStore((s) => s.executeCommand)
  const overrides = useSettingsStore((state) => state.settings.keybindingOverrides)
  const mac = isMacPlatform(typeof navigator === 'undefined' ? '' : navigator.platform)

  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLDivElement>(null)

  useFloatingSurfaceRegistration(paletteOpen)
  useEscapeDismiss(paletteOpen, closePalette)

  const filtered = getFilteredCommands()

  // 按 category 分组（保持原始顺序）
  const grouped = useMemo(() => {
    const groups: { category: string; commands: Command[] }[] = []
    const seen = new Map<string, number>()
    for (const cmd of filtered) {
      const cat = cmd.category || '其他'
      if (seen.has(cat)) {
        groups[seen.get(cat)!].commands.push(cmd)
      } else {
        seen.set(cat, groups.length)
        groups.push({ category: cat, commands: [cmd] })
      }
    }
    return groups
  }, [filtered])

  // 打开时自动聚焦输入框
  useEffect(() => {
    if (paletteOpen) {
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [paletteOpen])

  // 搜索词变化时重置选中项
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // 选中项变化时滚动到可见区域
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  /** 执行选中的命令 */
  const executeSelected = useCallback(
    (index: number) => {
      const cmd = filtered[index]
      if (cmd) {
        closePalette()
        void executeCommand(cmd.id, { source: 'palette' })
      }
    },
    [filtered, executeCommand, closePalette],
  )

  /** 键盘导航 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          executeSelected(selectedIndex)
          break
        case 'Escape':
          e.preventDefault()
          closePalette()
          break
      }
    },
    [filtered.length, selectedIndex, executeSelected, closePalette],
  )

  if (!paletteOpen) return <></>

  // 用扁平索引遍历分组渲染
  let flatIndex = 0

  return (
    <div className="command-palette-overlay" onClick={closePalette}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索输入 */}
        <div className="command-palette-input">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令..."
            className="command-palette-text"
          />
        </div>

        {/* 命令列表（按分类分组） */}
        <div className="command-palette-list">
          {filtered.length === 0 && <div className="command-palette-empty">没有匹配的命令</div>}
          {grouped.map((group) => (
            <div key={group.category} className="command-palette-group">
              <div className="command-palette-category-header">{group.category}</div>
              {group.commands.map((cmd) => {
                const idx = flatIndex++
                const isSelected = idx === selectedIndex
                const effectiveShortcut = cmd.shortcutPolicy
                  ? effectiveBindingsForCommand(cmd, overrides)
                      .map((binding) => formatKeyChord(binding, mac))
                      .join(' / ')
                  : cmd.shortcut
                return (
                  <div
                    key={cmd.id}
                    ref={isSelected ? selectedRef : null}
                    className={`command-palette-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => executeSelected(idx)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="command-palette-label">{cmd.label}</span>
                    {effectiveShortcut && (
                      <kbd className="command-palette-shortcut">{effectiveShortcut}</kbd>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
