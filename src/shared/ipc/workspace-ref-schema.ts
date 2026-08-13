import { z } from 'zod'
import type { WorkspaceRef } from '../workspace-ref'
import { absolutePathSchema, boundedIdentifierSchema, boundedTextSchema } from './input-schema'

export const remoteWorkspacePathSchema = boundedTextSchema(4_096).trim().min(1)

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
