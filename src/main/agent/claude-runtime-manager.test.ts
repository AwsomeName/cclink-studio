import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BundledClaudeRuntimeManifest } from '../../shared/claude-runtime'
import { ClaudeRuntimeManager, ClaudeRuntimeResolutionError } from './claude-runtime-manager'

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'cclink-claude-runtime-'))
  temporaryDirectories.push(path)
  return path
}

async function createExecutable(
  root: string,
  content = '#!/bin/sh\necho 2.1.211\n',
): Promise<string> {
  const path = join(root, 'claude')
  await writeFile(path, content, 'utf8')
  await chmod(path, 0o755)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('ClaudeRuntimeManager', () => {
  it('verifies and activates a bundled runtime without consulting the system PATH', async () => {
    const bundledRoot = await createTemporaryDirectory()
    const runtimeRoot = join(bundledRoot, 'darwin-arm64')
    await mkdir(runtimeRoot)
    const executablePath = await createExecutable(runtimeRoot)
    const content = await import('node:fs/promises').then(({ readFile }) =>
      readFile(executablePath),
    )
    const manifest: BundledClaudeRuntimeManifest = {
      schemaVersion: 1,
      source: 'anthropic-agent-sdk-platform-package',
      sdkPackage: '@anthropic-ai/claude-agent-sdk',
      sdkVersion: '0.3.211',
      claudeCodePackage: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
      claudeCodeVersion: '2.1.211',
      platform: 'darwin',
      arch: 'arm64',
      executable: 'claude',
      sha256: createHash('sha256').update(content).digest('hex'),
      size: content.byteLength,
    }
    await writeFile(join(runtimeRoot, 'manifest.json'), JSON.stringify(manifest), 'utf8')
    const detectSystem = vi.fn()
    const manager = new ClaudeRuntimeManager({
      bundledRoot,
      platform: 'darwin',
      arch: 'arm64',
      detectSystem,
      executeVersion: async () => '2.1.211 (Claude Code)',
      now: () => 100,
    })

    const runtime = await manager.initialize({ source: 'bundled' })

    expect(runtime).toMatchObject({
      source: 'bundled',
      executablePath,
      claudeCodeVersion: '2.1.211',
      sdkVersion: '0.3.211',
      integrity: 'manifest-sha256',
      probedAt: 100,
    })
    expect(runtime.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(manager.getStatus()).toMatchObject({
      state: 'ready',
      active: runtime,
      generation: 1,
    })
    expect(detectSystem).not.toHaveBeenCalled()
  })

  it('materializes a verified bundled runtime outside the packaged resource root', async () => {
    const bundledRoot = await createTemporaryDirectory()
    const materializedRoot = await createTemporaryDirectory()
    const runtimeRoot = join(bundledRoot, 'darwin-arm64')
    await mkdir(runtimeRoot)
    const sourcePath = await createExecutable(runtimeRoot)
    const content = await import('node:fs/promises').then(({ readFile }) => readFile(sourcePath))
    const manifest: BundledClaudeRuntimeManifest = {
      schemaVersion: 1,
      source: 'anthropic-agent-sdk-platform-package',
      sdkPackage: '@anthropic-ai/claude-agent-sdk',
      sdkVersion: '0.3.211',
      claudeCodePackage: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
      claudeCodeVersion: '2.1.211',
      platform: 'darwin',
      arch: 'arm64',
      executable: 'claude',
      sha256: createHash('sha256').update(content).digest('hex'),
      size: content.byteLength,
    }
    await writeFile(join(runtimeRoot, 'manifest.json'), JSON.stringify(manifest), 'utf8')
    const executeVersion = vi.fn(async () => '2.1.211 (Claude Code)')
    const manager = new ClaudeRuntimeManager({
      bundledRoot,
      materializedRoot,
      platform: 'darwin',
      arch: 'arm64',
      executeVersion,
    })

    const runtime = await manager.initialize({ source: 'bundled' })

    expect(runtime.executablePath).toContain(materializedRoot)
    expect(runtime.executablePath).not.toBe(sourcePath)
    expect(executeVersion).toHaveBeenCalledWith(runtime.executablePath, 15_000)
    const materialized = await import('node:fs/promises').then(({ readFile }) =>
      readFile(runtime.executablePath),
    )
    expect(materialized).toEqual(content)
  })

  it('rejects a bundled runtime whose bytes do not match the manifest', async () => {
    const bundledRoot = await createTemporaryDirectory()
    const runtimeRoot = join(bundledRoot, 'darwin-arm64')
    await mkdir(runtimeRoot)
    await createExecutable(runtimeRoot)
    await writeFile(
      join(runtimeRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        source: 'anthropic-agent-sdk-platform-package',
        sdkPackage: '@anthropic-ai/claude-agent-sdk',
        sdkVersion: '0.3.211',
        claudeCodePackage: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
        claudeCodeVersion: '2.1.211',
        platform: 'darwin',
        arch: 'arm64',
        executable: 'claude',
        sha256: '0'.repeat(64),
        size: 28,
      }),
      'utf8',
    )
    const manager = new ClaudeRuntimeManager({
      bundledRoot,
      platform: 'darwin',
      arch: 'arm64',
      executeVersion: async () => '2.1.211',
    })

    await expect(manager.initialize({ source: 'bundled' })).rejects.toMatchObject({
      code: 'BUNDLED_RUNTIME_INTEGRITY_FAILED',
    })
    expect(manager.getStatus()).toMatchObject({
      state: 'failed',
      active: null,
      failure: { code: 'BUNDLED_RUNTIME_INTEGRITY_FAILED' },
    })
  })

  it('keeps the active runtime when a replacement candidate fails its probe', async () => {
    const root = await createTemporaryDirectory()
    const executablePath = await createExecutable(root)
    const manager = new ClaudeRuntimeManager({
      bundledRoot: root,
      detectSystem: async () => ({
        installed: true,
        path: executablePath,
        source: 'known-path',
      }),
      executeVersion: async () => '2.1.211',
    })
    const active = await manager.initialize({ source: 'system' })

    await expect(
      manager.activate({ source: 'custom', customPath: join(root, 'missing') }),
    ).rejects.toBeInstanceOf(ClaudeRuntimeResolutionError)

    expect(manager.getStatus()).toMatchObject({
      state: 'degraded',
      active,
      selection: { source: 'custom', customPath: join(root, 'missing') },
      failure: { code: 'CUSTOM_RUNTIME_INVALID' },
      generation: 1,
    })
  })

  it('requires custom paths to be absolute and executable', async () => {
    const manager = new ClaudeRuntimeManager({ bundledRoot: '/unused' })

    const result = await manager.probe({ source: 'custom', customPath: 'relative/claude' })

    expect(result).toEqual({
      success: false,
      failure: {
        code: 'CUSTOM_RUNTIME_INVALID',
        message: '自定义 Claude Code 路径必须是绝对路径',
      },
    })
  })

  it('reports version probe timeouts with a stable error code', async () => {
    const root = await createTemporaryDirectory()
    const executablePath = await createExecutable(root)
    const timeout = Object.assign(new Error('Command timed out'), { code: 'ETIMEDOUT' })
    const manager = new ClaudeRuntimeManager({
      bundledRoot: root,
      detectSystem: async () => ({
        installed: true,
        path: executablePath,
        source: 'known-path',
      }),
      executeVersion: async () => {
        throw timeout
      },
    })

    const result = await manager.probe({ source: 'system' })

    expect(result).toMatchObject({
      success: false,
      failure: { code: 'RUNTIME_PROBE_TIMEOUT' },
    })
  })
})
