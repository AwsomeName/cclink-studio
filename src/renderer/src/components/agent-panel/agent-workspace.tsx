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

const listScrollPositions = new Map<string, number>()

/** Presentation only. Run subscriptions and cancellation stay outside this component. */
export function AgentWorkspace(): React.ReactElement {
  const workspace = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const workspaceKey = workspaceRefKey(workspace) ?? 'global'
  const mode = useUIStore((state) => state.agentContentMode)
  const listVisible = mode === 'list'
  const scrollRef = useRef<HTMLDivElement>(null)
  const [updatesWorkspace, setUpdatesWorkspace] = useState<string | null>(null)
  const updatesOnly =
    listVisible && workspace.kind !== 'remote' && updatesWorkspace === workspaceKey
  useEffect(() => {
    if (!listVisible || workspaceKey !== updatesWorkspace) setUpdatesWorkspace(null)
  }, [listVisible, workspaceKey, updatesWorkspace])
  const conversations = useAgentStore((state) => state.conversations)
  const order = useAgentStore((state) => state.conversationOrder)
  const activeId = useAgentStore((state) => state.activeConversationId)
  const pending = useAgentStore((state) => state.pendingConfirmations)
  const groups = getWorkspaceConversationGroups(order, conversations, workspace)
  const updates = groups.current.filter(
    (item) => item.id !== activeId && conversationActivityBadge(item, pending),
  )
  const counts = ['待确认', '运行中', '新完成']
    .map((label) => ({
      label,
      count: updates.filter((item) => conversationActivityBadge(item, pending) === label).length,
    }))
    .filter((item) => item.count)
  const summary = counts.map((item) => item.count + ' ' + item.label).join(' · ')
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
      scrollRef.current.scrollTop = updatesOnly ? 0 : (listScrollPositions.get(workspaceKey) ?? 0)
  }, [workspaceKey, listVisible, updatesOnly])

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
            onClick={() => void newConversation()}
          >
            <IconRobot size={16} />
            新建对话
          </button>
          {!listVisible && workspace.kind !== 'remote' && summary && (
            <button
              className="agent-other-updates"
              title={'其他会话动态：' + summary}
              aria-label={'其他会话动态：' + summary}
              data-compact={counts.some(({ count }) => count > 9) || undefined}
              onClick={() => {
                setUpdatesWorkspace(workspaceKey)
                useUIStore.getState().showAgentSessions()
              }}
            >
              <span className="agent-updates-total">
                动态 {updates.length > 99 ? '99+' : updates.length}
              </span>
              <span className="agent-update-counts">
                {counts.map(({ label, count }) => (
                  <span className="agent-update-count" key={label}>
                    <i data-status={label} />
                    {count} {label}
                  </span>
                ))}
              </span>
            </button>
          )}
          <button
            className="agent-workspace-switch"
            type="button"
            onClick={() => {
              setUpdatesWorkspace(null)
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
            <span>{updatesOnly ? '其他会话动态' : '会话列表'}</span>
            {updatesOnly && <button onClick={() => setUpdatesWorkspace(null)}>查看全部</button>}
          </div>
          <div
            className="agent-navigation-list-content"
            ref={scrollRef}
            onScroll={(event) => {
              if (listVisible && !updatesOnly && event.currentTarget.clientHeight > 0)
                listScrollPositions.set(workspaceKey, event.currentTarget.scrollTop)
            }}
          >
            <AgentSessionList
              key={workspaceKey}
              activityOnly={updatesOnly}
              groups={updatesOnly ? { current: updates, closed: [] } : groups}
            />
          </div>
        </nav>
      </div>
    </div>
  )
}

function AgentSessionList({
  groups,
  activityOnly,
}: {
  groups: WorkspaceConversationGroups
  activityOnly: boolean
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
      activityOnly={activityOnly}
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
