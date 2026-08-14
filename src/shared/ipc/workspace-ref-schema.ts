import { z } from 'zod'
import type { WorkspaceRef } from '../workspace-ref'
import { absolutePathSchema, boundedIdentifierSchema, boundedTextSchema } from './input-schema'

export const remoteWorkspacePathSchema = boundedTextSchema(4_096)
  .trim()
  .min(1)
  .refine(isAbsoluteRemotePath, '远程路径必须是规范的 POSIX、Windows 盘符或 UNC 绝对路径')

export const remoteWorkspaceRefSchema = z
  .object({
    kind: z.literal('remote'),
    transport: z.literal('cclink'),
    endpointId: boundedIdentifierSchema(256),
    workspaceId: boundedIdentifierSchema(256),
    path: remoteWorkspacePathSchema,
    label: boundedTextSchema(256).optional(),
    endpointName: boundedTextSchema(256).optional(),
  })
  .strict()

export const workspaceRefSchema: z.ZodType<WorkspaceRef> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('local'), path: absolutePathSchema }).strict(),
  remoteWorkspaceRefSchema,
])

function isAbsoluteRemotePath(path: string): boolean {
  if (path.includes('\0')) return false
  if (path.startsWith('/')) return !path.includes('\\')
  if (/^[A-Za-z]:\\/u.test(path)) return !path.includes('/')
  if (/^\\\\[^\\/]+\\[^\\/]+(?:\\.*)?$/u.test(path)) return !path.includes('/')
  return false
}
