import type { Tab } from '../types'
import { useEditorStore } from '../stores/editor-store'
import { useTabStore } from '../stores/tab-store'
import { resolveConversationTab } from './conversation-tab'
import { recordTerminalLifecycleEvent } from './terminal-lifecycle'

function getEditorFileKey(tab: Tab): string {
  return tab.filePath ?? `virtual:${tab.id}`
}

function getDefaultDraftName(tab: Tab): string {
  const title = tab.title.trim() || '未命名.md'
  return title.toLowerCase().endsWith('.md') ? title : `${title}.md`
}

async function showSaveError(error: unknown): Promise<void> {
  await window.deepink.dialog.showMessageBox({
    type: 'error',
    title: '保存失败',
    message: '草稿没有保存成功',
    detail: error instanceof Error ? error.message : String(error),
    buttons: ['知道了'],
    defaultId: 0,
    cancelId: 0,
  })
}

async function saveVirtualDraftAsFile(tab: Tab, fileKey: string): Promise<boolean> {
  const editorStore = useEditorStore.getState()
  const current = editorStore.files[fileKey]?.currentContent ?? ''
  const result = await window.deepink.dialog.showSaveDialog({
    title: '保存草稿',
    defaultPath: getDefaultDraftName(tab),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (result.canceled || !result.filePath) return false

  try {
    await window.deepink.fs.writeFile(result.filePath, current)
    editorStore.closeFile(fileKey)
    return true
  } catch (error) {
    await showSaveError(error)
    return false
  }
}

async function closeVirtualDraft(tab: Tab, fileKey: string): Promise<void> {
  const editorStore = useEditorStore.getState()
  const file = editorStore.files[fileKey]
  const hasContent = Boolean(file?.currentContent.trim())

  if (!hasContent) {
    editorStore.closeFile(fileKey)
    useTabStore.getState().closeTab(tab.id)
    return
  }

  const { response } = await window.deepink.dialog.showMessageBox({
    type: 'question',
    title: '关闭草稿',
    message: '要如何处理这个未命名草稿？',
    detail: '保存到文件会正式落盘；保留草稿会关闭 Tab，但仍留在项目区的草稿列表；丢弃会删除草稿。',
    buttons: ['保存到文件', '保留草稿', '丢弃'],
    defaultId: 1,
    cancelId: 1,
  })

  if (response === 0) {
    const saved = await saveVirtualDraftAsFile(tab, fileKey)
    if (!saved) return
    useTabStore.getState().closeTab(tab.id)
    return
  }

  if (response === 1) {
    useTabStore.getState().closeTab(tab.id)
    return
  }

  if (response === 2) {
    editorStore.closeFile(fileKey)
    useTabStore.getState().closeTab(tab.id)
  }
}

async function closeNamedEditorFile(tab: Tab, fileKey: string): Promise<void> {
  const editorStore = useEditorStore.getState()
  const file = editorStore.files[fileKey]

  if (!file?.dirty) {
    editorStore.closeFile(fileKey)
    useTabStore.getState().closeTab(tab.id)
    return
  }

  const { response } = await window.deepink.dialog.showMessageBox({
    type: 'question',
    title: '关闭文件',
    message: `要保存对“${tab.title}”的修改吗？`,
    detail: '不保存会丢弃本次未保存的修改。',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
  })

  if (response === 0) {
    try {
      await editorStore.saveFile(fileKey)
      editorStore.closeFile(fileKey)
      useTabStore.getState().closeTab(tab.id)
    } catch (error) {
      await showSaveError(error)
    }
    return
  }

  if (response === 1) {
    editorStore.closeFile(fileKey)
    useTabStore.getState().closeTab(tab.id)
  }
}

async function closeConversationView(tab: Tab): Promise<void> {
  const conversationTarget = resolveConversationTab(tab)
  if (!conversationTarget) return
  useTabStore.getState().closeTab(tab.id)
}

function terminalHasActiveProcess(tab: Tab): boolean {
  return ['starting', 'running', 'blocked'].includes(tab.terminal?.status ?? 'idle')
}

async function closeTerminalView(tab: Tab): Promise<void> {
  const terminal = tab.terminal
  if (!terminal || !terminalHasActiveProcess(tab) || terminal.closePolicy === 'close-view') {
    await recordTerminalLifecycleEvent(terminal, 'closed', 'Terminal 视图已关闭')
    useTabStore.getState().closeTab(tab.id)
    return
  }

  if (terminal.closePolicy === 'keep-running') {
    const { response } = await window.deepink.dialog.showMessageBox({
      type: 'question',
      title: '关闭 Terminal 视图',
      message: '这个 Terminal 仍在运行。要只关闭视图并保留后台进程吗？',
      detail:
        '当前版本还没有完整进程恢复列表；只关闭视图后，后台进程仍可能继续运行。',
      buttons: ['关闭视图', '取消'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) {
      await recordTerminalLifecycleEvent(terminal, 'closed', 'Terminal 视图已关闭，后台进程保留')
      useTabStore.getState().closeTab(tab.id)
    }
    return
  }

  const { response } = await window.deepink.dialog.showMessageBox({
    type: 'warning',
    title: '结束 Terminal',
    message: '这个 Terminal 仍在运行。关闭 Tab 将结束进程。',
    detail: '本地 shell 会收到终止请求；远程 shell 后端接入后也会复用同一关闭语义。',
    buttons: ['结束并关闭', '取消'],
    defaultId: 1,
    cancelId: 1,
  })

  if (response === 0) {
    await recordTerminalLifecycleEvent(terminal, 'terminated', 'Terminal 关闭时请求结束进程')
    useTabStore.getState().closeTab(tab.id)
  }
}

export async function closeTabWithDraftPolicy(tabId: string): Promise<void> {
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
  if (!tab) return

  if (resolveConversationTab(tab)) {
    await closeConversationView(tab)
    return
  }

  if (tab.type === 'terminal') {
    await closeTerminalView(tab)
    return
  }

  if (tab.type !== 'editor') {
    useTabStore.getState().closeTab(tabId)
    return
  }

  const fileKey = getEditorFileKey(tab)
  if (!tab.filePath) {
    await closeVirtualDraft(tab, fileKey)
    return
  }

  await closeNamedEditorFile(tab, fileKey)
}
