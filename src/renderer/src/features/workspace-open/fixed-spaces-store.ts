import { create } from 'zustand'
import type { FixedSpaces } from '@shared/ipc/workspace-state'
import {
  beginWorkspaceRuntimeTransition,
  isWorkspaceRuntimeTransitionCurrent,
} from '../../utils/workspace-transition'
import { openWorkspaceRef } from './workspace-open-controller'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useFsStore } from '../../stores/fs-store'
import type { CompanySection } from '../company-workspace/company-workspace-commands'

/** Main owns bindings; this is a disposable projection and a transient setup request. */
export const useFixedSpacesStore = create<{
  spaces: FixedSpaces | null
  setup: { section: CompanySection; generation: number; error?: string } | null
}>(() => ({ spaces: null, setup: null }))

export async function refreshFixedSpaces(): Promise<FixedSpaces> {
  const spaces = await window.cclinkStudio.workspaceState.getFixedSpaces()
  useFixedSpacesStore.setState({ spaces })
  return spaces
}

export async function openPersonalSpace(): Promise<void> {
  const generation = beginWorkspaceRuntimeTransition()
  const spaces = await window.cclinkStudio.workspaceState.ensurePersonalSpace().catch((error) => {
    useFsStore.setState({
      error: '我的空间不可用，请定位原目录或打开其他空间；原资料已保留。' + String(error),
    })
    throw error
  })
  useFixedSpacesStore.setState({ spaces })
  if (!isWorkspaceRuntimeTransitionCurrent(generation)) return
  const path = spaces.personal?.workspacePath
  if (!path) throw new Error('我的空间当前不可用')
  await openWorkspaceRef({ kind: 'local', path })
}

export async function openBoundCompany(section: CompanySection): Promise<boolean> {
  const generation = beginWorkspaceRuntimeTransition()
  const spaces = await refreshFixedSpaces()
  if (!isWorkspaceRuntimeTransitionCurrent(generation)) return false
  if (!spaces.company) {
    useFixedSpacesStore.setState({ setup: { section, generation } })
    return false
  }
  const result = await window.cclinkStudio.workspaceState.resolveFixedSpace('company')
  if (!isWorkspaceRuntimeTransitionCurrent(generation)) return false
  if (!result.success || !result.workspacePath) {
    useFixedSpacesStore.setState({
      setup: { section, generation, error: result.error || '原公司目录不可用' },
    })
    return false
  }
  await openWorkspaceRef({ kind: 'local', path: result.workspacePath })
  const active = useWorkspaceStore.getState().activeWorkspaceRef
  return active.kind === 'local' && active.path === result.workspacePath
}
