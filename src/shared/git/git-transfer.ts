import { z } from 'zod'
import type { ProjectSyncConflictFile, ProjectSyncSkippedFile } from './project-sync'
const bounded = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !/[\0\r\n]/.test(value))
export const gitTransferInputSchema = z
  .object({
    action: z.enum([
      'clone',
      'inspect',
      'fetch',
      'update-copy',
      'pull',
      'diary-sync',
      'project-sync',
    ]),
    workspacePath: bounded.optional(),
    url: bounded.optional(),
    destinationParent: bounded.optional(),
    /** Clone only: the empty directory the user picked; the clone lands exactly here. */
    destination: bounded.optional(),
    /** Project download: create this new folder inside `destinationParent`. */
    destinationName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((v) => v !== '.' && v !== '..' && !/[\\/:\u0000-\u001f]/.test(v))
      .optional(),
    /** Clone a project-sync repository with the saved GitHub account and keep syncing it. */
    projectSync: z.boolean().optional(),
    /** Project sync: stop syncing this project on this computer (files and history stay). */
    stop: z.boolean().optional(),
    /** Project sync: the user's answer to a paused round of many incoming deletions. */
    deletions: z.enum(['apply', 'restore']).optional(),
    /** Project sync: per-file choice for files that cannot be merged as text. */
    resolutions: z
      .record(z.string().min(1).max(4096), z.enum(['local', 'remote', 'both']))
      .refine((v) => Object.keys(v).length <= 200)
      .optional(),
    branch: z
      .string()
      .max(240)
      .regex(/^[A-Za-z0-9._/-]*$/)
      .optional(),
    feedback: z.string().trim().max(2000).optional(),
    username: z.string().max(256).optional(),
    token: z.string().max(4096).optional(),
    sshKeyPath: bounded.optional(),
    expectedHead: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
    expectedTarget: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
  })
  .strict()
export type GitTransferInput = z.infer<typeof gitTransferInputSchema>
export interface GitTransferSnapshot {
  workspacePath: string
  remoteUrl: string
  branch: string
  head: string
  target: string
  checkedAt: string
  changes: string
  diff?: string
  diffTruncated?: boolean
  localChanges: string
  diverged: boolean
  conflict?: string
  newCopy?: boolean
  diaryMapping?: { directory: string; timezone: string }
  /** Project sync: files left out of this round (too large, likely secrets, nested repositories). */
  skipped?: ProjectSyncSkippedFile[]
  /** Project sync: paused because the other computer deleted many files. */
  pendingDeletions?: string[]
  /** Project sync: paused conflicts, per file. Text ones also appear in `conflict`. */
  conflictFiles?: ProjectSyncConflictFile[]
  /** Files received from / sent to the other computer in this round. */
  received?: number
  sent?: number
  /** GitHub `owner/name`, confirmed private in this round. */
  repository?: string
}

export type GitTransferResult =
  | { success: true; snapshot: GitTransferSnapshot }
  | {
      success: false
      error: { code: string; message: string; operation: GitTransferInput['action'] }
    }
