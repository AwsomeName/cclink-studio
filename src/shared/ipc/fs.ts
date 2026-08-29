import { defineIpcCall } from './contract'
import { isBoundedIpcEventPayload, isBoundedIpcEventString } from './event-payload'

export interface FsDirEntry {
  name: string
  path: string
  type: 'directory' | 'file'
  extension?: string
  size: number
  modifiedAt: number
}

export interface FsFileStat {
  name: string
  path: string
  type: 'directory' | 'file'
  extension?: string
  size: number
  modifiedAt: number
  createdAt: number
}

export interface FsWatchDirEvent {
  watchId: string
  event: 'add' | 'change' | 'unlink'
  filePath: string
}

export function parseFsWatchDirEvent(value: unknown): FsWatchDirEvent | null {
  if (
    !isBoundedIpcEventPayload(value) ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null
  }
  const event = value as { watchId?: unknown; event?: unknown; filePath?: unknown }
  if (!isBoundedIpcEventString(event.watchId, 512)) return null
  if (event.event !== 'add' && event.event !== 'change' && event.event !== 'unlink') return null
  if (!isBoundedIpcEventString(event.filePath, 4096)) return null
  return value as FsWatchDirEvent
}

export interface FsReadResult {
  content: string
  encoding: 'utf-8' | 'base64'
}

export interface FsTextDocumentSnapshot {
  path: string
  content: string
  size: number
  modifiedAt: number
  hash: string
}

export type FsSaveTextDocumentResult =
  | {
      status: 'saved'
      snapshot: FsTextDocumentSnapshot
    }
  | {
      status: 'conflict'
      current: FsTextDocumentSnapshot | null
    }

export interface FsDocumentAssetResult {
  path: string
  relativePath: string
  fileName: string
}

export interface FsMarkdownAssetManifestEntry {
  path: string
  mediaType: string | null
  size: number
  sha256: string
}

export interface FsMarkdownDocumentInspection {
  documentPath: string
  assetDir: string
  manifestPath: string
  declarationPresent: boolean
  assetDirectoryPresent: boolean
  manifestStatus: 'current' | 'missing' | 'invalid'
  legacyAssetDir?: string
  referencedAssets: string[]
  unmanagedLocalAssets: string[]
  missingAssets: string[]
  modifiedAssets: string[]
  orphanAssets: string[]
  warnings: string[]
}

export interface FsMarkdownSaveAsResult {
  filePath: string
  assetDir?: string
  copiedAssets: number
  snapshot: FsTextDocumentSnapshot
}

export interface FsMarkdownRelocateResult {
  oldPath: string
  newPath: string
  oldAssetDir?: string
  newAssetDir?: string
  snapshot: FsTextDocumentSnapshot
}

export interface FsMarkdownExportResult {
  zipPath: string
  entries: number
}

export interface FsTrashMarkdownDocumentResult {
  trashedPaths: string[]
  failedPaths: string[]
}

export type FsRenderResult =
  | {
      kind: 'image'
      content: string
      encoding: 'base64'
      mimeType: string
      fileName: string
      path: string
    }
  | {
      kind: 'pdf'
      content: string
      encoding: 'base64'
      mimeType: 'application/pdf'
      fileName: string
      path: string
    }
  | {
      kind: 'media'
      mediaKind: 'video' | 'audio'
      playable: boolean
      content?: string
      encoding?: 'base64'
      mimeType: string | null
      fileName: string
      path: string
      reason?: string
    }
  | {
      kind: 'office-preview'
      officeKind: 'word' | 'presentation'
      blocks: FsOfficePreviewBlock[]
      truncated: boolean
      warning?: string
      fileName: string
      path: string
    }
  | {
      kind: 'unsupported'
      reason: string
      fileName: string
      path: string
    }

export type FsOfficePreviewBlock =
  | {
      type: 'heading' | 'paragraph' | 'list-item'
      text: string
      level?: number
    }
  | {
      type: 'table'
      rows: string[][]
    }
  | {
      type: 'slide'
      index: number
      title: string
      lines: string[]
    }

export interface FsExtractZipResult {
  targetDir: string
  extracted: number
}

export interface FsSaveTextDocumentInput {
  filePath: string
  content: string
  expectedHash?: string
  force?: boolean
}

export interface FsSaveDocumentAssetInput {
  documentPath: string
  fileName: string
  mimeType: string
  content: string
  encoding: 'base64'
}

export interface FsMarkdownSaveAsInput {
  sourcePath?: string
  targetPath: string
  content: string
}

export interface FsPathPairInput {
  sourcePath: string
  targetPath: string
}

export interface FsDocumentTargetPathInput {
  documentPath: string
  targetPath: string
}

export interface FsMarkdownTrashInput {
  workspacePath: string
  documentPath: string
  includeAssets: boolean
}

export interface FsScopedPathInput {
  workspacePath: string
  targetPath: string
}

export interface FsCopyEntryInput {
  sourceWorkspacePath: string
  sourcePath: string
  targetWorkspacePath: string
  targetDirectory: string
}

export interface FsCopyEntryResult {
  sourcePath: string
  destinationPath: string
}

