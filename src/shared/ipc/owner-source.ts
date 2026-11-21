import { z } from 'zod'
import { defineIpcInvoke } from './contract'

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
}
