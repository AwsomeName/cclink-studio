import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgentStore, useFsStore, useOpenProjectsStore, useWorkspaceStore } from '../../stores'
import { localWorkspaceRef, workspaceRefKey } from '@shared/workspace-ref'
import { getRunningProjectCounts } from '../../features/agent-conversations/project-activity'
import { getWorkspaceStateOwnerKey } from '../../utils/workspace-state'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import { IconCloud, IconHistory, IconProjects } from '../common/Icons'
import { useToastStore } from '../common/Toast'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import { openWorkspaceRef } from '../../features/workspace-open/workspace-open-controller'
import { useWorkspaceOpenStore } from '../../features/workspace-open/workspace-open-store'

type DropPlacement = 'before' | 'after'

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
  const reorderProject = useOpenProjectsStore((state) => state.reorderProject)
  const openRemoteWorkspaceRefs = useOpenProjectsStore((state) => state.openRemoteWorkspaceRefs)
  const recentRemoteWorkspaceRefs = useOpenProjectsStore(
    (state) => state.recentRemoteWorkspaceRefs,
  )
  const removeRemoteProject = useOpenProjectsStore((state) => state.removeRemoteProject)
  const recentWorkspacePaths = useFsStore((state) => state.recentWorkspacePaths)
  const switchingPath = useFsStore((state) => state.switchingPath)
  const workspaceLoading = useFsStore((state) => state.loading)
  const workspacePicking = useFsStore((state) => state.picking)
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
  const showContextMenu = useContextMenuStore((state) => state.show)

  const scrollRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const projectRefs = useRef(new Map<string, HTMLButtonElement>())
  const draggingPathRef = useRef<string | null>(null)
  const suppressClickRef = useRef(false)

  const activePath = activeWorkspaceRef.kind === 'local' ? activeWorkspaceRef.path : null
  const activeWorkspaceKey = workspaceRefKey(activeWorkspaceRef)
  const workspaceBusy = workspaceLoading || workspacePicking || switchingPath !== null
  const labels = useMemo(() => buildProjectLabels(openProjectPaths), [openProjectPaths])
  const runningProjectCounts = useMemo(
    () => getRunningProjectCounts(conversations),
    [conversations],
  )
  const historyProjectPaths = useMemo(
    () => knownHistoryPaths.filter((path) => !openProjectPaths.includes(path)),
    [knownHistoryPaths, openProjectPaths],
  )
  const historyRemoteWorkspaceRefs = useMemo(() => {
    const openKeys = new Set(openRemoteWorkspaceRefs.map(workspaceRefKey))
    return recentRemoteWorkspaceRefs.filter((ref) => !openKeys.has(workspaceRefKey(ref)))
  }, [openRemoteWorkspaceRefs, recentRemoteWorkspaceRefs])

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

  const activateProject = async (path: string): Promise<boolean> => {
    if (activePath === path) return true
    try {
      await openWorkspaceRef(localWorkspaceRef(path))
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : '项目切换失败，已保留当前现场', 'error')
      return false
    }
  }

  const activateRemoteProject = async (
    ref: (typeof openRemoteWorkspaceRefs)[number],
  ): Promise<boolean> => {
    try {
      await openWorkspaceRef(ref)
      return true
    } catch (error) {
      useWorkspaceOpenStore.getState().showRemote()
      showToast(error instanceof Error ? error.message : '远程项目切换失败', 'error')
      return false
    }
  }

  const closeRemoteProject = async (index: number): Promise<void> => {
    const ref = openRemoteWorkspaceRefs[index]
    if (!ref) return
    const closingActive = workspaceRefKey(ref) === activeWorkspaceKey
    if (!closingActive) {
      removeRemoteProject(ref)
      return
    }
    const fallbackRemote = openRemoteWorkspaceRefs.find(
      (candidate) => workspaceRefKey(candidate) !== workspaceRefKey(ref),
    )
    let switched = false
    if (fallbackRemote) {
      switched = await activateRemoteProject(fallbackRemote)
    } else {
      const fallbackLocal = openProjectPaths.at(-1)
      if (fallbackLocal) {
        switched = await activateProject(fallbackLocal)
      } else {
        await closeWorkspace()
        switched = useWorkspaceStore.getState().activeWorkspaceRef.kind === 'global'
        if (!switched) {
          showToast(useFsStore.getState().error || '项目关闭失败，已保留当前项目', 'error')
        }
      }
    }
    if (switched) removeRemoteProject(ref)
  }

  const openHistoryProject = async (path: string): Promise<void> => {
    if (await activateProject(path)) setHistoryOpen(false)
  }

  const openHistoryRemoteProject = async (
    ref: (typeof recentRemoteWorkspaceRefs)[number],
  ): Promise<void> => {
    if (await activateRemoteProject(ref)) setHistoryOpen(false)
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
                  disabled={workspaceBusy}
                  onClick={() => {
                    if (suppressClickRef.current) return
                    void activateProject(path)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setHistoryOpen(false)
                    showContextMenu({
                      target: { kind: 'project', workspaceKey: path, path },
                      x: event.clientX,
                      y: event.clientY,
                      focusReturn: event.currentTarget,
                    })
                  }}
                  onKeyDown={(event) => {
                    if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
                    event.preventDefault()
                    setHistoryOpen(false)
                    showContextMenu(
                      buildKeyboardContextMenuInput(
                        { kind: 'project', workspaceKey: path, path },
                        event.currentTarget,
                      ),
                    )
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
            {openRemoteWorkspaceRefs.map((ref, index) => {
              const key = workspaceRefKey(ref)!
              const active = key === activeWorkspaceKey
              return (
                <div key={key} className="project-strip-remote-item">
                  <button
                    type="button"
                    className={`project-strip-item ${active ? 'active' : ''}`}
                    title={`${ref.endpointName || 'CCLink'} · ${ref.path}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => void activateRemoteProject(ref)}
                  >
                    <IconCloud size={13} />
                    <span className="project-strip-label">
                      {ref.label || getProjectName(ref.path)}
                    </span>
                    <span className="project-strip-remote-source">远程</span>
                  </button>
                  <button
                    type="button"
                    className="project-strip-remote-close"
                    aria-label={`移除远程项目 ${ref.label || getProjectName(ref.path)}`}
                    title="从项目条移除"
                    onClick={() => void closeRemoteProject(index)}
                  >
                    ×
                  </button>
                </div>
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
                ) : historyProjectPaths.length > 0 || historyRemoteWorkspaceRefs.length > 0 ? (
                  <>
                    {historyProjectPaths.map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="project-history-item"
                        title={path}
                        disabled={workspaceBusy}
                        onClick={() => void openHistoryProject(path)}
                      >
                        <IconProjects size={14} />
                        <span className="project-history-item-main">
                          <span>{getProjectName(path)}</span>
                          <span>{path}</span>
                        </span>
                      </button>
                    ))}
                    {historyRemoteWorkspaceRefs.map((ref) => (
                      <button
                        key={workspaceRefKey(ref)!}
                        type="button"
                        className="project-history-item"
                        title={`${ref.endpointName || 'CCLink'} · ${ref.path}`}
                        disabled={workspaceBusy}
                        onClick={() => void openHistoryRemoteProject(ref)}
                      >
                        <IconCloud size={14} />
                        <span className="project-history-item-main">
                          <span>{ref.label || getProjectName(ref.path)}</span>
                          <span>远程 · {ref.endpointName || 'CCLink'}</span>
                        </span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="project-history-empty">暂无未打开的历史项目</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
