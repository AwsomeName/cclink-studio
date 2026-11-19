import { useState } from 'react'
import type { WorkspaceRef } from '../../../../shared/workspace-ref'
import { workspaceRefKey, workspaceRefLabel } from '../../../../shared/workspace-ref'
import type { AgentConversationState } from '../../stores/agent-store'
import { useAgentStore, useTabStore } from '../../stores'
import { conversationBusyStatus } from './conversation-state'
import { ConversationTitleEditor } from './conversation-title-editor'
import { IconSearch } from '../../components/common/Icons'
import { useToastStore } from '../../components/common/Toast'
import { getConversationActivity } from './activity'
import { conversationWorkspaceKey } from './conversation-workspace-state'
import { writeConversationDragData } from './conversation-workbench'
import { useContextMenuStore } from '../context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../context-actions/context-menu-trigger'
import {
  formatRelativeSessionTime,
  SessionSidebarGroup,
  SessionSidebarRow,
  type SessionSidebarStatusKind,
} from './session-sidebar-primitives'

export function conversationActivityBadge(
  conversation: AgentConversationState,
  pending: ReturnType<typeof useAgentStore.getState>['pendingConfirmations'],
) {
  const busy = conversationBusyStatus(conversation, pending)
  if (busy) return busy
  if (
    conversation.runStatus === 'completed' &&
    conversation.lastRunEventAt &&
    conversation.lastRunEventAt !== conversation.viewedCompletionAt
  )
    return '新完成'
  return null
}

export interface WorkspaceConversationGroups {
  current: AgentConversationState[]
  closed: AgentConversationState[]
}

export function getWorkspaceConversationGroups(
  conversationOrder: ReturnType<typeof useAgentStore.getState>['conversationOrder'],
  conversations: ReturnType<typeof useAgentStore.getState>['conversations'],
  workspaceRef: WorkspaceRef,
): WorkspaceConversationGroups {
  const activeWorkspaceKey = workspaceRefKey(workspaceRef)
  const ordered = conversationOrder
    .flatMap((id, orderIndex) => {
      const conversation = conversations[id]
      return conversation ? [{ conversation, orderIndex }] : []
    })
    .sort(
      (a, b) => b.conversation.createdAt - a.conversation.createdAt || b.orderIndex - a.orderIndex,
    )
    .map(({ conversation }) => conversation)

  const scoped = ordered.filter(
    (conversation) => conversationWorkspaceKey(conversation) === activeWorkspaceKey,
  )
  return {
    current: scoped.filter((conversation) => !conversation.archivedAt),
    closed: scoped.filter((conversation) => conversation.archivedAt),
  }
}

export function LocalSessionsList({
  workspaceRef,
  sessionGroups,
  activityOnly = false,
  activeConversationId,
  switchConversation,
  archiveConversation,
  restoreArchivedConversation,
  deleteConversation,
  renameConversation,
  tabs,
  closeTab,
  revealConversation,
}: {
  workspaceRef: WorkspaceRef
  sessionGroups: WorkspaceConversationGroups
  activityOnly?: boolean
  activeConversationId: string
  switchConversation: (id: string) => void
  archiveConversation: ReturnType<typeof useAgentStore.getState>['archiveConversation']
  restoreArchivedConversation: ReturnType<
    typeof useAgentStore.getState
  >['restoreArchivedConversation']
  deleteConversation: ReturnType<typeof useAgentStore.getState>['deleteConversation']
  renameConversation: ReturnType<typeof useAgentStore.getState>['renameConversation']
  tabs: ReturnType<typeof useTabStore.getState>['tabs']
  closeTab: ReturnType<typeof useTabStore.getState>['closeTab']
  revealConversation: () => void
}): React.ReactElement {
  const [query, setQuery] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const filteredSessionGroups = activityOnly
    ? sessionGroups
    : filterConversationGroups(sessionGroups, query)
  const visibleCount = filteredSessionGroups.current.length + filteredSessionGroups.closed.length

  const openConversation = async (conversation: AgentConversationState): Promise<void> => {
    if (conversation.archivedAt) {
      try {
        await restoreArchivedConversation(conversation.id)
      } catch (error) {
        useToastStore
          .getState()
          .show(
            '恢复会话失败：' + (error instanceof Error ? error.message : String(error)),
            'error',
          )
        return
      }
      if (useAgentStore.getState().activeConversationId !== conversation.id) return
    } else {
      switchConversation(conversation.id)
    }
    revealConversation()
  }

  return (
    <div className="sidebar-section">
      {!activityOnly && (
        <label className="session-sidebar-search" title="搜索会话标题、摘要或工作空间">
          <IconSearch size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话"
          />
        </label>
      )}
      {visibleCount > 0 ? (
        <>
          <ConversationGroup
            title={workspaceRef.kind === 'global' ? '未归档' : '当前项目'}
            conversations={filteredSessionGroups.current}
            activeConversationId={activeConversationId}
            onOpen={openConversation}
            onRename={renameConversation}
            onDelete={async (id) => {
              await deleteConversation(id)
              closeConversationTabs(tabs, closeTab, id)
            }}
            onArchive={async (id) => {
              await archiveConversation(id)
              closeConversationTabs(tabs, closeTab, id)
            }}
            showTitle={false}
          />
          {filteredSessionGroups.closed.length > 0 && (
            <ConversationGroup
              title="已归档"
              conversations={showClosed ? filteredSessionGroups.closed : []}
              activeConversationId={activeConversationId}
              onOpen={openConversation}
              onRename={renameConversation}
              onRestore={restoreArchivedConversation}
              onDelete={deleteConversation}
              muted
              collapsed={!showClosed}
              count={filteredSessionGroups.closed.length}
              onToggleCollapsed={() => setShowClosed((value) => !value)}
            />
          )}
        </>
      ) : (
        <div className="project-panel-empty">
          {activityOnly
            ? '暂无其他会话动态'
            : query.trim()
              ? '没有匹配的会话'
              : '当前工作空间暂无会话'}
        </div>
      )}
    </div>
  )
}

