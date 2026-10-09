import { z } from 'zod'
import { bindIpcParser, ipcArgs, type IpcInvokeDefinition } from './contract'
import { companyAccountsIpc } from './company-accounts'
import type { CompanyAccountsResult } from '../company-accounts/company-accounts-types'

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份格式应为 YYYY-MM')
const idSchema = z.string().trim().min(1).max(128)
const pathSchema = z
  .string()
  .trim()
  .min(1)
  .max(8_192)
  .refine((value) => !value.includes('\0'))
const shortTextSchema = z.string().trim().max(256)
const recordTypeSchema = z.enum(['income', 'expense', 'internal_transfer', 'refund'])
const directionSchema = z.enum(['income', 'expense'])
const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, '币种应为三个英文字母，例如 CNY')

const importSchema = z
  .object({ month: monthSchema, filePaths: z.array(pathSchema).min(1).max(100) })
  .strict()

const updateRecordSchema = z
  .object({
    recordId: idSchema,
    expectedVersion: z.number().int().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    recordType: recordTypeSchema,
    direction: directionSchema,
    amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency: currencySchema,
    account: shortTextSchema,
    counterparty: shortTextSchema,
    purpose: z.string().trim().max(2_000),
    category: shortTextSchema,
    projectId: idSchema.nullable(),
    documentIds: z.array(idSchema).max(100),
  })
  .strict()

const confirmRecordSchema = z
  .object({ recordId: idSchema, expectedVersion: z.number().int().min(1) })
  .strict()

const settingsSchema = z
  .object({
    month: monthSchema,
    companyName: z.string().trim().max(256),
    defaultCurrency: currencySchema,
  })
  .strict()

const monthDestinationSchema = z
  .object({ month: monthSchema, destinationDirectory: pathSchema })
  .strict()
const destinationSchema = z.object({ destinationDirectory: pathSchema }).strict()
const restoreSchema = z.object({ backupDirectory: pathSchema, month: monthSchema }).strict()

function invalidInput(error: unknown): CompanyAccountsResult<never> {
  const message =
    error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : '账目参数无效'
  return { success: false, error: { code: 'INVALID_INPUT', message } }
}

function bind<Args extends unknown[], Result>(
  definition: IpcInvokeDefinition<Args, Result>,
  parseArgs: (args: unknown[]) => Args,
) {
  return bindIpcParser(definition, parseArgs, async (error) => invalidInput(error) as Result)
}

function one<T>(args: unknown[], schema: z.ZodType<T>): [T] {
  if (args.length !== 1) throw new Error('账目 IPC 需要且仅需要一个参数')
  return ipcArgs(schema.parse(args[0]))
}

export const companyAccountsIpcContracts = {
  getSnapshot: bind(companyAccountsIpc.getSnapshot, (args) => one(args, monthSchema)),
  initialize: bind(companyAccountsIpc.initialize, (args) => one(args, monthSchema)),
  importFiles: bind(companyAccountsIpc.importFiles, (args) => one(args, importSchema)),
  updateRecord: bind(companyAccountsIpc.updateRecord, (args) => one(args, updateRecordSchema)),
  confirmRecord: bind(companyAccountsIpc.confirmRecord, (args) => one(args, confirmRecordSchema)),
  proposeRecord: bind(companyAccountsIpc.proposeRecord, (args) => one(args, idSchema)),
  createProject: bind(companyAccountsIpc.createProject, (args) =>
    one(args, z.string().trim().min(1).max(128)),
  ),
  updateSettings: bind(companyAccountsIpc.updateSettings, (args) => one(args, settingsSchema)),
  exportMonth: bind(companyAccountsIpc.exportMonth, (args) => one(args, monthDestinationSchema)),
  createBackup: bind(companyAccountsIpc.createBackup, (args) => one(args, destinationSchema)),
  restoreBackup: bind(companyAccountsIpc.restoreBackup, (args) => one(args, restoreSchema)),
} as const
