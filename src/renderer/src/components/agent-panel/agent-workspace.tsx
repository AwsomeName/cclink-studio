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
  getWorkspaceConversationGroups,
  LocalSessionsList,
} from '../../features/agent-conversations/local-session-sidebar'
import { RemoteSessionsSidebar } from '../../features/cclink-remote/RemoteSessionsSidebar'
import { IconPanelLeft, IconPanelRight, IconPlus, IconRobot } from '../common/Icons'
import { ResizeHandle } from '../common/ResizeHandle'
import { useToastStore } from '../common/Toast'
import { AgentPanel } from './AgentPanel'
import {
  getAgentNavigationLayout,
  MIN_AGENT_LIST_WIDTH,
  MAX_AGENT_LIST_WIDTH,
} from '../../utils/agent-navigation-layout'
import { clampPanelWidth } from '../../utils/panel-layout'
import { cancelActivePanelResize } from '../../utils/panel-layout-drag-lifecycle'
import './agent-workspace.css'

const listScrollPositions = new Map<string, number>()

/** Presentation only. Run subscriptions and cancellation stay outside this component. */
export function AgentWorkspace(): React.ReactElement {
  const workspace = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const workspaceKey = workspaceRefKey(workspace) ?? 'global'
  const mode = useUIStore((state) => state.agentContentMode)
  const listWidth = useUIStore((state) => state.agentListWidth)
  const drawerOpen = useUIStore((state) => state.agentDrawerOpen)
  const setMode = useUIStore((state) => state.setAgentContentMode)
  const setDrawerOpen = useUIStore((state) => state.setAgentDrawerOpen)
  const setListWidth = useUIStore((state) => state.setAgentListWidth)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const listButtonRef = useRef<HTMLButtonElement>(null)
  const [width, setWidth] = useState(0)
  const [preview, setPreview] = useState<number | null>(null)
  const resizeStart = useRef<number | null>(null)
  const layout = getAgentNavigationLayout(mode, width, preview ?? listWidth, drawerOpen)
  const presentation = layout.presentation
  const listVisible = presentation !== 'chat'
  const chatVisible = presentation !== 'list'

  useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    setWidth(element.clientWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (presentation === 'split' && drawerOpen) setDrawerOpen(false)
    if (presentation === 'drawer') scrollRef.current?.querySelector('input')?.focus()
  }, [presentation, drawerOpen, setDrawerOpen])

  useLayoutEffect(() => {
    if (listVisible && scrollRef.current)
      scrollRef.current.scrollTop = listScrollPositions.get(workspaceKey) ?? 0
  }, [workspaceKey, listVisible])

  useEffect(() => {
    if (resizeStart.current !== null) cancelActivePanelResize()
  }, [workspaceKey, width, mode])

  const closeList = (): void => {
    if (presentation === 'drawer') setDrawerOpen(false)
    else setMode('chat')
    listButtonRef.current?.focus()
  }

  const newConversation = async (): Promise<void> => {
    const result = await useCommandStore.getState().executeCommand('agent.newConversation', {
      source: 'toolbar',
      target: { kind: 'layout', workspaceKey: workspaceRefKey(workspace), area: 'agent' },
    })
    if (!result.ok) useToastStore.getState().show(result.message ?? '新建会话失败', 'error')
  }

  return (
    <div
      className="agent-workspace"
      data-agent-navigation={presentation}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && presentation === 'drawer') {
          event.preventDefault()
          event.stopPropagation()
          closeList()
        }
      }}
    >
      <header className="agent-workspace-header">
        <span className="agent-workspace-title">
          <IconRobot size={16} />
          Agent
        </span>
        <div className="agent-workspace-actions">
          <button
            ref={listButtonRef}
            type="button"
            aria-label={listVisible ? '收起会话列表' : '展开会话列表'}
            aria-expanded={listVisible}
            title={listVisible ? '收起会话列表' : '展开会话列表'}
            onClick={() => {
              if (listVisible) closeList()
              else useUIStore.getState().showAgentSessions()
            }}
          >
            <IconPanelLeft size={14} />
            <span>会话</span>
          </button>
          <button
            type="button"
            aria-label="新建会话"
            title="新建会话"
            onClick={() => void newConversation()}
          >
            <IconPlus size={14} />
          </button>
          <button
            type="button"
            aria-label={chatVisible ? '收起聊天，仅保留会话列表' : '展开聊天'}
            title={chatVisible ? '收起聊天，仅保留会话列表' : '展开聊天'}
            aria-expanded={chatVisible}
            onClick={() => (chatVisible ? setMode('list') : useUIStore.getState().showAgentChat())}
          >
            <IconPanelRight size={14} />
          </button>
        </div>
      </header>
      <div className="agent-workspace-body">
        <nav
          className="agent-navigation-list"
          aria-label="会话列表"
          hidden={!listVisible}
          style={{ width: layout.listWidth }}
        >
          <div className="agent-navigation-list-heading">
            <span>会话列表</span>
          </div>
          <div
            className="agent-navigation-list-content"
            ref={scrollRef}
            onScroll={(event) => {
              if (listVisible && event.currentTarget.clientHeight > 0)
                listScrollPositions.set(workspaceKey, event.currentTarget.scrollTop)
            }}
          >
            <AgentSessionList key={workspaceKey} />
          </div>
        </nav>
        {presentation === 'split' && (
          <ResizeHandle
            area="agent-sessions"
            side="left"
            onResizeStart={() => {
              resizeStart.current = listWidth
            }}
            onResize={(delta) => {
              if (resizeStart.current !== null)
                setPreview(
                  clampPanelWidth(resizeStart.current + delta, {
                    min: MIN_AGENT_LIST_WIDTH,
                    max: Math.min(MAX_AGENT_LIST_WIDTH, width - 364),
                  }),
                )
            }}
            onResizeEnd={({ reason, delta }) => {
              const start = resizeStart.current
              resizeStart.current = null
              setPreview(null)
              if (reason === 'commit' && start !== null)
                setListWidth(
                  clampPanelWidth(start + delta, {
                    min: MIN_AGENT_LIST_WIDTH,
                    max: Math.min(MAX_AGENT_LIST_WIDTH, width - 364),
                  }),
                )
            }}
          />
        )}
        <div
          className="agent-workspace-chat"
          hidden={!chatVisible}
          inert={!chatVisible || presentation === 'drawer'}
        >
          <AgentPanel variant="side" />
        </div>
      </div>
    </div>
  )
}

function AgentSessionList(): React.ReactElement {
  const workspace = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const conversations = useAgentStore((state) => state.conversations)
  const order = useAgentStore((state) => state.conversationOrder)
  const activeId = useAgentStore((state) => state.activeConversationId)
  const tabs = useTabStore((state) => state.tabs)
  const agent = useAgentStore.getState()
  if (workspace.kind === 'remote') return <RemoteSessionsSidebar workspaceRef={workspace} />
  return (
    <LocalSessionsList
      workspaceRef={workspace}
      sessionGroups={getWorkspaceConversationGroups(order, conversations, workspace)}
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