function ConversationGroup({
  title,
  conversations,
  activeConversationId,
  onOpen,
  onRename,
  onArchive,
  onRestore,
  onDelete,
  muted = false,
  collapsed = false,
  count,
  onToggleCollapsed,
  showTitle = true,
}: {
  title: string
  conversations: AgentConversationState[]
  activeConversationId: string
  onOpen: (conversation: AgentConversationState) => void
  onRename?: (id: string, title: string, note: string) => void
  onArchive?: (conversationId: string) => void
  onRestore?: (conversationId: string) => void
  onDelete?: (conversationId: string) => void
  muted?: boolean
  collapsed?: boolean
  count?: number
  onToggleCollapsed?: () => void
  showTitle?: boolean
}): React.ReactElement | null {
  const groupCount = count ?? conversations.length

  return (
    <SessionSidebarGroup
      title={title}
      count={groupCount}
      collapsed={collapsed}
      collapsedText="点击展开已归档会话"
      onToggleCollapsed={onToggleCollapsed}
      showTitle={showTitle}
    >
      {conversations.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          active={conversation.id === activeConversationId}
          muted={muted}
          onOpen={() => onOpen(conversation)}
          onRename={onRename}
          onArchive={onArchive ? () => onArchive(conversation.id) : undefined}
          onRestore={onRestore ? () => onRestore(conversation.id) : undefined}
          onDelete={onDelete ? () => onDelete(conversation.id) : undefined}
        />
      ))}
    </SessionSidebarGroup>
  )
}

