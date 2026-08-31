#!/usr/bin/env node

import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const smokeRoot = await mkdtemp(join(tmpdir(), 'cclink-mcp-credential-smoke-'))
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR = smokeRoot
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT = String(30_000 + (process.pid % 20_000))

const { createSmokeRuntime } = await import('./smoke-runtime.mjs')
const runtime = createSmokeRuntime(import.meta.url)
const canaryPath = join(smokeRoot, 'external-server-started.txt')
const envCanary = 'mcp-smoke-env-canary'
const headerCanary = 'mcp-smoke-header-canary'
let browser = null

try {
  runtime.runRestart('restart')
  const cdpPort = await waitForCdpPort(runtime.logFile)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const page = await findRendererPage(browser, runtime.rendererOrigin)
  await page.waitForFunction(() => Boolean(window.cclinkStudio?.agent), undefined, {
    timeout: 30_000,
  })

  const result = await page.evaluate(
    async ({ canaryPath, envCanary, headerCanary, nodePath }) => {
      const api = window.cclinkStudio.agent
      const added = await api.addMcpServer({
        name: 'credential_canary',
        transport: 'stdio',
        command: nodePath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(canaryPath)}, 'started')`],
        enabled: true,
        credentials: {
          env: { TOKEN: envCanary },
          headers: { Authorization: `Bearer ${headerCanary}` },
        },
      })
      if (!added.success) throw new Error(added.error || 'MCP add failed')
      const initial = await api.listMcpServers()
      const renamed = await api.updateMcpServer('credential_canary', {
        name: 'credential_renamed',
      })
      const copied = await api.copyMcpServer('credential_renamed', 'credential_copy')
      const afterCopy = await api.listMcpServers()
      return { initial, renamed, copied, afterCopy }
    },
    { canaryPath, envCanary, headerCanary, nodePath: process.execPath },
  )

  assert(result.renamed, 'rename failed')
  assert(result.copied, 'copy failed')
  assert(result.initial.length === 1, 'unexpected initial MCP server count')
  assert(result.afterCopy.length === 2, 'copy did not create a second server')
  const rendererJson = JSON.stringify(result)
  assert(!rendererJson.includes(envCanary), 'env secret reached Renderer DTO')
  assert(!rendererJson.includes(headerCanary), 'header secret reached Renderer DTO')
  assert(!rendererJson.includes('credentialRef'), 'credentialRef reached Renderer DTO')
  assert(
    result.afterCopy.every(
      (server) =>
        server.credentialConfigured &&
        !server.credentialMissing &&
        server.envKeys.includes('TOKEN') &&
        server.headerNames.includes('Authorization'),
    ),
    'redacted credential metadata is incomplete',
  )
  assert(
    result.afterCopy[0].serverId !== result.afterCopy[1].serverId,
    'copy reused the source serverId',
  )

  const configPath = join(smokeRoot, 'user-data', 'mcp-servers.json')
  const credentialPath = join(smokeRoot, 'user-data', 'credentials', 'credentials.json')
  const configRaw = await readFile(configPath, 'utf8')
  const credentialRaw = await readFile(credentialPath, 'utf8')
  const config = JSON.parse(configRaw)
  assert(config.schemaVersion === 2, 'MCP config schema was not upgraded to v2')
  assert(config.servers.length === 2, 'MCP config copy count mismatch')
  assert(!configRaw.includes(envCanary), 'env secret remained in non-secret MCP config')
  assert(!configRaw.includes(headerCanary), 'header secret remained in non-secret MCP config')
  assert(credentialRaw.includes(envCanary), 'env secret was not persisted by CredentialService')
  assert(headerCanary && credentialRaw.includes(headerCanary), 'header secret was not persisted')
  assert(
    config.servers[0].serverId === result.afterCopy[0].serverId,
    'rename changed stable serverId',
  )
  assert(
    config.servers[0].credentialRef.revision !== config.servers[1].credentialRef.revision,
    'copy reused the source credential revision',
  )
  await expectMissing(canaryPath, 'external MCP process started during configuration smoke')

  const removed = await page.evaluate(async () => {
    const api = window.cclinkStudio.agent
    return Promise.all([
      api.removeMcpServer('credential_renamed'),
      api.removeMcpServer('credential_copy'),
    ])
  })
  assert(removed.every(Boolean), 'MCP removal failed')
  const afterDeleteConfig = JSON.parse(await readFile(configPath, 'utf8'))
  const afterDeleteCredentials = await readFile(credentialPath, 'utf8')
  assert(afterDeleteConfig.servers.length === 0, 'delete left a config reference')
  assert(!afterDeleteCredentials.includes(envCanary), 'delete left the env credential revision')
  assert(
    !afterDeleteCredentials.includes(headerCanary),
    'delete left the header credential revision',
  )
  await expectMissing(canaryPath, 'external MCP process started after configuration changes')

  console.log(
    JSON.stringify({
      success: true,
      rendererDtoRedacted: true,
      configSchemaVersion: config.schemaVersion,
      stableRenameServerId: true,
      independentCopyRevision: true,
      deleteRemovedReferencesFirst: true,
      externalProcessStarted: false,
    }),
  )
} finally {
  await browser?.close().catch(() => undefined)
  try {
    runtime.runRestart('stop')
  } catch {
    // Cleanup continues even if the smoke-owned process already exited.
  }
  await rm(smokeRoot, { recursive: true, force: true })
}

async function waitForCdpPort(logFile, timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const log = await readFile(logFile, 'utf8').catch(() => '')
    const match =
      log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//) ||
      log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('MCP credential smoke could not find Electron CDP port')
}

async function findRendererPage(browserInstance, rendererOrigin, timeoutMs = 20_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const page = browserInstance
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('MCP credential smoke could not find the Renderer page')
}

async function expectMissing(path, message) {
  try {
    await access(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
