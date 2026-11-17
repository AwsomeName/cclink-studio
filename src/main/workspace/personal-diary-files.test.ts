import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accessDiaryDocument } from './personal-diary-files'
import type { PersonalDiarySource } from '../../shared/personal-diary-source'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup(): Promise<PersonalDiarySource> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'diary-files-')))
  roots.push(root)
  await mkdir(join(root, '个人'))
  return {
    version: 1,
    workspacePath: root,
    projectId: 'test',
    directory: '个人',
    timezone: 'Asia/Shanghai',
    taskIds: [],
  }
}
describe('connected diary file access', () => {
  it('rolls into local new year and concurrent preparation creates only one blank original', async () => {
    const source = await setup()
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        accessDiaryDocument(source, { action: 'prepare' }, new Date('2026-12-31T17:00:00Z')),
      ),
    )
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(new Set(results.map((r) => r.path)).size).toBe(1)
    expect(results[0].path).toContain('/2027/01/0101_周五.md')
    await writeFile(results[0].path, '# 用户已开始写\n事实')
    const again = await accessDiaryDocument(
      source,
      { action: 'prepare' },
      new Date('2026-12-31T17:00:00Z'),
    )
    expect(again.created).toBe(false)
    expect(again.content).toBe('# 用户已开始写\n事实')
  })
  it('reads bounded Markdown and refuses traversal and symbolic links', async () => {
    const source = await setup()
    await writeFile(join(source.workspacePath, 'outside.md'), '外部')
    await symlink(
      join(source.workspacePath, 'outside.md'),
      join(source.workspacePath, '个人/link.md'),
    )
    await expect(
      accessDiaryDocument(source, { action: 'read', path: '个人/link.md' }),
    ).rejects.toThrow()
    await expect(
      accessDiaryDocument(source, { action: 'read', path: '个人/../outside.md' }),
    ).rejects.toThrow()
    await symlink(source.workspacePath, join(source.workspacePath, '个人/2027'))
    await expect(
      accessDiaryDocument(source, { action: 'prepare' }, new Date('2027-01-01')),
    ).rejects.toThrow()
    expect(await readFile(join(source.workspacePath, 'outside.md'), 'utf8')).toBe('外部')
  })
  it('keeps alternate old names and refuses to choose between multiple today files', async () => {
    const source = await setup()
    const date = new Date('2026-11-17T01:00:00Z')
    const folder = join(source.workspacePath, '个人/2026/11')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, '1117-周二.md'), '原记录')
    expect((await accessDiaryDocument(source, { action: 'prepare' }, date)).content).toBe('原记录')
    await writeFile(join(folder, '1117_周二.md'), '另一份')
    await expect(accessDiaryDocument(source, { action: 'prepare' }, date)).rejects.toThrow('多份')
  })
})
