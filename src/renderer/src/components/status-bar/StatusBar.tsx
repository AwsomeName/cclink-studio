import { useEffect } from 'react'
import {
  useAgentStore,
  useFsStore,
  useTabStore,
  useBrowserStore,
  useUpdateStore,
  useWorkspaceStore,
  useGitBackupStore,
} from '../../stores'
import { IconLink, IconRobot, IconCircle, IconProjects } from '../common/Icons'
import { useToastStore } from '../common/Toast'
import {
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../../shared/workspace-ref'
import { APP_VERSION } from '../../app-metadata'

/** Agent 状态 → 显示文本 */
const AGENT_STATUS_MAP: Record<string, { text: string; color: string }> = {
  disconnected: { text: 'Agent 未连接', color: '#6b7280' },
  connecting: { text: 'Agent 连接中...', color: '#facc15' },
  connected: { text: 'Agent 就绪', color: '#22c55e' },
  streaming: { text: 'Agent 响应中...', color: '#3b82f6' },
  error: { text: 'Agent 连接失败', color: '#ef4444' },
}

/** Tab 类型 → 显示名称 */
const TAB_TYPE_LABEL: Record<string, string> = {
  browser: '浏览器',
  editor: '编辑器',
  preview: '预览',
  'data-source-query': '数据源查询',
  'data-source-result': '数据源结果',
}

export function StatusBar(): React.ReactElement {
  const backendState = useAgentStore((s) => s.backendState)
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const currentUrl = useBrowserStore((s) =>
    activeTab?.type === 'browser' ? s.tabs[activeTab.id]?.url : undefined,
  )
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const workspacePath = useFsStore((s) => s.workspacePath)
  const switchingPath = useFsStore((s) => s.switchingPath)
  const { hasUpdate, latestVersion, downloading, setDownloading, clear } = useUpdateStore()
  const showToast = useToastStore((s) => s.show)
  const gitProjectStatus = useGitBackupStore((s) => s.projectStatus)
  const gitBusy = useGitBackupStore((s) => s.busy)
  const gitError = useGitBackupStore((s) => s.error)
  const showGitDialog = useGitBackupStore((s) => s.dialogOpen)
  const repositoryInput = useGitBackupStore((s) => s.repositoryInput)
  const loadGitWorkspace = useGitBackupStore((s) => s.loadWorkspace)
  const requestGitBackup = useGitBackupStore((s) => s.requestBackup)
  const submitFirstGitBackup = useGitBackupStore((s) => s.submitFirstBackup)
  const setRepositoryInput = useGitBackupStore((s) => s.setRepositoryInput)
  const closeGitDialog = useGitBackupStore((s) => s.closeDialog)

  const agentStatus = AGENT_STATUS_MAP[backendState] ?? AGENT_STATUS_MAP.disconnected
  const tabLabel = activeTab ? (TAB_TYPE_LABEL[activeTab.type] ?? activeTab.title) : ''

  useEffect(() => {
    void loadGitWorkspace(workspacePath)
  }, [loadGitWorkspace, workspacePath])

  const handleDownloadUpdate = async (): Promise<void> => {
    setDownloading(true)
    try {
      await window.cclinkStudio.update.download()
      clear()
    } finally {
      setDownloading(false)
    }
  }

  const handleGitBackupClick = async (): Promise<void> => {
    if (!workspacePath) return
    const result = await requestGitBackup(workspacePath)
    if (result) showToast(result.message, result.success ? 'success' : 'error')
  }

  const handleFirstGitBackup = async (): Promise<void> => {
    const result = await submitFirstGitBackup()
    if (result) showToast(result.message, result.success ? 'success' : 'error')
  }

  return (
    <>
      <div className="status-bar">
        {/* 左侧：Agent 状态 */}
        <span className="status-bar-item">
          <IconRobot size={12} />
          {agentStatus.text}
          <IconCircle size={6} filled color={agentStatus.color} />
        </span>

        {switchingPath && (
          <span className="status-bar-item" title={switchingPath}>
            <IconProjects size={12} />
            正在切换到 {switchingPath.split('/').filter(Boolean).at(-1) ?? switchingPath}...
          </span>
        )}

        {/* 活跃 Tab 信息 */}
        {tabLabel && <span className="status-bar-item">{tabLabel}</span>}

        <span className="status-bar-item" title={workspaceRefKey(activeWorkspaceRef) ?? '未归档'}>
          {workspaceRefSourceLabel(activeWorkspaceRef)} · {workspaceRefLabel(activeWorkspaceRef)}
        </span>

        {/* 浏览器 URL（截断显示） */}
        {activeTab?.type === 'browser' && currentUrl && (
          <span className="status-bar-item status-bar-url">
            <IconLink size={12} />
            {truncateUrl(currentUrl)}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {workspacePath && (
          <button
            type="button"
            className={`status-bar-item git-backup-status ${gitError ? 'error' : ''}`}
            disabled={gitBusy || !gitProjectStatus || Boolean(gitProjectStatus.error)}
            title={
              gitError ??
              gitProjectStatus?.error ??
              gitProjectStatus?.repositoryLabel ??
              '将当前项目全部可备份变更提交并 Push'
            }
            onClick={() => void handleGitBackupClick()}
          >
            <IconLink size={12} />
            {gitBusy
              ? 'Git 备份中…'
              : gitError
                ? 'Git 备份失败'
                : gitProjectStatus?.lastBackupAt
                  ? `Git 已备份 · ${formatBackupTime(gitProjectStatus.lastBackupAt)}`
                  : '备份到 Git'}
          </button>
        )}

        {/* 更新提示（主进程检查到新版本时显示） */}
        {hasUpdate && (
          <button
            className="status-bar-item update-badge"
            onClick={handleDownloadUpdate}
            title={`下载 v${latestVersion} 到下载文件夹并打开`}
          >
            🆕 新版本 v{latestVersion} {downloading ? '下载中...' : '立即下载'}
          </button>
        )}

        {/* 右侧：版本 */}
        <span className="status-bar-item">CCLink Studio v{APP_VERSION}</span>
      </div>

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
    </>
  )
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

function formatBackupTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '已完成'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
