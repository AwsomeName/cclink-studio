import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import {
  modelUsageRecordSchema,
  usageCategorySchema,
  usageConfigSchema,
  usageRunSchema,
} from '../../shared/model-usage'
import { ModelUsageStore } from './model-usage-store'
import { importTranscripts } from './model-usage-import'
import { buildReport, classified, exportCsv, formatReport, timeRange } from './model-usage-report'
import { APP_USER_DATA_DIR_NAME } from '../runtime/app-metadata'

const help = `Studio 模型用量 · 本地元数据统计（Node >=22.15）
  pnpm usage status
  pnpm usage report --month 2026-11
  pnpm usage report --day 2026-11-05 | --week 2026-11-05
  pnpm usage report --from 2026-11-01 --to 2026-12-01
  pnpm usage backfill                         # 仅 Studio 管理的 Claude projects 日志
  pnpm usage backfill --root /path/to/projects # 指定目录，包含 subagents
  pnpm usage export --month 2026-11 --format json --out usage.json
  pnpm usage export --all --format csv --out usage.csv
  pnpm usage import --file usage.json         # 跨机器汇总，重复导入幂等
  pnpm usage classify --task TASK_ID --category development
  pnpm usage classify --session SESSION_ID --category writing
  pnpm usage configure --file config.json     # enabled/taskCategories/sessionCategories/prices
  pnpm usage disable | enable                 # 下一个 Run 生效；在途 Run 记到结束
全局：--data-dir Studio的userData路径；--db 指定独立数据库
时间上界 --to 不包含；--week 为该日期所在周（周一开始）；默认本月。
类别：collection / analysis / daily-report / writing / development / other / unclassified。
回填可加 --provider 明确服务商标识、--category 显式类别；默认均未知。
CSV 的缺失字段为空；JSON 含原始 usage、来源、调用、运行与完整报告。
关闭统计不会删除数据，也不会关闭 Claude Code 自身的会话日志。`

