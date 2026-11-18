import { z } from 'zod'
import { diaryRelativePathSchema } from './personal-diary-source'

export const workspaceTypes = ['general', 'diary', 'company', 'electronics'] as const
export type WorkspaceType = (typeof workspaceTypes)[number]
export const workspaceTypeLabels: Record<WorkspaceType, string> = {
  general: '通用',
  diary: '日记',
  company: '公司',
  electronics: '电子开发',
}
export const workspaceSettingsPath = '.cclink-studio/workspace-settings.json'
export const workspaceSettingsSchema = z
  .object({
    version: z.literal(1),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((s) => !/[\u0000-\u001f]/.test(s)),
    type: z.enum(workspaceTypes),
    diary: z
      .object({
        directory: diaryRelativePathSchema,
        timezone: z
          .string()
          .max(80)
          .refine((value) => {
            try {
              new Intl.DateTimeFormat('en', { timeZone: value })
              return true
            } catch {
              return false
            }
          }),
        taskIds: z.array(z.string().uuid()).max(20).default([]),
      })
      .strict()
      .optional(),
  })
  .strict()
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>
export interface WorkspaceSettingsSnapshot {
  workspacePath: string
  settings: WorkspaceSettings
  revision: string | null
  status: 'saved' | 'missing' | 'unavailable' | 'invalid'
  error?: string
}
export const saveWorkspaceSettingsSchema = z
  .object({
    workspacePath: z.string().min(1).max(4096),
    settings: workspaceSettingsSchema,
    revision: z.string().max(128).nullable(),
  })
  .strict()
export type SaveWorkspaceSettings = z.infer<typeof saveWorkspaceSettingsSchema>
export const createWorkspaceSchema = z
  .object({
    parentPath: z.string().min(1).max(4096),
    directoryName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(
        (value) => value !== '.' && value !== '..' && !/[\\/:\u0000-\u001f]/.test(value),
        '名称不能包含路径分隔符',
      ),
    settings: workspaceSettingsSchema,
  })
  .strict()
export type CreateWorkspace = z.infer<typeof createWorkspaceSchema>
