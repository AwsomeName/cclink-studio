import { z } from 'zod'
import {
  bindIpcParser,
  bindNoArgsIpc,
  defineIpcCall,
  type IpcInvokeContract,
} from '../ipc/contract'
import {
  updateArchitectureSchema,
  updateAssetKindSchema,
  updateChannelSchema,
} from './manifest-schema'
import { updateTrackSchema } from './update-track'

export const updatePhaseSchema = z.enum([
  'disabled',
  'idle',
  'checking',
  'available',
  'downloading',
  'verifying',
  'readyToInstall',
  'installing',
  'failed',
])

export const updateErrorCodeSchema = z.enum([
  'provider_unavailable',
  'network_offline',
  'network_timeout',
  'release_invalid',
  'manifest_invalid',
  'unsupported_arch',
  'unsupported_system',
  'disk_space_insufficient',
  'download_cancelled',
  'download_corrupt',
  'publisher_mismatch',
  'install_blocked',
  'install_failed',
])

const boundedIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\0\r\n]/.test(value), '标识符包含非法控制字符')

export const updateErrorSchema = z
  .object({
    code: updateErrorCodeSchema,
    userMessage: z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => !/[\0\r\n]/.test(value), '用户错误消息包含非法控制字符'),
    retryable: z.boolean(),
  })
  .strict()

const updateAssetSummarySchema = z
  .object({
    kind: updateAssetKindSchema,
    name: z.string().min(1).max(255),
    size: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024 * 1024),
  })
  .strict()

const updateReleaseSummarySchema = z
  .object({
    tag: z.string().min(2).max(128),
    version: z.string().min(1).max(128),
    channel: updateChannelSchema,
    architecture: updateArchitectureSchema,
    minimumSystemVersion: z.string().min(3).max(64),
    publishedAt: z.string().datetime({ offset: true }),
    releaseNotes: z.string().max(100_000),
    prerelease: z.boolean(),
    asset: updateAssetSummarySchema,
  })
  .strict()

const updateProgressSchema = z
  .object({
    fraction: z.number().finite().min(0).max(1),
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().positive(),
    bytesPerSecond: z.number().finite().nonnegative(),
  })
  .strict()
  .refine(
    ({ downloadedBytes, totalBytes }) => downloadedBytes <= totalBytes,
    '已下载字节不能超过总大小',
  )

export const updateSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    phase: updatePhaseSchema,
    operationId: boundedIdentifierSchema.nullable(),
    currentVersion: z.string().min(1).max(128),
    track: updateTrackSchema,
    availableRelease: updateReleaseSummarySchema.nullable(),
    progress: updateProgressSchema.nullable(),
    lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
    ignoredVersion: z.string().min(1).max(128).nullable(),
    error: updateErrorSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const operationRequired = new Set([
      'checking',
      'available',
      'downloading',
      'verifying',
      'readyToInstall',
      'installing',
      'failed',
    ])
    const releaseRequired = new Set([
      'available',
      'downloading',
      'verifying',
      'readyToInstall',
      'installing',
    ])
    if (operationRequired.has(snapshot.phase) && !snapshot.operationId) {
      context.addIssue({
        code: 'custom',
        path: ['operationId'],
        message: `阶段 ${snapshot.phase} 必须包含稳定 operationId`,
      })
    }
    if ((snapshot.phase === 'disabled' || snapshot.phase === 'idle') && snapshot.operationId) {
      context.addIssue({
        code: 'custom',
        path: ['operationId'],
        message: `阶段 ${snapshot.phase} 不能包含活动 operationId`,
      })
    }
    if (releaseRequired.has(snapshot.phase) && !snapshot.availableRelease) {
      context.addIssue({
        code: 'custom',
        path: ['availableRelease'],
        message: `阶段 ${snapshot.phase} 必须包含可用版本摘要`,
      })
    }
    if (snapshot.phase === 'downloading' && !snapshot.progress) {
      context.addIssue({
        code: 'custom',
        path: ['progress'],
        message: '下载阶段必须包含进度',
      })
    }
    if (snapshot.phase !== 'downloading' && snapshot.progress) {
      context.addIssue({
        code: 'custom',
        path: ['progress'],
        message: '只有下载阶段可以包含进度',
      })
    }
    if (snapshot.phase === 'failed' && !snapshot.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: '失败阶段必须包含结构化错误',
      })
    }
    if (snapshot.phase !== 'failed' && snapshot.phase !== 'available' && snapshot.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: '只有失败阶段或保留候选的刷新失败可以包含结构化错误',
      })
    }
  })

export const updateCommandResultSchema = z
  .object({
    ok: z.boolean(),
    snapshot: updateSnapshotSchema,
  })
  .strict()

export const updateManualInstallerResultSchema = z
  .object({
    ok: z.boolean(),
    error: updateErrorSchema.nullable(),
    snapshot: updateSnapshotSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.ok && result.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: '成功打开安装包时不能包含错误',
      })
    }
    if (!result.ok && !result.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: '打开安装包失败时必须包含结构化错误',
      })
    }
  })

