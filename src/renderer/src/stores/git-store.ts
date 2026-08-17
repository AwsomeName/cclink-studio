import { create } from 'zustand'
import type {
  GitChangeArea,
  GitDiffRequest,
  GitDiffResult,
  GitOperationResult,
  GitRepositorySnapshot,
} from '@shared/git'

interface GitState {
  workspacePath: string | null
  snapshot: GitRepositorySnapshot | null
  loading: boolean
  error: string | null
  selectedDiff: GitDiffRequest | null
  diff: GitDiffResult | null
  diffLoading: boolean
  operation: 'commit' | 'push' | null
  operationError: string | null
  operationDialogOpen: boolean
  operationDialogTab: 'changes' | 'commit'
  operationDialogWorkspacePath: string | null
  operationDialogBaselineRevision: string | null
  commitMessage: string
  selectedCommitPaths: string[]
  operationNotice: GitOperationNotice | null
  loadWorkspace: (workspacePath: string | null) => Promise<void>
  refresh: () => Promise<void>
  loadDiff: (path: string, area: GitChangeArea) => Promise<void>
  clearDiff: () => void
  openOperationDialog: (tab: 'changes' | 'commit') => void
  closeOperationDialog: () => void
  setOperationDialogTab: (tab: 'changes' | 'commit') => void
  setCommitMessage: (message: string) => void
  toggleCommitPath: (path: string) => void
  setCommitPaths: (paths: string[]) => void
  clearCommitDraft: () => void
  acceptLatestDialogSnapshot: () => void
  setOperationNotice: (notice: GitOperationNotice | null) => void
  commit: (message: string, pathsToStage: string[]) => Promise<GitOperationResult | null>
  push: () => Promise<GitOperationResult | null>
}

