import { bindIpcParser, defineIpcCall, ipcArgs } from '../ipc/contract'
import {
  parseCreateMediaProjectInput,
  parseMediaProjectId,
  parseMediaWorkspacePath,
  parseProposeMediaStoryboardInput,
  parseSaveMediaProjectInput,
} from './media-project-schema'
import type {
  CreateMediaProjectInput,
  MediaProjectListResult,
  MediaProjectOperationResult,
  MediaProjectsApiContract,
  MediaStoryboardProposalResult,
  ProposeMediaStoryboardInput,
  SaveMediaProjectInput,
} from './media-project-types'

export const mediaProjectsIpc = {
  list: defineIpcCall<[string], MediaProjectListResult>('mediaProjects:list'),
  get: defineIpcCall<[string, string], MediaProjectOperationResult>('mediaProjects:get'),
  create: defineIpcCall<[CreateMediaProjectInput], MediaProjectOperationResult>(
    'mediaProjects:create',
  ),
  save: defineIpcCall<[SaveMediaProjectInput], MediaProjectOperationResult>('mediaProjects:save'),
  proposeStoryboard: defineIpcCall<[ProposeMediaStoryboardInput], MediaStoryboardProposalResult>(
    'mediaProjects:proposeStoryboard',
  ),
} as const

export const mediaProjectsIpcEvents = {
  changed: 'mediaProjects:changed',
} as const

const invalidOperation = async (error: unknown): Promise<MediaProjectOperationResult> => ({
  success: false,
  error: {
    code: 'MEDIA_PROJECT_INVALID',
    message: error instanceof Error ? error.message : '宣发视频工程参数无效',
    recovery: '检查稿件、画幅和场景内容后重试',
  },
})

const invalidList = async (): Promise<MediaProjectListResult> => ({
  success: false,
  projects: [],
  error: {
    code: 'MEDIA_PROJECT_INVALID',
    message: '工作空间参数无效',
    recovery: '重新打开本地工作空间后重试',
  },
})

const invalidProposal = async (error: unknown): Promise<MediaStoryboardProposalResult> => ({
  success: false,
  error: {
    code: 'MEDIA_PROJECT_INVALID',
    message: error instanceof Error ? error.message : '生成分镜提案参数无效',
    recovery: '检查工程内容后重试',
  },
})

export const mediaProjectsIpcContracts = {
  list: bindIpcParser(
    mediaProjectsIpc.list,
    (args) => {
      requireArgs(args, 1, mediaProjectsIpc.list.channel)
      return ipcArgs(parseMediaWorkspacePath(args[0]))
    },
    invalidList,
  ),
  get: bindIpcParser(
    mediaProjectsIpc.get,
    (args) => {
      requireArgs(args, 2, mediaProjectsIpc.get.channel)
      return ipcArgs(parseMediaWorkspacePath(args[0]), parseMediaProjectId(args[1]))
    },
    invalidOperation,
  ),
  create: bindIpcParser(
    mediaProjectsIpc.create,
    (args) => {
      requireArgs(args, 1, mediaProjectsIpc.create.channel)
      return ipcArgs(parseCreateMediaProjectInput(args[0]))
    },
    invalidOperation,
  ),
  save: bindIpcParser(
    mediaProjectsIpc.save,
    (args) => {
      requireArgs(args, 1, mediaProjectsIpc.save.channel)
      return ipcArgs(parseSaveMediaProjectInput(args[0]))
    },
    invalidOperation,
  ),
  proposeStoryboard: bindIpcParser(
    mediaProjectsIpc.proposeStoryboard,
    (args) => {
      requireArgs(args, 1, mediaProjectsIpc.proposeStoryboard.channel)
      return ipcArgs(parseProposeMediaStoryboardInput(args[0]))
    },
    invalidProposal,
  ),
} as const

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

export type { MediaProjectsApiContract }
