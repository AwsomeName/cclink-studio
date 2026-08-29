import path from 'node:path'
import { z } from 'zod'
import {
  bindIpcParser,
  ipcArgs,
  type IpcInvokeContract,
  type IpcInvokeDefinition,
} from './contract'
import { androidIpc } from './android'

function bindLegacyNoArgs<Result>(
  definition: IpcInvokeDefinition<[], Result>,
): IpcInvokeContract<[], Result> {
  return bindIpcParser(definition, () => ipcArgs())
}

function bindAsyncParser<Args extends unknown[], Result>(
  definition: IpcInvokeDefinition<Args, Result>,
  parseArgs: (args: unknown[]) => Args,
): IpcInvokeContract<Args, Result> {
  return bindIpcParser(definition, parseArgs, async (error): Promise<Result> => {
    throw error
  })
}

export const androidCoordinateSchema = z.number().finite().min(0).max(1_000_000)
export const androidSwipeDurationSchema = z.number().int().min(0).max(60_000).optional()
export const androidKeySchema = z.string().trim().min(1).max(64)
export const androidTextSchema = z.string().max(10_000)
export const androidPackageFilterSchema = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9._-]*$/)
  .optional()
export const androidDeviceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !/[\0\r\n]/.test(value), '设备 ID 包含非法控制字符')
export const androidApkPathSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => !value.includes('\0'), 'APK 路径包含非法控制字符')
  .refine((value) => path.isAbsolute(value), 'APK 路径必须是绝对路径')
  .refine((value) => value.toLowerCase().endsWith('.apk'), '只能安装 APK 文件')

export const scrcpyTouchSchema = z
  .object({
    action: z.number().int().min(0).max(2),
    x: androidCoordinateSchema,
    y: androidCoordinateSchema,
    pressure: z.number().finite().min(0).max(1),
  })
  .strict()

export const androidIpcContracts = {
  reconnect: bindLegacyNoArgs(androidIpc.reconnect),
  listPhysicalDevices: bindLegacyNoArgs(androidIpc.listPhysicalDevices),
  connectPhysical: bindAsyncParser(androidIpc.connectPhysical, (args) =>
    ipcArgs(androidDeviceIdSchema.parse(args[0])),
  ),
  disconnectPhysical: bindLegacyNoArgs(androidIpc.disconnectPhysical),
  retryStoreInstall: bindLegacyNoArgs(androidIpc.retryStoreInstall),
  tap: bindAsyncParser(androidIpc.tap, (args) =>
    ipcArgs(androidCoordinateSchema.parse(args[0]), androidCoordinateSchema.parse(args[1])),
  ),
  swipe: bindAsyncParser(androidIpc.swipe, (args) =>
    ipcArgs(
      androidCoordinateSchema.parse(args[0]),
      androidCoordinateSchema.parse(args[1]),
      androidCoordinateSchema.parse(args[2]),
      androidCoordinateSchema.parse(args[3]),
      androidSwipeDurationSchema.parse(args[4]),
    ),
  ),
  pressKey: bindAsyncParser(androidIpc.pressKey, (args) =>
    ipcArgs(androidKeySchema.parse(args[0])),
  ),
  typeText: bindAsyncParser(androidIpc.typeText, (args) =>
    ipcArgs(androidTextSchema.parse(args[0])),
  ),
  screenshot: bindLegacyNoArgs(androidIpc.screenshot),
  getDeviceInfo: bindLegacyNoArgs(androidIpc.getDeviceInfo),
  listPackages: bindAsyncParser(androidIpc.listPackages, (args) =>
    ipcArgs(androidPackageFilterSchema.parse(args[0])),
  ),
  getDeviceId: bindLegacyNoArgs(androidIpc.getDeviceId),
  dumpUi: bindLegacyNoArgs(androidIpc.dumpUi),
  installApk: bindAsyncParser(androidIpc.installApk, (args) =>
    ipcArgs(androidApkPathSchema.parse(args[0])),
  ),
  connectMirror: bindAsyncParser(androidIpc.connectMirror, (args) =>
    ipcArgs(androidDeviceIdSchema.parse(args[0])),
  ),
  disconnectMirror: bindLegacyNoArgs(androidIpc.disconnectMirror),
} as const
