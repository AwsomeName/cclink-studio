import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument, isMap } from 'yaml'
import {
  TECHDAILY_DIRECTORY,
  TECHDAILY_SETTINGS_PATH,
  techDailySettingsSchema,
  type TechDailyOptions,
  type TechDailySettings,
  type TechDailySettingsSnapshot,
} from '../../shared/techdaily/techdaily-types'
import defaultSettingsSource from './default-settings.yaml?raw'

const MAX_SETTINGS_BYTES = 256 * 1024
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

export function countQueries(settings: TechDailySettings): number {
  return settings.domains.reduce((sum, d) => sum + d.queries.zh.length + d.queries.en.length, 0)
}

/** Parse YAML text; errors carry the line so the user can fix the file. */
export function parseTechDailySettings(text: string): TechDailySettings {
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length) throw Error(`设置.yaml 格式错误：${document.errors[0].message}`)
  const parsed = techDailySettingsSchema.safeParse(document.toJS() ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw Error(`设置.yaml 内容无效：${issue.path.join('.') || '根'} ${issue.message}`)
  }
  return parsed.data
}

export const defaultTechDailySettings = (): TechDailySettings =>
  parseTechDailySettings(defaultSettingsSource)

async function guardDirectory(root: string, create: boolean): Promise<void> {
  const directory = join(root, TECHDAILY_DIRECTORY)
  if (create) await mkdir(directory, { recursive: true })
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('科技日报目录不是普通目录')
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

async function readText(file: string): Promise<string> {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SETTINGS_BYTES)
    throw Error('设置.yaml 必须是 256 KB 以内的普通文件')
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

export async function readTechDailySettings(root: string): Promise<TechDailySettingsSnapshot> {
  const base = { workspacePath: root, filePath: TECHDAILY_SETTINGS_PATH }
  let text: string
  try {
    await guardDirectory(root, false)
    text = await readText(join(root, TECHDAILY_SETTINGS_PATH))
  } catch (error) {
    const settings = defaultTechDailySettings()
    if (isMissing(error))
      return {
        ...base,
        status: 'missing',
        settings,
        revision: null,
        queryCount: countQueries(settings),
      }
    return {
      ...base,
      status: 'invalid',
      settings,
      revision: null,
      error: String((error as Error).message ?? error),
      queryCount: countQueries(settings),
    }
  }
  try {
    const settings = parseTechDailySettings(text)
    return {
      ...base,
      status: 'saved',
      settings,
      revision: digest(text),
      queryCount: countQueries(settings),
    }
  } catch (error) {
    const settings = defaultTechDailySettings()
    return {
      ...base,
      status: 'invalid',
      settings,
      revision: digest(text),
      error: (error as Error).message,
      queryCount: countQueries(settings),
    }
  }
}

/** Apply the page's scalar options onto the YAML document, keeping comments and other keys. */
export function applyOptions(text: string, options: TechDailyOptions): string {
  const document = parseDocument(text)
  if (!isMap(document.contents)) throw Error('设置.yaml 顶层必须是键值表')
  for (const [key, value] of Object.entries(options)) document.set(key, value)
  const next = document.toString({ lineWidth: 0 })
  parseTechDailySettings(next)
  return next
}

/** Writes `科技日报/设置.yaml`; refuses when the file changed since `expectedRevision`. */
export async function writeTechDailyOptions(
  root: string,
  options: TechDailyOptions,
  expectedRevision: string | null,
): Promise<TechDailySettingsSnapshot> {
  const before = await readTechDailySettings(root)
  if (before.status === 'invalid')
    throw Error(`${before.error ?? '设置.yaml 无效'}；请先修正文件再保存`)
  if (before.revision !== expectedRevision) throw Error('科技日报设置已被修改，请重新加载后再保存')
  const file = join(root, TECHDAILY_SETTINGS_PATH)
  const source = before.status === 'missing' ? defaultSettingsSource : await readText(file)
  const data = applyOptions(source, options)
  await guardDirectory(root, true)
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o644)
  try {
    await handle.writeFile(data, 'utf8')
    await handle.sync()
    await handle.close()
    if (before.status === 'missing') {
      // Created by someone else meanwhile: do not overwrite it.
      const exists = await lstat(file).then(
        () => true,
        (error) => (isMissing(error) ? false : Promise.reject(error)),
      )
      if (exists) throw Error('科技日报设置刚被其他地方创建；未覆盖，请重新加载')
    } else {
      const current = await readText(file)
      if (digest(current) !== expectedRevision) throw Error('科技日报设置发生冲突；未覆盖外部修改')
    }
    await rename(temporary, file)
  } finally {
    await handle.close().catch(() => {})
    await unlink(temporary).catch(() => {})
  }
  return readTechDailySettings(root)
}
