import { z } from 'zod'

const boundedText = (max: number): z.ZodString => z.string().max(max)
const dialogFilterSchema = z
  .object({
    name: boundedText(256).trim().min(1),
    extensions: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(32)
          .regex(/^[A-Za-z0-9*._-]+$/),
      )
      .max(64),
  })
  .strict()
const dialogFiltersSchema = z.array(dialogFilterSchema).max(64).optional()

export const openDialogOptionsSchema = z
  .object({
    title: boundedText(512).optional(),
    multiSelections: z.boolean().optional(),
    selectDirectory: z.boolean().optional(),
    filters: dialogFiltersSchema,
  })
  .strict()
  .optional()

export const saveDialogOptionsSchema = z
  .object({
    title: boundedText(512).optional(),
    defaultPath: boundedText(32_768).optional(),
    filters: dialogFiltersSchema,
  })
  .strict()
  .optional()

export const messageBoxOptionsSchema = z
  .object({
    type: z.enum(['none', 'info', 'error', 'question', 'warning']).optional(),
    title: boundedText(512).optional(),
    message: boundedText(16 * 1_024),
    detail: boundedText(64 * 1_024).optional(),
    buttons: z.array(boundedText(512)).max(32).optional(),
    defaultId: z.number().int().min(0).max(31).optional(),
    cancelId: z.number().int().min(0).max(31).optional(),
  })
  .strict()
