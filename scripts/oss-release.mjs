#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const repository = {
  owner: 'AwsomeName',
  name: 'cclink-studio',
  workflow: 'release-oss.yml',
}
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stableVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/
const stableTagPattern = /^v(\d+\.\d+\.\d+)$/
const sourceCiWaitTimeoutMs = 45 * 60 * 1_000
const sourceCiPollIntervalMs = 10_000

export function parseArgs(argv) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const options = {
    version: '',
    patch: false,
    dispatchOnly: '',
    localArtifacts: false,
    yes: false,
    wait: true,
    help: false,
  }

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index]
    const value = normalizedArgv[index + 1]
    if (arg === '--version' && value) {
      options.version = value
      index += 1
    } else if (arg === '--patch') {
      options.patch = true
    } else if (arg === '--dispatch-only' && value) {
      options.dispatchOnly = value
      index += 1
    } else if (arg === '--local-artifacts') {
      options.localArtifacts = true
    } else if (arg === '--yes') {
      options.yes = true
    } else if (arg === '--no-wait') {
      options.wait = false
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`未知或不完整的参数: ${arg}`)
    }
  }

  if (options.help) return options
  if (options.dispatchOnly) {
    if (options.version || options.patch || options.localArtifacts) {
      throw new Error('--dispatch-only 不能与 --version、--patch 或 --local-artifacts 同时使用')
    }
    if (!stableTagPattern.test(options.dispatchOnly)) {
      throw new Error('--dispatch-only 必须使用 vX.Y.Z 格式')
    }
    return options
  }
  if (Boolean(options.version) === options.patch) {
    throw new Error('必须且只能提供 --patch 或 --version X.Y.Z')
  }
  if (options.version && !stableVersionPattern.test(options.version)) {
    throw new Error('--version 必须使用 X.Y.Z 格式')
  }
  return options
}

export function incrementPatch(version) {
  const match = stableVersionPattern.exec(version)
  if (!match) throw new Error(`当前版本不是稳定版本: ${version}`)
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

export function compareStableVersions(left, right) {
  const leftMatch = stableVersionPattern.exec(left)
  const rightMatch = stableVersionPattern.exec(right)
  if (!leftMatch || !rightMatch) throw new Error('版本比较只支持 X.Y.Z')
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index])
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

export function createWorkflowDispatchPayload(tag) {
  if (!stableTagPattern.test(tag)) throw new Error(`发布 Tag 格式错误: ${tag}`)
  return {
    ref: 'main',
    inputs: {
      tag,
      publish_release: true,
      failure_injection: 'none',
    },
  }
}

export function isRetryableGitHubStatus(status) {
  return status === 429 || status >= 500
}

export function resolveRemoteTagCommit(output, tag) {
  const refs = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(/\s+/, 2))
  const peeled = refs.find(([, ref]) => ref === `refs/tags/${tag}^{}`)
  const direct = refs.find(([, ref]) => ref === `refs/tags/${tag}`)
  const commit = peeled?.[0] ?? direct?.[0]
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`远端 Tag 不存在或引用无效: ${tag}`)
  }
  return commit
}

function usage() {
  console.log(`CCLink Studio 开源版发布

用法:
  pnpm release -- --patch
  pnpm release -- --version 0.1.3
  pnpm release -- --dispatch-only v0.1.3

选项:
  --patch                  当前版本的 patch +1
  --version X.Y.Z          指定更高的稳定版本
  --dispatch-only vX.Y.Z   仅重新触发已推送 Tag 的发布工作流
  --local-artifacts        推送前额外生成本地 ad-hoc DMG（默认不生成）
  --yes                    跳过交互确认
  --no-wait                触发 GitHub Actions 后立即返回
  -h, --help               显示帮助

脚本只从已通过 CI 的 main 创建版本提交；本地产物为显式可选项。
正式签名、公证和 DMG 统一由 GitHub Actions 从不可变 Tag 生成。
所有发布门禁通过后会自动公开稳定 Release。`)
}

