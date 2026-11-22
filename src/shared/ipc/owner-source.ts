import { z } from 'zod'
import { defineIpcInvoke } from './contract'
import type { ReadmeResult } from './owner-research'

// Per-affair read-only source directories. The renderer never supplies an absolute path:
// directories are chosen in the main-process system dialog and referenced by grant ID.
export type OwnerSourceGrant = {
  id: string
  label: string
  path: string
  grantedAt: number
  /** Present when the bound directory is missing, moved or replaced; reads are refused. */
  error?: string
}
export type OwnerSourceCandidate = {
  token: string
  path: string
  label: string
  files: number
  truncated: boolean
  alreadyGranted: boolean
}
export type OwnerSourceEntry = { name: string; dir: boolean; size?: number }
export type OwnerSourceFile = { content: string; size: number }
export type OwnerSourcePaths =
  | { ok: true; paths: string[]; truncated: boolean }
  | { ok: false; error: string }
/** One local file a note pointed at: granted read-only, or skipped after a refusal or timeout. */
export type OwnerFileRequestResult =
  | { ok: true; key: string; label: string; path?: string }
  | { ok: false; outcome: 'denied' | 'timeout' | 'invalid'; label: string; error: string }
export type OwnerFileGrantResult =
  | { ok: true; key: string; label: string }
  | { ok: false; error: string }
const localPath = z.string().trim().min(1).max(600)
/** Search words for local files may be in any language, unlike GitHub tree terms. */
export const ownerSourceTerm = z.string().regex(/^[\p{L}\p{N}_.+/-]{1,60}$/u)

const affairId = z.string().uuid()
const grantId = z.string().uuid()
export const ownerSourceRelative = z
  .string()
  .max(512)
  .refine(
    (p) =>
      p === '' ||
      p
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..' && !/[\\\0]/.test(part)),
    '无效的相对路径',
  )

export const ownerSourceIpc = {
  list: defineIpcInvoke<[string], OwnerSourceGrant[]>('owner-source:list', (args) =>
    z.tuple([affairId]).parse(args),
  ),
  prepare: defineIpcInvoke<[string, string | null], OwnerSourceCandidate | null>(
    'owner-source:prepare',
    (args) => z.tuple([affairId, z.string().uuid().nullable()]).parse(args),
  ),
  confirm: defineIpcInvoke<[string, string], OwnerSourceGrant[]>('owner-source:confirm', (args) =>
    z.tuple([affairId, z.string().uuid()]).parse(args),
  ),
  revoke: defineIpcInvoke<[string, string], OwnerSourceGrant[]>('owner-source:revoke', (args) =>
    z.tuple([affairId, grantId]).parse(args),
  ),
  entries: defineIpcInvoke<[string, string, string], OwnerSourceEntry[]>(
    'owner-source:entries',
    (args) => z.tuple([affairId, grantId, ownerSourceRelative]).parse(args),
  ),
  read: defineIpcInvoke<[string, string, string], OwnerSourceFile>('owner-source:read', (args) =>
    z.tuple([affairId, grantId, ownerSourceRelative.refine((p) => p !== '')]).parse(args),
  ),
  /** Owner evidence search inside one granted folder; returns relative paths only. */
  find: defineIpcInvoke<[string, string, string[]], OwnerSourcePaths>(
    'owner-source:find',
    (args) => z.tuple([affairId, grantId, z.array(ownerSourceTerm).max(8)]).parse(args),
    () => ({ ok: false, error: '本地检索参数无效' }),
  ),
  /**
   * Owner asks to read one file outside the granted folders. The main process shows the shared
   * permission prompt in the affair's Owner session and waits up to 60 seconds.
   */
  requestFile: defineIpcInvoke<[string, string, string], OwnerFileRequestResult>(
    'owner-source:request-file',
    (args) =>
      z
        .tuple([affairId, z.string().regex(/^owner-[0-9a-f-]{36}-[a-h]$/i), localPath])
        .refine(
          ([id, conversation]) => conversation.startsWith('owner-' + id + '-'),
          '会话不属于本事务',
        )
        .parse(args),
    () => ({ ok: false, outcome: 'invalid', label: '', error: '文件请求参数无效' }),
  ),
  /** The user grants, from the Owner page, a file whose request was skipped earlier. */
  grantFile: defineIpcInvoke<[string, string], OwnerFileGrantResult>(
    'owner-source:grant-file',
    (args) => z.tuple([affairId, localPath]).parse(args),
    () => ({ ok: false, error: '文件授权参数无效' }),
  ),
  fileExcerpt: defineIpcInvoke<[string, string, string], ReadmeResult>(
    'owner-source:file-excerpt',
    (args) => z.tuple([affairId, grantId, z.string().max(120)]).parse(args),
    () => ({ ok: false, error: '文件读取参数无效' }),
  ),
  /** A bounded excerpt for Owner evidence, with the SHA-256 of the whole file at read time. */
  excerpt: defineIpcInvoke<[string, string, string, string], ReadmeResult>(
    'owner-source:excerpt',
    (args) =>
      z
        .tuple([
          affairId,
          grantId,
          ownerSourceRelative.refine((p) => p !== ''),
          z.string().max(120),
        ])
        .parse(args),
    () => ({ ok: false, error: '本地文件请求无效' }),
  ),
}
