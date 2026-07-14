import { create } from 'zustand'
import type { ActivityPanel } from '../types'
import { persistWorkspaceSection } from '../utils/workspace-state'

export type AgentPanelMode = 'center' | 'right' | 'hidden'
export type AgentPanelModeSource = 'system' | 'user'
export type WorkContext = 'empty' | 'browser' | 'editor' | 'android' | 'preview' | 'settings'

interface UIState {
  /** 当前激活的 Activity Bar 面板 */
  activePanel: ActivityPanel
  /** 侧栏是否展开 */
  sidebarVisible: boolean
  /** Agent 面板是否展开 */
  agentPanelVisible: boolean
  /** 侧栏宽度 (px) */
  sidebarWidth: number
  /** Agent 面板宽度 (px) */
  agentPanelWidth: number
  /** Agent 面板布局：居中入口 / 右侧协作 / 隐藏 */
  agentPanelMode: AgentPanelMode
  /** 布局来源：system 可自动切换，user 代表用户手动选择后锁定 */
  agentPanelModeSource: AgentPanelModeSource

  // --- Actions ---
  setActivePanel: (panel: ActivityPanel) => void
  toggleSidebar: () => void
  hideSidebar: () => void
  toggleAgentPanel: () => void
  setAgentPanelMode: (mode: AgentPanelMode, source?: AgentPanelModeSource) => void
  applySystemWorkContext: (context: WorkContext) => void
  resetAgentLayout: () => void
  setSidebarWidth: (width: number) => void
  setAgentPanelWidth: (width: number) => void
  /** 从主进程 WorkspaceState 恢复布局状态 */
  hydrateFromWorkspaceState: (value: unknown) => void
}

/** UI 状态默认值 */
const UI_DEFAULTS = {
  activePanel: 'files' as ActivityPanel,
  sidebarVisible: true,
  agentPanelVisible: true,
  sidebarWidth: 250,
  agentPanelWidth: 350,
  agentPanelMode: 'center' as AgentPanelMode,
  agentPanelModeSource: 'system' as AgentPanelModeSource,
}

const UI_STORAGE_KEY = 'deepink-ui-state'
const VISIBLE_ACTIVITY_PANELS = new Set<ActivityPanel>([
  'browser',
  'files',
  'operations',
  'sessions',
])

function normalizeActivityPanel(panel: unknown): ActivityPanel {
  return typeof panel === 'string' && VISIBLE_ACTIVITY_PANELS.has(panel as ActivityPanel)
    ? (panel as ActivityPanel)
    : UI_DEFAULTS.activePanel
}

function normalizeAgentPanelMode(value: unknown): AgentPanelMode {
  return value === 'center' || value === 'right' || value === 'hidden'
    ? value
    : UI_DEFAULTS.agentPanelMode
}

function normalizeAgentPanelModeSource(value: unknown): AgentPanelModeSource {
  return value === 'user' || value === 'system' ? value : UI_DEFAULTS.agentPanelModeSource
}

function normalizeStoredAgentPanelMode(value: unknown, legacyVisible: unknown): AgentPanelMode {
  if (value === 'center' || value === 'right' || value === 'hidden') return value
  return legacyVisible === false ? 'hidden' : UI_DEFAULTS.agentPanelMode
}

function normalizeStoredAgentPanelModeSource(
  value: unknown,
  legacyVisible: unknown,
): AgentPanelModeSource {
  if (value === 'user' || value === 'system') return value
  return legacyVisible === false ? 'user' : UI_DEFAULTS.agentPanelModeSource
}

function agentVisibleFromMode(mode: AgentPanelMode): boolean {
  return mode !== 'hidden'
}

function loadStoredUI(): Partial<
  Pick<
    UIState,
    | 'activePanel'
    | 'sidebarVisible'
    | 'agentPanelVisible'
    | 'sidebarWidth'
    | 'agentPanelWidth'
    | 'agentPanelMode'
    | 'agentPanelModeSource'
  >
> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(UI_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<UIState>
    const mode = normalizeStoredAgentPanelMode(parsed.agentPanelMode, parsed.agentPanelVisible)
    return {
      activePanel: normalizeActivityPanel(parsed.activePanel),
      sidebarVisible: parsed.sidebarVisible ?? UI_DEFAULTS.sidebarVisible,
      agentPanelVisible: parsed.agentPanelVisible ?? agentVisibleFromMode(mode),
      sidebarWidth:
        typeof parsed.sidebarWidth === 'number' ? parsed.sidebarWidth : UI_DEFAULTS.sidebarWidth,
      agentPanelWidth:
        typeof parsed.agentPanelWidth === 'number'
          ? parsed.agentPanelWidth
          : UI_DEFAULTS.agentPanelWidth,
      agentPanelMode: mode,
      agentPanelModeSource: normalizeStoredAgentPanelModeSource(
        parsed.agentPanelModeSource,
        parsed.agentPanelVisible,
      ),
    }
  } catch {
    return {}
  }
}

