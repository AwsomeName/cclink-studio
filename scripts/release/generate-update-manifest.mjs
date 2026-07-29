#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateUpdateManifest } from './update-manifest-lib.mjs'

function parseArgs(argv) {
  const result = {
    assetsDir: '',
    tag: '',
    output: '',
    minimumSystemVersion: '13.0',
    expectedReleaseWorkflowSha: '',
    expectedWorkflowRunId: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--assets-dir' && value) result.assetsDir = resolve(value)
    else if (arg === '--tag' && value) result.tag = value
    else if (arg === '--output' && value) result.output = resolve(value)
    else if (arg === '--minimum-system-version' && value) {
      result.minimumSystemVersion = value
    } else if (arg === '--release-workflow-sha' && value) {
      result.expectedReleaseWorkflowSha = value
    } else if (arg === '--workflow-run-id' && value) {
      result.expectedWorkflowRunId = value
    } else throw new Error(`Unknown or incomplete argument: ${arg}`)
    index += 1
  }
  if (!result.assetsDir || !result.tag || !result.output) {
    throw new Error('--assets-dir, --tag and --output are required')
  }
  return result
}

export async function runGenerateUpdateManifest(argv) {
  const options = parseArgs(argv)
  const manifest = await generateUpdateManifest(options)
  mkdirSync(dirname(options.output), { recursive: true })
  writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Update Manifest generated: ${options.output}`)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runGenerateUpdateManifest(process.argv.slice(2))
  } catch (error) {
    console.error(`Update Manifest generation failed: ${error.message}`)
    process.exitCode = 1
  }
}
