import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

if (process.platform === 'darwin') {
  mkdirSync('out/update-helper', { recursive: true })
  execFileSync(
    '/usr/bin/clang',
    [
      '-arch',
      'arm64',
      '-mmacosx-version-min=13.0',
      '-fobjc-arc',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-framework',
      'Foundation',
      '-framework',
      'Security',
      'src/main/update/native/install-helper.m',
      '-o',
      'out/update-helper/cclink-update-helper',
    ],
    { stdio: 'inherit' },
  )
}
