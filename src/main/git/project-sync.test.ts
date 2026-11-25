import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const state = vi.hoisted(() => ({ home: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.home } }))
import { GitExecutor } from '../git-backup/git-executor'
import { transferRepository } from './git-transfer'
import { literalIgnoreRule, updateProjectSyncExcludeBlock } from './project-sync-scope'
import { parseGitHubHttpsRepository } from '../../shared/git/project-sync'
import type { GitTransferInput } from '../../shared/git'

const exec = promisify(execFile)
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const git = async (cwd: string, args: string[]) =>
  (
    await exec('git', ['-c', 'credential.helper=', '-c', 'core.quotepath=false', ...args], {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    })
  ).stdout.trim()

/** Two “Macs” (folders) and one shared remote standing in for the private GitHub repository. */
async function twoComputers() {
  state.home = await realpath(await mkdtemp(join(tmpdir(), 'project-sync-')))
  roots.push(state.home)
  const remote = join(state.home, 'remote.git')
  await git(state.home, ['init', '--bare', '--initial-branch=main', remote])
  const first = join(state.home, '这台电脑', '蜗牛眼镜')
  const second = join(state.home, 'MacBook Air', '蜗牛眼镜')
  await mkdir(first, { recursive: true })
  await mkdir(join(state.home, 'MacBook Air'), { recursive: true })
  const context = { runner: new GitExecutor({ isolatedConfig: true }), project: {} }
  const sync = (path: string, extra: Partial<GitTransferInput> = {}) =>
    transferRepository(
      { action: 'project-sync', workspacePath: path, url: remote, ...extra },
      context,
    )
  return { remote, first, second, context, sync }
}

async function write(root: string, path: string, content: string | Buffer) {
  await mkdir(join(root, path, '..'), { recursive: true })
  await writeFile(join(root, path), content)
}