export interface FsApiContract {
  getHomePath: () => Promise<string>
  readDir: (dirPath: string) => Promise<FsDirEntry[]>
  readFile: (filePath: string) => Promise<FsReadResult>
  readTextDocument: (filePath: string) => Promise<FsTextDocumentSnapshot>
  renderFile: (filePath: string) => Promise<FsRenderResult>
  writeFile: (filePath: string, content: string) => Promise<void>
  createFile: (filePath: string) => Promise<void>
  saveTextDocument: (input: FsSaveTextDocumentInput) => Promise<FsSaveTextDocumentResult>
  importDocumentAsset: (documentPath: string, sourcePath: string) => Promise<FsDocumentAssetResult>
  saveDocumentAsset: (input: FsSaveDocumentAssetInput) => Promise<FsDocumentAssetResult>
  inspectMarkdownDocument: (documentPath: string) => Promise<FsMarkdownDocumentInspection>
  saveMarkdownDocumentAs: (input: FsMarkdownSaveAsInput) => Promise<FsMarkdownSaveAsResult>
  relocateMarkdownDocument: (input: FsPathPairInput) => Promise<FsMarkdownRelocateResult>
  exportMarkdownDocumentZip: (input: FsDocumentTargetPathInput) => Promise<FsMarkdownExportResult>
  trashMarkdownDocument: (input: FsMarkdownTrashInput) => Promise<FsTrashMarkdownDocumentResult>
  trashPath: (input: FsScopedPathInput) => Promise<{ trashedPath: string }>
  revealPath: (input: FsScopedPathInput) => Promise<void>
  stat: (filePath: string) => Promise<FsFileStat>
  isDirectory: (filePath: string) => Promise<boolean>
  mkdir: (dirPath: string) => Promise<void>
  rename: (oldPath: string, newPath: string) => Promise<void>
  move: (oldPath: string, newPath: string) => Promise<void>
  copyEntry: (input: FsCopyEntryInput) => Promise<FsCopyEntryResult>
  delete: (filePath: string) => Promise<void>
  extractZip: (filePath: string) => Promise<FsExtractZipResult>
  openPath: (path: string) => Promise<void>
  watchDir: (dirPath: string, onChange: (event: FsWatchDirEvent) => void) => Promise<() => void>
}

export const fsIpc = {
  getHomePath: defineIpcCall<[], string>('fs:getHomePath'),
  readDir: defineIpcCall<[string], FsDirEntry[]>('fs:readDir'),
  readFile: defineIpcCall<[string], FsReadResult>('fs:readFile'),
  readTextDocument: defineIpcCall<[string], FsTextDocumentSnapshot>('fs:readTextDocument'),
  renderFile: defineIpcCall<[string], FsRenderResult>('fs:renderFile'),
  writeFile: defineIpcCall<[string, string], void>('fs:writeFile'),
  createFile: defineIpcCall<[string], void>('fs:createFile'),
  saveTextDocument: defineIpcCall<[FsSaveTextDocumentInput], FsSaveTextDocumentResult>(
    'fs:saveTextDocument',
  ),
  importDocumentAsset: defineIpcCall<[string, string], FsDocumentAssetResult>(
    'fs:importDocumentAsset',
  ),
  saveDocumentAsset: defineIpcCall<[FsSaveDocumentAssetInput], FsDocumentAssetResult>(
    'fs:saveDocumentAsset',
  ),
  inspectMarkdownDocument: defineIpcCall<[string], FsMarkdownDocumentInspection>(
    'fs:inspectMarkdownDocument',
  ),
  saveMarkdownDocumentAs: defineIpcCall<[FsMarkdownSaveAsInput], FsMarkdownSaveAsResult>(
    'fs:saveMarkdownDocumentAs',
  ),
  relocateMarkdownDocument: defineIpcCall<[FsPathPairInput], FsMarkdownRelocateResult>(
    'fs:relocateMarkdownDocument',
  ),
  exportMarkdownDocumentZip: defineIpcCall<[FsDocumentTargetPathInput], FsMarkdownExportResult>(
    'fs:exportMarkdownDocumentZip',
  ),
  trashMarkdownDocument: defineIpcCall<[FsMarkdownTrashInput], FsTrashMarkdownDocumentResult>(
    'fs:trashMarkdownDocument',
  ),
  trashPath: defineIpcCall<[FsScopedPathInput], { trashedPath: string }>('fs:trashPath'),
  revealPath: defineIpcCall<[FsScopedPathInput], void>('fs:revealPath'),
  stat: defineIpcCall<[string], FsFileStat>('fs:stat'),
  isDirectory: defineIpcCall<[string], boolean>('fs:isDirectory'),
  mkdir: defineIpcCall<[string], void>('fs:mkdir'),
  rename: defineIpcCall<[string, string], void>('fs:rename'),
  move: defineIpcCall<[string, string], void>('fs:move'),
  copyEntry: defineIpcCall<[FsCopyEntryInput], FsCopyEntryResult>('fs:copyEntry'),
  delete: defineIpcCall<[string], void>('fs:delete'),
  extractZip: defineIpcCall<[string], FsExtractZipResult>('fs:extractZip'),
  openPath: defineIpcCall<[string], void>('fs:openPath'),
  watchDirStart: defineIpcCall<[string], string>('fs:watchDirStart'),
  watchDirStop: defineIpcCall<[string], boolean>('fs:watchDirStop'),
} as const

export const fsIpcEvents = {
  watchDirChanged: 'fs:watchDirChanged',
} as const
