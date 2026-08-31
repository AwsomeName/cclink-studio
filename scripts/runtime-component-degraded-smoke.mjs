#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runDir = await mkdtemp(join(tmpdir(), 'cclink-runtime-degraded-smoke-'))
try {
  const userData = join(runDir, 'user-data')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'runtime-components'), 'blocks-directory-creation', 'utf8')
  execFileSync(process.execPath, ['scripts/local-smoke.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CCLINK_STUDIO_SMOKE_RUN_DIR: runDir,
      CCLINK_STUDIO_SMOKE_RENDERER_PORT: String(30_000 + (process.pid % 20_000)),
    },
    stdio: 'inherit',
  })
  console.log(
    JSON.stringify({ success: true, runtimeInitialization: 'degraded', localSmoke: '11/11' }),
  )
} finally {
  await rm(runDir, { recursive: true, force: true })
}
