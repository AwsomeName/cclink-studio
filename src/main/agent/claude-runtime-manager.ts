import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  BundledClaudeRuntimeManifest,
  ClaudeRuntimeErrorCode,
  ClaudeRuntimeFailure,
  ClaudeRuntimeProbeResult,
  ClaudeRuntimeSelection,
  ClaudeRuntimeStatus,
  ResolvedClaudeRuntime,
} from '../../shared/claude-runtime'
import { CLAUDE_NATIVE_SCHEDULING_POLICY_VERSION } from '../agent-core/backends/claude-native-scheduling-policy'
import { detectClaudeCode, type ClaudeCodeStatus } from './claude-code-detector'

const execFileAsync = promisify(execFile)
const MANIFEST_SCHEMA_VERSION = 1
const SHA256_RE = /^[a-f0-9]{64}$/

type SupportedArch = 'arm64' | 'x64'

export interface ClaudeRuntimeManagerOptions {
  bundledRoot: string
  materializedRoot?: string
  platform?: NodeJS.Platform
  arch?: string
  probeTimeoutMs?: number
  detectSystem?: () => Promise<ClaudeCodeStatus>
  resolveManaged?: (version: string) => Promise<{
    executablePath: string
    runtimeVersion: string
    sdkVersion: string
    sha256: string
  }>
  executeVersion?: (executablePath: string, timeoutMs: number) => Promise<string>
  now?: () => number
}

export class ClaudeRuntimeResolutionError extends Error {
  readonly code: ClaudeRuntimeErrorCode

  constructor(failure: ClaudeRuntimeFailure) {
    super(failure.message)
    this.name = 'ClaudeRuntimeResolutionError'
    this.code = failure.code
  }
}

export class ClaudeRuntimeManager {
  private readonly options: Required<
    Pick<ClaudeRuntimeManagerOptions, 'platform' | 'arch' | 'probeTimeoutMs' | 'now'>
  > &
    Omit<ClaudeRuntimeManagerOptions, 'platform' | 'arch' | 'probeTimeoutMs' | 'now'>
  private status: ClaudeRuntimeStatus

  constructor(options: ClaudeRuntimeManagerOptions) {
    const initialSelection: ClaudeRuntimeSelection = { source: 'system' }
    this.options = {
      ...options,
      platform: options.platform ?? process.platform,
      arch: options.arch ?? process.arch,
      probeTimeoutMs: options.probeTimeoutMs ?? 15_000,
      now: options.now ?? Date.now,
    }
    this.status = {
      state: 'unavailable',
      selection: initialSelection,
      active: null,
      pending: null,
      failure: null,
      generation: 0,
      updatedAt: this.options.now(),
    }
  }

  getStatus(): ClaudeRuntimeStatus {
    return structuredClone(this.status)
  }

  async initialize(selection: ClaudeRuntimeSelection): Promise<ResolvedClaudeRuntime> {
    return this.activate(selection)
  }

  async activate(selection: ClaudeRuntimeSelection): Promise<ResolvedClaudeRuntime> {
    const normalized = normalizeSelection(selection)
    this.status = {
      ...this.status,
      selection: normalized,
      pending: normalized,
      failure: null,
      updatedAt: this.options.now(),
    }

    const result = await this.probe(normalized)
    if (!result.success) {
      this.status = {
        ...this.status,
        state: this.status.active ? 'degraded' : stateForFailure(result.failure.code),
        pending: null,
        failure: result.failure,
        updatedAt: this.options.now(),
      }
      throw new ClaudeRuntimeResolutionError(result.failure)
    }

    this.commit(normalized, result.runtime)
    return result.runtime
  }

  commit(selection: ClaudeRuntimeSelection, runtime: ResolvedClaudeRuntime): void {
    const normalized = normalizeSelection(selection)
    if (normalized.source !== runtime.source) {
      throw new Error('Claude Code 运行时探测结果与待提交来源不一致')
    }
    this.status = {
      state: 'ready',
      selection: normalized,
      active: runtime,
      pending: null,
      failure: null,
      generation: this.status.generation + 1,
      updatedAt: this.options.now(),
    }
  }

  async probe(selection: ClaudeRuntimeSelection): Promise<ClaudeRuntimeProbeResult> {
    const normalized = normalizeSelection(selection)
    try {
      const runtime =
        normalized.source === 'bundled'
          ? await this.resolveBundled()
          : normalized.source === 'managed'
            ? await this.resolveManaged(normalized.version)
            : normalized.source === 'custom'
              ? await this.resolveCustom(normalized.customPath)
              : await this.resolveSystem()
      return { success: true, runtime }
    } catch (error) {
      return { success: false, failure: toFailure(error, normalized.source) }
    }
  }