export interface GitOperationNotice {
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

let loadGeneration = 0
let diffGeneration = 0

export const useGitStore = create<GitState>((set, get) => ({
  workspacePath: null,
  snapshot: null,
  loading: false,
  error: null,
  selectedDiff: null,
  diff: null,
  diffLoading: false,
  operation: null,
  operationError: null,
  operationDialogOpen: false,
  operationDialogTab: 'changes',
  operationDialogWorkspacePath: null,
  operationDialogBaselineRevision: null,
  commitMessage: '',
  selectedCommitPaths: [],
  operationNotice: null,

  loadWorkspace: async (workspacePath) => {
    const generation = ++loadGeneration
    if (!workspacePath) {
      diffGeneration += 1
      set({
        workspacePath: null,
        snapshot: null,
        loading: false,
        error: null,
        selectedDiff: null,
        diff: null,
        diffLoading: false,
        operation: null,
        operationError: null,
        ...emptyOperationDialogState(),
      })
      return
    }
    const changed = get().workspacePath !== workspacePath
    set({
      workspacePath,
      loading: true,
      error: null,
      ...(changed ? { snapshot: null } : {}),
      ...(changed ? { selectedDiff: null, diff: null, diffLoading: false } : {}),
      ...(changed ? { operation: null, operationError: null } : {}),
      ...(changed ? emptyOperationDialogState() : {}),
    })
    await loadSnapshot(workspacePath, generation, set, get)
  },

  refresh: async () => {
    const workspacePath = get().workspacePath
    if (!workspacePath) return
    const generation = ++loadGeneration
    diffGeneration += 1
    set({ loading: true, error: null, selectedDiff: null, diff: null, diffLoading: false })
    await loadSnapshot(workspacePath, generation, set, get)
  },

  loadDiff: async (path, area) => {
    const workspacePath = get().workspacePath
    if (!workspacePath) return
    const generation = ++diffGeneration
    const input: GitDiffRequest = { workspacePath, path, area }
    set({ selectedDiff: input, diff: null, diffLoading: true })
    try {
      const diff = await window.cclinkStudio.git.getDiff(input)
      if (
        generation !== diffGeneration ||
        get().workspacePath !== workspacePath ||
        get().selectedDiff?.path !== path ||
        get().selectedDiff?.area !== area
      ) {
        return
      }
      set({ diff, diffLoading: false })
    } catch (error: unknown) {
      if (generation !== diffGeneration || get().workspacePath !== workspacePath) return
      set({
        diffLoading: false,
        diff: {
          ...input,
          content: '',
          truncated: false,
          binary: false,
          error: error instanceof Error ? error.message : 'Git Diff 读取失败',
        },
      })
    }
  },

  clearDiff: () => {
    diffGeneration += 1
    set({ selectedDiff: null, diff: null, diffLoading: false })
  },

  openOperationDialog: (tab) => {
    const { workspacePath, snapshot } = get()
    if (!workspacePath || !snapshot || snapshot.availability !== 'available') return
    set({
      operationDialogOpen: true,
      operationDialogTab: tab,
      operationDialogWorkspacePath: workspacePath,
      operationDialogBaselineRevision: snapshot.revision,
      operationNotice: null,
    })
  },

  closeOperationDialog: () => {
    diffGeneration += 1
    set({
      ...emptyOperationDialogState(),
      selectedDiff: null,
      diff: null,
      diffLoading: false,
    })
  },

  setOperationDialogTab: (tab) => set({ operationDialogTab: tab }),
  setCommitMessage: (commitMessage) => set({ commitMessage }),
  toggleCommitPath: (path) =>
    set((state) => ({
      selectedCommitPaths: state.selectedCommitPaths.includes(path)
        ? state.selectedCommitPaths.filter((selectedPath) => selectedPath !== path)
        : [...state.selectedCommitPaths, path],
    })),
  setCommitPaths: (paths) => set({ selectedCommitPaths: [...new Set(paths)] }),
  clearCommitDraft: () => set({ commitMessage: '', selectedCommitPaths: [] }),
  acceptLatestDialogSnapshot: () => {
    const { snapshot, selectedCommitPaths } = get()
    if (!snapshot || snapshot.availability !== 'available') return
    const stageablePaths = new Set(
      snapshot.changes
        .filter((change) => !change.conflicted && (change.unstagedStatus || change.untracked))
        .map((change) => change.path),
    )
    set({
      operationDialogBaselineRevision: snapshot.revision,
      selectedCommitPaths: selectedCommitPaths.filter((path) => stageablePaths.has(path)),
      operationNotice: null,
    })
  },
  setOperationNotice: (operationNotice) => set({ operationNotice }),

  commit: async (message, pathsToStage) => {
    const { workspacePath, snapshot, operation } = get()
    if (!workspacePath || !snapshot || snapshot.availability !== 'available' || operation) {
      return null
    }
    set({ operation: 'commit', operationError: null })
    try {
      const result = await window.cclinkStudio.git.commit({
        workspacePath,
        expectedRevision: snapshot.revision,
        message,
        pathsToStage,
      })
      if (get().workspacePath !== workspacePath) return result
      loadGeneration += 1
      diffGeneration += 1
      set({
        snapshot: result.snapshot,
        operation: null,
        operationError: result.success ? null : result.message,
        selectedDiff: null,
        diff: null,
        diffLoading: false,
      })
      return result
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Git 提交失败'
      if (get().workspacePath === workspacePath) set({ operation: null, operationError: message })
      return null
    }
  },

  push: async () => {
    const { workspacePath, snapshot, operation } = get()
    if (
      !workspacePath ||
      !snapshot ||
      snapshot.availability !== 'available' ||
      !snapshot.headOid ||
      operation
    ) {
      return null
    }
    set({ operation: 'push', operationError: null })
    try {
      const result = await window.cclinkStudio.git.push({
        workspacePath,
        expectedHeadOid: snapshot.headOid,
      })
      if (get().workspacePath !== workspacePath) return result
      loadGeneration += 1
      set({
        snapshot: result.snapshot,
        operation: null,
        operationError: result.success ? null : result.message,
      })
      return result
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Git Push 失败'
      if (get().workspacePath === workspacePath) set({ operation: null, operationError: message })
      return null
    }
  },
}))

function emptyOperationDialogState(): Pick<
  GitState,
  | 'operationDialogOpen'
  | 'operationDialogTab'
  | 'operationDialogWorkspacePath'
  | 'operationDialogBaselineRevision'
  | 'commitMessage'
  | 'selectedCommitPaths'
  | 'operationNotice'
> {
  return {
    operationDialogOpen: false,
    operationDialogTab: 'changes',
    operationDialogWorkspacePath: null,
    operationDialogBaselineRevision: null,
    commitMessage: '',
    selectedCommitPaths: [],
    operationNotice: null,
  }
}

async function loadSnapshot(
  workspacePath: string,
  generation: number,
  set: (partial: Partial<GitState>) => void,
  get: () => GitState,
): Promise<void> {
  try {
    const snapshot = await window.cclinkStudio.git.getSnapshot(workspacePath)
    if (generation !== loadGeneration || get().workspacePath !== workspacePath) return
    set({ snapshot, loading: false, error: null })
  } catch (error: unknown) {
    if (generation !== loadGeneration || get().workspacePath !== workspacePath) return
    set({
      loading: false,
      error: error instanceof Error ? error.message : 'Git 状态读取失败',
    })
  }
}
