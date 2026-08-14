import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  MediaAspectRatio,
  MediaProjectPlatform,
  MediaProjectSummary,
} from '@shared/media-production/media-project-types'
import type { LocalWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { useToastStore } from '../../components/common/Toast'
import { IconChevronDown, IconChevronRight, IconPlus } from '../../components/common/Icons'

const PLATFORM_LABELS: Record<MediaProjectPlatform, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  'wechat-video': '视频号',
  bilibili: 'B 站',
  web: '官网',
}

export function PromotionalVideoSidebar({
  workspacePath,
  workspaceRef,
}: {
  workspacePath: string
  workspaceRef: LocalWorkspaceRef
}): React.ReactElement {
  const [expanded, setExpanded] = useState(true)
  const [projects, setProjects] = useState<MediaProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [platform, setPlatform] = useState<MediaProjectPlatform>('douyin')
  const [aspectRatio, setAspectRatio] = useState<MediaAspectRatio>('9:16')
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(30)
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const openTab = useTabStore((state) => state.openTab)
  const showToast = useToastStore((state) => state.show)
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const currentMarkdownPath = useMemo(() => {
    if (activeTab?.type !== 'editor' || !activeTab.filePath) return null
    return /\.(?:md|markdown)$/i.test(activeTab.filePath) ? activeTab.filePath : null
  }, [activeTab])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    const result = await window.cclinkStudio.mediaProjects.list(workspacePath)
    if (result.success) {
      setProjects(result.projects)
      setError(null)
    } else {
      setProjects([])
      setError(result.error.message)
    }
    setLoading(false)
  }, [workspacePath])

  useEffect(() => {
    void refresh()
    return window.cclinkStudio.mediaProjects.onChanged((changedWorkspacePath) => {
      if (changedWorkspacePath === workspacePath) void refresh()
    })
  }, [refresh, workspacePath])

  const openProject = useCallback(
    (project: Pick<MediaProjectSummary, 'id' | 'title'>): void => {
      openTab({
        type: 'media-production',
        title: project.title,
        icon: '🎬',
        workspaceRef,
        mediaProject: { projectId: project.id },
      })
    },
    [openTab, workspaceRef],
  )

  const chooseSource = async (): Promise<string | null> => {
    if (currentMarkdownPath) return currentMarkdownPath
    const selected = await window.cclinkStudio.dialog.showOpenDialog({
      title: '选择工作空间中的宣发稿件',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    })
    return selected.canceled ? null : (selected.filePaths[0] ?? null)
  }

  const createProject = async (): Promise<void> => {
    const sourcePath = await chooseSource()
    if (!sourcePath) return
    setCreating(true)
    try {
      const result = await window.cclinkStudio.mediaProjects.create({
        workspacePath,
        sourcePath,
        platform,
        aspectRatio,
        targetDurationSeconds,
      })
      if (!result.success) {
        setError(result.error.message)
        showToast(result.error.message, 'error')
        return
      }
      setError(null)
      openProject({ id: result.project.id, title: result.project.title })
      showToast(`已创建 ${result.project.scenes.length} 个场景的分镜草稿`, 'success')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="sidebar-section promotional-video-sidebar">
      <button
        className={`sidebar-section-header sidebar-section-header-button ${expanded ? 'expanded' : ''}`}
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
        宣发视频
      </button>

      {expanded && (
        <>
          <div className="promotional-video-create-form">
            <label>
              发布平台
              <select
                value={platform}
                onChange={(event) => setPlatform(event.target.value as MediaProjectPlatform)}
              >
                {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              画幅
              <select
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value as MediaAspectRatio)}
              >
                <option value="9:16">9:16 竖屏</option>
                <option value="16:9">16:9 横屏</option>
                <option value="1:1">1:1 方形</option>
              </select>
            </label>
            <label>
              时长
              <select
                value={targetDurationSeconds}
                onChange={(event) => setTargetDurationSeconds(Number(event.target.value))}
              >
                <option value={30}>30 秒</option>
                <option value={45}>45 秒</option>
                <option value={60}>60 秒</option>
              </select>
            </label>
          </div>
          <button
            className="project-panel-quick-action promotional-video-create-button"
            type="button"
            disabled={creating}
            onClick={() => void createProject()}
          >
            <IconPlus size={14} />
            {creating
              ? '创建中…'
              : currentMarkdownPath
                ? '从当前 Markdown 创建'
                : '选择 Markdown 创建'}
          </button>

          {error && <div className="project-panel-empty promotional-video-error">{error}</div>}
          {loading ? (
            <div className="project-panel-empty compact">正在读取视频工程…</div>
          ) : projects.length === 0 ? (
            <div className="project-panel-empty compact">还没有宣发视频工程</div>
          ) : (
            <div className="promotional-video-project-list">
              {projects.map((project) => (
                <button
                  className="project-panel-row project-panel-row-compact"
                  type="button"
                  key={project.id}
                  onClick={() => openProject(project)}
                >
                  <span className="promotional-video-project-icon">🎬</span>
                  <span className="project-panel-row-main">
                    <span className="project-panel-row-title">{project.title}</span>
                    <span className="project-panel-row-meta">
                      {project.aspectRatio} · {project.targetDurationSeconds}s ·{' '}
                      {project.sceneCount} 个场景
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
