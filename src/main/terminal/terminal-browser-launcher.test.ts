import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTerminalBrowserEnvironment,
  parseTerminalBrowserOpenUrl,
  TERMINAL_BROWSER_OPEN_ARGUMENT,
} from './terminal-browser-launcher'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
})

describe('terminal browser launcher', () => {
  it('creates an executable launcher that routes URLs back to Studio', () => {
    const tempPath = mkdtempSync(join(tmpdir(), 'cclink-terminal-browser-'))
    temporaryDirectories.push(tempPath)

    const environment = createTerminalBrowserEnvironment({
      executablePath: '/Applications/CCLink Studio.app/Contents/MacOS/CCLink Studio',
      appPath: '/workspace/cclink-studio',
      isPackaged: false,
      tempPath,
      platform: 'darwin',
      pathValue: '/usr/bin:/bin',
    })

    expect(environment.npm_config_browser).toContain('open-url')
    expect(environment.PATH.startsWith(join(tempPath, 'cclink-studio-terminal-browser'))).toBe(true)
    expect(readFileSync(environment.BROWSER, 'utf8')).toContain(TERMINAL_BROWSER_OPEN_ARGUMENT)
    expect(statSync(environment.BROWSER).mode & 0o111).not.toBe(0)
    const openShim = join(tempPath, 'cclink-studio-terminal-browser', 'open')
    expect(readFileSync(openShim, 'utf8')).toContain('http://*|https://*')
    expect(readFileSync(openShim, 'utf8')).toContain('/usr/bin/open')
  })

  it('accepts only credential-free HTTP URLs following the launcher argument', () => {
    expect(
      parseTerminalBrowserOpenUrl([
        'electron',
        TERMINAL_BROWSER_OPEN_ARGUMENT,
        'https://www.npmjs.com/login?next=%2Flogin%2Fcli%2Fabc',
      ]),
    ).toBe('https://www.npmjs.com/login?next=%2Flogin%2Fcli%2Fabc')
    expect(
      parseTerminalBrowserOpenUrl([
        TERMINAL_BROWSER_OPEN_ARGUMENT,
        'https://user:secret@example.com/',
      ]),
    ).toBeNull()
    expect(
      parseTerminalBrowserOpenUrl([TERMINAL_BROWSER_OPEN_ARGUMENT, 'file:///tmp/token']),
    ).toBeNull()
  })
})
