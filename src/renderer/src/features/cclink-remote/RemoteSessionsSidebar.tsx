import { useState } from 'react'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { CclinkRemoteSession } from '@shared/cclink'
import { useCclinkStore, useTabStore, useUIStore } from '../../stores'
import { IconSearch } from '../../components/common/Icons'
import { useToastStore } from '../../components/common/Toast'
import { writeRemoteConversationDragData } from '../agent-conversations/conversation-workbench'
import './remote-sessions-sidebar.css'

export function RemoteSessionsSidebar({
  workspaceRef,
}: {
  workspaceRef: RemoteWorkspaceRef
}): React.ReactElement {
  const sessions = useCclinkStore((state) => state.sessions)
  const selectedSessionId = useCclinkStore((state) => state.selectedSessionId)
  const loading = useCclinkStore((state) => state.loading)
  const error = useCclinkStore((state) => state.error)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = sessions.filter((session) => {
    const searchable = [
      session.name,
      session.workspacePath,
      session.serverId,
      session.status === 'active'
        ? '响应中 active'
        : session.status === 'archived'
          ? '已归档 archived'
          : '空闲 idle',
      workspaceRef.endpointName ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase()
    return (
      (showArchived ? session.status === 'archived' : session.status !== 'archived') &&
      session.serverId === workspaceRef.endpointId &&
      session.workspaceId === workspaceRef.workspaceId &&
      searchable.includes(normalizedQuery)
    )
  })

  return (
    <div className="sidebar-section remote-sessions-sidebar">
      <label className="session-sidebar-search">
        <IconSearch size={13} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索远程会话"
          aria-label="搜索远程会话"
        />
      </label>
      <button
        type="button"
        className="remote-sessions-filter"
        aria-pressed={showArchived}
        onClick={() => setShowArchived((value) => !value)}
      >
        {showArchived ? '返回当前会话' : '查看已归档会话'}
      </button>
      {error && (
        <div role="alert" className="remote-sessions-error">
          {error}
        </div>
      )}
      {visible.length === 0 ? (
        error ? null : (
          <div className="project-panel-empty">
            {loading
              ? '正在加载会话…'
              : query.trim()
                ? '没有匹配的会话'
                : showArchived
                  ? '暂无已归档会话'
                  : '当前远程项目暂无会话'}
          </div>
        )
      ) : (
        visible.map((session) => (
          <RemoteSessionRow
            key={session.id}
            session={session}
            workspaceRef={workspaceRef}
            active={session.id === selectedSessionId}
          />
        ))
      )}
    </div>
  )
}

function RemoteSessionRow({
  session,
  workspaceRef,
  active,
}: {
  session: CclinkRemoteSession
  workspaceRef: RemoteWorkspaceRef
  active: boolean
}): React.ReactElement {
  const [pending, setPending] = useState<'stop' | 'delete' | 'archive' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const running = session.status === 'active'
  const archived = session.status === 'archived'
  const act = async (action: 'stop' | 'delete' | 'archive'): Promise<void> => {
    if (pending) return
    setPending(action)
    try {
      const store = useCclinkStore.getState()
      const success =
        action === 'stop'
          ? await store.stopAgentRun(workspaceRef, session.id)
          : action === 'delete'
            ? await store.deleteSession(workspaceRef, session.id)
            : await store.setSessionArchived(session.id, !archived)
      if (!success) {
        useToastStore.getState().show(useCclinkStore.getState().error || '会话操作失败', 'error')
        return
      }
      if (action === 'stop') {
        useToastStore.getState().show('远端已接受停止请求，等待任务结束', 'success')
      } else if (action === 'delete') {
        const tabs = useTabStore.getState()
        for (const tab of tabs.tabs) {
          if (
            tab.type === 'remote-conversation' &&
            tab.remoteConversation?.sessionId === session.id &&
            tab.workspaceRef?.kind === 'remote' &&
            tab.workspaceRef.endpointId === workspaceRef.endpointId
          )
            tabs.closeTab(tab.id)
        }
      }
      setConfirmDelete(false)
    } finally {
      setPending(null)
    }
  }
  return (
    <div className={`remote-session-row ${active ? 'active' : ''}`} data-session-id={session.id}>
      <button
        type="button"
        className="remote-session-open"
        data-conversation-id={session.id}
        title={session.name}
        aria-current={active ? 'true' : undefined}
        draggable={!archived && !pending}
        onDragStart={(event) => {
          writeRemoteConversationDragData(event.dataTransfer, session.id, workspaceRef)
        }}
        onClick={() => {
          useCclinkStore.getState().selectSession(session.id)
          void useCclinkStore.getState().loadMessages(session.id)
          useUIStore.getState().showAgentChat()
        }}
      >
        <span
          className={`session-sidebar-status ${running ? 'running' : archived ? 'closed' : 'idle'}`}
        />
        <span className="remote-session-title">{session.name}</span>
      </button>
      <div className="remote-session-footer">
        <span className="remote-session-meta">
          {running ? '响应中' : archived ? '已归档' : '空闲'} · {session.messageCount} 条
        </span>
        <div className="remote-session-actions" aria-label="会话操作">
          {running && (
            <button
              type="button"
              disabled={Boolean(pending)}
              onClick={() => void act('stop')}
              title="停止远端任务"
            >
              {pending === 'stop' ? '请求中…' : '停止'}
            </button>
          )}
          <button
            type="button"
            disabled={Boolean(pending) || running}
            title={running ? '请先停止任务后再归档' : archived ? '恢复会话' : '归档会话'}
            onClick={() => void act('archive')}
          >
            {archived ? '恢复' : '归档'}
          </button>
          <button
            type="button"
            className="danger"
            disabled={Boolean(pending) || running}
            title={running ? '请先停止任务后再删除' : '删除远端会话及本地历史'}
            onClick={() => setConfirmDelete(true)}
          >
            删除
          </button>
        </div>
      </div>
      {confirmDelete && (
        <div className="remote-session-confirm" role="alertdialog" aria-label="删除远程会话">
          <p>删除“{session.name}”？远端会话及本地历史将移除，关联终端会关闭，无法撤销。</p>
          <div className="remote-session-actions">
            <button
              type="button"
              disabled={Boolean(pending)}
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="danger"
              disabled={Boolean(pending) || running}
              onClick={() => void act('delete')}
            >
              {pending === 'delete' ? '正在删除…' : '确认删除'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
