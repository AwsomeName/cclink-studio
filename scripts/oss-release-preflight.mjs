#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const releaseToolsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const result = {
    sourceDir: releaseToolsDir,
    tag: process.env.RELEASE_TAG ?? '',
    mode: 'plan',
    output: resolve(releaseToolsDir, '.build/oss-release-preflight.json'),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--source-dir' && value) {
      result.sourceDir = resolve(value)
      index += 1
    } else if (arg === '--tag' && value) {
      result.tag = value
      index += 1
    } else if (arg === '--mode' && value) {
      result.mode = value
      index += 1
    } else if (arg === '--output' && value) {
      result.output = resolve(value)
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  if (!['plan', 'release'].includes(result.mode)) {
    throw new Error('--mode must be plan or release')
  }
  return result
}

function command(commandName, args, cwd) {
  return execFileSync(commandName, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function inspectOssReleasePreflight({
  sourceDir,
  tag,
  mode,
  environment = process.env,
  run = command,
  toolsDir = releaseToolsDir,
}) {
  const checks = []
  const add = (id, ok, required, detail) => checks.push({ id, ok, required, detail })
  const tagMatch = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)
  add('tag-format', Boolean(tagMatch), true, tag || 'missing')

  const packagePath = resolve(sourceDir, 'package.json')
  const packageExists = existsSync(packagePath)
  add('source-package', packageExists, true, packageExists ? packagePath : 'missing package.json')

  let packageVersion = ''
  if (packageExists) {
    packageVersion = JSON.parse(readFileSync(packagePath, 'utf8')).version ?? ''
  }
  add(
    'version-match',
    Boolean(tagMatch && packageVersion === tagMatch[1]),
    true,
    `package=${packageVersion || 'missing'} tag=${tagMatch?.[1] ?? 'invalid'}`,
  )

  let sourceSha = ''
  let tagRefSha = ''
  let tagSha = ''
  let sourceClean = false
  let releaseWorkflowSha = ''
  let toolsClean = false
  try {
    sourceSha = run('git', ['rev-parse', 'HEAD'], sourceDir)
    tagRefSha = tag
      ? run('git', ['show-ref', '--verify', '--hash', `refs/tags/${tag}`], sourceDir)
      : ''
    tagSha = tag ? run('git', ['rev-parse', `${tag}^{commit}`], sourceDir) : ''
    sourceClean = run('git', ['status', '--porcelain'], sourceDir) === ''
    releaseWorkflowSha = run('git', ['rev-parse', 'HEAD'], toolsDir)
    toolsClean = run('git', ['status', '--porcelain'], toolsDir) === ''
  } catch {
    // The individual checks below preserve the failure without exposing command output.
  }
  add('tag-ref', Boolean(tagRefSha), true, tagRefSha ? 'tag-exists' : 'missing')
  add(
    'tag-checkout',
    Boolean(sourceSha && tagSha && sourceSha === tagSha),
    true,
    `head=${sourceSha || 'unknown'} tag=${tagSha || 'unknown'}`,
  )
  add('source-clean', sourceClean, true, sourceClean ? 'clean' : 'dirty-or-unavailable')
  add('release-tools-clean', toolsClean, true, toolsClean ? 'clean' : 'dirty-or-unavailable')

  const releaseMode = mode === 'release'
  const importableDeveloperId =
    Boolean(environment.CSC_LINK?.trim()) &&
    Boolean(environment.CSC_KEY_PASSWORD?.trim()) &&
    Boolean(environment.CSC_NAME?.startsWith('Developer ID Application:'))
  add(
    'developer-id-application',
    importableDeveloperId,
    releaseMode,
    importableDeveloperId ? 'importable' : 'missing',
  )

  const apiNotary =
    Boolean(environment.APPLE_API_KEY?.trim()) &&
    existsSync(environment.APPLE_API_KEY) &&
    Boolean(environment.APPLE_API_KEY_ID?.trim()) &&
    Boolean(environment.APPLE_API_ISSUER?.trim())
  add('apple-notary-credentials', apiNotary, releaseMode, apiNotary ? 'api-key' : 'missing')

  const failedRequired = checks.filter((item) => item.required && !item.ok)
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    tag,
    packageVersion,
    sourceSha,
    releaseWorkflowSha,
    ready: failedRequired.length === 0,
    checks,
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = inspectOssReleasePreflight(options)
  mkdirSync(dirname(options.output), { recursive: true })
  writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`)

  for (const check of report.checks) {
    const marker = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN'
    console.log(`${marker} ${check.id} - ${check.detail}`)
  }
  console.log(`Release preflight report: ${options.output}`)
  if (!report.ready) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