describe('project sync with real Git (ADR 0026)', { timeout: 60_000 }, () => {
  it('uploads the project minus large, secret, generated and private Studio files', async () => {
    const { first, remote, sync } = await twoComputers()
    await write(first, '产品资料/保修政策.md', '保修一年')
    await write(first, '设计/报价单.xlsx', Buffer.from([0, 1, 2, 3]))
    await write(
      first,
      '.cclink-studio/workspace-settings.json',
      '{"version":1,"name":"蜗牛眼镜","type":"company"}',
    )
    await write(first, '.cclink-studio/company-workspace/company.sqlite', 'db')
    await write(first, '.cclink-studio/project.json', '{"id":"x"}')
    await write(first, '.env', 'TOKEN=1')
    await write(first, 'node_modules/pkg/index.js', 'x')
    await write(first, '.DS_Store', 'x')
    await write(first, '视频/演示 [最终].mov', '')
    await truncate(join(first, '视频/演示 [最终].mov'), 50 * 1024 * 1024 + 1)

    const result = await sync(first)
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { path: '.env', reason: 'sensitive' },
        expect.objectContaining({ path: '视频/演示 [最终].mov', reason: 'large' }),
      ]),
    )
    const uploaded = (await git(remote, ['ls-tree', '-r', '--name-only', 'main'])).split('\n')
    expect(uploaded.sort()).toEqual(
      ['.cclink-studio/workspace-settings.json', '产品资料/保修政策.md', '设计/报价单.xlsx'].sort(),
    )
    expect(result.sent).toBe(3)
    // Nothing is left looking “pending” after the round.
    expect(await git(first, ['status', '--porcelain'])).toBe('')
  })

  it('downloads on the second computer and keeps both in step in both directions', async () => {
    const { first, second, remote, context, sync } = await twoComputers()
    await write(first, '推广稿件/双十一.md', '## 返场价\n699 元\n')
    await sync(first)

    const cloned = await transferRepository(
      { action: 'clone', url: remote, destination: (await mkdir(second), second) },
      context,
    )
    expect(cloned.newCopy).toBe(true)
    expect(await readFile(join(second, '推广稿件/双十一.md'), 'utf8')).toContain('699')

    await write(second, '客户/回访.md', '张先生满意')
    const fromSecond = await sync(second)
    expect(fromSecond.sent).toBe(1)

    const back = await sync(first)
    expect(back.received).toBe(1)
    expect(await readFile(join(first, '客户/回访.md'), 'utf8')).toBe('张先生满意')

    // Edits to different files on both sides merge without asking.
    await write(first, '推广稿件/双十一.md', '## 返场价\n659 元\n')
    await write(second, '客户/回访.md', '张先生满意，推荐朋友')
    await sync(second)
    const merged = await sync(first)
    expect(merged.conflict).toBeUndefined()
    await sync(second)
    expect(await readFile(join(second, '推广稿件/双十一.md'), 'utf8')).toContain('659')
    expect(await readFile(join(first, '客户/回访.md'), 'utf8')).toContain('推荐朋友')
  })

  it('pauses on a binary conflict and keeps both copies when asked', async () => {
    const { first, second, remote, context, sync } = await twoComputers()
    await write(first, '设计/报价单.xlsx', Buffer.from([1, 0, 1]))
    await sync(first)
    await mkdir(second)
    await transferRepository({ action: 'clone', url: remote, destination: second }, context)
    await write(second, '设计/报价单.xlsx', Buffer.from([2, 0, 2]))
    await sync(second)
    await write(first, '设计/报价单.xlsx', Buffer.from([3, 0, 3]))

    const paused = await sync(first)
    expect(paused.conflictFiles).toEqual([
      { path: '设计/报价单.xlsx', kind: 'file', hasLocal: true, hasRemote: true },
    ])
    // The live folder is untouched while paused.
    expect([...(await readFile(join(first, '设计/报价单.xlsx')))]).toEqual([3, 0, 3])

    await sync(first, {
      resolutions: { '设计/报价单.xlsx': 'both' },
      expectedHead: paused.head,
      expectedTarget: paused.target,
    })
    const files = await readdir(join(first, '设计'))
    expect(files).toHaveLength(2)
    const copy = files.find((f) => f.includes('（另一台 '))!
    expect([...(await readFile(join(first, '设计', copy)))]).toEqual([2, 0, 2])
    expect([...(await readFile(join(first, '设计/报价单.xlsx')))]).toEqual([3, 0, 3])
    await sync(second)
    expect((await readdir(join(second, '设计'))).sort()).toEqual(files.sort())
  })

  it('pauses before applying many deletions and can upload them again', async () => {
    const { first, second, remote, context, sync } = await twoComputers()
    for (let i = 0; i < 25; i++) await write(first, `资料/${i}.md`, String(i))
    await write(first, 'README.md', 'x')
    await sync(first)
    await mkdir(second)
    await transferRepository({ action: 'clone', url: remote, destination: second }, context)
    await rm(join(second, '资料'), { recursive: true })
    await sync(second)
    await write(first, 'README.md', 'y')

    const paused = await sync(first)
    expect(paused.pendingDeletions).toHaveLength(25)
    expect(await readdir(join(first, '资料'))).toHaveLength(25)

    await sync(first, {
      deletions: 'restore',
      expectedHead: paused.head,
      expectedTarget: paused.target,
    })
    expect(await readdir(join(first, '资料'))).toHaveLength(25)
    await sync(second)
    expect(await readdir(join(second, '资料'))).toHaveLength(25)
  })

  it('refuses a file that was synced before and has grown past 50 MB', async () => {
    const { first, sync } = await twoComputers()
    await write(first, '视频.mov', 'small')
    await sync(first)
    await truncate(join(first, '视频.mov'), 50 * 1024 * 1024 + 1)
    await expect(sync(first)).rejects.toThrow('超过 50 MB')
  })
})

describe('project sync addresses', () => {
  it('accepts only GitHub HTTPS repository addresses', () => {
    expect(parseGitHubHttpsRepository('https://github.com/zhangsan/woniu-company')).toEqual({
      owner: 'zhangsan',
      name: 'woniu-company',
      url: 'https://github.com/zhangsan/woniu-company.git',
    })
    expect(parseGitHubHttpsRepository('https://github.com/zhangsan/woniu.git')?.name).toBe('woniu')
    for (const bad of [
      'git@github.com:zhangsan/woniu.git',
      'https://gitlab.com/zhangsan/woniu.git',
      'https://token@github.com/zhangsan/woniu.git',
      'https://github.com/zhangsan/woniu.git?x=1',
      'https://github.com/zhangsan',
      '/Users/me/remote.git',
    ])
      expect(parseGitHubHttpsRepository(bad)).toBeNull()
  })

  it('writes skipped files as literal anchored ignore rules', () => {
    expect(literalIgnoreRule('视频/演示 [最终].mov')).toBe('/视频/演示 \\[最终\\].mov')
    const once = updateProjectSyncExcludeBlock('# mine\n', ['a.mov'])
    const twice = updateProjectSyncExcludeBlock(once, [])
    expect(once).toContain('/a.mov')
    expect(twice).not.toContain('/a.mov')
    expect(twice.match(/BEGIN CCLink Studio project sync/g)).toHaveLength(1)
    expect(twice).toContain('# mine')
  })
})
