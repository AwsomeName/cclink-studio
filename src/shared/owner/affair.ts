import { researchSchema } from './research'
import { z } from 'zod'

export const material = z.object({
  name: z.string().trim().min(1).max(120),
  text: z.string().max(4000),
})
export const receipt = z.object({ index: z.number().int(), quote: z.string().min(1).max(500) })
export const affair = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(1500),
  sources: z.array(material).max(6),
  research: researchSchema.optional(),
  confirmed: z.boolean(),
  updated: z.number(),
  attempt: z.string().nullable(),
  run: z.string().nullable(),
  issue: z.string().max(16000),
  result: z.array(receipt).nullable(),
  method: z.enum(['agent', 'local']).nullable(),
})
export const directoryInfo = z.object({
  path: z.string(),
  revision: z.number().int().positive(),
  files: z.array(z.string()),
  reportFile: z.string().optional(),
  error: z.string().optional(),
})
export type DirectoryInfo = z.infer<typeof directoryInfo>
export type AffairRecord = z.infer<typeof affair>
export type Affair = AffairRecord & { directory?: DirectoryInfo }
