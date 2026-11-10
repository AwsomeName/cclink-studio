import { isAbsolute } from 'node:path'
import { mkdir, lstat, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const CLAUDE_AUTH_ISOLATION_VERSION = 'studio-api-key-v1'
export const STUDIO_CLAUDE_AUTH_REQUIRED =
  '请在 Studio 设置中保存 API Key；Studio 不使用本机 Claude 的订阅登录。'

/** Only the host's explicit provider credentials may reach a Claude subprocess. */
export function buildClaudeProcessEnvironment(input: {
  configDir: string
  apiKey?: string
  apiBaseUrl?: string
  inheritedEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  if (!isAbsolute(input.configDir)) throw new Error('Studio Claude 配置目录必须是绝对路径')
  const env = { ...(input.inheritedEnv ?? process.env) }
  for (const key of Object.keys(env)) {
    // Includes OAuth tokens, token file descriptors, host credential files, routing,
    // custom headers, model overrides and config paths inherited from other clients.
    if (/^(ANTHROPIC_|CLAUDE_)/.test(key) || key === 'CLAUDECODE') delete env[key]
  }
  return {
    ...env,
    ...(process.platform === 'darwin'
      ? { PATH: `${join(input.configDir, 'bin')}:${env.PATH ?? '/usr/bin:/bin'}` }
      : {}),
    CLAUDE_CONFIG_DIR: input.configDir,
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_UPDATES: '1',
    ANTHROPIC_API_KEY: input.apiKey?.trim() ?? '',
    ANTHROPIC_BASE_URL: input.apiBaseUrl?.trim() || 'https://api.anthropic.com',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'cclink-studio',
  }
}

export async function prepareClaudeConfigDirectory(configDir: string): Promise<void> {
  if (!isAbsolute(configDir)) throw new Error('Studio Claude 配置目录必须是绝对路径')
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  const stat = await lstat(configDir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Studio Claude 配置目录不可用，拒绝回退到本机 Claude 登录')
  }
  if (process.platform === 'darwin') {
    // Claude's credential probe expects a command returning failure. An OS-denied
    // spawn instead crashes some runtimes. This private no-op never calls the OS
    // utility; the launch policy independently forbids that utility and storage.
    const bin = join(configDir, 'bin')
    await mkdir(bin, { mode: 0o700, recursive: true })
    if ((await lstat(bin)).isSymbolicLink())
      throw new Error('Studio Claude 隔离目录不可使用符号链接')
    const shim = join(bin, 'security')
    const content = '#!/bin/sh\nexit 44\n'
    try {
      await writeFile(shim, content, { flag: 'wx', mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const stat = await lstat(shim)
      if (!stat.isFile() || stat.isSymbolicLink() || (await readFile(shim, 'utf8')) !== content) {
        throw new Error('Studio Claude 凭证隔离文件校验失败')
      }
    }
  }
}

/** Version probes must not initialize or inspect the user's Claude configuration. */
export async function withClaudeProbeEnvironment<T>(
  run: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const configDir = await mkdtemp(join(tmpdir(), 'cclink-claude-probe-'))
  try {
    await prepareClaudeConfigDirectory(configDir)
    return await run(buildClaudeProcessEnvironment({ configDir }))
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
}
