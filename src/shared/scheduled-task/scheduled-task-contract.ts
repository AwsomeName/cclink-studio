import { bindIpcParser, defineIpcCall, ipcArgs } from '../ipc/contract'
import {
  parseSaveScheduledTaskInput,
  parseScheduledTaskId,
  parseSetScheduledTaskEnabledInput,
  parseWorkspacePath,
  parseRunScheduledTaskInput,
  parseCancelScheduledTaskRunInput,
} from './scheduled-task-schema'
import type {
  SaveScheduledTaskInput,
  ScheduledTaskListResult,
  ScheduledTaskOperationResult,
  ScheduledTasksApiContract,
  SetScheduledTaskEnabledInput,
  RunScheduledTaskInput,
  CancelScheduledTaskRunInput,
  ScheduledTaskRunResult,
  ScheduledTaskRunListResult,
  ScheduledTaskRuntimeStatus,
} from './scheduled-task-types'

export const scheduledTasksIpc = {
  list: defineIpcCall<[string], ScheduledTaskListResult>('scheduledTasks:list'),
  get: defineIpcCall<[string, string], ScheduledTaskOperationResult>('scheduledTasks:get'),
  save: defineIpcCall<[SaveScheduledTaskInput], ScheduledTaskOperationResult>(
    'scheduledTasks:save',
  ),
  setEnabled: defineIpcCall<[SetScheduledTaskEnabledInput], ScheduledTaskOperationResult>(
    'scheduledTasks:setEnabled',
  ),
  runNow: defineIpcCall<[RunScheduledTaskInput], ScheduledTaskRunResult>('scheduledTasks:runNow'),
  cancelRun: defineIpcCall<[CancelScheduledTaskRunInput], ScheduledTaskRunResult>(
    'scheduledTasks:cancelRun',
  ),
  listRuns: defineIpcCall<[string, string], ScheduledTaskRunListResult>('scheduledTasks:listRuns'),
  getRuntimeStatus: defineIpcCall<[], ScheduledTaskRuntimeStatus>(
    'scheduledTasks:getRuntimeStatus',
  ),
} as const

export const scheduledTasksIpcEvents = {
  changed: 'scheduledTasks:changed',
} as const

const invalidOperation = async (error: unknown): Promise<ScheduledTaskOperationResult> => ({
  success: false,
  error: {
    code: 'SCHEDULED_TASK_INVALID',
    message: error instanceof Error ? error.message : '定时任务参数无效',
    recovery: '检查任务名称、内容、时间和工作空间后重试',
  },
})

const invalidList = async (): Promise<ScheduledTaskListResult> => ({
  success: false,
  tasks: [],
  error: {
    code: 'SCHEDULED_TASK_INVALID',
    message: '工作空间参数无效',
    recovery: '重新打开本地工作空间后重试',
  },
})

const invalidRun = async (): Promise<ScheduledTaskRunResult> => ({
  success: false,
  error: {
    code: 'SCHEDULED_TASK_INVALID',
    message: '定时任务运行参数无效',
    recovery: '刷新任务后重试',
  },
})

const invalidRunList = async (): Promise<ScheduledTaskRunListResult> => ({
  success: false,
  runs: [],
  error: {
    code: 'SCHEDULED_TASK_INVALID',
    message: '运行历史参数无效',
    recovery: '刷新任务后重试',
  },
})

const invalidRuntimeStatus = async (): Promise<ScheduledTaskRuntimeStatus> => ({
  state: 'degraded',
  startedAt: null,
  timerDueAt: null,
  queuedCount: 0,
  runningRunId: null,
  enabledCount: 0,
  systemScheduler: 'none',
  lastError: {
    code: 'SCHEDULED_TASK_INVALID',
    message: '无法读取调度状态',
  },
})

export const scheduledTasksIpcContracts = {
  list: bindIpcParser(
    scheduledTasksIpc.list,
    (args) => {
      requireArgs(args, 1, scheduledTasksIpc.list.channel)
      return ipcArgs(parseWorkspacePath(args[0]))
    },
    invalidList,
  ),
  get: bindIpcParser(
    scheduledTasksIpc.get,
    (args) => {
      requireArgs(args, 2, scheduledTasksIpc.get.channel)
      return ipcArgs(parseWorkspacePath(args[0]), parseScheduledTaskId(args[1]))
    },
    invalidOperation,
  ),
  save: bindIpcParser(
    scheduledTasksIpc.save,
    (args) => {
      requireArgs(args, 1, scheduledTasksIpc.save.channel)
      return ipcArgs(parseSaveScheduledTaskInput(args[0]))
    },
    invalidOperation,
  ),
  setEnabled: bindIpcParser(
    scheduledTasksIpc.setEnabled,
    (args) => {
      requireArgs(args, 1, scheduledTasksIpc.setEnabled.channel)
      return ipcArgs(parseSetScheduledTaskEnabledInput(args[0]))
    },
    invalidOperation,
  ),
  runNow: bindIpcParser(
    scheduledTasksIpc.runNow,
    (args) => {
      requireArgs(args, 1, scheduledTasksIpc.runNow.channel)
      return ipcArgs(parseRunScheduledTaskInput(args[0]))
    },
    invalidRun,
  ),
  cancelRun: bindIpcParser(
    scheduledTasksIpc.cancelRun,
    (args) => {
      requireArgs(args, 1, scheduledTasksIpc.cancelRun.channel)
      return ipcArgs(parseCancelScheduledTaskRunInput(args[0]))
    },
    invalidRun,
  ),
  listRuns: bindIpcParser(
    scheduledTasksIpc.listRuns,
    (args) => {
      requireArgs(args, 2, scheduledTasksIpc.listRuns.channel)
      return ipcArgs(parseWorkspacePath(args[0]), parseScheduledTaskId(args[1]))
    },
    invalidRunList,
  ),
  getRuntimeStatus: bindIpcParser(
    scheduledTasksIpc.getRuntimeStatus,
    (args) => {
      requireArgs(args, 0, scheduledTasksIpc.getRuntimeStatus.channel)
      return ipcArgs()
    },
    invalidRuntimeStatus,
  ),
} as const

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

export type { ScheduledTasksApiContract }
