import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { McpClientManager } from './client-manager'

describe('McpClientManager external MCP runtime boundary', () => {
  const cleanupPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    )
  })

  it('preserves configured external servers without composing them into the SDK config', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cclink-mcp-config-'))
    cleanupPaths.push(tempDir)
    const configPath = join(tempDir, 'mcp-servers.json')
    const canaryPath = join(tempDir, 'started.txt')
    const externalServer = {
      name: 'canary_server',
      transport: 'stdio' as const,
      command: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(canaryPath)}, 'started')`],
      enabled: true,
    }
    await writeFile(configPath, JSON.stringify({ servers: [externalServer] }), 'utf8')

    const manager = new McpClientManager(configPath)
    const config = manager.composeMcpConfig(39876, 'test-session')

    expect(manager.getAllServers()).toEqual([externalServer])
    expect(config).toEqual({
      mcpServers: {
        cclink_studio: {
          type: 'http',
          url: 'http://127.0.0.1:39876/mcp?session=test-session',
        },
      },
    })
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ servers: [externalServer] })
    await expect(access(canaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
