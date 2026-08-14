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
  assetId?: string | null
}

export interface MediaProjectAsset {
  id: string
  kind: 'image' | 'video' | 'audio'
  source: 'local-import' | 'search' | 'generated-image' | 'generated-video'
  fileName: string
  path: string
  mimeType: string
  sizeBytes: number
  sha256: string
  provenance: {
    originalPath?: string
    provider?: string
    remoteId?: string
    sourceUrl?: string
    author?: string
    authorUrl?: string
    licenseSummary?: string
    taskId?: string
    model?: string
    prompt?: string
    downloadedAt?: number
  }
  addedAt: number
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
  assets?: MediaProjectAsset[]
  renderSettings?: {
    logoAssetId: string | null
    musicAssetId: string | null
    musicVolume: number
    transition: 'cut' | 'fade'
  }
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

export interface ImportMediaProjectAssetInput {
  workspacePath: string
  projectId: string
  sourcePath: string
}

export interface GenerateMediaSceneImageInput {
  workspacePath: string
  projectId: string
  sceneId: string
  prompt: string
  aspectRatio: MediaAspectRatio
  provider: 'meshy' | 'jimeng'
}

export interface MediaImageProviderStatus {
  id: 'meshy' | 'jimeng'
  configured: boolean
  models: string[]
  reason?: string
}

export interface SearchMediaAssetsInput {
  query: string
  kind: 'image' | 'video'
  orientation: MediaAspectRatio
  page?: number
}

export interface AddMediaSearchCandidateInput {
  workspacePath: string
  projectId: string
  candidateId: string
}

export interface MediaSearchCandidate {
  id: string
  provider: 'pexels'
  kind: 'image' | 'video'
  thumbnailUrl: string
  sourceUrl: string
  author: string
  authorUrl: string
  width: number
  height: number
  durationSeconds?: number
  licenseSummary: string
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
  sourceSnapshotSha256: string
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
  | 'MEDIA_PROJECT_ASSET_UNSUPPORTED'
  | 'MEDIA_PROJECT_ASSET_IMPORT_FAILED'
  | 'MEDIA_PROJECT_IMAGE_PROVIDER_UNAVAILABLE'
  | 'MEDIA_PROJECT_IMAGE_GENERATION_FAILED'
  | 'MEDIA_PROJECT_SEARCH_PROVIDER_UNAVAILABLE'
  | 'MEDIA_PROJECT_SEARCH_FAILED'
  | 'MEDIA_PROJECT_VIDEO_PROVIDER_UNAVAILABLE'
  | 'MEDIA_PROJECT_VIDEO_SUBMIT_FAILED'
  | 'MEDIA_PROJECT_VIDEO_TASK_FAILED'
  | 'MEDIA_PROJECT_VIDEO_DOWNLOAD_FAILED'
  | 'MEDIA_PROJECT_RENDER_UNAVAILABLE'
  | 'MEDIA_PROJECT_RENDER_FAILED'

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

export type MediaProjectAssetImportResult =
  | { success: true; asset: MediaProjectAsset }
  | { success: false; error: MediaProjectFailure }

export type MediaImageProviderStatusResult =
  | { success: true; providers: MediaImageProviderStatus[] }
  | { success: false; providers: []; error: MediaProjectFailure }

export type MediaSearchResult =
  | {
      success: true
      provider: 'pexels'
      configured: true
      candidates: MediaSearchCandidate[]
      page: number
      hasMore: boolean
    }
  | {
      success: false
      provider: 'pexels'
      configured: boolean
      candidates: []
      error: MediaProjectFailure
    }

export interface MediaProjectsApiContract {
  list: (workspacePath: string) => Promise<MediaProjectListResult>
  get: (workspacePath: string, projectId: string) => Promise<MediaProjectOperationResult>
  create: (input: CreateMediaProjectInput) => Promise<MediaProjectOperationResult>
  save: (input: SaveMediaProjectInput) => Promise<MediaProjectOperationResult>
  proposeStoryboard: (input: ProposeMediaStoryboardInput) => Promise<MediaStoryboardProposalResult>
  importAsset: (input: ImportMediaProjectAssetInput) => Promise<MediaProjectAssetImportResult>
  getImageProviders: () => Promise<MediaImageProviderStatusResult>
  generateSceneImage: (
    input: GenerateMediaSceneImageInput,
  ) => Promise<MediaProjectAssetImportResult>
  searchAssets: (input: SearchMediaAssetsInput) => Promise<MediaSearchResult>
  addSearchCandidate: (
    input: AddMediaSearchCandidateInput,
  ) => Promise<MediaProjectAssetImportResult>
  onChanged: (callback: (workspacePath: string) => void) => () => void
}
