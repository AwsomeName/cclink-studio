import { create } from 'zustand'
import type { ActivityPanel } from '../types'
import {
  getWorkspaceStateOwnerKey,
  isWorkspaceStateRestoring,
  persistWorkspaceSectionNow,
  WorkspaceStatePersistenceError,
} from '../utils/workspace-state'
import {
  captureActiveWorkspaceTarget,
  isWorkspaceTargetCurrent,
  type WorkspaceTarget,
} from './workspace-store'
import { workspaceRefKey } from '@shared/workspace-ref'
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  MAX_AGENT_PANEL_WIDTH,
} from '../utils/panel-layout'
import { recordRendererDiagnosticLog } from '../features/diagnostics/renderer-diagnostic-log'

export type AgentPanelMode = 'center' | 'right' | 'hidden'
type VisibleAgentPanelMode = Exclude<AgentPanelMode, 'hidden'>
export type AgentPanelModeSource = 'system' | 'user'
export type WorkContext =
  | 'empty'
  | 'browser'
  | 'editor'
  | 'android'
  | 'preview'
  | 'settings'
  | 'data-source'

export interface WorkspaceLayoutSnapshot {
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
  /** 最近一次可见布局，用于快照兼容与诊断；重新展开时以当前入口指定布局为准。 */
  agentPanelLastVisibleMode: VisibleAgentPanelMode | null
  /** 布局来源：system 可自动切换，user 代表用户手动选择后锁定 */
  agentPanelModeSource: AgentPanelModeSource
}

interface UIState extends WorkspaceLayoutSnapshot {
  // --- Actions ---
  setActivePanel: (panel: ActivityPanel) => void
  /** 程序化展示面板；与 Activity Bar 的再次点击折叠语义分离。 */
  showPanel: (panel: ActivityPanel) => void
  toggleSidebar: () => void
  hideSidebar: () => void
  toggleAgentPanel: (preferredMode?: VisibleAgentPanelMode) => void
  setAgentPanelMode: (mode: AgentPanelMode, source?: AgentPanelModeSource) => void
  applySystemWorkContext: (context: WorkContext) => void
  resetAgentLayout: () => void
  setSidebarWidth: (width: number) => void
  setAgentPanelWidth: (width: number) => void
  /** 从主进程 WorkspaceState 恢复布局状态 */
  hydrateFromWorkspaceState: (value: unknown) => void
}

/** UI 状态默认值 */
export const UI_DEFAULTS: Readonly<WorkspaceLayoutSnapshot> = {
  activePanel: 'files' as ActivityPanel,
  sidebarVisible: true,
  agentPanelVisible: true,
  sidebarWidth: 250,
  agentPanelWidth: 350,
  agentPanelMode: 'center' as AgentPanelMode,
  agentPanelLastVisibleMode: 'center' as VisibleAgentPanelMode | null,
  agentPanelModeSource: 'system' as AgentPanelModeSource,
}

const UI_STORAGE_KEY = 'cclink-studio-ui-state'
const VISIBLE_ACTIVITY_PANELS = new Set<ActivityPanel>([
  'company-workspace',
  'company-accounts',
  'sessions',
  'agent-roles',
  'browser',
  'files',
  'data-sources',
  'video-creation',
  'production',
  'terminal',
  'operations',
  'scheduled-tasks',
  'affairs',
  'article-publishing',
  'cclink',
])

function normalizeActivityPanel(panel: unknown): ActivityPanel {
  // 项目入口已由顶栏接管；旧快照统一落到文件侧栏。
  if (panel === 'projects') return 'files'
  return typeof panel === 'string' && VISIBLE_ACTIVITY_PANELS.has(panel as ActivityPanel)
    ? (panel as ActivityPanel)
    : UI_DEFAULTS.activePanel
}

function normalizeStoredAgentPanelMode(value: unknown, storedVisible: unknown): AgentPanelMode {
  if (value === 'center' || value === 'right' || value === 'hidden') return value
  return value === undefined && storedVisible === false ? 'hidden' : UI_DEFAULTS.agentPanelMode
}

function normalizeStoredAgentPanelModeSource(
  value: unknown,
  storedVisible: unknown,
): AgentPanelModeSource {
  if (value === 'user' || value === 'system') return value
  return value === undefined && storedVisible === false ? 'user' : UI_DEFAULTS.agentPanelModeSource
}

function agentVisibleFromMode(mode: AgentPanelMode): boolean {
  return mode !== 'hidden'
}

function normalizeLastVisibleAgentPanelMode(value: unknown): VisibleAgentPanelMode | null {
  if (value === 'center' || value === 'right' || value === null) return value
  return UI_DEFAULTS.agentPanelLastVisibleMode
}

function normalizeWidth(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback
}

