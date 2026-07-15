import {
  useAgentStore,
  useTabStore,
  useBrowserStore,
  useUpdateStore,
  useWorkspaceStore,
} from '../../stores'
import { IconLink, IconRobot, IconCircle } from '../common/Icons'
import { workspaceRefKey, workspaceRefLabel, workspaceRefSourceLabel } from '../../../../shared/workspace-ref'

/** Agent 状态 → 显示文本 */
const AGENT_STATUS_MAP: Record<string, { text: string; color: string }> = {
  disconnected: { text: '未连接', color: '#6b7280' },
  connecting: { text: '连接中...', color: '#facc15' },
  connected: { text: 'Agent 就绪', color: '#22c55e' },
  streaming: { text: '响应中...', color: '#3b82f6' },
  error: { text: '连接失败', color: '#ef4444' },
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
  const { hasUpdate, latestVersion, downloading, setDownloading, clear } = useUpdateStore()

  const agentStatus = AGENT_STATUS_MAP[backendState] ?? AGENT_STATUS_MAP.disconnected
  const tabLabel = activeTab ? TAB_TYPE_LABEL[activeTab.type] ?? activeTab.title : ''

  const handleDownloadUpdate = async (): Promise<void> => {
    setDownloading(true)
    try {
      await window.deepink.update.download()
      clear()
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="status-bar">
      {/* 左侧：Agent 状态 */}
      <span className="status-bar-item">
        <IconRobot size={12} />
        {agentStatus.text}
        <IconCircle size={6} filled color={agentStatus.color} />
      </span>

      {/* 活跃 Tab 信息 */}
      {tabLabel && (
        <span className="status-bar-item">
          {tabLabel}
        </span>
      )}

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
      <span className="status-bar-item">
        CCLink Studio v0.1.0
      </span>
    </div>
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
