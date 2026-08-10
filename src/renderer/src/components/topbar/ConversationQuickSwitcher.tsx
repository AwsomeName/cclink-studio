import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAgentStore } from '../../stores/agent-store'
import { useCommandStore } from '../../stores/command-store'
import type { AgentPanelMode } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useToastStore } from '../common/Toast'
import { buildQuickThreadList } from '../../features/agent-conversations/view-model'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import { workspaceRefKey } from '@shared/workspace-ref'
import { IconPlus } from '../common/Icons'
import {
  formatQuickSwitcherTitle,
  partitionQuickSwitcherThreads,
  quickSwitcherVisibleCount,
  selectQuickSwitcherThreads,
} from './conversation-quick-switcher'

interface ConversationQuickSwitcherProps {
  panelMode: AgentPanelMode
  panelWidth: number
}

export function ConversationQuickSwitcher({
  panelMode,
  panelWidth,
}: ConversationQuickSwitcherProps): React.ReactElement | null {
  const conversations = useAgentStore((state) => state.conversations)
  const conversationOrder = useAgentStore((state) => state.conversationOrder)
  const activeConversationId = useAgentStore((state) => state.activeConversationId)
  const pendingConfirmations = useAgentStore((state) => state.pendingConfirmations)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const showToast = useToastStore((state) => state.show)
  const showContextMenu = useContextMenuStore((state) => state.show)
  const rootRef = useRef<HTMLDivElement>(null)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const workspaceKey = workspaceRefKey(activeWorkspaceRef)
  const pendingConfirmationCount = pendingConfirmations.filter(
    (request) => request.conversationId === activeConversationId,
  ).length

  const recentConversations = useMemo(() => {
    const allConversations = buildQuickThreadList({
      conversations,
      conversationOrder,
      activeConversationId,
      activeWorkspaceRef,
      pendingConfirmationCount,
      expanded: true,
    })
    return selectQuickSwitcherThreads(allConversations)
  }, [
    activeConversationId,
    activeWorkspaceRef,
    conversationOrder,
    conversations,
    pendingConfirmationCount,
  ])
  const visibleCount = quickSwitcherVisibleCount(panelMode, panelWidth)
  const { visible, overflow } = partitionQuickSwitcherThreads(recentConversations, visibleCount)

  useEffect(() => {
    setOverflowOpen(false)
  }, [panelMode, workspaceKey])

  useEffect(() => {
    if (!overflowOpen) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOverflowOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOverflowOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [overflowOpen])

  const openConversation = async (conversationId: string): Promise<void> => {
    setOverflowOpen(false)
    const conversation = conversations[conversationId]
    if (!conversation) {
      showToast('会话已不存在', 'error')
      return
    }
    const result = await executeCommand('agent.openConversation', {
      source: 'toolbar',
      target: {
        kind: 'thread',
        workspaceKey: conversation.runtime.workspaceRef
          ? workspaceRefKey(conversation.runtime.workspaceRef)
          : null,
        conversationId,
        activeRunId: conversation.activeRunId,
      },
    })
    if (!result.ok) showToast(result.message ?? '会话切换失败', 'error')
  }

  const createConversation = async (): Promise<void> => {
    setOverflowOpen(false)
    const result = await executeCommand('agent.newConversation', {
      source: 'toolbar',
      target: {
        kind: 'layout',
        workspaceKey,
        area: 'agent',
      },
    })
    if (!result.ok) showToast(result.message ?? '新建会话失败', 'error')
  }

  const getConversationTarget = (conversationId: string) => {
    const conversation = conversations[conversationId]
    if (!conversation) return null
    return {
      kind: 'thread' as const,
      workspaceKey: conversation.runtime.workspaceRef
        ? workspaceRefKey(conversation.runtime.workspaceRef)
        : null,
      conversationId,
      activeRunId: conversation.activeRunId,
    }
  }

  return (
    <div
      ref={rootRef}
      className={`conversation-quick-switcher ${panelMode === 'right' ? '' : 'compact'}`}
      aria-label="当前项目最近会话"
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
        )
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
        if (index < 0 || tabs.length === 0) return
        event.preventDefault()
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : (index - 1 + tabs.length) % tabs.length
        tabs[nextIndex]?.focus()
      }}
    >
      <div className="conversation-quick-tabs" role="tablist" aria-label="快速切换会话">
        {visible.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            role="tab"
            className={`conversation-quick-tab status-${conversation.statusKind} ${conversation.isActive ? 'active' : ''}`}
            title={`${conversation.title} · ${conversation.statusLabel}`}
            aria-label={`切换到会话：${conversation.title}，${conversation.statusLabel}`}
            aria-selected={conversation.isActive}
            aria-haspopup="menu"
            onClick={() => void openConversation(conversation.id)}
            onContextMenu={(event) => {
              const target = getConversationTarget(conversation.id)
              if (!target) return
              event.preventDefault()
              event.stopPropagation()
              showContextMenu({
                target,
                x: event.clientX,
                y: event.clientY,
                focusReturn: event.currentTarget,
              })
            }}
            onKeyDown={(event) => {
              if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
              const target = getConversationTarget(conversation.id)
              if (!target) return
              event.preventDefault()
              event.stopPropagation()
              showContextMenu(buildKeyboardContextMenuInput(target, event.currentTarget))
            }}
          >
            <span className="conversation-quick-status" aria-hidden="true" />
            <span className="conversation-quick-title">
              {formatQuickSwitcherTitle(conversation.title)}
            </span>
          </button>
        ))}
      </div>

      {overflow.length > 0 && (
        <div className="conversation-quick-overflow">
          <button
            type="button"
            className="conversation-quick-overflow-button"
            title="更多最近会话"
            aria-label="更多最近会话"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((open) => !open)}
          >
            ···
          </button>
          {overflowOpen && (
            <div className="conversation-quick-overflow-menu" role="menu">
              {overflow.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  role="menuitem"
                  className={`status-${conversation.statusKind}`}
                  title={conversation.title}
                  aria-haspopup="menu"
                  onClick={() => void openConversation(conversation.id)}
                  onContextMenu={(event) => {
                    const target = getConversationTarget(conversation.id)
                    if (!target) return
                    event.preventDefault()
                    event.stopPropagation()
                    showContextMenu({
                      target,
                      x: event.clientX,
                      y: event.clientY,
                      focusReturn: event.currentTarget,
                    })
                  }}
                  onKeyDown={(event) => {
                    if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
                    const target = getConversationTarget(conversation.id)
                    if (!target) return
                    event.preventDefault()
                    event.stopPropagation()
                    showContextMenu(buildKeyboardContextMenuInput(target, event.currentTarget))
                  }}
                >
                  <span className="conversation-quick-status" aria-hidden="true" />
                  <span>{conversation.title}</span>
                  <small>{conversation.statusLabel}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="conversation-quick-new-button"
        title="新建会话"
        aria-label="新建会话"
        onClick={() => void createConversation()}
      >
        <IconPlus size={14} />
      </button>
    </div>
  )
}