/** 缺失快照和非法字段都从默认值恢复，绝不继承上一工作空间的布局。 */
export function normalizeWorkspaceLayout(value: unknown): WorkspaceLayoutSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...UI_DEFAULTS }
  const parsed = value as Partial<UIState>
  const mode = normalizeStoredAgentPanelMode(parsed.agentPanelMode, parsed.agentPanelVisible)
  return {
    activePanel: normalizeActivityPanel(parsed.activePanel),
    sidebarVisible:
      typeof parsed.sidebarVisible === 'boolean'
        ? parsed.sidebarVisible
        : UI_DEFAULTS.sidebarVisible,
    agentPanelVisible: agentVisibleFromMode(mode),
    sidebarWidth: normalizeWidth(
      parsed.sidebarWidth,
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
      UI_DEFAULTS.sidebarWidth,
    ),
    agentPanelWidth: normalizeWidth(
      parsed.agentPanelWidth,
      MIN_AGENT_PANEL_WIDTH,
      MAX_AGENT_PANEL_WIDTH,
      UI_DEFAULTS.agentPanelWidth,
    ),
    agentPanelMode: mode,
    agentPanelLastVisibleMode: normalizeLastVisibleAgentPanelMode(parsed.agentPanelLastVisibleMode),
    agentPanelModeSource: normalizeStoredAgentPanelModeSource(
      parsed.agentPanelModeSource,
      parsed.agentPanelVisible,
    ),
  }
}

export interface CapturedWorkspaceLayout {
  readonly target: WorkspaceTarget
  readonly ownerKey: string | null
  readonly snapshot: Readonly<WorkspaceLayoutSnapshot>
}

function captureLayout(state: WorkspaceLayoutSnapshot): CapturedWorkspaceLayout {
  const target = captureActiveWorkspaceTarget()
  return Object.freeze({
    target: Object.freeze({ ...target, ref: Object.freeze({ ...target.ref }) }),
    ownerKey: getWorkspaceStateOwnerKey(),
    snapshot: Object.freeze(normalizeWorkspaceLayout(state)),
  })
}

/** 唯一生产捕获入口：target 与当前 UI 在同一个同步调用栈形成。 */
export function captureWorkspaceLayout(): CapturedWorkspaceLayout {
  return captureLayout(useUIStore.getState())
}

/** 异步写入只消费捕获对象；不再读取当前工作空间或 UI。 */
export async function persistCapturedWorkspaceLayout(
  captured: CapturedWorkspaceLayout,
): Promise<void> {
  try {
    if (isWorkspaceStateRestoring()) throw new Error('布局恢复期间不能写入')
    if (typeof window === 'undefined' || !window.cclinkStudio?.workspaceState?.setSection) {
      throw new Error('布局持久化不可用')
    }
    await persistWorkspaceSectionNow(
      'layout',
      captured.snapshot,
      workspaceRefKey(captured.target.ref),
      captured.ownerKey,
    )
  } catch (error) {
    recordRendererDiagnosticLog('warn', [
      '[WorkspaceLayout] persistence-failed',
      {
        workspaceKind: captured.target.ref.kind,
        generation: captured.target.generation,
        ownerScoped: captured.ownerKey !== null,
        code: error instanceof WorkspaceStatePersistenceError ? error.code : 'layout_write_failed',
      },
    ])
    throw error
  }
}

/** 在读取启动快照前捕获目标；迁移仅在整个 restore 成功且 guard 结束后完成。 */
export function createWorkspaceLayoutRestore(): {
  hydrate: (sections: Record<string, unknown>) => void
  complete: () => Promise<void>
} {
  const target = captureActiveWorkspaceTarget()
  const ownerKey = getWorkspaceStateOwnerKey()
  const isCurrent = (): boolean =>
    isWorkspaceTargetCurrent(target) && ownerKey === getWorkspaceStateOwnerKey()
  let legacyRaw: string | null = null
  let migrate: CapturedWorkspaceLayout | null = null
  let hydrated = false
  return {
    hydrate: (sections) => {
      if (!isCurrent()) return
      const hasLayout = Object.prototype.hasOwnProperty.call(sections, 'layout')
      let value = sections.layout
      try {
        legacyRaw =
          typeof localStorage === 'undefined' ? null : localStorage.getItem(UI_STORAGE_KEY)
        if (!hasLayout && legacyRaw) {
          const legacy: unknown = JSON.parse(legacyRaw)
          if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
            value = legacy
            migrate = Object.freeze({
              target,
              ownerKey,
              snapshot: Object.freeze(normalizeWorkspaceLayout(legacy)),
            })
          }
        }
      } catch {
        // 损坏的旧值不影响默认布局，也不删除兼容输入。
        legacyRaw = null
      }
      useUIStore.getState().hydrateFromWorkspaceState(value)
      hydrated = hasLayout || migrate !== null
    },
    complete: async () => {
      if (!hydrated || !legacyRaw || !isCurrent()) return
      if (migrate) await persistCapturedWorkspaceLayout(migrate)
      try {
        if (localStorage.getItem(UI_STORAGE_KEY) === legacyRaw)
          localStorage.removeItem(UI_STORAGE_KEY)
      } catch {
        // 删除失败可在下次启动重试；WorkspaceState 永远优先。
      }
    },
  }
}

