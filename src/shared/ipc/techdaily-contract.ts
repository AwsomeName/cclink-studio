import { z } from 'zod'
import { bindIpcParser, ipcArgs, type IpcInvokeDefinition } from './contract'
import { techDailyIpc } from './techdaily'
import {
  saveTechDailySettingsSchema,
  searxngConfigInputSchema,
  techDailyWorkspaceInputSchema,
  techDailyMonthInputSchema,
  techDailyDayInputSchema,
  techDailyGenerateInputSchema,
} from '../techdaily/techdaily-types'

function bind<Args extends unknown[], Result>(
  definition: IpcInvokeDefinition<Args, Result>,
  parseArgs: (args: unknown[]) => Args,
) {
  return bindIpcParser(
    definition,
    parseArgs,
    async () => ({ success: false, error: '科技日报参数无效' }) as Result,
  )
}

function one<T>(args: unknown[], schema: z.ZodType<T>): [T] {
  if (args.length !== 1) throw new Error('科技日报 IPC 需要且仅需要一个参数')
  return ipcArgs(schema.parse(args[0]))
}

export const techDailyIpcContracts = {
  getSettings: bind(techDailyIpc.getSettings, (args) => one(args, techDailyWorkspaceInputSchema)),
  saveSettings: bind(techDailyIpc.saveSettings, (args) => one(args, saveTechDailySettingsSchema)),
  getStatus: bind(techDailyIpc.getStatus, (args) => one(args, techDailyWorkspaceInputSchema)),
  getSearxng: bind(techDailyIpc.getSearxng, (args) => {
    if (args.length !== 0) throw new Error('不接受参数')
    return [] as []
  }),
  saveSearxng: bind(techDailyIpc.saveSearxng, (args) => one(args, searxngConfigInputSchema)),
  testSearxng: bind(techDailyIpc.testSearxng, (args) => one(args, searxngConfigInputSchema)),
  collect: bind(techDailyIpc.collect, (args) => one(args, techDailyWorkspaceInputSchema)),
  listMonth: bind(techDailyIpc.listMonth, (args) => one(args, techDailyMonthInputSchema)),
  getRun: bind(techDailyIpc.getRun, (args) => one(args, techDailyDayInputSchema)),
  generate: bind(techDailyIpc.generate, (args) => one(args, techDailyGenerateInputSchema)),
  stop: bind(techDailyIpc.stop, (args) => one(args, techDailyWorkspaceInputSchema)),
} as const
