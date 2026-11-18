import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkspaceSettings, writeWorkspaceSettings } from './workspace-settings-files'
import { workspaceSettingsSchema } from '../../shared/workspace-settings'

const roots: string[] = []
const fixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'studio-settings-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
describe('portable workspace settings', () => {
  it('creates only configuration and preserves original content; detects stale edits', async () => {
    const root = await fixture()
    await writeFile(join(root, 'diary.md'), 'original')
    const settings = {
      version: 1 as const,
      name: '日记',
      type: 'diary' as const,
      diary: { directory: '旧资料', timezone: 'Asia/Shanghai', taskIds: [] },
    }
    const saved = await writeWorkspaceSettings(root, settings, null)
    expect(saved.status).toBe('saved')
    expect((await readWorkspaceSettings(root)).settings).toEqual(settings)
    const external = { ...settings, name: '外部更名' }
    await writeFile(join(root, '.cclink-studio/workspace-settings.json'), JSON.stringify(external))
    await expect(
      writeWorkspaceSettings(root, { ...settings, type: 'company' }, saved.revision),
    ).rejects.toThrow('修改')
    expect((await readWorkspaceSettings(root)).settings.name).toBe('外部更名')
    expect(await readFile(join(root, 'diary.md'), 'utf8')).toBe('original')
  })
  it('never replaces invalid or future configuration', async () => {
    const root = await fixture()
    await mkdir(join(root, '.cclink-studio'))
    const file = join(root, '.cclink-studio/workspace-settings.json')
    for (const text of ['{broken', JSON.stringify({ version: 99, type: 'future' })]) {
      await writeFile(file, text)
      const current = await readWorkspaceSettings(root)
      await expect(
        writeWorkspaceSettings(
          root,
          { version: 1, name: 'new', type: 'general' },
          current.revision,
        ),
      ).rejects.toThrow()
      expect(await readFile(file, 'utf8')).toBe(text)
    }
  })
  it('rejects file and metadata directory links without writing their targets', async () => {
    const root = await fixture()
    const target = await fixture()
    const file = join(target, 'settings.json')
    await writeFile(file, 'original')
    await mkdir(join(root, '.cclink-studio'))
    await symlink(file, join(root, '.cclink-studio/workspace-settings.json'))
    await expect(
      writeWorkspaceSettings(root, { version: 1, name: 'new', type: 'general' }, null),
    ).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('original')
    const linked = await fixture()
    await symlink(target, join(linked, '.cclink-studio'))
    await expect(
      writeWorkspaceSettings(linked, { version: 1, name: 'new', type: 'general' }, null),
    ).rejects.toThrow()
  })
  it('rejects credentials, absolute paths and traversal in shared configuration', () => {
    const base = { version: 1, name: '日记', type: 'diary' }
    expect(workspaceSettingsSchema.safeParse({ ...base, token: 'sensitive' }).success).toBe(false)
    for (const directory of ['/Users/old/diary', '../other', 'a/../../other', 'a\\other'])
      expect(
        workspaceSettingsSchema.safeParse({
          ...base,
          diary: { directory, timezone: 'Asia/Shanghai' },
        }).success,
      ).toBe(false)
  })
  it('preserves existing configuration when concurrent initializations race', async () => {
    const root = await fixture()
    const results = await Promise.allSettled(
      ['A', 'B'].map((name) =>
        writeWorkspaceSettings(root, { version: 1, name, type: 'general' }, null),
      ),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await readWorkspaceSettings(root)).status).toBe('saved')
  })
})
