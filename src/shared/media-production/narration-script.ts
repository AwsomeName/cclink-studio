import { z } from 'zod'

const segmentSchema = z.object({ id: z.string().uuid(), text: z.string().max(4000) }).strict()
export const narrationScriptSchema = z
  .object({
    revision: z.number().int().positive(),
    confirmedRevision: z.number().int().positive().nullable(),
    instructions: z.string().max(2000),
    appliedProposalId: z.string().uuid().nullable().default(null),
    segments: z.array(segmentSchema).min(1).max(100),
    proposal: z
      .object({
        id: z.string().uuid(),
        baseNarrationRevision: z.number().int().positive(),
        segments: z.array(segmentSchema).min(1).max(30),
        createdAt: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    generation: z
      .object({
        id: z.string().uuid(),
        status: z.enum(['running', 'succeeded', 'failed', 'interrupted']),
        mode: z.enum(['generate', 'shorten', 'rewrite']),
        inputRevision: z.number().int().positive(),
        startedAt: z.number().int().positive(),
        finishedAt: z.number().int().positive().nullable(),
        error: z.string().max(1000).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.segments.map((s) => s.id)).size !== value.segments.length) {
      ctx.addIssue({ code: 'custom', message: '口播段落 ID 重复' })
    }
    if (value.confirmedRevision !== null && value.confirmedRevision !== value.revision) {
      ctx.addIssue({ code: 'custom', message: '口播确认版本无效' })
    }
    if (value.confirmedRevision !== null && value.segments.some((s) => !s.text.trim())) {
      ctx.addIssue({ code: 'custom', message: '空白口播不能确认' })
    }
  })

export type NarrationScript = z.infer<typeof narrationScriptSchema>
export const generateNarrationInputSchema = z
  .object({
    workspacePath: z.string().min(1).max(4096),
    projectId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    mode: z.enum(['generate', 'shorten', 'rewrite']),
  })
  .strict()
export type GenerateNarrationInput = z.infer<typeof generateNarrationInputSchema>

export function initialNarration(segments: NarrationScript['segments']): NarrationScript {
  return {
    revision: 1,
    confirmedRevision: null,
    instructions: '',
    appliedProposalId: null,
    segments,
    proposal: null,
    generation: null,
  }
}

export function narrationInputKey(
  script: NarrationScript,
  brief: {
    targetDurationSeconds: number
    aspectRatio: string
  },
): string {
  return JSON.stringify([
    script.segments,
    script.instructions,
    brief.targetDurationSeconds,
    brief.aspectRatio,
  ])
}