function saveStoredUI(state: UIState): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        activePanel: state.activePanel,
        sidebarVisible: state.sidebarVisible,
        agentPanelVisible: state.agentPanelVisible,
        sidebarWidth: state.sidebarWidth,
        agentPanelWidth: state.agentPanelWidth,
        agentPanelMode: state.agentPanelMode,
        agentPanelModeSource: state.agentPanelModeSource,
      }),
    )
    persistWorkspaceSection('layout', {
      activePanel: state.activePanel,
      sidebarVisible: state.sidebarVisible,
      agentPanelVisible: state.agentPanelVisible,
      sidebarWidth: state.sidebarWidth,
      agentPanelWidth: state.agentPanelWidth,
      agentPanelMode: state.agentPanelMode,
      agentPanelModeSource: state.agentPanelModeSource,
    })
  } catch {
    // localStorage 可能不可用，忽略持久化失败。
  }
}

function normalizeLayoutState(
  value: unknown,
): Partial<
  Pick<
    UIState,
    | 'activePanel'
    | 'sidebarVisible'
    | 'agentPanelVisible'
    | 'sidebarWidth'
    | 'agentPanelWidth'
    | 'agentPanelMode'
    | 'agentPanelModeSource'
  >
> {
  if (!value || typeof value !== 'object') return {}
  const parsed = value as Partial<UIState>
  const mode = normalizeStoredAgentPanelMode(parsed.agentPanelMode, parsed.agentPanelVisible)
  return {
    activePanel: normalizeActivityPanel(parsed.activePanel),
    sidebarVisible:
      typeof parsed.sidebarVisible === 'boolean'
        ? parsed.sidebarVisible
        : UI_DEFAULTS.sidebarVisible,
    agentPanelVisible:
      typeof parsed.agentPanelVisible === 'boolean'
        ? parsed.agentPanelVisible
        : agentVisibleFromMode(mode),
    sidebarWidth:
      typeof parsed.sidebarWidth === 'number' ? parsed.sidebarWidth : UI_DEFAULTS.sidebarWidth,
    agentPanelWidth:
      typeof parsed.agentPanelWidth === 'number'
        ? parsed.agentPanelWidth
        : UI_DEFAULTS.agentPanelWidth,
    agentPanelMode: mode,
    agentPanelModeSource: normalizeStoredAgentPanelModeSource(
      parsed.agentPanelModeSource,
      parsed.agentPanelVisible,
    ),
  }
}

export const useUIStore = create<UIState>((set) => ({
  ...UI_DEFAULTS,
  ...loadStoredUI(),

  setActivePanel: (panel) =>
    set((state) => ({
      activePanel: panel,
      // 点击已激活的面板 → 折叠侧栏；点击其他面板 → 展开侧栏
      sidebarVisible: state.activePanel === panel ? !state.sidebarVisible : true,
    })),

  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  hideSidebar: () => set({ sidebarVisible: false }),
  toggleAgentPanel: () =>
    set((state) => {
      const nextMode: AgentPanelMode = state.agentPanelMode === 'hidden' ? 'right' : 'hidden'
      return {
        agentPanelMode: nextMode,
        agentPanelVisible: agentVisibleFromMode(nextMode),
        agentPanelModeSource: 'user',
      }
    }),
  setAgentPanelMode: (mode, source = 'user') =>
    set({
      agentPanelMode: mode,
      agentPanelVisible: agentVisibleFromMode(mode),
      agentPanelModeSource: source,
    }),
  applySystemWorkContext: (context) =>
    set((state) => {
      const nextMode: AgentPanelMode = context === 'empty' ? 'center' : 'right'
      if (context !== 'empty' && state.agentPanelModeSource === 'user') return state
      if (
        state.agentPanelMode === nextMode &&
        state.agentPanelVisible === agentVisibleFromMode(nextMode) &&
        state.agentPanelModeSource === 'system'
      )
        return state
      return {
        agentPanelMode: nextMode,
        agentPanelVisible: agentVisibleFromMode(nextMode),
        agentPanelModeSource: 'system',
      }
    }),
  resetAgentLayout: () =>
    set({
      agentPanelMode: UI_DEFAULTS.agentPanelMode,
      agentPanelVisible: agentVisibleFromMode(UI_DEFAULTS.agentPanelMode),
      agentPanelModeSource: 'system',
      agentPanelWidth: UI_DEFAULTS.agentPanelWidth,
    }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setAgentPanelWidth: (width) => set({ agentPanelWidth: width, agentPanelModeSource: 'user' }),
  hydrateFromWorkspaceState: (value) => {
    const next = normalizeLayoutState(value)
    if (Object.keys(next).length === 0) return
    set(next)
  },
}))

useUIStore.subscribe((state) => {
  saveStoredUI(state)
})
