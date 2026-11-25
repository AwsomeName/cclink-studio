/** Project sync contract (ADR 0026). Shared by main and renderer. */

export const PROJECT_SYNC_SECTION = 'project-sync'
/** Files larger than this are listed as 不会上传 and never staged. */
export const PROJECT_SYNC_MAX_FILE_BYTES = 50 * 1024 * 1024
/** More incoming deletions than this pause the round until the user decides. */
export const PROJECT_SYNC_DELETION_LIMIT = 20

export type ProjectSyncSkipReason = 'large' | 'sensitive' | 'nested-repository'

export interface ProjectSyncSkippedFile {
  path: string
  reason: ProjectSyncSkipReason
  size?: number
}

export interface ProjectSyncConflictFile {
  path: string
  /**
   * text: merged by the user's words through AI. file: the user picks a side or keeps both.
   * record: a company record changed on both computers; the user picks one, never AI.
   */
  kind: 'text' | 'file' | 'record'
  hasLocal: boolean
  hasRemote: boolean
  label?: string
  fields?: Array<{ name: string; local: string; remote: string }>
}

/** “第一次会上传什么” — computed by Git with the exact rules a round uses. */
export interface ProjectSyncPreview {
  workspacePath: string
  files: number
  bytes: number
  /** Top-level folders (or “其他文件”) with counts, largest first. */
  groups: Array<{ name: string; files: number; bytes: number }>
  skipped: ProjectSyncSkippedFile[]
  /** Ignored regenerable folders such as node_modules/, listed by name only. */
  generated: string[]
  /** Company projects: records and accounts that travel as the company sync copy. */
  company?: Array<{ label: string; count: number }>
  /** The folder is itself a Git repository not set up by project sync. */
  gitManaged: boolean
  /** Truncated after this many files; counts are a lower bound. */
  truncated: boolean
}

export type ProjectSyncFileResolution = 'local' | 'remote' | 'both'

/**
 * Only `https://github.com/<owner>/<repo>(.git)` is accepted: visibility must be verifiable
 * with the saved GitHub account before anything is sent or received.
 */
export function parseGitHubHttpsRepository(
  value: string,
): { owner: string; name: string; url: string } | null {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== 'github.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    return null
  const match =
    /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(
      parsed.pathname,
    )
  if (!match || match[2] === '.' || match[2] === '..') return null
  return { owner: match[1], name: match[2], url: `https://github.com/${match[1]}/${match[2]}.git` }
}
