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
  prepareWorkspaceRuntimeTransition,
} from '../../utils/workspace-transition'

export interface OpenWorkspaceRefOptions {
  /** 远程引用刚由 openWorkspace 返回时无需重复确认。 */
  confirmedRemote?: boolean
  /** 在远程发现开始前占用 generation，保证后发切换可以淘汰旧请求。 */
  generation?: number
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
    const state = useCclinkStore.getState()
    if (!state.service?.configured) {
      throw new Error(state.service?.message || 'CCLink 远程服务未配置')
    }
    if (!state.session.loggedIn) throw new Error('请先登录 CCLink 远程服务')
    confirmedRef = await confirmRemoteWorkspaceRef(ref)
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
