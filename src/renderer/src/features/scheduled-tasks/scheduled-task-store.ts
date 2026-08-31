import { create } from 'zustand'
import type {
  SaveScheduledTaskInput,
  ScheduledTaskFailure,
  ScheduledTaskDefinitionIssue,
  ScheduledTaskSnapshot,
  ScheduledTaskRun,
} from '@shared/scheduled-task/scheduled-task-types'

interface ScheduledTaskProjection {
  tasksByWorkspace: Record<string, ScheduledTaskSnapshot[]>
  loadingByWorkspace: Record<string, boolean>
  errorByWorkspace: Record<string, ScheduledTaskFailure | null>
  issuesByWorkspace: Record<string, ScheduledTaskDefinitionIssue[]>
  runsByTask: Record<string, ScheduledTaskRun[]>
  load(workspacePath: string): Promise<void>
  save(input: SaveScheduledTaskInput): Promise<ScheduledTaskSnapshot>
  delete(workspacePath: string, taskId: string, expectedRevision: number): Promise<void>
  setEnabled(
    workspacePath: string,
    taskId: string,
    enabled: boolean,
  ): Promise<ScheduledTaskSnapshot>
  loadRuns(workspacePath: string, taskId: string): Promise<void>
  runNow(workspacePath: string, taskId: string): Promise<ScheduledTaskRun>
  cancelRun(workspacePath: string, runId: string): Promise<ScheduledTaskRun>
}

export const useScheduledTaskStore = create<ScheduledTaskProjection>((set) => ({
  tasksByWorkspace: {},
  loadingByWorkspace: {},
  errorByWorkspace: {},
  issuesByWorkspace: {},
  runsByTask: {},

  load: async (workspacePath) => {
    set((state) => ({
      loadingByWorkspace: { ...state.loadingByWorkspace, [workspacePath]: true },
      errorByWorkspace: { ...state.errorByWorkspace, [workspacePath]: null },
    }))
    const result = await window.cclinkStudio.scheduledTasks.list(workspacePath)
    set((state) => ({
      tasksByWorkspace: result.success
        ? { ...state.tasksByWorkspace, [workspacePath]: result.tasks }
        : state.tasksByWorkspace,
      loadingByWorkspace: { ...state.loadingByWorkspace, [workspacePath]: false },
      errorByWorkspace: {
        ...state.errorByWorkspace,
        [workspacePath]: result.error ?? null,
      },
      issuesByWorkspace: result.success
        ? { ...state.issuesByWorkspace, [workspacePath]: result.issues ?? [] }
        : state.issuesByWorkspace,
    }))
  },

  save: async (input) => {
    const result = await window.cclinkStudio.scheduledTasks.save(input)
    if (!result.success || !result.task) {
      if (result.error) {
        set((state) => ({
          errorByWorkspace: {
            ...state.errorByWorkspace,
            [input.workspacePath]: result.error ?? null,
          },
        }))
      }
      throw new Error(result.error?.message ?? '定时任务保存失败')
    }
    set((state) => ({
      tasksByWorkspace: {
        ...state.tasksByWorkspace,
        [input.workspacePath]: upsertTask(
          state.tasksByWorkspace[input.workspacePath] ?? [],
          result.task!,
        ),
      },
      errorByWorkspace: { ...state.errorByWorkspace, [input.workspacePath]: null },
    }))
    return result.task
  },

  delete: async (workspacePath, taskId, expectedRevision) => {
    const result = await window.cclinkStudio.scheduledTasks.delete({
      workspacePath,
      taskId,
      expectedRevision,
    })
    if (!result.success) throw new Error(result.error?.message ?? '定时任务删除失败')
    set((state) => ({
      tasksByWorkspace: {
        ...state.tasksByWorkspace,
        [workspacePath]: (state.tasksByWorkspace[workspacePath] ?? []).filter(
          (task) => task.definition.id !== taskId,
        ),
      },
    }))
  },

  setEnabled: async (workspacePath, taskId, enabled) => {
    const result = await window.cclinkStudio.scheduledTasks.setEnabled({
      workspacePath,
      taskId,
      enabled,
    })
    if (!result.success || !result.task) {
      throw new Error(result.error?.message ?? '定时任务状态更新失败')
    }
    set((state) => ({
      tasksByWorkspace: {
        ...state.tasksByWorkspace,
        [workspacePath]: upsertTask(state.tasksByWorkspace[workspacePath] ?? [], result.task!),
      },
      errorByWorkspace: { ...state.errorByWorkspace, [workspacePath]: null },
    }))
    return result.task
  },

  loadRuns: async (workspacePath, taskId) => {
    const result = await window.cclinkStudio.scheduledTasks.listRuns(workspacePath, taskId)
    if (!result.success) throw new Error(result.error?.message ?? '运行历史读取失败')
    set((state) => ({
      runsByTask: { ...state.runsByTask, [runKey(workspacePath, taskId)]: result.runs },
    }))
  },

  runNow: async (workspacePath, taskId) => {
    const result = await window.cclinkStudio.scheduledTasks.runNow({ workspacePath, taskId })
    if (!result.success || !result.run) {
      throw new Error(result.error?.message ?? '定时任务启动失败')
    }
    set((state) => ({
      runsByTask: {
        ...state.runsByTask,
        [runKey(workspacePath, taskId)]: upsertRun(
          state.runsByTask[runKey(workspacePath, taskId)] ?? [],
          result.run!,
        ),
      },
    }))
    return result.run
  },

  cancelRun: async (workspacePath, runId) => {
    const result = await window.cclinkStudio.scheduledTasks.cancelRun({ workspacePath, runId })
    if (!result.success || !result.run) {
      throw new Error(result.error?.message ?? '取消运行失败')
    }
    return result.run
  },
}))

function upsertTask(
  tasks: ScheduledTaskSnapshot[],
  next: ScheduledTaskSnapshot,
): ScheduledTaskSnapshot[] {
  const index = tasks.findIndex((task) => task.definition.id === next.definition.id)
  if (index === -1) return [next, ...tasks]
  return tasks.map((task, taskIndex) => (taskIndex === index ? next : task))
}

export function scheduledTaskRunKey(workspacePath: string, taskId: string): string {
  return runKey(workspacePath, taskId)
}

function runKey(workspacePath: string, taskId: string): string {
  return `${workspacePath}\0${taskId}`
}

function upsertRun(runs: ScheduledTaskRun[], next: ScheduledTaskRun): ScheduledTaskRun[] {
  const filtered = runs.filter((run) => run.id !== next.id)
  return [next, ...filtered].sort((left, right) => right.createdAt - left.createdAt)
}
