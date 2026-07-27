import { z } from 'zod'

const MAX_TEXT_BYTES = 64 * 1024 * 1024
const MAX_ASSET_BASE64_BYTES = 160 * 1024 * 1024

export const fsPathSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => !value.includes('\0'), 'Path must not contain NUL bytes')
export const fsWatchIdSchema = z.string().uuid()
export const fsTextContentSchema = z.string().max(MAX_TEXT_BYTES)

export const fsSaveTextDocumentSchema = z
  .object({
    filePath: fsPathSchema,
    content: fsTextContentSchema,
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    force: z.boolean().optional(),
  })
  .strict()

export const fsDocumentPathPairSchema = z
  .object({
    documentPath: fsPathSchema,
    sourcePath: fsPathSchema,
  })
  .strict()

export const fsSaveDocumentAssetSchema = z
  .object({
    documentPath: fsPathSchema,
    fileName: z.string().min(1).max(255),
    mimeType: z.string().startsWith('image/').max(128),
    content: z.string().max(MAX_ASSET_BASE64_BYTES),
    encoding: z.literal('base64'),
  })
  .strict()

export const fsMarkdownSaveAsSchema = z
  .object({
    sourcePath: fsPathSchema.optional(),
    targetPath: fsPathSchema,
    content: fsTextContentSchema,
  })
  .strict()

export const fsPathPairSchema = z
  .object({
    sourcePath: fsPathSchema,
    targetPath: fsPathSchema,
  })
  .strict()

export const fsDocumentTargetPathSchema = z
  .object({
    documentPath: fsPathSchema,
    targetPath: fsPathSchema,
  })
  .strict()

export const fsMarkdownTrashSchema = z
  .object({
    workspacePath: fsPathSchema,
    documentPath: fsPathSchema,
    includeAssets: z.boolean(),
  })
  .strict()

export const fsScopedPathSchema = z
  .object({
    workspacePath: fsPathSchema,
    targetPath: fsPathSchema,
  })
  .strict()

export const fsCopyEntrySchema = z
  .object({
    sourceWorkspacePath: fsPathSchema,
    sourcePath: fsPathSchema,
    targetWorkspacePath: fsPathSchema,
    targetDirectory: fsPathSchema,
  })
  .strict()
