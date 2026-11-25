import type { LocalWorkspaceRef, RemoteWorkspaceRef, WorkspaceRef } from '@shared/workspace-ref'
import { useCclinkStore } from '../../stores/cclink-store'
import { useFsStore } from '../../stores/fs-store'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import { confirmRemoteWorkspaceRef } from '../cclink-remote/remote-workspace-confirmation'
import { showWorkspaceHome } from './workspace-home-navigation'
import {
  applyWorkspaceRuntimeTransition,
  beginWorkspaceRuntimeTransition,
  isWorkspaceRuntimeTransitionCurrent,
  prepareWorkspaceRuntimeTransition,
} from '../../utils/workspace-transition'

export interface OpenWorkspaceRefOptions {
  /** 远程引用刚由 openWorkspace 返回时无需重复确认。 */
  confirmedRemote?: boolean
  /** 在远程发现开始前占用 generation，保证后发切换可以淘汰旧请求。 */
  generation?: number
  /** renderer 创建的远程打开请求标识，用于跨 IPC 精确取消。 */
  remoteRequestId?: string
}

type RemoteOpenStage = 'connect' | 'confirm' | 'refresh-retry' | 'prepare' | 'apply'

/**
 * 远程打开失败对用户只显示短暂 toast；这里写入框架诊断日志，便于导出报告定位失败阶段。
 * 只记录设备与工作空间标识，不记录远程路径。
 */
function logRemoteOpenFailure(
  ref: RemoteWorkspaceRef,
  stage: RemoteOpenStage,
  startedAt: number,
  realtimeBefore: string,
  options: OpenWorkspaceRefOptions,
  error: unknown,
): void {
  const state = useCclinkStore.getState()
  const server = state.servers.find((candidate) => candidate.id === ref.endpointId)
  console.warn('[WorkspaceOpen] 远程项目打开失败', {
    endpointId: ref.endpointId,
    workspaceId: ref.workspaceId,
    stage,
    confirmedRemote: Boolean(options.confirmedRemote),
    elapsedMs: Date.now() - startedAt,
    realtimeBefore,
    realtimeAfter: state.realtime.state,
    serverStatus: server?.status ?? 'unknown',
    storeError: state.error,
    message: error instanceof Error ? error.message : String(error),
  })
}

/** 从系统目录选择器打开本地工作空间，保持目标工作空间恢复出的布局。 */
export async function pickLocalWorkspace(): Promise<boolean> {
  const opened = await useFsStore.getState().openWorkspacePicker()
  if (!opened) return false
  const path = useFsStore.getState().workspacePath
  if (!path) return false
  return true
}

export async function openDefaultWorkspace(): Promise<LocalWorkspaceRef | null> {
  const generation = beginWorkspaceRuntimeTransition()
  const result = await window.cclinkStudio.workspaceState.ensureDefaultWorkspace()
  if (!isWorkspaceRuntimeTransitionCurrent(generation)) return null
  if (result.success && !result.workspacePath) {
    // My Space is not set up yet: show first use instead of creating a folder (D2).
    const { useFixedSpacesStore } = await import('./fixed-spaces-store')
    useFixedSpacesStore.setState({ firstUse: true })
    return null
  }
  if (!result.success || !result.workspacePath)
    throw new Error(result.error || '默认工作空间不可用')
  const ref: LocalWorkspaceRef = { kind: 'local', path: result.workspacePath }
  await openWorkspaceRef(ref)
  return showWorkspaceHome(ref) ? ref : null
}

/**
 * 统一激活已有工作空间。来源只负责形成 WorkspaceRef，切换事务由 Studio 基础层提交。
 */
export async function openWorkspaceRef(
  ref: WorkspaceRef,
  options: OpenWorkspaceRefOptions = {},
): Promise<WorkspaceRef> {
  if (ref.kind === 'global') throw new Error('未归档工作空间不能通过打开入口激活')

  if (ref.kind === 'local') {
    const opened = await useFsStore.getState().openRecentWorkspace(ref.path)
    if (!opened) {
      throw new Error(useFsStore.getState().error || '本地工作空间打开失败')
    }
    return ref
  }

  const generation = options.generation ?? beginWorkspaceRuntimeTransition()
  const startedAt = Date.now()
  const realtimeBefore = useCclinkStore.getState().realtime.state
  let stage: RemoteOpenStage = 'connect'
  let confirmedRef: RemoteWorkspaceRef = ref
  try {
    if (!options.confirmedRemote) {
      await useCclinkStore.getState().initialize()
      let state = useCclinkStore.getState()
      if (!state.service?.configured) {
        throw new Error(state.service?.message || 'CCLink 远程服务未配置')
      }
      if (!state.session.loggedIn) throw new Error('请先登录 CCLink 远程服务')
      if (!(await state.connectRealtime())) {
        throw new Error(useCclinkStore.getState().error || 'CCLink 远程连接失败')
      }
      state = useCclinkStore.getState()
      stage = 'confirm'
      try {
        confirmedRef = await confirmRemoteWorkspaceRef(ref, options.remoteRequestId)
      } catch (error) {
        // 启动后首次远程打开可能命中尚未刷新的设备在线投影。只对该可恢复失败刷新并重试一次。
        const failure = error instanceof Error ? error.message : String(error)
        if (!failure.includes('远程设备不在线')) throw error
        stage = 'refresh-retry'
        await state.refreshServers()
        if (!isWorkspaceRuntimeTransitionCurrent(generation)) {
          throw new Error('远程项目打开已取消')
        }
        state = useCclinkStore.getState()
        const server = state.servers.find((candidate) => candidate.id === ref.endpointId)
        if (server?.status !== 'online') throw error
        confirmedRef = await confirmRemoteWorkspaceRef(ref, options.remoteRequestId)
      }
    }

    stage = 'prepare'
    const transition = await prepareWorkspaceRuntimeTransition(confirmedRef, { generation })
    stage = 'apply'
    const applied = await applyWorkspaceRuntimeTransition(transition)
    if (!applied) throw new Error('工作空间已发生变化，请重试')
  } catch (error) {
    logRemoteOpenFailure(ref, stage, startedAt, realtimeBefore, options, error)
    throw error
  }

  const projects = useOpenProjectsStore.getState()
  projects.replaceRemoteProject(ref, confirmedRef)
  useOpenProjectsStore.getState().addRemoteProject(confirmedRef)
  return confirmedRef
}
