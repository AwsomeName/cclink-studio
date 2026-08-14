import type { LocalWorkspaceRef } from '../workspace-ref'

export type MediaAspectRatio = '16:9' | '9:16' | '1:1'

export type MediaProjectPlatform = 'douyin' | 'xiaohongshu' | 'wechat-video' | 'bilibili' | 'web'

export interface MediaProjectBrand {
  primaryColor: string
  callToAction: string
}

export interface MediaProjectScene {
  id: string
  order: number
  durationSeconds: number
  narration: string
  subtitle: string
  visualDescription: string
  searchTerms: string[]
  generationPrompt: string
  materialKind: 'unassigned' | 'workspace' | 'search' | 'generated-image' | 'generated-video'
}

export interface MediaProject {
  schemaVersion: 1
  id: string
  workspaceRef: LocalWorkspaceRef
  revision: number
  title: string
  source: {
    path: string
    snapshot: string
  }
  brief: {
    platform: MediaProjectPlatform
    aspectRatio: MediaAspectRatio
    targetDurationSeconds: number
    brand: MediaProjectBrand
  }
  scenes: MediaProjectScene[]
  createdAt: number
  updatedAt: number
}

export interface MediaProjectSummary {
  id: string
  title: string
  sourcePath: string
  aspectRatio: MediaAspectRatio
  targetDurationSeconds: number
  sceneCount: number
  revision: number
  updatedAt: number
}

export interface CreateMediaProjectInput {
  workspacePath: string
  sourcePath: string
  platform: MediaProjectPlatform
  aspectRatio: MediaAspectRatio
  targetDurationSeconds: number
}

export interface SaveMediaProjectInput {
  workspacePath: string
  expectedRevision: number
  project: MediaProject
}

export interface ProposeMediaStoryboardInput {
  workspacePath: string
  project: MediaProject
}

export interface MediaStoryboardProposalScene {
  id: string
  order: number
  durationSeconds: number
  narration: string
  subtitle: string
  visualDescription: string
  searchTerms: string[]
  generationPrompt: string
  materialKind: 'unassigned'
}

export interface MediaStoryboardProposal {
  id: string
  projectId: string
  baseRevision: number
  title: string
  scenes: MediaStoryboardProposalScene[]
  createdAt: number
}

export type MediaProjectErrorCode =
  | 'MEDIA_PROJECT_INVALID'
  | 'MEDIA_PROJECT_WORKSPACE_UNAVAILABLE'
  | 'MEDIA_PROJECT_SOURCE_UNAVAILABLE'
  | 'MEDIA_PROJECT_NOT_FOUND'
  | 'MEDIA_PROJECT_REVISION_CONFLICT'
  | 'MEDIA_PROJECT_STORE_INVALID'
  | 'MEDIA_PROJECT_WRITE_FAILED'
  | 'MEDIA_PROJECT_AGENT_UNAVAILABLE'
  | 'MEDIA_PROJECT_PROPOSAL_INVALID'

export interface MediaProjectFailure {
  code: MediaProjectErrorCode
  message: string
  recovery?: string
}

export type MediaProjectListResult =
  | { success: true; projects: MediaProjectSummary[] }
  | { success: false; projects: []; error: MediaProjectFailure }

export type MediaProjectOperationResult =
  | { success: true; project: MediaProject }
  | { success: false; error: MediaProjectFailure }

export type MediaStoryboardProposalResult =
  | { success: true; proposal: MediaStoryboardProposal }
  | { success: false; error: MediaProjectFailure }

export interface MediaProjectsApiContract {
  list: (workspacePath: string) => Promise<MediaProjectListResult>
  get: (workspacePath: string, projectId: string) => Promise<MediaProjectOperationResult>
  create: (input: CreateMediaProjectInput) => Promise<MediaProjectOperationResult>
  save: (input: SaveMediaProjectInput) => Promise<MediaProjectOperationResult>
  proposeStoryboard: (input: ProposeMediaStoryboardInput) => Promise<MediaStoryboardProposalResult>
  onChanged: (callback: (workspacePath: string) => void) => () => void
}
