import { z } from 'zod'
import {
  updateArchitectureSchema,
  updateAssetKindSchema,
  updateManifestSchema,
  updateTrackSchema,
} from '../../shared/update'

export const updateProviderCheckInputSchema = z
  .object({
    currentVersion: z.string().min(1).max(128),
    track: updateTrackSchema,
    architecture: updateArchitectureSchema,
  })
  .strict()

export interface UpdateProviderCheckInput extends z.infer<typeof updateProviderCheckInputSchema> {
  signal: AbortSignal
}

const resolvedUpdateAssetSchema = z
  .object({
    kind: updateAssetKindSchema,
    name: z.string().min(1).max(255),
    size: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024 * 1024),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    downloadUrl: z
      .instanceof(URL)
      .refine((url) => url.protocol === 'https:', '更新地址必须使用 HTTPS'),
  })
  .strict()

const resolvedUpdateReleaseSchema = z
  .object({
    manifest: updateManifestSchema,
    architecture: updateArchitectureSchema,
    publishedAt: z.string().datetime({ offset: true }),
    releaseNotes: z.string().max(100_000),
    prerelease: z.boolean(),
    assets: z
      .object({
        dmg: resolvedUpdateAssetSchema,
        zip: resolvedUpdateAssetSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((release, context) => {
    for (const kind of ['dmg', 'zip'] as const) {
      const resolved = release.assets[kind]
      const expected = release.manifest.assets[release.architecture][kind]
      if (
        resolved.kind !== kind ||
        resolved.name !== expected.name ||
        resolved.size !== expected.size ||
        resolved.sha256 !== expected.sha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assets', kind],
          message: `Provider ${kind} 资产必须与 Manifest 当前架构一致`,
        })
      }
    }
  })

export const updateProviderCheckResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('disabled'),
      reason: z.literal('provider_unavailable'),
    })
    .strict(),
  z.object({ status: z.literal('up-to-date') }).strict(),
  z
    .object({
      status: z.literal('available'),
      release: resolvedUpdateReleaseSchema,
    })
    .strict(),
])

export type ResolvedUpdateAsset = z.infer<typeof resolvedUpdateAssetSchema>
export type ResolvedUpdateRelease = z.infer<typeof resolvedUpdateReleaseSchema>
export type UpdateProviderCheckResult = z.infer<typeof updateProviderCheckResultSchema>

export interface UpdateProvider {
  readonly id: string
  check(input: UpdateProviderCheckInput): Promise<UpdateProviderCheckResult>
}

export function parseUpdateProviderCheckResult(value: unknown): UpdateProviderCheckResult {
  return updateProviderCheckResultSchema.parse(value)
}
