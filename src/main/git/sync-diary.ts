import { inspectDiaryConflicts, applyDiaryFeedback } from './diary-conflict'
import { mkdtemp, lstat, realpath, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import type { GitTransferInput, GitTransferSnapshot } from '../../shared/git'
import { workspaceSettingsPath } from '../../shared/workspace-settings'
import type { TransferContext } from './git-transfer'
import { findSensitiveFiles } from '../git-backup/git-backup-validation'
import {
  findForbiddenCclinkStudioPaths,
  inspectSharedTaskIndexDefinitions,
  inspectSharedTaskIndexSecrets,
  inspectSharedTaskOutgoingContent,
} from './cclink-studio-path-policy'

/** Prepare divergent merges off the live worktree. Only fast-forward the live branch. */
export async function syncDiary(
  root: string,
  url: string,
  input: GitTransferInput,
  ctx: TransferContext,
  flags: string[],
): Promise<GitTransferSnapshot> {
  const git = async (args: string[], cwd = root) =>
    (
      await ctx.runner.run(
        cwd,
        [
          ...flags,
          '--literal-pathspecs',
          '-c',
          'user.name=CCLink Studio',
          '-c',
          'user.email=diary@localhost',
          ...args,
        ],
        ctx.authentication,
      )
    ).stdout
  const value = async (args: string[], cwd = root) => (await git(args, cwd)).trim()
  const roots = [ctx.diary!.directory, ctx.diary!.planDirectory || '计划']
  if (roots.some((r) => r.split('/').some((p) => p.startsWith('.'))))
    throw Error('日记和计划目录不能位于隐藏目录')
  const listed = (s: string) => s.split('\0').filter(Boolean)
  const shareable = (p: string) =>
    roots.some((r) => p.startsWith(r + '/')) ||
    p === workspaceSettingsPath ||
    /^\.cclink-studio\/shared\/scheduled-tasks\/[\da-f-]+\.json$/i.test(p)
  const checkPaths = (paths: string[]) => {
    const refused = [
      ...paths.filter((p) => !shareable(p)),
      ...findSensitiveFiles(paths),
      ...findForbiddenCclinkStudioPaths(paths),
    ]
    if (refused.length) throw Error('同步范围外或包含私密文件：' + refused.slice(0, 4).join('、'))
  }
  const metadata = await lstat(join(root, '.git')).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') throw e
    return null
  })
  if (metadata && !metadata.isDirectory()) throw Error('请选择独立的日记仓库')
  if (!metadata) {
    if (await value(['rev-parse', '--show-toplevel'], dirname(root)).catch(() => ''))
      throw Error('日记目录位于另一个仓库内')
    await git(['init', '--initial-branch=main'])
  }
  if ((await realpath(await value(['rev-parse', '--show-toplevel']))) !== root)
    throw Error('日记目录发生变化')
  const branch = await value(['symbolic-ref', '--short', 'HEAD'])
  // Follow the configured upstream branch if present, otherwise the remote default.
  const refs = await git(['ls-remote', '--symref', '--', url, 'HEAD', 'refs/heads/*'])
  const configured = await value(['config', '--get', 'branch.' + branch + '.merge']).catch(() => '')
  const ref =
    configured || refs.match(/^ref: (refs\/heads\/[^\s]+)\s+HEAD$/m)?.[1] || 'refs/heads/' + branch
  if (!ref.startsWith('refs/heads/')) throw Error('项目分支无效')
  await git(['check-ref-format', ref])
  const remoteLine = refs.split('\n').find((l) => l.split('\t')[1] === ref)
  if (!remoteLine && refs.trim()) throw Error('同步分支已变化，请核对项目地址')
  const target = remoteLine?.split('\t')[0] || ''
  if (target) await git(['fetch', '--no-tags', '--no-recurse-submodules', '--', url, ref])
  if (target && (await value(['rev-parse', 'FETCH_HEAD'])) !== target)
    throw Error('另一台设备刚更新了内容，请继续同步')
  const staged = () => git(['diff', '--cached', '--no-renames', '--name-only', '-z', '--'])
  if (await git(['ls-files', '-u'])) throw Error('仓库中还有未完成的合并，请先处理')
  checkPaths(listed(await staged()))
  const scope = [...roots, workspaceSettingsPath, '.cclink-studio/shared/scheduled-tasks']
  const changed = async () => [
    ...new Set([
      ...listed(await git(['diff', '--no-renames', '--name-only', '-z', '--', ...scope])),
      ...listed(await git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...scope])),
    ]),
  ]
  const paths = await changed()
  checkPaths(paths)
  if (paths.length) await git(['add', '--', ...paths])
  const verifyIndex = async (cwd: string) => {
    const invalid = [
      ...(await inspectSharedTaskIndexSecrets(ctx.runner, cwd)),
      ...(await inspectSharedTaskIndexDefinitions(ctx.runner, cwd)),
    ]
    if (invalid.length) throw Error('项目设置或共享任务不适合共享：' + invalid.join('、'))
  }
  if (await staged()) {
    checkPaths(listed(await staged()))
    await verifyIndex(root)
    await git(['commit', '-m', '同步我的空间'])
  }
  let head = await value(['rev-parse', '--verify', 'HEAD']).catch(() => '')
  if (!head && !target) throw Error('空间里还没有可同步的内容')
  const snapshot = (conflict?: string): GitTransferSnapshot => ({
    workspacePath: root,
    remoteUrl: url,
    branch,
    head,
    target: target || head,
    checkedAt: new Date().toISOString(),
    changes: '',
    localChanges: '',
    diverged: !!conflict,
    conflict,
  })
  const ancestor = async (a: string, b: string) =>
    Boolean(
      await value(['merge-base', a, b])
        .then((v) => v === a)
        .catch(() => false),
    )
  if (target) {
    const incoming = listed(await git(['ls-tree', '-r', '--name-only', '-z', target]))
    if (findForbiddenCclinkStudioPaths(incoming).length)
      throw Error('远端包含本机私有状态，已暂停同步')
  }
  if (!head && target) {
    checkPaths(listed(await git(['ls-tree', '-r', '--name-only', '-z', target])))
    await git(['merge', '--ff-only', '--no-overwrite-ignore', target])
    head = target
  }
  if (target && head !== target && !(await ancestor(target, head))) {
    const base = await value(['merge-base', head, target]).catch(() => '')
    checkPaths(
      listed(
        await git(
          base
            ? ['diff', '--no-renames', '--name-only', '-z', base, target]
            : ['ls-tree', '-r', '--name-only', '-z', target],
        ),
      ),
    )
    const tmp = await mkdtemp(join(tmpdir(), 'studio-diary-'))
    const wt = join(tmp, 'review')
    try {
      await git(['worktree', 'add', '--detach', wt, head])
      try {
        await git(['merge', '--allow-unrelated-histories', '--no-edit', target], wt)
      } catch (error) {
        const run = (args: string[]) => git(args, wt)
        const conflicts = await inspectDiaryConflicts(wt, run)
        if (!conflicts.length) throw error
        const summary = conflicts
          .map(
            (c) =>
              c.path +
              '\n这台电脑：' +
              c.local.slice(0, 1600) +
              '\n另一份：' +
              c.remote.slice(0, 1600),
          )
          .join('\n\n')
        if (!input.feedback || input.expectedHead !== head || input.expectedTarget !== target)
          return snapshot(summary.slice(0, 24000))
        await applyDiaryFeedback(wt, conflicts, input.feedback, run, ctx.decide)
      }
      await verifyIndex(wt)
      const merged = await value(['rev-parse', 'HEAD'], wt)
      if (
        (await value(['rev-parse', 'HEAD'])) !== head ||
        (await changed()).length ||
        (await staged())
      )
        throw Error('同步期间本机内容有变化，请继续同步')
      await git(['merge', '--ff-only', '--no-overwrite-ignore', merged])
      head = merged
    } finally {
      await git(['worktree', 'remove', '--force', wt]).catch(() => {})
      await rm(tmp, { recursive: true, force: true })
    }
  }
  if (head !== target) {
    // Check every outgoing parent diff, including files since deleted.
    const outgoing = listed(
      await git([
        'log',
        '--format=',
        '--name-only',
        '--no-renames',
        '-m',
        '-z',
        target ? target + '..' + head : head,
      ]),
    )
    checkPaths(outgoing)
    const checked = await inspectSharedTaskOutgoingContent(ctx.runner, root, target || null)
    if (checked.sensitive.length || checked.invalid.length)
      throw Error('待上传历史包含私密或无效的共享设置')
    await git(['push', '--no-follow-tags', '--', url, head + ':' + ref])
  }
  const verified = await value(['ls-remote', '--', url, ref])
  if (
    verified.split('\t')[0] !== head ||
    (await value(['rev-parse', 'HEAD'])) !== head ||
    (await changed()).length ||
    (await staged())
  )
    throw Error('同步期间内容发生变化，请继续同步')
  return { ...snapshot(), target: head }
}
