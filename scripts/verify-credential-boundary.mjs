#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const forbiddenPatterns = [
  ['Electron safeStorage', /\bsafeStorage\b/],
  ['keytar dependency', /\bkeytar\b/i],
  ['Apple Keychain reference', /\bKeychain\b|\bkeychain\b/],
  ['retired settings credential owner', /\bSettingsCredentialStore\b/],
  ['retired Git credential owner', /\bGitBackupCredentialStore\b/],
  ['retired data-source credential owner', /\bDataSourceCredentialStore\b/],
]

// NO_SYSTEM_KEYCHAIN applies to code that can run inside Studio or become an
// application dependency. Release CI is intentionally outside this scan: ADR
// 0011 requires its isolated runner to use an ephemeral keychain for signing.
const output = execFileSync(
  'git',
  [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    'src',
    'package.json',
    'pnpm-lock.yaml',
  ],
  { cwd: root, encoding: 'utf8' },
)
const failures = []

for (const relativePath of output.split('\0').filter(Boolean)) {
  if (
    relativePath.endsWith('.test.ts') ||
    relativePath.endsWith('.test.tsx') ||
    relativePath.endsWith('.spec.ts') ||
    relativePath.endsWith('.spec.tsx')
  ) {
    continue
  }
  const absolutePath = join(root, relativePath)
  if (!existsSync(absolutePath)) continue
  const text = readFileSync(absolutePath, 'utf8')
  for (const [label, pattern] of forbiddenPatterns) {
    const match = text.match(pattern)
    if (!match) continue
    const line = text.slice(0, match.index).split(/\r?\n/).length
    failures.push(`${relativePath}:${line} ${label}: ${JSON.stringify(match[0])}`)
  }
}

const requiredRuntimePath = 'src/main/runtime/core-services.ts'
const runtimeText = readFileSync(join(root, requiredRuntimePath), 'utf8')
if (!runtimeText.includes('runtime.credentialService = new CredentialService()')) {
  failures.push(`${requiredRuntimePath}: CredentialService must be created by the state runtime`)
}
if (!runtimeText.includes('new SettingsService(runtime.credentialService)')) {
  failures.push(`${requiredRuntimePath}: SettingsService must consume the shared CredentialService`)
}

if (failures.length > 0) {
  console.error('Credential boundary verification failed:')
  for (const failure of failures) console.error(failure)
  process.exit(1)
}

console.log('Application runtime credential boundary verification passed.')