function run(command, args, options = {}) {
  const { capture = false, input, quiet = false, allowFailure = false, cwd = projectRoot } = options
  if (!quiet) console.log(`\n$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    input,
    stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(
      `${command} ${args.join(' ')} 执行失败（退出码 ${result.status}）${
        detail ? `\n${detail}` : ''
      }`,
    )
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  }
}

function git(args, options = {}) {
  return run('git', args, options)
}

function readPackageAt(ref = 'HEAD') {
  return JSON.parse(git(['show', `${ref}:package.json`], { capture: true, quiet: true }).stdout)
}

export function prepareReleaseVersion(packagePath, targetVersion, mutationRunner) {
  const originalPackageText = readFileSync(packagePath, 'utf8')
  const packageJson = JSON.parse(originalPackageText)
  packageJson.version = targetVersion
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
  try {
    mutationRunner()
  } catch (error) {
    writeFileSync(packagePath, originalPackageText)
    throw error
  }
}

export function selectSuccessfulWorkflowRun(runs, sourceSha) {
  return runs.find(
    (run) =>
      run.head_sha === sourceSha &&
      run.head_branch === 'main' &&
      run.event === 'push' &&
      run.status === 'completed' &&
      run.conclusion === 'success',
  )
}

export function resolveSourceCiState(runs, sourceSha) {
  const run = runs.find(
    (candidate) =>
      candidate.head_sha === sourceSha &&
      candidate.head_branch === 'main' &&
      candidate.event === 'push',
  )
  if (!run) return { state: 'waiting', run: undefined }
  if (run.status !== 'completed') return { state: 'waiting', run }
  return run.conclusion === 'success' ? { state: 'success', run } : { state: 'failed', run }
}

export function isVersionOnlyPackageChange(before, after, targetVersion) {
  if (after.version !== targetVersion || before.version === targetVersion) return false
  return JSON.stringify(after) === JSON.stringify({ ...before, version: targetVersion })
}

export function assertReleaseSourceLease(expectedSourceSha, currentHead, remoteMain) {
  if (currentHead !== expectedSourceSha || remoteMain !== expectedSourceSha) {
    throw new Error(
      `发布源码在版本提交前发生漂移:\nexpected=${expectedSourceSha}\nHEAD=${currentHead}\norigin/main=${remoteMain}`,
    )
  }
}

export function assertReleaseCommitLease(expectedSourceSha, releaseParent, remoteMain) {
  if (releaseParent !== expectedSourceSha || remoteMain !== expectedSourceSha) {
    throw new Error(
      `发布源码在版本提交期间发生漂移:\nexpected parent=${expectedSourceSha}\nactual parent=${releaseParent}\norigin/main=${remoteMain}`,
    )
  }
}

function assertRepositoryRemote() {
  const remote = git(['remote', 'get-url', 'origin'], { capture: true, quiet: true }).stdout
  const expected = new RegExp(
    `github\\.com(?::|/)${repository.owner}/${repository.name}(?:\\.git)?$`,
    'i',
  )
  if (!expected.test(remote)) {
    throw new Error(`origin 不是 ${repository.owner}/${repository.name}: ${remote}`)
  }
}

function assertLatestMain() {
  assertRepositoryRemote()
  const branch = git(['branch', '--show-current'], { capture: true, quiet: true }).stdout
  if (branch !== 'main') throw new Error(`必须从 main 分支发布，当前分支是 ${branch || 'detached'}`)

  git(['fetch', 'origin', 'main', '--tags', '--prune'])
  const head = git(['rev-parse', 'HEAD'], { capture: true, quiet: true }).stdout
  const remoteMain = git(['rev-parse', 'origin/main'], { capture: true, quiet: true }).stdout
  if (head !== remoteMain) {
    throw new Error(`本地 main 不是最新远端基线:\nHEAD=${head}\norigin/main=${remoteMain}`)
  }

  const packageChanges = git(['status', '--porcelain', '--', 'package.json'], {
    capture: true,
    quiet: true,
  }).stdout
  if (packageChanges) {
    throw new Error(`package.json 存在未提交改动，无法创建纯版本提交:\n${packageChanges}`)
  }

  const ignoredChanges = git(['status', '--porcelain'], { capture: true, quiet: true }).stdout
  if (ignoredChanges) {
    console.log('\n当前工作区的其他未提交改动不会进入本次发布：')
    console.log(ignoredChanges)
  }
  return head
}

function getRemoteMainSha() {
  const output = git(['ls-remote', '--heads', 'origin', 'refs/heads/main'], {
    capture: true,
    quiet: true,
  }).stdout
  const sha = output.split(/\s+/, 1)[0]
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('无法读取远端 main SHA')
  return sha
}

function assertCurrentSourceLease(sourceSha) {
  const currentHead = git(['rev-parse', 'HEAD'], { capture: true, quiet: true }).stdout
  assertReleaseSourceLease(sourceSha, currentHead, getRemoteMainSha())
}

function acquireReleaseLock() {
  const gitCommonDir = git(['rev-parse', '--git-common-dir'], {
    capture: true,
    quiet: true,
  }).stdout
  const lockPath = resolve(projectRoot, gitCommonDir, 'cclink-release.lock')
  let fileDescriptor
  try {
    fileDescriptor = openSync(lockPath, 'wx', 0o600)
    writeFileSync(
      fileDescriptor,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    )
    closeSync(fileDescriptor)
  } catch (error) {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor)
    if (error?.code === 'EEXIST') {
      const holder = readFileSync(lockPath, 'utf8').trim()
      throw new Error(`已有正式发布正在占用仓库: ${holder || lockPath}`)
    }
    rmSync(lockPath, { force: true })
    throw error
  }
  console.log(`\n已获取发布锁: ${lockPath}`)
  return () => {
    rmSync(lockPath, { force: true })
  }
}

function assertTagAvailable(tag) {
  const localTag = git(['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], {
    capture: true,
    quiet: true,
    allowFailure: true,
  })
  if (localTag.status === 0) throw new Error(`本地 Tag 已存在: ${tag}`)

  const remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
    capture: true,
    quiet: true,
  }).stdout
  if (remoteTag) throw new Error(`远端 Tag 已存在: ${tag}`)
}

function assertRemoteTag(tag) {
  assertRepositoryRemote()
  git(['fetch', 'origin', 'main', '--tags', '--prune'])
  const remoteRefs = git(
    ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    {
      capture: true,
      quiet: true,
    },
  ).stdout
  const sourceSha = resolveRemoteTagCommit(remoteRefs, tag)

  const packageAtTag = JSON.parse(
    git(['show', `${sourceSha}:package.json`], { capture: true, quiet: true }).stdout,
  )
  if (`v${packageAtTag.version}` !== tag) {
    throw new Error(`Tag 与 package.json 版本不一致: ${tag} / ${packageAtTag.version}`)
  }
  return sourceSha
}

async function confirmRelease(tag, dispatchOnly, skipConfirmation) {
  const action = dispatchOnly
    ? `重新触发 ${tag} 的签名、公证和正式 Release`
    : `复用 main 的绿色 CI、创建 ${tag}、原子推送 main + Tag，并触发正式 Release`
  console.log(`\n即将执行: ${action}`)
  console.log('全部自动门禁通过后会公开稳定 Release。')
  if (skipConfirmation) return
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('非交互环境必须显式提供 --yes')
  }

  const phrase = dispatchOnly ? `dispatch ${tag}` : `release ${tag}`
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await prompt.question(`输入 "${phrase}" 继续: `)
    if (answer.trim() !== phrase) throw new Error('已取消发布')
  } finally {
    prompt.close()
  }
}

function getGitHubToken() {
  const credential = git(['credential', 'fill'], {
    capture: true,
    quiet: true,
    input: 'protocol=https\nhost=github.com\n\n',
  }).stdout
  const passwordLine = credential.split('\n').find((line) => line.startsWith('password='))
  const token = passwordLine?.slice('password='.length)
  if (!token) {
    throw new Error('未找到 GitHub 凭证；请先让 git 能正常访问 GitHub')
  }
  return token
}

async function githubRequest(path, token, options = {}) {
  const url = `https://api.github.com${path}`
  const maximumAttempts = 5
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      })
      if (response.ok) {
        if (response.status === 204) return undefined
        return response.json()
      }

      const body = await response.text()
      if (!isRetryableGitHubStatus(response.status) || attempt === maximumAttempts) {
        const requestError = new Error(`GitHub API ${response.status}: ${body.slice(0, 500)}`)
        requestError.retryable = false
        throw requestError
      }
      console.warn(`GitHub API ${response.status}，${attempt * 2} 秒后重试...`)
    } catch (error) {
      if (error?.retryable === false || attempt === maximumAttempts) throw error
      console.warn(`GitHub API 连接失败，${attempt * 2} 秒后重试...`)
    }
    await delay(attempt * 2_000)
  }
  throw new Error('GitHub API 请求失败')
}