const installImpactSchema = z
  .object({
    kind: z.enum(['editor', 'agent', 'terminal', 'browser', 'long_task']),
    severity: z.enum(['attention', 'blocked']),
    label: z.string().min(1).max(256),
    detail: z.string().max(2_000),
  })
  .strict()

export const updateInstallPreparationSchema = z
  .object({
    ok: z.boolean(),
    confirmationToken: boundedIdentifierSchema.nullable(),
    impacts: z.array(installImpactSchema).max(1_000),
    snapshot: updateSnapshotSchema,
  })
  .strict()
  .superRefine((preparation, context) => {
    if (preparation.ok && !preparation.confirmationToken) {
      context.addIssue({
        code: 'custom',
        path: ['confirmationToken'],
        message: '可安装状态必须包含短期确认令牌',
      })
    }
    if (!preparation.ok && preparation.confirmationToken) {
      context.addIssue({
        code: 'custom',
        path: ['confirmationToken'],
        message: '安装准备未通过时不能签发确认令牌',
      })
    }
  })

const installAndRestartInputSchema = z
  .object({
    confirmationToken: boundedIdentifierSchema,
  })
  .strict()

export type UpdatePhase = z.infer<typeof updatePhaseSchema>
export type UpdateErrorCode = z.infer<typeof updateErrorCodeSchema>
export type UpdateSnapshot = z.infer<typeof updateSnapshotSchema>
export type UpdateCommandResult = z.infer<typeof updateCommandResultSchema>
export type UpdateManualInstallerResult = z.infer<typeof updateManualInstallerResultSchema>
export type UpdateInstallPreparation = z.infer<typeof updateInstallPreparationSchema>
export type UpdateInstallImpact = z.infer<typeof installImpactSchema>
export type UpdateInstallAndRestartInput = z.infer<typeof installAndRestartInputSchema>
export const updateSnapshotChangedEventSchema = z
  .object({
    snapshot: updateSnapshotSchema,
  })
  .strict()
export type UpdateSnapshotChangedEvent = z.infer<typeof updateSnapshotChangedEventSchema>

export const updateIpc = {
  getSnapshot: bindNoArgsIpc(
    defineIpcCall<[], UpdateSnapshot>('updater.getSnapshot'),
  ) as IpcInvokeContract<[], UpdateSnapshot>,
  check: bindNoArgsIpc(
    defineIpcCall<[], UpdateCommandResult>('updater.check'),
  ) as IpcInvokeContract<[], UpdateCommandResult>,
  startDownload: bindNoArgsIpc(
    defineIpcCall<[], UpdateCommandResult>('updater.startDownload'),
  ) as IpcInvokeContract<[], UpdateCommandResult>,
  cancelDownload: bindNoArgsIpc(
    defineIpcCall<[], UpdateCommandResult>('updater.cancelDownload'),
  ) as IpcInvokeContract<[], UpdateCommandResult>,
  defer: bindNoArgsIpc(
    defineIpcCall<[], UpdateCommandResult>('updater.defer'),
  ) as IpcInvokeContract<[], UpdateCommandResult>,
  ignoreVersion: bindNoArgsIpc(
    defineIpcCall<[], UpdateCommandResult>('updater.ignoreVersion'),
  ) as IpcInvokeContract<[], UpdateCommandResult>,
  openManualInstaller: bindNoArgsIpc(
    defineIpcCall<[], UpdateManualInstallerResult>('updater.openManualInstaller'),
  ) as IpcInvokeContract<[], UpdateManualInstallerResult>,
  prepareInstall: bindNoArgsIpc(
    defineIpcCall<[], UpdateInstallPreparation>('updater.prepareInstall'),
  ) as IpcInvokeContract<[], UpdateInstallPreparation>,
  installAndRestart: bindIpcParser(
    defineIpcCall<[UpdateInstallAndRestartInput], UpdateCommandResult>('updater.installAndRestart'),
    (args): [UpdateInstallAndRestartInput] => [installAndRestartInputSchema.parse(args[0])],
  ),
} as const

export const updateIpcEvents = {
  snapshotChanged: 'updater.snapshotChanged',
} as const

/** @deprecated 使用 updateIpcEvents.snapshotChanged。 */
export const updateSnapshotChangedChannel = updateIpcEvents.snapshotChanged

export function parseUpdateSnapshot(value: unknown): UpdateSnapshot {
  return updateSnapshotSchema.parse(value)
}

export function parseUpdateCommandResult(value: unknown): UpdateCommandResult {
  return updateCommandResultSchema.parse(value)
}

export function parseUpdateManualInstallerResult(value: unknown): UpdateManualInstallerResult {
  return updateManualInstallerResultSchema.parse(value)
}

export function parseUpdateInstallPreparation(value: unknown): UpdateInstallPreparation {
  return updateInstallPreparationSchema.parse(value)
}
