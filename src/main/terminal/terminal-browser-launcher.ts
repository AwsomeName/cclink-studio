import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export const TERMINAL_BROWSER_OPEN_ARGUMENT = '--cclink-terminal-open-url'

interface TerminalBrowserLauncherOptions {
  executablePath: string
  appPath: string
  isPackaged: boolean
  tempPath: string
  platform?: NodeJS.Platform
  pathValue?: string
}

export interface TerminalBrowserEnvironment extends Record<string, string> {
  BROWSER: string
  npm_config_browser: string
  PATH: string
}

export function createTerminalBrowserEnvironment(
  options: TerminalBrowserLauncherOptions,
): TerminalBrowserEnvironment {
  const platform = options.platform ?? process.platform
  const directory = join(options.tempPath, 'cclink-studio-terminal-browser')
  const launcherPath = join(directory, platform === 'win32' ? 'open-url.cmd' : 'open-url')
  mkdirSync(directory, { recursive: true, mode: 0o700 })

  const appArgument = options.isPackaged ? '' : ` ${shellQuote(options.appPath)}`
  const contents =
    platform === 'win32'
      ? `@echo off\r\n"${escapeWindowsQuoted(options.executablePath)}"${options.isPackaged ? '' : ` "${escapeWindowsQuoted(options.appPath)}"`} ${TERMINAL_BROWSER_OPEN_ARGUMENT} %*\r\n`
      : `#!/bin/sh\nexec ${shellQuote(options.executablePath)}${appArgument} ${shellQuote(TERMINAL_BROWSER_OPEN_ARGUMENT)} "$@"\n`

  writeFileSync(launcherPath, contents, { encoding: 'utf8', mode: 0o700 })
  if (platform !== 'win32') chmodSync(launcherPath, 0o700)

  const pathValue = options.pathValue ?? process.env.PATH ?? ''
  if (platform === 'darwin') {
    writeUrlCommandShim(
      join(directory, 'open'),
      launcherPath,
      resolveSystemCommand('open', pathValue, directory) ?? '/usr/bin/open',
    )
  } else if (platform === 'linux') {
    for (const command of ['xdg-open', 'sensible-browser']) {
      writeUrlCommandShim(
        join(directory, command),
        launcherPath,
        resolveSystemCommand(command, pathValue, directory),
      )
    }
  }

  return {
    BROWSER: launcherPath,
    npm_config_browser: platform === 'win32' ? `"${launcherPath}"` : shellQuote(launcherPath),
    PATH: pathValue ? `${directory}${delimiter}${pathValue}` : directory,
  }
}

export function parseTerminalBrowserOpenUrl(argv: string[]): string | null {
  const argumentIndex = argv.indexOf(TERMINAL_BROWSER_OPEN_ARGUMENT)
  if (argumentIndex < 0) return null

  for (const value of argv.slice(argumentIndex + 1)) {
    if (value.length > 16_384) continue
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      if (url.username || url.password) continue
      return url.toString()
    } catch {
      // Ignore non-URL arguments added by a CLI browser launcher.
    }
  }
  return null
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function escapeWindowsQuoted(value: string): string {
  return value.replace(/"/g, '""')
}

function writeUrlCommandShim(
  path: string,
  launcherPath: string,
  fallbackPath: string | null,
): void {
  const fallback = fallbackPath ? `exec ${shellQuote(fallbackPath)} "$@"` : 'exit 127'
  const contents = `#!/bin/sh
for argument in "$@"; do
  case "$argument" in
    http://*|https://*) exec ${shellQuote(launcherPath)} "$@" ;;
  esac
done
${fallback}
`
  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o700 })
  chmodSync(path, 0o700)
}

function resolveSystemCommand(
  command: string,
  pathValue: string,
  excludedPath: string,
): string | null {
  for (const directory of pathValue.split(delimiter)) {
    if (!directory || directory === excludedPath) continue
    const candidate = join(directory, command)
    if (existsSync(candidate)) return candidate
  }
  return null
}
