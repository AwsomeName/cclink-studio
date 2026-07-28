#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyUpdateManifestDirectory } from './update-manifest-lib.mjs'

function parseArgs(argv) {
  const result = {
    assetsDir: '',
    manifest: '',
    tag: '',
    expectedReleaseWorkflowSha: '',
    expectedWorkflowRunId: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--assets-dir' && value) result.assetsDir = resolve(value)
    else if (arg === '--manifest' && value) result.manifest = resolve(value)
    else if (arg === '--tag' && value) result.tag = value
    else if (arg === '--release-workflow-sha' && value) {
      result.expectedReleaseWorkflowSha = value
    } else if (arg === '--workflow-run-id' && value) {
      result.expectedWorkflowRunId = value
    } else throw new Error(`Unknown or incomplete argument: ${arg}`)
    index += 1
  }
  if (!result.assetsDir || !result.manifest) {
    throw new Error('--assets-dir and --manifest are required')
  }
  return result
}

export async function runVerifyUpdateManifest(argv) {
  const options = parseArgs(argv)
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'))
  const verified = await verifyUpdateManifestDirectory({
    assetsDir: options.assetsDir,
    manifest,
    expectedTag: options.tag || undefined,
    expectedReleaseWorkflowSha: options.expectedReleaseWorkflowSha || undefined,
    expectedWorkflowRunId: options.expectedWorkflowRunId || undefined,
  })
  console.log(
    `Update Manifest verified: ${verified.tag} (${Object.keys(verified.assets).join(', ')})`,
  )
  return verified
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runVerifyUpdateManifest(process.argv.slice(2))
  } catch (error) {
    console.error(`Update Manifest verification failed: ${error.message}`)
    process.exitCode = 1
  }
}
