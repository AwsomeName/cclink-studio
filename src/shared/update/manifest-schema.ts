import { z } from 'zod'

export const updateArchitectureSchema = z.literal('arm64')
export const updateChannelSchema = z.literal('stable')
export const updateAssetKindSchema = z.literal('dmg')

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const sourceShaPattern = /^[0-9a-f]{40}$/
const sha256Pattern = /^[0-9a-f]{64}$/
const systemVersionPattern = /^\d+\.\d+(?:\.\d+)?$/
const safeAssetNamePattern = /^[\p{L}\p{N}][\p{L}\p{N} ._+()-]*$/u

function updateAssetSchema(extension: 'dmg') {
  return z
    .object({
      name: z
        .string()
        .min(1)
        .max(255)
        .regex(safeAssetNamePattern, '更新资产名必须是安全的 basename')
        .refine(
          (name) => name.toLowerCase().endsWith(`.${extension}`),
          `更新资产必须使用 .${extension} 扩展名`,
        ),
      size: z
        .number()
        .int()
        .positive()
        .max(8 * 1024 * 1024 * 1024),
      sha256: z.string().regex(sha256Pattern, 'SHA-256 必须是 64 位小写十六进制'),
    })
    .strict()
}

export const updateArchitectureAssetsSchema = z
  .object({
    dmg: updateAssetSchema('dmg'),
  })
  .strict()

export const updateManifestSchema = z
  .object({
    schemaVersion: z.literal(3),
    channel: updateChannelSchema,
    tag: z.string().min(2).max(128),
    version: z.string().regex(semanticVersionPattern, '更新版本不是合法语义版本'),
    sourceSha: z.string().regex(sourceShaPattern, 'sourceSha 必须是 40 位 Git commit SHA'),
    minimumSystemVersion: z.string().regex(systemVersionPattern, 'minimumSystemVersion 格式无效'),
    assets: z
      .object({
        arm64: updateArchitectureAssetsSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.tag !== `v${manifest.version}`) {
      context.addIssue({
        code: 'custom',
        path: ['tag'],
        message: 'Manifest tag 必须与 version 一致',
      })
    }
    if (manifest.channel === 'stable' && !stableVersionPattern.test(manifest.version)) {
      context.addIssue({
        code: 'custom',
        path: ['version'],
        message: 'stable 通道不能包含 prerelease 或 build metadata',
      })
    }
  })

export type UpdateArchitecture = z.infer<typeof updateArchitectureSchema>
export type UpdateChannel = z.infer<typeof updateChannelSchema>
export type UpdateAssetKind = z.infer<typeof updateAssetKindSchema>
export type UpdateArchitectureAssets = z.infer<typeof updateArchitectureAssetsSchema>
export type UpdateManifest = z.infer<typeof updateManifestSchema>

export function parseUpdateManifest(value: unknown): UpdateManifest {
  return updateManifestSchema.parse(value)
}