async function dispatchWorkflow(tag, token) {
  await githubRequest(
    `/repos/${repository.owner}/${repository.name}/actions/workflows/${repository.workflow}/dispatches`,
    token,
    {
      method: 'POST',
      body: createWorkflowDispatchPayload(tag),
    },
  )
}

async function waitForSuccessfulSourceCi(sourceSha, token) {
  const deadline = Date.now() + sourceCiWaitTimeoutMs
  let previousState = ''
  while (Date.now() < deadline) {
    const response = await githubRequest(
      `/repos/${repository.owner}/${repository.name}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=50`,
      token,
    )
    const result = resolveSourceCiState(response.workflow_runs ?? [], sourceSha)
    if (result.state === 'success') {
      console.log(`\n已复用 main 源码 CI: ${result.run.html_url}`)
      return result.run
    }
    if (result.state === 'failed') {
      throw new Error(
        `main 当前源码 CI 未通过，不能发布: ${result.run.conclusion ?? 'unknown'}\n` +
          `SHA=${sourceSha}\n${result.run.html_url}`,
      )
    }

    assertCurrentSourceLease(sourceSha)
    const state = result.run ? `${result.run.status}/${result.run.conclusion ?? '-'}` : 'waiting'
    if (state !== previousState) {
      console.log(
        `\n等待 main 源码 CI: ${state}${result.run?.html_url ? `\n${result.run.html_url}` : ''}`,
      )
      previousState = state
    }
    await delay(sourceCiPollIntervalMs)
  }
  throw new Error(
    `等待 main 当前源码 CI 超时，不能发布:\nSHA=${sourceSha}\n` +
      `https://github.com/${repository.owner}/${repository.name}/actions/workflows/ci.yml`,
  )
}

