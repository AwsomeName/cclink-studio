import { useEffect } from 'react'
import {
  useFsStore,
  useTabStore,
  useBrowserStore,
  useUpdateStore,
  useWorkspaceStore,
  useGitBackupStore,
} from '../../stores'
import { IconClipboard, IconLink, IconProjects } from '../common/Icons'
import { useToastStore } from '../common/Toast'
import {
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../../shared/workspace-ref'
import { APP_EDITION_LABEL } from '../../app-metadata'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import { UpdatePanel } from '../update/UpdatePanel'
import { IconRefresh } from '../common/Icons'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import { useCommandStore } from '../../stores/command-store'
import { GitStatusBarItem } from './GitStatusBarItem'
import { GitOperationDialog } from './GitOperationDialog'

export function StatusBar(): React.ReactElement {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const currentUrl = useBrowserStore((s) =>
    activeTab?.type === 'browser' ? s.tabs[activeTab.id]?.url : undefined,
  )
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const workspacePath = useFsStore((s) => s.workspacePath)
  const switchingPath = useFsStore((s) => s.switchingPath)
  const updateSnapshot = useUpdateStore((state) => state.snapshot)
  const openUpdatePanel = useUpdateStore((state) => state.openPanel)
  const showToast = useToastStore((s) => s.show)
  const gitBusy = useGitBackupStore((s) => s.busy)
  const gitError = useGitBackupStore((s) => s.error)
  const showGitDialog = useGitBackupStore((s) => s.dialogOpen)
  const repositoryInput = useGitBackupStore((s) => s.repositoryInput)
  const loadGitWorkspace = useGitBackupStore((s) => s.loadWorkspace)
  const submitFirstGitBackup = useGitBackupStore((s) => s.submitFirstBackup)
  const setRepositoryInput = useGitBackupStore((s) => s.setRepositoryInput)
  const closeGitDialog = useGitBackupStore((s) => s.closeDialog)
  const showContextMenu = useContextMenuStore((s) => s.show)
  const executeCommand = useCommandStore((s) => s.executeCommand)

  const workspaceKey = workspaceRefKey(activeWorkspaceRef)

  const showStatusMenu = (
    itemId: string,
    element: HTMLElement,
    position?: { x: number; y: number },
  ): void => {
    const target = { kind: 'status-item' as const, workspaceKey, itemId }
    showContextMenu(
      position
        ? { target, x: position.x, y: position.y, focusReturn: element }
        : buildKeyboardContextMenuInput(target, element),
    )
  }

  const statusContextProps = (itemId: string) => ({
    'data-status-item': itemId,
    tabIndex: 0,
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      showStatusMenu(itemId, event.currentTarget, { x: event.clientX, y: event.clientY })
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
      event.preventDefault()
      showStatusMenu(itemId, event.currentTarget)
    },
  })

  useEffect(() => {
    void loadGitWorkspace(workspacePath)
  }, [loadGitWorkspace, workspacePath])

  const handleFirstGitBackup = async (): Promise<void> => {
    const result = await submitFirstGitBackup()
    if (result) showToast(result.message, result.success ? 'success' : 'error')
  }

  return (
    <>
      <div className="status-bar">
        <GitStatusBarItem workspacePath={workspacePath} contextProps={statusContextProps('git')} />

        {switchingPath && (
          <span
            className="status-bar-item"
            title={switchingPath}
            {...statusContextProps('workspace-switch')}
          >
            <IconProjects size={12} />
            正在切换到 {switchingPath.split('/').filter(Boolean).at(-1) ?? switchingPath}...
          </span>
        )}

        <span
          className="status-bar-item"
          title={workspaceKey ?? '未归档'}
          {...statusContextProps('workspace')}
        >
          {workspaceRefSourceLabel(activeWorkspaceRef)} · {workspaceRefLabel(activeWorkspaceRef)}
        </span>

        {/* 浏览器 URL（截断显示） */}
        {activeTab?.type === 'browser' && currentUrl && (
          <span className="status-bar-item status-bar-url" {...statusContextProps('browser-url')}>
            <IconLink size={12} />
            {truncateUrl(currentUrl)}
          </span>
        )}

        <span className="status-bar-spacer" aria-hidden="true" />

        <button
          type="button"
          className="status-bar-item framework-diagnostics-status"
          onClick={() =>
            void executeCommand('diagnostics.copyFrameworkLogs', { source: 'toolbar' })
          }
          title="复制 Agent 以外的工作台框架诊断日志"
          {...statusContextProps('framework-diagnostics')}
        >
          <IconClipboard size={12} />
          框架日志
        </button>

        <button
          type="button"
          className={`status-bar-item update-badge phase-${updateSnapshot.phase}`}
          onClick={openUpdatePanel}
          {...statusContextProps('update')}
          title="检查和下载 CCLink Studio 更新"
        >
          <IconRefresh size={12} />
          {getUpdateStatusLabel(updateSnapshot)}
        </button>

        {/* 右侧：版本 */}
        <span
          className="status-bar-item"
          title="本地开源桌面工作台"
          {...statusContextProps('edition')}
        >
          {APP_EDITION_LABEL}
        </span>
      </div>

      <GitOperationDialog />

      {showGitDialog && (
        <div className="git-backup-dialog-overlay" onMouseDown={closeGitDialog}>
          <form
            className="git-backup-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              void handleFirstGitBackup()
            }}
          >
            <h2>备份到 Git</h2>
            <p>填写完整远程仓库地址，或者只填写 GitHub 项目名。</p>
            <input
              autoFocus
              value={repositoryInput}
              maxLength={2048}
              placeholder="my-project 或 https://github.com/user/repo.git"
              onChange={(event) => setRepositoryInput(event.target.value)}
            />
            {gitError && <div className="git-backup-dialog-error">{gitError}</div>}
            <div className="git-backup-dialog-actions">
              <button type="button" disabled={gitBusy} onClick={closeGitDialog}>
                取消
              </button>
              <button type="submit" disabled={gitBusy || !repositoryInput.trim()}>
                {gitBusy ? '备份中…' : '备份当前全部变更'}
              </button>
            </div>
          </form>
        </div>
      )}
      <UpdatePanel />
    </>
  )
}

function getUpdateStatusLabel(
  snapshot: ReturnType<typeof useUpdateStore.getState>['snapshot'],
): string {
  switch (snapshot.phase) {
    case 'checking':
      return '检查更新中…'
    case 'available':
      return `可更新至 v${snapshot.availableRelease?.version ?? ''}`
    case 'downloading':
      return `下载更新 ${Math.round((snapshot.progress?.fraction ?? 0) * 100)}%`
    case 'verifying':
      return '校验更新中…'
    case 'readyToInstall':
      return '更新已下载'
    case 'failed':
      return '更新失败'
    default:
      return '检查更新'
  }
}

/** 截断 URL 显示 */
function truncateUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    return `${u.host}${path}`
  } catch {
    return url.slice(0, 40) + (url.length > 40 ? '...' : '')
  }
}
