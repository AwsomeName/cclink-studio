import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgentStore, useFsStore, useOpenProjectsStore, useWorkspaceStore } from '../../stores'
import { getRunningProjectCounts } from '../../features/agent-conversations/project-activity'
import { getProjectCloseSuccessor } from '../../stores/open-projects-store'
import { getWorkspaceStateOwnerKey } from '../../utils/workspace-state'
import { IconHistory, IconProjects } from '../common/Icons'
import { useToastStore } from '../common/Toast'

type DropPlacement = 'before' | 'after'

interface ProjectMenuState {
  path: string
  x: number
  y: number
}

function getProjectName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function getParentName(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments.at(-2) ?? path
}

function buildProjectLabels(paths: string[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const name = getProjectName(path)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  return new Map(
    paths.map((path) => {
      const name = getProjectName(path)
      return [path, counts.get(name) === 1 ? name : `${name} · ${getParentName(path)}`]
    }),
  )
}

export function ProjectStrip(): React.ReactElement {
  const openProjectPaths = useOpenProjectsStore((state) => state.openProjectPaths)
  const removeProject = useOpenProjectsStore((state) => state.removeProject)
  const reorderProject = useOpenProjectsStore((state) => state.reorderProject)
  const recentWorkspacePaths = useFsStore((state) => state.recentWorkspacePaths)
  const openRecentWorkspace = useFsStore((state) => state.openRecentWorkspace)
  const closeWorkspace = useFsStore((state) => state.closeWorkspace)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const conversations = useAgentStore((state) => state.conversations)
  const showToast = useToastStore((state) => state.show)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [knownHistoryPaths, setKnownHistoryPaths] = useState<string[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyPosition, setHistoryPosition] = useState({ left: 8, top: 42 })
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<{
    path: string
    placement: DropPlacement
  } | null>(null)
  const [menu, setMenu] = useState<ProjectMenuState | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const projectRefs = useRef(new Map<string, HTMLButtonElement>())
  const draggingPathRef = useRef<string | null>(null)
  const suppressClickRef = useRef(false)

  const activePath = activeWorkspaceRef.kind === 'local' ? activeWorkspaceRef.path : null
  const labels = useMemo(() => buildProjectLabels(openProjectPaths), [openProjectPaths])
  const runningProjectCounts = useMemo(
    () => getRunningProjectCounts(conversations),
    [conversations],
  )
  const historyProjectPaths = useMemo(
    () => knownHistoryPaths.filter((path) => !openProjectPaths.includes(path)),
    [knownHistoryPaths, openProjectPaths],
  )

  useEffect(() => {
    if (!activePath) return
    projectRefs.current
      .get(activePath)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activePath, openProjectPaths])

  useEffect(() => {
    if (!historyOpen) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false)
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [historyOpen])

  useEffect(() => {
    if (!menu) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menu])

  const activateProject = async (path: string): Promise<boolean> => {
    if (activePath === path) return true
    await openRecentWorkspace(path)
    const active = useWorkspaceStore.getState().activeWorkspaceRef
    const success = active.kind === 'local' && active.path === path
    if (!success) showToast('项目切换失败，已保留当前现场', 'error')
    return success
  }

  const openHistoryProject = async (path: string): Promise<void> => {
    if (await activateProject(path)) setHistoryOpen(false)
  }

  const closeProject = async (path: string): Promise<void> => {
    setMenu(null)
    const currentActive = useWorkspaceStore.getState().activeWorkspaceRef
    const isActive = currentActive.kind === 'local' && currentActive.path === path
    if (!isActive) {
      removeProject(path)
      return
    }

    const currentProjects = useOpenProjectsStore.getState().openProjectPaths
    const nextPath = getProjectCloseSuccessor(currentProjects, path)

    if (nextPath) {
      if (await activateProject(nextPath)) removeProject(path)
      return
    }

    await closeWorkspace()
    if (useWorkspaceStore.getState().activeWorkspaceRef.kind === 'global') {
      removeProject(path)
    }
  }

  const toggleHistory = (): void => {
    const rect = historyButtonRef.current?.getBoundingClientRect()
    if (rect) {
      const width = 320
      setHistoryPosition({
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: rect.bottom + 6,
      })
    }
    const nextOpen = !historyOpen
    setHistoryOpen(nextOpen)
    if (!nextOpen) return

    setHistoryLoading(true)
    void window.cclinkStudio.workspaceState
      .listLocalWorkspaces(getWorkspaceStateOwnerKey())
      .then(async (workspaces) => {
        const candidates = [
          ...recentWorkspacePaths,
          ...workspaces.map((workspace) => workspace.workspacePath),
        ].filter((path, index, paths) => paths.indexOf(path) === index)
        const resolvedPaths = await Promise.all(
          candidates.map(async (path) => {
            const result = await window.cclinkStudio.workspaceState
              .resolveLocalWorkspace(path)
              .catch(() => ({ valid: false, workspacePath: null }))
            return result.valid ? result.workspacePath : null
          }),
        )
        setKnownHistoryPaths(
          resolvedPaths.filter(
            (path, index, paths): path is string =>
              typeof path === 'string' && paths.indexOf(path) === index,
          ),
        )
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }

  const handleDragOver = (event: React.DragEvent<HTMLButtonElement>, path: string): void => {
    const sourcePath = draggingPathRef.current
    if (!sourcePath || sourcePath === path) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const placement: DropPlacement = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    setDragOver({ path, placement })

    const scrollElement = scrollRef.current
    if (!scrollElement) return
    const scrollRect = scrollElement.getBoundingClientRect()
    if (event.clientX < scrollRect.left + 28) scrollElement.scrollLeft -= 18
    if (event.clientX > scrollRect.right - 28) scrollElement.scrollLeft += 18
  }

  return (
    <div className="project-strip">
      <div className="project-strip-shell">
        <div
          ref={scrollRef}
          className="project-strip-scroll"
          onWheel={(event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
            event.preventDefault()
            event.currentTarget.scrollLeft += event.deltaY
          }}
        >
          <div className="project-strip-list">
            {openProjectPaths.map((path) => {
              const active = path === activePath
              const runningCount = runningProjectCounts.get(path) ?? 0
              const dropClass = dragOver?.path === path ? `drop-${dragOver.placement}` : ''
              return (
                <button
                  key={path}
                  ref={(element) => {
                    if (element) projectRefs.current.set(path, element)
                    else projectRefs.current.delete(path)
                  }}
                  className={`project-strip-item ${active ? 'active' : ''} ${draggingPath === path ? 'dragging' : ''} ${dropClass}`}
                  draggable
                  data-project-path={path}
                  title={path}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    if (suppressClickRef.current) return
                    void activateProject(path)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setHistoryOpen(false)
                    setMenu({ path, x: event.clientX, y: event.clientY })
                  }}
                  onDragStart={(event) => {
                    suppressClickRef.current = true
                    draggingPathRef.current = path
                    setDraggingPath(path)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/project-path', path)
                  }}
                  onDragOver={(event) => handleDragOver(event, path)}
                  onDrop={(event) => {
                    event.preventDefault()
                    const sourcePath =
                      event.dataTransfer.getData('text/project-path') || draggingPathRef.current
                    const rect = event.currentTarget.getBoundingClientRect()
                    const placement: DropPlacement =
                      event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                    if (sourcePath) {
                      reorderProject(sourcePath, path, placement)
                    }
                    setDraggingPath(null)
                    draggingPathRef.current = null
                    setDragOver(null)
                  }}
                  onDragEnd={() => {
                    setDraggingPath(null)
                    draggingPathRef.current = null
                    setDragOver(null)
                    requestAnimationFrame(() => {
                      suppressClickRef.current = false
                    })
                  }}
                >
                  <IconProjects size={13} />
                  <span className="project-strip-label">{labels.get(path)}</span>
                  {runningCount > 0 && (
                    <span
                      className="project-strip-run-status"
                      title={`${runningCount} 个任务运行中`}
                      aria-label={`${runningCount} 个任务运行中`}
                    >
                      <span className="project-strip-run-dot" />
                      {runningCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="project-strip-history-wrap" ref={historyRef}>
          <button
            ref={historyButtonRef}
            className={`project-strip-history-button ${historyOpen ? 'active' : ''}`}
            type="button"
            title="历史项目"
            onClick={toggleHistory}
          >
            <IconHistory size={13} />
            <span>历史项目</span>
          </button>

          {historyOpen && (
            <div className="project-history-popover" style={historyPosition}>
              <div className="project-history-header">历史项目</div>
              <div className="project-history-list">
                {historyLoading ? (
                  <div className="project-history-empty">正在加载历史项目…</div>
                ) : historyProjectPaths.length > 0 ? (
                  historyProjectPaths.map((path) => (
                    <button
                      key={path}
                      type="button"
                      className="project-history-item"
                      title={path}
                      onClick={() => void openHistoryProject(path)}
                    >
                      <IconProjects size={14} />
                      <span className="project-history-item-main">
                        <span>{getProjectName(path)}</span>
                        <span>{path}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="project-history-empty">暂无未打开的历史项目</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="context-menu project-strip-context-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 180),
            top: Math.min(menu.y, window.innerHeight - 56),
          }}
        >
          <div className="context-menu-items">
            <button
              type="button"
              className="context-menu-item project-strip-context-action"
              onClick={() => void closeProject(menu.path)}
            >
              <span className="context-menu-icon">✕</span>
              <span>关闭项目</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
