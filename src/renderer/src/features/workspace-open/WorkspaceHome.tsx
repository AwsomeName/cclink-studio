import { useAgentStore } from '../../stores/agent-store'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useCommandStore } from '../../stores/command-store'
import { useFsStore } from '../../stores/fs-store'
import { useToastStore } from '../../components/common/Toast'
import { useFixedSpacesStore } from './fixed-spaces-store'
import { workspaceRefKey, workspaceRefLabel } from '@shared/workspace-ref'
import { openConversationInWorkbench } from '../agent-conversations/conversation-workbench'
import './fixed-spaces.css'

export async function createPersonalNote(): Promise<void> {
  const { activeWorkspaceRef: ref, generation } = useWorkspaceStore.getState()
  if (ref.kind !== 'local') throw new Error('请先打开本地工作空间')
  const directory = `${ref.path}/笔记`
  await window.cclinkStudio.fs.mkdir(directory)
  if (useWorkspaceStore.getState().generation !== generation) return
  const title = `笔记-${crypto.randomUUID().slice(0, 8)}.md`
  const filePath = `${directory}/${title}`
  await window.cclinkStudio.fs.createFile(filePath)
  if (useWorkspaceStore.getState().generation !== generation) return
  useTabStore.getState().openTab({ type: 'editor', title, filePath, workspaceRef: ref, icon: '📄' })
  await useFsStore.getState().refreshWorkspace()
}

export function WorkspaceHome(): React.ReactElement {
  const ref = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const spaces = useFixedSpacesStore((state) => state.spaces)
  const tabs = useTabStore((state) => state.tabs)
  const conversations = useAgentStore((state) => state.conversations)
  const key = workspaceRefKey(ref)
  const personal = ref.kind === 'local' && ref.path === spaces?.personal?.workspacePath
  const recent = tabs
    .filter((tab) => tab.type === 'editor' && workspaceRefKey(tab.workspaceRef ?? ref) === key)
    .slice(-6)
    .reverse()
  const chats = Object.values(conversations)
    .filter(
      (chat) =>
        !chat.archivedAt &&
        chat.runtime.workspaceRef &&
        workspaceRefKey(chat.runtime.workspaceRef) === key,
    )
    .slice(-5)
    .reverse()
  const execute = (id: string): void => {
    void useCommandStore
      .getState()
      .executeCommand(id, { source: 'toolbar' })
      .then((result) => {
        if (!result.ok) useToastStore.getState().show(result.message || '操作失败', 'error')
      })
  }
  return (
    <div className="workspace-home">
      <span className="workspace-home-eyebrow">{personal ? '个人工作台' : '工作空间'}</span>
      <h1>{personal ? '我的空间' : workspaceRefLabel(ref)}</h1>
      <p>从一份笔记、一次对话开始。内容保存在当前空间，随时回来继续。</p>
      {ref.kind === 'local' && <small className="workspace-home-path">{ref.path}</small>}
      <div className="workspace-home-actions">
        <button disabled={ref.kind !== 'local'} onClick={() => execute('workspace.new-note')}>
          新建笔记<span>记录想法与日常资料</span>
        </button>
        <button onClick={() => execute('agent.newConversation')}>
          新建会话<span>在当前空间开始工作</span>
        </button>
        <button onClick={() => execute('browser.newTab')}>
          打开网页<span>浏览与整理资料</span>
        </button>
      </div>
      <section>
        <h2>最近打开的文档</h2>
        {recent.length ? (
          recent.map((tab) => (
            <button
              className="workspace-home-record"
              key={tab.id}
              onClick={() => useTabStore.getState().activateTab(tab.id)}
            >
              {tab.title}
              <span>继续编辑 →</span>
            </button>
          ))
        ) : (
          <p>还没有打开的文档。新建一份笔记，或从“文件”打开已有资料。</p>
        )}
      </section>
      <section>
        <h2>最近会话</h2>
        {chats.length ? (
          chats.map((chat) => (
            <button
              className="workspace-home-record"
              key={chat.id}
              onClick={() => openConversationInWorkbench(chat.id)}
            >
              {chat.title}
              <span>打开会话 →</span>
            </button>
          ))
        ) : (
          <p>当前空间还没有会话。</p>
        )}
      </section>
    </div>
  )
}
