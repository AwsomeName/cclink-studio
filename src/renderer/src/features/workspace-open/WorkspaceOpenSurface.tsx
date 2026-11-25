import { useFixedSpacesStore } from './fixed-spaces-store'
import { WorkspaceCreationForm, WorkspaceGitAcquire } from './WorkspaceSettingsForm'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { workspaceRefKey, workspaceRefLabel } from '@shared/workspace-ref'
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
import { useCommandStore } from '../../stores/command-store'
import { ProjectDownload } from '../project-sync/ProjectDownload'

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

      {step === 'create' ? (
        <WorkspaceCreationForm onOpened={close} />
      ) : step === 'git' ? (
        <>
          <ProjectDownload onOpened={close} />
          <details className="workspace-open-other-git">
            <summary>其他 Git 地址</summary>
            <WorkspaceGitAcquire onOpened={close} />
          </details>
        </>
      ) : step === 'sources' ? (
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
  const recentRefs = useOpenProjectsStore((state) => state.recentWorkspaceRefs)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runWorkspaceCommand = async (id: string): Promise<void> => {
    setBusyKey(id)
    setError(null)
    try {
      const result = await useCommandStore.getState().executeCommand(id, { source: 'toolbar' })
      if (!result.ok) throw new Error(result.message || '工作空间操作失败')
      onOpened()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyKey(null)
    }
  }
  const pendingRemoteOperationRef = useRef<{
    generation: number
    requestId: string
  } | null>(null)
  const visibleRecentRefs = useMemo(() => recentRefs.slice(0, 10), [recentRefs])

  useEffect(
    () => () => {
      const operation = pendingRemoteOperationRef.current
      if (!operation) return
      cancelWorkspaceRuntimeTransition(operation.generation)
      void window.cclinkStudio.cclink
        .cancelOpenWorkspace({ requestId: operation.requestId })
        .catch(() => {})
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

  const openRecent = async (ref: (typeof visibleRecentRefs)[number]): Promise<void> => {
    const key = workspaceRefKey(ref) ?? 'global'
    if (key === workspaceRefKey(activeWorkspaceRef)) {
      onOpened()
      return
    }
    setBusyKey(key)
    setError(null)
    const operation =
      ref.kind === 'remote'
        ? { generation: beginWorkspaceRuntimeTransition(), requestId: crypto.randomUUID() }
        : null
    pendingRemoteOperationRef.current = operation
    try {
      await openWorkspaceRef(
        ref,
        operation === null
          ? {}
          : { generation: operation.generation, remoteRequestId: operation.requestId },
      )
      pendingRemoteOperationRef.current = null
      onOpened()
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    } finally {
      if (pendingRemoteOperationRef.current?.generation === operation?.generation) {
        pendingRemoteOperationRef.current = null
      }
      setBusyKey(null)
    }
  }

  return (
    <div className="workspace-open-content">
      <div className="workspace-open-source-grid">
        <button
          className="workspace-open-source-card"
          onClick={() => useWorkspaceOpenStore.getState().show('create')}
        >
          <strong>新建项目…</strong>
          <small>选择类型、名称和位置</small>
        </button>
        <button
          className="workspace-open-source-card"
          onClick={() => {
            onOpened()
            useFixedSpacesStore.setState({
              setup: { section: 'overview', generation: beginWorkspaceRuntimeTransition() },
            })
          }}
        >
          <strong>接回公司资料…</strong>
          <small>选择已有公司目录</small>
        </button>
        <button
          className="workspace-open-source-card"
          onClick={() => useWorkspaceOpenStore.getState().show('git')}
        >
          <strong>从 GitHub 下载项目…</strong>
          <small>另一台电脑上已同步的项目，下载后自动保持一致</small>
        </button>
        <button
          type="button"
          className="workspace-open-source-card"
          disabled={busyKey !== null}
          onClick={() => void openLocal()}
        >
          <IconFolder size={22} />
          <span>
            <strong>打开已有项目…</strong>
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

      <button
        type="button"
        disabled={busyKey !== null}
        onClick={() => void runWorkspaceCommand('workspace.unfiled')}
      >
        进入未归档
      </button>

      {error && <div className="workspace-open-error">{error}</div>}

      {visibleRecentRefs.length > 0 && (
        <div className="workspace-open-recent">
          <div className="workspace-open-section-title">最近打开</div>
          {visibleRecentRefs.map((ref) => {
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