function ConversationRow({
  conversation,
  active,
  muted,
  onOpen,
  onRename,
  onArchive,
  onRestore,
  onDelete,
}: {
  conversation: AgentConversationState
  active: boolean
  muted: boolean
  onOpen: () => void
  onRename?: (id: string, title: string, note: string) => void
  onArchive?: () => void
  onRestore?: () => void
  onDelete?: () => void
}): React.ReactElement {
  const status = getConversationStatus(conversation, active)
  const activity = getConversationActivity(conversation)
  const preview = getConversationPreview(conversation)
  const threadTarget = {
    kind: 'thread' as const,
    workspaceKey: conversation.runtime.workspaceRef
      ? workspaceRefKey(conversation.runtime.workspaceRef)
      : null,
    conversationId: conversation.id,
    activeRunId: conversation.activeRunId,
  }
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [pending, setPending] = useState(false)
  const requests = useAgentStore((state) => state.pendingConfirmations)
  const badge = conversationActivityBadge(conversation, requests)
  const busy = badge === '运行中' || badge === '待确认'
  const invoke = async (action?: () => void) => {
    if (!action || busy || pending) return
    setPending(true)
    try {
      await action()
      if (action === onDelete) useToastStore.getState().show('会话已删除', 'success')
      setConfirm(false)
    } catch (error) {
      setConfirm(false)
      useToastStore
        .getState()
        .show(
          (action === onDelete ? '删除会话失败：' : '会话操作失败：') +
            (error instanceof Error ? error.message : String(error)),
          'error',
        )
    } finally {
      setPending(false)
    }
  }
  if (editing)
    return (
      <ConversationTitleEditor
        title={conversation.title}
        annotation={conversation.annotation}
        onCancel={() => setEditing(false)}
        onSave={(name, note) => {
          onRename?.(conversation.id, name, note)
          setEditing(false)
        }}
      />
    )
  if (confirm)
    return (
      <div className="conversation-inline-form" role="group" aria-label="删除确认">
        <strong>删除「{conversation.title}」？</strong>
        <p>消息和标注将永久删除，工作区文件不受影响。</p>
        <div>
          <button disabled={pending} onClick={() => setConfirm(false)}>
            取消
          </button>
          <button disabled={pending || busy} onClick={() => void invoke(onDelete)}>
            确认删除
          </button>
        </div>
      </div>
    )
  return (
    <div className="conversation-managed-row">
      <SessionSidebarRow
        title={conversation.title}
        conversationId={conversation.id}
        onDragStart={
          conversation.archivedAt
            ? undefined
            : (event) => {
                writeConversationDragData(event.dataTransfer, conversation.id)
              }
        }
        rowTitle={conversation.title}
        statusKind={status.kind}
        active={active}
        muted={muted}
        time={formatRelativeSessionTime(conversation.updatedAt)}
        preview={[badge, conversation.annotation || preview].filter(Boolean).join(' · ')}
        activity={`${activity.label} · ${activity.detail}`}
        activityTitle={activity.detail}
        compactStatus={
          activity.kind === 'error' || activity.kind === 'running' ? activity.label : undefined
        }
        meta={`${status.label} · ${conversation.messages.length} 条消息${
          activity.toolCount > 0 ? ` · ${activity.toolCount} 次工具` : ''
        }${activity.errorCount > 0 ? ` · ${activity.errorCount} 个错误` : ''}${
          conversation.mountedResources.length > 0
            ? ` · ${conversation.mountedResources.length} 个资源`
            : ''
        }`}
        onOpen={onOpen}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          useContextMenuStore.getState().show({
            target: threadTarget,
            x: event.clientX,
            y: event.clientY,
            focusReturn: event.currentTarget,
          })
        }}
        onKeyDown={(event) => {
          if (
            !isContextMenuKeyboardEvent(event.nativeEvent) ||
            event.target !== event.currentTarget
          )
            return
          event.preventDefault()
          useContextMenuStore
            .getState()
            .show(buildKeyboardContextMenuInput(threadTarget, event.currentTarget))
        }}
      />
      <div className="conversation-row-tools">
        {[
          {
            label: '编辑标题与标注',
            path: 'm4 14 3-1 8-8-2-2-8 8z',
            click: () => setEditing(true),
            disabled: !onRename,
          },
          {
            label: onRestore ? '恢复会话' : '归档会话',
            path: onRestore ? 'M3 9h4V5 M4 9a6 6 0 1 1 1 4' : 'M2 3h14v4H2z M4 7v8h10V7 M7 10h4',
            click: () => void invoke(onRestore ?? onArchive),
            disabled: busy || pending,
          },
          {
            label: '删除会话',
            path: 'M2 5h14 M7 5V3h4v2 M4 5l1 11h8l1-11 M7 8v5 M11 8v5',
            click: () => setConfirm(true),
            disabled: busy || pending || !onDelete,
          },
        ].map((tool) => (
          <button
            key={tool.label}
            type="button"
            title={tool.disabled && busy ? '请先结束本轮任务' : tool.label}
            aria-label={tool.label}
            disabled={tool.disabled}
            onClick={tool.click}
          >
            <svg
              viewBox="0 0 18 18"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d={tool.path} />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}

function closeConversationTabs(
  tabs: ReturnType<typeof useTabStore.getState>['tabs'],
  closeTab: ReturnType<typeof useTabStore.getState>['closeTab'],
  conversationId: string,
): void {
  tabs
    .filter(
      (tab) =>
        tab.type === 'conversation' &&
        tab.conversation &&
        'runtime' in tab.conversation &&
        tab.conversation.runtime.location === 'local' &&
        tab.conversation.sessionId === conversationId,
    )
    .forEach((tab) => closeTab(tab.id))
}

function filterConversationGroups(
  groups: WorkspaceConversationGroups,
  query: string,
): WorkspaceConversationGroups {
  const normalized = query.trim().toLowerCase()

  const matches = (conversation: AgentConversationState): boolean => {
    if (!normalized) return true
    const workspaceLabel = conversation.runtime.workspaceRef
      ? workspaceRefLabel(conversation.runtime.workspaceRef)
      : '未绑定'
    const haystack = [
      conversation.title,
      conversation.annotation,
      getConversationPreview(conversation),
      workspaceLabel,
      conversation.backendState,
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalized)
  }

  return {
    current: groups.current.filter(matches),
    closed: groups.closed.filter(matches),
  }
}

function getConversationPreview(conversation: AgentConversationState): string {
  const message = [...conversation.messages]
    .reverse()
    .find((item) => item.id !== 'welcome' && item.rawText.trim())

  if (!message) return '空会话'

  return message.rawText.replace(/\s+/g, ' ').trim().slice(0, 72)
}

function getConversationStatus(
  conversation: AgentConversationState,
  active: boolean,
): { kind: SessionSidebarStatusKind; label: string } {
  const activity = getConversationActivity(conversation)
  if (conversation.archivedAt) return { kind: 'closed', label: '已关闭' }
  if (activity.kind === 'error') return { kind: 'error', label: activity.label }
  if (activity.kind === 'running') return { kind: 'running', label: activity.label }
  if (active) return { kind: 'active', label: '已激活' }
  return { kind: 'idle', label: '未激活' }
}
