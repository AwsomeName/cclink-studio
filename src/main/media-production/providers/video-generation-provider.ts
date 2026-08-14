import type {
  MediaVideoProviderStatus,
  MediaVideoTaskStatus,
} from '../../../shared/media-production/video-generation-types'

export interface VideoProviderCreateInput {
  prompt: string
  aspectRatio: '16:9' | '9:16' | '1:1'
  durationSeconds: 5 | 10
}

export interface VideoProviderTaskSnapshot {
  status: MediaVideoTaskStatus
  progress: number | null
  resultUrl?: string
  errorCode?: string
  errorMessage?: string
}

export interface VideoGenerationProvider {
  readonly id: 'volcengine-jimeng-video'
  getStatus(): MediaVideoProviderStatus
  createTask(input: VideoProviderCreateInput): Promise<{ taskId: string }>
  getTask(taskId: string): Promise<VideoProviderTaskSnapshot>
}
