#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

export function parseArgs(argv) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const options = {
    version: '',
    patch: false,
    dispatchOnly: '',
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
    if (options.version || options.patch) {
      throw new Error('--dispatch-only 不能与 --version 或 --patch 同时使用')
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
      create_draft: true,
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
  pnpm release:oss -- --patch
  pnpm release:oss -- --version 0.1.3
  pnpm release:oss -- --dispatch-only v0.1.3

选项:
  --patch                  当前版本的 patch +1
  --version X.Y.Z          指定更高的稳定版本
  --dispatch-only vX.Y.Z   仅重新触发已推送 Tag 的发布工作流
  --yes                    跳过交互确认
  --no-wait                触发 GitHub Actions 后立即返回
  -h, --help               显示帮助

脚本只创建 Draft Release，不会自动公开发布。`)
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
  return run('git', ['-c', 'http.version=HTTP/1.1', ...args], options)
}

function readPackage() {
  return JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'))
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

function assertCleanLatestMain() {
  assertRepositoryRemote()
  const branch = git(['branch', '--show-current'], { capture: true, quiet: true }).stdout
  if (branch !== 'main') throw new Error(`必须从 main 分支发布，当前分支是 ${branch || 'detached'}`)

  const dirty = git(['status', '--porcelain'], { capture: true, quiet: true }).stdout
  if (dirty) throw new Error(`工作树必须干净:\n${dirty}`)

  git(['fetch', 'origin', 'main', '--tags', '--prune'])
  const head = git(['rev-parse', 'HEAD'], { capture: true, quiet: true }).stdout
  const remoteMain = git(['rev-parse', 'origin/main'], { capture: true, quiet: true }).stdout
  if (head !== remoteMain) {
    throw new Error(`本地 main 不是最新远端基线:\nHEAD=${head}\norigin/main=${remoteMain}`)
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
    ? `重新触发 ${tag} 的签名、公证和 Draft Release`
    : `验证、提交、创建 ${tag}、原子推送 main + Tag，并触发 Draft Release`
  console.log(`\n即将执行: ${action}`)
  console.log('不会自动公开 Release。')
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

async function printDraftSummary(tag, token) {
  const releases = await githubRequest(
    `/repos/${repository.owner}/${repository.name}/releases?per_page=30`,
    token,
  )
  const release = releases.find((candidate) => candidate.tag_name === tag)
  if (!release) {
    console.log(`\n工作流成功，但未找到 ${tag} 的 Draft Release，请在 GitHub Releases 检查。`)
    return
  }
  console.log(`\nDraft Release: ${release.html_url}`)
  console.log(`资产数量: ${release.assets?.length ?? 0}`)
  for (const asset of release.assets ?? []) {
    console.log(`  - ${asset.name}`)
  }
  console.log('\n发布仍是 Draft；检查安装包后，再由维护者在 GitHub 点击 Publish release。')
}

async function release(options) {
  assertCleanLatestMain()
  const currentVersion = readPackage().version
  const targetVersion = options.patch ? incrementPatch(currentVersion) : options.version
  if (compareStableVersions(targetVersion, currentVersion) <= 0) {
    throw new Error(`目标版本必须高于当前版本: ${currentVersion} -> ${targetVersion}`)
  }
  const tag = `v${targetVersion}`
  assertTagAvailable(tag)
  await confirmRelease(tag, false, options.yes)

  run('pnpm', ['install', '--frozen-lockfile'])
  run('pnpm', ['verify'])
  run('pnpm', ['smoke:standalone'])

  const unexpectedChanges = git(['status', '--porcelain'], {
    capture: true,
    quiet: true,
  }).stdout
  if (unexpectedChanges) {
    throw new Error(`发布门禁产生了未预期的源码变更:\n${unexpectedChanges}`)
  }

  const packagePath = resolve(projectRoot, 'package.json')
  const packageJson = readPackage()
  packageJson.version = targetVersion
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
  git(['diff', '--check'])
  git(['add', 'package.json'])
  git(['commit', '-m', `chore: prepare ${tag}`])
  git(['tag', '-a', tag, '-m', `CCLink Studio 开源版 ${tag}`])
  run(process.execPath, [
    'scripts/oss-release-preflight.mjs',
    '--source-dir',
    '.',
    '--tag',
    tag,
    '--mode',
    'plan',
  ])
  git(['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`])

  const sourceSha = git(['rev-parse', 'HEAD'], { capture: true, quiet: true }).stdout
  const token = getGitHubToken()
  const startedAt = Date.now()
  await dispatchWorkflow(tag, token)
  console.log(`\n已触发 ${tag} 的 release-oss 工作流。`)
  if (!options.wait) return
  await waitForWorkflow({ sourceSha, token, startedAt })
  await printDraftSummary(tag, token)
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
  await printDraftSummary(tag, token)
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
