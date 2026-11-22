import { z } from 'zod'
import {
  companyDecisionCreateFieldsSchema,
  companyDecisionUpdateFieldsSchema,
} from './company-decision'

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
    kind: z.enum(['file', 'conversation', 'publishing', 'workspace']),
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
export const companyCustomerCaseKindSchema = z.enum(['lead', 'after-sales'])
export const companyCustomerCaseStatusSchema = z.enum([
  'waiting-me',
  'waiting-customer',
  'resolved',
])
export const companyCustomerCaseFieldsSchema = z
  .object({
    kind: companyCustomerCaseKindSchema,
    customer: z.string().trim().min(1).max(128),
    channel: z.string().trim().max(64),
    summary: z.string().trim().min(1).max(2000),
    orderRef: z.string().trim().max(128),
    nextStep: z.string().trim().max(500),
    businessId: id.nullable(),
  })
  .strict()
export const companyCreateCaseSchema = companyWorkspaceScopeSchema
  .extend(companyCustomerCaseFieldsSchema.shape)
  .strict()
export const companyUpdateCaseSchema = companyCreateCaseSchema
  .extend({
    caseId: id,
    expectedVersion: z.number().int().positive(),
    status: companyCustomerCaseStatusSchema,
  })
  .strict()
export const companyCreateDecisionSchema = companyWorkspaceScopeSchema
  .extend(companyDecisionCreateFieldsSchema.shape)
  .strict()
export const companyUpdateDecisionSchema = companyWorkspaceScopeSchema
  .extend(companyDecisionUpdateFieldsSchema.shape)
  .strict()
export const companyWorkspaceChangedSchema = z
  .object({ workspaceId: id, revision: z.number().int().nonnegative() })
  .strict()

export const companyLinkedWorkspaceSchema = z
  .object({
    workspacePath: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => value.startsWith('/') && !value.includes('\0')),
    workspaceId: z.string().min(1).max(128),
  })
  .strict()
