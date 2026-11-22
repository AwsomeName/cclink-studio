import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  diaryDateParts,
  diaryDayLocation,
  diaryDocumentInputSchema,
  type DiaryDocument,
  type DiaryDocumentInput,
  type PersonalDiarySource,
} from '../../shared/personal-diary-source'

/** Bounded access to the explicitly connected diary directory; never grants general cross-root fs access. */
export async function accessDiaryDocument(
  source: PersonalDiarySource,
  raw: DiaryDocumentInput,
  now = new Date(),
): Promise<DiaryDocument> {
  const input = diaryDocumentInputSchema.parse(raw)
  const root = await realpath(source.workspacePath)
  const ensureDirectory = async (parts: string[], create: boolean): Promise<string> => {
    let path = root
    for (const part of parts) {
      path = join(path, part)
      if (create)
        await mkdir(path).catch((e) => {
          if (e.code !== 'EEXIST') throw e
        })
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== path)
        throw Error('资料目录包含符号链接或不是普通目录')
    }
    return path
  }
  const base = await ensureDirectory(source.directory.split('/'), false)
  let path: string
  let created = false
  if (input.action === 'read') {
    if (!input.path.startsWith(source.directory + '/') || !input.path.toLowerCase().endsWith('.md'))
      throw Error('只能预览已连接目录内的 Markdown')
    const parts = input.path.split('/')
    const name = parts.pop()!
    path = join(await ensureDirectory(parts, false), name)
  } else {
    const date = diaryDateParts(source.timezone, now)
    const folder = await ensureDirectory(
      [...source.directory.split('/'), date.year, date.month],
      true,
    )
    const location = diaryDayLocation(date)
    const existing = (await readdir(folder)).filter(location.matchesName)
    if (existing.length > 1) throw Error('今天有多份日记，请在日记列表中选择原文件')
    path = join(folder, existing[0] ?? location.filename)
    if (!existing.length) {
      const template = `# ${date.year}-${date.month}-${date.day} ${date.weekday}\n\n今日体重：\n昨日睡眠：\n昨日花销：\nAI 剩余额度：\n昨日办公地点：\n昨日运动：\n昨日收入：\n昨日身体情况：\n\n## 昨日总结\n\n\n## 今日待做\n\n\n## 强调事项\n\n\n## 今日打卡\n\n按时间、事项、详细记录填写；尚未填写的事实保持空白。\n`
      try {
        const handle = await open(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        )
        try {
          await handle.writeFile(template, 'utf8')
          created = true
        } finally {
          await handle.close()
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
  }
  if (!relative(base, path) || relative(base, path).startsWith('..')) throw Error('资料路径越界')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw Error('资料不是普通文件')
    const limit = 128 * 1024
    const bytes = Buffer.alloc(Math.min(info.size, limit))
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    return {
      path,
      content: bytes.subarray(0, bytesRead).toString('utf8'),
      created,
      truncated: info.size > limit,
    }
  } finally {
    await handle.close()
  }
}
