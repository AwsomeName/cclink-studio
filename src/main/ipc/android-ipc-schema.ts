import path from 'node:path'
import { z } from 'zod'

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
