import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'

/** macOS Claude still probes OS credentials with an API key. Deny that access in
 * the child process and its descendants without changing the user's login state.
 * If the OS launcher is unavailable, spawn fails; never retry without protection.
 */
export function claudeProcessCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { command: string; args: string[] } {
  if (process.platform !== 'darwin') return { command, args }
  const homes = new Set(
    [homedir(), env.HOME]
      .filter((path): path is string => Boolean(path))
      .map((path) => {
        try {
          return realpathSync(path)
        } catch {
          return path
        }
      }),
  )
  const protectedPaths = ['/Library/Keychains']
  for (const home of homes) {
    protectedPaths.push(
      join(home, 'Library', 'Keychains'),
      join(home, '.claude'),
      join(home, '.claude.json'),
    )
  }
  const profile = [
    '(version 1)',
    '(allow default)',
    // The private no-op credential probe can run; the system utility cannot.
    '(deny process-exec (literal "/usr/bin/security"))',
    '(deny mach-lookup (global-name-regex #"^com\\.apple\\.(securityd|secd)(\\.|$)"))',
    `(deny file-read* file-write* ${protectedPaths.map((path) => `(subpath ${JSON.stringify(path)})`).join(' ')})`,
  ].join('\n')
  return { command: '/usr/bin/sandbox-exec', args: ['-p', profile, command, ...args] }
}

export function spawnClaudeProcess(
  options: SpawnOptions,
  onStderr?: (data: string) => void,
): SpawnedProcess {
  const launch = claudeProcessCommand(options.command, options.args, options.env)
  const child = spawn(launch.command, launch.args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (data: string) => onStderr?.(data))
  return child
}
