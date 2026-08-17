import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { localWorkspaceRef, workspaceRefKey, workspaceRefLabel } from '@shared/workspace-ref'
import { FloatingSurface } from '../../components/common/FloatingSurface'
import {
  IconChevronRight,
  IconClose,
  IconCloud,
  IconFolder,
  IconProjects,
} from '../../components/common/Icons'
import { useFsStore } from '../../stores/fs-store'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  beginWorkspaceRuntimeTransition,
  cancelWorkspaceRuntimeTransition,
} from '../../utils/workspace-transition'
import { CclinkWorkspacePicker } from '../cclink-remote/CclinkPanel'
import { openWorkspaceRef, pickLocalWorkspace } from './workspace-open-controller'
import { useWorkspaceOpenStore } from './workspace-open-store'

interface WorkspaceOpenSurfaceProps {
  anchorRef: RefObject<HTMLElement | null>
}

export function WorkspaceOpenSurface({
  anchorRef,
}: WorkspaceOpenSurfaceProps): React.ReactElement | null {
  const open = useWorkspaceOpenStore((state) => state.open)
  const step = useWorkspaceOpenStore((state) => state.step)
  const close = useWorkspaceOpenStore((state) => state.close)
  const showRemote = useWorkspaceOpenStore((state) => state.showRemote)
  const showSources = useWorkspaceOpenStore((state) => state.showSources)

  return (
    <FloatingSurface
      anchorRef={anchorRef}
      open={open}
      className="workspace-open-surface"
      role="dialog"
      style={{ width: 420 }}
      onRequestClose={close}
    >
      <div className="workspace-open-header">
        <div>
          <strong>{step === 'remote' ? '打开 CCLink 远程工作空间' : '打开工作空间'}</strong>
          <span>
            {step === 'remote'
              ? '登录只用于托管远程服务，本地能力不受影响'
              : '选择本地文件夹或已配对设备上的远程目录'}
          </span>
        </div>
        <button type="button" onClick={close} title="关闭" aria-label="关闭打开工作空间">
          <IconClose size={14} />
        </button>
      </div>

      {step === 'sources' ? (
        <WorkspaceSourceChooser onRemote={showRemote} onOpened={close} />
      ) : (
        <div className="workspace-open-remote-step">
          <button type="button" className="workspace-open-back" onClick={showSources}>
            返回来源选择
          </button>
          <CclinkWorkspacePicker onWorkspaceOpened={close} />
        </div>
      )}
    </FloatingSurface>
  )
}

function WorkspaceSourceChooser({
  onRemote,
  onOpened,
}: {
  onRemote(): void
  onOpened(): void
}): React.ReactElement {
  const recentWorkspacePaths = useFsStore((state) => state.recentWorkspacePaths)
  const remoteRefs = useOpenProjectsStore((state) => state.recentRemoteWorkspaceRefs)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingRemoteGenerationRef = useRef<number | null>(null)
  const recentRefs = useMemo(
    () => [...recentWorkspacePaths.slice(0, 5).map(localWorkspaceRef), ...remoteRefs.slice(0, 5)],
    [recentWorkspacePaths, remoteRefs],
  )

  useEffect(
    () => () => {
      const generation = pendingRemoteGenerationRef.current
      if (generation !== null) cancelWorkspaceRuntimeTransition(generation)
    },
    [],
  )

  const openLocal = async (): Promise<void> => {
    setBusyKey('local-picker')
    setError(null)
    try {
      if (await pickLocalWorkspace()) {
        onOpened()
      } else {
        setError(useFsStore.getState().error)
      }
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    } finally {
      setBusyKey(null)
    }
  }

  const openRecent = async (ref: (typeof recentRefs)[number]): Promise<void> => {
    const key = workspaceRefKey(ref) ?? 'global'
    if (key === workspaceRefKey(activeWorkspaceRef)) {
      onOpened()
      return
    }
    setBusyKey(key)
    setError(null)
    const generation = ref.kind === 'remote' ? beginWorkspaceRuntimeTransition() : null
    pendingRemoteGenerationRef.current = generation
    try {
      await openWorkspaceRef(ref, generation === null ? {} : { generation })
      pendingRemoteGenerationRef.current = null
      onOpened()
    } catch (openError) {
      if (ref.kind === 'remote') {
        onRemote()
        return
      }
      setError(openError instanceof Error ? openError.message : String(openError))
    } finally {
      if (pendingRemoteGenerationRef.current === generation) {
        pendingRemoteGenerationRef.current = null
      }
      setBusyKey(null)
    }
  }

  return (
    <div className="workspace-open-content">
      <div className="workspace-open-source-grid">
        <button
          type="button"
          className="workspace-open-source-card"
          disabled={busyKey !== null}
          onClick={() => void openLocal()}
        >
          <IconFolder size={22} />
          <span>
            <strong>本地文件夹</strong>
            <small>从这台电脑选择工作空间</small>
          </span>
          <IconChevronRight size={14} />
        </button>
        <button
          type="button"
          className="workspace-open-source-card"
          disabled={busyKey !== null}
          onClick={onRemote}
        >
          <IconCloud size={22} />
          <span>
            <strong>CCLink 远程</strong>
            <small>从已配对设备选择远程目录</small>
          </span>
          <IconChevronRight size={14} />
        </button>
      </div>

      {error && <div className="workspace-open-error">{error}</div>}

      {recentRefs.length > 0 && (
        <div className="workspace-open-recent">
          <div className="workspace-open-section-title">最近打开</div>
          {recentRefs.map((ref) => {
            const key = workspaceRefKey(ref)!
            const remote = ref.kind === 'remote'
            return (
              <button
                type="button"
                key={key}
                disabled={busyKey !== null}
                onClick={() => void openRecent(ref)}
                title={
                  ref.kind === 'local' ? ref.path : `${ref.endpointName || 'CCLink'} · ${ref.path}`
                }
              >
                {remote ? <IconCloud size={14} /> : <IconProjects size={14} />}
                <span>
                  <strong>{workspaceRefLabel(ref)}</strong>
                  <small>{remote ? `远程 · ${ref.endpointName || 'CCLink'}` : ref.path}</small>
                </span>
                {key === workspaceRefKey(activeWorkspaceRef) && <em>当前</em>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
