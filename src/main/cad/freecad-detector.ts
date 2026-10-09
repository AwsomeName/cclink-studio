import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CadBackendStatus, CadConversionError } from '../../shared/ipc/cad'

const execFileAsync = promisify(execFile)

const KNOWN_FREECAD_PATHS = [
  '/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd',
  '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  '/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd',
  '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
  '/opt/homebrew/bin/FreeCADCmd',
  '/opt/homebrew/bin/freecadcmd',
  '/usr/local/bin/FreeCADCmd',
  '/usr/local/bin/freecadcmd',
]

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return `${homedir()}${path.slice(1)}`
  return path
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findWithShell(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      '/bin/zsh',
      ['-lc', 'command -v FreeCADCmd || command -v freecadcmd || command -v FreeCAD'],
      {
        timeout: 5000,
        env: {
          ...process.env,
          PATH: [
            '/Applications/FreeCAD.app/Contents/MacOS',
            '/opt/homebrew/bin',
            '/usr/local/bin',
            `${homedir()}/.local/bin`,
            process.env.PATH ?? '',
          ].join(delimiter),
        },
      },
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function readFreeCadVersion(path: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(path, ['--version'], { timeout: 8000 })
    const text = `${stdout}\n${stderr}`.trim()
    return text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /^FreeCAD(?:Cmd)?\s/i.test(line))
      ?.slice(0, 256)
  } catch {
    return undefined
  }
}

function notFoundError(detail?: string): CadConversionError {
  return {
    code: 'backend-not-found',
    message: '未找到可用的 FreeCAD/FreeCADCmd。',
    detail,
    retryable: true,
  }
}

export async function detectFreeCad(configuredPath?: string): Promise<CadBackendStatus> {
  const configured = configuredPath?.trim()
  if (configured) {
    const path = expandHome(configured)
    if (await canExecute(path)) {
      return {
        kind: 'local-freecad',
        available: true,
        path,
        version: await readFreeCadVersion(path),
        source: 'configured',
      }
    }
    return {
      kind: 'local-freecad',
      available: false,
      path,
      source: 'configured',
      error: notFoundError(`配置的 FreeCAD 路径不可执行或不存在: ${path}`),
    }
  }

  for (const candidate of KNOWN_FREECAD_PATHS) {
    if (await canExecute(candidate)) {
      return {
        kind: 'local-freecad',
        available: true,
        path: candidate,
        version: await readFreeCadVersion(candidate),
        source: 'known-path',
      }
    }
  }

  const shellPath = await findWithShell()
  if (shellPath && (await canExecute(shellPath))) {
    return {
      kind: 'local-freecad',
      available: true,
      path: shellPath,
      version: await readFreeCadVersion(shellPath),
      source: 'shell-path',
    }
  }

  return {
    kind: 'local-freecad',
    available: false,
    source: 'not-found',
    error: notFoundError(
      '请安装 FreeCAD，或在设置页手动填写 FreeCADCmd / FreeCAD 可执行文件路径。',
    ),
  }
}
