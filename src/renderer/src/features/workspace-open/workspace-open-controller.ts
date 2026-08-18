import type { RemoteWorkspaceRef, WorkspaceRef } from '@shared/workspace-ref'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useCclinkStore } from '../../stores/cclink-store'
import { useFsStore } from '../../stores/fs-store'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { confirmRemoteWorkspaceRef } from '../cclink-remote/remote-workspace-confirmation'
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

function activateRestoredTab(ref: WorkspaceRef): void {
  const key = workspaceRefKey(ref)
  const tab = useTabStore
    .getState()
    .tabs.find((item) => workspaceRefKey(item.workspaceRef ?? { kind: 'global' }) === key)
  if (tab) useTabStore.getState().activateTab(tab.id)
}

function revealOpenedWorkspace(ref: WorkspaceRef): void {
  useUIStore.getState().setActivePanel('files')
  activateRestoredTab(ref)
}

/** 从系统目录选择器打开本地工作空间，并统一落到文件面板。 */
export async function pickLocalWorkspace(): Promise<boolean> {
  const opened = await useFsStore.getState().openWorkspacePicker()
  if (!opened) return false
  const path = useFsStore.getState().workspacePath
  if (!path) return false
  revealOpenedWorkspace({ kind: 'local', path })
  return true
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
    revealOpenedWorkspace(ref)
    return ref
  }

  const generation = options.generation ?? beginWorkspaceRuntimeTransition()
  let confirmedRef: RemoteWorkspaceRef = ref
  if (!options.confirmedRemote) {
    await useCclinkStore.getState().initialize()
    let state = useCclinkStore.getState()
    if (!state.service?.configured) {
      throw new Error(state.service?.message || 'CCLink 远程服务未配置')
    }
    if (!state.session.loggedIn) throw new Error('请先登录 CCLink 远程服务')
    try {
      confirmedRef = await confirmRemoteWorkspaceRef(ref, options.remoteRequestId)
    } catch (error) {
      // 启动后首次远程打开可能命中尚未刷新的设备在线投影。只对该可恢复失败刷新并重试一次。
      const failure = error instanceof Error ? error.message : String(error)
      if (!failure.includes('远程设备不在线')) throw error
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

  const transition = await prepareWorkspaceRuntimeTransition(confirmedRef, { generation })
  const applied = await applyWorkspaceRuntimeTransition(transition)
  if (!applied) throw new Error('工作空间已发生变化，请重试')

  const projects = useOpenProjectsStore.getState()
  projects.replaceRemoteProject(ref, confirmedRef)
  useOpenProjectsStore.getState().addRemoteProject(confirmedRef)
  revealOpenedWorkspace(confirmedRef)
  return confirmedRef
}
