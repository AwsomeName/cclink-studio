import { z } from 'zod'

const id = z.string().trim().min(1).max(200)
const text = z.string().trim().max(2000)
export const companyWorkspaceScopeSchema = z
  .object({
    workspaceRef: z
      .object({
        kind: z.literal('local'),
        path: z
          .string()
          .min(1)
          .max(8192)
          .refine((value) => !value.includes('\0')),
      })
      .strict(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  })
  .strict()
export const companyConfigureSchema = companyWorkspaceScopeSchema
  .extend({
    enabled: z.boolean(),
    name: z.string().trim().min(1).max(128),
  })
  .strict()
export const companyBusinessFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    goal: text,
    deliverable: text,
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    ledgerProjectId: id.nullable(),
  })
  .strict()
export const companyCreateBusinessSchema = companyWorkspaceScopeSchema
  .extend(companyBusinessFieldsSchema.shape)
  .strict()
export const companyUpdateBusinessSchema = companyCreateBusinessSchema
  .extend({
    businessId: id,
    expectedVersion: z.number().int().positive(),
    archived: z.boolean(),
  })
  .strict()
export const companyLinkSchema = companyWorkspaceScopeSchema
  .extend({
    businessId: id,
    kind: z.enum(['file', 'conversation', 'publishing']),
    target: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .refine((value) => !value.includes('\0')),
  })
  .strict()
export const companyUnlinkSchema = companyWorkspaceScopeSchema
  .extend({ businessId: id, linkId: id })
  .strict()
export const companyWorkspaceChangedSchema = z
  .object({ workspaceId: id, revision: z.number().int().nonnegative() })
  .strict()
