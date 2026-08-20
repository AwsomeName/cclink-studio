import type { Tab } from '../types'
import { useEditorStore } from '../stores/editor-store'
import { useTabStore } from '../stores/tab-store'
import { resolveConversationTab } from './conversation-tab'
import { recordTerminalLifecycleEvent } from './terminal-lifecycle'
import { runEditorSaveGuard } from '../features/editor-save-guard'
import { clearRemoteFileDraft, getRemoteFileDraft } from './remote-file-draft-registry'
import { confirmAgentRoleDraftExit } from '../features/agent-roles/agent-role-draft-policy'
import { clearAgentRoleDraftController } from '../features/agent-roles/agent-role-draft-registry'
import { getMediaProjectDraft } from '../features/media-production/media-project-draft-registry'

function getEditorFileKey(tab: Tab): string {
  return tab.filePath ?? `virtual:${tab.id}`
}

function getDefaultDraftName(tab: Tab): string {
  const title = tab.title.trim() || '未命名.md'
  return title.toLowerCase().endsWith('.md') ? title : `${title}.md`
}

async function showSaveError(error: unknown): Promise<void> {
  await window.cclinkStudio.dialog.showMessageBox({
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
  const result = await window.cclinkStudio.dialog.showSaveDialog({
    title: '保存草稿',
    defaultPath: getDefaultDraftName(tab),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (result.canceled || !result.filePath) return false

  try {
    await runEditorSaveGuard(fileKey)
    await window.cclinkStudio.fs.writeFile(result.filePath, current)
    editorStore.closeFile(fileKey)
    return true
  } catch (error) {
    await showSaveError(error)
    return false
  }
}

async function closeVirtualDraft(tab: Tab, fileKey: string): Promise<boolean> {
  const editorStore = useEditorStore.getState()
  const file = editorStore.files[fileKey]
  const hasContent = Boolean(file?.currentContent.trim())

  if (!hasContent) {
    editorStore.closeFile(fileKey)
    useTabStore.getState().closeTab(tab.id)
    return true
  }

  const { response } = await window.cclinkStudio.dialog.showMessageBox({
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
    if (!saved) return false
    useTabStore.getState().closeTab(tab.id)
    return true
  }

  if (response === 1) {
    useTabStore.getState().closeTab(tab.id)
    return true
  }

  if (response === 2) {
    editorStore.closeFile(fileKey)
    useTabStore.getState().closeTab(tab.id)
    return true
  }
  return false
}

async function closeNamedEditorFile(tab: Tab, fileKey: string): Promise<boolean> {
  const editorStore = useEditorStore.getState()
  const file = editorStore.files[fileKey]

  if (!file?.dirty) {
    editorStore.closeFile(fileKey)
    useTabStore.getState().closeTab(tab.id)
    return true
  }

  const { response } = await window.cclinkStudio.dialog.showMessageBox({
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
      const saving = editorStore.saveFile(fileKey)
      const sessionId = useEditorStore.getState().files[fileKey]?.sessionId
      const result = await saving
      if (result === 'moved') {
        await showSaveError(new Error('文件在保存期间已移动，请在新位置重新保存'))
        return false
      }
      if (result !== 'saved') return false
      // Saving writes the snapshot captured at the start of the request. If the
      // user edits again while that request is in flight, EditorStore preserves
      // newer buffer as dirty. Resolve by session because a path migration may
      // have happened while saving; never treat a missing old key as clean.
      const latestFiles = useEditorStore.getState().files
      const latestEntry =
        sessionId === undefined
          ? ([fileKey, latestFiles[fileKey]] as const)
          : Object.entries(latestFiles).find(([, candidate]) => candidate.sessionId === sessionId)
      if (!latestEntry?.[1] || latestEntry[1].dirty) return false
      editorStore.closeFile(latestEntry[0])
      useTabStore.getState().closeTab(tab.id)
      return true
    } catch (error) {
      await showSaveError(error)
      return false
    }
  }

  if (response === 1) {
    editorStore.closeFile(fileKey)
    useTabStore.getState().closeTab(tab.id)
    return true
  }
  return false
}

async function closeConversationView(tab: Tab): Promise<boolean> {
  const conversationTarget = resolveConversationTab(tab)
  if (!conversationTarget) return false
  useTabStore.getState().closeTab(tab.id)
  return true
}

async function closeRemoteFile(tab: Tab): Promise<boolean> {
  if (!tab.dirty) {
    clearRemoteFileDraft(tab.id)
    useTabStore.getState().closeTab(tab.id)
    return true
  }
  const draft = getRemoteFileDraft(tab.id)
  if (!draft) {
    await showSaveError('远程文件编辑状态不可用，已阻止关闭以避免丢失修改')
    return false
  }
  const { response } = await window.cclinkStudio.dialog.showMessageBox({
    type: 'question',
    title: '关闭远程文件',
    message: `要保存对“${tab.title}”的修改吗？`,
    detail: '保存会通过当前远程 Agent 写入；不保存会丢弃本次修改。',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
  })
  if (response === 2) return false
  if (response === 0 && !(await draft.save())) return false
  if (response === 1) draft.discard()
  clearRemoteFileDraft(tab.id)
  useTabStore.getState().closeTab(tab.id)
  return true
}

function terminalHasActiveProcess(tab: Tab): boolean {
  return ['starting', 'running', 'blocked'].includes(tab.terminal?.status ?? 'idle')
}

async function closeTerminalView(tab: Tab): Promise<boolean> {
  const terminal = tab.terminal
  if (
    terminal?.runtime.location === 'remote' &&
    terminal.sessionId &&
    terminalHasActiveProcess(tab)
  ) {
    const { response } = await window.cclinkStudio.dialog.showMessageBox({
      type: 'question',
      title: '关闭远程 Terminal',
      message: '这个远程 Terminal 中仍有正在运行的 Shell。',
      detail: '可以终止远程 PTY，或只关闭视图并让它在租约内继续运行。',
      buttons: ['终止并关闭', '保留进程', '取消'],
      defaultId: 1,
      cancelId: 2,
    })
    if (response === 2) return false
    if (response === 0) {
      const result = await window.cclinkStudio.terminal.terminatePty(terminal.sessionId)
      if (!result.success) {
        await window.cclinkStudio.dialog.showMessageBox({
          type: 'error',
          title: '远程 Terminal 关闭失败',
          message: '无法确认远程 PTY 已经终止',
          detail: result.error || '远程 Terminal 后端未返回成功结果',
          buttons: ['知道了'],
          defaultId: 0,
          cancelId: 0,
        })
        return false
      }
      await recordTerminalLifecycleEvent(terminal, 'closed', '远程 Terminal 已终止并关闭')
      useTabStore.getState().closeTab(tab.id)
      return true
    }
  }
  const message = terminalHasActiveProcess(tab)
    ? 'Terminal 视图已关闭，进程保留'
    : 'Terminal 视图已关闭'
  await recordTerminalLifecycleEvent(terminal, 'closed', message)
  useTabStore.getState().closeTab(tab.id)
  return true
}

async function closeScheduledTaskView(tab: Tab): Promise<boolean> {
  if (!tab.dirty) {
    useTabStore.getState().closeTab(tab.id)
    return true
  }
  const { response } = await window.cclinkStudio.dialog.showMessageBox({
    type: 'question',
    title: '关闭定时任务',
    message: `“${tab.title}”有未保存的修改`,
    detail: '放弃修改会保留最近已保存的任务定义；新建草稿将被丢弃。',
    buttons: ['放弃修改', '继续编辑'],
    defaultId: 1,
    cancelId: 1,
  })
  if (response !== 0) return false
  useTabStore.getState().closeTab(tab.id)
  return true
}

async function closeMediaProjectView(tab: Tab): Promise<boolean> {
  if (!tab.dirty) {
    useTabStore.getState().closeTab(tab.id)
    return true
  }
  const draft = getMediaProjectDraft(tab.id)
  if (!draft) {
    await showSaveError('宣发视频工程编辑状态不可用，已阻止关闭以避免丢失修改')
    return false
  }
  const { response } = await window.cclinkStudio.dialog.showMessageBox({
    type: 'question',
    title: '关闭宣发视频工程',
    message: `要保存对“${tab.title}”的修改吗？`,
    detail: '不保存会丢弃本次未保存的分镜和品牌设置。',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
  })
  if (response === 2) return false
  if (response === 0 && !(await draft.save())) return false
  useTabStore.getState().closeTab(tab.id)
  return true
}

async function closeWebResourceDraft(tab: Tab): Promise<boolean> {
  const draftId = tab.webResourceDraftRef?.draftId
  if (!draftId || tab.workspaceRef?.kind !== 'local') return false
  const sharedDraftTabs = useTabStore
    .getState()
    .tabs.filter((item) => item.id !== tab.id && item.webResourceDraftRef?.draftId === draftId)
  if (sharedDraftTabs.length > 0) {
    useTabStore.getState().closeTab(tab.id)
    return true
  }
  try {
    const result = await window.cclinkStudio.webResources.cancelDraft({
      workspaceRef: tab.workspaceRef,
      draftId,
      tabId: tab.id,
    })
    if (!result.success) throw new Error(result.error.message)
    useTabStore.getState().closeTab(tab.id)
    return true
  } catch (error) {
    await showSaveError(error)
    return false
  }
}

export async function closeTabWithDraftPolicy(tabId: string): Promise<boolean> {
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
  if (!tab) return false

  if (resolveConversationTab(tab)) {
    return closeConversationView(tab)
  }

  if (tab.type === 'terminal') {
    return closeTerminalView(tab)
  }

  if (tab.type === 'scheduled-task') {
    return closeScheduledTaskView(tab)
  }

  if (tab.type === 'media-production') {
    return closeMediaProjectView(tab)
  }

  if (tab.type === 'browser' && tab.webResourceDraftRef) {
    return closeWebResourceDraft(tab)
  }

  if (tab.type === 'remote-file') return closeRemoteFile(tab)

  if (tab.type === 'agent-role') {
    if (!(await confirmAgentRoleDraftExit(tab.id))) return false
    clearAgentRoleDraftController(tab.id)
    useTabStore.getState().closeTab(tab.id)
    return true
  }

  if (tab.type !== 'editor') {
    useTabStore.getState().closeTab(tabId)
    return true
  }

  const fileKey = getEditorFileKey(tab)
  if (!tab.filePath) {
    return closeVirtualDraft(tab, fileKey)
  }

  return closeNamedEditorFile(tab, fileKey)
}

export async function closeTabsWithDraftPolicy(tabIds: string[]): Promise<boolean> {
  for (const tabId of tabIds) {
    if (!(await closeTabWithDraftPolicy(tabId))) return false
  }
  return true
}
