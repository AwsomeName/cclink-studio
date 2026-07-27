#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const requireFromProject = createRequire(join(projectRoot, 'package.json'))
const SUPPORTED_ARCHES = new Set(['arm64', 'x64'])
const MANIFEST_SCHEMA_VERSION = 1

function parseArgs(argv) {
  const result = {
    arch: process.arch,
    output: join(projectRoot, '.agent-runtime-staging'),
    verifyOnly: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--arch') {
      const value = argv[index + 1]
      if (!value) throw new Error('--arch 需要 arm64、x64 或 universal')
      result.arch = value
      index += 1
      continue
    }
    if (arg === '--output') {
      const value = argv[index + 1]
      if (!value) throw new Error('--output 需要目录路径')
      result.output = resolve(projectRoot, value)
      index += 1
      continue
    }
    if (arg === '--verify-only') {
      result.verifyOnly = true
      continue
    }
    throw new Error(`未知参数: ${arg}`)
  }

  if (process.platform !== 'darwin') {
    throw new Error(`当前仅支持 macOS Claude Code 运行时 staging，实际平台: ${process.platform}`)
  }
  if (result.arch !== 'universal' && !SUPPORTED_ARCHES.has(result.arch)) {
    throw new Error(`不支持的目标架构: ${result.arch}`)
  }
  return result
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function runVersion(executablePath) {
  const { stdout, stderr } = await execFileAsync(executablePath, ['--version'], {
    timeout: 45_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
  })
  return `${stdout}\n${stderr}`.trim()
}

async function runVersionFromTemporaryCopy(executablePath) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'cclink-runtime-verify-'))
  const temporaryExecutable = join(temporaryRoot, 'claude')
  try {
    await copyFile(executablePath, temporaryExecutable)
    await chmod(temporaryExecutable, 0o755)
    return await runVersion(temporaryExecutable)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function platformPackageName(arch) {
  return `@anthropic-ai/claude-agent-sdk-darwin-${arch}`
}

function resolveSdkMetadata() {
  const sdkMainPath = requireFromProject.resolve('@anthropic-ai/claude-agent-sdk')
  const sdkRoot = dirname(sdkMainPath)
  return {
    sdkPackageJsonPath: join(sdkRoot, 'package.json'),
    requireFromSdk: createRequire(sdkMainPath),
  }
}

async function resolveSourceRuntime(arch, sdk) {
  const packageName = platformPackageName(arch)
  try {
    const packageJsonPath = sdk.requireFromSdk.resolve(`${packageName}/package.json`)
    const executablePath = sdk.requireFromSdk.resolve(`${packageName}/claude`)
    return {
      packageName,
      executablePath,
      packageMetadata: await readJson(packageJsonPath),
    }
  } catch (error) {
    throw new Error(
      `缺少 ${packageName}。请在目标架构机器安装锁定依赖，或显式安装该平台包后重试。原始错误: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

async function stageRuntime(outputRoot, arch, sdkMetadata, sdk) {
  const source = await resolveSourceRuntime(arch, sdk)
  if (source.packageMetadata.version !== sdkMetadata.version) {
    throw new Error(
      `Agent SDK 与平台包版本不一致: SDK ${sdkMetadata.version}, ${source.packageName} ${source.packageMetadata.version}`,
    )
  }

  const targetDir = join(outputRoot, `darwin-${arch}`)
  const targetExecutable = join(targetDir, 'claude')
  await mkdir(targetDir, { recursive: true })
  await copyFile(source.executablePath, targetExecutable)
  await chmod(targetExecutable, 0o755)

  const versionOutput = await runVersion(targetExecutable)
  const expectedClaudeVersion = sdkMetadata.claudeCodeVersion
  if (!expectedClaudeVersion || !versionOutput.includes(expectedClaudeVersion)) {
    throw new Error(
      `Claude Code 版本不一致: 期望 ${expectedClaudeVersion ?? '未知'}, 实际 ${versionOutput || '无输出'}`,
    )
  }

  const fileStat = await stat(targetExecutable)
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    source: 'anthropic-agent-sdk-platform-package',
    sdkPackage: '@anthropic-ai/claude-agent-sdk',
    sdkVersion: sdkMetadata.version,
    claudeCodePackage: source.packageName,
    claudeCodeVersion: expectedClaudeVersion,
    platform: 'darwin',
    arch,
    executable: 'claude',
    sha256: await sha256(targetExecutable),
    size: fileStat.size,
  }
  await writeJsonAtomic(join(targetDir, 'manifest.json'), manifest)
  return manifest
}

async function verifyRuntime(outputRoot, arch, sdkMetadata) {
  const targetDir = join(outputRoot, `darwin-${arch}`)
  const manifestPath = join(targetDir, 'manifest.json')
  const manifest = await readJson(manifestPath)
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`manifest schema 不支持: ${String(manifest.schemaVersion)}`)
  }
  if (
    manifest.platform !== 'darwin' ||
    manifest.arch !== arch ||
    manifest.sdkVersion !== sdkMetadata.version ||
    manifest.claudeCodeVersion !== sdkMetadata.claudeCodeVersion
  ) {
    throw new Error(`manifest 与目标环境或锁定 SDK 不一致: ${manifestPath}`)
  }
  if (manifest.executable !== 'claude') {
    throw new Error(`manifest executable 非法: ${String(manifest.executable)}`)
  }

  const executablePath = join(targetDir, manifest.executable)
  const fileStat = await stat(executablePath)
  if (!fileStat.isFile()) throw new Error(`Claude Code 运行时不是普通文件: ${executablePath}`)
  await access(executablePath, constants.X_OK)
  if (fileStat.size !== manifest.size)
    throw new Error(`Claude Code 运行时大小校验失败: ${executablePath}`)
  if ((await sha256(executablePath)) !== manifest.sha256) {
    throw new Error(`Claude Code 运行时 SHA-256 校验失败: ${executablePath}`)
  }
  const versionOutput = await runVersionFromTemporaryCopy(executablePath)
  if (!versionOutput.includes(manifest.claudeCodeVersion)) {
    throw new Error(`Claude Code 运行时版本校验失败: ${versionOutput || '无输出'}`)
  }
  return { manifest, executablePath }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const arches = options.arch === 'universal' ? ['arm64', 'x64'] : [options.arch]
  const sdk = resolveSdkMetadata()
  const sdkMetadata = await readJson(sdk.sdkPackageJsonPath)

  if (!options.verifyOnly) {
    await rm(options.output, { recursive: true, force: true })
    await mkdir(options.output, { recursive: true })
    for (const arch of arches) await stageRuntime(options.output, arch, sdkMetadata, sdk)
  }

  const summaries = []
  for (const arch of arches) {
    const result = await verifyRuntime(options.output, arch, sdkMetadata)
    summaries.push({
      arch,
      sdkVersion: result.manifest.sdkVersion,
      claudeCodeVersion: result.manifest.claudeCodeVersion,
      size: result.manifest.size,
      sha256: result.manifest.sha256,
      executablePath: result.executablePath,
    })
  }
  process.stdout.write(
    `${JSON.stringify({ output: options.output, runtimes: summaries }, null, 2)}\n`,
  )
}

main().catch((error) => {
  console.error(`[stage-claude-runtime] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
