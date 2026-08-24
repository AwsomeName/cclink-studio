import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CclinkAgentService } from './cclink-agent-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('CclinkAgentService', () => {
  it('starts a loopback child service, returns an in-memory token, and stops the child', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cclink-agent-service-'))
    temporaryDirectories.push(directory)
    const executable = join(directory, 'fake-chatcc')
    await writeFile(
      executable,
      `#!/usr/bin/env node
const http = require('node:http')
const portIndex = process.argv.indexOf('--port')
const port = Number(process.argv[portIndex + 1])
const server = http.createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"ok":true}')
    return
  }
  if (request.url.startsWith('/cclink-studio/v1/runtime/probe')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      ok: true,
      protocol: 'cclink.studio.remote',
      protocol_version: 1,
      runtime_probe: { runtimes: [{ id: 'claude_code', status: 'ok' }] },
    }))
    return
  }
  response.writeHead(404)
  response.end()
})
server.listen(port, '127.0.0.1')
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`,
      'utf8',
    )
    await chmod(executable, 0o755)
    const port = await reservePort()
    const service = new CclinkAgentService({
      executablePath: executable,
      workspaceRoot: directory,
      port,
    })

    const endpoint = await service.start()

    expect(endpoint).toMatchObject({
      baseUrl: `http://127.0.0.1:${port}`,
      runtimeId: 'claude_code',
    })
    expect(endpoint.token).toContain('runtime:run runtime:probe')
    await expect(
      fetch(`${endpoint.baseUrl}/healthz`).then((response) => response.ok),
    ).resolves.toBe(true)

    await service.stop()
    await expect(fetch(`${endpoint.baseUrl}/healthz`)).rejects.toThrow()
  })
})

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no TCP address')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}