function withReleaseWorktree(ref, callback) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'cclink-studio-release-'))
  const worktreePath = join(temporaryRoot, 'source')
  let worktreeAdded = false
  try {
    git(['worktree', 'add', '--detach', worktreePath, ref])
    worktreeAdded = true
    return callback(worktreePath)
  } finally {
    if (worktreeAdded) {
      git(['worktree', 'remove', '--force', worktreePath], {
        allowFailure: true,
        quiet: true,
      })
    }
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function copyLocalArtifacts(worktreePath) {
  const sourceDist = resolve(worktreePath, 'dist')
  const targetDist = resolve(projectRoot, 'dist')
  const artifacts = readdirSync(sourceDist).filter((name) => name.endsWith('.dmg'))
  if (artifacts.length === 0) throw new Error('本地验收打包未生成 DMG')
  mkdirSync(targetDist, { recursive: true })
  for (const name of artifacts) {
    copyFileSync(resolve(sourceDist, name), resolve(targetDist, name))
  }
  console.log('\n本地 ad-hoc 产物已复制到 dist/:')
  for (const name of artifacts) console.log(`  - ${name}`)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function waitForWorkflow({ sourceSha, token, startedAt }) {
  let run
  for (let attempt = 0; attempt < 30 && !run; attempt += 1) {
    const response = await githubRequest(
      `/repos/${repository.owner}/${repository.name}/actions/workflows/${repository.workflow}/runs?event=workflow_dispatch&branch=main&per_page=20`,
      token,
    )
    run = response.workflow_runs?.find(
      (candidate) =>
        candidate.head_sha === sourceSha &&
        new Date(candidate.created_at).getTime() >= startedAt - 10_000,
    )
    if (!run) await delay(5_000)
  }
  if (!run) throw new Error('工作流已触发，但 150 秒内未找到对应运行记录')

  console.log(`\nGitHub Actions: ${run.html_url}`)
  let previousState = ''
  const deadline = Date.now() + 90 * 60 * 1_000
  while (Date.now() < deadline) {
    const current = await githubRequest(
      `/repos/${repository.owner}/${repository.name}/actions/runs/${run.id}`,
      token,
    )
    const state = `${current.status}/${current.conclusion ?? '-'}`
    if (state !== previousState) {
      console.log(`[${new Date().toLocaleTimeString()}] ${state}`)
      previousState = state
    }
    if (current.status === 'completed') {
      if (current.conclusion !== 'success') {
        throw new Error(`发布工作流失败: ${current.html_url}`)
      }
      return current
    }
    await delay(15_000)
  }
  throw new Error(`等待发布工作流超时: ${run.html_url}`)
}

async function printReleaseSummary(tag, token) {
  const releases = await githubRequest(
    `/repos/${repository.owner}/${repository.name}/releases?per_page=30`,
    token,
  )
  const release = releases.find((candidate) => candidate.tag_name === tag)
  if (!release) {
    throw new Error(`工作流成功，但未找到 ${tag} 的公开 Release`)
  }
  if (release.draft || release.prerelease || !release.published_at) {
    throw new Error(`${tag} 未成为公开稳定 Release`)
  }
  console.log(`\nRelease: ${release.html_url}`)
  console.log(`资产数量: ${release.assets?.length ?? 0}`)
  for (const asset of release.assets ?? []) {
    console.log(`  - ${asset.name}`)
  }
  console.log('\n发布已公开，稳定通道可以发现该版本。')
}

async function release(options) {
  const releaseLock = acquireReleaseLock()
  try {
    const sourceSha = assertLatestMain()
    const currentVersion = readPackageAt(sourceSha).version
    const targetVersion = options.patch ? incrementPatch(currentVersion) : options.version
    if (compareStableVersions(targetVersion, currentVersion) <= 0) {
      throw new Error(`目标版本必须高于当前版本: ${currentVersion} -> ${targetVersion}`)
    }
    const tag = `v${targetVersion}`
    assertTagAvailable(tag)
    await confirmRelease(tag, false, options.yes)

    const token = getGitHubToken()
    await waitForSuccessfulSourceCi(sourceSha, token)
    assertCurrentSourceLease(sourceSha)

    const packagePath = resolve(projectRoot, 'package.json')
    prepareReleaseVersion(packagePath, targetVersion, () => {
      assertCurrentSourceLease(sourceSha)
      git(['diff', '--check', '--', 'package.json'])
      git(['commit', '--only', 'package.json', '-m', `chore: prepare ${tag}`])
    })
    const releaseSha = git(['rev-parse', 'HEAD'], { capture: true, quiet: true }).stdout
    const releaseParent = git(['rev-parse', `${releaseSha}^`], {
      capture: true,
      quiet: true,
    }).stdout
    assertReleaseCommitLease(sourceSha, releaseParent, getRemoteMainSha())
    const releaseChanges = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
      capture: true,
      quiet: true,
    }).stdout
    if (releaseChanges !== 'package.json') {
      throw new Error(`版本提交包含了 package.json 以外的文件:\n${releaseChanges}`)
    }
    if (
      !isVersionOnlyPackageChange(
        readPackageAt(`${releaseSha}^`),
        readPackageAt(releaseSha),
        targetVersion,
      )
    ) {
      throw new Error('版本提交修改了 package.json.version 以外的字段')
    }
    git(['tag', '-a', tag, '-m', `CCLink Studio 开源版 ${tag}`])
    withReleaseWorktree(releaseSha, (worktreePath) => {
      run(
        process.execPath,
        ['scripts/oss-release-preflight.mjs', '--source-dir', '.', '--tag', tag, '--mode', 'plan'],
        { cwd: worktreePath },
      )
      if (options.localArtifacts) {
        run('pnpm', ['install', '--frozen-lockfile'], { cwd: worktreePath })
        run('pnpm', ['package:local', '--', '--no-install'], { cwd: worktreePath })
        copyLocalArtifacts(worktreePath)
      }
    })
    const currentReleaseSha = git(['rev-parse', 'HEAD'], { capture: true, quiet: true }).stdout
    if (currentReleaseSha !== releaseSha) {
      throw new Error(
        `版本提交后本地 main 发生漂移:\nexpected=${releaseSha}\nHEAD=${currentReleaseSha}`,
      )
    }
    assertReleaseCommitLease(sourceSha, releaseParent, getRemoteMainSha())
    git(['push', '--atomic', 'origin', `${releaseSha}:refs/heads/main`, `refs/tags/${tag}`])

    const startedAt = Date.now()
    await dispatchWorkflow(tag, token)
    console.log(`\n已触发 ${tag} 的 release-oss 工作流。`)
    if (!options.wait) return
    await waitForWorkflow({ sourceSha: releaseSha, token, startedAt })
    await printReleaseSummary(tag, token)
  } finally {
    releaseLock()
  }
}

async function dispatchOnly(options) {
  const tag = options.dispatchOnly
  const sourceSha = assertRemoteTag(tag)
  await confirmRelease(tag, true, options.yes)
  const token = getGitHubToken()
  const startedAt = Date.now()
  await dispatchWorkflow(tag, token)
  console.log(`\n已重新触发 ${tag} 的 release-oss 工作流。`)
  if (!options.wait) return
  await waitForWorkflow({ sourceSha, token, startedAt })
  await printReleaseSummary(tag, token)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    usage()
    return
  }
  if (options.dispatchOnly) {
    await dispatchOnly(options)
  } else {
    await release(options)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n[CCLink Studio 发布失败] ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
