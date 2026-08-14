import { bindIpcParser, defineIpcCall, ipcArgs } from '../ipc/contract'
import { parseMediaProjectId, parseMediaWorkspacePath } from './media-project-schema'
import { parseCreateMediaRenderTaskInput } from './media-render-schema'
import type {
  CreateMediaRenderTaskInput,
  MediaRenderApiContract,
  MediaRenderRuntimeStatusResult,
  MediaRenderTaskListResult,
  MediaRenderTaskResult,
} from './media-render-types'

export const mediaRenderIpc = {
  getRuntimeStatus: defineIpcCall<[], MediaRenderRuntimeStatusResult>(
    'mediaRender:getRuntimeStatus',
  ),
  createTask: defineIpcCall<[CreateMediaRenderTaskInput], MediaRenderTaskResult>(
    'mediaRender:createTask',
  ),
  listTasks: defineIpcCall<[string, string], MediaRenderTaskListResult>('mediaRender:listTasks'),
  retryTask: defineIpcCall<[string, string], MediaRenderTaskResult>('mediaRender:retryTask'),
} as const

const invalidTask = async (error: unknown): Promise<MediaRenderTaskResult> => ({
  success: false,
  error: {
    code: 'MEDIA_PROJECT_INVALID',
    message: error instanceof Error ? error.message : '成片任务参数无效',
  },
})

const invalidList = async (error: unknown): Promise<MediaRenderTaskListResult> => ({
  success: false,
  tasks: [],
  error: {
    code: 'MEDIA_PROJECT_INVALID',
    message: error instanceof Error ? error.message : '成片任务列表参数无效',
  },
})

const invalidStatus = async (): Promise<MediaRenderRuntimeStatusResult> => ({
  success: false,
  error: { code: 'MEDIA_PROJECT_INVALID', message: 'FFmpeg Runtime 状态参数无效' },
})

export const mediaRenderIpcContracts = {
  getRuntimeStatus: bindIpcParser(
    mediaRenderIpc.getRuntimeStatus,
    (args) => {
      requireArgs(args, 0, mediaRenderIpc.getRuntimeStatus.channel)
      return ipcArgs()
    },
    invalidStatus,
  ),
  createTask: bindIpcParser(
    mediaRenderIpc.createTask,
    (args) => {
      requireArgs(args, 1, mediaRenderIpc.createTask.channel)
      return ipcArgs(parseCreateMediaRenderTaskInput(args[0]))
    },
    invalidTask,
  ),
  listTasks: bindIpcParser(
    mediaRenderIpc.listTasks,
    (args) => {
      requireArgs(args, 2, mediaRenderIpc.listTasks.channel)
      return ipcArgs(parseMediaWorkspacePath(args[0]), parseMediaProjectId(args[1]))
    },
    invalidList,
  ),
  retryTask: bindIpcParser(
    mediaRenderIpc.retryTask,
    (args) => {
      requireArgs(args, 2, mediaRenderIpc.retryTask.channel)
      return ipcArgs(parseMediaWorkspacePath(args[0]), parseMediaProjectId(args[1]))
    },
    invalidTask,
  ),
} as const

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

export type { MediaRenderApiContract }
