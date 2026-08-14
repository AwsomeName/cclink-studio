import type { MediaProjectFailure } from './media-project-types'

export type MediaRenderTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type MediaRenderStep =
  | 'validating'
  | 'preparing'
  | 'rendering-scenes'
  | 'concatenating'
  | 'compositing'
  | 'exporting'
  | 'completed'

export interface MediaRenderRuntimeStatus {
  available: boolean
  version: string | null
  source: 'system-path' | 'configured-path' | 'unavailable'
  reason?: string
}

export interface CreateMediaRenderTaskInput {
  workspacePath: string
  projectId: string
  projectRevision: number
  outputPath: string
}

export interface MediaRenderTask {
  id: string
  workspacePath: string
  projectId: string
  projectRevision: number
  status: MediaRenderTaskStatus
  step: MediaRenderStep
  progress: number
  outputPath: string
  subtitlePath?: string
  sourcesPath?: string
  errorMessage?: string
  recovery?: string
  createdAt: number
  updatedAt: number
}

export type MediaRenderRuntimeStatusResult =
  | { success: true; runtime: MediaRenderRuntimeStatus }
  | { success: false; error: MediaProjectFailure }

export type MediaRenderTaskResult =
  | { success: true; task: MediaRenderTask }
  | { success: false; error: MediaProjectFailure }

export type MediaRenderTaskListResult =
  | { success: true; tasks: MediaRenderTask[] }
  | { success: false; tasks: []; error: MediaProjectFailure }

export interface MediaRenderApiContract {
  getRuntimeStatus(): Promise<MediaRenderRuntimeStatusResult>
  createTask(input: CreateMediaRenderTaskInput): Promise<MediaRenderTaskResult>
  listTasks(workspacePath: string, projectId: string): Promise<MediaRenderTaskListResult>
  retryTask(workspacePath: string, taskId: string): Promise<MediaRenderTaskResult>
}
