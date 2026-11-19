import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { workspaceRefKey } from '@shared/workspace-ref'
import {
  useAgentStore,
  useCommandStore,
  useTabStore,
  useUIStore,
  useWorkspaceStore,
} from '../../stores'
import {
  conversationActivityBadge,
  getWorkspaceConversationGroups,
  type WorkspaceConversationGroups,
  LocalSessionsList,
} from '../../features/agent-conversations/local-session-sidebar'
import { RemoteSessionsSidebar } from '../../features/cclink-remote/RemoteSessionsSidebar'
import { IconList, IconRobot, IconArrowLeft } from '../common/Icons'
import { useToastStore } from '../common/Toast'
import { AgentPanel } from './AgentPanel'
import './agent-workspace.css'

const activityLabels = ['待确认', '运行中', '新完成'] as const
type ListFilter = (typeof activityLabels)[number] | '已归档'
const shortLabels = { 待确认: '确认', 运行中: '运行', 新完成: '完成' }

const listScrollPositions = new Map<string, number>()

/** Presentation only. Run subscriptions and cancellation stay outside this component. */
export function AgentWorkspace(): React.ReactElement {
  const workspace = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const workspaceKey = workspaceRefKey(workspace) ?? 'global'
  const mode = useUIStore((state) => state.agentContentMode)
  const listVisible = mode === 'list'
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<{ key: string; filter: ListFilter } | null>(null)
  const filter = listVisible && selection?.key === workspaceKey ? selection.filter : null
  useEffect(() => {
    if (!listVisible || selection?.key !== workspaceKey) setSelection(null)
  }, [listVisible, workspaceKey, selection])
  const conversations = useAgentStore((state) => state.conversations)
  const order = useAgentStore((state) => state.conversationOrder)
  const activeId = useAgentStore((state) => state.activeConversationId)
  const pending = useAgentStore((state) => state.pendingConfirmations)
  const groups = getWorkspaceConversationGroups(order, conversations, workspace)
  const byStatus: Record<(typeof activityLabels)[number], typeof groups.current> = {
    待确认: [],
    运行中: [],
    新完成: [],
  }
  for (const item of groups.current) {
    const status = conversationActivityBadge(item, pending)
    if (item.id !== activeId && status) byStatus[status].push(item)
  }
  const statuses = activityLabels.filter((label) => byStatus[label].length)
  const archived = filter === '已归档'
  const activity = filter && filter !== '已归档' ? filter : null
  const active = conversations[activeId]
  useEffect(() => {
    if (
      !listVisible &&
      workspace.kind !== 'remote' &&
      active?.runStatus === 'completed' &&
      active.lastRunEventAt &&
      active.viewedCompletionAt !== active.lastRunEventAt
    ) {
      useAgentStore.getState().markCompletionViewed(active.id)
    }
  }, [listVisible, workspace, active])
  useLayoutEffect(() => {
    if (listVisible && scrollRef.current)
      scrollRef.current.scrollTop = filter ? 0 : (listScrollPositions.get(workspaceKey) ?? 0)
  }, [workspaceKey, listVisible, filter])

  const newConversation = async (): Promise<void> => {
    const result = await useCommandStore.getState().executeCommand('agent.newConversation', {
      source: 'toolbar',
      target: { kind: 'layout', workspaceKey: workspaceRefKey(workspace), area: 'agent' },
    })
    if (!result.ok) useToastStore.getState().show(result.message ?? '新建会话失败', 'error')
  }

  return (
    <div className="agent-workspace" data-agent-navigation={listVisible ? 'list' : 'chat'}>
      <nav className="agent-workspace-header" aria-label="会话导航">
        <div className="agent-workspace-actions">
          <button
            type="button"
            className="agent-workspace-new-conversation"
            aria-label="新建对话"
            title="新建对话"
            onClick={() => void newConversation()}
          >
            <IconRobot size={16} />
            <span>新建对话</span>
          </button>
          {!listVisible && workspace.kind !== 'remote' && statuses.length > 0 && (
            <div
              className="agent-other-updates"
              role="group"
              aria-label="其他会话动态"
              data-large-count={statuses.some((label) => byStatus[label].length > 9) || undefined}
            >
              {statuses.map((label) => {
                const count = byStatus[label].length
                return (
                  <button
                    type="button"
                    className="agent-update-count"
                    key={label}
                    data-status={label}
                    aria-label={label + ' ' + count}
                    title={label + ' · ' + count + ' 个其他会话'}
                    onClick={() => {
                      setSelection({ key: workspaceKey, filter: label })
                      useUIStore.getState().showAgentSessions()
                    }}
                  >
                    <i aria-hidden="true" />
                    <span>{count > 99 ? '99+' : count}</span>
                    <span className="agent-update-label">{label}</span>
                    <span className="agent-update-short">{shortLabels[label]}</span>
                  </button>
                )
              })}
            </div>
          )}
          <button
            className="agent-workspace-switch"
            type="button"
            onClick={() => {
              setSelection(null)
              if (listVisible) useUIStore.getState().showAgentChat()
              else useUIStore.getState().showAgentSessions()
            }}
          >
            {listVisible ? <IconArrowLeft size={15} /> : <IconList size={15} />}
            {listVisible ? '返回会话' : '会话列表'}
          </button>
        </div>
      </nav>
      <div className="agent-workspace-body">
        <div className="agent-workspace-chat" hidden={listVisible} inert={listVisible}>
          <AgentPanel variant="side" />
        </div>
        <nav
          className="agent-navigation-list"
          aria-label="会话列表"
          hidden={!listVisible}
          style={{ width: '100%' }}
        >
          <div className="agent-navigation-list-heading">
            {workspace.kind === 'remote' ? (
              <span>会话列表</span>
            ) : activity ? (
              <>
                <span>
                  {activity} · {byStatus[activity].length}
                </span>
                <button type="button" onClick={() => setSelection(null)}>
                  查看全部
                </button>
              </>
            ) : (
              <div className="agent-list-filters" role="group" aria-label="会话范围">
                <button type="button" aria-pressed={!archived} onClick={() => setSelection(null)}>
                  全部会话
                </button>
                <button
                  type="button"
                  aria-pressed={archived}
                  onClick={() => setSelection({ key: workspaceKey, filter: '已归档' })}
                >
                  已归档 <span>{groups.closed.length}</span>
                </button>
              </div>
            )}
          </div>
          <div
            className="agent-navigation-list-content"
            ref={scrollRef}
            onScroll={(event) => {
              if (listVisible && !filter && event.currentTarget.clientHeight > 0)
                listScrollPositions.set(workspaceKey, event.currentTarget.scrollTop)
            }}
          >
            <AgentSessionList
              key={
                workspace.kind === 'remote'
                  ? workspaceKey
                  : JSON.stringify([workspaceKey, listVisible, filter])
              }
              activityFilter={activity}
              archivedOnly={archived}
              groups={{
                current: archived ? [] : activity ? byStatus[activity] : groups.current,
                closed: archived ? groups.closed : [],
              }}
            />
          </div>
        </nav>
      </div>
    </div>
  )
}

function AgentSessionList({
  groups,
  activityFilter,
  archivedOnly,
}: {
  groups: WorkspaceConversationGroups
  activityFilter: (typeof activityLabels)[number] | null
  archivedOnly: boolean
}): React.ReactElement {
  const workspace = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const activeId = useAgentStore((state) => state.activeConversationId)
  const tabs = useTabStore((state) => state.tabs)
  const agent = useAgentStore.getState()
  if (workspace.kind === 'remote') return <RemoteSessionsSidebar workspaceRef={workspace} />
  return (
    <LocalSessionsList
      workspaceRef={workspace}
      sessionGroups={groups}
      activityFilter={activityFilter}
      archivedOnly={archivedOnly}
      activeConversationId={activeId}
      switchConversation={agent.switchConversation}
      archiveConversation={agent.archiveConversation}
      restoreArchivedConversation={agent.restoreArchivedConversation}
      deleteConversation={agent.deleteConversation}
      renameConversation={agent.renameConversation}
      tabs={tabs}
      closeTab={useTabStore.getState().closeTab}
      revealConversation={useUIStore.getState().showAgentChat}
    />
  )
}