  dispose(): void {
    this.status = {
      ...this.status,
      state: 'unavailable',
      active: null,
      pending: null,
      failure: null,
      updatedAt: this.options.now(),
    }
  }

  reportFailure(failure: ClaudeRuntimeFailure): void {
    this.status = {
      ...this.status,
      state: this.status.active ? 'degraded' : stateForFailure(failure.code),
      failure,
      updatedAt: this.options.now(),
    }
  }

  private async resolveBundled(): Promise<ResolvedClaudeRuntime> {
    if (this.options.platform !== 'darwin') {
      throw failure('RUNTIME_ARCH_MISMATCH', `内置 Claude Code 不支持 ${this.options.platform}`)
    }
    if (!isSupportedArch(this.options.arch)) {
      throw failure('RUNTIME_ARCH_MISMATCH', `内置 Claude Code 不支持 ${this.options.arch} 架构`)
    }

    const runtimeRoot = resolve(this.options.bundledRoot, `darwin-${this.options.arch}`)
    const manifestPath = join(runtimeRoot, 'manifest.json')
    let manifest: BundledClaudeRuntimeManifest
    try {
      manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
    } catch (error) {
      if (isMissingFile(error)) {
        throw failure('BUNDLED_RUNTIME_MISSING', `内置 Claude Code 清单不存在: ${manifestPath}`)
      }
      if (isRuntimeFailure(error)) throw error
      throw failure(
        'BUNDLED_RUNTIME_INTEGRITY_FAILED',
        `内置 Claude Code 清单无效: ${describeError(error)}`,
      )
    }

    if (manifest.platform !== this.options.platform || manifest.arch !== this.options.arch) {
      throw failure(
        'RUNTIME_ARCH_MISMATCH',
        `内置 Claude Code 架构不匹配: ${manifest.platform}-${manifest.arch}`,
      )
    }

    const executablePath = resolve(runtimeRoot, manifest.executable)
    assertInside(runtimeRoot, executablePath)
    const fileStat = await assertExecutable(executablePath, 'BUNDLED_RUNTIME_MISSING')
    if (fileStat.size !== manifest.size) {
      throw failure('BUNDLED_RUNTIME_INTEGRITY_FAILED', '内置 Claude Code 文件大小校验失败')
    }
    const digest = await sha256(executablePath)
    if (digest !== manifest.sha256) {
      throw failure('BUNDLED_RUNTIME_INTEGRITY_FAILED', '内置 Claude Code SHA-256 校验失败')
    }
    const runnablePath = this.options.materializedRoot
      ? await materializeBundledRuntime(executablePath, this.options.materializedRoot, manifest)
      : executablePath
    const versionOutput = await this.executeVersion(runnablePath)
    if (!versionOutput.includes(manifest.claudeCodeVersion)) {
      throw failure(
        'RUNTIME_VERSION_MISMATCH',
        `内置 Claude Code 版本不匹配: 期望 ${manifest.claudeCodeVersion}`,
      )
    }

    return {
      source: 'bundled',
      executablePath: runnablePath,
      claudeCodeVersion: manifest.claudeCodeVersion,
      sdkVersion: manifest.sdkVersion,
      fingerprint: fingerprint([
        'bundled',
        manifest.sdkVersion,
        manifest.claudeCodeVersion,
        manifest.sha256,
        manifest.arch,
      ]),
      integrity: 'manifest-sha256',
      probedAt: this.options.now(),
    }
  }

  private async resolveSystem(): Promise<ResolvedClaudeRuntime> {
    const detected = await (this.options.detectSystem ?? (() => detectClaudeCode()))()
    if (!detected.installed || !detected.path) {
      throw failure('SYSTEM_RUNTIME_NOT_FOUND', detected.error ?? '未找到系统 Claude Code')
    }
    return this.resolveFilesystemRuntime('system', detected.path)
  }

  private async resolveManaged(version: string): Promise<ResolvedClaudeRuntime> {
    if (!this.options.resolveManaged) {
      throw failure('MANAGED_RUNTIME_MISSING', 'Studio 管理的 Claude Runtime 服务未初始化')
    }
    let resolved: Awaited<ReturnType<NonNullable<ClaudeRuntimeManagerOptions['resolveManaged']>>>
    try {
      resolved = await this.options.resolveManaged(version)
    } catch (error) {
      throw failure('MANAGED_RUNTIME_INTEGRITY_FAILED', describeError(error))
    }
    if (resolved.runtimeVersion !== version) {
      throw failure(
        'RUNTIME_VERSION_MISMATCH',
        `Studio 管理的 Claude Runtime 版本不匹配：期望 ${version}`,
      )
    }
    const versionOutput = await this.executeVersion(resolved.executablePath)
    if (!versionOutput.includes(version)) {
      throw failure('RUNTIME_VERSION_MISMATCH', `Claude Runtime 版本不匹配：期望 ${version}`)
    }
    return {
      source: 'managed',
      executablePath: resolved.executablePath,
      claudeCodeVersion: resolved.runtimeVersion,
      sdkVersion: resolved.sdkVersion,
      fingerprint: fingerprint([
        'managed',
        resolved.sdkVersion,
        resolved.runtimeVersion,
        resolved.sha256,
      ]),
      integrity: 'catalog-sha256',
      probedAt: this.options.now(),
    }
  }

