import {
  updateCclinkStudioExcludeBlock,
  inspectCclinkStudioIndex,
} from './cclink-studio-path-policy'
import { app } from 'electron'
import { lstat, mkdir, mkdtemp, readdir, realpath, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, isAbsolute } from 'node:path'
import type { GitTransferInput, GitTransferSnapshot } from '../../shared/git'
import type { GitExecutor, GitAuthentication } from '../git-backup/git-executor'
import { syncDiary } from './sync-diary'
import { fastForwardIfClean } from './git-fast-forward'

export interface TransferContext {
  runner: Pick<GitExecutor, 'run'>
  authentication?: GitAuthentication
  diary?: { directory: string; planDirectory?: string }
  onDiaryAddress?: (url: string) => Promise<void>
  decide?: (prompt: string) => Promise<string>
  copyRoot?: string
}

/** Stateless execution helper. GitWorkspaceService owns authorization and operation exclusion. */
export async function transferRepository(
  input: GitTransferInput,
  context: TransferContext,
): Promise<GitTransferSnapshot> {
  const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const flags = [
    '-c',
    'core.quotepath=false',
    '-c',
    `core.hooksPath=${nullPath}`,
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'submodule.recurse=false',
  ]
  if (input.sshKeyPath) {
    if (
      !isAbsolute(input.sshKeyPath) ||
      (await lstat(input.sshKeyPath)).isSymbolicLink() ||
      !(await lstat(input.sshKeyPath)).isFile()
    )
      throw Error('请选择普通 SSH 私钥文件')
    const quote = (s: string): string => "'" + s.replaceAll("'", "'\\''") + "'"
    flags.push(
      '-c',
      `core.sshCommand=ssh -F ${nullPath} -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentityAgent=none -o IdentitiesOnly=yes -o AddKeysToAgent=no -o IgnoreUnknown=UseKeychain -o UseKeychain=no -i ${quote(input.sshKeyPath)}`,
    )
  }
  const run = async (cwd: string, args: string[]): Promise<string> =>
    (await context.runner.run(cwd, [...flags, ...args], context.authentication)).stdout.trim()
  const validateUrl = async (value: string): Promise<string> => {
    if (isAbsolute(value)) {
      const actual = await realpath(value)
      const home = await realpath(app.getPath('home'))
      const rel = relative(home, actual)
      if (rel.startsWith('..') || isAbsolute(rel)) throw Error('本地 Git 来源必须在用户目录中')
      return actual
    }
    if (
      (value.startsWith('ssh://') || value.startsWith('git@')) &&
      ['clone', 'fetch'].includes(input.action) &&
      !input.sshKeyPath
    )
      throw Error('SSH 拉取需要明确指定本机私钥；不会调用钥匙串或默认代理')
    if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/.test(value)) return value
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw Error('请输入 HTTPS 或 SSH 仓库地址')
    }
    if (
      !['https:', 'ssh:'].includes(url.protocol) ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === 'https:' && url.username)
    )
      throw Error('仓库地址不能包含密码、Token 或查询参数；请使用独立认证字段')
    return value
  }
  const createCopy = async (
    url: string,
    branch?: string,
    exactTarget?: string,
    from?: string,
  ): Promise<string> => {
    const home = await realpath(app.getPath('home'))
    const root = context.copyRoot ?? join(home, 'CCLinkStudio-Git')
    if (
      !isAbsolute(root) ||
      relative(home, root).startsWith('..') ||
      isAbsolute(relative(home, root))
    )
      throw Error('保存位置必须在用户目录中')
    await mkdir(root, { recursive: true })
    if ((await realpath(root)) !== root || (await lstat(root)).isSymbolicLink())
      throw Error('副本目录不能是符号链接')
    const container = await mkdtemp(join(root, 'diary-'))
    const destination = join(container, 'repository')
    try {
      if (from && exactTarget) {
        await run(container, [
          'clone',
          '--no-hardlinks',
          '--no-checkout',
          '--no-local',
          '--',
          from,
          destination,
        ])
        // Fetch the exact reviewed object from the local source; this never changes its worktree.
        await run(destination, ['fetch', '--no-tags', '--', from, exactTarget])
        await run(destination, ['checkout', '-B', branch!, exactTarget])
        await run(destination, ['remote', 'set-url', 'origin', url])
        await run(destination, ['config', `branch.${branch}.remote`, 'origin'])
        await run(destination, ['config', `branch.${branch}.merge`, `refs/heads/${branch}`])
      } else {
        await run(container, [
          'clone',
          '--no-hardlinks',
          '--no-local',
          ...(branch ? ['--branch', branch, '--single-branch'] : []),
          '--',
          url,
          destination,
        ])
      }
      const forbidden = await inspectCclinkStudioIndex(context.runner, destination)
      if (forbidden.length)
        throw Error(
          `仓库跟踪了不应跨设备接入的本机数据：${forbidden.join('、')}；请清理远程仓库后重新拉取`,
        )
      const excludes = join(destination, '.git/info/exclude')
      const existing = await readFile(excludes, 'utf8').catch(() => '')
      await writeFile(excludes, updateCclinkStudioExcludeBlock(existing), 'utf8')
      return await realpath(destination)
    } catch (error) {
      throw Error(
        `拉取失败，旧资料和当前连接保留。未完成副本在 ${container}。${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (
    input.branch &&
    (input.branch.startsWith('-') ||
      input.branch.includes('..') ||
      input.branch.endsWith('/') ||
      input.branch.includes('//'))
  )
    throw Error('分支名无效')
  const cloneInto = async (url: string, target: string, branch?: string): Promise<string> => {
    const home = await realpath(app.getPath('home'))
    if (!isAbsolute(target)) throw Error('本地目的地必须是绝对路径')
    const actual = await realpath(target)
    const rel = relative(home, actual)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('本地目的地必须在用户目录中')
    if (actual !== target || (await lstat(target)).isSymbolicLink())
      throw Error('本地目的地不能是符号链接')
    if (!(await lstat(target)).isDirectory()) throw Error('本地目的地不是目录')
    if ((await readdir(target)).length)
      throw Error('所选目录不是空目录；为保留现有内容，不会拉取到这里。请选择空目录或使用已有项目')
    try {
      await run(dirname(target), [
        'clone',
        '--no-hardlinks',
        '--no-local',
        ...(branch ? ['--branch', branch, '--single-branch'] : []),
        '--',
        url,
        target,
      ])
      const forbidden = await inspectCclinkStudioIndex(context.runner, target)
      if (forbidden.length)
        throw Error(
          `仓库跟踪了不应跨设备接入的本机数据：${forbidden.join('、')}；请清理远程仓库后重新拉取`,
        )
      const excludes = join(target, '.git/info/exclude')
      const existing = await readFile(excludes, 'utf8').catch(() => '')
      await writeFile(excludes, updateCclinkStudioExcludeBlock(existing), 'utf8')
      return target
    } catch (error) {
      throw Error(
        `拉取未完成，当前项目保持不变。所选目录 ${target} 可能留有部分内容，请检查后重试。${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (input.action === 'clone') {
    const url = await validateUrl(input.url ?? '')
    const path = input.destination
      ? await cloneInto(url, input.destination, input.branch || undefined)
      : await createCopy(url, input.branch || undefined)
    const branch = await run(path, ['symbolic-ref', '--short', 'HEAD'])
    const head = await run(path, ['rev-parse', 'HEAD'])
    return {
      workspacePath: path,
      remoteUrl: url,
      branch,
      head,
      target: head,
      checkedAt: new Date().toISOString(),
      changes: '',
      localChanges: '',
      diverged: false,
      newCopy: true,
    }
  }
  const path = await realpath(input.workspacePath!)
  if (input.action === 'diary-sync') {
    if (!context.diary) throw Error('请先完成我的空间设置')
    const address = await validateUrl(input.url ?? '')
    await context.onDiaryAddress?.(address)
    if ((address.startsWith('ssh://') || address.startsWith('git@')) && !input.sshKeyPath)
      throw Error('SSH 同步需要本次私钥路径')
    return syncDiary(path, address, input, context, flags)
  }
  const gitDirectory = join(path, '.git')
  if (!(await lstat(gitDirectory)).isDirectory() || (await realpath(gitDirectory)) !== gitDirectory)
    throw Error('此入口仅支持独立 Git 工作目录')
  if ((await realpath(await run(path, ['rev-parse', '--show-toplevel']))) !== path)
    throw Error('请连接 Git 仓库根目录')
  const branch = await run(path, ['symbolic-ref', '--short', 'HEAD'])
  let remote = 'origin'
  let remoteBranch = branch
  try {
    remote = await run(path, ['config', '--get', `branch.${branch}.remote`])
  } catch {
    /* default origin */
  }
  try {
    remoteBranch = (await run(path, ['config', '--get', `branch.${branch}.merge`])).replace(
      /^refs\/heads\//,
      '',
    )
  } catch {
    /* branch name */
  }
  if (
    !/^[A-Za-z0-9._/-]+$/.test(remote) ||
    remote === '.' ||
    remote.startsWith('-') ||
    !/^[A-Za-z0-9._/-]+$/.test(remoteBranch) ||
    remoteBranch.includes('..')
  )
    throw Error('上游配置不受支持，请核对原仓库配置')
  const url = await validateUrl(await run(path, ['remote', 'get-url', remote]))
  const tracking = `refs/remotes/${remote}/${remoteBranch}`
  if (input.action === 'fetch')
    await run(path, [
      'fetch',
      '--no-tags',
      '--no-recurse-submodules',
      '--',
      url,
      `refs/heads/${remoteBranch}:${tracking}`,
    ])
  const head = await run(path, ['rev-parse', 'HEAD'])
  let target = head
  try {
    target = await run(path, ['rev-parse', '--verify', tracking])
  } catch {
    if (input.action !== 'inspect') throw Error('尚无上游版本，请先检查远程更新')
  }
  const changes = await run(path, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--name-status',
    head,
    target,
    '--',
  ])
  const fullDiff = await run(path, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '--unified=3',
    head,
    target,
    '--',
  ])
  const diff = fullDiff.slice(0, 128 * 1024)
  const localChanges = await run(path, ['status', '--porcelain', '--untracked-files=all'])
  let diverged = false
  try {
    await run(path, ['merge-base', '--is-ancestor', head, target])
  } catch {
    diverged = true
  }
  if (input.action === 'pull') {
    // In place, fast-forward only, exactly the reviewed head → target (D4).
    if (!input.expectedHead || !input.expectedTarget) throw Error('请先检查远程更新并审阅差异')
    if (fullDiff.length > diff.length)
      throw Error('正文差异超过预览范围，请完整审阅后通过 Git 变更面板处理')
    const moved = await fastForwardIfClean(context.runner, path, {
      expectedHead: input.expectedHead,
      expectedTarget: input.expectedTarget,
    })
    if (moved.outcome === 'blocked') throw Error(`未更新，原资料已保留：${moved.reason}`)
    return {
      workspacePath: path,
      remoteUrl: url,
      branch,
      head: moved.head ?? target,
      target,
      changes,
      diff,
      diffTruncated: false,
      localChanges: '',
      diverged: false,
      checkedAt: new Date().toISOString(),
    }
  }
  if (input.action === 'update-copy') {
    if (head !== input.expectedHead || target !== input.expectedTarget)
      throw Error('预览版本已变化，请重新检查更新')
    if (fullDiff.length > diff.length)
      throw Error('正文差异超过预览范围，请完整审阅后通过原仓库处理')
    if (localChanges)
      throw Error('当前资料有未提交或未跟踪内容；请先处理本地变更后更新，原资料已保留')
    if (diverged) throw Error('本地有未上传提交或与远程历史分叉；请先处理分支，原资料已保留')
    const copy = await createCopy(url, remoteBranch, target, path)
    if (
      (await run(path, ['rev-parse', 'HEAD'])) !== head ||
      (await run(path, ['status', '--porcelain', '--untracked-files=all'])) !== localChanges
    )
      throw Error(`下载期间原目录发生变化，未切换资料。请重新审阅；已下载副本位于 ${copy}`)
    return {
      workspacePath: copy,
      remoteUrl: url,
      branch: remoteBranch,
      head: target,
      target,
      changes,
      diff,
      diffTruncated: fullDiff.length > diff.length,
      localChanges,
      diverged,
      newCopy: true,
      checkedAt: new Date().toISOString(),
    }
  }
  return {
    workspacePath: path,
    remoteUrl: url,
    branch,
    head,
    target,
    checkedAt: new Date().toISOString(),
    changes,
    diff,
    diffTruncated: fullDiff.length > diff.length,
    localChanges,
    diverged,
  }
}
