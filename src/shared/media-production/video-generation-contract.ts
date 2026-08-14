import { bindIpcParser, defineIpcCall, ipcArgs } from '../ipc/contract'
import { parseMediaProjectId, parseMediaWorkspacePath } from './media-project-schema'
import { parseCreateMediaVideoTaskInput } from './video-generation-schema'
import type {
  CreateMediaVideoTaskInput,
  MediaVideoApiContract,
  MediaVideoProviderStatusResult,
  MediaVideoTaskListResult,
  MediaVideoTaskResult,
} from './video-generation-types'

export const mediaVideoIpc = {
  getProviders: defineIpcCall<[], MediaVideoProviderStatusResult>('mediaVideo:getProviders'),
  createTask: defineIpcCall<[CreateMediaVideoTaskInput], MediaVideoTaskResult>(
    'mediaVideo:createTask',
  ),
  listTasks: defineIpcCall<[string, string], MediaVideoTaskListResult>('mediaVideo:listTasks'),
  retryTask: defineIpcCall<[string, string], MediaVideoTaskResult>('mediaVideo:retryTask'),
} as const

const invalidTask = async (error: unknown): Promise<MediaVideoTaskResult> => ({
  success: false,
  error: {
    code: 'MEDIA_PROJECT_INVALID',
    message: error instanceof Error ? error.message : '视频任务参数无效',
  },
})

const invalidList = async (error: unknown): Promise<MediaVideoTaskListResult> => ({
  success: false,
  tasks: [],
  error: {
    code: 'MEDIA_PROJECT_INVALID',
    message: error instanceof Error ? error.message : '视频任务列表参数无效',
  },
})

const invalidProviders = async (): Promise<MediaVideoProviderStatusResult> => ({
  success: false,
  providers: [],
  error: { code: 'MEDIA_PROJECT_INVALID', message: '视频 Provider 状态参数无效' },
})

export const mediaVideoIpcContracts = {
  getProviders: bindIpcParser(
    mediaVideoIpc.getProviders,
    (args) => {
      requireArgs(args, 0, mediaVideoIpc.getProviders.channel)
      return ipcArgs()
    },
    invalidProviders,
  ),
  createTask: bindIpcParser(
    mediaVideoIpc.createTask,
    (args) => {
      requireArgs(args, 1, mediaVideoIpc.createTask.channel)
      return ipcArgs(parseCreateMediaVideoTaskInput(args[0]))
    },
    invalidTask,
  ),
  listTasks: bindIpcParser(
    mediaVideoIpc.listTasks,
    (args) => {
      requireArgs(args, 2, mediaVideoIpc.listTasks.channel)
      return ipcArgs(parseMediaWorkspacePath(args[0]), parseMediaProjectId(args[1]))
    },
    invalidList,
  ),
  retryTask: bindIpcParser(
    mediaVideoIpc.retryTask,
    (args) => {
      requireArgs(args, 2, mediaVideoIpc.retryTask.channel)
      return ipcArgs(parseMediaWorkspacePath(args[0]), parseMediaProjectId(args[1]))
    },
    invalidTask,
  ),
} as const

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

export type { MediaVideoApiContract }