  private async resolveCustom(configuredPath: string): Promise<ResolvedClaudeRuntime> {
    const expanded = expandHome(configuredPath.trim())
    if (!expanded || !isAbsolute(expanded)) {
      throw failure('CUSTOM_RUNTIME_INVALID', '自定义 Claude Code 路径必须是绝对路径')
    }
    return this.resolveFilesystemRuntime('custom', expanded)
  }

  private async resolveFilesystemRuntime(
    source: 'system' | 'custom',
    candidatePath: string,
  ): Promise<ResolvedClaudeRuntime> {
    let executablePath: string
    try {
      executablePath = await realpath(candidatePath)
    } catch (error) {
      throw failure(
        source === 'custom' ? 'CUSTOM_RUNTIME_INVALID' : 'SYSTEM_RUNTIME_NOT_FOUND',
        `${source === 'custom' ? '自定义' : '系统'} Claude Code 路径不可用: ${describeError(error)}`,
      )
    }
    const fileStat = await assertExecutable(
      executablePath,
      source === 'custom' ? 'CUSTOM_RUNTIME_INVALID' : 'SYSTEM_RUNTIME_NOT_FOUND',
    )
    const versionOutput = await this.executeVersion(executablePath)
    const claudeCodeVersion = parseVersion(versionOutput)
    return {
      source,
      executablePath,
      claudeCodeVersion,
      fingerprint: fingerprint([
        source,
        executablePath,
        claudeCodeVersion,
        String(fileStat.size),
        String(fileStat.mtimeMs),
      ]),
      integrity: 'filesystem-probe',
      probedAt: this.options.now(),
    }
  }

  private async executeVersion(executablePath: string): Promise<string> {
    try {
      const output = this.options.executeVersion
        ? await this.options.executeVersion(executablePath, this.options.probeTimeoutMs)
        : await defaultExecuteVersion(executablePath, this.options.probeTimeoutMs)
      if (!output.trim()) throw new Error('版本命令没有输出')
      return output.trim()
    } catch (error) {
      if (isTimeoutError(error)) {
        throw failure('RUNTIME_PROBE_TIMEOUT', 'Claude Code 运行时探测超时')
      }
      if (isRuntimeFailure(error)) throw error
      throw failure('RUNTIME_NOT_EXECUTABLE', `Claude Code 无法执行: ${describeError(error)}`)
    }
  }
}

export function buildClaudeSessionCompatibilityFingerprint(
  runtimeFingerprint: string,
  settings: { apiFormat?: string; apiBaseUrl?: string; modelName?: string },
): string {
  return fingerprint([
    runtimeFingerprint,
    `native-scheduling-policy:${CLAUDE_NATIVE_SCHEDULING_POLICY_VERSION}`,
    settings.apiFormat?.trim() ?? '',
    settings.apiBaseUrl?.trim() ?? '',
    settings.modelName?.trim() ?? '',
  ])
}

