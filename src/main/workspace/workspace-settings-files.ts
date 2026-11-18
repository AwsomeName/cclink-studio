import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  workspaceSettingsPath,
  workspaceSettingsSchema,
  type WorkspaceSettings,
  type WorkspaceSettingsSnapshot,
  type WorkspaceType,
} from '../../shared/workspace-settings'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

async function checkMetadata(root: string, create = false): Promise<void> {
  const directory = join(root, '.cclink-studio')
  if (create) await mkdir(directory, { recursive: true })
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error('项目配置目录不是普通目录，已保留原内容')
  } catch (error) {
    if (!missing(error)) throw error
  }
}

export async function readWorkspaceSettings(
  root: string,
  fallbackType: WorkspaceType = 'general',
): Promise<WorkspaceSettingsSnapshot> {
  const fallback: WorkspaceSettings = { version: 1, name: basename(root), type: fallbackType }
  try {
    await checkMetadata(root)
    const file = join(root, workspaceSettingsPath)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384)
      throw Error('项目设置必须是 16 KB 内的普通文件')
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    let text: string
    try {
      text = await handle.readFile('utf8')
    } finally {
      await handle.close()
    }
    const parsed = workspaceSettingsSchema.safeParse(JSON.parse(text))
    if (!parsed.success)
      return {
        workspacePath: root,
        settings: fallback,
        status: 'invalid',
        revision: digest(text),
        error: '项目设置格式或版本不支持；原配置已保留，可继续打开文件',
      }
    return { workspacePath: root, settings: parsed.data, revision: digest(text), status: 'saved' }
  } catch (error) {
    return {
      workspacePath: root,
      settings: fallback,
      revision: null,
      status: missing(error) ? 'missing' : 'unavailable',
      ...(missing(error) ? {} : { error: String(error) }),
    }
  }
}

/** Called inside WorkspaceStateService's per-workspace mutation queue. */
export async function writeWorkspaceSettings(
  root: string,
  settings: WorkspaceSettings,
  expectedRevision: string | null,
): Promise<WorkspaceSettingsSnapshot> {
  const value = workspaceSettingsSchema.parse(settings)
  const before = await readWorkspaceSettings(root)
  if (!['saved', 'missing'].includes(before.status)) throw Error(before.error || '原配置不可写')
  if (before.revision !== expectedRevision) throw Error('项目设置已被修改，请重新加载后再保存')
  await checkMetadata(root, true)
  const file = join(root, workspaceSettingsPath)
  const data = JSON.stringify(value, null, 2) + '\n'
  if (before.status === 'missing') {
    const handle = await open(file, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  } else {
    const temporary = `${file}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
      await handle.close()
      await checkMetadata(root)
      const current = await readWorkspaceSettings(root)
      if (current.status !== 'saved' || current.revision !== expectedRevision)
        throw Error('项目设置发生冲突；未覆盖外部修改')
      await rename(temporary, file)
    } finally {
      await handle.close().catch(() => {})
      await unlink(temporary).catch(() => {})
    }
  }
  return readWorkspaceSettings(root)
}
