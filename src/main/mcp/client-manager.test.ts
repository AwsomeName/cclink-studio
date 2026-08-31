import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CredentialService } from '../credentials/credential-service'
import { PlaintextCredentialStore } from '../credentials/plaintext-credential-store'
import { McpClientManager } from './client-manager'

const cleanupPaths: string[] = []

describe('McpClientManager credential boundary', () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    )
  })

  it('migrates legacy secrets to a versioned credential reference without exposing values', async () => {
    const fixture = await createFixture()
    const canaryPath = join(fixture.tempDir, 'started.txt')
    const legacy = {
      servers: [
        {
          name: 'canary_server',
          transport: 'stdio',
          command: process.execPath,
          args: [
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(canaryPath)}, 'started')`,
          ],
          env: { TOKEN: 'mcp-env-canary' },
          headers: { Authorization: 'Bearer mcp-header-canary' },
          enabled: true,
        },
      ],
    }
    await writeFile(fixture.configPath, JSON.stringify(legacy), 'utf8')
    const manager = createManager(fixture, ['server-a'], ['revision-a'])

    await manager.loadFromConfig()

    expect(manager.getStatus()).toEqual({ state: 'ready' })
    const dto = manager.getAllServers()[0]
    expect(dto).toMatchObject({
      serverId: 'server-a',
      name: 'canary_server',
      credentialConfigured: true,
      credentialMissing: false,
      envKeys: ['TOKEN'],
      headerNames: ['Authorization'],
    })
    expect(JSON.stringify(dto)).not.toContain('mcp-env-canary')
    expect(JSON.stringify(dto)).not.toContain('mcp-header-canary')

    const stored = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(stored).toMatchObject({
      schemaVersion: 2,
      servers: [
        {
          serverId: 'server-a',
          credentialRef: { credentialId: 'mcp:server-a', revision: 'revision-a' },
        },
      ],
    })
    expect(JSON.stringify(stored)).not.toContain('mcp-env-canary')
    expect(JSON.stringify(stored)).not.toContain('mcp-header-canary')
    expect(fixture.credentials.resolveCredential('mcp:server-a:revision-a')).toEqual({
      envJson: '{"TOKEN":"mcp-env-canary"}',
      headersJson: '{"Authorization":"Bearer mcp-header-canary"}',
    })
    expect(manager.composeMcpConfig(39876, 'test-session')).toEqual({
      mcpServers: {
        cclink_studio: {
          type: 'http',
          url: 'http://127.0.0.1:39876/mcp?session=test-session',
        },
      },
    })
    await expect(access(canaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves serverId on rename and switches immutable revisions before deleting the old one', async () => {
    const fixture = await createFixture()
    const manager = createManager(fixture, ['server-a'], ['revision-a', 'revision-b'])
    await manager.loadFromConfig()
    await manager.addServer({
      name: 'alpha',
      transport: 'http',
      url: 'https://example.test/mcp',
      enabled: true,
      credentials: { headers: { Authorization: 'Bearer first-canary' } },
    })

    await expect(manager.updateServer('alpha', { name: 'renamed' })).resolves.toBe(true)
    let stored = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(stored.servers[0]).toMatchObject({
      serverId: 'server-a',
      name: 'renamed',
      credentialRef: { credentialId: 'mcp:server-a', revision: 'revision-a' },
    })

    await expect(
      manager.updateServer('renamed', {
        credentials: { headers: { Authorization: 'Bearer second-canary' } },
      }),
    ).resolves.toBe(true)

    const dto = manager.getAllServers()[0]
    expect(dto).toMatchObject({ serverId: 'server-a', name: 'renamed', credentialConfigured: true })
    stored = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(stored.servers[0].credentialRef).toEqual({
      credentialId: 'mcp:server-a',
      revision: 'revision-b',
    })
    expect(fixture.credentials.resolveCredential('mcp:server-a:revision-a')).toBeNull()
    expect(fixture.credentials.resolveCredential('mcp:server-a:revision-b')).toEqual({
      headersJson: '{"Authorization":"Bearer second-canary"}',
    })
  })

  it('rolls back a new revision when config persistence fails and succeeds idempotently on retry', async () => {
    const fixture = await createFixture()
    let failWrites = false
    const writeConfig = vi.fn(async (path: string, config: unknown) => {
      if (failWrites) throw new Error('injected config write failure')
      await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    })
    const manager = new McpClientManager(fixture.credentials, fixture.configPath, {
      writeConfig,
      createServerId: sequence(['server-a']),
      createRevision: sequence(['revision-a', 'revision-b', 'revision-c']),
    })
    await manager.loadFromConfig()
    await manager.addServer({
      name: 'alpha',
      transport: 'http',
      url: 'https://example.test/mcp',
      enabled: true,
      credentials: { headers: { Authorization: 'Bearer first' } },
    })
    failWrites = true

    await expect(
      manager.updateServer('alpha', {
        credentials: { headers: { Authorization: 'Bearer failed' } },
      }),
    ).rejects.toThrow('injected config write failure')
    expect(fixture.credentials.resolveCredential('mcp:server-a:revision-b')).toBeNull()
    expect(manager.getAllServers()[0].headerNames).toEqual(['Authorization'])

    failWrites = false
    await expect(
      manager.updateServer('alpha', {
        credentials: { headers: { Authorization: 'Bearer retry' } },
      }),
    ).resolves.toBe(true)
    expect(fixture.credentials.resolveCredential('mcp:server-a:revision-a')).toBeNull()
    expect(fixture.credentials.resolveCredential('mcp:server-a:revision-c')).toEqual({
      headersJson: '{"Authorization":"Bearer retry"}',
    })
  })

  it('copies to a new serverId and deletes config references before credential cleanup', async () => {
    const fixture = await createFixture()
    const manager = createManager(
      fixture,
      ['server-source', 'server-copy'],
      ['revision-source', 'revision-copy'],
    )
    await manager.loadFromConfig()
    await manager.addServer({
      name: 'source',
      transport: 'stdio',
      command: 'node',
      enabled: false,
      credentials: { env: { TOKEN: 'copy-canary' } },
    })

    await expect(manager.copyServer('source', 'copied')).resolves.toBe(true)
    expect(manager.getAllServers().map(({ serverId, name }) => ({ serverId, name }))).toEqual([
      { serverId: 'server-source', name: 'source' },
      { serverId: 'server-copy', name: 'copied' },
    ])
    expect(fixture.credentials.resolveCredential('mcp:server-copy:revision-copy')).toEqual({
      envJson: '{"TOKEN":"copy-canary"}',
    })

    await expect(manager.removeServer('source')).resolves.toBe(true)
    const stored = JSON.parse(await readFile(fixture.configPath, 'utf8'))
    expect(stored.servers).toHaveLength(1)
    expect(stored.servers[0].serverId).toBe('server-copy')
    expect(fixture.credentials.resolveCredential('mcp:server-source:revision-source')).toBeNull()
  })

  it('cleans orphan revisions but keeps dangling refs fail-closed and visible as missing', async () => {
    const fixture = await createFixture()
    await fixture.credentials.setCredential({
      id: 'mcp:orphan-server:orphan-revision',
      kind: 'generic',
      fields: { envJson: '{"TOKEN":"orphan-canary"}' },
    })
    await writeFile(
      fixture.configPath,
      JSON.stringify({
        schemaVersion: 2,
        servers: [
          {
            serverId: 'dangling-server',
            name: 'dangling',
            transport: 'stdio',
            command: 'node',
            enabled: true,
            credentialRef: {
              credentialId: 'mcp:dangling-server',
              revision: 'missing-revision',
            },
          },
        ],
      }),
      'utf8',
    )
    const manager = createManager(fixture, [], [])

    await manager.loadFromConfig()

    expect(fixture.credentials.resolveCredential('mcp:orphan-server:orphan-revision')).toBeNull()
    expect(manager.getAllServers()[0]).toMatchObject({
      credentialConfigured: false,
      credentialMissing: true,
      envKeys: [],
      headerNames: [],
    })
  })

  it('leaves legacy config untouched when CredentialService capacity rejects migration', async () => {
    const fixture = await createFixture(false)
    const records: Record<string, unknown> = {}
    for (let index = 0; index < 256; index += 1) {
      records[`extension:test:${index}`] = {
        kind: 'token',
        fields: { token: `value-${index}` },
        updatedAt: '2026-08-31T00:00:00.000Z',
      }
    }
    await mkdir(join(fixture.tempDir, 'credentials'), { recursive: true })
    await writeFile(fixture.credentialPath, JSON.stringify({ schemaVersion: 1, records }), 'utf8')
    await fixture.credentials.load()
    const legacy = {
      servers: [
        {
          name: 'capacity',
          transport: 'stdio',
          command: 'node',
          env: { TOKEN: 'capacity-canary' },
          enabled: true,
        },
      ],
    }
    const original = JSON.stringify(legacy)
    await writeFile(fixture.configPath, original, 'utf8')
    const manager = createManager(fixture, ['capacity-server'], ['capacity-revision'])

    await manager.loadFromConfig()

    expect(manager.getStatus()).toMatchObject({ state: 'migration-blocked' })
    expect(await readFile(fixture.configPath, 'utf8')).toBe(original)
    expect(fixture.credentials.listMetadata()).toHaveLength(256)
    expect(JSON.stringify(fixture.credentials.listMetadata())).not.toContain('capacity-canary')
  })

  it('rejects prototype-key names and never overwrites an existing immutable revision', async () => {
    const fixture = await createFixture()
    const manager = createManager(fixture, ['server-a'], ['revision-a'])
    await manager.loadFromConfig()
    await expect(
      manager.addServer({
        name: '__proto__',
        transport: 'stdio',
        command: 'node',
        enabled: true,
      }),
    ).rejects.toThrow('原型键')
    await fixture.credentials.setCredential({
      id: 'mcp:server-a:revision-a',
      kind: 'generic',
      fields: { envJson: '{"TOKEN":"existing-canary"}' },
    })
    await expect(
      manager.addServer({
        name: 'collision',
        transport: 'stdio',
        command: 'node',
        enabled: true,
        credentials: { env: { TOKEN: 'must-not-overwrite' } },
      }),
    ).rejects.toThrow('拒绝覆盖')
    expect(fixture.credentials.resolveCredential('mcp:server-a:revision-a')).toEqual({
      envJson: '{"TOKEN":"existing-canary"}',
    })
  })
})

async function createFixture(loadCredentials = true): Promise<{
  tempDir: string
  configPath: string
  credentialPath: string
  credentials: CredentialService
}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'cclink-mcp-config-'))
  const configPath = join(tempDir, 'mcp-servers.json')
  const credentialPath = join(tempDir, 'credentials/credentials.json')
  cleanupPaths.push(tempDir)
  const credentials = new CredentialService(new PlaintextCredentialStore(credentialPath), {
    userDataPath: tempDir,
    copyText: () => undefined,
    openPath: async () => '',
    now: () => new Date('2026-08-31T00:00:00.000Z'),
  })
  if (loadCredentials) await credentials.load()
  return { tempDir, configPath, credentialPath, credentials }
}

function createManager(
  fixture: { configPath: string; credentials: CredentialService },
  serverIds: string[],
  revisions: string[],
): McpClientManager {
  return new McpClientManager(fixture.credentials, fixture.configPath, {
    createServerId: sequence(serverIds),
    createRevision: sequence(revisions),
  })
}

function sequence(values: string[]): () => string {
  let index = 0
  return () => {
    const value = values[index]
    index += 1
    if (!value) throw new Error('test sequence exhausted')
    return value
  }
}
