import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useUIStore } from '../stores/ui-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import {
  beginWorkspaceStateRestore,
  endWorkspaceStateRestore,
  flushPendingWorkspaceStateWrites,
  setWorkspaceStateOwnerKey,
} from '../utils/workspace-state'
import {
  applyWorkspaceRuntimeTransition,
  prepareWorkspaceRuntimeTransition,
} from '../utils/workspace-transition'
import { useAgentWorkContext } from './use-agent-work-context'

// 复现 React effect 的 Object.is 依赖比较；保留同一个全局 Tab 时不能靠每次强制执行 effect 掩盖问题。
const effectState = vi.hoisted(() => ({
  deps: null as readonly unknown[] | null,
  pending: [] as Array<() => void>,
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => void, deps: readonly unknown[]) => {
    if (
      !effectState.deps ||
      deps.length !== effectState.deps.length ||
      deps.some((value, index) => !Object.is(value, effectState.deps![index]))
    )
      effectState.pending.push(effect)
    effectState.deps = deps
  },
}))
vi.mock('../stores/ui-store', async (original) => {
  const actual = await original<typeof import('../stores/ui-store')>()
  return {
    ...actual,
    useUIStore: Object.assign(
      (selector: (state: ReturnType<typeof actual.useUIStore.getState>) => unknown) =>
        selector(actual.useUIStore.getState()),
      actual.useUIStore,
    ),
  }
})
vi.mock('../stores/tab-store', async (original) => {
  const actual = await original<typeof import('../stores/tab-store')>()
  return {
    ...actual,
    useTabStore: Object.assign(
      (selector: (state: ReturnType<typeof actual.useTabStore.getState>) => unknown) =>
        selector(actual.useTabStore.getState()),
      actual.useTabStore,
    ),
  }
})
vi.mock('../stores/workspace-store', async (original) => {
  const actual = await original<typeof import('../stores/workspace-store')>()
  return {
    ...actual,
    useWorkspaceStore: Object.assign(
      (selector: (state: ReturnType<typeof actual.useWorkspaceStore.getState>) => unknown) =>
        selector(actual.useWorkspaceStore.getState()),
      actual.useWorkspaceStore,
    ),
  }
})

let targetSections: Record<string, unknown>
function renderEffect(): void {
  useAgentWorkContext(true)
  for (const effect of effectState.pending.splice(0)) effect()
}

beforeEach(() => {
  effectState.deps = null
  effectState.pending.length = 0
  targetSections = {}
  beginWorkspaceStateRestore()
  useTabStore.setState(useTabStore.getInitialState(), true)
  useUIStore.setState(useUIStore.getInitialState(), true)
  useWorkspaceStore.getState().commitActiveWorkspace(localWorkspaceRef('/workspace/a'))
  setWorkspaceStateOwnerKey('local:owner')
  endWorkspaceStateRestore()
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: {
        get: vi.fn(async (key: string) => ({
          version: 1,
          workspaceId: key,
          workspaceKey: key,
          workspacePath: key,
          ownerKey: 'local:owner',
          updatedAt: 1,
          sections: targetSections,
        })),
        setActiveLocalWorkspace: vi.fn(async () => ({ success: true })),
        setSection: vi.fn(async () => ({ success: true })),
      },
      browser: { reconcileViews: vi.fn(async () => {}) },
      terminal: { listSessions: vi.fn(async () => []) },
    },
  })
})

afterEach(async () => {
  await flushPendingWorkspaceStateWrites()
  vi.unstubAllGlobals()
  setWorkspaceStateOwnerKey(null)
})

describe('Agent system layout after workspace commit', () => {
  it('recomputes system layout for the exact same preserved global settings Tab', async () => {
    useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })
    const settingsTab = useTabStore.getState().getActiveTab()
    renderEffect()
    expect(useUIStore.getState().agentPanelMode).toBe('right')
    const transition = await prepareWorkspaceRuntimeTransition(localWorkspaceRef('/workspace/b'))
    expect(await applyWorkspaceRuntimeTransition(transition, { flush: false })).toBe(true)
    expect(useTabStore.getState().getActiveTab()).toBe(settingsTab)
    expect(useUIStore.getState()).toMatchObject({
      agentPanelMode: 'center',
      agentPanelModeSource: 'system',
    })
    renderEffect()
    expect(useUIStore.getState()).toMatchObject({
      agentPanelMode: 'right',
      agentPanelModeSource: 'system',
    })
  })

  it.each(['center', 'right', 'hidden'] as const)(
    'keeps restored user %s above the new workspace system context',
    async (mode) => {
      useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })
      const settingsTab = useTabStore.getState().getActiveTab()
      renderEffect()
      targetSections = { layout: { agentPanelMode: mode, agentPanelModeSource: 'user' } }
      const transition = await prepareWorkspaceRuntimeTransition(localWorkspaceRef('/workspace/b'))
      expect(await applyWorkspaceRuntimeTransition(transition, { flush: false })).toBe(true)
      expect(useTabStore.getState().getActiveTab()).toBe(settingsTab)
      renderEffect()
      expect(useUIStore.getState()).toMatchObject({
        agentPanelMode: mode,
        agentPanelModeSource: 'user',
        agentPanelVisible: mode !== 'hidden',
      })
    },
  )
})
