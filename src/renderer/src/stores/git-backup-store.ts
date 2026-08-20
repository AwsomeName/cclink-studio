import { create } from 'zustand'
import type {
  GitBackupAccountStatus,
  GitBackupProjectStatus,
  GitBackupRunResult,
} from '@shared/ipc/git-backup'

interface GitBackupState {
  workspacePath: string | null
  accountStatus: GitBackupAccountStatus | null
  projectStatus: GitBackupProjectStatus | null
  loading: boolean
  busy: boolean
  error: string | null
  dialogOpen: boolean
  repositoryInput: string
  loadWorkspace: (workspacePath: string | null) => Promise<void>
  requestBackup: (workspacePath: string) => Promise<GitBackupRunResult | null>
  submitFirstBackup: () => Promise<GitBackupRunResult | null>
  setRepositoryInput: (value: string) => void
  closeDialog: () => void
}

let loadGeneration = 0

export const useGitBackupStore = create<GitBackupState>((set, get) => ({
  workspacePath: null,
  accountStatus: null,
  projectStatus: null,
  loading: false,
  busy: false,
  error: null,
  dialogOpen: false,
  repositoryInput: '',

  loadWorkspace: async (workspacePath) => {
    const generation = ++loadGeneration
    if (!workspacePath) {
      set({
        workspacePath: null,
        accountStatus: null,
        projectStatus: null,
        loading: false,
        busy: false,
        error: null,
        dialogOpen: false,
        repositoryInput: '',
      })
      return
    }

    const changed = get().workspacePath !== workspacePath
    set({
      workspacePath,
      loading: true,
      ...(changed
        ? {
            accountStatus: null,
            projectStatus: null,
            busy: false,
            error: null,
            dialogOpen: false,
            repositoryInput: '',
          }
        : {}),
    })
    try {
      const [accountStatus, projectStatus] = await Promise.all([
        window.cclinkStudio.gitBackup.getAccountStatus(),
        window.cclinkStudio.gitBackup.getProjectStatus(workspacePath),
      ])
      if (generation !== loadGeneration || get().workspacePath !== workspacePath) return
      set({
        accountStatus,
        projectStatus,
        loading: false,
        error: projectStatus.error ?? accountStatus.error ?? null,
      })
    } catch (error: unknown) {
      if (generation !== loadGeneration || get().workspacePath !== workspacePath) return
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  requestBackup: async (workspacePath) => {
    if (get().workspacePath !== workspacePath || !get().projectStatus) {
      await get().loadWorkspace(workspacePath)
    }
    const state = get()
    if (state.workspacePath !== workspacePath || !state.projectStatus) return null
    if (state.projectStatus.error) {
      set({ error: state.projectStatus.error })
      return null
    }
    if (!state.projectStatus.bound) {
      set({ dialogOpen: true, error: null })
      return null
    }
    return performBackup(set, get)
  },

  submitFirstBackup: async () => {
    const repositoryInput = get().repositoryInput.trim()
    if (!repositoryInput) {
      set({ error: '请输入远程仓库地址或 GitHub 项目名' })
      return null
    }
    return performBackup(set, get, repositoryInput)
  },

  setRepositoryInput: (repositoryInput) => set({ repositoryInput }),
  closeDialog: () => {
    set({ dialogOpen: false, repositoryInput: '', error: null })
  },
}))

async function performBackup(
  set: (partial: Partial<GitBackupState>) => void,
  get: () => GitBackupState,
  repositoryInput?: string,
): Promise<GitBackupRunResult | null> {
  const workspacePath = get().workspacePath
  if (!workspacePath || get().busy) return null
  set({ busy: true, error: null })
  try {
    const result = await window.cclinkStudio.gitBackup.backup({
      workspacePath,
      repositoryInput,
    })
    if (get().workspacePath !== workspacePath) return result
    if (!result.success) {
      set({ error: result.message })
      return result
    }
    const projectStatus = await window.cclinkStudio.gitBackup.getProjectStatus(workspacePath)
    if (get().workspacePath === workspacePath) {
      set({
        projectStatus,
        dialogOpen: false,
        repositoryInput: '',
        error: projectStatus.error ?? null,
      })
    }
    return result
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (get().workspacePath === workspacePath) set({ error: message })
    return { success: false, status: 'failed', message, errorCode: 'UNKNOWN' }
  } finally {
    if (get().workspacePath === workspacePath) set({ busy: false })
  }
}