export function defaultUserData(): string {
  if (process.env.CCLINK_USER_DATA_DIR) return resolve(process.env.CCLINK_USER_DATA_DIR)
  const base =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'))
  return join(base, APP_USER_DATA_DIR_NAME)
}
async function managedTranscriptRoots(dataDir: string): Promise<string[]> {
  const base = join(dataDir, 'runtime-components', 'claude-runtime')
  if (!existsSync(base)) return []
  return (await readdir(base, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(base, entry.name, 'config', 'projects'))
    .filter(existsSync)
}
const exchangeSchema = z
  .object({
    format: z.literal('cclink-model-usage-v1'),
    records: z.array(modelUsageRecordSchema),
    runs: z.array(usageRunSchema),
  })
  .passthrough()

export async function runUsageCli(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
      'data-dir': { type: 'string' },
      db: { type: 'string' },
      day: { type: 'string' },
      week: { type: 'string' },
      month: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      all: { type: 'boolean' },
      root: { type: 'string', multiple: true },
      provider: { type: 'string' },
      category: { type: 'string' },
      task: { type: 'string' },
      session: { type: 'string' },
      file: { type: 'string' },
      format: { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (values.help || !positionals.length) {
    console.log(help)
    return
  }
  if (positionals.length !== 1) throw new Error('只接受一个命令；使用 --help 查看')
  const command = positionals[0]
  const dataDir = resolve(values['data-dir'] ?? defaultUserData())
  const directory = join(dataDir, 'model-usage')
  const store = new ModelUsageStore(resolve(values.db ?? join(directory, 'usage.sqlite')))
  const emit = (value: unknown) => console.log(JSON.stringify(value, null, 2))
  try {
    if (command === 'enable' || command === 'disable') {
      store.configure((current) => ({ ...current, enabled: command === 'enable' }))
      console.log(
        `${command === 'enable' ? '已启用' : '已关闭'}模型用量采集（下一个 Run 生效）。数据：${store.path}`,
      )
    } else if (command === 'status') {
      const records = store.calls()
      const errorPath = join(directory, 'last-error.json')
      emit({
        enabled: store.config().enabled,
        environmentDisabled: process.env.CCLINK_MODEL_USAGE_ENABLED === '0',
        database: store.path,
        originId: store.originId,
        calls: records.length,
        earliest: records[0]?.timestamp ?? null,
        latest: records.at(-1)?.timestamp ?? null,
        lastRecordingError: existsSync(errorPath)
          ? JSON.parse(readFileSync(errorPath, 'utf8'))
          : null,
        transcriptRoots: await managedTranscriptRoots(dataDir),
        coverage:
          'Claude Code SDK + explicitly imported logs. Hidden HTTP retries and other backends may be absent.',
      })
    } else if (command === 'classify') {
      if (!values.category || Boolean(values.task) === Boolean(values.session))
        throw new Error('指定一个 task 或 session，并指定 category')
      const category = usageCategorySchema.parse(values.category)
      store.configure((current) =>
        values.task
          ? { ...current, taskCategories: { ...current.taskCategories, [values.task]: category } }
          : {
              ...current,
              sessionCategories: { ...current.sessionCategories, [values.session!]: category },
            },
      )
      console.log('分类已保存；报告立即生效，后续相同任务／会话继续使用。')
    } else if (command === 'configure') {
      if (!values.file) {
        emit(store.config())
        return
      }
      const config = usageConfigSchema.parse(JSON.parse(readFileSync(values.file, 'utf8')))
      store.configure(() => config)
      console.log('配置已保存；价格仅保留配置，未启用费用计算。')
    } else if (command === 'backfill') {
      const roots = values.root ?? (await managedTranscriptRoots(dataDir))
      if (!roots.length)
        throw new Error('没有找到 Studio 管理的会话日志；请使用 --root 指定 Claude projects 目录')
      const result = await importTranscripts(store, roots, {
        provider: values.provider,
        category: values.category ? usageCategorySchema.parse(values.category) : undefined,
      })
      emit(result)
      if (result.invalidLines || result.pendingLines || result.unidentifiable)
        console.warn('[ModelUsage] 部分日志未能导入；详情见计数，重复回填会重试未完成行。')
    } else if (command === 'import') {
      if (!values.file) throw new Error('请用 --file 指定本工具导出的 JSON')
      // Validate the entire envelope before the first write, including unknown body/credential fields.
      const exchange = exchangeSchema.parse(JSON.parse(readFileSync(values.file, 'utf8')))
      let inserted = 0
      for (const row of exchange.records) if (store.put(row)) inserted++
      for (const row of exchange.runs) store.putRun(row)
      emit({ inserted, replayed: exchange.records.length - inserted, runs: exchange.runs.length })
    } else if (command === 'report' || command === 'export') {
      if (
        values.all &&
        [values.day, values.week, values.month, values.from, values.to].some(Boolean)
      )
        throw new Error('--all 不能与时间范围同时使用')
      const range = values.all
        ? { from: '1970-01-01T00:00:00.000Z', to: '9999-01-01T00:00:00.000Z' }
        : timeRange({
            day: values.day,
            week: values.week,
            month: values.month,
            from: values.from,
            to: values.to,
          })
      const config = store.config()
      const records = store.calls()
      const runs = store.runs()
      const report = buildReport(records, runs, config, range)
      const selected = records
        .filter((row) => row.timestamp >= range.from && row.timestamp < range.to)
        .map((row) => classified(row, config))
      const selectedRunIds = new Set(selected.map((row) => row.runId))
      const format = values.format ?? (command === 'export' ? 'json' : 'text')
      if (!['json', 'csv', 'text'].includes(format)) throw new Error('format 支持 json、csv、text')
      if (command === 'export' && !values.out) throw new Error('export 必须用 --out 指定文件')
      const output =
        format === 'text'
          ? formatReport(report)
          : format === 'csv'
            ? exportCsv(selected)
            : JSON.stringify(
                {
                  format: 'cclink-model-usage-v1',
                  exportedBy: store.originId,
                  report,
                  records: selected,
                  runs: runs.filter(
                    (run) =>
                      selectedRunIds.has(run.id) ||
                      (run.startedAt >= range.from && run.startedAt < range.to),
                  ),
                },
                null,
                2,
              )
      if (values.out) {
        // Refuse accidental replacement; the user chooses a new export name.
        writeFileSync(resolve(values.out), output, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        console.log(`已导出 ${selected.length} 条调用：${resolve(values.out)}`)
      } else console.log(output)
    } else throw new Error(`未知命令：${command}；使用 --help 查看`)
  } finally {
    store.close()
  }
}
