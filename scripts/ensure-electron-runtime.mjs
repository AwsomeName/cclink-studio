#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export function ensureElectronRuntime() {
  const electronPackagePath = require.resolve('electron/package.json')
  const electronPackageDir = dirname(electronPackagePath)
  const pathFile = join(electronPackageDir, 'path.txt')

  if (!existsSync(pathFile)) {
    process.stderr.write('[CCLink Studio] Electron runtime is missing; installing it now.\n')
    execFileSync(process.execPath, [join(electronPackageDir, 'install.js')], {
      cwd: electronPackageDir,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  }

  if (!existsSync(pathFile)) {
    throw new Error(`Electron runtime installation did not create ${pathFile}`)
  }

  const electronPackage = JSON.parse(readFileSync(electronPackagePath, 'utf8'))
  return {
    electronPackageDir,
    electronRelativePath: readFileSync(pathFile, 'utf8').trim(),
    electronVersion: electronPackage.version,
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) ensureElectronRuntime()
