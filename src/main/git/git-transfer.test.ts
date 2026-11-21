import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const state = vi.hoisted(() => ({ home: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.home } }))
import { GitExecutor } from '../git-backup/git-executor'
import { transferRepository } from './git-transfer'
import { gitTransferInputSchema } from '../../shared/git'
const exec = promisify(execFile)
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  state.home = await realpath(await mkdtemp(join(tmpdir(), 'diary-git-')))
  roots.push(state.home)
  const seed = join(state.home, 'seed')
  const remote = join(state.home, 'remote.git')
  await mkdir(seed)
  const git = async (cwd: string, args: string[]) =>
    (
      await exec('git', ['-c', 'credential.helper=', ...args], {
        cwd,
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      })
    ).stdout.trim()
  await git(seed, ['init', '--initial-branch=main'])
  await git(seed, ['config', 'user.name', 'Test'])
  await git(seed, ['config', 'user.email', 'test@example.invalid'])
  await writeFile(join(seed, '日记.md'), 'original')
  await git(seed, ['add', '.'])
  await git(seed, ['commit', '-m', 'initial'])
  await git(state.home, ['init', '--bare', '--initial-branch=main', remote])
  await git(seed, ['remote', 'add', 'origin', remote])
  await git(seed, ['push', '-u', 'origin', 'main'])
  const context = {
    runner: new GitExecutor({ isolatedConfig: true }),
    copyRoot: join(state.home, 'copies'),
  }
  return { seed, remote, git, context }
}
describe('Git diary transfer using real repositories', () => {
  it('clones exactly into the chosen empty directory and refuses non-empty or outside targets', async () => {
    const { remote, context } = await fixture()
    const chosen = join(state.home, '新电脑', '我的空间')
    await mkdir(chosen, { recursive: true })
    const cloned = await transferRepository(
      { action: 'clone', url: remote, destination: chosen },
      context,
    )
    expect(cloned).toMatchObject({ workspacePath: chosen, newCopy: true, branch: 'main' })
    expect(await readFile(join(chosen, '日记.md'), 'utf8')).toBe('original')
    const busy = join(state.home, '已有内容')
    await mkdir(busy)
    await writeFile(join(busy, '原文.md'), '保留')
    await expect(
      transferRepository({ action: 'clone', url: remote, destination: busy }, context),
    ).rejects.toThrow('不是空目录')
    expect(await readFile(join(busy, '原文.md'), 'utf8')).toBe('保留')
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'outside-')))
    roots.push(outside)
    await expect(
      transferRepository({ action: 'clone', url: remote, destination: outside }, context),
    ).rejects.toThrow('用户目录')
  })
  it('fetches and previews without changing originals, blocks dirty state and creates reviewed version in a separate copy', async () => {
    const { seed, remote, git, context } = await fixture()
    const first = await transferRepository({ action: 'clone', url: remote }, context)
    await writeFile(join(seed, '日记.md'), 'updated')
    await git(seed, ['add', '.'])
    await git(seed, ['commit', '-m', 'update'])
    await git(seed, ['push'])
    const preview = await transferRepository(
      { action: 'fetch', workspacePath: first.workspacePath },
      context,
    )
    expect(preview.changes).toContain('日记.md')
    expect(preview.diff).toContain('+updated')
    expect(await readFile(join(first.workspacePath, '日记.md'), 'utf8')).toBe('original')
    const apply = {
      action: 'update-copy' as const,
      workspacePath: first.workspacePath,
      expectedHead: preview.head,
      expectedTarget: preview.target,
    }
    await writeFile(join(first.workspacePath, '未上传.md'), 'keep')
    await expect(transferRepository(apply, context)).rejects.toThrow('未提交')
    await rm(join(first.workspacePath, '未上传.md'))
    await expect(
      transferRepository({ ...apply, expectedHead: '0'.repeat(40) }, context),
    ).rejects.toThrow('预览版本')
    const second = await transferRepository(apply, context)
    expect(second.workspacePath).not.toBe(first.workspacePath)
    expect(await readFile(join(second.workspacePath, '日记.md'), 'utf8')).toBe('updated')
    expect(await readFile(join(first.workspacePath, '日记.md'), 'utf8')).toBe('original')
    expect(await git(first.workspacePath, ['rev-parse', 'HEAD'])).toBe(preview.head)
    expect(await git(second.workspacePath, ['remote', 'get-url', 'origin'])).toBe(remote)
  }, 20000)
  it('rejects embedded credentials, implicit SSH identity, invalid options and cloned private runtime data', async () => {
    const { seed, remote, git, context } = await fixture()
    await expect(
      transferRepository(
        { action: 'clone', url: 'https://user:secret@example.invalid/repo.git' },
        context,
      ),
    ).rejects.toThrow('不能包含')
    await expect(
      transferRepository({ action: 'clone', url: 'git@example.invalid:repo.git' }, context),
    ).rejects.toThrow('指定')
    expect(() =>
      gitTransferInputSchema.parse({ action: 'clone', url: remote, branch: '--upload-pack=evil' }),
    ).toThrow()
    await mkdir(join(seed, '.cclink-studio'))
    await writeFile(join(seed, '.cclink-studio/project.json'), '{}')
    await git(seed, ['add', '.'])
    await git(seed, ['commit', '-m', 'unsafe state'])
    await git(seed, ['push'])
    await expect(transferRepository({ action: 'clone', url: remote }, context)).rejects.toThrow(
      '本机数据',
    )
  }, 20000)
})
