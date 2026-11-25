import { useEffect } from 'react'
import { create } from 'zustand'
import {
  PROJECT_SYNC_SECTION,
  type GitTransferInput,
  type GitTransferSnapshot,
  type ProjectSyncPreview,
} from '@shared/git'
import { useTabStore } from '../../stores/tab-store'
import { useFsStore } from '../../stores/fs-store'

/** Renderer view of project sync (ADR 0026). The main process owns the state; this mirrors it. */
export interface ProjectSyncState {
  loaded: boolean
  busy?: boolean
  error?: string
  errorCode?: string
  snapshot?: GitTransferSnapshot | null
  pending?: boolean
  preview?: ProjectSyncPreview
}

const empty: ProjectSyncState = { loaded: false }
const useStore = create<Record<string, ProjectSyncState>>(() => ({}))
const patch = (path: string, next: Partial<ProjectSyncState>) =>
  useStore.setState((all) => ({ [path]: { ...(all[path] ?? empty), ...next } }))

export function useProjectSync(path: string | null): ProjectSyncState {
  return useStore((all) => (path ? all[path] : undefined) ?? empty)
}

export function isProjectSyncPaused(state: ProjectSyncState): boolean {
  const s = state.snapshot
  return Boolean(
    state.error || s?.conflict || s?.conflictFiles?.length || s?.pendingDeletions?.length,
  )
}

export function projectSyncLabel(state: ProjectSyncState): string {
  if (state.busy) return '同步中…'
  if (!state.snapshot?.remoteUrl) return '未设置同步'
  if (isProjectSyncPaused(state)) return '同步暂停 · 查看原因'
  if (state.pending) return '有待同步的改动'
  return state.snapshot.checkedAt
    ? '已同步 · ' +
        new Date(state.snapshot.checkedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
    : '已设置同步'
}

/** Reads what this computer last recorded; never contacts GitHub. */
export async function loadProjectSync(path: string): Promise<void> {
  const saved = await window.cclinkStudio.workspaceState
    .get(path)
    .then((v) => v.sections[PROJECT_SYNC_SECTION] as GitTransferSnapshot | undefined | null)
    .catch(() => undefined)
  patch(path, { loaded: true, snapshot: saved?.remoteUrl ? saved : null })
}

export async function loadProjectSyncPreview(path: string): Promise<ProjectSyncPreview> {
  const preview = await window.cclinkStudio.git.previewProjectSync(path)
  patch(path, { preview })
  return preview
}

type RoundOptions = Pick<GitTransferInput, 'url' | 'feedback' | 'resolutions' | 'deletions'>

/** One round. Automatic rounds stay quiet while a decision is waiting for the user. */
export async function runProjectSync(
  path: string,
  manual = false,
  options: RoundOptions = {},
): Promise<boolean> {
  const old = useStore.getState()[path] ?? empty
  if (old.busy) return false
  const s = old.snapshot
  if (!manual && (s?.conflict || s?.conflictFiles?.length || s?.pendingDeletions?.length))
    return false
  if (!options.url && !s?.remoteUrl) return false
  patch(path, { busy: true, error: undefined, errorCode: undefined })
  try {
    if (useTabStore.getState().tabs.some((t) => t.dirty))
      throw Error('有正在编辑的内容，请保存后继续同步。')
    const result = await window.cclinkStudio.git.transfer({
      action: 'project-sync',
      workspacePath: path,
      ...options,
      expectedHead: s?.head || undefined,
      expectedTarget: s?.target || undefined,
    })
    if (!result.success) {
      const error = Object.assign(Error(result.error.message), { code: result.error.code })
      throw error
    }
    patch(path, { busy: false, snapshot: result.snapshot, pending: false })
    if (result.snapshot.received) void useFsStore.getState().refreshWorkspace?.()
    return true
  } catch (e) {
    await loadProjectSync(path)
    patch(path, {
      busy: false,
      error: e instanceof Error ? e.message : String(e),
      errorCode: (e as { code?: string }).code,
    })
    return false
  }
}

export async function stopProjectSync(path: string): Promise<void> {
  const result = await window.cclinkStudio.git.transfer({
    action: 'project-sync',
    workspacePath: path,
    stop: true,
  })
  if (!result.success) throw Error(result.error.message)
  patch(path, { snapshot: null, error: undefined, errorCode: undefined, pending: false })
}

/** A newly saved GitHub account lifts account-related pauses. */
export function resumeProjectSyncAfterAccountChange(): void {
  for (const [path, state] of Object.entries(useStore.getState()))
    if (
      state.error &&
      !state.busy &&
      ['AUTHENTICATION_FAILED', 'ACCOUNT_NOT_CONFIGURED'].includes(state.errorCode ?? '')
    )
      void runProjectSync(path, true)
}

/**
 * Same timing as My Space: sync when the project becomes active or the window returns to the
 * foreground, then on every hour while in front. Only the active project syncs.
 */
export function useProjectSyncSchedule(path: string | null): void {
  useEffect(() => {
    if (!path) return
    let timer: number | undefined
    let refreshTimer: number | undefined
    let active = false
    let disposed = false
    let received = false
    const api = window.cclinkStudio.window
    const cleanup: Array<() => void> = []
    const round = () => {
      if (useStore.getState()[path]?.snapshot?.remoteUrl) void runProjectSync(path)
    }
    function schedule() {
      const now = new Date()
      const next = new Date(now)
      next.setHours(now.getHours() + 1, 0, 0, 0)
      timer = window.setTimeout(async () => {
        if (disposed || !active) return
        if ((await api.isForeground()) && active && !disposed) {
          round()
          schedule()
        }
      }, next.getTime() - now.getTime())
    }
    function update(foreground: boolean) {
      if (disposed || active === foreground) return
      active = foreground
      window.clearTimeout(timer)
      if (active) {
        round()
        schedule()
      }
    }
    void loadProjectSync(path).then(() => {
      if (disposed) return
      const unsubscribe = api.onForegroundChanged((value) => {
        received = true
        update(value)
      })
      cleanup.push(unsubscribe)
      void api
        .isForeground()
        .then((value) => {
          if (!received) update(value)
        })
        .catch(() => {})
    })
    // Local edits only flip the “有待同步的改动” hint; nothing goes online until the next round.
    const unwatch = window.cclinkStudio.fs
      .watchDir(path, ({ filePath }) => {
        const relative = filePath.slice(path.length + 1)
        if (relative.startsWith('.git/') || relative.startsWith('.cclink-studio/state')) return
        window.clearTimeout(refreshTimer)
        refreshTimer = window.setTimeout(async () => {
          const state = useStore.getState()[path]
          if (disposed || !state?.snapshot?.remoteUrl || state.busy) return
          const git = await window.cclinkStudio.git.getSnapshot(path).catch(() => null)
          if (!git || git.availability !== 'available') return
          const pending = git.changeCount > 0
          if (!!state.pending !== pending) patch(path, { pending })
        }, 400)
      })
      .catch(() => () => {})
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.clearTimeout(refreshTimer)
      void unwatch.then((stop) => stop())
      for (const stop of cleanup) stop()
    }
  }, [path])
}

/** The sync dialog: one per window, opened from the home card or the status bar. */
export const useProjectSyncDialog = create<{ path: string | null; setup: boolean }>(() => ({
  path: null,
  setup: false,
}))
export function openProjectSyncDialog(path: string, setup = false): void {
  useProjectSyncDialog.setState({ path, setup })
}
