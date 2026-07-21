import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function createSmokeRuntime(importMetaUrl) {
  const rootDir = fileURLToPath(new URL('..', importMetaUrl)).replace(/\/$/, '')
  const rootKey = createHash('sha256').update(rootDir).digest('hex').slice(0, 12)
  const rendererPort = resolveRendererPort(rootKey)
  const runDir = process.env.CCLINK_STUDIO_SMOKE_RUN_DIR || `/tmp/cclink-studio-smoke-${rootKey}`
  const logFile = process.env.CCLINK_STUDIO_LOG_FILE || join(runDir, 'cclink-studio-dev.log')
  const rendererOrigin = `http://localhost:${rendererPort}`
  const controllerEnv = {
    ...process.env,
    CCLINK_STUDIO_RUN_DIR: runDir,
    CCLINK_STUDIO_SCREEN_NAME: `cclink-studio-smoke-${rootKey}`,
    CCLINK_STUDIO_DEV_PORTS: String(rendererPort),
    CCLINK_STUDIO_RENDERER_PORT: String(rendererPort),
    CCLINK_STUDIO_TEST_USER_DATA_PATH: join(runDir, 'user-data'),
  }

  return {
    rootDir,
    logFile,
    rendererOrigin,
    runRestart(action) {
      return execFileSync('bash', ['scripts/restart.sh', action], {
        cwd: rootDir,
        env: controllerEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    },
  }
}

function resolveRendererPort(rootKey) {
  const configured = Number(process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT)
  if (Number.isInteger(configured) && configured >= 1024 && configured <= 65_535) {
    return configured
  }
  return 20_000 + (Number.parseInt(rootKey.slice(0, 8), 16) % 20_000)
}
