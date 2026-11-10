import { useRef, useState } from 'react'
import type { PermissionMode } from '../../types'
import { FloatingSurface } from '../../components/common/FloatingSurface'
import { IconCheck, IconChevronDown, IconCircle } from '../../components/common/Icons'
import { getPermissionModeOption, PERMISSION_MODE_OPTIONS } from './composer-view-model'

export function AgentPermissionModeMenu({
  mode,
  disabled,
  onChange,
  open,
  onOpenChange,
}: {
  mode: PermissionMode
  disabled?: boolean
  onChange(mode: PermissionMode): void
  open?: boolean
  onOpenChange?(open: boolean): void
}): React.ReactElement {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [localOpen, setLocalOpen] = useState(false)
  const isOpen = open ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const selected = getPermissionModeOption(mode)
  return (
    <div className="agent-composer-menu-wrap" ref={anchorRef}>
      <button
        className="agent-mode-btn"
        data-agent-action="permissionMode"
        onClick={() => setOpen(!isOpen)}
        disabled={disabled}
        title={`Studio 权限模式（本地与远程共用）: ${selected.label}`}
      >
        <IconCircle size={8} filled color={selected.color} />
        {selected.label}
        <IconChevronDown size={12} />
      </button>
      <FloatingSurface
        anchorRef={anchorRef}
        open={isOpen}
        placement="top-start"
        className="agent-composer-menu"
        onRequestClose={() => setOpen(false)}
      >
        <div className="agent-composer-menu-title">Studio 权限 · 本地与远程共用</div>
        {PERMISSION_MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={option.value === mode ? 'selected' : ''}
            onClick={() => {
              setOpen(false)
              onChange(option.value)
            }}
          >
            <IconCircle size={8} filled color={option.color} />
            <span>
              <strong>{option.label}</strong>
              <em>{option.description}</em>
            </span>
            {option.value === mode && <IconCheck size={11} />}
          </button>
        ))}
      </FloatingSurface>
    </div>
  )
}
