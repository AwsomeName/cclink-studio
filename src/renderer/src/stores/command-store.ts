import { create } from 'zustand'
import { workspaceRefKey } from '@shared/workspace-ref'
import {
  targetMatchesWorkspace,
  type CommandContext,
} from '../features/context-actions/context-target'
import {
  classifyContextActionCommandFailure,
  useContextActionDiagnosticsStore,
} from '../features/context-actions/context-action-diagnostics'
import { useWorkspaceStore } from './workspace-store'

export type CommandRisk =
  | 'read'
  | 'local-write'
  | 'destructive'
  | 'external-side-effect'
  | 'credential'

export type CommandAvailability = boolean | { enabled: boolean; reason?: string }

/** 命令定义 */
export interface Command {
  id: string
  label: string
  /** 快捷键（显示用） */
  shortcut?: string
  /** 执行函数 */
  action: (context?: CommandContext) => unknown | Promise<unknown>
  /** 分组 */
  category?: string
  /** 只在结构化目标存在时显示，不进入全局命令面板。 */
  contextOnly?: boolean
  /** 根据执行目标生成名称，例如“关闭 Terminal”。 */
  contextLabel?: (context: CommandContext) => string
  visible?: (context: CommandContext) => boolean
  enabled?: (context: CommandContext) => CommandAvailability
  checked?: (context: CommandContext) => boolean
  risk?: CommandRisk
}

export interface CommandExecutionResult {
  ok: boolean
  reason?: 'missing-command' | 'hidden' | 'disabled' | 'stale-target' | 'failed'
  message?: string
}

interface CommandState {
  /** 所有已注册的命令 */
  commands: Command[]
  /** Command Palette 是否打开 */
  paletteOpen: boolean
  /** 当前搜索关键词 */
  query: string
  /** 最近执行命令 ID（最近在前） */
  recentCommandIds: string[]

  // --- Actions ---
  /** 注册命令 */
  registerCommand: (command: Command) => void
  /** 批量注册命令 */
  registerCommands: (commands: Command[]) => void
  /** 注销命令 */
  unregisterCommand: (id: string) => void
  /** 打开/关闭 Palette */
  togglePalette: () => void
  /** 关闭 Palette */
  closePalette: () => void
  /** 设置搜索词 */
  setQuery: (query: string) => void
  /** 标记命令已执行 */
  markCommandUsed: (id: string) => void
  /** 获取过滤后的命令 */
  getFilteredCommands: () => Command[]
  executeCommand: (id: string, context: CommandContext) => Promise<CommandExecutionResult>
}

const COMMAND_STORAGE_KEY = 'cclink-studio-command-state'

function loadRecentCommandIds(): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(COMMAND_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { recentCommandIds?: string[] }
    return Array.isArray(parsed.recentCommandIds) ? parsed.recentCommandIds.filter(Boolean) : []
  } catch {
    return []
  }
}

function saveRecentCommandIds(ids: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      COMMAND_STORAGE_KEY,
      JSON.stringify({ recentCommandIds: ids.slice(0, 12) }),
    )
  } catch {
    // localStorage 可能不可用，忽略持久化失败。
  }
}

export const useCommandStore = create<CommandState>((set, get) => ({
  commands: [],
  paletteOpen: false,
  query: '',
  recentCommandIds: loadRecentCommandIds(),

  registerCommand: (command) =>
    set((state) => ({
      commands: [...state.commands.filter((c) => c.id !== command.id), command],
    })),

  registerCommands: (commands) =>
    set((state) => {
      const existingIds = new Set(commands.map((c) => c.id))
      const filtered = state.commands.filter((c) => !existingIds.has(c.id))
      return { commands: [...filtered, ...commands] }
    }),

  unregisterCommand: (id) =>
    set((state) => ({
      commands: state.commands.filter((c) => c.id !== id),
    })),

  togglePalette: () =>
    set((state) => ({
      paletteOpen: !state.paletteOpen,
      query: '',
    })),

  closePalette: () => set({ paletteOpen: false, query: '' }),

  setQuery: (query) => set({ query }),

  markCommandUsed: (id) =>
    set((state) => {
      const recentCommandIds = [id, ...state.recentCommandIds.filter((item) => item !== id)].slice(
        0,
        12,
      )
      saveRecentCommandIds(recentCommandIds)
      return { recentCommandIds }
    }),

  getFilteredCommands: () => {
    const { commands, query, recentCommandIds } = get()
    const paletteCommands = commands.filter((command) => !command.contextOnly)
    if (!query.trim()) {
      const recent = recentCommandIds
        .map((id) => paletteCommands.find((cmd) => cmd.id === id))
        .filter((cmd): cmd is Command => Boolean(cmd))
      const recentIds = new Set(recent.map((cmd) => cmd.id))
      return [...recent, ...paletteCommands.filter((cmd) => !recentIds.has(cmd.id))]
    }

    /** 简单模糊匹配：query 中的字符按顺序出现在 target 中即匹配 */
    const fuzzyMatch = (query: string, target: string): boolean => {
      let qi = 0
      for (let ti = 0; ti < target.length && qi < query.length; ti++) {
        if (target[ti] === query[qi]) qi++
      }
      return qi === query.length
    }

    const q = query.toLowerCase().trim()
    return paletteCommands.filter((c) => {
      const label = c.label.toLowerCase()
      const id = c.id.toLowerCase()
      const category = (c.category || '').toLowerCase()
      // 模糊匹配 OR 子串匹配（保证常用场景能命中）
      return (
        fuzzyMatch(q, label) ||
        fuzzyMatch(q, id) ||
        fuzzyMatch(q, category) ||
        label.includes(q) ||
        id.includes(q)
      )
    })
  },

  executeCommand: async (id, context) => {
    const fail = (result: CommandExecutionResult): CommandExecutionResult => {
      if (context.source !== 'context-menu') return result
      const kind = classifyContextActionCommandFailure(result)
      if (kind) {
        useContextActionDiagnosticsStore.getState().record({
          kind,
          commandId: id,
          targetKind: context.target?.kind,
          message: result.message || result.reason || '上下文命令执行失败',
        })
      }
      return result
    }
    const command = get().commands.find((item) => item.id === id)
    if (!command) return fail({ ok: false, reason: 'missing-command', message: '命令不存在' })
    const activeWorkspaceKey = workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef)
    if (context.target && !targetMatchesWorkspace(context.target, activeWorkspaceKey)) {
      return fail({ ok: false, reason: 'stale-target', message: '操作目标所属项目已切换' })
    }
    if (command.visible && !command.visible(context)) {
      return fail({ ok: false, reason: 'hidden', message: '命令对当前目标不可用' })
    }
    const availability = command.enabled?.(context) ?? true
    const enabled = typeof availability === 'boolean' ? availability : availability.enabled
    if (!enabled) {
      return fail({
        ok: false,
        reason: 'disabled',
        message: typeof availability === 'boolean' ? undefined : availability.reason,
      })
    }
    try {
      await command.action(context)
      get().markCommandUsed(id)
      return { ok: true }
    } catch (error) {
      return fail({
        ok: false,
        reason: 'failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  },
}))
