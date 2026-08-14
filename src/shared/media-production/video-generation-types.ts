import type {
  MediaAspectRatio,
  MediaProjectAsset,
  MediaProjectFailure,
} from './media-project-types'

export type MediaVideoProviderId = 'volcengine-jimeng-video'
export type MediaVideoModelId = 'jimeng-video-3.0-pro'
export type MediaVideoTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unknown'

export interface MediaVideoProviderStatus {
  id: MediaVideoProviderId
  configured: boolean
  models: MediaVideoModelId[]
  textToVideo: boolean
  imageToVideo: boolean
  durations: Array<5 | 10>
  aspectRatios: MediaAspectRatio[]
  supportsCancel: boolean
  costEstimate: null
  reason?: string
}

export interface CreateMediaVideoTaskInput {
  workspacePath: string
  projectId: string
  projectRevision: number
  sceneId: string
  provider: MediaVideoProviderId
  model: MediaVideoModelId
  prompt: string
  aspectRatio: MediaAspectRatio
  durationSeconds: 5 | 10
}

export interface MediaVideoTask {
  id: string
  workspacePath: string
  projectId: string
  projectRevision: number
  sceneId: string
  provider: MediaVideoProviderId
  providerTaskId: string
  model: MediaVideoModelId
  prompt: string
  aspectRatio: MediaAspectRatio
  durationSeconds: 5 | 10
  status: MediaVideoTaskStatus
  progress: number | null
  outputAsset?: MediaProjectAsset
  errorCode?: string
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

export type MediaVideoProviderStatusResult =
  | { success: true; providers: MediaVideoProviderStatus[] }
  | { success: false; providers: []; error: MediaProjectFailure }

export type MediaVideoTaskResult =
  | { success: true; task: MediaVideoTask }
  | { success: false; error: MediaProjectFailure }

export type MediaVideoTaskListResult =
  | { success: true; tasks: MediaVideoTask[] }
  | { success: false; tasks: []; error: MediaProjectFailure }

export interface MediaVideoApiContract {
  getProviders(): Promise<MediaVideoProviderStatusResult>
  createTask(input: CreateMediaVideoTaskInput): Promise<MediaVideoTaskResult>
  listTasks(workspacePath: string, projectId: string): Promise<MediaVideoTaskListResult>
  retryTask(workspacePath: string, taskId: string): Promise<MediaVideoTaskResult>
}