export const useUIStore = create<UIState>((set) => ({
  ...UI_DEFAULTS,

  setActivePanel: (panel) =>
    set((state) => {
      const nextPanel = normalizeActivityPanel(panel)
      return {
        activePanel: nextPanel,
        // 点击已激活的面板 → 折叠侧栏；点击其他面板 → 展开侧栏
        sidebarVisible: state.activePanel === nextPanel ? !state.sidebarVisible : true,
      }
    }),

  showPanel: (panel) =>
    set({
      activePanel: normalizeActivityPanel(panel),
      sidebarVisible: true,
    }),

  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  hideSidebar: () => set({ sidebarVisible: false }),
  toggleAgentPanel: (preferredMode = 'right') =>
    set((state) => {
      const wasVisible = state.agentPanelMode !== 'hidden'
      const previousVisibleMode: VisibleAgentPanelMode | null = wasVisible
        ? (state.agentPanelMode as VisibleAgentPanelMode)
        : state.agentPanelLastVisibleMode
      const nextMode: AgentPanelMode = wasVisible ? 'hidden' : preferredMode
      return {
        agentPanelMode: nextMode,
        agentPanelLastVisibleMode: nextMode === 'hidden' ? previousVisibleMode : nextMode,
        agentPanelVisible: agentVisibleFromMode(nextMode),
        agentPanelModeSource: 'user',
      }
    }),
  setAgentPanelMode: (mode, source = 'user') =>
    set((state) => ({
      agentPanelMode: mode,
      agentPanelLastVisibleMode: mode === 'hidden' ? state.agentPanelLastVisibleMode : mode,
      agentPanelVisible: agentVisibleFromMode(mode),
      agentPanelModeSource: source,
    })),
  applySystemWorkContext: (context) =>
    set((state) => {
      const nextMode: AgentPanelMode = context === 'empty' ? 'center' : 'right'
      if (context === 'empty') {
        // 用户操作优先于自动落地页，避免项目切换的短暂空 Tab 覆盖顶栏按钮结果。
        if (state.agentPanelModeSource === 'user') return state
        return {
          agentPanelMode: 'center',
          agentPanelLastVisibleMode: 'center',
          agentPanelVisible: true,
          agentPanelModeSource: 'system',
        }
      }
      if (state.agentPanelModeSource === 'user') return state
      if (
        state.agentPanelMode === nextMode &&
        state.agentPanelVisible === agentVisibleFromMode(nextMode) &&
        state.agentPanelModeSource === 'system'
      )
        return state
      return {
        agentPanelMode: nextMode,
        agentPanelLastVisibleMode: nextMode,
        agentPanelVisible: agentVisibleFromMode(nextMode),
        agentPanelModeSource: 'system',
      }
    }),
  resetAgentLayout: () =>
    set({
      agentPanelMode: UI_DEFAULTS.agentPanelMode,
      agentPanelLastVisibleMode: UI_DEFAULTS.agentPanelLastVisibleMode,
      agentPanelVisible: agentVisibleFromMode(UI_DEFAULTS.agentPanelMode),
      agentPanelModeSource: 'system',
      agentPanelWidth: UI_DEFAULTS.agentPanelWidth,
    }),
  setSidebarWidth: (width) =>
    set({
      sidebarWidth: normalizeWidth(
        width,
        MIN_SIDEBAR_WIDTH,
        MAX_SIDEBAR_WIDTH,
        UI_DEFAULTS.sidebarWidth,
      ),
    }),
  setAgentPanelWidth: (width) =>
    set({
      agentPanelWidth: normalizeWidth(
        width,
        MIN_AGENT_PANEL_WIDTH,
        MAX_AGENT_PANEL_WIDTH,
        UI_DEFAULTS.agentPanelWidth,
      ),
      agentPanelModeSource: 'user',
    }),
  hydrateFromWorkspaceState: (value) => {
    set(normalizeWorkspaceLayout(value))
  },
}))

useUIStore.subscribe((state) => {
  if (
    isWorkspaceStateRestoring() ||
    typeof window === 'undefined' ||
    !window.cclinkStudio?.workspaceState?.setSection
  )
    return
  void persistCapturedWorkspaceLayout(captureLayout(state)).catch(() => {})
})
