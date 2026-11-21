import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitExecutor, GitAuthentication } from '../git-backup/git-executor'

const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null'
const safeFlags = [
  '-c',
  'core.quotepath=false',
  '-c',
  `core.hooksPath=${nullPath}`,
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'submodule.recurse=false',
]

export interface FastForwardResult {
  outcome: 'updated' | 'up-to-date' | 'blocked' | 'not-repository'
  head: string | null
  target: string | null
  reason?: string
}

/**
 * Fast-forwards the current branch to its upstream only when the worktree is clean and history
 * has not diverged. With `expected*`, the move must match what the user reviewed. Never merges,
 * rebases, resets or touches uncommitted content.
 */
export async function fastForwardIfClean(
  runner: Pick<GitExecutor, 'run'>,
  workspacePath: string,
  options: {
    fetch?: boolean
    expectedHead?: string
    expectedTarget?: string
    authentication?: GitAuthentication
    timeoutMs?: number
  } = {},
): Promise<FastForwardResult> {
  const root = await realpath(workspacePath)
  const gitDir = await lstat(join(root, '.git')).catch(() => null)
  if (!gitDir?.isDirectory()) return { outcome: 'not-repository', head: null, target: null }
  const run = async (args: string[]): Promise<string> =>
    (
      await runner.run(root, [...safeFlags, ...args], options.authentication, options.timeoutMs)
    ).stdout.trim()
  const branch = await run(['symbolic-ref', '--short', 'HEAD'])
  let remote = 'origin'
  let remoteBranch = branch
  try {
    remote = await run(['config', '--get', `branch.${branch}.remote`])
    remoteBranch = (await run(['config', '--get', `branch.${branch}.merge`])).replace(
      /^refs\/heads\//,
      '',
    )
  } catch {
    return { outcome: 'blocked', head: null, target: null, reason: '当前分支没有上游' }
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(remote) || remote.startsWith('-') || remoteBranch.includes('..'))
    return { outcome: 'blocked', head: null, target: null, reason: '上游配置不受支持' }
  const tracking = `refs/remotes/${remote}/${remoteBranch}`
  if (options.fetch)
    await run([
      'fetch',
      '--no-tags',
      '--no-recurse-submodules',
      remote,
      `refs/heads/${remoteBranch}:${tracking}`,
    ])
  const head = await run(['rev-parse', 'HEAD'])
  const target = await run(['rev-parse', '--verify', tracking])
  if (options.expectedHead && options.expectedHead !== head)
    return { outcome: 'blocked', head, target, reason: '本地版本已变化，请重新检查更新' }
  if (options.expectedTarget && options.expectedTarget !== target)
    return { outcome: 'blocked', head, target, reason: '远端版本已变化，请重新检查更新' }
  if (head === target) return { outcome: 'up-to-date', head, target }
  if (await run(['status', '--porcelain', '--untracked-files=all']))
    return { outcome: 'blocked', head, target, reason: '有未提交或未跟踪的本地内容' }
  try {
    await run(['merge-base', '--is-ancestor', head, target])
  } catch {
    return { outcome: 'blocked', head, target, reason: '本地有未上传提交或与远端分叉' }
  }
  await run(['merge', '--ff-only', '--no-edit', target])
  return { outcome: 'updated', head: target, target }
}