async function materializeBundledRuntime(
  sourcePath: string,
  materializedRoot: string,
  manifest: BundledClaudeRuntimeManifest,
): Promise<string> {
  const versionDirectory = join(
    resolve(materializedRoot),
    `${manifest.platform}-${manifest.arch}`,
    `${manifest.sdkVersion}-${manifest.claudeCodeVersion}-${manifest.sha256.slice(0, 16)}`,
  )
  const executablePath = join(versionDirectory, manifest.executable)
  await mkdir(versionDirectory, { recursive: true, mode: 0o700 })

  if (await matchesManifest(executablePath, manifest)) {
    await chmod(executablePath, 0o700)
    return executablePath
  }

  const temporaryPath = join(versionDirectory, `.claude-${process.pid}-${randomUUID()}`)
  try {
    await copyFile(sourcePath, temporaryPath, constants.COPYFILE_EXCL)
    await chmod(temporaryPath, 0o700)
    if (!(await matchesManifest(temporaryPath, manifest))) {
      throw failure('BUNDLED_RUNTIME_INTEGRITY_FAILED', '内置 Claude Code 缓存副本校验失败')
    }
    await rename(temporaryPath, executablePath)
    await chmod(executablePath, 0o700)
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return executablePath
}

async function matchesManifest(
  executablePath: string,
  manifest: BundledClaudeRuntimeManifest,
): Promise<boolean> {
  try {
    const fileStat = await stat(executablePath)
    return (
      fileStat.isFile() &&
      fileStat.size === manifest.size &&
      (await sha256(executablePath)) === manifest.sha256
    )
  } catch {
    return false
  }
}

function normalizeSelection(selection: ClaudeRuntimeSelection): ClaudeRuntimeSelection {
  if (selection.source === 'custom') {
    return { source: 'custom', customPath: selection.customPath.trim() }
  }
  if (selection.source === 'managed') {
    return { source: 'managed', version: selection.version.trim() }
  }
  return { source: selection.source }
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function isSupportedArch(value: string): value is SupportedArch {
  return value === 'arm64' || value === 'x64'
}

function parseManifest(value: unknown): BundledClaudeRuntimeManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw failure('BUNDLED_RUNTIME_INTEGRITY_FAILED', '内置 Claude Code 清单不是对象')
  }
  const manifest = value as Partial<BundledClaudeRuntimeManifest>
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    manifest.source !== 'anthropic-agent-sdk-platform-package' ||
    manifest.sdkPackage !== '@anthropic-ai/claude-agent-sdk' ||
    typeof manifest.sdkVersion !== 'string' ||
    typeof manifest.claudeCodePackage !== 'string' ||
    typeof manifest.claudeCodeVersion !== 'string' ||
    manifest.platform !== 'darwin' ||
    !isSupportedArch(manifest.arch ?? '') ||
    manifest.executable !== 'claude' ||
    typeof manifest.sha256 !== 'string' ||
    !SHA256_RE.test(manifest.sha256) ||
    typeof manifest.size !== 'number' ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size <= 0
  ) {
    throw failure('BUNDLED_RUNTIME_INTEGRITY_FAILED', '内置 Claude Code 清单字段无效')
  }
  return manifest as BundledClaudeRuntimeManifest
}

async function assertExecutable(path: string, code: ClaudeRuntimeErrorCode) {
  try {
    const fileStat = await stat(path)
    if (!fileStat.isFile()) throw new Error('目标不是普通文件')
    await access(path, constants.X_OK)
    return fileStat
  } catch (error) {
    throw failure(code, `Claude Code 不可执行: ${describeError(error)}`)
  }
}

function assertInside(root: string, path: string): void {
  const child = relative(root, path)
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    if (!child) return
    throw failure('BUNDLED_RUNTIME_INTEGRITY_FAILED', '内置 Claude Code 路径越界')
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function defaultExecuteVersion(executablePath: string, timeoutMs: number): Promise<string> {
  const { stdout, stderr } = await execFileAsync(executablePath, ['--version'], {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
  })
  return `${stdout}\n${stderr}`.trim()
}

function parseVersion(output: string): string {
  const match = output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)
  if (!match) throw failure('RUNTIME_VERSION_MISMATCH', '无法识别 Claude Code 版本')
  return match[0]
}

function fingerprint(parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex')
}

function failure(code: ClaudeRuntimeErrorCode, message: string): ClaudeRuntimeFailure {
  return { code, message }
}

function isRuntimeFailure(value: unknown): value is ClaudeRuntimeFailure {
  return (
    value !== null &&
    typeof value === 'object' &&
    'code' in value &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

function toFailure(error: unknown, source: ClaudeRuntimeSelection['source']): ClaudeRuntimeFailure {
  if (isRuntimeFailure(error)) return error
  return failure(
    source === 'bundled'
      ? 'BUNDLED_RUNTIME_INTEGRITY_FAILED'
      : source === 'managed'
        ? 'MANAGED_RUNTIME_INTEGRITY_FAILED'
        : source === 'custom'
          ? 'CUSTOM_RUNTIME_INVALID'
          : 'SYSTEM_RUNTIME_NOT_FOUND',
    describeError(error),
  )
}

function stateForFailure(code: ClaudeRuntimeErrorCode): ClaudeRuntimeStatus['state'] {
  return code === 'BUNDLED_RUNTIME_INTEGRITY_FAILED' ||
    code === 'MANAGED_RUNTIME_INTEGRITY_FAILED' ||
    code === 'RUNTIME_ARCH_MISMATCH' ||
    code === 'RUNTIME_VERSION_MISMATCH'
    ? 'failed'
    : 'unavailable'
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : String(error)
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    ('code' in error && (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') ||
    error.message.toLowerCase().includes('timed out')
  )
}
